import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@shared/types'
import { store } from './store'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db'])
const MAX_READ_BYTES = 5 * 1024 * 1024

/** Carpeta donde se crean los worktrees de un workspace (al lado del repositorio, no dentro). */
export function worktreesRoot(root: string): string {
  return resolve(dirname(root), `${resolve(root).split(sep).pop()}-worktrees`)
}

/** Solo se permite tocar archivos dentro de un workspace abierto o de sus worktrees. */
export function assertAllowed(target: string): string {
  const abs = resolve(target)
  const roots = store.getWorkspaces().flatMap((w) => [resolve(w.root), worktreesRoot(w.root)])
  const ok = roots.some((root) => {
    const rel = relative(root, abs)
    return rel === '' || (!rel.startsWith('..') && !rel.includes(':'))
  })
  if (!ok) throw new Error(`Ruta fuera de los workspaces abiertos: ${abs}`)
  return abs
}

export async function listDir(dir: string): Promise<FileEntry[]> {
  const abs = assertAllowed(dir)
  const entries = await fs.readdir(abs, { withFileTypes: true })
  return entries
    .filter((e) => !HIDDEN.has(e.name))
    .map((e) => ({ name: e.name, path: join(abs, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export async function readFile(path: string): Promise<string> {
  const abs = assertAllowed(path)
  const stat = await fs.stat(abs)
  if (stat.size > MAX_READ_BYTES) throw new Error('Archivo demasiado grande para el editor (>5 MB)')
  return fs.readFile(abs, 'utf8')
}

export async function writeFile(path: string, content: string): Promise<void> {
  const abs = assertAllowed(path)
  await fs.writeFile(abs, content, 'utf8')
}

export async function readNote(workspaceId: string, panelId: string): Promise<string> {
  try {
    return await fs.readFile(join(store.notesDir(workspaceId), `${safeName(panelId)}.md`), 'utf8')
  } catch {
    return ''
  }
}

export async function writeNote(workspaceId: string, panelId: string, content: string): Promise<void> {
  await fs.writeFile(join(store.notesDir(workspaceId), `${safeName(panelId)}.md`), content, 'utf8')
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '')
}
