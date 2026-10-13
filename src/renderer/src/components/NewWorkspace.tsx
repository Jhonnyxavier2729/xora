import { useEffect, useMemo, useState } from 'react'
import type { GithubRepo, RecentProject, Workspace } from '@shared/types'
import { useApp } from '../state'
import { errMsg, timeAgo } from '../utils'
import { IconBack, IconClose, IconFolder, IconForward, IconGit } from './Icons'

type View = 'home' | 'github' | 'url'

function openRoot(root: string, name: string): void {
  const app = useApp.getState()
  const id = app.addWorkspace(root, name)
  app.openWorkspace(id)
  app.setNewWorkspaceOpen(false)
  void window.api.workspaces.touch(root)
}

const IconLink = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
)

function Option({ icon, title, sub, onClick }: { icon: JSX.Element; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="nw-option" onClick={onClick}>
      <span className="nw-icon">{icon}</span>
      <span className="grow">
        <strong>{title}</strong>
        <span className="muted">{sub}</span>
      </span>
      <IconForward size={14} />
    </button>
  )
}

export function NewWorkspaceModal() {
  const open = useApp((s) => s.newWorkspaceOpen)
  const [view, setView] = useState<View>('home')
  const [recents, setRecents] = useState<RecentProject[] | null>(null)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [repoFilter, setRepoFilter] = useState('')
  const [url, setUrl] = useState('')
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const close = () => useApp.getState().setNewWorkspaceOpen(false)

  useEffect(() => {
    if (!open) return
    setView('home')
    setError(null)
    setBusy(null)
    void window.api.workspaces.recents().then(setRecents)
    void window.api.workspaces.defaultCloneDir().then(setDest)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase()
    return (repos ?? []).filter((r) => !q || r.nameWithOwner.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
  }, [repos, repoFilter])

  if (!open) return null

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  const openFolder = () =>
    run('Abriendo…', async () => {
      const picked = await window.api.workspaces.pickFolder()
      if (picked) openRoot(picked.root, picked.name)
    })

  const clone = (repoUrl: string) =>
    run(`Clonando ${repoUrl}…`, async () => {
      const res = await window.api.workspaces.clone(repoUrl, dest || undefined)
      openRoot(res.root, res.name)
      useApp.getState().toast(`Clonado en ${res.root}`)
    })

  const showGithub = () => {
    setView('github')
    if (!repos)
      void run('Cargando tus repositorios…', async () => {
        setRepos(await window.api.workspaces.githubRepos())
      })
  }

  const blank = () =>
    run('Creando…', async () => {
      const res = await window.api.workspaces.blank()
      openRoot(res.root, res.name)
    })

  const importCanvas = () =>
    run('Importando…', async () => {
      const ws = await window.api.workspaces.importCanvas()
      if (!ws) return
      const app = useApp.getState()
      const imported: Workspace = { ...ws, id: Math.random().toString(36).slice(2, 10), updatedAt: Date.now() }
      app.importWorkspace(imported)
      app.openWorkspace(imported.id)
      app.setNewWorkspaceOpen(false)
    })

  const destRow = (
    <div className="nw-dest">
      <span className="muted">Se clonará en</span>
      <code title={dest}>{dest}</code>
      <button
        className="link"
        onClick={async () => {
          const d = await window.api.workspaces.pickCloneDir()
          if (d) setDest(d)
        }}
      >
        Cambiar
      </button>
    </div>
  )

  return (
    <div className="modal-backdrop nw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="nw glass">
        <div className="nw-head">
          <div>
            {view !== 'home' && (
              <button className="link nw-back" onClick={() => setView('home')}>
                <IconBack size={14} /> Volver
              </button>
            )}
            <h2>{view === 'github' ? 'Clonar desde GitHub' : view === 'url' ? 'Clonar desde una URL' : 'Nuevo workspace'}</h2>
            <p className="muted">
              {view === 'home' ? 'Elige una carpeta o clona un repositorio para empezar.' : 'El repositorio se abrirá como un espacio nuevo.'}
            </p>
          </div>
          <div className="nw-on">
            <span className="muted">En</span>
            <span className="chip-local">local</span>
            <button className="icon-btn" onClick={close} title="Cerrar">
              <IconClose />
            </button>
          </div>
        </div>

        {view === 'home' && (
          <div className="nw-cols">
            <div>
              <div className="nw-label">Abrir un proyecto</div>
              <Option icon={<IconFolder />} title="Abrir una carpeta" sub="Elige un proyecto de este ordenador" onClick={() => void openFolder()} />
              <Option icon={<IconGit />} title="Clonar desde GitHub" sub="Explora tus repositorios" onClick={showGithub} />
              <Option icon={<IconLink />} title="Clonar desde una URL" sub="Pega el enlace de un repositorio" onClick={() => setView('url')} />
            </div>
            <div>
              <div className="nw-label">Proyectos recientes</div>
              {recents === null && <div className="muted nw-empty">Cargando…</div>}
              {recents?.length === 0 && <div className="muted nw-empty">Todavía no has abierto ningún proyecto.</div>}
              <div className="nw-recents">
                {recents?.map((r) => (
                  <div key={r.path} className={`nw-recent ${r.exists ? '' : 'missing'}`}>
                    <button className="nw-recent-main" disabled={!r.exists} onClick={() => openRoot(r.path, r.name)} title={r.path}>
                      <IconFolder size={15} />
                      <span className="grow">
                        <span className="nw-path">{r.path}</span>
                        <span className="muted small">{r.exists ? timeAgo(r.openedAt) : 'ya no existe'}</span>
                      </span>
                      {r.branch && <span className="nw-branch">⎇ {r.branch}</span>}
                    </button>
                    <button
                      className="icon-btn small"
                      title="Quitar de recientes"
                      onClick={async () => {
                        await window.api.workspaces.forgetRecent(r.path)
                        setRecents((list) => list?.filter((x) => x.path !== r.path) ?? null)
                      }}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'github' && (
          <div className="nw-github">
            <input autoFocus placeholder="Buscar en tus repositorios…" value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} />
            <div className="nw-repos">
              {filteredRepos.map((r) => (
                <button key={r.url} className="nw-repo" disabled={!!busy} onClick={() => void clone(r.url)}>
                  <span className="grow">
                    <strong>{r.nameWithOwner}</strong>
                    {r.isPrivate && <span className="pill-tag">privado</span>}
                    <span className="muted small nw-desc">{r.description || 'Sin descripción'}</span>
                  </span>
                  <span className="muted small">{timeAgo(new Date(r.updatedAt).getTime())}</span>
                </button>
              ))}
              {repos && filteredRepos.length === 0 && <div className="muted nw-empty">Ningún repositorio coincide.</div>}
            </div>
            {destRow}
          </div>
        )}

        {view === 'url' && (
          <div className="nw-url">
            <input
              autoFocus
              placeholder="https://github.com/usuario/repositorio.git  ·  git@…  ·  usuario/repositorio"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && void clone(url.trim())}
            />
            {destRow}
            <button className="btn primary" disabled={!url.trim() || !!busy} onClick={() => void clone(url.trim())}>
              Clonar y abrir
            </button>
          </div>
        )}

        {(busy || error) && <div className={`nw-status ${error ? 'error' : ''}`}>{error ?? busy}</div>}

        <div className="nw-foot">
          <button className="link-plain" onClick={() => void blank()}>
            Empezar un lienzo en blanco →
          </button>
          <span className="nw-foot-item">
            Añadir un panel <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>E</kbd>
          </span>
          <button className="link-plain" onClick={() => void importCanvas()}>
            ⇪ Importar lienzo
          </button>
          <button
            className="link-plain right"
            onClick={() => {
              close()
              useApp.getState().openSettings('help')
            }}
          >
            Ayuda
          </button>
        </div>
      </div>
    </div>
  )
}
