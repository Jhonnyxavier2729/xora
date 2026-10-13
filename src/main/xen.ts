import Anthropic from '@anthropic-ai/sdk'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENTS,
  type AgentId,
  type PanelType,
  type XenAction,
  type XenProviderConfig,
  type XenProviderStatus,
  type XenResult
} from '@shared/types'
import { confirmActions, createPanel, focusPanel } from './canvas'
import { resolveCli, runCli } from './cli'
import { ptys } from './pty'
import { redact } from './redact'
import { secrets, store } from './store'

/** La conversación con Xen se reinicia tras este tiempo sin uso. */
const SESSION_TTL_MS = 10 * 60 * 1000
const MAX_TOOL_ROUNDS = 8
const CLI_TIMEOUT_MS = 90_000

const RULES = `Eres Xen, el compañero de voz de Xora: un lienzo donde el usuario tiene workspaces (carpetas de proyecto) con paneles de terminal, agentes de código (Claude Code, Codex y OpenCode), editor, navegador, notas y git.

El usuario te habla por voz; lo que recibes es una transcripción y puede tener errores de reconocimiento. Entiende la intención y actúa:
- Si pide algo para un agente ("dile a Claude que...", "que el agente arregle..."), reenvía la petición al panel de agente adecuado (send_to_panel). Reescribe la petición como una instrucción clara y completa, en el idioma del usuario, sin inventar requisitos.
- Si no indica el agente, elige el más adecuado: el que esté esperando en el workspace mencionado, o el único agente existente. Si hay ambigüedad real, pregunta en una frase y no actúes.
- Si pide crear un agente o un panel, usa create_agent o create_panel.
- Si pregunta qué están haciendo los agentes, resume su salida reciente.
- Nunca envíes a una terminal comandos destructivos (borrar archivos, git push --force, etc.) sin que el usuario lo haya pedido explícitamente.

Tu respuesta se mostrará y puede leerse en voz alta: una o dos frases cortas, en el idioma del usuario, diciendo qué hiciste o qué necesitas saber.`

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_panels',
    description:
      'Lista los workspaces abiertos y sus paneles, con el estado de cada terminal o agente (working = trabajando, waiting = esperando al usuario, idle, exited).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true
  },
  {
    name: 'read_panel_output',
    description: 'Lee las últimas líneas de salida (texto plano) de un panel de terminal o de agente.',
    input_schema: {
      type: 'object',
      properties: {
        panel_id: { type: 'string', description: 'Id del panel' },
        lines: { type: 'integer', description: 'Número de líneas a leer (máximo 200)' }
      },
      required: ['panel_id', 'lines'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'send_to_panel',
    description:
      'Envía un mensaje a un panel de agente (como si el usuario lo escribiera y pulsara Enter) o un comando a un panel de terminal.',
    input_schema: {
      type: 'object',
      properties: { panel_id: { type: 'string' }, text: { type: 'string', description: 'Texto a enviar' } },
      required: ['panel_id', 'text'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'create_agent',
    description: 'Crea un panel de agente nuevo en un workspace y, opcionalmente, le envía una primera instrucción cuando esté listo.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        agent: { type: 'string', enum: AGENTS.map((a) => a.id) },
        prompt: { type: 'string', description: 'Primera instrucción para el agente; cadena vacía si no hay' }
      },
      required: ['workspace_id', 'agent', 'prompt'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'create_panel',
    description: 'Crea un panel que no es de agente: terminal, browser (con url), notes, editor o git.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        type: { type: 'string', enum: ['terminal', 'browser', 'notes', 'editor', 'git'] },
        url: { type: 'string', description: 'URL para paneles browser; cadena vacía en otro caso' }
      },
      required: ['workspace_id', 'type', 'url'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'focus_panel',
    description: 'Lleva la vista del lienzo a un panel y lo trae al frente.',
    input_schema: {
      type: 'object',
      properties: { panel_id: { type: 'string' } },
      required: ['panel_id'],
      additionalProperties: false
    },
    strict: true
  }
]

function findPanel(panelId: string) {
  for (const ws of store.getWorkspaces()) {
    const panel = ws.panels.find((p) => p.id === panelId)
    if (panel) return { ws, panel }
  }
  return null
}

function listPanels() {
  const infos = new Map(ptys.list().map((p) => [p.id, p]))
  return store.getWorkspaces().map((ws) => ({
    workspace_id: ws.id,
    name: ws.name,
    root: ws.root,
    panels: ws.panels.map((p) => {
      const info = infos.get(p.id)
      return {
        panel_id: p.id,
        type: p.type,
        title: p.title,
        agent: p.agent,
        status: info?.status ?? (p.type === 'agent' || p.type === 'terminal' ? 'not-started' : undefined),
        needs_approval: info?.needsApproval || undefined
      }
    })
  }))
}

/** Espera a que un agente recién creado termine de arrancar (primera pausa tras producir salida). */
async function waitUntilReady(panelId: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now()
  let sawOutput = false
  while (Date.now() - start < timeoutMs) {
    const info = ptys.get(panelId)
    if (info) {
      if (info.status === 'exited') return false
      if (info.status === 'working') sawOutput = true
      if (sawOutput && info.status === 'waiting') return true
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return !!ptys.get(panelId)
}

/** Descripción legible de una acción, para pedir confirmación. */
function describe(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'send_to_panel':
      return `Enviar a «${findPanel(String(input.panel_id))?.panel.title ?? input.panel_id}»: ${String(input.text).slice(0, 160)}`
    case 'create_agent':
      return `Crear un agente ${input.agent} en «${store.getWorkspace(String(input.workspace_id))?.name ?? input.workspace_id}»${input.prompt ? ` y pedirle: ${String(input.prompt).slice(0, 120)}` : ''}`
    case 'create_panel':
      return `Crear un panel ${input.type} en «${store.getWorkspace(String(input.workspace_id))?.name ?? input.workspace_id}»`
    default:
      return name
  }
}

const MUTATING = new Set(['send_to_panel', 'create_agent', 'create_panel'])

async function runTool(name: string, input: Record<string, unknown>, actions: XenAction[], confirmed = false): Promise<string> {
  if (!confirmed && MUTATING.has(name) && !store.getSettings().xenActWithoutAsking) {
    const ok = await confirmActions([describe(name, input)])
    if (!ok) return 'El usuario no aprobó esta acción; no se hizo.'
  }
  switch (name) {
    case 'list_panels':
      return JSON.stringify(listPanels())
    case 'read_panel_output': {
      const id = String(input.panel_id)
      if (!ptys.get(id)) return 'Ese panel no tiene una terminal en marcha.'
      const lines = Math.min(200, Math.max(1, Number(input.lines) || 60))
      return ptys.tail(id, lines) || '(sin salida)'
    }
    case 'send_to_panel': {
      const id = String(input.panel_id)
      const text = String(input.text)
      const found = findPanel(id)
      if (!ptys.submit(id, text)) return 'No se pudo enviar: el panel no tiene una terminal activa.'
      actions.push({ tool: name, summary: `→ ${found?.panel.title ?? id}: ${text.slice(0, 120)}` })
      return 'Enviado.'
    }
    case 'create_agent': {
      const wsId = String(input.workspace_id)
      const agent = String(input.agent) as AgentId
      const ws = store.getWorkspace(wsId)
      if (!ws) return 'No existe ese workspace.'
      const panelId = await createPanel(wsId, { type: 'agent', agent })
      actions.push({ tool: name, summary: `Nuevo agente ${agent} en ${ws.name}` })
      const prompt = String(input.prompt ?? '').trim()
      if (prompt) {
        const ready = await waitUntilReady(panelId)
        if (!ready) return `Panel ${panelId} creado, pero el agente no arrancó; no se envió la instrucción.`
        ptys.submit(panelId, prompt)
        actions.push({ tool: 'send_to_panel', summary: `→ ${agent}: ${prompt.slice(0, 120)}` })
      }
      return `Creado el panel ${panelId}.`
    }
    case 'create_panel': {
      const wsId = String(input.workspace_id)
      if (!store.getWorkspace(wsId)) return 'No existe ese workspace.'
      const type = String(input.type) as PanelType
      const url = String(input.url ?? '')
      const panelId = await createPanel(wsId, { type, url: url || undefined })
      actions.push({ tool: name, summary: `Nuevo panel ${type}` })
      return `Creado el panel ${panelId}.`
    }
    case 'focus_panel': {
      const found = findPanel(String(input.panel_id))
      if (!found) return 'No existe ese panel.'
      focusPanel(found.ws.id, found.panel.id)
      actions.push({ tool: name, summary: `Enfocado ${found.panel.title}` })
      return 'Hecho.'
    }
    default:
      return `Herramienta desconocida: ${name}`
  }
}

// ---------------------------------------------------------------------------
// Memoria corta de la conversación (compartida entre proveedores, en texto).

interface Turn {
  user: string
  xen: string
}
let turns: Turn[] = []
let lastUse = 0

export function resetXen(): void {
  turns = []
  apiHistory = []
}

function remember(user: string, xen: string): void {
  turns.push({ user, xen })
  if (turns.length > 6) turns = turns.slice(-6)
}

// ---------------------------------------------------------------------------
// Proveedor 1: API de Anthropic con tool use (bucle con herramientas).

let apiHistory: Anthropic.Beta.BetaMessageParam[] = []

async function askViaApi(transcript: string, model: string): Promise<XenResult> {
  const apiKey = secrets.get('anthropic')
  const client = new Anthropic(apiKey ? { apiKey } : {})
  apiHistory.push({ role: 'user', content: transcript })

  const actions: XenAction[] = []
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await client.beta.messages.create({
        model: model || 'claude-opus-5-5',
        max_tokens: 4096,
        system: RULES,
        tools,
        messages: apiHistory,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      })
    } catch (err) {
      // Un turno a medias dejaría tool_use sin respuesta en el historial: se descarta la conversación.
      apiHistory = []
      if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de Anthropic no es válida.')
      if (err instanceof Anthropic.RateLimitError) throw new Error('Límite de uso de la API alcanzado.')
      if (err instanceof Anthropic.APIError) throw new Error(`Error de la API (${err.status}): ${err.message}`)
      if (err instanceof Error && /authentication method|api.?key/i.test(err.message)) {
        throw new Error('No hay clave de Anthropic configurada.')
      }
      throw err
    }

    apiHistory.push({ role: 'assistant', content: response.content })
    if (response.stop_reason === 'refusal') return { reply: 'No puedo ayudar con esa petición.', actions }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return { reply: reply || 'Hecho.', actions }
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (use) => {
        try {
          const input = (use.input ?? {}) as Record<string, unknown>
          return { type: 'tool_result' as const, tool_use_id: use.id, content: await runTool(use.name, input, actions) }
        } catch (err) {
          return { type: 'tool_result' as const, tool_use_id: use.id, content: (err as Error).message, is_error: true }
        }
      })
    )
    apiHistory.push({ role: 'user', content: results })
  }
  return { reply: 'Hice varias acciones pero no terminé; revisa los paneles.', actions }
}

// ---------------------------------------------------------------------------
// Proveedores 2 y 3: CLIs de agentes (Claude Code, Codex) como planificador.
// No tienen nuestras herramientas, así que reciben el estado del lienzo en el prompt
// y devuelven un plan JSON que ejecutamos nosotros.

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Respuesta corta para el usuario' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['send_to_panel', 'create_agent', 'create_panel', 'focus_panel'] },
          panel_id: { type: 'string' },
          workspace_id: { type: 'string' },
          agent: { type: 'string', enum: AGENTS.map((a) => a.id) },
          type: { type: 'string', enum: ['terminal', 'browser', 'notes', 'editor', 'git'] },
          url: { type: 'string' },
          text: { type: 'string' },
          prompt: { type: 'string' }
        },
        required: ['tool']
      }
    }
  },
  required: ['reply', 'actions']
}

function planPrompt(transcript: string): string {
  const canvas = listPanels()
  // Salida reciente de los agentes, para poder responder "¿qué está haciendo X?".
  const outputs = canvas
    .flatMap((w) => w.panels)
    .filter((p) => p.type === 'agent' && ptys.get(p.panel_id))
    .slice(0, 6)
    .map((p) => `### ${p.title} (${p.panel_id})\n${ptys.tail(p.panel_id, 14)}`)
    .join('\n\n')
  const memory = turns.map((t) => `Usuario: ${t.user}\nXen: ${t.xen}`).join('\n')
  return `${RULES}

Devuelve SOLO un objeto JSON con "reply" (tu respuesta) y "actions" (lista de acciones a ejecutar, vacía si solo respondes o preguntas). Acciones posibles:
- {"tool":"send_to_panel","panel_id":"...","text":"..."}
- {"tool":"create_agent","workspace_id":"...","agent":"claude|codex|opencode","prompt":"..."}
- {"tool":"create_panel","workspace_id":"...","type":"terminal|browser|notes|editor|git","url":"..."}
- {"tool":"focus_panel","panel_id":"..."}

## Estado del lienzo
${JSON.stringify(canvas, null, 1)}

## Salida reciente de los agentes
${outputs || '(ninguno en marcha)'}

## Conversación reciente
${memory || '(nueva)'}

## Lo que acaba de decir el usuario
${transcript}`
}

function parsePlan(raw: unknown): { reply: string; actions: Record<string, unknown>[] } {
  let obj = raw
  if (typeof raw === 'string') {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('El agente no devolvió un plan válido')
    obj = JSON.parse(match[0])
  }
  const plan = obj as { reply?: unknown; actions?: unknown }
  return {
    reply: typeof plan.reply === 'string' ? plan.reply : '',
    actions: Array.isArray(plan.actions) ? (plan.actions as Record<string, unknown>[]) : []
  }
}

async function executePlan(plan: { reply: string; actions: Record<string, unknown>[] }): Promise<XenResult> {
  const actions: XenAction[] = []
  const valid = plan.actions.filter((a) => typeof a.tool === 'string' && (MUTATING.has(a.tool) || a.tool === 'focus_panel'))
  // Con "pedir confirmación", se aprueba el plan entero de una vez y luego no se vuelve a preguntar.
  if (!store.getSettings().xenActWithoutAsking && valid.some((a) => MUTATING.has(a.tool as string))) {
    const ok = await confirmActions(valid.map((a) => describe(a.tool as string, a)))
    if (!ok) return { reply: 'De acuerdo, no hice nada.', actions }
  }
  for (const a of valid) await runTool(a.tool as string, a, actions, true)
  return { reply: plan.reply || 'Hecho.', actions }
}

/**
 * Borra la carpeta temporal sin ocultar el error original: si el CLI agotó el tiempo, Windows
 * puede tenerla bloqueada un momento (EPERM), y eso no debe tapar el «no respondió».
 */
function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    // Se queda en %TEMP%; Windows la limpiará.
  }
}

async function askViaClaudeCli(transcript: string, model: string): Promise<XenResult> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(PLAN_SCHEMA),
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence'
  ]
  if (model) args.push('--model', model)
  const { code, stdout, stderr } = await runCli('claude', args, { input: planPrompt(transcript), timeoutMs: CLI_TIMEOUT_MS, cwd: tmpdir() })
  let parsed: { structured_output?: unknown; result?: unknown; is_error?: boolean }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`Claude Code falló (${code}): ${(stderr || stdout).slice(0, 200)}`)
  }
  if (parsed.is_error) throw new Error(`Claude Code: ${String(parsed.result).slice(0, 200)}`)
  return executePlan(parsePlan(parsed.structured_output ?? parsed.result))
}

async function askViaCodexCli(transcript: string, model: string): Promise<XenResult> {
  const dir = mkdtempSync(join(tmpdir(), 'xen-'))
  const out = join(dir, 'reply.txt')
  try {
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', out]
    if (model) args.push('-m', model)
    args.push('-')
    const { code, stderr } = await runCli('codex', args, { input: planPrompt(transcript), timeoutMs: CLI_TIMEOUT_MS, cwd: dir })
    let text = ''
    try {
      text = readFileSync(out, 'utf8')
    } catch {
      throw new Error(`Codex falló (${code}): ${stderr.slice(-200)}`)
    }
    return executePlan(parsePlan(text))
  } finally {
    cleanup(dir)
  }
}

async function askViaOpencodeCli(transcript: string, model: string): Promise<XenResult> {
  // El contexto va en un archivo adjunto: la línea de comandos de Windows no admite textos largos.
  const dir = mkdtempSync(join(tmpdir(), 'xen-'))
  const file = join(dir, 'xen-contexto.md')
  try {
    writeFileSync(file, planPrompt(transcript), 'utf8')
    // El mensaje va antes de -f: esa opción admite varios archivos y se tragaría lo que venga detrás.
    const args = ['run', 'Sigue las instrucciones del archivo adjunto y responde SOLO con el objeto JSON que pide.', '--format', 'json']
    if (model) args.push('-m', model)
    args.push('-f', file)
    const { code, stdout, stderr } = await runCli('opencode', args, { timeoutMs: CLI_TIMEOUT_MS, cwd: dir })
    const text = stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith('{'))
      .map((l) => {
        try {
          const ev = JSON.parse(l) as { type?: string; part?: { text?: string }; error?: { data?: { message?: string } } }
          if (ev.type === 'error') throw new Error(ev.error?.data?.message ?? 'Error de OpenCode')
          return ev.type === 'text' ? (ev.part?.text ?? '') : ''
        } catch (err) {
          if (err instanceof SyntaxError) return ''
          throw err
        }
      })
      .join('')
    if (!text) throw new Error(`OpenCode no respondió (${code}): ${stderr.slice(-200)}`)
    return executePlan(parsePlan(text))
  } finally {
    cleanup(dir)
  }
}

// ---------------------------------------------------------------------------
// Orden de proveedores con alternativas.

export async function providerStatuses(): Promise<XenProviderStatus[]> {
  const [claude, codex, opencode] = await Promise.all([resolveCli('claude'), resolveCli('codex'), resolveCli('opencode')])
  const hasKey = !!secrets.get('anthropic') || !!process.env.ANTHROPIC_API_KEY
  return [
    { id: 'claude-cli', ready: !!claude, detail: claude ? 'Claude Code en este ordenador' : 'Claude Code no está instalado' },
    { id: 'codex-cli', ready: !!codex, detail: codex ? 'Codex en este ordenador' : 'Codex no está instalado' },
    { id: 'opencode-cli', ready: !!opencode, detail: opencode ? 'OpenCode en este ordenador' : 'OpenCode no está instalado' },
    { id: 'api', ready: hasKey, detail: hasKey ? 'API de Anthropic con tu clave' : 'Falta la clave de Anthropic' }
  ]
}

async function askWith(provider: XenProviderConfig, transcript: string): Promise<XenResult> {
  switch (provider.id) {
    case 'claude-cli':
      return askViaClaudeCli(transcript, provider.model)
    case 'codex-cli':
      return askViaCodexCli(transcript, provider.model)
    case 'opencode-cli':
      return askViaOpencodeCli(transcript, provider.model)
    case 'api':
      return askViaApi(transcript, provider.model)
  }
}

export async function askXen(transcript: string): Promise<XenResult> {
  if (Date.now() - lastUse > SESSION_TTL_MS) resetXen()
  lastUse = Date.now()
  const providers = store.getSettings().xenProviders
  if (!providers.length) throw new Error('No hay ningún agente configurado para Xen. Añade uno en Ajustes → Xen.')
  const statuses = new Map((await providerStatuses()).map((s) => [s.id, s]))
  const errors: string[] = []
  for (const provider of providers) {
    const status = statuses.get(provider.id)
    if (!status?.ready) {
      errors.push(status?.detail ?? provider.id)
      continue
    }
    try {
      const result = await askWith(provider, transcript)
      remember(transcript, result.reply)
      return result
    } catch (err) {
      errors.push(`${status.detail}: ${(err as Error).message}`)
    }
  }
  throw new Error(redact(`Xen no pudo responder. ${errors.join(' · ')}`))
}
