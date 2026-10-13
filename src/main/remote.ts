import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import QRCode from 'qrcode'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  AgentId,
  PanelType,
  PtyInfo,
  RemoteClientMessage,
  RemoteServerMessage,
  RemoteState,
  RemoteWorkspaceSummary
} from '@shared/types'
import { createPanel, getCanvasWindow } from './canvas'
import { askXen } from './xen'
import { ptys } from './pty'
import { store, type PersistedDevice } from './store'
import { handleUtterance } from './voice'

const PAIR_TTL_MS = 10 * 60 * 1000
const MAX_BODY = 25 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json'
}

let server: Server | null = null
let wss: WebSocketServer | null = null
let pairCode: string | null = null
let pairExpiresAt: number | null = null
let tunnel: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelStatus: RemoteState['tunnelStatus'] = 'off'
let onChange: (() => void) | null = null
const pairAttempts = new Map<string, number[]>()

interface Client {
  ws: WebSocket
  deviceId: string
  attached: Set<string>
}
const clients = new Set<Client>()

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) out.push(addr.address)
    }
  }
  // La Wi-Fi doméstica suele ser 192.168.x; 172.16-31 suele ser WSL/Hyper-V y 10.x a menudo una VPN.
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b))
}

function authenticate(token: string | null): PersistedDevice | null {
  if (!token) return null
  const h = Buffer.from(hash(token))
  const device = store.getDevices().find((d) => {
    const other = Buffer.from(d.tokenHash)
    return other.length === h.length && timingSafeEqual(other, h)
  })
  if (device) {
    device.lastSeenAt = Date.now()
    store.setDevices(store.getDevices())
  }
  return device ?? null
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  return null
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Cuerpo demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (pairAttempts.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  pairAttempts.set(ip, recent)
  return recent.length > 10
}

export function workspaceSummaries(): RemoteWorkspaceSummary[] {
  return store.getWorkspaces().map((w) => ({
    id: w.id,
    name: w.name,
    root: w.root,
    panels: w.panels.map((p) => ({ id: p.id, type: p.type, title: p.title, agent: p.agent }))
  }))
}

// ---------------------------------------------------------------------------
// Archivos estáticos del cliente remoto.

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const target = pathname === '/' ? '/remote.html' : pathname
  if (devUrl) {
    // En desarrollo se reenvía al servidor de Vite.
    const upstream = new URL(target, devUrl)
    const proxied = httpRequest(upstream, { method: 'GET', headers: { accept: req.headers.accept ?? '*/*' } }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    proxied.on('error', () => json(res, 502, { error: 'Servidor de desarrollo no disponible' }))
    proxied.end()
    return
  }
  const base = resolve(join(__dirname, '../renderer'))
  const file = resolve(normalize(join(base, decodeURIComponent(target))))
  if (!file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) {
    json(res, 404, { error: 'No encontrado' })
    return
  }
  // Solo se expone lo que necesita el cliente remoto, no la app de escritorio completa.
  if (target.endsWith('.html') && !target.endsWith('/remote.html')) {
    json(res, 404, { error: 'No encontrado' })
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}

// ---------------------------------------------------------------------------
// API HTTP.

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname === '/api/pair' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? '?'
    if (rateLimited(ip)) return json(res, 429, { error: 'Demasiados intentos' })
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { code?: string; name?: string }
    if (!pairCode || !pairExpiresAt || Date.now() > pairExpiresAt || body.code?.toUpperCase() !== pairCode) {
      return json(res, 401, { error: 'Código de emparejamiento no válido o caducado' })
    }
    const token = randomBytes(32).toString('base64url')
    const device: PersistedDevice = {
      id: randomUUID(),
      name: (body.name || 'Dispositivo').slice(0, 60),
      tokenHash: hash(token),
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    }
    store.setDevices([...store.getDevices(), device])
    // El código es de un solo uso.
    pairCode = null
    pairExpiresAt = null
    onChange?.()
    return json(res, 200, { token, deviceId: device.id })
  }

  const device = authenticate(bearer(req))
  if (!device) return json(res, 401, { error: 'No autorizado' })

  if (pathname === '/api/state' && req.method === 'GET') {
    return json(res, 200, { workspaces: workspaceSummaries(), ptys: ptys.list() })
  }
  if (pathname === '/api/tail' && req.method === 'GET') {
    const url = new URL(req.url ?? '', 'http://x')
    const id = url.searchParams.get('ptyId') ?? ''
    return json(res, 200, { text: ptys.tail(id, 40) })
  }
  if (pathname === '/api/send' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { ptyId?: string; text?: string }
    if (!body.ptyId || typeof body.text !== 'string') return json(res, 400, { error: 'Faltan datos' })
    return json(res, 200, { ok: ptys.submit(body.ptyId, body.text) })
  }
  if (pathname === '/api/xen' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { text?: string }
    if (!body.text) return json(res, 400, { error: 'Falta el texto' })
    const result = await askXen(body.text)
    return json(res, 200, { reply: [result.reply, ...result.actions.map((a) => `• ${a.summary}`)].join('\n') })
  }
  if (pathname === '/api/voice' && req.method === 'POST') {
    const audio = await readBody(req)
    const result = await handleUtterance(audio, String(req.headers['content-type'] ?? 'audio/webm'), () => {})
    return json(res, 200, result)
  }
  if (pathname === '/api/start' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { panelId?: string }
    for (const ws of store.getWorkspaces()) {
      const panel = ws.panels.find((p) => p.id === body.panelId)
      if (!panel || (panel.type !== 'agent' && panel.type !== 'terminal')) continue
      const { info } = ptys.ensure({
        id: panel.id,
        workspaceId: ws.id,
        kind: panel.type,
        agent: panel.agent,
        command: panel.command,
        title: panel.title,
        cwd: panel.cwd || ws.root,
        cols: 100,
        rows: 30
      })
      return json(res, 200, { info })
    }
    return json(res, 404, { error: 'Panel no encontrado' })
  }
  if (pathname === '/api/panels' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as {
      workspaceId?: string
      type?: PanelType
      agent?: AgentId
    }
    if (!body.workspaceId || !body.type) return json(res, 400, { error: 'Faltan datos' })
    if (!getCanvasWindow()) return json(res, 409, { error: 'La app de escritorio no tiene la ventana abierta' })
    const panelId = await createPanel(body.workspaceId, { type: body.type, agent: body.agent })
    return json(res, 200, { panelId })
  }
  return json(res, 404, { error: 'No encontrado' })
}

// ---------------------------------------------------------------------------
// WebSocket.

function send(client: Client, msg: RemoteServerMessage): void {
  if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg))
}

export function broadcast(msg: RemoteServerMessage, filter?: (c: Client) => boolean): void {
  for (const c of clients) if (!filter || filter(c)) send(c, msg)
}

let stateTimer: NodeJS.Timeout | null = null
export function broadcastState(): void {
  if (!clients.size || stateTimer) return
  stateTimer = setTimeout(() => {
    stateTimer = null
    broadcast({ t: 'state', workspaces: workspaceSummaries(), ptys: ptys.list() })
  }, 150)
}

function onSocket(ws: WebSocket, deviceId: string): void {
  const client: Client = { ws, deviceId, attached: new Set() }
  clients.add(client)
  onChange?.()
  send(client, { t: 'state', workspaces: workspaceSummaries(), ptys: ptys.list() })
  ws.on('message', (raw) => {
    let msg: RemoteClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    switch (msg.t) {
      case 'attach':
        client.attached.add(msg.ptyId)
        if (msg.cols && msg.rows) ptys.resize(msg.ptyId, msg.cols, msg.rows)
        send(client, { t: 'replay', ptyId: msg.ptyId, data: ptys.replay(msg.ptyId) })
        break
      case 'detach':
        client.attached.delete(msg.ptyId)
        getCanvasWindow()?.webContents.send('pty:refit', msg.ptyId)
        break
      case 'input':
        if (client.attached.has(msg.ptyId)) ptys.write(msg.ptyId, msg.data)
        break
      case 'resize':
        if (client.attached.has(msg.ptyId)) ptys.resize(msg.ptyId, msg.cols, msg.rows)
        break
    }
  })
  ws.on('close', () => {
    for (const id of client.attached) getCanvasWindow()?.webContents.send('pty:refit', id)
    clients.delete(client)
    onChange?.()
  })
}

ptys.on('data', (id: string, data: string) => {
  broadcast({ t: 'data', ptyId: id, data }, (c) => c.attached.has(id))
})
ptys.on('exit', (id: string, code: number) => broadcast({ t: 'exit', ptyId: id, code }, (c) => c.attached.has(id)))
ptys.on('status', (info: PtyInfo) => broadcast({ t: 'pty-status', info }))
ptys.on('attention', (a: { ptyId: string; title: string; message: string }) => broadcast({ t: 'attention', ...a }))

// ---------------------------------------------------------------------------
// Ciclo de vida.

export function setRemoteChangeListener(fn: () => void): void {
  onChange = fn
}

export function newPairCode(): void {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  pairCode = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  pairExpiresAt = Date.now() + PAIR_TTL_MS
  onChange?.()
}

export async function enableRemote(): Promise<void> {
  if (server) return
  const port = store.getSettings().remotePort
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((err: Error) => json(res, 500, { error: err.message }))
      return
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' })
    serveStatic(req, res, pathname)
  })
  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const device = url.pathname === '/ws' ? authenticate(url.searchParams.get('token')) : null
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss!.handleUpgrade(req, socket, head, (ws) => onSocket(ws, device.id))
  })
  await new Promise<void>((ok, fail) => {
    server!.once('error', fail)
    server!.listen(port, '0.0.0.0', () => ok())
  }).catch((err) => {
    server = null
    wss = null
    throw err
  })
  newPairCode()
}

export async function disableRemote(): Promise<void> {
  stopTunnel()
  for (const c of clients) c.ws.close()
  clients.clear()
  wss?.close()
  wss = null
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()))
  server = null
  pairCode = null
  pairExpiresAt = null
  onChange?.()
}

export function startTunnel(): void {
  if (!server || tunnel) return
  tunnelStatus = 'starting'
  tunnelUrl = null
  onChange?.()
  const port = store.getSettings().remotePort
  const proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
    windowsHide: true
  })
  tunnel = proc
  const onOutput = (chunk: Buffer) => {
    const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match && !tunnelUrl) {
      tunnelUrl = match[0]
      tunnelStatus = 'on'
      onChange?.()
    }
  }
  proc.stdout.on('data', onOutput)
  proc.stderr.on('data', onOutput)
  proc.on('error', (err: NodeJS.ErrnoException) => {
    tunnelStatus = err.code === 'ENOENT' ? 'missing' : 'error'
    tunnel = null
    onChange?.()
  })
  proc.on('exit', () => {
    if (tunnel === proc) {
      tunnel = null
      tunnelUrl = null
      if (tunnelStatus !== 'missing') tunnelStatus = 'off'
      onChange?.()
    }
  })
}

export function stopTunnel(): void {
  if (tunnel) {
    const t = tunnel
    tunnel = null
    t.kill()
  }
  tunnelUrl = null
  tunnelStatus = tunnelStatus === 'missing' ? 'missing' : 'off'
}

export function revokeDevice(id: string): void {
  store.setDevices(store.getDevices().filter((d) => d.id !== id))
  // Cierra las conexiones abiertas de ese dispositivo.
  for (const c of clients) if (c.deviceId === id) c.ws.close()
  onChange?.()
}

export async function remoteState(): Promise<RemoteState> {
  const port = store.getSettings().remotePort
  const lanUrls = server ? lanAddresses().map((ip) => `http://${ip}:${port}`) : []
  const base = tunnelUrl ?? lanUrls[0] ?? null
  const pairUrl = server && pairCode && base ? `${base}/?pair=${pairCode}` : null
  return {
    enabled: !!server,
    port,
    lanUrls,
    tunnelUrl,
    tunnelStatus,
    pairCode,
    pairExpiresAt,
    pairUrl,
    pairQr: pairUrl ? await QRCode.toDataURL(pairUrl, { margin: 1, width: 240 }) : null,
    devices: store.getDevices().map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt })),
    connectedClients: clients.size
  }
}
