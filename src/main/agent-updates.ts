import { BrowserWindow } from 'electron'
import { AGENTS, type AgentId, type AgentUpdateItem } from '@shared/types'
import { agentVersions, resetAgentCache } from './agents'
import { runCli } from './cli'
import { ptys } from './pty'
import { store } from './store'
import { taskModels } from './tasks'

/**
 * Avisos y actualización de Claude Code, Codex y OpenCode (como el «Updates» de Deska): compara la versión
 * instalada con la última de npm, avisa y actualiza con `npm install -g` cuando el usuario pulsa Actualizar.
 */

const NPM_PACKAGES: Partial<Record<AgentId, string>> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai'
}

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_MS = 20_000
const INSTALL_TIMEOUT_MS = 6 * 60_000

const ids = (): AgentId[] => AGENTS.map((a) => a.id).filter((id) => NPM_PACKAGES[id])

let items: AgentUpdateItem[] = ids().map((id) => ({ id, installed: null, latest: null, status: 'idle', running: 0 }))
let installing = false

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('agentUpdates:state', items)
}

function patch(id: AgentId, change: Partial<AgentUpdateItem>): void {
  items = items.map((i) => (i.id === id ? { ...i, ...change } : i))
  broadcast()
}

/** ¿`a` es una versión más nueva que `b`? (compara 1.2.3 por números) */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

function runningAgents(id: AgentId): number {
  return ptys.list().filter((p) => p.kind === 'agent' && p.agent === id && p.status !== 'exited').length
}

export function currentUpdates(): AgentUpdateItem[] {
  return items
}

export async function checkAgentUpdates(): Promise<AgentUpdateItem[]> {
  const versions = await agentVersions().catch(() => null)
  if (!versions) return items
  for (const v of versions) {
    const current = items.find((i) => i.id === v.id)
    // No se pisa una actualización en curso ni el «actualizado» que el usuario aún no ha visto.
    if (!current || current.status === 'updating' || current.status === 'done' || current.status === 'error') continue
    const available = !!(v.installed && v.latest && isNewer(v.latest, v.installed))
    items = items.map((i) =>
      i.id === v.id ? { ...i, installed: v.installed, latest: v.latest, status: available ? 'available' : 'idle', message: undefined } : i
    )
  }
  broadcast()
  return items
}

function friendlyError(output: string): string {
  if (/EBUSY|EPERM|resource busy|being used/i.test(output)) {
    return 'El agente está en uso. Cierra sus terminales o tareas y vuelve a intentarlo.'
  }
  if (/EACCES|permission denied/i.test(output)) return 'npm no tiene permiso para instalar aquí. Abre Xora como administrador o revisa el prefijo de npm.'
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network/i.test(output)) return 'No hay conexión con npm. Revisa tu internet y vuelve a intentarlo.'
  const last = output.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ')
  return last ? `npm falló: ${last.slice(0, 160)}` : 'La instalación falló.'
}

export async function updateAgent(id: AgentId): Promise<AgentUpdateItem[]> {
  const pkg = NPM_PACKAGES[id]
  if (!pkg) throw new Error('Ese agente no se actualiza desde Xora.')
  if (installing) throw new Error('Ya hay una actualización en marcha.')
  installing = true
  patch(id, { status: 'updating', message: undefined })
  try {
    const args = ['install', '-g', `${pkg}@latest`, '--no-fund', '--no-audit']
    // XORA_UPDATE_DRYRUN=1 comprueba todo el recorrido sin instalar nada (pruebas).
    const dry = process.env.XORA_UPDATE_DRYRUN === '1'
    if (dry) args.push('--dry-run')
    const { code, stdout, stderr } = await runCli('npm', args, { timeoutMs: INSTALL_TIMEOUT_MS })
    if (code !== 0) throw new Error(friendlyError(stderr || stdout))
    resetAgentCache()
    const [after] = (await agentVersions()).filter((v) => v.id === id)
    if (!dry && after?.latest && after.installed && isNewer(after.latest, after.installed)) {
      throw new Error('npm terminó, pero la versión instalada no cambió. Reinicia Xora y vuelve a comprobar.')
    }
    patch(id, {
      installed: dry ? items.find((i) => i.id === id)?.latest ?? after?.installed ?? null : after?.installed ?? null,
      latest: after?.latest ?? null,
      status: 'done',
      running: runningAgents(id)
    })
    // Una versión nueva suele traer modelos nuevos: se renueva la lista del selector.
    void taskModels(true).catch(() => undefined)
  } catch (err) {
    patch(id, { status: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    installing = false
  }
  return items
}

/** Quita el aviso de «actualizado» o de error de un agente. */
export function dismissAgentUpdate(id: AgentId): void {
  patch(id, { status: 'idle', message: undefined })
  void checkAgentUpdates()
}

export function startAgentUpdateChecks(): void {
  const tick = (): void => {
    if (store.getSettings().checkAgentUpdates) void checkAgentUpdates()
  }
  setTimeout(tick, FIRST_CHECK_MS)
  setInterval(tick, CHECK_EVERY_MS)
}
