import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import type { GitStatus, Worktree } from '@shared/types'
import { assertAllowed, worktreesRoot } from './files'

const git = (cwd: string) => simpleGit({ baseDir: assertAllowed(cwd), maxConcurrentProcesses: 4 })

export async function status(cwd: string): Promise<GitStatus> {
  const g = git(cwd)
  if (!(await g.checkIsRepo().catch(() => false))) {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] }
  }
  const s = await g.status()
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
  await g.add(files && files.length ? files : ['-A'])
  const res = await g.commit(message)
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

/** Crea un worktree con rama nueva al lado del repositorio: <repo>-worktrees/<rama>. */
export async function createWorktree(root: string, branch: string): Promise<Worktree> {
  const clean = branch.trim().replace(/[^a-zA-Z0-9._/-]/g, '-').replace(/^-+|-+$/g, '')
  if (!clean) throw new Error('Nombre de rama no válido')
  const base = worktreesRoot(root)
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  const path = join(base, clean.replace(/\//g, '-'))
  if (existsSync(path)) throw new Error(`Ya existe ${path}`)
  await git(root).raw(['worktree', 'add', '-b', clean, path])
  const head = (await simpleGit(path).revparse(['HEAD'])).trim()
  return { path, branch: clean, head, main: false }
}

export async function removeWorktree(root: string, path: string, force: boolean): Promise<void> {
  const args = ['worktree', 'remove', path]
  if (force) args.push('--force')
  await git(root).raw(args)
}
