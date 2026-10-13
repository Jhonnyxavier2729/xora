import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { simpleGit } from 'simple-git'
import type { GithubRepo, RecentProject, Workspace } from '@shared/types'
import { runCli } from './cli'
import { store } from './store'

const CANVAS_FORMAT = 'xora-canvas'

export function defaultCloneDir(): string {
  return store.getSettings().cloneDir || join(app.getPath('documents'), 'Xora')
}

async function branchOf(path: string): Promise<string | null> {
  try {
    const g = simpleGit({ baseDir: path, timeout: { block: 3000 } })
    if (!(await g.checkIsRepo())) return null
    return (await g.revparse(['--abbrev-ref', 'HEAD'])).trim() || null
  } catch {
    return null
  }
}

export async function recentProjects(): Promise<RecentProject[]> {
  const list = store.getRecents().slice(0, 12)
  return Promise.all(
    list.map(async (r) => {
      const exists = existsSync(r.path)
      return { path: r.path, name: r.name, openedAt: r.openedAt, exists, branch: exists ? await branchOf(r.path) : null }
    })
  )
}

export async function githubRepos(): Promise<GithubRepo[]> {
  const { code, stdout, stderr } = await runCli(
    'gh',
    ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,url,description,isPrivate,updatedAt'],
    { timeoutMs: 30_000 }
  )
  if (code !== 0) {
    if (/auth|login/i.test(stderr)) throw new Error('GitHub CLI no tiene sesión. Ejecuta «gh auth login» en una terminal.')
    throw new Error(stderr.trim().slice(0, 200) || 'No se pudo listar tus repositorios')
  }
  const repos = JSON.parse(stdout) as GithubRepo[]
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Clona un repositorio en <carpeta>/<nombre> y devuelve la carpeta creada. */
export async function cloneRepo(url: string, parentDir?: string): Promise<{ root: string; name: string }> {
  const clean = url.trim()
  if (!/^(https:\/\/|git@|ssh:\/\/)[\w.@:/~-]+$/.test(clean) && !/^[\w.-]+\/[\w.-]+$/.test(clean)) {
    throw new Error('Esa dirección no parece un repositorio (usa https://…, git@… o usuario/repositorio)')
  }
  // «usuario/repo» se interpreta como GitHub.
  const full = /^[\w.-]+\/[\w.-]+$/.test(clean) ? `https://github.com/${clean}.git` : clean
  const name = basename(full).replace(/\.git$/, '')
  const parent = parentDir || defaultCloneDir()
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  let target = join(parent, name)
  for (let i = 2; existsSync(target); i++) target = join(parent, `${name}-${i}`)
  await simpleGit({ baseDir: parent }).clone(full, target)
  return { root: target, name: basename(target) }
}

export function blankCanvasFolder(): { root: string; name: string } {
  const parent = join(defaultCloneDir(), 'Lienzos')
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')
  let root = join(parent, `Lienzo ${stamp}`)
  for (let i = 2; existsSync(root); i++) root = join(parent, `Lienzo ${stamp} (${i})`)
  mkdirSync(root, { recursive: true })
  return { root, name: basename(root) }
}

export async function pickFolder(win: BrowserWindow, title: string, defaultPath?: string): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

export async function exportCanvas(win: BrowserWindow, workspace: Workspace): Promise<boolean> {
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportar lienzo',
    defaultPath: `${workspace.name}.xora.json`,
    filters: [{ name: 'Lienzo de Xora', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return false
  writeFileSync(res.filePath, JSON.stringify({ format: CANVAS_FORMAT, version: 1, workspace }, null, 2), 'utf8')
  return true
}

export async function importCanvas(win: BrowserWindow): Promise<Workspace | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Importar lienzo',
    properties: ['openFile'],
    filters: [{ name: 'Lienzo de Xora', extensions: ['json'] }]
  })
  const file = res.filePaths[0]
  if (res.canceled || !file) return null
  const data = JSON.parse(readFileSync(file, 'utf8')) as { format?: string; workspace?: Workspace }
  if (data.format !== CANVAS_FORMAT || !data.workspace || !Array.isArray(data.workspace.panels)) {
    throw new Error('Ese archivo no es un lienzo exportado por Xora')
  }
  const ws = data.workspace
  // Si la carpeta original no existe en este equipo, el lienzo se abre en una carpeta nueva.
  if (!existsSync(ws.root)) {
    const blank = blankCanvasFolder()
    ws.root = blank.root
    ws.panels = ws.panels.map((p) => ({ ...p, cwd: blank.root }))
  }
  return ws
}
