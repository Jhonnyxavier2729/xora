import { memo, useState } from 'react'
import type { Panel } from '@shared/types'
import { snapRect } from '../snap'
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
/** Distancia de imantado en píxeles de pantalla (se convierte a unidades del mundo según el zoom). */
const SNAP_PX = 8
/** Píxeles de movimiento antes de que un clic en la cabecera se convierta en arrastre. */
const DRAG_THRESHOLD = 3
/** El resplandor de selección sobresale 24 px alrededor del panel. */
const GLOW_INSET = 24

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
    // Si el panel forma parte de una selección, se mueve todo el grupo.
    const ws = app.workspaces.find((w) => w.id === wsId)
    const group =
      mode === 'move' && selected && app.selected.length > 1
        ? (ws?.panels.filter((p) => app.selected.includes(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y })) ?? [])
        : [{ id: panel.id, x: panel.x, y: panel.y }]
    // Los demás paneles sirven de referencia para imantar (Alt desactiva el imán).
    const moving = new Set(group.map((g) => g.id))
    const others = (ws?.panels ?? []).filter((p) => !moving.has(p.id)).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))
    let frame = 0
    let active = false
    let last = { dx: 0, dy: 0 }
    const move = (ev: PointerEvent) => {
      // Un clic en la cabecera sin moverse no inicia el arrastre.
      if (!active) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
        active = true
        app.setDragging(true)
        document.body.classList.add('canvas-interacting', mode === 'move' ? 'is-moving' : 'is-resizing')
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        let dx = (ev.clientX - start.x) / zoom
        let dy = (ev.clientY - start.y) / zoom
        if (mode === 'move') {
          // Imán silencioso hacia bordes y centros de otros paneles (Alt lo desactiva).
          if (!ev.altKey) {
            const snap = snapRect({ x: start.px + dx, y: start.py + dy, w: start.pw, h: start.ph }, others, SNAP_PX / zoom)
            dx += snap.dx
            dy += snap.dy
          }
          last = { dx, dy }
          // El panel real se oculta y lo sigue un fantasma de cristal («Suelta para colocar»).
          app.setDragGhost({ ids: group.map((g) => g.id), dx, dy })
        } else {
          let w = Math.max(MIN_W, start.pw + dx)
          let h = Math.max(MIN_H, start.ph + dy)
          if (!ev.altKey) {
            const snap = snapRect({ x: start.px + w, y: start.py + h, w: 0, h: 0 }, others, SNAP_PX / zoom)
            w += snap.dx
            h += snap.dy
          }
          app.updatePanel(wsId, panel.id, { w: Math.round(w), h: Math.round(h) })
        }
      })
    }
    const up = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!active) return
      // Al soltar, los paneles aparecen donde estaba el fantasma.
      if (mode === 'move') {
        for (const g of group) app.updatePanel(wsId, g.id, { x: Math.round(g.x + last.dx), y: Math.round(g.y + last.dy) })
        app.setDragGhost(null)
      }
      app.setDragging(false)
      document.body.classList.remove('canvas-interacting', 'is-moving', 'is-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const rect = maximizedRect ?? { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
  const statusKey = info ? (info.needsApproval ? 'approval' : info.status) : null
  const isDragSource = useApp((s) => !!s.dragGhost?.ids.includes(panel.id))
  const showGlow = (focused || selected) && !maximizedRect && !isDragSource

  return (
    <>
    {showGlow && (
      // Resplandor radial del color de acento, detrás de todos los paneles (como en Deska).
      <div
        className={`panel-glow ${selected ? 'is-selected' : ''}`}
        style={{ left: rect.x - GLOW_INSET, top: rect.y - GLOW_INSET, width: rect.w + GLOW_INSET * 2, height: rect.h + GLOW_INSET * 2 }}
      />
    )}
    <div
      className={`panel panel-${panel.type} ${panel.type === 'notes' ? `note-${panel.color ?? 'yellow'}` : ''} ${focused ? 'focused' : ''} ${selected ? 'selected' : ''} ${maximizedRect ? 'maximized' : ''} ${statusKey ? `status-${statusKey}` : ''} ${isDragSource ? 'is-drag-source' : ''}`}
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
    </>
  )
})
