import { existsSync, promises as fs, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileEntry, NoteSummary } from '@shared/types'
import { store } from './store'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db'])
const MAX_READ_BYTES = 5 * 1024 * 1024

/** Carpeta donde se crean los worktrees de un workspace (al lado del repositorio, no dentro). */
export function worktreesRoot(root: string): string {
  return resolve(dirname(root), `${resolve(root).split(sep).pop()}-worktrees`)
}

function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Solo se permite tocar archivos dentro de un workspace abierto o de sus worktrees. */
export function assertAllowed(target: string): string {
  const abs = resolve(String(target))
  const roots = store
    .getWorkspaces()
    .flatMap((w) => [resolve(w.root), worktreesRoot(w.root)])
    .flatMap((r) => [r, real(r)])
  const inside = (p: string) =>
    roots.some((root) => {
      const rel = relative(root, p)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
  if (!inside(abs)) throw new Error(`Ruta fuera de los workspaces abiertos: ${abs}`)
  // Un enlace simbólico o junction dentro del proyecto no debe dar acceso a otra carpeta.
  const resolvedReal = existsSync(abs) ? real(abs) : join(real(dirname(abs)), basename(abs))
  if (!inside(resolvedReal)) throw new Error(`La ruta apunta fuera del workspace: ${abs}`)
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

/** Título (primera línea con texto) y fecha de edición de varias notas, para el menú Extras. */
export async function noteSummaries(refs: { wsId: string; panelId: string }[]): Promise<NoteSummary[]> {
  const out: NoteSummary[] = []
  for (const { wsId, panelId } of refs) {
    if (typeof wsId !== 'string' || typeof panelId !== 'string') continue
    const file = join(store.notesDir(wsId), `${safeName(panelId)}.md`)
    try {
      const [stat, content] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8')])
      const line = content.split(/\r?\n/).find((l) => l.trim()) ?? ''
      const title = line.replace(/^[#>*\-\s]+|\[[ x]\]\s*/gi, '').replace(/[*_`]/g, '').trim()
      out.push({ wsId, panelId, title, updatedAt: stat.mtimeMs })
    } catch {
      // Nota aún sin guardar.
    }
  }
  return out
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '')
}
