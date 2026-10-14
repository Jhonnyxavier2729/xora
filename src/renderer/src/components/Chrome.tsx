import { useEffect, useRef, useState } from 'react'
import { AGENTS, type AgentId, type PanelType, type Workspace } from '@shared/types'
import { ACCENTS, THEMES, WALLPAPERS, wallpaperUrl } from '../appearance'
import { findPanel, PANEL_LABELS, useApp } from '../state'
import { XoraMark } from './Logo'
import { UsageChip } from './Usage'
import { createGlowController, type GlowController, type GlowState } from '../voice-glow'
import { XenFace, type XenMood } from './XenFace'
import { errMsg, timeAgo } from '../utils'
import {
  IconAgent,
  IconBell,
  IconBrowser,
  IconEditor,
  IconGit,
  IconHome,
  IconMic,
  IconNotes,
  IconPhone,
  IconPlus,
  IconSend,
  IconSettings,
  IconTask,
  IconTerminal,
  PanelIcon
} from './Icons'

const SPACE_COLORS = ['#7c9cff', '#3ddc97', '#f5b041', '#ff7eb6', '#5ccfe6', '#c792ea', '#ff9f6b']

function spaceColor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return SPACE_COLORS[h % SPACE_COLORS.length]
}

function initials(name: string): string {
  const parts = name.replace(/[-_.]/g, ' ').split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
}

/** Cierra un popover al hacer clic fuera. */
function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open, close])
  return ref
}

export async function openFolderAsWorkspace(): Promise<void> {
  const picked = await window.api.workspaces.pickFolder()
  if (!picked) return
  const id = useApp.getState().addWorkspace(picked.root, picked.name)
  useApp.getState().openWorkspace(id)
}

// ---------------------------------------------------------------------------
// Fondo del lienzo

export function Wallpaper() {
  const settings = useApp((s) => s.settings)
  if (!settings) return null
  let image: string | null = null
  if (settings.wallpaper === 'file') image = `ac-asset://wallpaper/?v=${settings.wallpaperVersion}`
  else if (settings.wallpaper.startsWith('builtin:')) {
    const id = settings.wallpaper.slice(8)
    if (WALLPAPERS.some((w) => w.id === id)) image = wallpaperUrl(id)
  }
  return (
    <div className="wallpaper" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
      {image && <div className="wallpaper-dim" style={{ background: `rgba(5, 6, 10, ${settings.wallpaperDim / 100})` }} />}
      <div className="wallpaper-vignette" />
    </div>
  )
}

/**
 * Brillo de pantalla completa (como el de Deska) mientras Xen escucha, se dicta en un cuadro de texto
 * o Xen piensa: luz difusa que sale de los bordes, gira, respira y se intensifica con tu voz.
 * Azul al dictar, violeta al hablar con Xen, rosa mientras procesa.
 */
export function VoiceGlow() {
  const voice = useApp((s) => s.voice)
  const mode = useApp((s) => s.voiceMode)
  const glow: GlowState | null =
    voice.phase === 'listening' ? (mode === 'dictate' ? 'dictating' : 'listening') : voice.phase === 'transcribing' || voice.phase === 'thinking' ? 'working' : null

  // El lienzo sigue montado un momento tras apagarse para que la luz se desvanezca en vez de cortarse.
  const [mounted, setMounted] = useState(false)
  const [lit, setLit] = useState(false)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const controller = useRef<GlowController | null>(null)
  const last = useRef<GlowState>('listening')
  if (glow) last.current = glow

  useEffect(() => {
    if (!glow) {
      setLit(false)
      const t = setTimeout(() => setMounted(false), 700)
      return () => clearTimeout(t)
    }
    setMounted(true)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setLit(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [glow])

  useEffect(() => {
    if (!canvas) return
    const created = createGlowController(canvas)
    controller.current = created
    return () => {
      controller.current = null
      created?.destroy()
    }
  }, [canvas])

  useEffect(() => {
    controller.current?.setTarget(last.current, lit && glow !== null)
  }, [canvas, glow, lit])

  if (!mounted) return null
  return <canvas ref={setCanvas} className="voice-glow" aria-hidden="true" />
}

// ---------------------------------------------------------------------------
// Barra superior

export function TopBar({ workspace }: { workspace: Workspace | null }) {
  const remote = useApp((s) => s.remote)
  const ptys = useApp((s) => s.ptys)
  const attention = Object.values(ptys).filter((p) => p.kind === 'agent' && p.status === 'waiting' && findPanel(p.id)).length

  const remoteLabel = !remote?.enabled
    ? 'Desactivado'
    : remote.connectedClients > 0
      ? `${remote.connectedClients} conectado${remote.connectedClients > 1 ? 's' : ''}`
      : remote.tunnelStatus === 'on'
        ? 'Túnel activo'
        : 'Esperando'

  return (
    <div className="titlebar">
      <div className="glass pill top-left">
        <button className="crumb brand" onClick={() => useApp.getState().openSettings()} title="Ajustes de Xora">
          <XoraMark size={20} />
          Xora
        </button>
        <span className="sep" />
        <span className="crumb muted" title="Este ordenador">
          ▣ local
        </span>
        {workspace && (
          <>
            <span className="chev">›</span>
            <span className="crumb">
              <span className="space-dot" style={{ background: spaceColor(workspace.id) }}>
                {initials(workspace.name)}
              </span>
              <strong>{workspace.name}</strong>
            </span>
            <span className="chev">›</span>
            <button className="crumb path" title="Abrir en el Explorador" onClick={() => void window.api.shell.openPath(workspace.root)}>
              {workspace.root.replace(/^C:\\Users\\[^\\]+/i, '~').replace(/\\/g, '/')}
            </button>
          </>
        )}
      </div>

      <div className="glass pill top-right">
        <button className="remote-chip" onClick={() => useApp.getState().openSettings('remote')} title="Acceso desde el móvil">
          <IconPhone size={15} />
          <span>Acceso móvil</span>
          <span className={`remote-state ${remote?.enabled ? 'on' : ''}`}>{remoteLabel}</span>
        </button>
        <HelpMenu />
        <button className="icon-btn" title="Ajustes" onClick={() => useApp.getState().openSettings()}>
          <IconSettings />
        </button>
        <InboxBell count={attention} />
      </div>
    </div>
  )
}

const REPO = 'https://github.com/Jhonnyxavier2729/xora'

/** «?» junto a Ajustes: atajos, ayuda, reportar un problema y novedades. */
function HelpMenu() {
  const [open, setOpen] = useState(false)
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false))
  const go = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const link = (url: string) => () => void window.api.shell.openExternal(url)
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="icon-btn help-btn" title="Ayuda" onClick={() => setOpen(!open)}>
        ?
      </button>
      {open && (
        <div className="menu menu-right help-menu">
          <button className="menu-item" onClick={go(() => useApp.getState().openSettings('shortcuts'))}>
            ⌨ Atajos de teclado
          </button>
          <button className="menu-item" onClick={go(() => useApp.getState().openSettings('help'))}>
            ? Cómo se usa Xora
          </button>
          <button className="menu-item" onClick={go(link(`${REPO}#readme`))}>
            📖 Documentación
          </button>
          <button className="menu-item" onClick={go(link(`${REPO}/issues/new`))}>
            🐞 Reportar un problema
          </button>
          <button className="menu-item" onClick={go(link(`${REPO}/releases`))}>
            ✨ Novedades
          </button>
          <button
            className="menu-item"
            onClick={go(() => {
              window.api.update.check()
              useApp.getState().openSettings('diagnostics')
            })}
          >
            ⟳ Buscar actualizaciones
          </button>
        </div>
      )}
    </div>
  )
}

function InboxBell({ count }: { count: number }) {
  const [open, setOpen] = useState(false)
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false))
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="icon-btn" title="Bandeja" onClick={() => setOpen(!open)}>
        <IconBell />
        {count > 0 && <span className="badge">{count}</span>}
      </button>
      {open && <InboxList align="right" onPick={() => setOpen(false)} />}
    </div>
  )
}

function InboxList({ align, onPick }: { align: 'right' | 'up'; onPick: () => void }) {
  const ptys = useApp((s) => s.ptys)
  const items = Object.values(ptys)
    .filter((p) => p.kind === 'agent' && findPanel(p.id))
    .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.lastOutputAt - a.lastOutputAt)
  return (
    <div className={`menu inbox ${align === 'up' ? 'menu-up' : 'menu-right'}`}>
      <div className="menu-title">Agentes</div>
      {items.length === 0 && <div className="menu-empty">No hay agentes en marcha.</div>}
      {items.map((p) => {
        const key = p.needsApproval ? 'approval' : p.status
        const label = p.needsApproval ? 'pide aprobación' : { working: 'trabajando', waiting: 'te espera', idle: 'listo', exited: 'terminado' }[p.status]
        return (
          <button
            key={p.id}
            className="menu-item"
            onClick={() => {
              const found = findPanel(p.id)
              if (!found) return
              useApp.getState().openWorkspace(found.ws.id)
              useApp.getState().reveal(p.id)
              onPick()
            }}
          >
            <span className={`dot dot-${key}`} />
            <span className="grow">
              <strong>{p.title}</strong>
              <span className="muted small"> · {findPanel(p.id)?.ws.name}</span>
            </span>
            <span className="muted small">{p.status === 'waiting' ? timeAgo(p.lastOutputAt) : label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra lateral de espacios

export function SpacesRail({ activeId }: { activeId: string | null }) {
  const workspaces = useApp((s) => s.workspaces)
  const ptys = useApp((s) => s.ptys)
  const [hover, setHover] = useState(false)
  const [branches, setBranches] = useState<Record<string, string>>({})
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ctrl+1…9 salta al espacio correspondiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || !/^Digit[1-9]$/.test(e.code)) return
      const ws = useApp.getState().workspaces[Number(e.code.slice(5)) - 1]
      if (!ws) return
      e.preventDefault()
      useApp.getState().openWorkspace(ws.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Las ramas se consultan al desplegar el panel (no en cada render).
  useEffect(() => {
    if (!hover) return
    for (const ws of workspaces) {
      void window.api.git
        .status(ws.root)
        .then((s) => s.isRepo && setBranches((b) => (b[ws.id] === s.branch ? b : { ...b, [ws.id]: s.branch })))
        .catch(() => {})
    }
  }, [hover, workspaces])

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setHover(true)
  }
  const hide = () => {
    hideTimer.current = setTimeout(() => setHover(false), 180)
  }

  return (
    <div className="spaces" onMouseEnter={show} onMouseLeave={hide}>
      <div className="glass rail rail-left">
        <div className="rail-title">Espacios</div>
        <button className={`rail-btn ${activeId === null ? 'active' : ''}`} title="Inicio" onClick={() => useApp.getState().openWorkspace(null)}>
          <IconHome />
        </button>
        {workspaces.map((ws) => {
          const waiting = ws.panels.some((p) => ptys[p.id]?.kind === 'agent' && ptys[p.id]?.status === 'waiting')
          const working = ws.panels.some((p) => ptys[p.id]?.status === 'working')
          return (
            <button key={ws.id} className={`space-btn ${activeId === ws.id ? 'active' : ''}`} onClick={() => useApp.getState().openWorkspace(ws.id)}>
              <span className="space-avatar" style={{ background: spaceColor(ws.id) }}>
                {initials(ws.name)}
              </span>
              {(waiting || working) && <span className={`space-status dot dot-${waiting ? 'waiting' : 'working'}`} />}
            </button>
          )
        })}
        <button className="rail-btn" title="Nuevo workspace" onClick={() => useApp.getState().setNewWorkspaceOpen(true)}>
          <IconPlus />
        </button>
      </div>

      {hover && workspaces.length > 0 && (
        <div className="spaces-flyout glass">
          {workspaces.map((ws, i) => {
            const agents = ws.panels.filter((p) => p.type === 'agent')
            const waiting = agents.filter((p) => ptys[p.id]?.status === 'waiting').length
            const working = agents.filter((p) => ptys[p.id]?.status === 'working').length
            return (
              <button
                key={ws.id}
                className={`flyout-row ${activeId === ws.id ? 'active' : ''}`}
                onClick={() => {
                  useApp.getState().openWorkspace(ws.id)
                  setHover(false)
                }}
              >
                <span className="space-avatar" style={{ background: spaceColor(ws.id) }}>
                  {initials(ws.name)}
                </span>
                <span className="grow">
                  <strong>{ws.name}</strong>
                  <span className="flyout-sub">
                    {branches[ws.id] && <span className="nw-branch">⎇ {branches[ws.id]}</span>}
                    {working > 0 && <span className="pill-tag working">{working} trabajando</span>}
                    {waiting > 0 && <span className="pill-tag waiting">{waiting} esperando</span>}
                    {!branches[ws.id] && !working && !waiting && <span className="muted small">{ws.panels.length} paneles</span>}
                  </span>
                </span>
                {i < 9 && (
                  <span className="kbds">
                    <kbd>Ctrl</kbd>
                    <kbd>{i + 1}</kbd>
                  </span>
                )}
              </button>
            )
          })}
          <button
            className="flyout-row flyout-new"
            onClick={() => {
              useApp.getState().setNewWorkspaceOpen(true)
              setHover(false)
            }}
          >
            <span className="space-avatar new">
              <IconPlus size={14} />
            </span>
            <span className="grow">Nuevo workspace</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dock inferior: añadir panel, Xen, dictado y bandeja

export function addPanelTo(wsId: string, type: PanelType, agent?: AgentId, command?: string): void {
  useApp.getState().addPanel(wsId, { type, agent, command })
}

function AddPanelMenu({ wsId }: { wsId: string | null }) {
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState<Record<AgentId, boolean> | null>(null)
  const [custom, setCustom] = useState('')
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false))

  async function toggle() {
    if (!wsId) return useApp.getState().setNewWorkspaceOpen(true)
    setOpen(!open)
    if (!installed) setInstalled(await window.api.agents.detect())
  }

  function add(type: PanelType, agent?: AgentId, command?: string) {
    if (!wsId) return
    addPanelTo(wsId, type, agent, command)
    setOpen(false)
  }

  const basics: [PanelType, JSX.Element][] = [
    ['terminal', <IconTerminal key="t" />],
    ['editor', <IconEditor key="e" />],
    ['browser', <IconBrowser key="b" />],
    ['notes', <IconNotes key="n" />],
    ['git', <IconGit key="g" />]
  ]

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="dock-btn" onClick={() => void toggle()} title={wsId ? 'Añadir panel' : 'Abrir una carpeta'}>
        <IconPlus /> {wsId ? 'Añadir panel' : 'Abrir carpeta'}
      </button>
      {open && wsId && (
        <div className="menu menu-up add-menu">
          <button className="menu-item tk-new" onClick={() => add('task')}>
            <IconTask size={16} />
            <span className="grow">
              <strong>Nueva tarea</strong>
              <span className="muted small"> · Claude Code, Codex u OpenCode con su modelo</span>
            </span>
          </button>
          <div className="menu-title">Agentes en terminal</div>
          {AGENTS.map((a) => (
            <button key={a.id} className="menu-item" onClick={() => add('agent', a.id)}>
              <IconAgent size={15} />
              <span className="grow">{a.name}</span>
              <span className="muted small">{installed ? (installed[a.id] ? a.command : 'no instalado') : '…'}</span>
            </button>
          ))}
          <div className="menu-custom">
            <input
              placeholder="Otro comando de agente…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  add('agent', 'custom', custom.trim())
                  setCustom('')
                }
              }}
            />
          </div>
          <div className="menu-title">Paneles</div>
          <div className="menu-grid">
            {basics.map(([type, icon]) => (
              <button key={type} className="menu-tile" onClick={() => add(type)}>
                {icon}
                <span>{PANEL_LABELS[type]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function XenAsk() {
  const settings = useApp((s) => s.settings)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<string | null>(null)
  const mac = window.api.app.platform === 'darwin'
  const holdLabel =
    { CtrlRight: 'Ctrl der.', AltRight: mac ? 'Opción der.' : 'Alt der.', ShiftRight: 'Shift der.', MetaRight: mac ? 'Cmd der.' : 'Win der.' }[
      settings?.holdKey ?? ''
    ] ?? settings?.holdKey

  async function submit() {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setReply(null)
    try {
      const res = await window.api.xen.ask(q)
      setReply([res.reply, ...res.actions.map((a) => `• ${a.summary}`)].join('\n'))
      setText('')
      setTyping(false)
    } catch (err) {
      useApp.getState().toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="xen-ask">
      {typing ? (
        <div className="xen-input">
          <input
            autoFocus
            value={text}
            disabled={busy}
            placeholder={busy ? 'Xen está pensando…' : '«dile a Claude que añada tests»'}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => !text && !busy && setTyping(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') setTyping(false)
            }}
          />
          <button className="icon-btn" disabled={busy || !text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()}>
            <IconSend />
          </button>
        </div>
      ) : (
        <button className="xen-prompt" onClick={() => setTyping(true)} title="Toca para escribir">
          <span className="xen-title">Pregúntale a Xen</span>
          <span className="xen-sub">Mantén {holdLabel} para hablar · toca para escribir</span>
        </button>
      )}
      {reply && (
        <div className="xen-reply" onClick={() => setReply(null)}>
          {reply}
        </div>
      )}
    </div>
  )
}

const VOICE_LABEL = {
  listening: 'Escuchando…',
  transcribing: 'Transcribiendo…',
  thinking: 'Xen está pensando…'
} as const

/** Onda de barras que sigue el volumen del micrófono (variable CSS --voice-level). */
function Waveform() {
  return (
    <span className="wave" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => (
        <i key={i} style={{ ['--i' as string]: i }} />
      ))}
    </span>
  )
}

/** Mientras Xen escucha o piensa, el centro del dock se convierte en esta tarjeta. */
function VoiceCard() {
  const voice = useApp((s) => s.voice)
  const mode = useApp((s) => s.voiceMode)
  if (voice.phase === 'idle') return null
  const mood: XenMood =
    voice.phase === 'listening' ? 'listening' : voice.phase === 'done' ? 'done' : voice.phase === 'error' ? 'error' : 'thinking'
  return (
    <div className={`voice-card glass phase-${voice.phase} mode-${mode}`}>
      <div className="voice-row">
        <XenFace mood={mood} size={40} />
        {voice.phase === 'listening' || voice.phase === 'transcribing' ? (
          <>
            <Waveform />
            <span className="voice-label">{VOICE_LABEL[voice.phase]}</span>
          </>
        ) : (
          <span className="voice-text">
            {voice.phase === 'thinking' && <span className="muted">«{voice.transcript}» · Xen está pensando…</span>}
            {voice.phase === 'done' && voice.reply}
            {voice.phase === 'error' && voice.message}
          </span>
        )}
        {voice.phase === 'listening' ? (
          <button className="voice-done" onClick={() => window.api.voice.stop(false)}>
            <span className="mini-wave" /> Listo
          </button>
        ) : (
          <button className="icon-btn" title="Cerrar" onClick={() => window.api.voice.dismiss()}>
            ×
          </button>
        )}
      </div>
      <div className="voice-hint">
        {mode === 'dictate' ? 'Aa  Escribiendo donde está tu cursor' : 'Xen reparte lo que dices entre tus agentes'}
      </div>
    </div>
  )
}

export function BottomDock({ wsId }: { wsId: string | null }) {
  const ptys = useApp((s) => s.ptys)
  const voice = useApp((s) => s.voice)
  const waiting = Object.values(ptys).filter((p) => p.kind === 'agent' && p.status === 'waiting' && findPanel(p.id))
  const approvals = waiting.filter((p) => p.needsApproval).length
  const [inbox, setInbox] = useState(false)
  const inboxRef = useOutside<HTMLDivElement>(inbox, () => setInbox(false))
  const voiceMode = useApp((s) => s.voiceMode)
  // Dictar no es hablar con Xen: la tarjeta y la cara de Xen solo se transforman al hablar con él.
  // Al dictar, la señal está en el propio cuadro (etiqueta «Escuchando») y en el brillo de los bordes.
  const live = voice.phase !== 'idle' && voiceMode !== 'dictate'
  const dictating = voiceMode === 'dictate' && (voice.phase === 'listening' || voice.phase === 'transcribing')
  const faceMood: XenMood = approvals ? 'attention' : 'idle'

  return (
    <div className="dock-wrap">
      {live && <VoiceCard />}
      <div className="dock-bottom">
        <div className="glass pill dock-pill">
          <AddPanelMenu wsId={wsId} />
        </div>
        {!live && (
          <div className="glass pill dock-pill xen-pill">
            <XenAsk />
            <button
              className={`dock-btn ${dictating ? 'dock-dictating' : ''}`}
              title={dictating ? 'Terminar el dictado' : 'Dictar donde está el cursor'}
              onClick={() => (dictating ? window.api.voice.stop(false) : window.api.voice.toggle('dictate'))}
            >
              <IconMic size={15} /> {dictating ? (voice.phase === 'transcribing' ? 'Transcribiendo…' : 'Escuchando') : 'Dictar'}
            </button>
            <button className="xen-face-btn" title="Hablar con Xen" onClick={() => window.api.voice.toggle('xen')}>
              <XenFace mood={faceMood} size={42} />
            </button>
          </div>
        )}
        <div className="glass pill dock-pill menu-anchor" ref={inboxRef}>
          <button className="dock-btn inbox-btn" onClick={() => setInbox(!inbox)}>
            <span className="inbox-dots">
              {waiting.slice(0, 3).map((p) => (
                <span key={p.id} className={`dot dot-${p.needsApproval ? 'approval' : 'waiting'}`} />
              ))}
              {waiting.length === 0 && <span className="dot" />}
            </span>
            <span className="inbox-text">
              <strong>Bandeja</strong>
              <span className={waiting.length ? 'warn' : 'muted'}>
                {approvals ? `${approvals} piden aprobación` : waiting.length ? `${waiting.length} te esperan` : 'al día'}
              </span>
            </span>
          </button>
          {inbox && <InboxList align="up" onPick={() => setInbox(false)} />}
        </div>
      </div>
      <div className="dock-under">
        <UsageChip />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cambiar aspecto: tema, acento y fondo

/** Selector de tema, acento y fondo; se usa en el popover y en Ajustes → Apariencia. */
export function LookContent({ compact }: { compact?: boolean }) {
  const settings = useApp((s) => s.settings)
  const [all, setAll] = useState(!compact)
  if (!settings) return null
  const update = useApp.getState().updateSettings
  const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0]
  const current = settings.wallpaper.startsWith('builtin:') ? WALLPAPERS.find((w) => `builtin:${w.id}` === settings.wallpaper) : null
  const shown = all ? WALLPAPERS : WALLPAPERS.slice(0, 7)

  return (
    <>
      <div className="look-head">
        <strong>Tema</strong>
        <span className="muted">{theme.name}</span>
      </div>
      <div className="theme-row">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-swatch ${t.id === theme.id ? 'on' : ''}`}
            title={t.name}
            style={{ background: t.vars['--bg'], borderColor: t.vars['--border-2'] }}
            onClick={() => void update({ theme: t.id })}
          >
            <span className="ts-bar" style={{ background: t.vars['--panel-2'] }} />
            <span className="ts-dot" style={{ background: t.dot }} />
          </button>
        ))}
      </div>

      <div className="look-head">
        <strong>Acento</strong>
      </div>
      <div className="accent-row">
        {ACCENTS.map((a) => (
          <button key={a} className={`accent-dot ${settings.accent === a ? 'on' : ''}`} style={{ background: a }} onClick={() => void update({ accent: a })} />
        ))}
        <label className={`accent-dot accent-custom ${ACCENTS.includes(settings.accent) ? '' : 'on'}`} title="Color personalizado">
          <input type="color" value={settings.accent} onChange={(e) => void update({ accent: e.target.value })} />
        </label>
      </div>

      <div className="look-head">
        <strong>Fondo</strong>
        <span className="muted">{settings.wallpaper === 'none' ? 'Ninguno' : settings.wallpaper === 'file' ? 'Tu imagen' : (current?.name ?? '')}</span>
      </div>
      <div className={`bg-grid ${all && compact ? 'all' : ''} ${compact ? '' : 'wide'}`}>
        <button className={`bg-tile bg-none ${settings.wallpaper === 'none' ? 'on' : ''}`} onClick={() => void update({ wallpaper: 'none' })}>
          Ninguno
        </button>
        {shown.map((w) => (
          <button
            key={w.id}
            className={`bg-tile ${settings.wallpaper === `builtin:${w.id}` ? 'on' : ''}`}
            title={w.name}
            style={{ backgroundImage: `url("${wallpaperUrl(w.id, true)}")` }}
            onClick={() => void update({ wallpaper: `builtin:${w.id}` })}
          >
            <span className="bg-name">{w.name}</span>
          </button>
        ))}
        <button
          className={`bg-tile bg-file ${settings.wallpaper === 'file' ? 'on' : ''}`}
          title="Usar una imagen tuya"
          onClick={async () => {
            const next = await window.api.settings.pickWallpaper()
            if (next) useApp.getState().setSettings(next)
          }}
        >
          + Tu imagen
        </button>
      </div>
      <div className="look-foot">
        {compact ? (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? 'Ver menos' : `Ver los ${WALLPAPERS.length} fondos`}
          </button>
        ) : (
          <span />
        )}
        <span className="muted small">Obras de Birmingham Museums Trust · dominio público</span>
      </div>
    </>
  )
}

export function LookPopover() {
  const at = useApp((s) => s.lookOpen)
  const ref = useOutside<HTMLDivElement>(!!at, () => useApp.getState().openLook(null))
  if (!at) return null
  // Mantener el popover dentro de la ventana.
  const left = Math.min(at.x, window.innerWidth - 460)
  const top = Math.min(at.y, window.innerHeight - 440)

  return (
    <div ref={ref} className="look glass" style={{ left: Math.max(10, left), top: Math.max(54, top) }}>
      <LookContent compact />
      <button
        className="menu-item"
        onClick={() => {
          useApp.getState().openLook(null)
          useApp.getState().openSettings('appearance')
        }}
      >
        Todos los ajustes de apariencia
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Extras

export { PanelIcon }
