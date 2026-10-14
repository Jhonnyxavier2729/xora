import { useCallback, useEffect, useMemo, useState } from 'react'
import { AGENTS, type AgentId, type GitStatus, type Panel, type Worktree } from '@shared/types'
import { useApp } from '../state'
import { errMsg } from '../utils'

interface DiffLine {
  text: string
  kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'
  newLine: number | null
}

function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let newLine = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('@@')) {
      const m = /\+(\d+)/.exec(text)
      newLine = m ? Number(m[1]) : 0
      out.push({ text, kind: 'hunk', newLine: null })
    } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(text)) {
      out.push({ text, kind: 'meta', newLine: null })
    } else if (text.startsWith('+')) {
      out.push({ text, kind: 'add', newLine: newLine++ })
    } else if (text.startsWith('-')) {
      out.push({ text, kind: 'del', newLine: null })
    } else {
      out.push({ text, kind: 'ctx', newLine: text === '' ? null : newLine++ })
    }
  }
  return out
}

export function GitPanel({ wsId, wsRoot, panel }: { wsId: string; wsRoot: string; panel: Panel }) {
  const [cwd, setCwd] = useState(panel.cwd ?? wsRoot)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [commentAt, setCommentAt] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [target, setTarget] = useState<string>('')
  const [newBranch, setNewBranch] = useState('')
  const [newAgent, setNewAgent] = useState<AgentId>('claude')
  const ws = useApp((s) => s.workspaces.find((w) => w.id === wsId))
  const agentPanels = useMemo(() => ws?.panels.filter((p) => p.type === 'agent') ?? [], [ws])

  const toast = useApp.getState().toast

  const refresh = useCallback(async (withWorktrees = true) => {
    try {
      const s = await window.api.git.status(cwd)
      setStatus(s)
      if (s.isRepo && withWorktrees) setWorktrees(await window.api.git.worktrees(wsRoot).catch(() => []))
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }, [cwd, wsRoot, toast])

  const refreshSeconds = useApp((s) => s.settings?.gitRefreshSeconds ?? 5)
  useEffect(() => {
    void refresh()
    let ticks = 0
    // Con Xora minimizada o en segundo plano no se lanza ningún proceso de git; la lista de worktrees
    // (que casi no cambia) se pide una de cada diez veces.
    const t = setInterval(() => {
      if (document.hidden || !document.hasFocus()) return
      ticks++
      void refresh(ticks % 10 === 0)
    }, refreshSeconds * 1000)
    const onFocus = (): void => void refresh(false)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshSeconds])

  useEffect(() => {
    if (!file) return setDiff('')
    window.api.git.diff(cwd, file).then(setDiff, (err) => setDiff(errMsg(err)))
  }, [file, cwd, status])

  // Por defecto, comentar al agente que trabaja en esta misma carpeta.
  useEffect(() => {
    if (target && agentPanels.some((p) => p.id === target)) return
    const sameDir = agentPanels.find((p) => p.cwd === cwd)
    setTarget(sameDir?.id ?? agentPanels[0]?.id ?? '')
  }, [agentPanels, cwd, target])

  const lines = useMemo(() => parseDiff(diff), [diff])

  async function commit() {
    if (!message.trim()) return
    setBusy(true)
    try {
      const hash = await window.api.git.commit(cwd, message.trim())
      toast(`Commit ${hash.slice(0, 7)} creado`)
      setMessage('')
      setFile(null)
      await refresh()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function discard(path: string) {
    if (!confirm(`¿Descartar los cambios de ${path}? No se puede deshacer.`)) return
    try {
      await window.api.git.discard(cwd, path)
      if (file === path) setFile(null)
      await refresh()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  async function sendComment(line: DiffLine) {
    if (!comment.trim() || !target || !file) return
    const where = line.newLine ? `${file}:${line.newLine}` : file
    const text = `Comentario de revisión en ${where}\n> ${line.text}\n${comment.trim()}`
    const ok = await window.api.pty.submit(target, text)
    if (!ok) return toast('Ese agente no tiene una terminal activa', 'error')
    toast('Comentario enviado al agente')
    setComment('')
    setCommentAt(null)
  }

  async function createTask() {
    const branch = newBranch.trim()
    if (!branch) return
    setBusy(true)
    try {
      const wt = await window.api.git.createWorktree(wsRoot, branch)
      useApp.getState().addPanel(wsId, { type: 'agent', agent: newAgent, cwd: wt.path, worktreeBranch: wt.branch })
      setNewBranch('')
      setCwd(wt.path)
      toast(`Worktree «${wt.branch}» creado con su agente`)
      await refresh()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function removeWorktree(wt: Worktree) {
    if (!confirm(`¿Eliminar el worktree ${wt.branch}? La rama se conserva.`)) return
    try {
      await window.api.git.removeWorktree(wsRoot, wt.path, false).catch(async (err) => {
        if (confirm(`${errMsg(err)}\n\n¿Forzar la eliminación (se pierden los cambios sin commit)?`)) {
          await window.api.git.removeWorktree(wsRoot, wt.path, true)
        } else throw err
      })
      if (cwd === wt.path) setCwd(wsRoot)
      await refresh()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  if (status && !status.isRepo) {
    return <div className="empty center">Esta carpeta no es un repositorio git.</div>
  }

  return (
    <div className="git-panel">
      <div className="git-bar">
        <select value={cwd} onChange={(e) => (setCwd(e.target.value), setFile(null))} title="Carpeta / worktree">
          {(worktrees.length ? worktrees : [{ path: wsRoot, branch: status?.branch ?? '', head: '', main: true }]).map((w) => (
            <option key={w.path} value={w.path}>
              {w.main ? 'principal' : 'worktree'} · {w.branch}
            </option>
          ))}
        </select>
        {status && (
          <span className="muted">
            ⎇ {status.branch}
            {status.ahead > 0 && ` ↑${status.ahead}`}
            {status.behind > 0 && ` ↓${status.behind}`}
          </span>
        )}
        <button className="icon-btn small" title="Actualizar" onClick={() => void refresh()}>
          ↻
        </button>
      </div>

      <div className="git-body">
        <div className="git-files">
          {status?.files.length === 0 && <div className="empty">Sin cambios.</div>}
          {status?.files.map((f) => (
            <div key={f.path} className={`git-file ${file === f.path ? 'selected' : ''}`} onClick={() => setFile(f.path)}>
              <span className={`git-code code-${(f.workingDir.trim() || f.index.trim() || '?').replace('?', 'U')}`}>
                {(f.workingDir.trim() || f.index.trim() || '?').replace('?', 'U')}
              </span>
              <span className="git-path" title={f.path}>
                {f.path}
              </span>
              <button
                className="icon-btn small danger"
                title="Descartar cambios"
                onClick={(e) => {
                  e.stopPropagation()
                  void discard(f.path)
                }}
              >
                ⟲
              </button>
            </div>
          ))}
        </div>

        <div className="git-diff">
          {!file && <div className="empty center">Elige un archivo para ver el diff. Haz clic en una línea para comentarla a un agente.</div>}
          {file &&
            lines.map((l, i) => (
              <div key={i}>
                <div
                  className={`diff-line ${l.kind}`}
                  onClick={() => (l.kind === 'add' || l.kind === 'ctx' || l.kind === 'del') && setCommentAt(commentAt === i ? null : i)}
                >
                  <span className="ln">{l.newLine ?? ''}</span>
                  <span className="code">{l.text || ' '}</span>
                </div>
                {commentAt === i && (
                  <div className="diff-comment">
                    <textarea
                      autoFocus
                      value={comment}
                      placeholder="¿Qué debería cambiar el agente aquí?"
                      onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void sendComment(l)
                      }}
                    />
                    <div className="row">
                      <select value={target} onChange={(e) => setTarget(e.target.value)}>
                        {agentPanels.length === 0 && <option value="">(no hay agentes)</option>}
                        {agentPanels.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                      <button className="btn small primary" disabled={!target || !comment.trim()} onClick={() => void sendComment(l)}>
                        Enviar al agente
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      <div className="git-footer">
        <input
          value={message}
          placeholder="Mensaje del commit (incluye todos los cambios)"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void commit()}
        />
        <button className="btn small primary" disabled={busy || !message.trim() || !status?.files.length} onClick={() => void commit()}>
          Commit
        </button>
      </div>

      <details className="git-worktrees">
        <summary>Tareas aisladas (worktrees)</summary>
        <div className="row">
          <input value={newBranch} placeholder="rama-nueva, p. ej. feature/login" onChange={(e) => setNewBranch(e.target.value)} />
          <select value={newAgent} onChange={(e) => setNewAgent(e.target.value as AgentId)}>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn small primary" disabled={busy || !newBranch.trim()} onClick={() => void createTask()}>
            Crear tarea
          </button>
        </div>
        {worktrees
          .filter((w) => !w.main)
          .map((w) => (
            <div key={w.path} className="wt-row">
              <span>⎇ {w.branch}</span>
              <span className="muted git-path" title={w.path}>
                {w.path}
              </span>
              <button className="btn small danger" onClick={() => void removeWorktree(w)}>
                Eliminar
              </button>
            </div>
          ))}
      </details>
    </div>
  )
}
