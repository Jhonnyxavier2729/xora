import { useEffect, useState } from 'react'
import { XenFace } from './XenFace'

/** Cuando «Actuar sin preguntar» está desactivado, Xen pide aprobación aquí antes de actuar. */
export function XenConfirm() {
  const [req, setReq] = useState<{ id: string; items: string[] } | null>(null)

  useEffect(() => window.api.xen.onConfirm((id, items) => setReq({ id, items })), [])

  if (!req) return null
  const answer = (ok: boolean) => {
    window.api.xen.confirmResult(req.id, ok)
    setReq(null)
  }

  return (
    <div className="xen-confirm glass" role="dialog" aria-label="Xen pide confirmación">
      <div className="xc-head">
        <XenFace mood="attention" size={34} />
        <strong>¿Hago esto?</strong>
      </div>
      <ul>
        {req.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
      <div className="row xc-actions">
        <button className="btn small" onClick={() => answer(false)}>
          No
        </button>
        <button className="btn small primary" autoFocus onClick={() => answer(true)}>
          Sí, hazlo
        </button>
      </div>
    </div>
  )
}
