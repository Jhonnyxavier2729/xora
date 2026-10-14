import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ResolvedCli {
  file: string
  /** Argumentos previos (p. ej. el script .js cuando el CLI es un paquete de Node). */
  prefix: string[]
}

const cache = new Map<string, ResolvedCli | null>()

function where(name: string): Promise<string[]> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [name], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      resolve(err ? [] : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    )
  })
}

/**
 * En Windows los CLI de npm son envoltorios .cmd, que Node no puede lanzar sin shell (y la shell
 * rompe los argumentos con comillas, como un JSON Schema). Se lee el .cmd para encontrar el
 * ejecutable o el script real y lanzarlo directamente.
 */
function parseCmdShim(cmdPath: string, nodePath: string | null): ResolvedCli | null {
  const dir = dirname(cmdPath)
  const text = readFileSync(cmdPath, 'utf8')
  const line = text
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.includes('%dp0%') && l.includes('%*'))
  if (!line) return null
  const tokens = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/%dp0%\\?/gi, dir + '\\'))
  if (!tokens.length) return null
  if (/%_prog%|node(\.exe)?$/i.test(tokens[0])) {
    const node = existsSync(join(dir, 'node.exe')) ? join(dir, 'node.exe') : nodePath
    if (!node) return null
    return { file: node, prefix: tokens.slice(1) }
  }
  return existsSync(tokens[0]) ? { file: tokens[0], prefix: tokens.slice(1) } : null
}

/** npm.cmd tiene otro formato que el resto de CLIs: se lanza su script (npm-cli.js) directamente con Node. */
async function resolveNpmOnWindows(hits: string[]): Promise<ResolvedCli | null> {
  const cmd = hits.find((h) => /\.cmd$/i.test(h))
  if (!cmd) return null
  const dir = dirname(cmd)
  const script = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const node = existsSync(join(dir, 'node.exe')) ? join(dir, 'node.exe') : (await where('node')).find((h) => /\.exe$/i.test(h))
  return node && existsSync(script) ? { file: node, prefix: [script] } : null
}

export async function resolveCli(name: string): Promise<ResolvedCli | null> {
  if (cache.has(name)) return cache.get(name)!
  const hits = await where(name)
  if (name === 'npm' && process.platform === 'win32') {
    const npm = await resolveNpmOnWindows(hits)
    cache.set(name, npm)
    return npm
  }
  let resolved: ResolvedCli | null = null
  const exe = hits.find((h) => /\.exe$/i.test(h))
  if (process.platform !== 'win32' && hits[0]) resolved = { file: hits[0], prefix: [] }
  else if (exe) resolved = { file: exe, prefix: [] }
  else {
    const cmd = hits.find((h) => /\.cmd$/i.test(h))
    if (cmd) resolved = parseCmdShim(cmd, (await where('node')).find((h) => /\.exe$/i.test(h)) ?? null)
  }
  // El .cmd suele delegar en un .exe mejor que cualquier otro acierto de where.
  const cmd = hits.find((h) => /\.cmd$/i.test(h))
  if (cmd && process.platform === 'win32') {
    const viaShim = parseCmdShim(cmd, null)
    if (viaShim) resolved = viaShim
  }
  cache.set(name, resolved)
  return resolved
}

export function forgetCli(name?: string): void {
  if (name) cache.delete(name)
  else cache.clear()
}

/** Ejecuta un CLI con stdin opcional y tiempo límite; devuelve stdout. */
export async function runCli(
  name: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; cwd?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cli = await resolveCli(name)
  if (!cli) throw new Error(`No se encontró «${name}» en el PATH`)
  return new Promise((resolve, reject) => {
    const proc = spawn(cli.file, [...cli.prefix, ...args], { windowsHide: true, cwd: opts.cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`«${name}» no respondió en ${Math.round((opts.timeoutMs ?? 60000) / 1000)} s`))
    }, opts.timeoutMs ?? 60000)
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    if (opts.input !== undefined) proc.stdin.end(opts.input)
    else proc.stdin.end()
  })
}
