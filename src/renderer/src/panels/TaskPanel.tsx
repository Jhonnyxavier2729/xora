import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Panel, TaskAccess, TaskConfig, TaskItem, TaskModel, TaskModels, TaskProvider, Worktree } from '@shared/types'
import { DotsThree, GitBranch, Lock, LockSimpleOpen, Microphone, Paperclip, PencilSimpleLine, Sparkle, Stop, type Icon } from '@phosphor-icons/react'
import { Chip, ChipMenu, type MenuItem } from '../components/ChipMenu'
import { useApp } from '../state'
import { errMsg } from '../utils'

// ---------------------------------------------------------------------------
// Iconos de proveedor (genéricos, propios)

export function ProviderIcon({ id, size = 15 }: { id: TaskProvider; size?: number }) {
  if (id === 'claude')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {[0, 30, 60, 90, 120, 150].map((a) => (
          <rect key={a} x="11" y="2.5" width="2" height="19" rx="1" fill="#e8825f" transform={`rotate(${a} 12 12)`} />
        ))}
      </svg>
    )
  if (id === 'codex')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3z" />
        <path d="M12 7.5 16 9.8v4.4L12 16.5 8 14.2V9.8z" />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  )
}

const PROVIDERS: { id: TaskProvider; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'opencode', name: 'OpenCode' }
]

const ACCESS: { id: TaskAccess; label: string; detail: string }[] = [
  { id: 'approval-required', label: 'Supervisado', detail: 'Apruebas comandos y ediciones' },
  { id: 'auto-accept-edits', label: 'Aceptar ediciones', detail: 'Las ediciones entran, los comandos preguntan' },
  { id: 'auto', label: 'Auto', detail: 'El agente decide y revisas al final' },
  { id: 'full-access', label: 'Acceso total', detail: 'Nada se detiene para aprobación' }
]

const SLASH: Record<TaskProvider, [string, string][]> = {
  claude: [
    ['/review', 'Revisar los cambios actuales'],
    ['/init', 'Crear CLAUDE.md con el contexto del proyecto'],
    ['/compact', 'Compactar la conversación'],
    ['/security-review', 'Revisión de seguridad de los cambios']
  ],
  codex: [['/review', 'Revisar los cambios actuales']],
  opencode: [['/init', 'Crear AGENTS.md con el contexto del proyecto']]
}

let modelsCache: Promise<TaskModels> | null = null
const loadModels = (force = false) => {
  if (!modelsCache || force) modelsCache = window.api.task.models(force)
  return modelsCache
}

// Las listas de modelos se renuevan solas mientras Xora está abierta: si un agente se actualiza y trae
// modelos nuevos, aparecen sin reiniciar.
setInterval(() => {
  if (!document.hidden) void loadModels(true)
}, 15 * 60_000)

function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [open, close])
  return ref
}

// ---------------------------------------------------------------------------
// Selector de modelo

const EFFORT_LABEL: Record<string, string> = {
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
  ultra: 'Ultra',
  ultrathink: 'Ultrathink'
}
const effortLabel = (e: string): string => EFFORT_LABEL[e] ?? e

/** Quita de la configuración lo que el modelo elegido no admite (p. ej. un nivel que no existe en él). */
function fitToModel(config: TaskConfig, model: TaskModel | undefined): TaskConfig {
  const next: TaskConfig = { ...config }
  if (!model?.efforts || (next.effort && !model.efforts.includes(next.effort))) delete next.effort
  if (!model?.fast) delete next.fast
  if (!model?.contexts) delete next.context
  if (!model?.thinkingToggle) delete next.thinking
  return next
}

/** Nombre legible mientras llega la lista de modelos: claude-haiku-4-5 → Haiku 4.5. */
function prettyModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:\[1m\])?$/.exec(id)
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

function ModelPicker({ config, onChange }: { config: TaskConfig; onChange: (c: TaskConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<TaskModels | null>(null)
  const [tab, setTab] = useState<TaskProvider>(config.provider)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; height: number } | null>(null)

  // El menú se dibuja en el <body> (así no lo recorta el panel ni lo escala el zoom) y se coloca junto al chip.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return setPos(null)
    const r = anchorRef.current.getBoundingClientRect()
    const width = 470
    const above = r.top - 16
    const below = window.innerHeight - r.bottom - 16
    const up = above >= 460 || above > below
    // Si no cabe entero, encoge al espacio libre en vez de tapar el chip.
    const height = Math.max(220, Math.min(460, up ? above : below))
    setPos({
      left: Math.max(8, Math.min(r.left - 40, window.innerWidth - width - 8)),
      top: up ? Math.max(8, r.top - height - 8) : r.bottom + 8,
      height
    })
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [open])

  // Al abrir el selector se toma la lista más reciente (la renovación periódica ya la dejó al día).
  useEffect(() => {
    void loadModels().then(setModels)
  }, [open])
  useEffect(() => setTab(config.provider), [config.provider, open])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (models?.[tab] ?? []).filter((m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [models, tab, query])

  const pick = (id: string) => {
    // Al cambiar de modelo se conserva el razonamiento si el nuevo lo admite, y se quita si no.
    const target = models?.[tab]?.find((m) => m.id === id)
    onChange(fitToModel({ ...config, provider: tab, model: id }, target))
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const m = list[Number(e.code.slice(5)) - 1]
        if (m) {
          e.preventDefault()
          pick(m.id)
        }
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const current = models?.[config.provider]?.find((m) => m.id === config.model)
  const label = current?.label ?? (config.model ? prettyModel(config.model) : 'Predeterminado')

  return (
    <span className="xchip-slot xchip-model" ref={anchorRef}>
      <Chip
        leading={<ProviderIcon id={config.provider} size={13} />}
        label={label}
        caret
        expanded={open}
        title="Agente y modelo de esta tarea. Un turno que ya está en marcha termina con el modelo con el que empezó."
        onClick={() => setOpen(!open)}
      />
      {open &&
        pos &&
        createPortal(
        <div
          ref={popRef}
          className="model-picker glass"
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: 'auto', height: pos.height }}
        >
          <div className="mp-tabs">
            {PROVIDERS.map((p) => (
              <button key={p.id} className={`mp-tab ${tab === p.id ? 'on' : ''}`} title={p.name} onClick={() => setTab(p.id)}>
                <ProviderIcon id={p.id} size={18} />
              </button>
            ))}
          </div>
          <div className="mp-main">
            <input autoFocus className="mp-search" placeholder="Buscar modelos" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="mp-title">{PROVIDERS.find((p) => p.id === tab)?.name}</div>
            <div className="mp-list">
              {models === null && <div className="muted mp-empty">Cargando modelos…</div>}
              {models && list.length === 0 && (
                <div className="muted mp-empty">{models[tab].length ? 'Nada coincide.' : 'Este agente no está instalado o no respondió.'}</div>
              )}
              {list.map((m, i) => (
                <button
                  key={m.id || 'default'}
                  className={`mp-item ${config.provider === tab && config.model === m.id ? 'on' : ''}`}
                  onClick={() => pick(m.id)}
                >
                  <span className="grow">{m.label}</span>
                  {m.id && m.id !== m.label && <span className="muted small mp-id">{m.id}</span>}
                  {i < 9 && (
                    <span className="kbds">
                      <kbd>Alt</kbd>
                      <kbd>{i + 1}</kbd>
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mp-foot">
              <button
                className="link-plain"
                onClick={() => {
                  setOpen(false)
                  useApp.getState().openSettings('agents')
                }}
              >
                Gestionar agentes
              </button>
              <button className="link-plain muted" onClick={() => void loadModels(true).then(setModels)}>
                ↻
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Compositor

const ACCESS_ICONS: Record<TaskAccess, Icon> = {
  'approval-required': Lock,
  'auto-accept-edits': PencilSimpleLine,
  auto: Sparkle,
  'full-access': LockSimpleOpen
}

/**
 * Chip «··· Acceso total ⌄» (como el de ajustes de Deska): un solo menú con el razonamiento del modelo
 * (esfuerzo, contexto, modo rápido, pensar), los permisos y, en paneles estrechos, Build/Plan.
 * Cada modelo ofrece solo lo que admite.
 */
function SettingsChip({ config, onChange, compact }: { config: TaskConfig; onChange: (c: TaskConfig) => void; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<TaskModels | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    void loadModels().then(setModels)
  }, [open, config.provider])

  const model = models?.[config.provider]?.find((m) => m.id === config.model)
  const efforts = model?.efforts ?? []
  const effort = config.effort && efforts.includes(config.effort) ? config.effort : ''
  const contexts = model?.contexts ?? []
  const context = config.context && contexts.includes(config.context) ? config.context : (model?.defaultContext ?? '')

  const items: MenuItem[] = []
  if (efforts.length) {
    items.push({ value: 'effort:', label: 'Por defecto', detail: 'El modelo decide cuánto pensar', group: 'Razonamiento' })
    for (const e of efforts) items.push({ value: `effort:${e}`, label: effortLabel(e), group: 'Razonamiento' })
  }
  for (const c of contexts) items.push({ value: `window:${c}`, label: c === '1m' ? '1M' : '200K', group: 'Ventana de contexto' })
  if (model?.fast) {
    items.push({ value: 'fast:on', label: 'Activado', group: 'Modo rápido' })
    items.push({ value: 'fast:off', label: 'Desactivado', detail: 'Deliberación completa', group: 'Modo rápido' })
  }
  if (model?.thinkingToggle) {
    items.push({ value: 'thinking:on', label: 'Activado', detail: 'Piensa antes de responder', group: 'Pensar' })
    items.push({ value: 'thinking:off', label: 'Desactivado', group: 'Pensar' })
  }
  for (const a of ACCESS) {
    const AccessIcon = ACCESS_ICONS[a.id]
    items.push({ value: `mode:${a.id}`, label: a.label, detail: a.detail, group: 'Permisos', leading: <AccessIcon size={14} /> })
  }
  if (compact) {
    items.push({ value: 'plan:off', label: 'Build', detail: 'Edita archivos sobre la marcha', group: 'Siguiente turno' })
    items.push({ value: 'plan:on', label: 'Plan', detail: 'Investiga y propone un plan, sin editar', group: 'Siguiente turno' })
  }

  const selected = [`mode:${config.access}`]
  if (efforts.length) selected.push(`effort:${effort}`)
  if (context) selected.push(`window:${context}`)
  if (model?.fast) selected.push(config.fast ? 'fast:on' : 'fast:off')
  if (model?.thinkingToggle) selected.push(config.thinking === false ? 'thinking:off' : 'thinking:on')
  if (compact) selected.push(config.mode === 'plan' ? 'plan:on' : 'plan:off')

  const pick = (value: string): void => {
    const [kind, ...rest] = value.split(':')
    const v = rest.join(':')
    if (kind === 'effort') onChange({ ...config, effort: v || undefined })
    else if (kind === 'window') onChange({ ...config, context: v })
    else if (kind === 'fast') onChange({ ...config, fast: v === 'on' })
    else if (kind === 'thinking') onChange({ ...config, thinking: v === 'on' })
    else if (kind === 'mode') onChange({ ...config, access: v as TaskAccess })
    else if (kind === 'plan') onChange({ ...config, mode: v === 'on' ? 'plan' : 'build' })
  }

  const access = ACCESS.find((a) => a.id === config.access) ?? ACCESS[3]
  const tuned = !!(config.effort || config.fast || config.context || config.thinking === false)
  const summary = [effort && effortLabel(effort), context && contexts.length > 1 && context.toUpperCase(), config.fast && model?.fast && 'rápido']
    .filter(Boolean)
    .join(', ')
  const note =
    config.provider === 'codex'
      ? 'Codex aplica el acceso como permisos del sandbox.'
      : config.provider === 'opencode'
        ? 'OpenCode usa los permisos de su configuración.'
        : ''

  return (
    <span ref={anchor} className="xchip-slot">
      <Chip
        leading={<DotsThree size={14} weight="bold" aria-hidden />}
        label={compact ? '' : access.label}
        caret
        active={tuned}
        expanded={open}
        title={`Ajustes: ${access.detail}${summary ? ` · ${summary}` : ''}`}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <ChipMenu
          items={items}
          selected={selected}
          anchorRef={anchor}
          width={290}
          keepOpen
          onPick={pick}
          onClose={() => setOpen(false)}
          footer={note ? <span className="muted small">{note}</span> : undefined}
        />
      )}
    </span>
  )
}

/**
 * «⎇ Esta copia ⌄» (como la franja de rama de Deska): dónde trabaja la tarea. La carpeta del proyecto, un
 * worktree que ya tengas o uno nuevo con su propia rama. Solo en un repositorio de Git y mientras es un borrador.
 */
function BranchStrip({ wsId, panel }: { wsId: string; panel: Panel }) {
  const root = useApp((s) => s.workspaces.find((w) => w.id === wsId)?.root ?? '')
  const [trees, setTrees] = useState<Worktree[] | null>(null)
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)

  const load = () => window.api.git.worktrees(root).then(setTrees, () => setTrees(null))
  useEffect(() => {
    if (root) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])
  if (!root || !trees || !trees.length) return null

  const here = trees.find((w) => norm(w.path) === norm(panel.cwd ?? root)) ?? trees[0]
  const choose = (path: string, branch: string, isMain: boolean) => {
    useApp.getState().updatePanel(wsId, panel.id, { cwd: path, worktreeBranch: isMain ? undefined : branch })
    setNaming(false)
  }

  const items: MenuItem[] = [
    { value: 'local', label: 'Esta copia', detail: `${trees[0].branch} · el proyecto tal como está`, group: 'Ejecutar en' },
    { value: 'new', label: 'Nuevo worktree…', detail: 'Una copia aparte con su propia rama', group: 'Ejecutar en' },
    ...trees
      .filter((w) => !w.main)
      .map((w) => ({ value: `wt:${w.path}`, label: w.branch, detail: w.path.split(/[\\/]/).slice(-2).join('/'), group: 'Worktrees' }))
  ]

  function pick(value: string) {
    if (value === 'local') choose(trees![0].path, trees![0].branch, true)
    else if (value === 'new') {
      setNaming(true)
      setName(`tarea-${panel.id.slice(0, 4)}`)
    } else {
      const wt = trees!.find((w) => `wt:${w.path}` === value)
      if (wt) choose(wt.path, wt.branch, false)
    }
  }

  async function create() {
    const branch = name.trim()
    if (!branch) return
    setBusy(true)
    try {
      const wt = await window.api.git.createWorktree(root, branch)
      choose(wt.path, wt.branch, false)
      if (wt.reused) useApp.getState().toast(`Worktree «${wt.branch}» reutilizado: sigue como lo dejaste`)
      setName('')
      void load()
    } catch (err) {
      useApp.getState().toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="xbranch">
      <span ref={anchor} className="xchip-slot">
        <Chip
          leading={<GitBranch size={12} weight="bold" aria-hidden />}
          label={here.main ? 'Esta copia' : here.branch}
          caret
          expanded={open}
          title={`Dónde trabaja esta tarea: ${here.path}`}
          onClick={() => setOpen(!open)}
        />
        {open && (
          <ChipMenu
            items={items}
            selected={[here.main ? 'local' : `wt:${here.path}`]}
            anchorRef={anchor}
            width={320}
            onPick={pick}
            onClose={() => setOpen(false)}
            footer={<span className="muted small">Un worktree es una copia aparte: la tarea no toca tus archivos de aquí.</span>}
          />
        )}
      </span>
      {naming && (
        <div className="xbranch-new">
          <input
            autoFocus
            value={name}
            placeholder="rama-nueva, p. ej. feature/login"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') setNaming(false)
            }}
          />
          <button className="btn small primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            Crear
          </button>
        </div>
      )}
    </div>
  )
}

function Composer({
  config,
  onConfig,
  running,
  cwd,
  onSend,
  onStop,
  onNewDraft,
  big,
  strip
}: {
  config: TaskConfig
  onConfig: (c: TaskConfig) => void
  running: boolean
  cwd: string
  onSend: (text: string, files: string[]) => void
  onStop: () => void
  /** Ctrl/Cmd+Enter: abre otro borrador de tarea con el mismo agente, modelo y ajustes. */
  onNewDraft: () => void
  big: boolean
  /** Franja inferior de la tarjeta (dónde trabaja la tarea), solo en el borrador. */
  strip?: React.ReactNode
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [slash, setSlash] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const slashAnchor = useRef<HTMLSpanElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  // En paneles estrechos, Build/Plan pasa al menú de ajustes (como el modo compacto de Deska).
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < 500))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Dictado en este cuadro (como en Deska): el micrófono pasa a «Escuchando» y «Empezar» a «Parar y empezar».
  const voice = useApp((s) => s.voice)
  const voiceMode = useApp((s) => s.voiceMode)
  const [mine, setMine] = useState(false)
  const [startAfter, setStartAfter] = useState(false)
  const latest = useRef({ text: '', files: [] as string[] })
  latest.current = { text, files }
  const dictating = mine && voiceMode === 'dictate' && (voice.phase === 'listening' || voice.phase === 'transcribing')

  useEffect(() => {
    if (voiceMode !== 'dictate') return
    if (voice.phase === 'listening' && document.activeElement === ref.current) setMine(true)
    if (voice.phase === 'done' || voice.phase === 'error' || voice.phase === 'idle') {
      setMine(false)
      if (startAfter) {
        setStartAfter(false)
        // Espera un instante a que el texto dictado llegue al cuadro antes de enviarlo.
        if (voice.phase === 'done') setTimeout(() => submitLatest(), 80)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.phase, voiceMode])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(220, el.scrollHeight) + 'px'
  }, [text])

  const submit = () => {
    const t = text.trim()
    if (!t || (running && config.provider !== 'claude')) return
    onSend(t, files)
    setText('')
    setFiles([])
  }

  function submitLatest() {
    const { text: t, files: f } = latest.current
    if (!t.trim() || (running && config.provider !== 'claude')) return
    onSend(t.trim(), f)
    setText('')
    setFiles([])
  }

  const plan = config.mode === 'plan'

  return (
    <div className={`composer xcomp ${big ? 'big' : ''}`}>
      <div className="xcard">
        {files.length > 0 && (
          <div className="xcard-files">
            {files.map((f) => (
              <span key={f} className="tk-file" title={f}>
                <Paperclip size={11} aria-hidden /> {f.split(/[\\/]/).pop()}
                <button onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          className="xcard-input"
          rows={big ? 2 : 1}
          value={text}
          placeholder={running ? 'Escribe para añadir instrucciones…' : 'Describe la tarea. Enter para empezar, Shift+Enter para una línea nueva.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              onNewDraft()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="xcard-footer" ref={footerRef}>
          <div className="xchip-row">
            <button
              className="xicon"
              title="Adjuntar archivos"
              onClick={async () => {
                const picked = await window.api.task.pickFiles(cwd)
                if (picked.length) setFiles([...new Set([...files, ...picked])])
              }}
            >
              <Paperclip size={16} aria-hidden />
            </button>
            <ModelPicker config={config} onChange={onConfig} />
            {!compact && (
              <Chip
                label={plan ? 'Plan' : 'Build'}
                active={plan}
                title="Build: el agente hace cambios · Plan: solo investiga y propone un plan"
                onClick={() => onConfig({ ...config, mode: plan ? 'build' : 'plan' })}
              />
            )}
            <SettingsChip config={config} onChange={onConfig} compact={compact} />
          </div>
          <div className="xcard-actions">
            <span ref={slashAnchor} className="xchip-slot">
              <button className="xicon mono" title="Comandos y skills" onMouseDown={(e) => e.preventDefault()} onClick={() => setSlash(!slash)}>
                /
              </button>
              {slash && (
                <ChipMenu
                  items={SLASH[config.provider].map(([cmd, desc]) => ({ value: cmd, label: cmd, detail: desc }))}
                  selected={[]}
                  anchorRef={slashAnchor}
                  width={320}
                  onPick={(cmd) => {
                    setText(cmd + (text ? ' ' + text : ' '))
                    ref.current?.focus()
                  }}
                  onClose={() => setSlash(false)}
                />
              )}
            </span>
            {dictating ? (
              <button className="xlisten" title="Terminar el dictado" onMouseDown={(e) => e.preventDefault()} onClick={() => window.api.voice.stop(false)}>
                <Stop size={11} weight="fill" aria-hidden />
                {voice.phase === 'transcribing' ? 'Transcribiendo…' : 'Escuchando'}
              </button>
            ) : (
              <button
                className="xicon"
                title="Dictar en este cuadro"
                // Sin robar el foco: el texto dictado se escribe donde está el cursor.
                onMouseDown={(e) => {
                  e.preventDefault()
                  ref.current?.focus()
                }}
                onClick={() => {
                  setMine(true)
                  window.api.voice.toggle('dictate')
                }}
              >
                <Microphone size={15} weight="fill" aria-hidden />
              </button>
            )}
            {running && config.provider !== 'claude' ? (
              <button className="xstart stop" onClick={onStop}>
                <Stop size={11} weight="fill" aria-hidden /> Detener
              </button>
            ) : (
              <>
                {running && (
                  <button className="xicon" title="Detener" onClick={onStop}>
                    <Stop size={13} weight="fill" aria-hidden />
                  </button>
                )}
                {dictating ? (
                  <button
                    className="xstart"
                    title="Termina de dictar y envía lo dictado"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setStartAfter(true)
                      window.api.voice.stop(false)
                    }}
                  >
                    Parar y {running ? 'enviar' : 'empezar'} <span className="xkey">↵</span>
                  </button>
                ) : (
                  <button className="xstart" disabled={!text.trim()} onClick={submit}>
                    {running ? 'Enviar' : 'Empezar'} <span className="xkey">↵</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {strip}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversación

function ToolRow({ item }: { item: Extract<TaskItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`tk-tool ${item.status}`}>
      <button className="tk-tool-head" onClick={() => item.output && setOpen(!open)}>
        <span className="tk-tool-state">{item.status === 'running' ? <span className="spinner" /> : item.status === 'error' ? '✗' : '✓'}</span>
        <span className="tk-tool-name">{item.name}</span>
        <span className="tk-tool-title" title={item.title}>
          {item.title}
        </span>
        {item.output && <span className="muted small">{open ? '▴' : '▾'}</span>}
      </button>
      {open && item.output && <pre className="tk-tool-out">{item.output}</pre>}
    </div>
  )
}

/** Claude te pregunta algo con opciones (AskUserQuestion): se contesta aquí, no es un permiso. */
function QuestionCard({ item, panelId }: { item: Extract<TaskItem, { kind: 'approval' }>; panelId: string }) {
  const questions = item.questions ?? []
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const pending = item.state === 'pending'

  const answerFor = (i: number): string => {
    const free = (other[i] ?? '').trim()
    return free || (picked[i] ?? []).join(', ')
  }
  const ready = questions.every((_, i) => answerFor(i))

  const toggle = (i: number, label: string, multi: boolean) => {
    setOther((o) => ({ ...o, [i]: '' }))
    setPicked((p) => {
      const cur = p[i] ?? []
      if (!multi) return { ...p, [i]: [label] }
      return { ...p, [i]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] }
    })
  }

  const submit = () => {
    const answers: Record<string, string> = {}
    questions.forEach((q, i) => (answers[q.question] = answerFor(i)))
    void window.api.task.answer(panelId, item.id, answers)
  }

  return (
    <div className={`tk-ask ${item.state}`}>
      {questions.map((q, i) => (
        <div key={q.question} className="tk-ask-q">
          {q.header && <span className="tk-ask-tag">{q.header}</span>}
          <div className="tk-ask-text">{q.question}</div>
          {pending ? (
            <>
              <div className="tk-ask-options">
                {q.options.map((o) => {
                  const on = (picked[i] ?? []).includes(o.label) && !(other[i] ?? '').trim()
                  return (
                    <button key={o.label} className={`tk-ask-opt ${on ? 'on' : ''}`} onClick={() => toggle(i, o.label, !!q.multiSelect)}>
                      <strong>{o.label}</strong>
                      {o.description && <span className="muted small">{o.description}</span>}
                    </button>
                  )
                })}
              </div>
              <input
                className="tk-ask-other"
                placeholder="Otra respuesta…"
                value={other[i] ?? ''}
                onChange={(e) => setOther((o) => ({ ...o, [i]: e.target.value }))}
              />
            </>
          ) : (
            <div className="tk-ask-answer">{item.answers?.[q.question] ?? (item.state === 'denied' ? 'Sin respuesta' : '')}</div>
          )}
        </div>
      ))}
      {pending && (
        <div className="row">
          <button className="btn small primary" disabled={!ready} onClick={submit}>
            Responder
          </button>
        </div>
      )}
    </div>
  )
}

/** Plan propuesto por Claude (ExitPlanMode): «Implementar» lo ejecuta en Build con el acceso elegido. */
function PlanCard({ item, panelId, onImplement }: { item: Extract<TaskItem, { kind: 'approval' }>; panelId: string; onImplement: (approvalId: string | null) => void }) {
  return (
    <div className={`tk-plan ${item.state}`}>
      <div className="tk-approval-head">
        <strong>{item.state === 'pending' ? 'Plan propuesto' : item.state === 'allowed' ? 'Plan aprobado' : 'Plan rechazado'}</strong>
      </div>
      <div className="tk-plan-body tk-text markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.plan ?? ''}</ReactMarkdown>
      </div>
      {item.state === 'pending' && (
        <div className="row">
          <button className="btn small" onClick={() => void window.api.task.approve(panelId, item.id, false)}>
            Seguir planificando
          </button>
          <button className="btn small primary" onClick={() => onImplement(item.id)}>
            Implementar
          </button>
        </div>
      )}
    </div>
  )
}

function Item({ item, panelId, onImplement }: { item: TaskItem; panelId: string; onImplement: (approvalId: string | null) => void }) {
  if (item.kind === 'approval' && item.special === 'question') return <QuestionCard item={item} panelId={panelId} />
  if (item.kind === 'approval' && item.special === 'plan') return <PlanCard item={item} panelId={panelId} onImplement={onImplement} />
  switch (item.kind) {
    case 'user':
      return (
        <div className="tk-user">
          <div className="tk-bubble">{item.text}</div>
          {item.files?.map((f) => (
            <span key={f} className="tk-file">
              📄 {f.split(/[\\/]/).pop()}
            </span>
          ))}
        </div>
      )
    case 'text':
      return (
        <div className={`tk-text markdown ${item.streaming ? 'streaming' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
        </div>
      )
    case 'tool':
      // La pregunta y el plan ya se muestran como tarjetas: la fila de la herramienta sobra.
      return item.name === 'AskUserQuestion' || item.name === 'ExitPlanMode' ? null : <ToolRow item={item} />
    case 'approval':
      return (
        <div className={`tk-approval ${item.state}`}>
          <div className="tk-approval-head">
            <strong>{item.state === 'pending' ? '¿Permitir?' : item.state === 'allowed' ? 'Permitido' : 'Denegado'}</strong>
            <span className="tk-tool-title">{item.title}</span>
          </div>
          <pre className="tk-tool-out">{item.detail}</pre>
          {item.state === 'pending' && (
            <div className="row">
              <button className="btn small" onClick={() => void window.api.task.approve(panelId, item.id, false)}>
                Denegar
              </button>
              <button className="btn small primary" onClick={() => void window.api.task.approve(panelId, item.id, true)}>
                Permitir
              </button>
            </div>
          )}
        </div>
      )
    case 'result':
      return (
        <div className={`tk-result ${item.ok ? 'ok' : 'bad'}`}>
          {item.ok ? '✓ Hecho' : `✗ ${item.text}`}
          {item.durationMs !== undefined && <span> · {Math.max(1, Math.round(item.durationMs / 1000))} s</span>}
          {item.costUsd !== undefined && item.costUsd > 0 && <span> · ${item.costUsd.toFixed(3)}</span>}
        </div>
      )
    case 'error':
      return <div className="tk-error">{item.text}</div>
  }
}

// ---------------------------------------------------------------------------
// Panel

const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

export function TaskPanel({ wsId, panel }: { wsId: string; panel: Panel }) {
  const defaults = useApp((s) => s.settings?.taskDefaults)
  const config: TaskConfig = panel.task ?? defaults ?? { provider: 'claude', model: '', mode: 'build', access: 'full-access' }
  const [items, setItems] = useState<TaskItem[]>([])
  const [running, setRunning] = useState(false)
  const [folderOk, setFolderOk] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const cwd = panel.cwd ?? ''
  const projectName = useApp((s) => s.workspaces.find((w) => w.id === wsId)?.name) ?? (cwd.split(/[\\/]/).filter(Boolean).pop() || 'tu proyecto')

  useEffect(() => {
    let alive = true
    if (!panel.task) useApp.getState().updatePanel(wsId, panel.id, { task: config })
    void window.api.task.open(panel.id, wsId, panel.title, cwd, config).then((snap) => {
      if (!alive) return
      setItems(snap.items)
      setRunning(snap.running)
    })
    void window.api.fs.list(cwd).then(
      () => alive && setFolderOk(true),
      () => alive && setFolderOk(false)
    )
    const off = window.api.task.onEvent((ev) => {
      if (ev.panelId !== panel.id) return
      if (ev.type === 'running') setRunning(ev.running)
      else if (ev.type === 'item')
        setItems((list) => {
          const i = list.findIndex((x) => x.id === ev.item.id && x.kind === ev.item.kind)
          if (i < 0) return [...list, ev.item]
          const next = [...list]
          next[i] = ev.item
          return next
        })
      else if (ev.type === 'delta')
        setItems((list) => list.map((x) => (x.id === ev.id && x.kind === 'text' ? { ...x, text: x.text + ev.text } : x)))
    })
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, cwd])

  // Mantener el scroll abajo mientras llega texto, salvo que el usuario haya subido.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

  function setConfig(next: TaskConfig) {
    useApp.getState().updatePanel(wsId, panel.id, { task: next })
    void window.api.task.setConfig(panel.id, next)
    void window.api.settings.set({ taskDefaults: next }).then((s) => useApp.getState().setSettings(s))
  }

  function newDraft() {
    const id = useApp.getState().addPanel(wsId, { type: 'task', task: config })
    useApp.getState().reveal(id)
  }

  /** Pasa de Plan a Build con el acceso elegido y le pide al agente que ejecute el plan. */
  function implement(approvalId: string | null) {
    setConfig({ ...config, mode: 'build' })
    void window.api.task.implementPlan(panel.id, approvalId).catch((err) => useApp.getState().toast(errMsg(err), 'error'))
  }

  // Tras un turno de planificación terminado (y sin tarjeta de plan pendiente), se ofrece implementarlo.
  const last = items[items.length - 1]
  const planPending = items.some((i) => i.kind === 'approval' && i.state === 'pending')
  const planReady = config.mode === 'plan' && !running && !planPending && last?.kind === 'result' && last.ok

  async function send(text: string, files: string[]) {
    if (!items.some((i) => i.kind === 'user')) {
      const title = text.split('\n')[0].slice(0, 50)
      useApp.getState().updatePanel(wsId, panel.id, { title })
    }
    try {
      await window.api.task.send(panel.id, text, files)
    } catch (err) {
      useApp.getState().toast(errMsg(err), 'error')
    }
  }

  const empty = items.length === 0

  return (
    <div className="task-panel">
      {empty ? (
        <div className="tk-empty">
          {!folderOk && (
            <div className="tk-note">
              <span className="dot dot-waiting" /> Un agente necesita un proyecto donde trabajar.{' '}
              <button className="link" onClick={() => useApp.getState().setNewWorkspaceOpen(true)}>
                Abrir una carpeta →
              </button>
            </div>
          )}
          <h2 className="xhero" title={cwd}>
            ¿Qué construimos en <span className="xhero-project">{projectName}</span>?
          </h2>
          <Composer
            config={config}
            onConfig={setConfig}
            running={running}
            cwd={cwd}
            onSend={send}
            onStop={() => void window.api.task.stop(panel.id)}
            onNewDraft={newDraft}
            big
            strip={<BranchStrip wsId={wsId} panel={panel} />}
          />
        </div>
      ) : (
        <>
          <div
            className="tk-thread"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {items.map((it) => (
              <Item key={`${it.kind}:${it.id}`} item={it} panelId={panel.id} onImplement={implement} />
            ))}
            {running && (
              <div className="tk-working">
                <span className="spinner" /> {PROVIDERS.find((p) => p.id === config.provider)?.name} está trabajando…
              </div>
            )}
            {planReady && (
              <div className="tk-plan-ready">
                <span>Plan listo. ¿Lo ejecuto?</span>
                <button className="btn small primary" onClick={() => implement(null)}>
                  Implementar
                </button>
              </div>
            )}
          </div>
          <Composer config={config} onConfig={setConfig} running={running} cwd={cwd} onSend={send} onStop={() => void window.api.task.stop(panel.id)} onNewDraft={newDraft} big={false} />
        </>
      )}
    </div>
  )
}
