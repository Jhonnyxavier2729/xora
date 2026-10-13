import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentUsage, UsageReport, UsageWindow } from '@shared/types'
import { runCli } from './cli'

/**
 * Uso que le queda a cada suscripción (como el panel «Usage left» de Deska). Con la sesión que ya
 * tienen Claude Code y Codex en este equipo se consulta a Anthropic y a OpenAI; los tokens no van
 * a ningún otro sitio.
 */

const TIMEOUT_MS = 10_000
const CACHE_MS = 60_000
let cache: { at: number; report: UsageReport } | null = null

const CLAUDE_PLANS: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' }
const CODEX_PLANS: Record<string, string> = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' }

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const pct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))
const epoch = (v: unknown): number | null => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

async function readJson(file: string): Promise<Rec | undefined> {
  try {
    return rec(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return undefined
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body?: unknown }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { status: res.status, body: res.ok ? await res.json() : undefined }
  } catch {
    return { status: 0 }
  }
}

function problemFor(status: number): AgentUsage['problem'] {
  if (status === 401 || status === 403) return 'expired'
  if (status === 429) return 'rate-limited'
  return 'unreachable'
}

// --- Claude Code ---------------------------------------------------------------

function parseClaude(body: unknown): UsageWindow[] {
  const b = rec(body)
  if (!b) return []
  const out: UsageWindow[] = []
  for (const l of Array.isArray(b.limits) ? b.limits : []) {
    const limit = rec(l)
    const percent = num(limit?.percent)
    if (!limit || percent === undefined) continue
    if (limit.kind === 'session') out.push({ kind: 'session', usedPercent: pct(percent), resetsAt: epoch(limit.resets_at) })
    else if (limit.kind === 'weekly_all') out.push({ kind: 'week', usedPercent: pct(percent), resetsAt: epoch(limit.resets_at) })
  }
  if (out.length) return out
  // Formato anterior de la respuesta.
  for (const [key, kind] of [
    ['five_hour', 'session'],
    ['seven_day', 'week']
  ] as const) {
    const w = rec(b[key])
    const used = num(w?.utilization)
    if (w && used !== undefined) out.push({ kind, usedPercent: pct(used), resetsAt: epoch(w.resets_at) })
  }
  return out
}

async function claudeOnce(): Promise<AgentUsage> {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const oauth = rec((await readJson(join(dir, '.credentials.json')))?.claudeAiOauth)
  const token = str(oauth?.accessToken)
  if (!token) return { problem: 'signed-out', windows: [] }
  const sub = str(oauth?.subscriptionType)?.toLowerCase()
  const tier = str(oauth?.rateLimitTier)?.match(/(\d+)x\b/)?.[1]
  const plan = sub ? `${CLAUDE_PLANS[sub] ?? sub}${sub === 'max' && tier ? ` ${tier}x` : ''}` : undefined
  const { status, body } = await getJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'claude-code/2.1.0',
    Accept: 'application/json'
  })
  if (status !== 200) return { plan, problem: problemFor(status), windows: [] }
  const windows = parseClaude(body)
  return windows.length ? { plan, windows } : { plan, problem: 'unreachable', windows: [] }
}

// --- Codex ---------------------------------------------------------------------

function parseCodex(body: unknown): UsageWindow[] {
  const rate = rec(rec(body)?.rate_limit)
  const out: UsageWindow[] = []
  for (const [key, kind] of [
    ['primary_window', 'session'],
    ['secondary_window', 'week']
  ] as const) {
    const w = rec(rate?.[key])
    const used = num(w?.used_percent)
    if (!w || used === undefined) continue
    const after = num(w.reset_after_seconds)
    out.push({ kind, usedPercent: pct(used), resetsAt: epoch(w.reset_at) ?? (after === undefined ? null : Date.now() + after * 1000) })
  }
  return out
}

async function codexOnce(): Promise<AgentUsage> {
  const auth = await readJson(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'))
  const tokens = rec(auth?.tokens)
  const token = str(tokens?.access_token)
  if (!token) return { problem: str(auth?.OPENAI_API_KEY) ? 'api-key' : 'signed-out', windows: [] }
  const account = str(tokens?.account_id)
  const { status, body } = await getJson('https://chatgpt.com/backend-api/wham/usage', {
    Authorization: `Bearer ${token}`,
    ...(account ? { 'ChatGPT-Account-Id': account } : {}),
    'User-Agent': 'codex-cli',
    'OpenAI-Beta': 'codex-1',
    Accept: 'application/json'
  })
  if (status !== 200) return { problem: problemFor(status), windows: [] }
  const type = str(rec(body)?.plan_type)?.toLowerCase()
  const windows = parseCodex(body)
  const plan = type ? (CODEX_PLANS[type] ?? type) : undefined
  return windows.length ? { plan, windows } : { plan, problem: 'unreachable', windows: [] }
}

/** Si el token caducó, el propio CLI lo renueva al consultar su estado; luego se reintenta. */
async function withRefresh(once: () => Promise<AgentUsage>, cli: string, args: string[]): Promise<AgentUsage> {
  const first = await once()
  if (first.problem !== 'expired') return first
  await runCli(cli, args, { timeoutMs: 15_000 }).catch(() => undefined)
  return once()
}

export async function usageReport(force = false): Promise<UsageReport> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.report
  const [claude, codex] = await Promise.all([
    withRefresh(claudeOnce, 'claude', ['auth', 'status']),
    withRefresh(codexOnce, 'codex', ['login', 'status'])
  ])
  const report: UsageReport = { claude, codex, updatedAt: Date.now() }
  cache = { at: Date.now(), report }
  return report
}
