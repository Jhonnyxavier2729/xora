import { useEffect } from 'react'
import type { CanvasCommand, Panel } from '@shared/types'
import { Canvas } from './components/Canvas'
import { applyAppearance } from './appearance'
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
function insertDictation(text: string): void {
  const app = useApp.getState()
  const focused = app.focusedPanelId ? findPanel(app.focusedPanelId) : null
  if (focused && (focused.panel.type === 'terminal' || focused.panel.type === 'agent') && app.ptys[focused.panel.id]?.status !== 'exited') {
    window.api.pty.write(focused.panel.id, text)
    return
  }
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.setRangeText(text, start, end, 'end')
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
      window.api.voice.onState((state, mode) => useApp.getState().setVoice(state, mode)),
      // El volumen va directo a una variable CSS: 20 veces por segundo sin re-renderizar React.
      window.api.voice.onLevel((level) => document.documentElement.style.setProperty('--voice-level', level.toFixed(3))),
      window.api.app.onWarning((m) => useApp.getState().toast(m, 'error'))
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
      <SpacesRail activeId={inCanvas ? activeId : null} />
      <BottomDock wsId={inCanvas ? activeId : null} />
      <LookPopover />
      <NewWorkspaceModal />
      <XenConfirm />
      <VoiceGlow />
      {settingsOpen && <SettingsModal />}
      <Toasts />
    </div>
  )
}
