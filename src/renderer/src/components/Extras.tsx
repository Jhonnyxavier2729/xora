import { useEffect, useRef, useState } from 'react'
import type { NoteColor, NoteSummary } from '@shared/types'
import {
  PLAYLISTS,
  WIDGET_ORIGIN,
  focusActions,
  focusRemaining,
  formatClock,
  music,
  musicActions,
  sendToWidget,
  setWidget,
  useFocus,
  useMusic,
  widgetSrc
} from '../extras-state'
import { useApp } from '../state'
import { timeAgo } from '../utils'
import { addPanelTo } from './Chrome'

/** Extras como en Deska: la última nota, el temporizador de foco y música para concentrarse. */

const NOTE_TITLE_MAX = 40

interface NoteRow extends NoteSummary {
  color: NoteColor
}

function useRecentNotes(open: boolean): NoteRow[] {
  const workspaces = useApp((s) => s.workspaces)
  const [notes, setNotes] = useState<NoteRow[]>([])
  useEffect(() => {
    if (!open) return
    const panels = workspaces.flatMap((w) => w.panels.filter((p) => p.type === 'notes').map((p) => ({ wsId: w.id, panelId: p.id, color: p.color ?? 'yellow' })))
    void window.api.notes.summaries(panels.map(({ wsId, panelId }) => ({ wsId, panelId }))).then((list) => {
      const colors = new Map(panels.map((p) => [p.panelId, p.color]))
      setNotes(list.map((n) => ({ ...n, color: colors.get(n.panelId) ?? 'yellow' })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6))
    })
  }, [open, workspaces])
  return notes
}

function openNote(n: NoteSummary): void {
  const app = useApp.getState()
  app.openWorkspace(n.wsId)
  app.reveal(n.panelId)
  app.bringToFront(n.wsId, n.panelId)
}

const clip = (t: string): string => (t.length > NOTE_TITLE_MAX ? t.slice(0, NOTE_TITLE_MAX - 1) + '…' : t)

function NotesRow({ open }: { open: boolean }) {
  const notes = useRecentNotes(open)
  const [list, setList] = useState(false)
  const activeId = useApp((s) => s.activeId)
  const latest = notes[0]

  const write = (): void => {
    if (!activeId) {
      useApp.getState().toast('Abre un workspace para escribir una nota', 'info')
      return
    }
    addPanelTo(activeId, 'notes')
  }

  if (!latest) {
    return (
      <div className="ex-row">
        <span className="ex-thumb note-thumb nc-yellow" />
        <div className="ex-text">
          <strong>Nota rápida</strong>
          <span className="muted">Sin notas todavía</span>
        </div>
        <button className="ex-action" title="Escribir" onClick={write}>
          ✎
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="ex-row clickable" onClick={() => setList(!list)} title="Notas recientes">
        <span className={`ex-thumb note-thumb nc-${latest.color}`}>{latest.title.slice(0, 32)}</span>
        <div className="ex-text">
          <strong>{clip(latest.title || 'Nota sin título')}</strong>
          <span className="muted">Editada {timeAgo(latest.updatedAt)}</span>
        </div>
        <button
          className="ex-action"
          title="Abrir la nota"
          onClick={(e) => {
            e.stopPropagation()
            openNote(latest)
          }}
        >
          ✎
        </button>
      </div>
      {list && (
        <div className="ex-sub">
          {notes.map((n) => (
            <button key={n.panelId} className="menu-item ex-sub-item" onClick={() => openNote(n)}>
              <span className={`note-dot nc-${n.color}`} />
              <span className="grow">{clip(n.title || 'Nota sin título')}</span>
              <span className="muted small">{timeAgo(n.updatedAt)}</span>
            </button>
          ))}
          <button className="menu-item ex-sub-item" onClick={write}>
            ＋ Nueva nota
          </button>
        </div>
      )}
    </>
  )
}

function FocusRow() {
  const s = useFocus()
  const [, tick] = useState(0)
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    if (s.status !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.status])
  const remaining = focusRemaining(s)
  const title = s.phase === 'break' ? 'Descanso' : 'Focus'
  const sub =
    s.status === 'running' ? `Quedan ${formatClock(remaining)}` : s.status === 'paused' ? `En pausa · ${formatClock(remaining)}` : `Listo, ${s.focusMin} min`
  const total = (s.phase === 'focus' ? s.focusMin : s.breakMin) * 60_000
  const progress = s.status === 'ready' ? 0 : 1 - remaining / total

  return (
    <>
      <div className="ex-row clickable" onClick={() => setSettings(!settings)} title="Ajustes del temporizador">
        <span className={`ex-thumb focus-ring ${s.phase}`} style={{ ['--p' as string]: progress }}>
          ⏱
        </span>
        <div className="ex-text">
          <strong>{title}</strong>
          <span className={s.status === 'running' ? 'ex-live' : 'muted'}>{sub}</span>
        </div>
        <button
          className="ex-action"
          title={s.status === 'running' ? 'Pausar' : s.status === 'paused' ? 'Reanudar' : 'Empezar foco'}
          onClick={(e) => {
            e.stopPropagation()
            if (s.status === 'running') focusActions.pause()
            else focusActions.start()
          }}
        >
          {s.status === 'running' ? '❚❚' : '▶'}
        </button>
      </div>
      {settings && (
        <div className="ex-sub ex-focus-settings">
          <label>
            Foco
            <select value={s.focusMin} onChange={(e) => focusActions.setMinutes(Number(e.target.value), s.breakMin)}>
              {[15, 20, 25, 30, 45, 50, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <label>
            Descanso
            <select value={s.breakMin} onChange={(e) => focusActions.setMinutes(s.focusMin, Number(e.target.value))}>
              {[3, 5, 10, 15, 20].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          {s.phase === 'break' && s.status !== 'ready' ? (
            <button className="btn small" onClick={() => focusActions.skipBreak()}>
              Saltar descanso
            </button>
          ) : (
            <button className="btn small" disabled={s.status === 'ready'} onClick={() => focusActions.reset()}>
              Reiniciar
            </button>
          )}
        </div>
      )}
    </>
  )
}

const MUSIC_STATUS: Record<string, string> = {
  idle: 'Sin reproducir',
  loading: 'Cargando…',
  playing: 'Reproduciendo',
  paused: 'En pausa',
  failed: 'No se pudo cargar la música'
}

function MusicRow() {
  const m = useMusic()
  const [more, setMore] = useState(false)
  const playlist = PLAYLISTS.find((p) => p.id === m.playlistId) ?? PLAYLISTS[0]
  const playing = m.status === 'playing'
  return (
    <>
      <div className="ex-row clickable" onClick={() => setMore(!more)} title="Listas y controles">
        {m.artwork ? <img className="ex-thumb ex-art" src={m.artwork} alt="" /> : <span className="ex-thumb ex-art-empty">♪</span>}
        <div className="ex-text">
          <strong>{clip(m.title ?? playlist.name)}</strong>
          <span className={playing ? 'ex-live' : 'muted'}>{MUSIC_STATUS[m.status]}</span>
        </div>
        <button
          className="ex-action"
          title={playing ? 'Pausar' : 'Reproducir'}
          onClick={(e) => {
            e.stopPropagation()
            if (playing) musicActions.pause()
            else musicActions.play()
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
      </div>
      {more && (
        <div className="ex-sub ex-music">
          <div className="ex-music-controls">
            <button className="btn small" title="Anterior" disabled={!m.mounted} onClick={() => musicActions.prev()}>
              ⏮
            </button>
            <button className="btn small" title="Siguiente" disabled={!m.mounted} onClick={() => musicActions.next()}>
              ⏭
            </button>
            <select value={m.playlistId} onChange={(e) => musicActions.choose(e.target.value)}>
              {(['Ambiente', 'Lofi'] as const).map((cat) => (
                <optgroup key={cat} label={cat}>
                  {PLAYLISTS.filter((p) => p.category === cat).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <span className="muted small">Música de SoundCloud</span>
        </div>
      )}
    </>
  )
}

/**
 * Reproductor de SoundCloud invisible. Vive fuera del menú para que la música siga al cerrarlo.
 * Se controla por postMessage con el protocolo del widget (sin cargar scripts externos en Xora).
 */
export function MusicHost() {
  const m = useMusic()
  const ref = useRef<HTMLIFrameElement>(null)
  const playlist = PLAYLISTS.find((p) => p.id === m.playlistId) ?? PLAYLISTS[0]

  useEffect(() => {
    if (!m.mounted) return
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== WIDGET_ORIGIN || e.source !== ref.current?.contentWindow) return
      let data: { method?: string; value?: unknown }
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (data.method === 'ready') {
        for (const ev of ['play', 'pause', 'finish', 'error']) sendToWidget('addEventListener', ev)
        sendToWidget('play')
      } else if (data.method === 'play') {
        music.set({ status: 'playing' })
        sendToWidget('getCurrentSound')
      } else if (data.method === 'pause' || data.method === 'finish') {
        music.set({ status: 'paused' })
      } else if (data.method === 'error') {
        music.set({ status: 'failed' })
      } else if (data.method === 'getCurrentSound' && data.value && typeof data.value === 'object') {
        const sound = data.value as { title?: string; artwork_url?: string | null; user?: { avatar_url?: string } }
        music.set({ title: sound.title ?? null, artwork: sound.artwork_url ?? sound.user?.avatar_url ?? null })
      }
    }
    window.addEventListener('message', onMessage)
    // Si en 20 s no responde, se avisa en vez de quedarse «Cargando».
    const timeout = setTimeout(() => {
      if (music.get().status === 'loading') music.set({ status: 'failed' })
    }, 20_000)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timeout)
    }
  }, [m.mounted, m.playlistId])

  if (!m.mounted) return null
  return (
    <iframe
      key={playlist.id}
      ref={(el) => {
        ;(ref as React.MutableRefObject<HTMLIFrameElement | null>).current = el
        setWidget(el?.contentWindow ?? null)
      }}
      className="music-host"
      title="Música"
      allow="autoplay; encrypted-media"
      sandbox="allow-scripts allow-same-origin allow-popups"
      src={widgetSrc(playlist.url)}
    />
  )
}

export function ExtrasMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const focusRunning = useFocus().status === 'running'
  const musicPlaying = useMusic().status === 'playing'

  return (
    <div className="extras menu-anchor" ref={ref}>
      <button className="glass pill dock-btn" title="Notas, foco y música" onClick={() => setOpen(!open)}>
        ⋯ Extras {(focusRunning || musicPlaying) && <span className="ex-dot" />} {open ? '▾' : '▴'}
      </button>
      {open && (
        <div className="extras-pop glass">
          <NotesRow open={open} />
          <FocusRow />
          <MusicRow />
        </div>
      )}
    </div>
  )
}
