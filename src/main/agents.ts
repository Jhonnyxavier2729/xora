import { AGENTS, type AgentId, type AgentVersionInfo } from '@shared/types'
import { resolveCli, runCli } from './cli'

/** Paquete npm de cada agente, para comparar con la última versión publicada. */
const NPM_PACKAGES: Partial<Record<AgentId, string>> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai'
}

let cache: { at: number; value: Record<AgentId, boolean> } | null = null

/** Qué CLIs de agentes están en el PATH. Se cachea un minuto. */
export async function detectAgents(force = false): Promise<Record<AgentId, boolean>> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value
  const entries = await Promise.all(AGENTS.map(async (a) => [a.id, !!(await resolveCli(a.command))] as const))
  const value = { custom: true, ...Object.fromEntries(entries) } as Record<AgentId, boolean>
  cache = { at: Date.now(), value }
  return value
}

export async function hasCloudflared(): Promise<boolean> {
  return !!(await resolveCli('cloudflared'))
}

const semver = (text: string) => text.match(/\d+\.\d+\.\d+(?:[-.][\w.]+)?/)?.[0] ?? null

async function latestOnNpm(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    return ((await res.json()) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

/** Versión instalada de cada agente y la última publicada en npm (si aplica). */
export async function agentVersions(): Promise<AgentVersionInfo[]> {
  return Promise.all(
    AGENTS.map(async (a): Promise<AgentVersionInfo> => {
      const pkg = NPM_PACKAGES[a.id]
      const [installed, latest] = await Promise.all([
        resolveCli(a.command).then(async (cli) => {
          if (!cli) return null
          try {
            const { stdout, stderr } = await runCli(a.command, ['--version'], { timeoutMs: 10_000 })
            return semver(stdout + stderr)
          } catch {
            return null
          }
        }),
        pkg ? latestOnNpm(pkg) : Promise.resolve(null)
      ])
      return { id: a.id, installed, latest, updateCommand: pkg ? `npm install -g ${pkg}@latest` : null }
    })
  )
}
