import { useEffect, useState } from 'react'
import type { AgentUpdateItem, TaskProvider, UpdateStatus } from '@shared/types'
import { ProviderIcon } from '../panels/TaskPanel'
import { XoraMark } from './Logo'

/** Estado del actualizador, compartido por el aviso flotante y Ajustes → Acerca de. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.update.status().then(setStatus)
    return window.api.update.onStatus(setStatus)
  }, [])
  return status
}

const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

function useAgentUpdates(): AgentUpdateItem[] {
  const [items, setItems] = useState<AgentUpdateItem[]>([])
  useEffect(() => {
    void window.api.agentUpdates.get().then(setItems)
    return window.api.agentUpdates.onState(setItems)
  }, [])
  return items
}

/**
 * Centro de actualizaciones (como el «Updates» de Deska): Xora y los agentes con versión nueva.
 * Xora se descarga y pide «Reiniciar ahora»; los agentes se actualizan con npm desde el botón.
 */
export function UpdateCenter() {
  const app = useUpdateStatus()
  const agents = useAgentUpdates()
  const [collapsed, setCollapsed] = useState(false)
  // Lo que el usuario ya cerró: no vuelve a salir hasta que cambie (otra versión o otro estado).
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const rows: { key: string; node: JSX.Element }[] = []

  // Si la descarga falla, la fila no desaparece: se puede reintentar o bajar a mano desde GitHub.
  if (app && app.state === 'error' && app.version && !hidden.has(`xora:error:${app.version}`)) {
    const key = `xora:error:${app.version}`
    rows.push({
      key,
      node: (
        <div className="uc-row">
          <span className="uc-icon">
            <XoraMark size={22} />
          </span>
          <div className="uc-text">
            <strong>Xora {app.version}</strong>
            <span className="uc-error">No se pudo descargar. Puedes reintentarlo o bajarla a mano.</span>
          </div>
          <div className="uc-actions">
            <button className="btn small" onClick={() => window.api.update.download()}>
              Reintentar
            </button>
            <button className="btn small" onClick={() => window.api.update.openRelease()}>
              GitHub
            </button>
          </div>
        </div>
      )
    })
  } else if (app && (app.state === 'available' || app.state === 'downloading' || app.state === 'downloaded')) {
    const key = `xora:${app.state}:${app.version}`
    if (!hidden.has(key)) {
      rows.push({
        key,
        node: (
          <div className="uc-row">
            <span className="uc-icon">
              <XoraMark size={22} />
            </span>
            <div className="uc-text">
              <strong>Xora {app.version}</strong>
              {app.state === 'available' && <span className="muted">{app.canSelfInstall ? 'Lista para descargar' : 'Disponible en GitHub'}</span>}
              {app.state === 'downloading' && (
                <span className="uc-bar">
                  <span style={{ width: `${app.percent}%` }} />
                </span>
              )}
              {app.state === 'downloaded' && <span className="muted">Lista para instalar</span>}
            </div>
            {app.state === 'available' && (
              <button className="btn small" onClick={() => window.api.update.download()}>
                {app.canSelfInstall ? 'Descargar' : 'Abrir'}
              </button>
            )}
            {app.state === 'downloading' && <span className="muted small">{app.percent} %</span>}
            {app.state === 'downloaded' && (
              <button className="btn primary small" onClick={() => window.api.update.install()}>
                Reiniciar ahora
              </button>
            )}
          </div>
        )
      })
    }
  }

  for (const a of agents) {
    if (a.status === 'idle') continue
    const key = `${a.id}:${a.status}:${a.latest ?? ''}`
    if (hidden.has(key)) continue
    const name = AGENT_NAMES[a.id] ?? a.id
    rows.push({
      key,
      node: (
        <div className="uc-row">
          <span className="uc-icon">
            <ProviderIcon id={a.id as TaskProvider} size={20} />
          </span>
          <div className="uc-text">
            <strong>{name}</strong>
            {a.status === 'available' && (
              <span className="muted">
                {a.installed} <span className="uc-arrow">→</span> {a.latest}
              </span>
            )}
            {a.status === 'updating' && <span className="uc-working">Actualizando…</span>}
            {a.status === 'done' && (
              <span className="uc-ok">
                ✓ Actualizado a {a.installed}
                {a.running > 0 && <span className="muted"> · los {a.running} abiertos siguen con la anterior hasta reiniciarlos</span>}
              </span>
            )}
            {a.status === 'error' && <span className="uc-error">{a.message}</span>}
          </div>
          {a.status === 'available' && (
            <button className="btn small" onClick={() => void window.api.agentUpdates.run(a.id)}>
              Actualizar
            </button>
          )}
          {a.status === 'updating' && <span className="spinner" />}
          {a.status === 'done' && (
            <button className="btn small" onClick={() => window.api.agentUpdates.dismiss(a.id)}>
              Listo
            </button>
          )}
          {a.status === 'error' && (
            <button className="btn small" onClick={() => void window.api.agentUpdates.run(a.id)}>
              Reintentar
            </button>
          )}
        </div>
      )
    })
  }

  if (!rows.length) return null
  return (
    <div className="update-center glass" role="status">
      <div className="uc-head">
        <strong>Actualizaciones</strong>
        <span className="uc-count">{rows.length}</span>
        <span className="grow" />
        <button className="icon-btn small" title={collapsed ? 'Mostrar' : 'Ocultar'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▾' : '▴'}
        </button>
        <button className="icon-btn small" title="Cerrar" onClick={() => setHidden(new Set([...hidden, ...rows.map((r) => r.key)]))}>
          ×
        </button>
      </div>
      {!collapsed && rows.map((r) => <div key={r.key}>{r.node}</div>)}
    </div>
  )
}

/** Fila de Ajustes → Acerca de: comprobar a mano y ver el estado. */
export function UpdateRow() {
  const status = useUpdateStatus()
  if (!status) return null
  const text: Record<UpdateStatus['state'], string> = {
    idle: `Tienes la versión ${status.current}.`,
    checking: 'Buscando actualizaciones…',
    latest: `Tienes la última versión (${status.current}).`,
    available: 'version' in status ? `Hay una versión nueva: ${status.version}.` : '',
    downloading: 'percent' in status ? `Descargando… ${status.percent} %` : '',
    downloaded: 'version' in status ? `La versión ${status.version} se instalará al reiniciar.` : '',
    error: 'message' in status ? `No se pudo comprobar: ${status.message}` : ''
  }
  return (
    <div className="s-row">
      <div className="s-row-text">
        <strong>Actualizaciones</strong>
        <p>{text[status.state]}</p>
      </div>
      <div className="s-row-control">
        {status.state === 'available' && (
          <button className="btn primary" onClick={() => window.api.update.download()}>
            Actualizar
          </button>
        )}
        {status.state === 'downloaded' && (
          <button className="btn primary" onClick={() => window.api.update.install()}>
            Reiniciar y actualizar
          </button>
        )}
        {(status.state === 'idle' || status.state === 'latest' || status.state === 'error') && (
          <button className="btn" onClick={() => window.api.update.check()}>
            Buscar actualizaciones
          </button>
        )}
        <button className="btn" onClick={() => window.api.update.openRelease()}>
          Novedades
        </button>
      </div>
    </div>
  )
}
