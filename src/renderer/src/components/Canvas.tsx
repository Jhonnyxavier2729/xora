import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENTS, type AgentId, type PanelType, type Viewport, type Workspace } from '@shared/types'
import { PANEL_LABELS, useApp } from '../state'
import { addPanelTo } from './Chrome'
import { ExtrasMenu } from './Extras'
import { IconAgent, IconBrowser, IconEditor, IconFit, IconGit, IconList, IconNotes, IconTask, IconTerminal, PanelIcon } from './Icons'
import { CanvasContextMenu, type CanvasActions } from './ContextMenu'
import { PanelFrame } from './PanelFrame'

/** Movimiento mínimo (px) para que un clic se convierta en recuadro o en desplazamiento. */
const MARQUEE_THRESHOLD = 4
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

function ToolsRail({ wsId }: { wsId: string }) {
  const [agentMenu, setAgentMenu] = useState(false)
  const [installed, setInstalled] = useState<Record<AgentId, boolean> | null>(null)
  const tools: [PanelType, JSX.Element][] = [
    ['terminal', <IconTerminal key="t" />],
    ['editor', <IconEditor key="e" />],
    ['browser', <IconBrowser key="b" />],
    ['notes', <IconNotes key="n" />],
    ['git', <IconGit key="g" />]
  ]
  return (
    <div className="glass rail rail-right">
      <div className="rail-title">Herramientas</div>
      <button className="rail-btn accent" title="Nueva tarea" onClick={() => addPanelTo(wsId, 'task')}>
        <IconTask />
      </button>
      <div className="menu-anchor">
        <button
          className="rail-btn accent"
          title="Nuevo agente"
          onClick={async () => {
            setAgentMenu(!agentMenu)
            if (!installed) setInstalled(await window.api.agents.detect())
          }}
        >
          <IconAgent />
        </button>
        {agentMenu && (
          <div className="menu menu-left" onMouseLeave={() => setAgentMenu(false)}>
            <div className="menu-title">Nuevo agente</div>
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className="menu-item"
                onClick={() => {
                  addPanelTo(wsId, 'agent', a.id)
                  setAgentMenu(false)
                }}
              >
                <span className="grow">{a.name}</span>
                <span className="muted small">{installed ? (installed[a.id] ? a.command : 'no instalado') : '…'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {tools.map(([type, icon]) => (
        <button key={type} className="rail-btn" title={PANEL_LABELS[type]} onClick={() => addPanelTo(wsId, type)}>
          {icon}
        </button>
      ))}
    </div>
  )
}

function Minimap({ ws, size, onJump }: { ws: Workspace; size: { w: number; h: number }; onJump: (x: number, y: number) => void }) {
  const ptys = useApp((s) => s.ptys)
  const W = 190
  const H = 110
  const vp = ws.viewport
  const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.w / vp.zoom, h: size.h / vp.zoom }
  const rects = [...ws.panels.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })), view]
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  const k = Math.min(W / (maxX - minX), H / (maxY - minY))
  const ox = (W - (maxX - minX) * k) / 2
  const oy = (H - (maxY - minY) * k) / 2
  const tx = (x: number) => ox + (x - minX) * k
  const ty = (y: number) => oy + (y - minY) * k

  return (
    <svg
      className="minimap"
      width={W}
      height={H}
      onPointerDown={(e) => {
        const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
        const jump = (cx: number, cy: number) => onJump(minX + (cx - rect.left - ox) / k, minY + (cy - rect.top - oy) / k)
        jump(e.clientX, e.clientY)
        const move = (ev: PointerEvent) => jump(ev.clientX, ev.clientY)
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      {ws.panels.map((p) => {
        const st = ptys[p.id]
        const cls = st ? (st.needsApproval ? 'approval' : st.status) : p.type
        return <rect key={p.id} className={`mm-panel mm-${cls}`} x={tx(p.x)} y={ty(p.y)} width={Math.max(2, p.w * k)} height={Math.max(2, p.h * k)} rx={1.5} />
      })}
      <rect className="mm-view" x={tx(view.x)} y={ty(view.y)} width={view.w * k} height={view.h * k} rx={2} />
    </svg>
  )
}

export function Canvas({ workspaceId }: { workspaceId: string }) {
  const ws = useApp((s) => s.workspaces.find((w) => w.id === workspaceId))!
  const ptys = useApp((s) => s.ptys)
  const focusedPanelId = useApp((s) => s.focusedPanelId)
  const revealPanelId = useApp((s) => s.revealPanelId)
  const dragging = useApp((s) => s.dragging)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1200, h: 800 })
  const [maximized, setMaximized] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const selected = useApp((s) => s.selected)
  const dragGhost = useApp((s) => s.dragGhost)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const suppressMenu = useRef(false)
  const showMinimap = useApp((s) => s.settings?.showMinimap ?? true)
  const vp = ws.viewport

  const setVp = useCallback((next: Viewport) => useApp.getState().setViewport(workspaceId, next), [workspaceId])

  // La vista «viva» (la que se ve en pantalla) vive fuera de React, como en Deska. Mientras se desplaza o se hace
  // zoom, el movimiento se aplica directamente al elemento con `transform` (una vez por fotograma, sin volver a
  // dibujar paneles ni barras). El estado global se actualiza al terminar el gesto.
  const worldRef = useRef<HTMLDivElement>(null)
  const liveVp = useRef<Viewport>(vp)
  const gestureUntil = useRef(0)
  const frameRef = useRef(0)
  const commitTimer = useRef(0)
  const commitMaxWait = useRef(0)
  const maximizedRef = useRef<string | null>(null)
  maximizedRef.current = maximized

  const applyTransform = useCallback((v: Viewport) => {
    const el = worldRef.current
    if (!el) return
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`
    el.style.setProperty('--zoom-inv', String(1 / v.zoom))
  }, [])
  const toggleMax = useCallback((id: string) => setMaximized((m) => (m === id ? null : id)), [])

  /** Mueve la vista de forma continua (rueda, arrastre). */
  const moveVp = useCallback(
    (next: Viewport) => {
      // Con un panel maximizado, su posición depende de la vista: se mantiene el camino síncrono.
      if (maximizedRef.current) {
        liveVp.current = next
        setVp(next)
        return
      }
      liveVp.current = next
      gestureUntil.current = performance.now() + 260
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0
          applyTransform(liveVp.current)
        })
      }
      const commit = (): void => {
        window.clearTimeout(commitTimer.current)
        window.clearTimeout(commitMaxWait.current)
        commitTimer.current = 0
        commitMaxWait.current = 0
        setVp(liveVp.current)
      }
      // Se guarda al terminar (190 ms sin movimiento) y, como tope, cada 600 ms si el gesto no para (minimapa).
      window.clearTimeout(commitTimer.current)
      commitTimer.current = window.setTimeout(commit, 190)
      if (!commitMaxWait.current) commitMaxWait.current = window.setTimeout(commit, 600)
    },
    [setVp, applyTransform]
  )

  const currentVp = useCallback(() => liveVp.current, [])

  // Cuando la vista cambia desde otro sitio (centrar un panel, ajustar, minimapa, otro workspace), se refleja.
  useLayoutEffect(() => {
    if (performance.now() > gestureUntil.current) {
      liveVp.current = vp
      applyTransform(vp)
    }
  }, [vp, applyTransform])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Rueda: Ctrl + rueda hace zoom alrededor del cursor; sobre el fondo, desplaza.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const current = currentVp()
      const onBackground = (e.target as HTMLElement).classList.contains('canvas-bg')
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const zoom = clampZoom(current.zoom * Math.exp(-e.deltaY * 0.0015))
        const k = zoom / current.zoom
        moveVp({ zoom, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k })
      } else if (onBackground) {
        e.preventDefault()
        moveVp({ ...current, x: current.x - e.deltaX, y: current.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [moveVp, currentVp])

  // Espacio mantenido = modo mano (si el foco no está en un campo de texto o terminal).
  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || !!a.closest('.xterm, .monaco-editor, webview'))
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Centrar un panel cuando se pide (Xen, notificaciones, bandeja, lista).
  useEffect(() => {
    if (!revealPanelId) return
    const panel = ws.panels.find((p) => p.id === revealPanelId)
    if (!panel) return
    const zoom = clampZoom(Math.min(1, size.w / (panel.w + 160), (size.h - 160) / (panel.h + 60)))
    setVp({ zoom, x: size.w / 2 - (panel.x + panel.w / 2) * zoom, y: size.h / 2 - (panel.y + panel.h / 2) * zoom })
    useApp.getState().bringToFront(workspaceId, panel.id)
    useApp.getState().reveal(null)
  }, [revealPanelId, ws.panels, size, setVp, workspaceId])

  /** Convierte un punto de pantalla a coordenadas del mundo. */
  const toWorld = (clientX: number, clientY: number) => {
    const r = containerRef.current!.getBoundingClientRect()
    const v = currentVp()
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }
  }

  /** Mover la vista: botón central, derecho o Espacio + arrastrar (como en Deska). */
  function startPan(e: React.PointerEvent, fromRightButton: boolean) {
    const origin = currentVp()
    const start = { x: e.clientX, y: e.clientY, vx: origin.x, vy: origin.y }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < MARQUEE_THRESHOLD) return
      if (!moved) {
        moved = true
        setPanning(true)
        useApp.getState().setDragging(true)
        document.body.classList.add('canvas-interacting', 'is-panning')
      }
      moveVp({ ...currentVp(), x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y })
    }
    const up = () => {
      // Un clic derecho sin arrastrar abre el menú; si hubo arrastre, se suprime.
      if (fromRightButton && moved) suppressMenu.current = true
      setPanning(false)
      useApp.getState().setDragging(false)
      document.body.classList.remove('canvas-interacting', 'is-panning')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Selección por recuadro arrastrando el fondo con el botón izquierdo; Shift suma a la selección. */
  function startMarquee(e: React.PointerEvent) {
    const origin = toWorld(e.clientX, e.clientY)
    const startClient = { x: e.clientX, y: e.clientY }
    const additive = e.shiftKey
    const before = additive ? useApp.getState().selected : []
    let dragged = false
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < MARQUEE_THRESHOLD) return
      dragged = true
      document.body.classList.add('canvas-interacting')
      const p = toWorld(ev.clientX, ev.clientY)
      const rect = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) }
      setMarquee(rect)
      const hit = useApp
        .getState()
        .workspaces.find((w) => w.id === workspaceId)!
        .panels.filter((pn) => pn.x < rect.x + rect.w && pn.x + pn.w > rect.x && pn.y < rect.y + rect.h && pn.y + pn.h > rect.y)
        .map((pn) => pn.id)
      useApp.getState().setSelected([...new Set([...before, ...hit])])
    }
    const up = () => {
      setMarquee(null)
      document.body.classList.remove('canvas-interacting')
      // Un clic en el fondo sin arrastrar limpia la selección.
      if (!dragged && !additive) useApp.getState().setSelected([])
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onPointerDown(e: React.PointerEvent) {
    const onBackground = (e.target as HTMLElement).classList.contains('canvas-bg')
    // Botón central en cualquier sitio; derecho solo sobre el fondo (dentro de un panel es su propio menú).
    if (e.button === 1 || (e.button === 2 && onBackground) || (e.button === 0 && spaceDown)) {
      if (e.button !== 2) e.preventDefault()
      startPan(e, e.button === 2)
      return
    }
    if (e.button === 0 && onBackground) {
      e.preventDefault()
      startMarquee(e)
    }
  }

  function zoomBy(factor: number) {
    const zoom = clampZoom(vp.zoom * factor)
    const k = zoom / vp.zoom
    const cx = size.w / 2
    const cy = size.h / 2
    setVp({ zoom, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k })
  }

  function fitAll() {
    if (!ws.panels.length) return setVp({ x: 120, y: 90, zoom: 1 })
    const minX = Math.min(...ws.panels.map((p) => p.x))
    const minY = Math.min(...ws.panels.map((p) => p.y))
    const maxX = Math.max(...ws.panels.map((p) => p.x + p.w))
    const maxY = Math.max(...ws.panels.map((p) => p.y + p.h))
    // Margen para que la barra superior, los raíles y el dock no tapen los paneles.
    const zoom = clampZoom(Math.min(1, (size.w - 240) / (maxX - minX), (size.h - 200) / (maxY - minY)))
    setVp({ zoom, x: (size.w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (size.h - (maxY - minY) * zoom) / 2 - minY * zoom })
  }

  const centerOn = (x: number, y: number) => {
    const z = currentVp().zoom
    setVp({ zoom: z, x: size.w / 2 - x * z, y: size.h / 2 - y * z })
  }

  const fitRef = useRef(fitAll)
  fitRef.current = fitAll

  /** Acciones del menú contextual y de los atajos. `at` es el punto de pantalla donde crear el panel. */
  const actionsAt = useCallback(
    (at: { x: number; y: number } | null): CanvasActions => {
      const toWorld = (p: { x: number; y: number }) => {
        const v = currentVp()
        return { x: Math.round((p.x - v.x) / v.zoom), y: Math.round((p.y - v.y) / v.zoom) }
      }
      const addAt: CanvasActions['addAt'] = (type, opts = {}) => {
        const pos = at ? toWorld(at) : null
        return useApp.getState().addPanel(workspaceId, { type, ...opts, ...(pos ? { x: pos.x, y: pos.y } : {}) })
      }
      return {
        addAt,
        selectAll: () => {
          const ws2 = useApp.getState().workspaces.find((w) => w.id === workspaceId)
          useApp.getState().setSelected(ws2?.panels.map((p) => p.id) ?? [])
        },
        autoLayout: () => {
          const app = useApp.getState()
          const ws2 = app.workspaces.find((w) => w.id === workspaceId)
          if (!ws2 || !ws2.panels.length) return
          // Rejilla por filas, en el orden visual actual (arriba→abajo, izquierda→derecha).
          const ordered = [...ws2.panels].sort((a, b) => a.y - b.y || a.x - b.x)
          const cols = Math.ceil(Math.sqrt(ordered.length))
          const GAP = 40
          let y = 0
          for (let r = 0; r * cols < ordered.length; r++) {
            const row = ordered.slice(r * cols, r * cols + cols)
            let x = 0
            for (const p of row) {
              app.updatePanel(workspaceId, p.id, { x, y })
              x += p.w + GAP
            }
            y += Math.max(...row.map((p) => p.h)) + GAP
          }
          setTimeout(() => fitRef.current(), 30)
        },
        fitAll: () => fitRef.current(),
        paste: async () => {
          const text = (await navigator.clipboard.readText().catch(() => '')).trim()
          if (!text) return useApp.getState().toast('El portapapeles está vacío', 'info')
          if (/^https?:\/\/\S+$/i.test(text)) addAt('browser', { url: text })
          else {
            const id = addAt('notes')
            await window.api.notes.write(workspaceId, id, text)
          }
        }
      }
    },
    [workspaceId, currentVp]
  )

  // Atajos del lienzo (solo cuando el foco no está escribiendo en un panel).
  useEffect(() => {
    const typing = () => {
      const a = document.activeElement as HTMLElement | null
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || !!a.closest('.xterm, .monaco-editor, webview'))
    }
    const onKey = (e: KeyboardEvent) => {
      if (typing()) return
      const k = e.key.toLowerCase()
      const acts = actionsAt(null)
      if (e.ctrlKey && !e.shiftKey && k === 'a') {
        e.preventDefault()
        acts.selectAll()
      } else if (e.ctrlKey && e.shiftKey && k === 'l') {
        e.preventDefault()
        acts.autoLayout()
      } else if (e.ctrlKey && e.shiftKey && (k === '1' || e.code === 'Digit1')) {
        e.preventDefault()
        acts.fitAll()
      } else if (e.ctrlKey && e.shiftKey && k === 'e') {
        e.preventDefault()
        setMenu({ x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 220 })
      } else if (e.ctrlKey && !e.shiftKey && k === 'v') {
        e.preventDefault()
        void acts.paste()
      } else if (k === 'escape') {
        useApp.getState().setSelected([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actionsAt])

  return (
    <>
      <div
        ref={containerRef}
        className={`canvas canvas-bg ${spaceDown ? 'hand' : ''} ${panning ? 'panning' : ''} ${dragging ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).classList.contains('canvas-bg')) return
          e.preventDefault()
          // Si el botón derecho se usó para mover la vista, no se abre el menú.
          if (suppressMenu.current) {
            suppressMenu.current = false
            return
          }
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div className="world" ref={worldRef}>
          <div className="world-zoom">
            {ws.panels.map((p) => (
              <PanelFrame
                key={p.id}
                wsId={workspaceId}
                wsRoot={ws.root}
                panel={p}
                focused={focusedPanelId === p.id}
                selected={selected.includes(p.id)}
                maximizedRect={
                  maximized === p.id
                    ? { x: (60 - vp.x) / vp.zoom, y: (56 - vp.y) / vp.zoom, w: (size.w - 120) / vp.zoom, h: (size.h - 140) / vp.zoom }
                    : null
                }
                onToggleMax={toggleMax}
              />
            ))}
            {/* Fantasmas de arrastre: cristal desenfocado con el título y «Suelta para colocar». */}
            {dragGhost &&
              ws.panels
                .filter((p) => dragGhost.ids.includes(p.id))
                .map((p) => (
                  <div key={p.id} className="drag-ghost" style={{ left: p.x + dragGhost.dx, top: p.y + dragGhost.dy, width: p.w, height: p.h }}>
                    <div className="drag-ghost-head">{p.title}</div>
                    <div className="drag-ghost-body">Suelta para colocar</div>
                  </div>
                ))}
            {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / vp.zoom }} />}
          </div>
        </div>
        {ws.panels.length === 0 && (
          <div className="canvas-hint canvas-bg">
            <div className="glass hint-card">
              <strong>Lienzo vacío</strong>
              <p>Añade un agente o una terminal desde «Añadir panel» o la barra de herramientas.</p>
              <p className="muted">
                Botón derecho o central (o Espacio) + arrastrar para moverte · arrastra el fondo para seleccionar · Ctrl + rueda para hacer zoom
              </p>
            </div>
          </div>
        )}
      </div>

      <ToolsRail wsId={workspaceId} />
      <ExtrasMenu />
      {menu && <CanvasContextMenu x={menu.x} y={menu.y} actions={actionsAt(menu)} onClose={closeMenu} />}

      <div className="glass map-card">
        {showMinimap && <Minimap ws={ws} size={size} onJump={centerOn} />}
        <div className="zoom-row">
          <div className="menu-anchor">
            <button className="icon-btn small" title="Lista de paneles" onClick={() => setListOpen(!listOpen)}>
              <IconList size={14} />
            </button>
            {listOpen && (
              <div className="menu menu-up menu-right panel-list" onMouseLeave={() => setListOpen(false)}>
                <div className="menu-title">Paneles</div>
                {ws.panels.length === 0 && <div className="menu-empty">Sin paneles</div>}
                {ws.panels.map((p) => {
                  const info = ptys[p.id]
                  return (
                    <button
                      key={p.id}
                      className="menu-item"
                      onClick={() => {
                        useApp.getState().reveal(p.id)
                        setListOpen(false)
                      }}
                    >
                      <PanelIcon type={p.type} size={14} />
                      <span className="grow">{p.title}</span>
                      {info && <span className={`dot dot-${info.needsApproval ? 'approval' : info.status}`} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <button className="icon-btn small" onClick={() => zoomBy(1 / 1.2)} title="Alejar">
            −
          </button>
          <button className="zoom-label" onClick={() => setVp({ ...vp, zoom: 1 })} title="Zoom 100 %">
            {Math.round(vp.zoom * 100)}%
          </button>
          <button className="icon-btn small" onClick={() => zoomBy(1.2)} title="Acercar">
            +
          </button>
          <button className="icon-btn small" onClick={fitAll} title="Ver todo">
            <IconFit size={14} />
          </button>
        </div>
      </div>
    </>
  )
}
