import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'
import type { GitStatus, Worktree } from '@shared/types'
import { assertAllowed, worktreesRoot } from './files'

// Sin .env() personalizado: simple-git se niega a trabajar si el entorno del usuario trae variables como GIT_EDITOR.
const git = (cwd: string) => simpleGit({ baseDir: assertAllowed(cwd), maxConcurrentProcesses: 2 })

export async function status(cwd: string): Promise<GitStatus> {
  const g = git(cwd)
  // Una sola llamada a git (antes eran dos: comprobar el repo y pedir el estado).
  let s: Awaited<ReturnType<typeof g.status>>
  try {
    s = await g.status()
  } catch (err) {
    if (/not a git repository/i.test((err as Error).message)) return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] }
    throw err
  }
  return {
    isRepo: true,
    branch: s.current ?? '(detached)',
    ahead: s.ahead,
    behind: s.behind,
    files: s.files.map((f) => ({ path: f.path, index: f.index, workingDir: f.working_dir }))
  }
}

/** Diff de un archivo (o de todo) contra HEAD, incluyendo archivos nuevos sin seguimiento. */
export async function diff(cwd: string, file?: string): Promise<string> {
  const g = git(cwd)
  const args = ['--no-color', 'HEAD']
  if (file) args.push('--', file)
  let out = await g.diff(args).catch(() => '')
  if (file && !out) {
    const s = await g.status()
    if (s.not_added.includes(file)) {
      out = await g.raw(['diff', '--no-color', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file]).catch(
        (err: { message?: string }) => err.message ?? ''
      )
    }
  }
  return out
}

export async function commit(cwd: string, message: string, files?: string[]): Promise<string> {
  const g = git(cwd)
  // «--» evita que un nombre de archivo como «--exec=…» se interprete como opción.
  if (files && files.length) await g.raw(['add', '--', ...files.map(String)])
  else await g.raw(['add', '-A'])
  const res = await g.commit(String(message))
  return res.commit
}

export async function discard(cwd: string, file: string): Promise<void> {
  const g = git(cwd)
  const s = await g.status()
  if (s.not_added.includes(file)) await g.clean('f', ['--', file])
  else await g.checkout(['HEAD', '--', file])
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const out = await git(cwd).raw(['worktree', 'list', '--porcelain'])
  const result: Worktree[] = []
  let current: Partial<Worktree> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) result.push(current as Worktree)
      current = { path: line.slice(9).trim(), branch: '', head: '', main: result.length === 0 }
    } else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim()
    else if (line.startsWith('branch ')) current.branch = line.slice(7).trim().replace('refs/heads/', '')
    else if (line.trim() === 'detached') current.branch = '(detached)'
  }
  if (current.path) result.push(current as Worktree)
  return result
}

const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    return !!(await git(root).raw(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).trim()
  } catch {
    return false
  }
}

/**
 * Crea un worktree para una rama, al lado del repositorio: <repo>-worktrees/<rama>. Como en Deska:
 * - si ya existe, lo reutiliza tal cual lo dejaste (no falla ni toca sus cambios);
 * - si la rama ya existe (p. ej. tras borrar su worktree), la reutiliza en vez de fallar;
 * - limpia antes las entradas de worktrees cuya carpeta ya no existe.
 */
export async function createWorktree(root: string, branch: string): Promise<Worktree & { reused: boolean }> {
  const clean = branch.trim().replace(/[^a-zA-Z0-9._/-]/g, '-').replace(/^-+|-+$/g, '')
  if (!clean) throw new Error('Nombre de rama no válido')
  const base = worktreesRoot(root)
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  const path = join(base, clean.replace(/\//g, '-'))
  await git(root).raw(['worktree', 'prune']).catch(() => undefined)

  const existing = (await listWorktrees(root)).find((w) => samePath(w.path, path))
  if (existing) return { ...existing, reused: true }
  if (existsSync(path)) throw new Error(`La carpeta ${path} ya existe y no es un worktree de este repositorio.`)

  const args = (await branchExists(root, clean)) ? ['worktree', 'add', path, clean] : ['worktree', 'add', '-b', clean, path]
  try {
    await git(root).raw(args)
  } catch (err) {
    const m = (err as Error).message
    const elsewhere = m.match(/already (?:checked out|used by worktree) at '([^']+)'/i)
    if (elsewhere) throw new Error(`La rama «${clean}» ya está abierta en otro worktree: ${elsewhere[1]}`)
    throw err
  }
  const head = (await simpleGit(path).revparse(['HEAD'])).trim()
  return { path, branch: clean, head, main: false, reused: false }
}

/** Rama base para comparar: origin/HEAD, o main/master si existen. */
async function defaultBase(root: string): Promise<string | null> {
  try {
    const sym = (await git(root).raw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim()
    if (sym) return sym
  } catch {
    // Sin remoto: se prueban main y master.
  }
  for (const b of ['main', 'master']) if (await branchExists(root, b)) return b
  return null
}

export interface WorktreeInspection {
  /** Archivos con cambios sin guardar (incluidos los nuevos). */
  changed: number
  /** Commits de esta rama que aún no están en la rama base. */
  unmerged: number
  base: string | null
}

/** Qué se perdería al eliminar un worktree: cambios sin commit y commits sin fusionar (como el aviso de Deska). */
export async function inspectWorktree(root: string, path: string): Promise<WorktreeInspection> {
  const abs = resolve(String(path))
  if (!abs.startsWith(worktreesRoot(root) + sep)) throw new Error('Solo se pueden revisar los worktrees creados por Xora')
  const changed = (await git(abs).status()).files.length
  const base = await defaultBase(root)
  let unmerged = 0
  if (base) unmerged = parseInt((await git(abs).raw(['rev-list', '--count', `${base}..HEAD`]).catch(() => '0')).trim(), 10) || 0
  return { changed, unmerged, base }
}

export async function removeWorktree(root: string, path: string, force: boolean): Promise<void> {
  // Solo se eliminan worktrees creados por Xora, dentro de <repo>-worktrees.
  const abs = resolve(String(path))
  const base = worktreesRoot(root)
  if (!abs.startsWith(base + sep)) throw new Error('Solo se pueden eliminar los worktrees creados por Xora')
  const args = ['worktree', 'remove', abs]
  if (force) args.push('--force')
  try {
    await git(root).raw(args)
  } catch (err) {
    if (/contains modified or untracked files/i.test((err as Error).message)) {
      throw new Error('Tiene cambios sin guardar: se perderían al eliminarlo.')
    }
    throw err
  }
  await git(root).raw(['worktree', 'prune']).catch(() => undefined)
}
