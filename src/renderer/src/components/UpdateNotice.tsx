import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

/** Estado del actualizador, compartido por el aviso flotante y Ajustes → Acerca de. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.update.status().then(setStatus)
    return window.api.update.onStatus(setStatus)
  }, [])
  return status
}

/** Aviso de nueva versión (arriba, junto a la barra), como el de Deska. */
export function UpdateNotice() {
  const status = useUpdateStatus()
  const [hidden, setHidden] = useState<string | null>(null)
  if (!status) return null
  const version = 'version' in status ? status.version : null
  if (!version || hidden === `${status.state}:${version}`) return null
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') return null

  return (
    <div className="update-notice glass" role="status">
      <span className="update-dot" />
      <div className="update-text">
        {status.state === 'available' && (
          <>
            <strong>Nueva versión: Xora {version}</strong>
            <span className="muted">Tienes la {status.current}</span>
          </>
        )}
        {status.state === 'downloading' && (
          <>
            <strong>Descargando Xora {version}…</strong>
            <span className="update-bar">
              <span style={{ width: `${status.percent}%` }} />
            </span>
          </>
        )}
        {status.state === 'downloaded' && (
          <>
            <strong>Xora {version} está lista</strong>
            <span className="muted">Se instala al reiniciar (o al cerrar la app)</span>
          </>
        )}
      </div>
      {status.state === 'available' && (
        <button className="btn primary small" onClick={() => window.api.update.download()}>
          {status.canSelfInstall ? 'Actualizar' : 'Descargar'}
        </button>
      )}
      {status.state === 'downloaded' && (
        <button className="btn primary small" onClick={() => window.api.update.install()}>
          Reiniciar
        </button>
      )}
      {status.state !== 'downloading' && (
        <button className="icon-btn small" title="Más tarde" onClick={() => setHidden(`${status.state}:${version}`)}>
          ×
        </button>
      )}
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
