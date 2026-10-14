import { useEffect } from 'react'
import type { CanvasCommand, Panel } from '@shared/types'
import { Canvas } from './components/Canvas'
import { applyAppearance } from './appearance'
import { MusicHost } from './components/Extras'
import { UpdateCenter } from './components/UpdateNotice'
import { setFocusNotifier } from './extras-state'
import { setGlowLevel } from './voice-glow'
import { BottomDock, LookPopover, SpacesRail, TopBar, VoiceGlow, Wallpaper } from './components/Chrome'
import { Home } from './components/Home'
import { NewWorkspaceModal } from './components/NewWorkspace'
import { XenConfirm } from './components/XenConfirm'
import { SettingsModal } from './components/Settings'
import { Toasts } from './components/Toasts'
import { findPanel, useApp } from './state'

/** Arranca la terminal de un panel aunque su lienzo no esté visible (Xen y acceso remoto). */
export function startPanelPty(wsId: string, panel: Panel): void {
  if (panel.type !== 'terminal' && panel.type !== 'agent') return
  void window.api.pty.ensure({
    id: panel.id,
    workspaceId: wsId,
    kind: panel.type,
    agent: panel.agent,
    command: panel.command,
    title: panel.title,
    cwd: panel.cwd ?? '',
    cols: 110,
    rows: 32
  })
}

function handleCommand(cmd: CanvasCommand): void {
  const app = useApp.getState()
  switch (cmd.kind) {
    case 'create-panel': {
      try {
        const id = app.addPanel(cmd.workspaceId, cmd.panel)
        const found = findPanel(id)
        if (found) startPanelPty(found.ws.id, found.panel)
        // Guardado inmediato para que main vea el panel nuevo sin esperar al debounce.
        void window.api.workspaces.save(useApp.getState().workspaces)
        window.api.canvas.commandResult(cmd.requestId, id)
      } catch (err) {
        window.api.canvas.commandResult(cmd.requestId, null, (err as Error).message)
      }
      break
    }
    case 'focus-panel':
      app.openWorkspace(cmd.workspaceId)
      app.reveal(cmd.panelId)
      app.bringToFront(cmd.workspaceId, cmd.panelId)
      break
    case 'open-workspace':
      app.openWorkspace(cmd.workspaceId)
      break
  }
}

/** Escribe el texto dictado donde está el foco: terminal/agente enfocado, un campo de texto o el portapapeles. */
type TextField = HTMLInputElement | HTMLTextAreaElement

/** Cuadros donde se puede dictar. No cuentan el textarea oculto de las terminales ni el del editor. */
function isTextField(el: Element | null): el is TextField {
  if (el instanceof HTMLTextAreaElement) return !el.classList.contains('xterm-helper-textarea') && !el.closest('.monaco-editor')
  return el instanceof HTMLInputElement && ['text', 'search', 'url', ''].includes(el.type) && !el.readOnly
}

/** Cuadro en el que estaba el cursor al empezar a dictar: el texto va ahí aunque luego pulses otro botón. */
let dictationTarget: TextField | null = null

function trackTextFocus(): () => void {
  const report = (): void => window.api.voice.setTextFocus(isTextField(document.activeElement))
  const onFocus = (): void => queueMicrotask(report)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  const offState = window.api.voice.onState((state, mode) => {
    if (state.phase === 'listening' && mode === 'dictate') {
      const el = document.activeElement
      dictationTarget = isTextField(el) ? el : null
    }
  })
  return () => {
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onFocus)
    offState()
  }
}

function insertDictation(text: string): void {
  const app = useApp.getState()
  const target = dictationTarget?.isConnected ? dictationTarget : null
  dictationTarget = null
  const focused = app.focusedPanelId ? findPanel(app.focusedPanelId) : null
  if (!target && focused && (focused.panel.type === 'terminal' || focused.panel.type === 'agent') && app.ptys[focused.panel.id]?.status !== 'exited') {
    window.api.pty.write(focused.panel.id, text)
    return
  }
  const el = target ?? document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (target) el.focus()
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    // Si ya había texto pegado justo antes, se separa con un espacio.
    const spaced = start > 0 && !/\s$/.test(el.value.slice(0, start)) ? ' ' + text : text
    el.setRangeText(spaced, start, end, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  void navigator.clipboard.writeText(text)
  app.toast('Texto dictado copiado al portapapeles', 'info')
}

export function App() {
  const loaded = useApp((s) => s.loaded)
  const activeId = useApp((s) => s.activeId)
  const workspace = useApp((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const panelOpacity = useApp((s) => s.settings?.panelOpacity ?? 100)
  const theme = useApp((s) => s.settings?.theme ?? 'graphite')
  const accent = useApp((s) => s.settings?.accent ?? '#ff6b4a')

  useEffect(() => applyAppearance(theme, accent), [theme, accent])

  useEffect(() => {
    void useApp.getState().load()
    const offs = [
      window.api.pty.onStatus((info) => useApp.getState().setPty(info)),
      window.api.pty.onAttention((a) => useApp.getState().toast(`${a.title}: ${a.message}`, 'attention', a.ptyId)),
      window.api.pty.onReveal((id) => {
        const found = findPanel(id)
        if (!found) return
        useApp.getState().openWorkspace(found.ws.id)
        useApp.getState().reveal(id)
      }),
      window.api.canvas.onCommand(handleCommand),
      window.api.remote.onChanged((r) => useApp.getState().setRemote(r)),
      window.api.voice.onDictation(insertDictation),
      trackTextFocus(),
      (() => {
        setFocusNotifier((m) => {
          useApp.getState().toast(m, 'attention')
          if (document.hidden || !document.hasFocus()) new Notification('Xora · Focus', { body: m, silent: true })
        })
        return () => setFocusNotifier(() => {})
      })(),
      window.api.voice.onState((state, mode) => {
        useApp.getState().setVoice(state, mode)
        // Al dictar no hay tarjeta de Xen: un fallo se avisa con un mensaje.
        if (mode === 'dictate' && state.phase === 'error') useApp.getState().toast(state.message, 'error')
      }),
      // El volumen va directo a una variable CSS: 20 veces por segundo sin re-renderizar React.
      window.api.voice.onLevel((level) => {
        document.documentElement.style.setProperty('--voice-level', level.toFixed(3))
        setGlowLevel(level)
      }),
      window.api.app.onWarning((m) => useApp.getState().toast(m, 'error')),
      window.api.app.onNotice((m) => useApp.getState().toast(m, 'info'))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (!loaded) return <div className="boot">Cargando…</div>

  const inCanvas = !!(activeId && workspace)
  return (
    <div className="app" style={{ ['--panel-opacity' as string]: panelOpacity / 100 }}>
      <Wallpaper />
      {inCanvas ? <Canvas key={activeId} workspaceId={activeId!} /> : <Home />}
      <TopBar workspace={inCanvas ? workspace : null} />
      <UpdateCenter />
      <SpacesRail activeId={inCanvas ? activeId : null} />
      <BottomDock wsId={inCanvas ? activeId : null} />
      <MusicHost />
      <LookPopover />
      <NewWorkspaceModal />
      <XenConfirm />
      <VoiceGlow />
      {settingsOpen && <SettingsModal />}
      <Toasts />
    </div>
  )
}
