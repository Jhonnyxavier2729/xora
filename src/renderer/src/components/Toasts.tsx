import { findPanel, useApp } from '../state'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => {
            dismiss(t.id)
            if (!t.panelId) return
            const found = findPanel(t.panelId)
            if (!found) return
            useApp.getState().openWorkspace(found.ws.id)
            useApp.getState().reveal(t.panelId)
          }}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
