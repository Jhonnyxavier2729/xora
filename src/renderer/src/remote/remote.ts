import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { AGENTS, type PtyInfo, type RemoteServerMessage, type RemoteWorkspaceSummary } from '@shared/types'
import './remote.css'

const TOKEN_KEY = 'xora-token'
const app = document.getElementById('app')!

let token = safeGet(TOKEN_KEY)
let ws: WebSocket | null = null
let workspaces: RemoteWorkspaceSummary[] = []
let ptys = new Map<string, PtyInfo>()
let view: { kind: 'list' } | { kind: 'term'; ptyId: string } = { kind: 'list' }
let term: Terminal | null = null
let fit: FitAddon | null = null
let reconnectDelay = 1000

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // modo privado
  }
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((e: Event) => void)> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v)
  }
  for (const c of children) if (c !== null && c !== false) el.append(c)
  return el
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
  })
  if (res.status === 401) {
    safeSet(TOKEN_KEY, null)
    token = null
    renderPair('Este dispositivo ya no está autorizado. Empareja de nuevo.')
    throw new Error('No autorizado')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Error ${res.status}`)
  return body as T
}

function toast(text: string, kind: 'info' | 'error' | 'attention' = 'info'): void {
  const el = h('div', { class: `r-toast ${kind}` }, text)
  document.body.append(el)
  setTimeout(() => el.remove(), 5000)
}

// ---------------------------------------------------------------------------
// Emparejamiento

function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'PC con Windows'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Navegador'
}

async function pair(code: string): Promise<boolean> {
  const res = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim().toUpperCase(), name: deviceName() })
  })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!res.ok || !body.token) {
    renderPair(body.error ?? 'No se pudo emparejar')
    return false
  }
  token = body.token
  safeSet(TOKEN_KEY, token)
  return true
}

function renderPair(error?: string): void {
  ws?.close()
  const input = h('input', { placeholder: 'CÓDIGO', maxlength: '8', autocapitalize: 'characters', class: 'pair-input' })
  const submit = async () => {
    if (await pair(input.value)) connect()
  }
  input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void submit())
  app.replaceChildren(
    h(
      'div',
      { class: 'pair' },
      h('div', { class: 'r-brand' }, h('span', { class: 'brand-mark' }), 'Xora'),
      h('p', {}, 'Introduce el código que aparece en Ajustes → Acceso remoto de tu ordenador.'),
      input,
      h('button', { class: 'r-btn primary', onClick: () => void submit() }, 'Emparejar'),
      error ? h('p', { class: 'r-error' }, error) : null
    )
  )
  input.focus()
}

// ---------------------------------------------------------------------------
// Conexión en tiempo real

function connect(): void {
  if (!token) return renderPair()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
  ws.onopen = () => {
    reconnectDelay = 1000
    document.body.classList.remove('offline')
    if (view.kind === 'term') attach(view.ptyId)
  }
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data) as RemoteServerMessage)
  ws.onclose = (ev) => {
    document.body.classList.add('offline')
    if (ev.code === 1006 && !token) return
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(15000, reconnectDelay * 2)
  }
  if (view.kind === 'list') renderList()
}

function sendWs(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function onMessage(msg: RemoteServerMessage): void {
  switch (msg.t) {
    case 'state':
      workspaces = msg.workspaces
      ptys = new Map(msg.ptys.map((p) => [p.id, p]))
      if (view.kind === 'list') renderList()
      else renderTermHeader()
      break
    case 'pty-status':
      ptys.set(msg.info.id, msg.info)
      if (view.kind === 'list') renderList()
      else if (view.ptyId === msg.info.id) renderTermHeader()
      break
    case 'replay':
      if (view.kind === 'term' && view.ptyId === msg.ptyId && term) {
        term.reset()
        term.write(msg.data)
      }
      break
    case 'data':
      if (view.kind === 'term' && view.ptyId === msg.ptyId) term?.write(msg.data)
      break
    case 'exit':
      if (view.kind === 'term' && view.ptyId === msg.ptyId) term?.write('\r\n[proceso terminado]\r\n')
      break
    case 'attention':
      toast(`${msg.title}: ${msg.message}`, 'attention')
      if (navigator.vibrate) navigator.vibrate(120)
      break
  }
}

// ---------------------------------------------------------------------------
// Lista de workspaces y agentes

const STATUS: Record<string, string> = { working: 'trabajando', waiting: 'te espera', idle: 'listo', exited: 'terminado' }

function statusChip(info: PtyInfo | undefined): HTMLElement {
  if (!info) return h('span', { class: 'chip off' }, 'sin iniciar')
  const key = info.needsApproval ? 'approval' : info.status
  return h('span', { class: `chip ${key}` }, info.needsApproval ? 'pide aprobación' : STATUS[info.status])
}

function renderList(): void {
  const waiting = [...ptys.values()].filter((p) => p.kind === 'agent' && p.status === 'waiting')
  const list = h('div', { class: 'ws-list' })
  for (const w of workspaces) {
    const live = w.panels.filter((p) => p.type === 'agent' || p.type === 'terminal')
    const card = h(
      'section',
      { class: 'r-card' },
      h('div', { class: 'r-card-head' }, h('strong', {}, w.name), h('span', { class: 'muted' }, `${live.length} terminales`))
    )
    for (const p of live) {
      const info = ptys.get(p.id)
      card.append(
        h(
          'button',
          {
            class: 'r-row',
            onClick: async () => {
              if (!info || info.status === 'exited') {
                try {
                  await api('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId: p.id }) })
                } catch (err) {
                  return toast((err as Error).message, 'error')
                }
              }
              openTerm(p.id)
            }
          },
          h('span', { class: 'r-row-title' }, p.title),
          statusChip(info)
        )
      )
    }
    const agentSelect = h('select', {}, ...AGENTS.map((a) => h('option', { value: a.id }, a.name)))
    card.append(
      h(
        'div',
        { class: 'r-new' },
        agentSelect,
        h(
          'button',
          {
            class: 'r-btn small',
            onClick: async () => {
              try {
                const { panelId } = await api<{ panelId: string }>('/api/panels', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workspaceId: w.id, type: 'agent', agent: agentSelect.value })
                })
                setTimeout(() => openTerm(panelId), 600)
              } catch (err) {
                toast((err as Error).message, 'error')
              }
            }
          },
          '+ Agente'
        )
      )
    )
    list.append(card)
  }
  if (!workspaces.length) list.append(h('p', { class: 'muted center' }, 'No hay workspaces abiertos en el ordenador.'))

  app.replaceChildren(
    h(
      'div',
      { class: 'r-screen' },
      h(
        'header',
        { class: 'r-header' },
        h('div', { class: 'r-brand' }, h('span', { class: 'brand-mark' }), 'Xora'),
        h('span', { class: 'conn' })
      ),
      waiting.length
        ? h(
            'div',
            { class: 'r-attention' },
            h('strong', {}, `${waiting.length} agente(s) te esperan`),
            ...waiting.map((p) => h('button', { class: 'r-link', onClick: () => openTerm(p.id) }, `${p.title} ›`))
          )
        : null,
      list,
      xenBox()
    )
  )
}

// ---------------------------------------------------------------------------
// Xen (texto y voz)

function xenBox(): HTMLElement {
  const input = h('input', { placeholder: 'Pídele algo a Xen…' })
  const out = h('div', { class: 'xen-out' })
  const ask = async () => {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    out.textContent = 'Xen está pensando…'
    try {
      const { reply } = await api<{ reply: string }>('/api/xen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      out.textContent = reply
    } catch (err) {
      out.textContent = (err as Error).message
    }
  }
  input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void ask())

  const mic = h('button', { class: 'r-btn mic', title: 'Mantén pulsado para hablar' }, '🎙')
  if (!window.isSecureContext || !navigator.mediaDevices) {
    mic.addEventListener('click', () => toast('El micrófono solo funciona con HTTPS: activa el túnel en el ordenador o usa el dictado del teclado.'))
  } else {
    let rec: MediaRecorder | null = null
    let chunks: Blob[] = []
    const start = async (e: Event) => {
      e.preventDefault()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        chunks = []
        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        rec = new MediaRecorder(stream, { mimeType: mime })
        rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data)
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          out.textContent = 'Transcribiendo…'
          try {
            const blob = new Blob(chunks, { type: mime })
            const res = await api<{ transcript: string; reply: string }>('/api/voice', {
              method: 'POST',
              headers: { 'Content-Type': mime },
              body: blob
            })
            out.textContent = res.transcript ? `«${res.transcript}»\n${res.reply}` : 'No se entendió nada.'
          } catch (err) {
            out.textContent = (err as Error).message
          }
        }
        rec.start()
        mic.classList.add('rec')
      } catch {
        toast('Sin acceso al micrófono', 'error')
      }
    }
    const stop = () => {
      mic.classList.remove('rec')
      if (rec && rec.state !== 'inactive') rec.stop()
      rec = null
    }
    mic.addEventListener('pointerdown', (e) => void start(e))
    mic.addEventListener('pointerup', stop)
    mic.addEventListener('pointerleave', stop)
  }

  return h('div', { class: 'xen-box' }, out, h('div', { class: 'xen-row' }, mic, input, h('button', { class: 'r-btn primary', onClick: () => void ask() }, 'Enviar')))
}

// ---------------------------------------------------------------------------
// Vista de terminal

function renderTermHeader(): void {
  if (view.kind !== 'term') return
  const header = document.querySelector('.term-header-info')
  if (!header) return
  const info = ptys.get(view.ptyId)
  header.replaceChildren(h('strong', {}, info?.title ?? 'Terminal'), statusChip(info))
}

function attach(ptyId: string): void {
  if (!term || !fit) return
  fit.fit()
  sendWs({ t: 'attach', ptyId, cols: term.cols, rows: term.rows })
}

function key(label: string, data: string): HTMLElement {
  return h(
    'button',
    {
      class: 'k',
      onClick: () => {
        if (view.kind === 'term') sendWs({ t: 'input', ptyId: view.ptyId, data })
      }
    },
    label
  )
}

function openTerm(ptyId: string): void {
  view = { kind: 'term', ptyId }
  const host = h('div', { class: 'term-host' })
  const input = h('textarea', { rows: '1', placeholder: 'Escribe y envía al agente…' })
  const send = () => {
    const text = input.value
    if (!text.trim()) return
    void api('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ptyId, text }) })
    input.value = ''
  }
  app.replaceChildren(
    h(
      'div',
      { class: 'r-term' },
      h(
        'header',
        { class: 'r-header' },
        h('button', { class: 'r-btn small', onClick: () => closeTerm() }, '‹ Volver'),
        h('div', { class: 'term-header-info' })
      ),
      host,
      h(
        'div',
        { class: 'keys' },
        key('Esc', '\x1b'),
        key('Tab', '\t'),
        key('↑', '\x1b[A'),
        key('↓', '\x1b[B'),
        key('Enter', '\r'),
        key('1', '1'),
        key('2', '2'),
        key('y', 'y'),
        key('n', 'n'),
        key('Ctrl+C', '\x03')
      ),
      h('div', { class: 'term-input' }, input, h('button', { class: 'r-btn primary', onClick: send }, 'Enviar'))
    )
  )
  renderTermHeader()
  term?.dispose()
  term = new Terminal({
    fontSize: 12,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    theme: { background: '#0e1117', foreground: '#d8dee9' },
    scrollback: 4000,
    convertEol: false
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  term.onData((data) => sendWs({ t: 'input', ptyId, data }))
  attach(ptyId)
  const onResize = () => {
    if (!fit || !term) return
    fit.fit()
    sendWs({ t: 'resize', ptyId, cols: term.cols, rows: term.rows })
  }
  window.addEventListener('resize', onResize)
  ;(host as HTMLElement & { _off?: () => void })._off = () => window.removeEventListener('resize', onResize)
}

function closeTerm(): void {
  if (view.kind === 'term') sendWs({ t: 'detach', ptyId: view.ptyId })
  const host = document.querySelector('.term-host') as (HTMLElement & { _off?: () => void }) | null
  host?._off?.()
  term?.dispose()
  term = null
  fit = null
  view = { kind: 'list' }
  renderList()
}

// ---------------------------------------------------------------------------
// Arranque

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const code = params.get('pair')
  if (code) {
    history.replaceState(null, '', location.pathname)
    if (!(await pair(code))) return
  }
  if (!token) return renderPair()
  connect()
}

void boot()
