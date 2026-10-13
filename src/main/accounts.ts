import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountStatus, AgentId, TaskProvider } from '@shared/types'
import { secrets, store } from './store'

async function readJson(path: string): Promise<{ exists: boolean; value: unknown }> {
  try {
    return { exists: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (err) {
    return { exists: (err as NodeJS.ErrnoException).code !== 'ENOENT', value: undefined }
  }
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function jwtEmail(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const profile = rec(payload['https://api.openai.com/profile'])
    return (payload.email as string) ?? (profile?.email as string) ?? null
  } catch {
    return null
  }
}

/** Sesión de Claude Code: ~/.claude/.credentials.json (token OAuth) y el correo de ~/.claude.json. */
async function claudeAccount(): Promise<Omit<AccountStatus, 'id' | 'usesApiKey'>> {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const [creds, config] = await Promise.all([readJson(join(dir, '.credentials.json')), readJson(join(homedir(), '.claude.json'))])
  const oauth = rec(rec(creds.value)?.claudeAiOauth)
  const account = rec(rec(config.value)?.oauthAccount)
  if (oauth && typeof oauth.accessToken === 'string') {
    return { signedIn: true, label: (account?.emailAddress as string) ?? (oauth.subscriptionType as string) ?? 'Cuenta de Claude' }
  }
  return { signedIn: false, label: null }
}

/** Sesión de Codex: ~/.codex/auth.json (cuenta de ChatGPT o clave de API). */
async function codexAccount(): Promise<Omit<AccountStatus, 'id' | 'usesApiKey'>> {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const auth = rec((await readJson(join(home, 'auth.json'))).value)
  if (!auth) return { signedIn: false, label: null }
  const tokens = rec(auth.tokens)
  if (tokens && typeof tokens.id_token === 'string') return { signedIn: true, label: jwtEmail(tokens.id_token) ?? 'Cuenta de ChatGPT' }
  if (tokens && typeof tokens.access_token === 'string') return { signedIn: true, label: 'Cuenta de ChatGPT' }
  if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY) return { signedIn: true, label: 'Clave de API' }
  return { signedIn: false, label: null }
}

/** Sesión de OpenCode: proveedores en ~/.local/share/opencode/auth.json. */
async function opencodeAccount(): Promise<Omit<AccountStatus, 'id' | 'usesApiKey'>> {
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  const auth = rec((await readJson(join(base, 'opencode', 'auth.json'))).value)
  const providers = auth ? Object.keys(auth) : []
  if (!providers.length) return { signedIn: false, label: null }
  return { signedIn: true, label: providers.slice(0, 3).join(', ') + (providers.length > 3 ? ` +${providers.length - 3}` : '') }
}

export async function accountStatuses(): Promise<AccountStatus[]> {
  const use = store.getSettings().agentUseApiKey
  const [claude, codex, opencode] = await Promise.all([claudeAccount(), codexAccount(), opencodeAccount()])
  return [
    { id: 'claude', ...claude, usesApiKey: !!use.claude && !!secrets.get('anthropic') },
    { id: 'codex', ...codex, usesApiKey: !!use.codex && !!secrets.get('openai') },
    { id: 'opencode', ...opencode, usesApiKey: !!use.opencode }
  ]
}

export const LOGIN_COMMANDS: Record<TaskProvider, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
  opencode: 'opencode auth login'
}

/**
 * Variables de entorno con tus claves para un agente, si elegiste usarlas en lugar de la sesión.
 * OpenCode recibe todas las claves guardadas: cada una activa su proveedor.
 */
export function agentEnv(agent: AgentId | TaskProvider | undefined): Record<string, string> {
  const use = store.getSettings().agentUseApiKey
  const env: Record<string, string> = {}
  const anthropic = secrets.get('anthropic')
  const openai = secrets.get('openai')
  if (agent === 'claude' && use.claude && anthropic) env.ANTHROPIC_API_KEY = anthropic
  if (agent === 'codex' && use.codex && openai) {
    env.OPENAI_API_KEY = openai
    env.CODEX_API_KEY = openai
  }
  if (agent === 'opencode' && use.opencode) {
    if (anthropic) env.ANTHROPIC_API_KEY = anthropic
    if (openai) env.OPENAI_API_KEY = openai
    const openrouter = secrets.get('openrouter')
    if (openrouter) env.OPENROUTER_API_KEY = openrouter
    const gemini = secrets.get('gemini')
    if (gemini) env.GOOGLE_GENERATIVE_AI_API_KEY = gemini
  }
  return env
}
