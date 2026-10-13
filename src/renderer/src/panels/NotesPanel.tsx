import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteColor, Panel } from '@shared/types'
import { useApp } from '../state'

const NOTE_COLORS: NoteColor[] = ['yellow', 'green', 'pink', 'blue', 'dark']

export function NotesPanel({ wsId, panel }: { wsId: string; panel: Panel }) {
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef('')

  useEffect(() => {
    void window.api.notes.read(wsId, panel.id).then((t) => {
      latest.current = t
      setText(t)
      if (t) setPreview(true)
    })
    return () => {
      // Guarda lo pendiente al desmontar.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        void window.api.notes.write(wsId, panel.id, latest.current)
      }
    }
  }, [wsId, panel.id])

  function change(v: string) {
    latest.current = v
    setText(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void window.api.notes.write(wsId, panel.id, v)
    }, 500)
  }

  if (text === null) return <div className="empty center">Cargando…</div>

  return (
    <div className="notes-panel">
      <div className="notes-bar">
        <button className={`seg ${!preview ? 'on' : ''}`} onClick={() => setPreview(false)}>
          Editar
        </button>
        <button className={`seg ${preview ? 'on' : ''}`} onClick={() => setPreview(true)}>
          Vista previa
        </button>
        <span className="note-colors">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className={`note-color nc-${c} ${(panel.color ?? 'yellow') === c ? 'on' : ''}`}
              title="Color de la nota"
              onClick={() => useApp.getState().updatePanel(wsId, panel.id, { color: c })}
            />
          ))}
        </span>
      </div>
      {preview ? (
        <div className="markdown" onDoubleClick={() => setPreview(false)}>
          {text.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown> : <p className="muted">Nota vacía. Doble clic para editar.</p>}
        </div>
      ) : (
        <textarea
          className="notes-text"
          autoFocus
          value={text}
          placeholder="Escribe en Markdown: ideas, tareas, instrucciones para tus agentes…"
          onChange={(e) => change(e.target.value)}
        />
      )}
    </div>
  )
}
