import { memo, useRef, useState } from 'react'
import type { Panel, PanelType } from '@shared/types'
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
  focused: boolean
  selected: boolean
  maximizedRect: { x: number; y: number; w: number; h: number } | null
  onToggleMax: (id: string) => void
}

/** Tamaño mínimo por tipo de panel: una nota puede ser pequeña; una terminal o una tarea, no tanto. */
const MIN_SIZE: Record<PanelType, { w: number; h: number }> = {
  notes: { w: 150, h: 100 },
  terminal: { w: 240, h: 140 },
  agent: { w: 240, h: 140 },
  task: { w: 300, h: 220 },
  editor: { w: 280, h: 180 },
  browser: { w: 280, h: 180 },
  git: { w: 280, h: 180 }
}

type Edge = 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
/** Primero los bordes y después las esquinas, que quedan por encima donde se cruzan. */
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']
const CURSORS: Record<Edge, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  topLeft: 'nwse-resize',
  bottomRight: 'nwse-resize',
  topRight: 'nesw-resize',
  bottomLeft: 'nesw-resize'
}
/** Grosor de la zona de agarre de un borde (px de pantalla) y cuánto sobresale por fuera del panel. */
const HANDLE_PX = 9
const HANDLE_OUT_PX = 6
const CORNER_PX = 16
const CORNER_OUT_PX = 8
/** Bordes que se tocan a menos de esto (unidades del mundo) se consideran compartidos y se mueven juntos. */
const SHARED_TOLERANCE = 2

/** Posición de una zona de agarre: unos px de pantalla a cada lado del contorno, a cualquier zoom. */
function handleStyle(edge: Edge): React.CSSProperties {
  // --zoom-inv = 1 / zoom, lo mantiene Canvas al hacer zoom: así el tamaño en pantalla es fijo sin redibujar.
  const px = (n: number): string => `calc(${n}px * var(--zoom-inv, 1))`
  const t = px(HANDLE_PX)
  const o = px(-HANDLE_OUT_PX)
  const c = px(CORNER_PX)
  const co = px(-CORNER_OUT_PX)
  const style: Record<Edge, React.CSSProperties> = {
    top: { left: 0, top: o, width: '100%', height: t },
    bottom: { left: 0, bottom: o, width: '100%', height: t },
    left: { left: o, top: 0, width: t, height: '100%' },
    right: { right: o, top: 0, width: t, height: '100%' },
    topLeft: { left: co, top: co, width: c, height: c },
    topRight: { right: co, top: co, width: c, height: c },
    bottomLeft: { left: co, bottom: co, width: c, height: c },
    bottomRight: { right: co, bottom: co, width: c, height: c }
  }
  return style[edge]
}

interface AxisInput {
  pos: number
  size: number
  min: number
  /** pos: se mueve el borde derecho/inferior · neg: el izquierdo/superior. */
  side: 'pos' | 'neg'
  /** Desplazamiento pedido por el ratón en este eje. */
  d: number
  /** Posiciones de bordes de otros paneles a las que imantarse. */
  targets: number[]
  threshold: number
  snap: boolean
  /** Paneles pegados a este borde que se redimensionan a la vez. */
  neighbors: { id: string; pos: number; size: number; min: number }[]
}

/** Redimensiona en un eje respetando mínimos, imán y los vecinos pegados al borde. */
function resizeAxis(a: AxisInput): { pos: number; size: number; neighbors: { id: string; pos: number; size: number }[] } {
  let d = a.d
  const edge = a.side === 'pos' ? a.pos + a.size : a.pos
  if (a.snap) {
    let best: number | null = null
    for (const t of a.targets) if (Math.abs(t - (edge + d)) <= a.threshold && (best === null || Math.abs(t - (edge + d)) < Math.abs(best))) best = t - (edge + d)
    if (best !== null) d += best
  }
  let lo = -Infinity
  let hi = Infinity
  if (a.side === 'pos') {
    lo = a.min - a.size
    for (const n of a.neighbors) hi = Math.min(hi, n.size - n.min)
  } else {
    hi = a.size - a.min
    for (const n of a.neighbors) lo = Math.max(lo, -(n.size - n.min))
  }
  d = Math.min(hi, Math.max(lo, d))
  if (a.side === 'pos') {
    return { pos: a.pos, size: a.size + d, neighbors: a.neighbors.map((n) => ({ id: n.id, pos: n.pos + d, size: n.size - d })) }
  }
  return { pos: a.pos + d, size: a.size - d, neighbors: a.neighbors.map((n) => ({ id: n.id, pos: n.pos, size: n.size + d })) }
}
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

/** Zoom actual del lienzo, leído al empezar un gesto (así los paneles no se redibujan cada vez que cambia el zoom). */
function currentZoom(wsId: string): number {
  return useApp.getState().workspaces.find((w) => w.id === wsId)?.viewport.zoom ?? 1
}

export const PanelFrame = memo(function PanelFrame({ wsId, wsRoot, panel, focused, selected, maximizedRect, onToggleMax }: Props) {
  const info = useApp((s) => s.ptys[panel.id])
  const [editingTitle, setEditingTitle] = useState(false)

  const [animating, setAnimating] = useState(false)
  /** Tamaño antes de expandir con doble clic en un borde, para poder volver con otro doble clic. */
  const expanded = useRef<{ from: { x: number; y: number; w: number; h: number }; to: { x: number; y: number; w: number; h: number } } | null>(null)

  /** Arrastrar cualquier borde o esquina. Un borde pegado a otro panel mueve también el borde del vecino. */
  function startResize(e: React.PointerEvent, edge: Edge) {
    if (e.button !== 0 || maximizedRect) return
    e.preventDefault()
    e.stopPropagation()
    const app = useApp.getState()
    app.bringToFront(wsId, panel.id)
    const zoom = currentZoom(wsId)
    const ws = app.workspaces.find((w) => w.id === wsId)
    const start = { x: e.clientX, y: e.clientY, px: panel.x, py: panel.y, pw: panel.w, ph: panel.h }
    const own = MIN_SIZE[panel.type]
    const others = (ws?.panels ?? []).filter((p) => p.id !== panel.id)
    const left = edge === 'left' || edge === 'topLeft' || edge === 'bottomLeft'
    const right = edge === 'right' || edge === 'topRight' || edge === 'bottomRight'
    const top = edge === 'top' || edge === 'topLeft' || edge === 'topRight'
    const bottom = edge === 'bottom' || edge === 'bottomLeft' || edge === 'bottomRight'
    const cardinal = (left || right) !== (top || bottom)

    // Vecinos que tocan el borde que se arrastra (solo en bordes, no en esquinas).
    const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0
    const sharing = (p: Panel) => {
      if (right) return Math.abs(start.px + start.pw - p.x) <= SHARED_TOLERANCE && overlap(start.py, start.py + start.ph, p.y, p.y + p.h)
      if (left) return Math.abs(start.px - (p.x + p.w)) <= SHARED_TOLERANCE && overlap(start.py, start.py + start.ph, p.y, p.y + p.h)
      if (bottom) return Math.abs(start.py + start.ph - p.y) <= SHARED_TOLERANCE && overlap(start.px, start.px + start.pw, p.x, p.x + p.w)
      return Math.abs(start.py - (p.y + p.h)) <= SHARED_TOLERANCE && overlap(start.px, start.px + start.pw, p.x, p.x + p.w)
    }
    const shared = cardinal && !e.altKey ? others.filter(sharing) : []
    const sharedIds = new Set(shared.map((p) => p.id))
    const snapTargets = others.filter((p) => !sharedIds.has(p.id))
    const nbX = shared.map((p) => ({ id: p.id, pos: p.x, size: p.w, min: MIN_SIZE[p.type].w }))
    const nbY = shared.map((p) => ({ id: p.id, pos: p.y, size: p.h, min: MIN_SIZE[p.type].h }))

    let frame = 0
    let active = false
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
        active = true
        app.setDragging(true)
        document.body.style.setProperty('--resize-cursor', CURSORS[edge])
        document.body.classList.add('canvas-interacting', 'is-resizing')
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const dx = (ev.clientX - start.x) / zoom
        const dy = (ev.clientY - start.y) / zoom
        const snap = !ev.altKey
        const thr = SNAP_PX / zoom
        let x = start.px
        let y = start.py
        let w = start.pw
        let h = start.ph
        const changes: { id: string; x?: number; y?: number; w?: number; h?: number }[] = []
        if (left || right) {
          const r = resizeAxis({
            pos: start.px, size: start.pw, min: own.w, side: right ? 'pos' : 'neg', d: dx, snap, threshold: thr,
            targets: snapTargets.flatMap((p) => [p.x, p.x + p.w]), neighbors: left || right ? nbX : []
          })
          x = r.pos
          w = r.size
          for (const n of r.neighbors) changes.push({ id: n.id, x: n.pos, w: n.size })
        }
        if (top || bottom) {
          const r = resizeAxis({
            pos: start.py, size: start.ph, min: own.h, side: bottom ? 'pos' : 'neg', d: dy, snap, threshold: thr,
            targets: snapTargets.flatMap((p) => [p.y, p.y + p.h]), neighbors: top || bottom ? nbY : []
          })
          y = r.pos
          h = r.size
          for (const n of r.neighbors) changes.push({ id: n.id, y: n.pos, h: n.size })
        }
        app.updatePanel(wsId, panel.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
        for (const c of changes) {
          const { id, ...patch } = c
          app.updatePanel(wsId, id, Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Math.round(v as number)])))
        }
      })
    }
    const up = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!active) return
      app.setDragging(false)
      document.body.classList.remove('canvas-interacting', 'is-resizing')
      document.body.style.removeProperty('--resize-cursor')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Doble clic en un borde: el panel se expande hasta llenar la pantalla en ese eje (horizontal, vertical o
   * ambos en una esquina), entre las barras laterales. Otro doble clic lo devuelve a su tamaño.
   */
  function expandEdge(edge: Edge) {
    if (maximizedRect) return
    const app = useApp.getState()
    const ws = app.workspaces.find((w) => w.id === wsId)
    if (!ws) return
    const vp = ws.viewport
    const cur = { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
    const prev = expanded.current
    const close = (a: number, b: number) => Math.abs(a - b) <= 2
    let next = cur
    if (prev && close(cur.x, prev.to.x) && close(cur.y, prev.to.y) && close(cur.w, prev.to.w) && close(cur.h, prev.to.h)) {
      next = prev.from
      expanded.current = null
    } else {
      // Un borde lateral expande a lo ancho, uno superior o inferior a lo alto y una esquina, en los dos ejes.
      const wide = edge !== 'top' && edge !== 'bottom'
      const tall = edge !== 'left' && edge !== 'right'
      // Márgenes en pantalla: barra de espacios, herramientas, barra superior y dock.
      const L = 96, R = 96, T = 64, B = 104
      next = { ...cur }
      if (wide) {
        next.x = Math.round((L - vp.x) / vp.zoom)
        next.w = Math.round((window.innerWidth - L - R) / vp.zoom)
      }
      if (tall) {
        next.y = Math.round((T - vp.y) / vp.zoom)
        next.h = Math.round((window.innerHeight - T - B) / vp.zoom)
      }
      expanded.current = { from: cur, to: next }
    }
    setAnimating(true)
    app.updatePanel(wsId, panel.id, next)
    setTimeout(() => setAnimating(false), 320)
  }

  function startDrag(e: React.PointerEvent, mode: 'move') {
    if (e.button !== 0 || maximizedRect) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, px: panel.x, py: panel.y, pw: panel.w, ph: panel.h }
    const zoom = currentZoom(wsId)
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
        document.body.classList.add('canvas-interacting', 'is-moving')
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
      className={`panel panel-${panel.type} ${animating ? 'layout-anim' : ''} ${panel.type === 'notes' ? `note-${panel.color ?? 'yellow'}` : ''} ${focused ? 'focused' : ''} ${selected ? 'selected' : ''} ${maximizedRect ? 'maximized' : ''} ${statusKey ? `status-${statusKey}` : ''} ${isDragSource ? 'is-drag-source' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: maximizedRect ? 100000 : panel.z }}
      onPointerDownCapture={() => {
        if (!focused) useApp.getState().bringToFront(wsId, panel.id)
      }}
    >
      <div className="panel-header" onPointerDown={(e) => startDrag(e, 'move')} onDoubleClick={() => onToggleMax(panel.id)}>
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
          <button className="icon-btn small" title={maximizedRect ? 'Restaurar' : 'Maximizar'} onClick={() => onToggleMax(panel.id)}>
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
    </div>
    {!maximizedRect && (
      // Zonas de agarre en los 4 bordes y las 4 esquinas, justo sobre el contorno del panel (como en Deska).
      // Doble clic en una: el panel se expande hasta llenar la pantalla en ese eje.
      <div
        className={`panel-handles ${animating ? 'layout-anim' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: panel.z }}
      >
        {EDGES.map((edge) => (
          <div
            key={edge}
            className={`rh rh-${edge}`}
            style={handleStyle(edge)}
            onPointerDown={(e) => startResize(e, edge)}
            onDoubleClick={(e) => (e.stopPropagation(), expandEdge(edge))}
          />
        ))}
      </div>
    )}
    </>
  )
})
