import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { Panel } from '@shared/types'
import { useApp } from '../state'

const THEME = {
  background: '#0e1117',
  foreground: '#d8dee9',
  cursor: '#9db4ff',
  selectionBackground: '#2b3a5a',
  black: '#1b1f2a',
  red: '#ff6b6b',
  green: '#3ddc97',
  yellow: '#f5c26b',
  blue: '#7c9cff',
  magenta: '#c792ea',
  cyan: '#5ccfe6',
  white: '#d8dee9',
  brightBlack: '#5c6370',
  brightRed: '#ff8787',
  brightGreen: '#69f0ae',
  brightYellow: '#ffd479',
  brightBlue: '#a5b8ff',
  brightMagenta: '#ddb0ff',
  brightCyan: '#8be9fd',
  brightWhite: '#ffffff'
}

export function TerminalPanel({ wsId, panel }: { wsId: string; panel: Panel }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<() => void>(() => {})
  const exited = useApp((s) => s.ptys[panel.id]?.status === 'exited')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: useApp.getState().settings?.terminalFontSize ?? 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 8000,
      allowProposedApi: true,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    // Ctrl+C copia si hay selección; Ctrl+V pega.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (e.ctrlKey && e.key === 'v') {
        void navigator.clipboard.readText().then((t) => t && term.paste(t))
        return false
      }
      return true
    })

    const safeFit = () => {
      if (disposed || !host.clientWidth || !host.clientHeight) return
      try {
        fit.fit()
        window.api.pty.resize(panel.id, term.cols, term.rows)
      } catch {
        // el panel puede estar oculto
      }
    }
    safeFit()
    fitRef.current = safeFit

    const offData = window.api.pty.onData((id, data) => {
      if (id === panel.id) term.write(data)
    })
    const offExit = window.api.pty.onExit((id, code) => {
      if (id === panel.id) term.write(`\r\n\x1b[90m[proceso terminado con código ${code}]\x1b[0m\r\n`)
    })
    const offRefit = window.api.pty.onRefit((id) => id === panel.id && safeFit())
    const inputSub = term.onData((d) => window.api.pty.write(panel.id, d))

    void window.api.pty
      .ensure({
        id: panel.id,
        workspaceId: wsId,
        kind: panel.type === 'agent' ? 'agent' : 'terminal',
        agent: panel.agent,
        command: panel.command,
        title: panel.title,
        cwd: panel.cwd ?? '',
        cols: term.cols,
        rows: term.rows
      })
      .then(({ info, replay }) => {
        if (disposed) return
        if (replay) term.write(replay)
        useApp.getState().setPty(info)
        safeFit()
      })

    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(safeFit)
    })
    ro.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      offData()
      offExit()
      offRefit()
      inputSub.dispose()
      term.dispose()
    }
    // La terminal vive mientras exista el panel; los cambios de posición no la recrean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id])

  function restart() {
    void window.api.pty.kill(panel.id).then(() => {
      // La suscripción a datos del efecto sigue activa: basta con recrear la sesión y reajustar el tamaño.
      void window.api.pty
        .ensure({
          id: panel.id,
          workspaceId: wsId,
          kind: panel.type === 'agent' ? 'agent' : 'terminal',
          agent: panel.agent,
          command: panel.command,
          title: panel.title,
          cwd: panel.cwd ?? '',
          cols: 100,
          rows: 30
        })
        .then(({ info }) => {
          useApp.getState().setPty(info)
          fitRef.current()
        })
    })
  }

  return (
    <div className="terminal-wrap">
      <div ref={hostRef} className="terminal-host" />
      {exited && (
        <button className="btn small restart-btn" onClick={restart}>
          Reiniciar
        </button>
      )}
    </div>
  )
}
