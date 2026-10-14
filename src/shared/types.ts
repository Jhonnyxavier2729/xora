// Tipos compartidos entre main, preload, renderer y el cliente remoto.

export type PanelType = 'task' | 'terminal' | 'agent' | 'editor' | 'browser' | 'notes' | 'git'

// ---------------------------------------------------------------------------
// Tareas: conversación estructurada con Claude Code, Codex u OpenCode.

export type TaskProvider = 'claude' | 'codex' | 'opencode'
export type TaskMode = 'build' | 'plan'
export type TaskAccess = 'approval-required' | 'auto-accept-edits' | 'auto' | 'full-access'

export interface TaskConfig {
  provider: TaskProvider
  /** Vacío = modelo predeterminado del agente. */
  model: string
  mode: TaskMode
  access: TaskAccess
  /** Esfuerzo de razonamiento (los niveles dependen del modelo). Vacío = el que trae el agente. */
  effort?: string
  /** Modo rápido (solo algunos modelos de Claude: respuestas más rápidas, más caras). */
  fast?: boolean
  /** Ventana de contexto de Claude: '200k' o '1m'. */
  context?: string
  /** Interruptor «pensar siempre» (solo Haiku 4.5, que no tiene niveles). */
  thinking?: boolean
}

export interface TaskModel {
  id: string
  label: string
  /** Niveles de esfuerzo/razonamiento que admite este modelo, de menos a más. */
  efforts?: string[]
  defaultEffort?: string
  /** Admite modo rápido. */
  fast?: boolean
  /** Ventanas de contexto entre las que se puede elegir, y la que usa por defecto. */
  contexts?: string[]
  defaultContext?: string
  /** En vez de niveles, un único interruptor de «pensar». */
  thinkingToggle?: boolean
}

export type TaskModels = Record<TaskProvider, TaskModel[]>

/** Pregunta con opciones que Claude hace al usuario (herramienta AskUserQuestion). */
export interface AskQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

export type TaskItem =
  | { kind: 'user'; id: string; text: string; files?: string[] }
  | { kind: 'text'; id: string; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; name: string; title: string; status: 'running' | 'done' | 'error'; output?: string }
  | {
      kind: 'approval'
      id: string
      tool: string
      title: string
      detail: string
      state: 'pending' | 'allowed' | 'denied'
      /** question: Claude te hace una pregunta con opciones · plan: Claude propone un plan para aprobar. */
      special?: 'question' | 'plan'
      questions?: AskQuestion[]
      plan?: string
      answers?: Record<string, string>
    }
  | { kind: 'result'; id: string; ok: boolean; text: string; costUsd?: number; durationMs?: number }
  | { kind: 'error'; id: string; text: string }

export interface TaskSnapshot {
  panelId: string
  config: TaskConfig
  cwd: string
  items: TaskItem[]
  running: boolean
  sessionId: string | null
}

export type TaskEvent = { panelId: string } & (
  | { type: 'item'; item: TaskItem }
  | { type: 'delta'; id: string; text: string }
  | { type: 'running'; running: boolean }
  | { type: 'session'; sessionId: string }
)

export interface AccountStatus {
  id: TaskProvider
  signedIn: boolean
  /** Correo o descripción de la cuenta. */
  label: string | null
  /** El agente usa tu clave de API en lugar de la sesión. */
  usesApiKey: boolean
}

/** Xora trabaja con tres agentes: Claude Code, Codex y OpenCode (más un comando propio si quieres). */
export type AgentId = 'claude' | 'codex' | 'opencode' | 'custom'

export interface Panel {
  id: string
  type: PanelType
  title: string
  x: number
  y: number
  w: number
  h: number
  z: number
  /** Carpeta de trabajo del panel (terminal/agente/editor/git). Por defecto, la raíz del workspace. */
  cwd?: string
  /** Agente que corre en un panel 'agent'. */
  agent?: AgentId
  /** Comando personalizado para agent === 'custom'. */
  command?: string
  /** Rama del worktree si el panel trabaja aislado. */
  worktreeBranch?: string
  url?: string
  file?: string
  /** Color de las notas tipo pósit. */
  color?: NoteColor
  /** Configuración de un panel de tarea. */
  task?: TaskConfig
}

/** Actualización de un agente (Claude Code, Codex u OpenCode). */
export interface AgentUpdateItem {
  id: AgentId
  installed: string | null
  latest: string | null
  /** available: hay versión nueva · updating: instalando · done: recién actualizado · error: falló. */
  status: 'idle' | 'available' | 'updating' | 'done' | 'error'
  message?: string
  /** Agentes de este tipo abiertos al terminar: siguen con la versión anterior hasta reiniciarlos. */
  running: number
}

/** Estado del actualizador (como Deska: avisar, descargar con progreso y reiniciar). */
export type UpdateStatus =
  | { state: 'idle'; current: string }
  | { state: 'checking'; current: string }
  | { state: 'latest'; current: string }
  | { state: 'available'; current: string; version: string; canSelfInstall: boolean }
  | { state: 'downloading'; current: string; version: string; percent: number }
  | { state: 'downloaded'; current: string; version: string }
  | { state: 'error'; current: string; message: string; version?: string }

/** Ventana de uso de una suscripción (sesión de 5 h o semana). */
export interface UsageWindow {
  kind: 'session' | 'week'
  usedPercent: number
  resetsAt: number | null
}

export interface AgentUsage {
  plan?: string
  windows: UsageWindow[]
  problem?: 'signed-out' | 'expired' | 'api-key' | 'rate-limited' | 'unreachable'
}

export interface UsageReport {
  claude: AgentUsage
  codex: AgentUsage
  updatedAt: number
}

/** Resumen de una nota para el menú Extras. */
export interface NoteSummary {
  wsId: string
  panelId: string
  /** Primera línea con texto, sin marcas de Markdown. */
  title: string
  updatedAt: number
}

export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue' | 'dark'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface Workspace {
  id: string
  name: string
  root: string
  panels: Panel[]
  viewport: Viewport
  updatedAt: number
}

export type PtyStatus = 'working' | 'waiting' | 'idle' | 'exited'

export interface PtyInfo {
  id: string
  workspaceId: string
  kind: 'terminal' | 'agent'
  agent?: AgentId
  title: string
  cwd: string
  status: PtyStatus
  /** true cuando el agente parece pedir una aprobación (y/n, Allow, etc.). */
  needsApproval: boolean
  lastOutputAt: number
  exitCode?: number
}

export interface EnsurePtyOptions {
  id: string
  workspaceId: string
  kind: 'terminal' | 'agent'
  agent?: AgentId
  command?: string
  title: string
  cwd: string
  cols: number
  rows: number
}

export interface AgentDefinition {
  id: AgentId
  name: string
  /** Comando que se escribe en el shell para arrancar el agente. */
  command: string
  installHint: string
}

export const AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex', command: 'codex', installHint: 'npm install -g @openai/codex' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', installHint: 'npm install -g opencode-ai' },
]

export interface FileEntry {
  name: string
  path: string
  dir: boolean
}

export interface GitFileStatus {
  path: string
  index: string
  workingDir: string
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export interface Worktree {
  path: string
  branch: string
  head: string
  main: boolean
}

export type SttProvider = 'groq' | 'openai'

/** Quién pone la voz a Xen: la de Windows/macOS (gratis) u OpenAI (natural, con tu clave). */
export type TtsProvider = 'system' | 'openai'

/** Voces de OpenAI (gpt-4o-mini-tts). Todas hablan español con naturalidad. */
export const OPENAI_TTS_VOICES: { id: string; label: string }[] = [
  { id: 'marin', label: 'Marin · cálida y natural' },
  { id: 'cedar', label: 'Cedar · tranquila y clara' },
  { id: 'coral', label: 'Coral · cercana y alegre' },
  { id: 'sage', label: 'Sage · serena' },
  { id: 'nova', label: 'Nova · enérgica' },
  { id: 'shimmer', label: 'Shimmer · suave' },
  { id: 'ash', label: 'Ash · grave y firme' },
  { id: 'ballad', label: 'Ballad · expresiva' },
  { id: 'verse', label: 'Verse · directa' },
  { id: 'echo', label: 'Echo · neutra' },
  { id: 'onyx', label: 'Onyx · profunda' },
  { id: 'alloy', label: 'Alloy · equilibrada' }
]

export interface Settings {
  sttProvider: SttProvider
  /** Tecla para mantener pulsada y hablar (nombre de UiohookKey). */
  holdKey: string
  /** Atajo global alternativo para alternar la grabación. */
  toggleShortcut: string
  speakReplies: boolean
  /** Último workspace abierto: Xora se reabre ahí. */
  lastWorkspaceId: string
  /** Motor de voz para las respuestas de Xen. */
  ttsProvider: TtsProvider
  /** Voz de OpenAI (id de OPENAI_TTS_VOICES). */
  ttsVoice: string
  /** Nombre de la voz del sistema; vacío = la primera en el idioma elegido. */
  systemVoice: string
  /** Velocidad de lectura, 0.7–1.5. */
  speechRate: number
  language: string
  remotePort: number
  shell: string
  notifyOnWaiting: boolean
  /** Tema de color de la interfaz (id de THEMES en el renderer). */
  theme: string
  /** Color de acento (hex). */
  accent: string
  /** Fondo del lienzo: 'none', 'builtin:<id>' o 'file' (imagen elegida por el usuario). */
  wallpaper: string
  /** Versión de la imagen de fondo, para invalidar la caché al cambiarla. */
  wallpaperVersion: number
  /** Oscurecido del fondo, 0–90 (%). */
  wallpaperDim: number
  /** Opacidad de los paneles, 70–100 (%). */
  panelOpacity: number
  /** Quién responde por Xen, en orden de prioridad (si uno falla se prueba el siguiente). */
  xenProviders: XenProviderConfig[]
  /** Xen ejecuta acciones sin pedir confirmación. */
  xenActWithoutAsking: boolean
  /** Lanzar cada agente sin que pida permiso en cada paso. */
  agentAutonomy: Partial<Record<AgentId, boolean>>
  checkAgentUpdates: boolean
  terminalFontSize: number
  editorFontSize: number
  editorMinimap: boolean
  browserHome: string
  defaultNoteColor: NoteColor
  showMinimap: boolean
  gitRefreshSeconds: number
  /** Carpeta donde se clonan repositorios por defecto. */
  cloneDir: string
  /** Usar tu clave de API en lugar de la sesión del agente. */
  agentUseApiKey: Partial<Record<TaskProvider, boolean>>
  /** Configuración inicial de las tareas nuevas. */
  taskDefaults: TaskConfig
}

export type XenProviderId = 'claude-cli' | 'codex-cli' | 'opencode-cli' | 'api'

export interface XenProviderConfig {
  id: XenProviderId
  /** Modelo; vacío = el predeterminado del proveedor. */
  model: string
}

export interface XenProviderStatus {
  id: XenProviderId
  ready: boolean
  detail: string
}

/** Banderas de autonomía que se añaden al lanzar cada agente en una terminal. */
export const AUTONOMY_FLAGS: Partial<Record<AgentId, string>> = {
  claude: '--dangerously-skip-permissions',
  // Lo que antes era --full-auto (Codex lo quitó): trabaja en la carpeta sin pedir permiso, dentro del sandbox.
  codex: '--sandbox workspace-write --ask-for-approval never'
}

export interface AgentVersionInfo {
  id: AgentId
  installed: string | null
  latest: string | null
  updateCommand: string | null
}

export interface RecentProject {
  path: string
  name: string
  branch: string | null
  exists: boolean
  openedAt: number
}

export interface GithubRepo {
  nameWithOwner: string
  url: string
  description: string
  isPrivate: boolean
  updatedAt: string
}

export interface AppInfo {
  user: string
  version: string
  electron: string
  node: string
  platform: string
  userData: string
}

export const DEFAULT_SETTINGS: Settings = {
  sttProvider: 'groq',
  holdKey: 'CtrlRight',
  toggleShortcut: 'CommandOrControl+Shift+Space',
  speakReplies: false,
  lastWorkspaceId: '',
  ttsProvider: 'system',
  ttsVoice: 'marin',
  systemVoice: '',
  speechRate: 1,
  language: 'es',
  remotePort: 47321,
  shell: '',
  notifyOnWaiting: true,
  theme: 'graphite',
  accent: '#ff6b4a',
  wallpaper: 'builtin:assembly',
  wallpaperVersion: 0,
  wallpaperDim: 35,
  panelOpacity: 100,
  xenProviders: [
    { id: 'claude-cli', model: 'opus' },
    { id: 'codex-cli', model: '' },
    { id: 'opencode-cli', model: '' }
  ],
  xenActWithoutAsking: true,
  agentAutonomy: {},
  checkAgentUpdates: true,
  terminalFontSize: 13,
  editorFontSize: 13,
  editorMinimap: false,
  browserHome: '',
  defaultNoteColor: 'yellow',
  showMinimap: true,
  gitRefreshSeconds: 5,
  cloneDir: '',
  agentUseApiKey: {},
  taskDefaults: { provider: 'claude', model: 'claude-opus-5-5', mode: 'build', access: 'full-access' }
}

export const SECRET_NAMES = ['anthropic', 'openai', 'groq', 'gemini', 'openrouter'] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export type SecretStatus = Record<SecretName, boolean>

export interface RemoteDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
}

export interface RemoteState {
  enabled: boolean
  port: number
  lanUrls: string[]
  tunnelUrl: string | null
  tunnelStatus: 'off' | 'starting' | 'on' | 'missing' | 'error'
  pairCode: string | null
  pairExpiresAt: number | null
  pairUrl: string | null
  pairQr: string | null
  devices: RemoteDevice[]
  connectedClients: number
}

export type VoiceState =
  | { phase: 'idle' }
  | { phase: 'listening' }
  | { phase: 'transcribing' }
  | { phase: 'thinking'; transcript: string }
  | { phase: 'done'; transcript: string; reply: string }
  | { phase: 'error'; message: string }

export interface XenAction {
  tool: string
  summary: string
}

export interface XenResult {
  reply: string
  actions: XenAction[]
}

/** Mensajes del canal WebSocket remoto. */
export type RemoteClientMessage =
  | { t: 'attach'; ptyId: string; cols?: number; rows?: number }
  | { t: 'detach'; ptyId: string }
  | { t: 'input'; ptyId: string; data: string }
  | { t: 'resize'; ptyId: string; cols: number; rows: number }

export type RemoteServerMessage =
  | { t: 'state'; workspaces: RemoteWorkspaceSummary[]; ptys: PtyInfo[] }
  | { t: 'pty-status'; info: PtyInfo }
  | { t: 'data'; ptyId: string; data: string }
  | { t: 'replay'; ptyId: string; data: string }
  | { t: 'exit'; ptyId: string; code: number }
  | { t: 'attention'; ptyId: string; title: string; message: string }

export interface RemoteWorkspaceSummary {
  id: string
  name: string
  root: string
  panels: Pick<Panel, 'id' | 'type' | 'title' | 'agent'>[]
}

/** Peticiones de main → renderer para mutar el lienzo (Xen y acceso remoto). */
export type CanvasCommand =
  | { kind: 'create-panel'; requestId: string; workspaceId: string; panel: Partial<Panel> & { type: PanelType } }
  | { kind: 'focus-panel'; workspaceId: string; panelId: string }
  | { kind: 'open-workspace'; workspaceId: string }
