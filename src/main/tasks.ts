import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import type {
  AskQuestion,
  PtyInfo,
  TaskAccess,
  TaskConfig,
  TaskEvent,
  TaskItem,
  TaskModel,
  TaskModels,
  TaskProvider,
  TaskSnapshot
} from '@shared/types'
import { agentEnv } from './accounts'
import { resolveCli, runCli } from './cli'
import { assertAllowed } from './files'
import { redact } from './redact'
import { ptys } from './pty'

// ---------------------------------------------------------------------------
// Catálogo de modelos

const CLAUDE_MODELS: (TaskModel & { minVersion?: string })[] = [
  { id: '', label: 'Modelo predeterminado' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', minVersion: '2.1.260' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]

/** AskUserQuestion y ExitPlanMode llegan como permisos, pero son una pregunta y un plan: se muestran así. */
function specialApproval(
  tool: string,
  input: unknown
): { title: string; fields: { special: 'question' | 'plan'; questions?: AskQuestion[]; plan?: string } } | null {
  const data = (input ?? {}) as Record<string, unknown>
  if (tool === 'AskUserQuestion' && Array.isArray(data.questions)) {
    const questions = (data.questions as Record<string, unknown>[])
      .map((q) => ({
        question: String(q.question ?? ''),
        header: q.header ? String(q.header) : undefined,
        multiSelect: q.multiSelect === true,
        options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map((o) => ({
          label: String(o.label ?? ''),
          description: o.description ? String(o.description) : undefined
        }))
      }))
      .filter((q) => q.question)
    if (questions.length) return { title: 'Claude te pregunta', fields: { special: 'question', questions } }
  }
  if (tool === 'ExitPlanMode' && typeof data.plan === 'string') return { title: 'Plan propuesto', fields: { special: 'plan', plan: data.plan } }
  return null
}

function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

let modelCache: { at: number; value: TaskModels } | null = null

export async function taskModels(force = false): Promise<TaskModels> {
  if (!force && modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.value
  const [claude, codex, opencode] = await Promise.all([
    (async () => {
      let version: string | null = null
      try {
        version = (await runCli('claude', ['--version'], { timeoutMs: 10_000 })).stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
      } catch {
        return []
      }
      return CLAUDE_MODELS.filter((m) => !m.minVersion || versionAtLeast(version, m.minVersion)).map(({ id, label }) => ({ id, label }))
    })(),
    (async () => {
      try {
        const { stdout } = await runCli('codex', ['debug', 'models'], { timeoutMs: 20_000 })
        const catalog = JSON.parse(stdout) as { models?: { slug: string; display_name?: string; visibility?: string }[] }
        const list = (catalog.models ?? []).filter((m) => m.visibility !== 'hide' && m.visibility !== 'hidden')
        return [{ id: '', label: 'Modelo predeterminado' }, ...list.map((m) => ({ id: m.slug, label: m.display_name ?? m.slug }))]
      } catch {
        return (await resolveCli('codex')) ? [{ id: '', label: 'Modelo predeterminado' }] : []
      }
    })(),
    (async () => {
      try {
        const { stdout } = await runCli('opencode', ['models'], { timeoutMs: 20_000 })
        const ids = stdout
          .split(/\r?\n/)
          .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
          .filter((l) => /^[\w.-]+\/[\w.:/-]+$/.test(l))
        return [{ id: '', label: 'Modelo predeterminado' }, ...ids.map((id) => ({ id, label: id }))]
      } catch {
        return []
      }
    })()
  ])
  modelCache = { at: Date.now(), value: { claude, codex, opencode } }
  return modelCache.value
}

// ---------------------------------------------------------------------------
// Estado de cada tarea

const CLAUDE_PERMISSION: Record<TaskAccess, string> = {
  'approval-required': 'default',
  'auto-accept-edits': 'acceptEdits',
  auto: 'auto',
  'full-access': 'bypassPermissions'
}

const CODEX_SANDBOX: Record<TaskAccess, string> = {
  'approval-required': 'read-only',
  'auto-accept-edits': 'workspace-write',
  auto: 'workspace-write',
  'full-access': 'danger-full-access'
}

const PLAN_PREFIX =
  'Modo plan: analiza y propón un plan detallado paso a paso. No modifiques archivos ni ejecutes comandos que cambien nada.\n\n'

interface Task {
  panelId: string
  workspaceId: string
  title: string
  cwd: string
  config: TaskConfig
  items: TaskItem[]
  sessionId: string | null
  running: boolean
  proc: ChildProcessWithoutNullStreams | null
  /** Config con la que se lanzó el proceso de Claude (si cambia, se relanza con --resume). */
  procConfig: string | null
  pendingApprovals: Map<string, { requestId: string; input: unknown }>
  startedAt: number
}

const tasksDir = () => {
  const dir = join(app.getPath('userData'), 'tasks')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '')

function shortJson(v: unknown, max = 400): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** Título legible de una llamada a herramienta. */
function toolTitle(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {}
  const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : null)
  return pick('command') ?? pick('file_path') ?? pick('path') ?? pick('pattern') ?? pick('url') ?? pick('description') ?? pick('query') ?? name
}

class TaskManager extends EventEmitter {
  private tasks = new Map<string, Task>()

  private emitEvent(ev: TaskEvent): void {
    this.emit('event', ev)
  }

  private push(task: Task, item: TaskItem): void {
    // Los errores incluyen la salida de los CLIs: nunca deben mostrar una clave.
    if (item.kind === 'error' || item.kind === 'result') item = { ...item, text: redact(item.text) }
    if (item.kind === 'tool' && item.output) item = { ...item, output: redact(item.output) }
    const idx = task.items.findIndex((i) => i.id === item.id && i.kind === item.kind)
    if (idx >= 0) task.items[idx] = item
    else task.items.push(item)
    this.emitEvent({ panelId: task.panelId, type: 'item', item })
  }

  private setRunning(task: Task, running: boolean): void {
    if (task.running === running) return
    const wasRunning = task.running
    task.running = running
    this.emitEvent({ panelId: task.panelId, type: 'running', running })
    // Se integra con la bandeja y las notificaciones como si fuera un agente de terminal.
    const info: PtyInfo = {
      id: task.panelId,
      workspaceId: task.workspaceId,
      kind: 'agent',
      title: task.title,
      cwd: task.cwd,
      status: running ? 'working' : 'waiting',
      needsApproval: task.pendingApprovals.size > 0,
      lastOutputAt: Date.now()
    }
    ptys.emit('status', info)
    if (wasRunning && !running) {
      ptys.emit('attention', { ptyId: task.panelId, title: task.title, message: 'Terminó y espera tu respuesta' })
      this.save(task)
    }
  }

  private save(task: Task): void {
    const snap = this.snapshot(task)
    try {
      writeFileSync(join(tasksDir(), `${safe(task.panelId)}.json`), JSON.stringify(snap), 'utf8')
    } catch {
      // no crítico
    }
  }

  private snapshot(task: Task): TaskSnapshot {
    return { panelId: task.panelId, config: task.config, cwd: task.cwd, items: task.items, running: task.running, sessionId: task.sessionId }
  }

  /** Abre (o recupera del disco) la tarea de un panel. */
  open(panelId: string, workspaceId: string, title: string, cwd: string, config: TaskConfig): TaskSnapshot {
    let task = this.tasks.get(panelId)
    if (!task) {
      let items: TaskItem[] = []
      let sessionId: string | null = null
      const file = join(tasksDir(), `${safe(panelId)}.json`)
      if (existsSync(file)) {
        try {
          const saved = JSON.parse(readFileSync(file, 'utf8')) as TaskSnapshot
          items = saved.items.map((i) => (i.kind === 'approval' && i.state === 'pending' ? { ...i, state: 'denied' as const } : i))
          sessionId = saved.sessionId
        } catch {
          // archivo dañado: se empieza de cero
        }
      }
      task = {
        panelId,
        workspaceId,
        title,
        cwd,
        config,
        items,
        sessionId,
        running: false,
        proc: null,
        procConfig: null,
        pendingApprovals: new Map(),
        startedAt: 0
      }
      this.tasks.set(panelId, task)
    } else {
      task.title = title
      // Mientras la tarea es solo un borrador se puede cambiar de carpeta (esta copia o un worktree).
      if (!task.running && task.items.length === 0 && task.cwd !== cwd) task.cwd = cwd
    }
    return this.snapshot(task)
  }

  setConfig(panelId: string, config: TaskConfig): void {
    const task = this.tasks.get(panelId)
    if (!task) return
    // Cambiar de agente empieza una conversación nueva con él.
    if (task.config.provider !== config.provider) task.sessionId = null
    task.config = config
  }

  async send(panelId: string, text: string, files: string[] = []): Promise<void> {
    const task = this.tasks.get(panelId)
    if (!task) throw new Error('La tarea no está abierta')
    if (task.running && task.config.provider !== 'claude') throw new Error('El agente sigue trabajando; espera o detenlo.')
    if (!existsSync(task.cwd)) throw new Error('Un agente necesita una carpeta de proyecto para trabajar.')
    // El agente solo trabaja dentro de un espacio abierto (o de sus worktrees).
    assertAllowed(task.cwd)
    this.push(task, { kind: 'user', id: randomUUID(), text, files: files.length ? files : undefined })
    task.startedAt = Date.now()
    this.setRunning(task, true)
    try {
      if (task.config.provider === 'claude') await this.sendClaude(task, text, files)
      else if (task.config.provider === 'codex') await this.runCodex(task, text, files)
      else await this.runOpencode(task, text, files)
    } catch (err) {
      this.push(task, { kind: 'error', id: randomUUID(), text: (err as Error).message })
      this.setRunning(task, false)
    }
  }

  // --- Claude Code: un proceso vivo con stream-json en ambos sentidos -------------

  private async sendClaude(task: Task, text: string, files: string[]): Promise<void> {
    const signature = JSON.stringify({ model: task.config.model, mode: task.config.mode, access: task.config.access })
    if (task.proc && task.procConfig !== signature) {
      task.proc.kill()
      task.proc = null
    }
    if (!task.proc) await this.startClaude(task, signature)
    const prompt = files.length ? `${text}\n\n${files.map((f) => `@${f}`).join(' ')}` : text
    task.proc!.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n')
  }

  private async startClaude(task: Task, signature: string): Promise<void> {
    const cli = await resolveCli('claude')
    if (!cli) throw new Error('Claude Code no está instalado (npm install -g @anthropic-ai/claude-code)')
    const permission = task.config.mode === 'plan' ? 'plan' : CLAUDE_PERMISSION[task.config.access]
    const args = [
      ...cli.prefix,
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      permission
    ]
    // Con acceso total no hay nada que aprobar; en el resto, las aprobaciones llegan por stdio.
    if (permission !== 'bypassPermissions') args.push('--permission-prompt-tool', 'stdio')
    if (task.config.model) args.push('--model', task.config.model)
    if (task.sessionId) args.push('--resume', task.sessionId)

    const proc = spawn(cli.file, args, { cwd: task.cwd, env: { ...process.env, ...agentEnv('claude') }, windowsHide: true })
    task.proc = proc
    task.procConfig = signature
    let buffer = ''
    let stderr = ''
    // Texto en curso por bloque: id de mensaje + índice del bloque.
    const streaming = new Map<string, string>()
    let messageId = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let ev: Record<string, any>
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        this.onClaudeEvent(task, ev, streaming, (id) => (messageId = id), () => messageId)
      }
    })
    proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
    proc.on('error', (err) => {
      this.push(task, { kind: 'error', id: randomUUID(), text: `No se pudo iniciar Claude Code: ${err.message}` })
      this.setRunning(task, false)
    })
    proc.on('close', (code) => {
      if (task.proc !== proc) return
      task.proc = null
      task.procConfig = null
      if (task.running) {
        const hint = /login|auth|401/i.test(stderr) ? ' Inicia sesión en Ajustes → Agentes.' : ''
        this.push(task, { kind: 'error', id: randomUUID(), text: `Claude Code se cerró (${code}). ${stderr.trim().slice(-300)}${hint}` })
        this.setRunning(task, false)
      }
    })
  }

  private onClaudeEvent(
    task: Task,
    ev: Record<string, any>,
    streaming: Map<string, string>,
    setMessage: (id: string) => void,
    getMessage: () => string
  ): void {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init' && ev.session_id && ev.session_id !== task.sessionId) {
          task.sessionId = ev.session_id
          this.emitEvent({ panelId: task.panelId, type: 'session', sessionId: ev.session_id })
        }
        break
      case 'stream_event': {
        const e = ev.event ?? {}
        if (e.type === 'message_start') setMessage(e.message?.id ?? randomUUID())
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          const id = `${getMessage()}:${e.index}`
          const text = (streaming.get(id) ?? '') + e.delta.text
          streaming.set(id, text)
          if (text.length === e.delta.text.length) this.push(task, { kind: 'text', id, text, streaming: true })
          else this.emitEvent({ panelId: task.panelId, type: 'delta', id, text: e.delta.text })
          const item = task.items.find((i) => i.id === id)
          if (item && item.kind === 'text') item.text = text
        }
        break
      }
      case 'assistant': {
        const msgId = ev.message?.id ?? getMessage()
        ;(ev.message?.content ?? []).forEach((block: Record<string, any>, index: number) => {
          if (block.type === 'text' && block.text) {
            // El mensaje final puede llegar con otro id/índice que el streaming: se reutiliza
            // el bloque en curso cuyo texto es el comienzo de este, para no duplicarlo.
            let id = `${msgId}:${index}`
            for (const [sid, partial] of streaming) {
              if (sid === id || block.text.startsWith(partial.slice(0, 200))) {
                id = sid
                break
              }
            }
            streaming.delete(id)
            this.push(task, { kind: 'text', id, text: block.text })
          } else if (block.type === 'tool_use') {
            this.push(task, { kind: 'tool', id: block.id, name: block.name, title: toolTitle(block.name, block.input), status: 'running' })
          }
        })
        break
      }
      case 'user': {
        for (const block of ev.message?.content ?? []) {
          if (block.type !== 'tool_result') continue
          const tool = task.items.find((i) => i.id === block.tool_use_id && i.kind === 'tool')
          if (tool && tool.kind === 'tool') {
            const output = Array.isArray(block.content)
              ? block.content.map((c: Record<string, unknown>) => (typeof c.text === 'string' ? c.text : '')).join('\n')
              : String(block.content ?? '')
            this.push(task, { ...tool, status: block.is_error ? 'error' : 'done', output: output.slice(0, 4000) })
          }
        }
        break
      }
      case 'control_request': {
        const req = ev.request ?? {}
        if (req.subtype !== 'can_use_tool') {
          // Peticiones de control que no usamos: se responden para no bloquear al agente.
          task.proc?.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: {} } }) + '\n')
          break
        }
        const id = randomUUID()
        task.pendingApprovals.set(id, { requestId: ev.request_id, input: req.input })
        // Dos herramientas de Claude no son permisos: AskUserQuestion es una pregunta con opciones y
        // ExitPlanMode es un plan que hay que aprobar. Se muestran como lo que son.
        const special = specialApproval(req.tool_name, req.input)
        this.push(task, {
          kind: 'approval',
          id,
          tool: req.tool_name,
          title: special?.title ?? `${req.display_name ?? req.tool_name}: ${toolTitle(req.tool_name, req.input)}`,
          detail: special ? '' : shortJson(req.input, 1200),
          state: 'pending',
          ...(special?.fields ?? {})
        })
        ptys.emit('status', {
          id: task.panelId,
          workspaceId: task.workspaceId,
          kind: 'agent',
          title: task.title,
          cwd: task.cwd,
          status: 'waiting',
          needsApproval: true,
          lastOutputAt: Date.now()
        } satisfies PtyInfo)
        ptys.emit('attention', { ptyId: task.panelId, title: task.title, message: 'Necesita tu aprobación' })
        break
      }
      case 'result': {
        this.push(task, {
          kind: 'result',
          id: ev.uuid ?? randomUUID(),
          ok: ev.subtype === 'success' && !ev.is_error,
          text: ev.subtype === 'success' ? '' : String(ev.result ?? ev.subtype ?? 'Error'),
          costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined,
          durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : Date.now() - task.startedAt
        })
        this.setRunning(task, false)
        break
      }
    }
  }

  /** Respuesta a una pregunta de Claude: pregunta → opción elegida (varias separadas por coma). */
  answerQuestion(panelId: string, approvalId: string, answers: Record<string, string>): void {
    const task = this.tasks.get(panelId)
    const pending = task?.pendingApprovals.get(approvalId)
    if (!task || !pending) return
    task.pendingApprovals.delete(approvalId)
    const input = (pending.input ?? {}) as Record<string, unknown>
    task.proc?.stdin.write(
      JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: pending.requestId, response: { behavior: 'allow', updatedInput: { ...input, answers } } }
      }) + '\n'
    )
    const item = task.items.find((i) => i.id === approvalId && i.kind === 'approval')
    if (item && item.kind === 'approval') this.push(task, { ...item, state: 'allowed', answers })
    if (task.running) this.setRunningStatusOnly(task)
  }

  /**
   * «Implementar» un plan: el plan se da por aprobado, el turno de planificación termina y la tarea pasa
   * a Build con el acceso elegido para que Claude lo ejecute. Así no quedan permisos a mitad de camino.
   */
  async implementPlan(panelId: string, approvalId: string | null): Promise<void> {
    const task = this.tasks.get(panelId)
    if (!task) return
    const pending = approvalId ? task.pendingApprovals.get(approvalId) : undefined
    if (approvalId && pending) {
      task.pendingApprovals.delete(approvalId)
      task.proc?.stdin.write(
        JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: pending.requestId,
            response: { behavior: 'deny', message: 'El usuario aprobó el plan. Termina este turno sin hacer nada más; en el siguiente mensaje se te pedirá implementarlo.' }
          }
        }) + '\n'
      )
      const item = task.items.find((i) => i.id === approvalId && i.kind === 'approval')
      if (item && item.kind === 'approval') this.push(task, { ...item, state: 'allowed' })
    }
    // Espera a que acabe el turno de planificación (con tope por si Claude no responde).
    const start = Date.now()
    while (task.running && Date.now() - start < 30_000) await new Promise((r) => setTimeout(r, 250))
    if (task.running) this.stop(panelId)
    task.config = { ...task.config, mode: 'build' }
    await this.send(panelId, 'Implementa ahora el plan que acabas de proponer.', [])
  }

  approve(panelId: string, approvalId: string, allow: boolean): void {
    const task = this.tasks.get(panelId)
    const pending = task?.pendingApprovals.get(approvalId)
    if (!task || !pending) return
    task.pendingApprovals.delete(approvalId)
    const response = allow
      ? { behavior: 'allow', updatedInput: pending.input }
      : { behavior: 'deny', message: 'El usuario rechazó esta acción.' }
    task.proc?.stdin.write(
      JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: pending.requestId, response } }) + '\n'
    )
    const item = task.items.find((i) => i.id === approvalId && i.kind === 'approval')
    if (item && item.kind === 'approval') this.push(task, { ...item, state: allow ? 'allowed' : 'denied' })
    if (task.running) this.setRunningStatusOnly(task)
  }

  private setRunningStatusOnly(task: Task): void {
    ptys.emit('status', {
      id: task.panelId,
      workspaceId: task.workspaceId,
      kind: 'agent',
      title: task.title,
      cwd: task.cwd,
      status: 'working',
      needsApproval: task.pendingApprovals.size > 0,
      lastOutputAt: Date.now()
    } satisfies PtyInfo)
  }

  // --- Codex: un proceso por turno (codex exec --json), se continúa con resume -----

  private async runCodex(task: Task, text: string, files: string[]): Promise<void> {
    const cli = await resolveCli('codex')
    if (!cli) throw new Error('Codex no está instalado (npm install -g @openai/codex)')
    const sandbox = task.config.mode === 'plan' ? 'read-only' : CODEX_SANDBOX[task.config.access]
    const args = [...cli.prefix, 'exec', '--json', '--skip-git-repo-check', '-s', sandbox, '-C', task.cwd]
    if (task.config.model) args.push('-m', task.config.model)
    if (task.sessionId) args.push('resume', task.sessionId)
    args.push('-')
    let prompt = (task.config.mode === 'plan' ? PLAN_PREFIX : '') + text
    if (files.length) prompt += `\n\nArchivos de referencia:\n${files.map((f) => `- ${f}`).join('\n')}`
    await this.runLines(task, cli.file, args, prompt, (ev) => this.onCodexEvent(task, ev), 'codex')
  }

  private onCodexEvent(task: Task, ev: Record<string, any>): void {
    switch (ev.type) {
      case 'thread.started':
        if (ev.thread_id) {
          task.sessionId = ev.thread_id
          this.emitEvent({ panelId: task.panelId, type: 'session', sessionId: ev.thread_id })
        }
        break
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const it = ev.item ?? {}
        const done = ev.type === 'item.completed'
        if (it.type === 'agent_message' && it.text) this.push(task, { kind: 'text', id: it.id, text: it.text, streaming: !done })
        else if (it.type === 'command_execution')
          this.push(task, {
            kind: 'tool',
            id: it.id,
            name: 'Comando',
            title: it.command ?? 'comando',
            status: !done ? 'running' : it.exit_code && it.exit_code !== 0 ? 'error' : 'done',
            output: it.aggregated_output ? String(it.aggregated_output).slice(-4000) : undefined
          })
        else if (it.type === 'file_change')
          this.push(task, {
            kind: 'tool',
            id: it.id,
            name: 'Edición',
            title: (it.changes ?? []).map((c: Record<string, string>) => `${c.kind ?? ''} ${c.path ?? ''}`.trim()).join(', ') || 'archivos',
            status: done ? (it.status === 'failed' ? 'error' : 'done') : 'running'
          })
        else if (it.type === 'mcp_tool_call' || it.type === 'web_search')
          this.push(task, { kind: 'tool', id: it.id, name: it.type === 'web_search' ? 'Búsqueda' : 'Herramienta', title: it.query ?? it.tool ?? it.type, status: done ? 'done' : 'running' })
        else if (it.type === 'error') this.push(task, { kind: 'error', id: it.id, text: it.message ?? 'Error' })
        break
      }
      case 'turn.completed':
        this.push(task, { kind: 'result', id: randomUUID(), ok: true, text: '', durationMs: Date.now() - task.startedAt })
        break
      case 'turn.failed':
        this.push(task, { kind: 'result', id: randomUUID(), ok: false, text: ev.error?.message ?? 'El turno falló' })
        break
      case 'error':
        this.push(task, { kind: 'error', id: randomUUID(), text: ev.message ?? 'Error de Codex' })
        break
    }
  }

  // --- OpenCode: un proceso por turno (opencode run --format json), --session para seguir ---

  private async runOpencode(task: Task, text: string, files: string[]): Promise<void> {
    const cli = await resolveCli('opencode')
    if (!cli) throw new Error('OpenCode no está instalado (npm install -g opencode-ai)')
    // El mensaje va primero: «-f» admite varios archivos y se tragaría el texto si fuera detrás.
    const args = [...cli.prefix, 'run', text, '--format', 'json']
    if (task.config.model) args.push('-m', task.config.model)
    if (task.sessionId) args.push('--session', task.sessionId)
    if (task.config.mode === 'plan') args.push('--agent', 'plan')
    for (const f of files) args.push('-f', f)
    let cost = 0
    await this.runLines(
      task,
      cli.file,
      args,
      undefined,
      (ev) => {
        if (ev.sessionID && ev.sessionID !== task.sessionId) {
          task.sessionId = ev.sessionID
          this.emitEvent({ panelId: task.panelId, type: 'session', sessionId: ev.sessionID })
        }
        const part = ev.part ?? {}
        if (ev.type === 'text' && part.text) this.push(task, { kind: 'text', id: part.id, text: part.text })
        else if (ev.type === 'tool_use' || ev.type === 'tool') {
          const state = part.state ?? {}
          this.push(task, {
            kind: 'tool',
            id: part.callID ?? part.id,
            name: part.tool ?? 'herramienta',
            title: state.title || toolTitle(part.tool ?? '', state.input) || part.tool || 'herramienta',
            status: state.status === 'error' ? 'error' : state.status === 'completed' ? 'done' : 'running',
            output: typeof state.output === 'string' ? state.output.slice(0, 4000) : undefined
          })
        } else if (ev.type === 'step_finish' && typeof part.cost === 'number') cost += part.cost
        else if (ev.type === 'error') this.push(task, { kind: 'error', id: randomUUID(), text: shortJson(ev.error ?? ev) })
      },
      'opencode',
      () => this.push(task, { kind: 'result', id: randomUUID(), ok: true, text: '', costUsd: cost || undefined, durationMs: Date.now() - task.startedAt })
    )
  }

  /** Lanza un proceso que emite JSON por líneas y lo traduce hasta que termina. */
  private runLines(
    task: Task,
    file: string,
    args: string[],
    input: string | undefined,
    onEvent: (ev: Record<string, any>) => void,
    agent: TaskProvider,
    onSuccess?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn(file, args, { cwd: task.cwd, env: { ...process.env, ...agentEnv(agent) }, windowsHide: true })
      task.proc = proc
      let buffer = ''
      let stderr = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('{')) continue
          try {
            onEvent(JSON.parse(line))
          } catch {
            // línea que no es JSON
          }
        }
      })
      proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
      proc.on('error', (err) => {
        this.push(task, { kind: 'error', id: randomUUID(), text: err.message })
      })
      proc.on('close', (code) => {
        if (task.proc === proc) task.proc = null
        if (code === 0) onSuccess?.()
        else if (code !== null) {
          const hint = /login|auth|401|api key/i.test(stderr) ? ' Inicia sesión en Ajustes → Agentes.' : ''
          this.push(task, { kind: 'error', id: randomUUID(), text: `${agent} terminó con código ${code}. ${stderr.trim().slice(-400)}${hint}` })
        }
        this.setRunning(task, false)
        resolve()
      })
      if (input !== undefined) proc.stdin.end(input)
      else proc.stdin.end()
    })
  }

  stop(panelId: string): void {
    const task = this.tasks.get(panelId)
    if (!task?.proc) return
    if (task.config.provider === 'claude') {
      // Interrumpe el turno sin cerrar la sesión.
      task.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }) + '\n')
      setTimeout(() => {
        if (task.running && task.proc) {
          task.proc.kill()
        }
      }, 4000)
    } else task.proc.kill()
    for (const [id] of task.pendingApprovals) this.approve(panelId, id, false)
    this.push(task, { kind: 'error', id: randomUUID(), text: 'Detenido por ti.' })
  }

  close(panelId: string): void {
    const task = this.tasks.get(panelId)
    if (!task) return
    task.proc?.kill()
    this.tasks.delete(panelId)
  }

  closeAll(): void {
    for (const id of [...this.tasks.keys()]) this.close(id)
  }
}

export const tasks = new TaskManager()
