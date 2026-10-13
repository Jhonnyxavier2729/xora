import { create } from 'zustand'
import type { Panel, PanelType, PtyInfo, RemoteState, Settings, Viewport, VoiceState, Workspace } from '@shared/types'
import { AGENTS } from '@shared/types'

export const PANEL_SIZES: Record<PanelType, { w: number; h: number }> = {
  task: { w: 640, h: 720 },
  terminal: { w: 720, h: 440 },
  agent: { w: 780, h: 540 },
  editor: { w: 960, h: 620 },
  browser: { w: 960, h: 640 },
  notes: { w: 480, h: 520 },
  git: { w: 780, h: 580 }
}

export const PANEL_LABELS: Record<PanelType, string> = {
  task: 'Nueva tarea',
  terminal: 'Terminal',
  agent: 'Agente',
  editor: 'Editor',
  browser: 'Navegador',
  notes: 'Notas',
  git: 'Git'
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

function defaultTitle(panel: Partial<Panel> & { type: PanelType }): string {
  if (panel.type === 'agent') {
    const name = AGENTS.find((a) => a.id === panel.agent)?.name ?? panel.command ?? 'Agente'
    return panel.worktreeBranch ? `${name} · ${panel.worktreeBranch}` : name
  }
  return PANEL_LABELS[panel.type]
}

interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'attention'
  panelId?: string
}

interface AppState {
  loaded: boolean
  workspaces: Workspace[]
  activeId: string | null
  ptys: Record<string, PtyInfo>
  focusedPanelId: string | null
  /** Panel que el lienzo debe centrar en el próximo render. */
  revealPanelId: string | null
  dragging: boolean
  toasts: Toast[]
  settingsOpen: boolean
  settingsTab: string
  newWorkspaceOpen: boolean
  setNewWorkspaceOpen(v: boolean): void
  importWorkspace(ws: Workspace): void
  settings: Settings | null
  remote: RemoteState | null
  voice: VoiceState
  voiceMode: 'xen' | 'dictate'
  /** Paneles seleccionados (se mueven juntos). */
  selected: string[]
  lookOpen: { x: number; y: number } | null
  /** Paneles que se están arrastrando: se ocultan y los sigue un fantasma desplazado (dx, dy). */
  dragGhost: { ids: string[]; dx: number; dy: number } | null
  setDragGhost(ghost: { ids: string[]; dx: number; dy: number } | null): void

  setVoice(state: VoiceState, mode?: 'xen' | 'dictate'): void
  setSelected(ids: string[]): void
  openLook(at: { x: number; y: number } | null): void

  load(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  setSettings(s: Settings): void
  setRemote(r: RemoteState): void
  openSettings(tab?: AppState['settingsTab']): void
  addWorkspace(root: string, name: string): string
  removeWorkspace(id: string): void
  renameWorkspace(id: string, name: string): void
  openWorkspace(id: string | null): void
  addPanel(wsId: string, panel: Partial<Panel> & { type: PanelType }): string
  updatePanel(wsId: string, panelId: string, patch: Partial<Panel>): void
  removePanel(wsId: string, panelId: string): void
  bringToFront(wsId: string, panelId: string): void
  setViewport(wsId: string, vp: Viewport): void
  reveal(panelId: string | null): void
  setPty(info: PtyInfo): void
  setDragging(v: boolean): void
  toast(text: string, kind?: Toast['kind'], panelId?: string): void
  dismissToast(id: string): void
  setSettingsOpen(v: boolean): void
}

export const useApp = create<AppState>((set, get) => ({
  loaded: false,
  workspaces: [],
  activeId: null,
  ptys: {},
  focusedPanelId: null,
  revealPanelId: null,
  dragging: false,
  toasts: [],
  settingsOpen: false,
  settingsTab: 'xen',
  newWorkspaceOpen: false,

  setNewWorkspaceOpen(v) {
    set({ newWorkspaceOpen: v })
  },

  importWorkspace(ws) {
    set({ workspaces: [...get().workspaces, ws] })
  },
  settings: null,
  remote: null,
  voice: { phase: 'idle' },
  voiceMode: 'xen',
  selected: [],
  lookOpen: null,
  dragGhost: null,

  setDragGhost(dragGhost) {
    set({ dragGhost })
  },

  setVoice(voice, mode) {
    set({ voice, voiceMode: mode ?? get().voiceMode })
  },

  setSelected(selected) {
    set({ selected })
  },

  openLook(lookOpen) {
    set({ lookOpen })
  },

  async load() {
    const [workspaces, ptyList, settings, remote] = await Promise.all([
      window.api.workspaces.load(),
      window.api.pty.list(),
      window.api.settings.get(),
      window.api.remote.state()
    ])
    set({ workspaces, ptys: Object.fromEntries(ptyList.map((p) => [p.id, p])), settings, remote, loaded: true })
  },

  async updateSettings(patch) {
    try {
      set({ settings: await window.api.settings.set(patch) })
    } catch (err) {
      get().toast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err), 'error')
    }
  },

  setSettings(settings) {
    set({ settings })
  },

  setRemote(remote) {
    set({ remote })
  },

  openSettings(tab) {
    set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab })
  },

  addWorkspace(root, name) {
    const existing = get().workspaces.find((w) => w.root.toLowerCase() === root.toLowerCase())
    if (existing) return existing.id
    const ws: Workspace = { id: uid(), name, root, panels: [], viewport: { x: 120, y: 90, zoom: 1 }, updatedAt: Date.now() }
    set({ workspaces: [...get().workspaces, ws] })
    return ws.id
  },

  removeWorkspace(id) {
    const ws = get().workspaces.find((w) => w.id === id)
    ws?.panels.forEach((p) => void window.api.pty.kill(p.id))
    set({ workspaces: get().workspaces.filter((w) => w.id !== id), activeId: get().activeId === id ? null : get().activeId })
  },

  renameWorkspace(id, name) {
    set({ workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })
  },

  openWorkspace(id) {
    set({ activeId: id, focusedPanelId: null, selected: [] })
    const ws = id ? get().workspaces.find((w) => w.id === id) : null
    if (ws) void window.api.workspaces.touch(ws.root)
  },

  addPanel(wsId, partial) {
    const ws = get().workspaces.find((w) => w.id === wsId)
    if (!ws) throw new Error('Workspace no encontrado')
    const size = PANEL_SIZES[partial.type]
    const maxZ = ws.panels.reduce((m, p) => Math.max(m, p.z), 0)
    // Coloca el panel en el centro de la vista actual, escalonado respecto a los anteriores.
    const vp = ws.viewport
    const viewW = window.innerWidth
    const viewH = window.innerHeight
    const cx = (viewW / 2 - vp.x) / vp.zoom
    const cy = (viewH / 2 - vp.y) / vp.zoom
    const offset = (ws.panels.length % 6) * 32
    const panel: Panel = {
      id: uid(),
      title: defaultTitle(partial),
      x: Math.round(cx - size.w / 2 + offset),
      y: Math.round(cy - size.h / 2 + offset),
      w: size.w,
      h: size.h,
      z: maxZ + 1,
      cwd: ws.root,
      ...(partial.type === 'notes' ? { color: get().settings?.defaultNoteColor ?? 'yellow' } : {}),
      ...partial
    }
    set({
      workspaces: get().workspaces.map((w) =>
        w.id === wsId ? { ...w, panels: [...w.panels, panel], updatedAt: Date.now() } : w
      ),
      focusedPanelId: panel.id
    })
    return panel.id
  },

  updatePanel(wsId, panelId, patch) {
    set({
      workspaces: get().workspaces.map((w) =>
        w.id === wsId ? { ...w, panels: w.panels.map((p) => (p.id === panelId ? { ...p, ...patch } : p)) } : w
      )
    })
  },

  removePanel(wsId, panelId) {
    void window.api.pty.kill(panelId)
    void window.api.task.close(panelId)
    set({
      workspaces: get().workspaces.map((w) =>
        w.id === wsId ? { ...w, panels: w.panels.filter((p) => p.id !== panelId) } : w
      ),
      focusedPanelId: get().focusedPanelId === panelId ? null : get().focusedPanelId
    })
  },

  bringToFront(wsId, panelId) {
    const ws = get().workspaces.find((w) => w.id === wsId)
    if (!ws) return
    const maxZ = ws.panels.reduce((m, p) => Math.max(m, p.z), 0)
    const panel = ws.panels.find((p) => p.id === panelId)
    if (panel && panel.z === maxZ && get().focusedPanelId === panelId) return
    get().updatePanel(wsId, panelId, { z: panel && panel.z === maxZ ? panel.z : maxZ + 1 })
    set({ focusedPanelId: panelId })
  },

  setViewport(wsId, vp) {
    set({ workspaces: get().workspaces.map((w) => (w.id === wsId ? { ...w, viewport: vp } : w)) })
  },

  reveal(panelId) {
    set({ revealPanelId: panelId })
  },

  setPty(info) {
    set({ ptys: { ...get().ptys, [info.id]: info } })
  },

  setDragging(v) {
    set({ dragging: v })
  },

  toast(text, kind = 'info', panelId) {
    const id = uid()
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind, panelId }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 5000)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  setSettingsOpen(v) {
    set({ settingsOpen: v })
  }
}))

/** Busca el workspace al que pertenece un panel. */
export function findPanel(panelId: string): { ws: Workspace; panel: Panel } | null {
  for (const ws of useApp.getState().workspaces) {
    const panel = ws.panels.find((p) => p.id === panelId)
    if (panel) return { ws, panel }
  }
  return null
}

// Persistencia: guarda los workspaces en main (con debounce) cada vez que cambian.
let saveTimer: ReturnType<typeof setTimeout> | null = null
useApp.subscribe((state, prev) => {
  if (!state.loaded || state.workspaces === prev.workspaces) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.workspaces.save(useApp.getState().workspaces), 400)
})
