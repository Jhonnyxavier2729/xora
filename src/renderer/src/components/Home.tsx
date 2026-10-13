import { useState } from 'react'
import { findPanel, useApp } from '../state'
import { timeAgo } from '../utils'
import { IconClose, IconFolder, PanelIcon } from './Icons'

export function Home() {
  const workspaces = useApp((s) => s.workspaces)
  const ptys = useApp((s) => s.ptys)
  const remote = useApp((s) => s.remote)
  const [renaming, setRenaming] = useState<string | null>(null)

  const agentPtys = Object.values(ptys).filter((p) => p.kind === 'agent' && p.status !== 'exited' && findPanel(p.id))
  const working = agentPtys.filter((p) => p.status === 'working').length
  const waitingList = agentPtys.filter((p) => p.status === 'waiting')
  const openPanels = workspaces.reduce((n, w) => n + w.panels.length, 0)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'

  function jump(panelId: string) {
    const found = findPanel(panelId)
    if (!found) return
    useApp.getState().openWorkspace(found.ws.id)
    useApp.getState().reveal(panelId)
  }

  return (
    <div className="home">
      <main className="home-main">
        <h1 className="home-greeting">{greeting}</h1>

        <section className="stats">
          <div className="glass stat">
            <div className="stat-value">{working}</div>
            <div className="stat-label">agentes trabajando</div>
          </div>
          <div className={`glass stat ${waitingList.length ? 'stat-attention' : ''}`}>
            <div className="stat-value">{waitingList.length}</div>
            <div className="stat-label">esperándote</div>
          </div>
          <div className="glass stat">
            <div className="stat-value">{openPanels}</div>
            <div className="stat-label">paneles abiertos</div>
          </div>
          <button className="glass stat stat-button" onClick={() => useApp.getState().openSettings('remote')}>
            <div className="stat-value small">{remote?.enabled ? `${remote.devices.length}` : '—'}</div>
            <div className="stat-label">{remote?.enabled ? 'dispositivos emparejados' : 'acceso móvil apagado'}</div>
          </button>
        </section>

        {waitingList.length > 0 && (
          <section className="glass card">
            <h2>Te esperan</h2>
            <ul className="attention-list">
              {waitingList.map((p) => (
                <li key={p.id}>
                  <button onClick={() => jump(p.id)}>
                    <span className={`dot dot-${p.needsApproval ? 'approval' : 'waiting'}`} />
                    <strong>{p.title}</strong>
                    <span className="muted">{findPanel(p.id)?.ws.name}</span>
                    <span className="muted right">{p.needsApproval ? 'pide aprobación' : timeAgo(p.lastOutputAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="glass card">
          <div className="card-head">
            <h2>Espacios de trabajo</h2>
            <button className="btn primary" onClick={() => useApp.getState().setNewWorkspaceOpen(true)}>
              <IconFolder /> Nuevo workspace
            </button>
          </div>
          {workspaces.length === 0 ? (
            <div className="empty">
              <p>Abre una carpeta de proyecto para empezar. Cada carpeta es un lienzo con sus terminales, agentes, editor, navegador, notas y git.</p>
            </div>
          ) : (
            <div className="ws-grid">
              {[...workspaces]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((ws) => {
                  const wsAgents = ws.panels.filter((p) => p.type === 'agent')
                  const busy = wsAgents.filter((p) => ptys[p.id]?.status === 'working').length
                  const waiting = wsAgents.filter((p) => ptys[p.id]?.status === 'waiting').length
                  return (
                    <div key={ws.id} className="ws-card" onClick={() => useApp.getState().openWorkspace(ws.id)}>
                      <div className="ws-card-head">
                        {renaming === ws.id ? (
                          <input
                            autoFocus
                            defaultValue={ws.name}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              useApp.getState().renameWorkspace(ws.id, e.target.value.trim() || ws.name)
                              setRenaming(null)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        ) : (
                          <strong
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setRenaming(ws.id)
                            }}
                          >
                            {ws.name}
                          </strong>
                        )}
                        <button
                          className="icon-btn small"
                          title="Quitar espacio (no borra archivos)"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`¿Quitar «${ws.name}» de la lista? Se cerrarán sus terminales. Los archivos no se tocan.`)) {
                              useApp.getState().removeWorkspace(ws.id)
                            }
                          }}
                        >
                          <IconClose size={14} />
                        </button>
                      </div>
                      <div className="ws-root">{ws.root}</div>
                      <div className="ws-meta">
                        <span className="panel-icons">
                          {ws.panels.slice(0, 8).map((p) => (
                            <span key={p.id} className={`mini-icon ${ptys[p.id]?.status ?? ''}`}>
                              <PanelIcon type={p.type} size={13} />
                            </span>
                          ))}
                        </span>
                        <span className="muted right">
                          {busy > 0 && <span className="pill-tag working">{busy} trabajando</span>}
                          {waiting > 0 && <span className="pill-tag waiting">{waiting} esperando</span>}
                          {busy === 0 && waiting === 0 && timeAgo(ws.updatedAt)}
                        </span>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
