import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { AGENTS, AUTONOMY_FLAGS, type EnsurePtyOptions, type PtyInfo, type PtyStatus } from '@shared/types'
import { agentEnv } from './accounts'
import { store } from './store'

/** Bytes de salida que se guardan por terminal para repintar al reconectar (renderer o remoto). */
const SCROLLBACK_LIMIT = 256 * 1024
/** Sin salida durante este tiempo, un agente que trabajaba pasa a "esperando". */
const QUIET_MS = 2500
/** La salida que llega justo después de escribir el usuario se trata como eco, no como trabajo. */
const ECHO_WINDOW_MS = 250

const APPROVAL_PATTERNS = [
  /do you want to (proceed|continue|make this edit|create|run)/i,
  /\(y\/n\)|\[y\/n\]|\by\/n\b/i,
  /allow (once|always)|approve|permission/i,
  /press enter to continue/i,
  /❯\s*1\.\s*yes/i
]

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replace(/\r(?!\n)/g, '\n')
}

interface Session {
  info: PtyInfo
  proc: pty.IPty
  buffer: string
  lastUserInputAt: number
  lastResizeAt: number
  quietTimer: NodeJS.Timeout | null
}

/** Tras redimensionar, los TUI repintan la pantalla: eso no es trabajo del agente. */
const RESIZE_REDRAW_MS = 1200

function defaultShell(): { file: string; args: string[] } {
  const configured = store.getSettings().shell.trim()
  if (configured) return { file: configured, args: [] }
  if (process.platform === 'win32') {
    const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    if (existsSync(pwsh)) return { file: pwsh, args: ['-NoLogo'] }
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
}

class PtyManager extends EventEmitter {
  private sessions = new Map<string, Session>()

  list(): PtyInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  get(id: string): PtyInfo | undefined {
    const s = this.sessions.get(id)
    return s ? { ...s.info } : undefined
  }

  /** Crea la terminal si no existe. Devuelve el buffer acumulado para repintar. */
  ensure(opts: EnsurePtyOptions): { info: PtyInfo; replay: string } {
    const existing = this.sessions.get(opts.id)
    if (existing && existing.info.status !== 'exited') {
      if (opts.title && existing.info.title !== opts.title) existing.info.title = opts.title
      return { info: { ...existing.info }, replay: existing.buffer }
    }
    if (existing) this.sessions.delete(opts.id)

    const shell = defaultShell()
    const cwd = existsSync(opts.cwd) ? opts.cwd : process.env.USERPROFILE || process.cwd()
    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(20, opts.cols || 100),
      rows: Math.max(5, opts.rows || 30),
      cwd,
      env: {
        ...process.env,
        // Tus claves, si elegiste que este agente las use en lugar de su sesión.
        ...(opts.kind === 'agent' ? agentEnv(opts.agent) : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        XORA: '1'
      } as Record<string, string>,
      useConpty: true
    })

    const info: PtyInfo = {
      id: opts.id,
      workspaceId: opts.workspaceId,
      kind: opts.kind,
      agent: opts.agent,
      title: opts.title,
      cwd,
      status: 'idle',
      needsApproval: false,
      lastOutputAt: Date.now()
    }
    const session: Session = { info, proc, buffer: '', lastUserInputAt: 0, lastResizeAt: 0, quietTimer: null }
    this.sessions.set(opts.id, session)

    proc.onData((data) => this.onData(session, data))
    proc.onExit(({ exitCode }) => {
      if (session.quietTimer) clearTimeout(session.quietTimer)
      session.info.status = 'exited'
      session.info.exitCode = exitCode
      this.emit('exit', opts.id, exitCode)
      this.emit('status', { ...session.info })
    })

    if (opts.kind === 'agent') {
      let command = opts.agent === 'custom' ? opts.command : AGENTS.find((a) => a.id === opts.agent)?.command
      // Autonomía: el agente actúa sin pedir permiso en cada paso (Ajustes → Agentes).
      const flag = opts.agent ? AUTONOMY_FLAGS[opts.agent] : undefined
      if (command && flag && opts.agent && store.getSettings().agentAutonomy[opts.agent]) command += ` ${flag}`
      if (command) setTimeout(() => proc.write(command + '\r'), 400)
    }

    this.emit('status', { ...info })
    return { info: { ...info }, replay: '' }
  }

  private onData(session: Session, data: string): void {
    session.buffer += data
    if (session.buffer.length > SCROLLBACK_LIMIT) {
      session.buffer = session.buffer.slice(session.buffer.length - SCROLLBACK_LIMIT)
    }
    const now = Date.now()
    session.info.lastOutputAt = now
    this.emit('data', session.info.id, data)

    if (session.info.kind !== 'agent') return
    const isEcho = now - session.lastUserInputAt < ECHO_WINDOW_MS && data.length < 64
    const isRedraw = now - session.lastResizeAt < RESIZE_REDRAW_MS
    if (isRedraw && session.info.status !== 'working') return
    if (!isEcho && session.info.status !== 'working') this.setStatus(session, 'working', false)

    if (session.quietTimer) clearTimeout(session.quietTimer)
    session.quietTimer = setTimeout(() => {
      session.quietTimer = null
      if (session.info.status === 'exited') return
      const tail = stripAnsi(session.buffer.slice(-2000))
      const needsApproval = APPROVAL_PATTERNS.some((p) => p.test(tail))
      const wasWorking = session.info.status === 'working'
      this.setStatus(session, 'waiting', needsApproval)
      if (wasWorking) {
        this.emit('attention', {
          ptyId: session.info.id,
          title: session.info.title,
          message: needsApproval ? 'Necesita tu aprobación' : 'Terminó y espera tu respuesta'
        })
      }
    }, QUIET_MS)
  }

  private setStatus(session: Session, status: PtyStatus, needsApproval: boolean): void {
    if (session.info.status === status && session.info.needsApproval === needsApproval) return
    session.info.status = status
    session.info.needsApproval = needsApproval
    this.emit('status', { ...session.info })
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (!s || s.info.status === 'exited') return
    s.lastUserInputAt = Date.now()
    s.proc.write(data)
  }

  /** Escribe un texto como si lo tecleara el usuario y lo envía con Enter. */
  submit(id: string, text: string): boolean {
    const s = this.sessions.get(id)
    if (!s || s.info.status === 'exited') return false
    s.lastUserInputAt = Date.now()
    // Pegado entre corchetes para que los agentes TUI reciban el texto multilínea como un bloque.
    const body = text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text
    s.proc.write(body)
    setTimeout(() => s.proc.write('\r'), 60)
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s || s.info.status === 'exited') return
    const cols2 = Math.max(20, Math.floor(cols))
    const rows2 = Math.max(5, Math.floor(rows))
    if (s.proc.cols === cols2 && s.proc.rows === rows2) return
    s.lastResizeAt = Date.now()
    try {
      s.proc.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)))
    } catch {
      // ConPTY puede fallar si el proceso acaba de salir.
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.quietTimer) clearTimeout(s.quietTimer)
    // Matar un ConPTY ya terminado hace fallar el agente auxiliar de node-pty ("AttachConsole failed").
    if (s.info.status !== 'exited') {
      try {
        s.proc.kill()
      } catch {
        // ya terminó
      }
    }
    this.sessions.delete(id)
  }

  replay(id: string): string {
    return this.sessions.get(id)?.buffer ?? ''
  }

  /** Últimas líneas de salida en texto plano (para Xen y vistas compactas). */
  tail(id: string, lines = 60): string {
    const buf = this.sessions.get(id)?.buffer ?? ''
    const text = stripAnsi(buf.slice(-40000))
    return text
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
      .slice(-lines)
      .join('\n')
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

export const ptys = new PtyManager()
