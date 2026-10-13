import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENTS, type AgentId, type PanelType } from '@shared/types'
import { PANEL_LABELS, useApp } from '../state'
import {
  IconAgent,
  IconBrowser,
  IconEditor,
  IconFit,
  IconGit,
  IconList,
  IconNotes,
  IconPlus,
  IconTask,
  IconTerminal
} from './Icons'

export interface CanvasActions {
  addAt(type: PanelType, opts?: { agent?: AgentId; command?: string; url?: string }): string
  selectAll(): void
  autoLayout(): void
  fitAll(): void
  paste(): Promise<void>
}

interface Item {
  id: string
  label: string
  icon: JSX.Element
  keys?: string[]
  run?: () => void
  submenu?: Item[]
  divider?: boolean
}

export function CanvasContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: CanvasActions; onClose: () => void }) {
  const [filter, setFilter] = useState('')
  const [sub, setSub] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const library: Item[] = [
    ...AGENTS.map((a) => ({ id: `agent-${a.id}`, label: a.name, icon: <IconAgent size={15} />, run: () => actions.addAt('agent', { agent: a.id }) })),
    ...(['task', 'terminal', 'editor', 'browser', 'notes', 'git'] as PanelType[]).map((t) => ({
      id: `lib-${t}`,
      label: PANEL_LABELS[t],
      icon: <IconPlus size={15} />,
      run: () => actions.addAt(t)
    }))
  ]

  const items: Item[] = useMemo(
    () => [
      { id: 'task', label: 'Nueva tarea', icon: <IconTask size={15} />, run: () => actions.addAt('task') },
      { id: 'agent', label: 'Nuevo agente en terminal', icon: <IconAgent size={15} />, run: () => actions.addAt('agent', { agent: 'claude' }) },
      { id: 'terminal', label: 'Nueva terminal', icon: <IconTerminal size={15} />, run: () => actions.addAt('terminal') },
      { id: 'editor', label: 'Nuevo editor', icon: <IconEditor size={15} />, run: () => actions.addAt('editor') },
      { id: 'browser', label: 'Nuevo navegador', icon: <IconBrowser size={15} />, run: () => actions.addAt('browser') },
      { id: 'note', label: 'Nueva nota', icon: <IconNotes size={15} />, run: () => actions.addAt('notes') },
      { id: 'git', label: 'Nuevo panel de Git', icon: <IconGit size={15} />, run: () => actions.addAt('git') },
      { id: 'library', label: 'Biblioteca de paneles', icon: <IconList size={15} />, keys: ['Ctrl', 'Shift', 'E'], submenu: library, divider: true },
      { id: 'select', label: 'Seleccionar todo', icon: <span className="ci">⬚</span>, keys: ['Ctrl', 'A'], run: actions.selectAll },
      { id: 'layout', label: 'Ordenar automáticamente', icon: <span className="ci">▦</span>, keys: ['Ctrl', 'Shift', 'L'], run: actions.autoLayout },
      { id: 'fit', label: 'Ajustar a la vista', icon: <IconFit size={15} />, keys: ['Ctrl', 'Shift', '1'], run: actions.fitAll, divider: true },
      { id: 'paste', label: 'Pegar (URL o texto)', icon: <span className="ci">📋</span>, keys: ['Ctrl', 'V'], run: () => void actions.paste(), divider: true },
      {
        id: 'look',
        label: 'Cambiar aspecto',
        icon: <span className="ci">🎨</span>,
        run: () => useApp.getState().openLook({ x, y })
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, x, y]
  )

  const q = filter.trim().toLowerCase()
  const visible = q ? [...items.filter((i) => !i.submenu), ...library].filter((i) => i.label.toLowerCase().includes(q)) : items

  const left = Math.min(x, window.innerWidth - 300)
  const top = Math.min(y, window.innerHeight - 520)

  return (
    <div ref={ref} className="ctx glass" style={{ left: Math.max(8, left), top: Math.max(50, top) }} onContextMenu={(e) => e.preventDefault()}>
      <input
        autoFocus
        className="ctx-filter"
        placeholder="Filtrar acciones…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && visible[0]?.run) {
            visible[0].run()
            onClose()
          }
        }}
      />
      {visible.map((item) => (
        <div key={item.id}>
          <div
            className={`ctx-item ${sub === item.id ? 'open' : ''}`}
            onMouseEnter={() => setSub(item.submenu ? item.id : null)}
            onClick={() => {
              if (item.submenu) return setSub(sub === item.id ? null : item.id)
              item.run?.()
              onClose()
            }}
          >
            <span className="ctx-icon">{item.icon}</span>
            <span className="grow">{item.label}</span>
            {item.keys && (
              <span className="kbds">
                {item.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            )}
            {item.submenu && <span className="muted">›</span>}
            {item.submenu && sub === item.id && (
              <div className="ctx ctx-sub glass">
                {item.submenu.map((s) => (
                  <div
                    key={s.id}
                    className="ctx-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      s.run?.()
                      onClose()
                    }}
                  >
                    <span className="ctx-icon">{s.icon}</span>
                    <span className="grow">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {item.divider && !q && <div className="ctx-sep" />}
        </div>
      ))}
      {visible.length === 0 && <div className="menu-empty">Nada coincide.</div>}
    </div>
  )
}
