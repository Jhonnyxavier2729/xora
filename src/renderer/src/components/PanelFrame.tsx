import { memo, useState } from 'react'
import type { Panel } from '@shared/types'
import { useApp } from '../state'
import { BrowserPanel } from '../panels/BrowserPanel'
import { EditorPanel } from '../panels/EditorPanel'
import { GitPanel } from '../panels/GitPanel'
import { NotesPanel } from '../panels/NotesPanel'
import { TaskPanel } from '../panels/TaskPanel'
import { TerminalPanel } from '../panels/TerminalPanel'
import { IconClose, IconMax, IconRestore, PanelIcon } from './Icons'

interface Props {
  wsId: string
  wsRoot: string
  panel: Panel
  zoom: number
  focused: boolean
  selected: boolean
  maximizedRect: { x: number; y: number; w: number; h: number } | null
  onToggleMax: () => void
}

const MIN_W = 280
const MIN_H = 180

const STATUS_TEXT = {
  working: 'trabajando',
  waiting: 'te espera',
  idle: 'listo',
  exited: 'terminado'
} as const

export const PanelFrame = memo(function PanelFrame({ wsId, wsRoot, panel, zoom, focused, selected, maximizedRect, onToggleMax }: Props) {
  const info = useApp((s) => s.ptys[panel.id])
  const [editingTitle, setEditingTitle] = useState(false)

  function startDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
    if (e.button !== 0 || maximizedRect) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, px: panel.x, py: panel.y, pw: panel.w, ph: panel.h }
    const app = useApp.getState()
    app.bringToFront(wsId, panel.id)
    app.setDragging(true)
    // Si el panel forma parte de una selección, se mueve todo el grupo.
    const ws = app.workspaces.find((w) => w.id === wsId)
    const group =
      mode === 'move' && selected && app.selected.length > 1
        ? (ws?.panels.filter((p) => app.selected.includes(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y })) ?? [])
        : [{ id: panel.id, x: panel.x, y: panel.y }]
    let frame = 0
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const dx = (ev.clientX - start.x) / zoom
        const dy = (ev.clientY - start.y) / zoom
        if (mode === 'move') for (const g of group) app.updatePanel(wsId, g.id, { x: Math.round(g.x + dx), y: Math.round(g.y + dy) })
        else app.updatePanel(wsId, panel.id, { w: Math.max(MIN_W, Math.round(start.pw + dx)), h: Math.max(MIN_H, Math.round(start.ph + dy)) })
      })
    }
    const up = () => {
      cancelAnimationFrame(frame)
      app.setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const rect = maximizedRect ?? { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
  const statusKey = info ? (info.needsApproval ? 'approval' : info.status) : null

  return (
    <div
      className={`panel panel-${panel.type} ${panel.type === 'notes' ? `note-${panel.color ?? 'yellow'}` : ''} ${focused ? 'focused' : ''} ${selected ? 'selected' : ''} ${maximizedRect ? 'maximized' : ''} ${statusKey ? `status-${statusKey}` : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: maximizedRect ? 100000 : panel.z }}
      onPointerDownCapture={() => {
        if (!focused) useApp.getState().bringToFront(wsId, panel.id)
      }}
    >
      <div className="panel-header" onPointerDown={(e) => startDrag(e, 'move')} onDoubleClick={onToggleMax}>
        <PanelIcon type={panel.type} size={14} />
        {editingTitle ? (
          <input
            className="panel-title-input"
            autoFocus
            defaultValue={panel.title}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              useApp.getState().updatePanel(wsId, panel.id, { title: e.target.value.trim() || panel.title })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span
            className="panel-title"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditingTitle(true)
            }}
            title="Doble clic para renombrar"
          >
            {panel.title}
          </span>
        )}
        {panel.worktreeBranch && <span className="branch-tag">⎇ {panel.worktreeBranch}</span>}
        {info && panel.type === 'agent' && statusKey && (
          <span className={`status-badge ${statusKey}`}>
            {info.needsApproval ? 'pide aprobación' : STATUS_TEXT[info.status]}
          </span>
        )}
        <div className="panel-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn small" title={maximizedRect ? 'Restaurar' : 'Maximizar'} onClick={onToggleMax}>
            {maximizedRect ? <IconRestore size={13} /> : <IconMax size={13} />}
          </button>
          <button
            className="icon-btn small danger"
            title="Cerrar panel"
            onClick={() => {
              const running = info && info.status === 'working'
              if (running && !confirm('El agente está trabajando. ¿Cerrar el panel y detenerlo?')) return
              useApp.getState().removePanel(wsId, panel.id)
            }}
          >
            <IconClose size={13} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {panel.type === 'task' && <TaskPanel wsId={wsId} panel={panel} />}
        {(panel.type === 'terminal' || panel.type === 'agent') && <TerminalPanel wsId={wsId} panel={panel} />}
        {panel.type === 'editor' && <EditorPanel wsId={wsId} panel={panel} />}
        {panel.type === 'browser' && <BrowserPanel wsId={wsId} panel={panel} />}
        {panel.type === 'notes' && <NotesPanel wsId={wsId} panel={panel} />}
        {panel.type === 'git' && <GitPanel wsId={wsId} wsRoot={wsRoot} panel={panel} />}
      </div>
      {!maximizedRect && <div className="resize-handle" onPointerDown={(e) => startDrag(e, 'resize')} />}
    </div>
  )
})
