import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AccountStatus,
  TaskConfig,
  TaskEvent,
  TaskModels,
  TaskProvider,
  TaskSnapshot,
  AgentId,
  AgentVersionInfo,
  AppInfo,
  GithubRepo,
  RecentProject,
  XenProviderStatus,
  CanvasCommand,
  XenResult,
  EnsurePtyOptions,
  FileEntry,
  GitStatus,
  NoteSummary,
  PtyInfo,
  UsageReport,
  RemoteState,
  SecretName,
  SecretStatus,
  Settings,
  VoiceState,
  Workspace,
  Worktree
} from '@shared/types'

function on<T extends unknown[]>(channel: string, fn: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => fn(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  workspaces: {
    load: (): Promise<Workspace[]> => ipcRenderer.invoke('workspaces:load'),
    save: (ws: Workspace[]): Promise<void> => ipcRenderer.invoke('workspaces:save', ws),
    pickFolder: (): Promise<{ root: string; name: string } | null> => ipcRenderer.invoke('workspaces:pickFolder'),
    recents: (): Promise<RecentProject[]> => ipcRenderer.invoke('workspaces:recents'),
    forgetRecent: (path: string): Promise<void> => ipcRenderer.invoke('workspaces:forgetRecent', path),
    touch: (path: string): Promise<void> => ipcRenderer.invoke('workspaces:touch', path),
    githubRepos: (): Promise<GithubRepo[]> => ipcRenderer.invoke('workspaces:githubRepos'),
    clone: (url: string, parent?: string): Promise<{ root: string; name: string }> => ipcRenderer.invoke('workspaces:clone', url, parent),
    blank: (): Promise<{ root: string; name: string }> => ipcRenderer.invoke('workspaces:blank'),
    defaultCloneDir: (): Promise<string> => ipcRenderer.invoke('workspaces:defaultCloneDir'),
    pickCloneDir: (): Promise<string | null> => ipcRenderer.invoke('workspaces:pickCloneDir'),
    exportCanvas: (ws: Workspace): Promise<boolean> => ipcRenderer.invoke('workspaces:export', ws),
    importCanvas: (): Promise<Workspace | null> => ipcRenderer.invoke('workspaces:import')
  },
  canvas: {
    onCommand: (fn: (cmd: CanvasCommand) => void) => on('canvas:command', fn),
    commandResult: (requestId: string, panelId: string | null, error?: string) =>
      ipcRenderer.send('canvas:commandResult', requestId, panelId, error)
  },
  pty: {
    ensure: (opts: EnsurePtyOptions): Promise<{ info: PtyInfo; replay: string }> => ipcRenderer.invoke('pty:ensure', opts),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),
    list: (): Promise<PtyInfo[]> => ipcRenderer.invoke('pty:list'),
    submit: (id: string, text: string): Promise<boolean> => ipcRenderer.invoke('pty:submit', id, text),
    onData: (fn: (id: string, data: string) => void) => on('pty:data', fn),
    onExit: (fn: (id: string, code: number) => void) => on('pty:exit', fn),
    onStatus: (fn: (info: PtyInfo) => void) => on('pty:status', fn),
    onAttention: (fn: (a: { ptyId: string; title: string; message: string }) => void) => on('pty:attention', fn),
    onReveal: (fn: (id: string) => void) => on('pty:reveal', fn),
    onRefit: (fn: (id: string) => void) => on('pty:refit', fn)
  },
  task: {
    open: (panelId: string, wsId: string, title: string, cwd: string, config: TaskConfig): Promise<TaskSnapshot> =>
      ipcRenderer.invoke('task:open', panelId, wsId, title, cwd, config),
    setConfig: (panelId: string, config: TaskConfig): Promise<void> => ipcRenderer.invoke('task:config', panelId, config),
    send: (panelId: string, text: string, files: string[]): Promise<void> => ipcRenderer.invoke('task:send', panelId, text, files),
    approve: (panelId: string, approvalId: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke('task:approve', panelId, approvalId, allow),
    stop: (panelId: string): Promise<void> => ipcRenderer.invoke('task:stop', panelId),
    close: (panelId: string): Promise<void> => ipcRenderer.invoke('task:close', panelId),
    models: (force?: boolean): Promise<TaskModels> => ipcRenderer.invoke('task:models', force),
    pickFiles: (cwd: string): Promise<string[]> => ipcRenderer.invoke('task:pickFiles', cwd),
    onEvent: (fn: (ev: TaskEvent) => void) => on('task:event', fn)
  },
  accounts: {
    status: (): Promise<AccountStatus[]> => ipcRenderer.invoke('accounts:status'),
    loginCommand: (id: TaskProvider): Promise<string> => ipcRenderer.invoke('accounts:loginCommand', id)
  },
  agents: {
    detect: (force?: boolean): Promise<Record<AgentId, boolean>> => ipcRenderer.invoke('agents:detect', force),
    versions: (): Promise<AgentVersionInfo[]> => ipcRenderer.invoke('agents:versions')
  },
  fs: {
    list: (dir: string): Promise<FileEntry[]> => ipcRenderer.invoke('fs:list', dir),
    read: (path: string): Promise<string> => ipcRenderer.invoke('fs:read', path),
    write: (path: string, content: string): Promise<void> => ipcRenderer.invoke('fs:write', path, content)
  },
  notes: {
    read: (wsId: string, panelId: string): Promise<string> => ipcRenderer.invoke('notes:read', wsId, panelId),
    write: (wsId: string, panelId: string, content: string): Promise<void> =>
      ipcRenderer.invoke('notes:write', wsId, panelId, content),
    summaries: (refs: { wsId: string; panelId: string }[]): Promise<NoteSummary[]> => ipcRenderer.invoke('notes:summaries', refs)
  },
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, file?: string): Promise<string> => ipcRenderer.invoke('git:diff', cwd, file),
    commit: (cwd: string, message: string, files?: string[]): Promise<string> =>
      ipcRenderer.invoke('git:commit', cwd, message, files),
    discard: (cwd: string, file: string): Promise<void> => ipcRenderer.invoke('git:discard', cwd, file),
    worktrees: (cwd: string): Promise<Worktree[]> => ipcRenderer.invoke('git:worktrees', cwd),
    createWorktree: (root: string, branch: string): Promise<Worktree> =>
      ipcRenderer.invoke('git:createWorktree', root, branch),
    removeWorktree: (root: string, path: string, force: boolean): Promise<void> =>
      ipcRenderer.invoke('git:removeWorktree', root, path, force)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    pickWallpaper: (): Promise<Settings | null> => ipcRenderer.invoke('wallpaper:pick')
  },
  secrets: {
    status: (): Promise<SecretStatus> => ipcRenderer.invoke('secrets:status'),
    set: (name: SecretName, value: string | null): Promise<SecretStatus> => ipcRenderer.invoke('secrets:set', name, value)
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:openPath', path)
  },
  voice: {
    toggle: (mode: 'xen' | 'dictate' = 'xen') => ipcRenderer.send('voice:toggle', mode),
    onDictation: (fn: (text: string) => void) => on('voice:dictation', fn),
    stop: (cancel?: boolean) => ipcRenderer.send('voice:stop', cancel),
    setTextFocus: (focused: boolean) => ipcRenderer.send('voice:textFocus', focused),
    /** Audio de voz natural para un texto, o null si se usa la voz del sistema. */
    tts: (text: string, voice?: string): Promise<{ audio: ArrayBuffer; mime: string } | null> => ipcRenderer.invoke('voice:tts', text, voice),
    sendAudio: (audio: ArrayBuffer, mime: string) => ipcRenderer.send('voice:audio', audio, mime),
    pillError: (message: string) => ipcRenderer.send('voice:pillError', message),
    dismiss: () => ipcRenderer.send('voice:dismiss'),
    onState: (fn: (s: VoiceState, mode?: 'xen' | 'dictate') => void) => on('voice:state', fn),
    onLevel: (fn: (level: number) => void) => on('voice:level', fn),
    sendLevel: (level: number) => ipcRenderer.send('voice:level', level),
    onRecord: (fn: (cmd: 'start' | 'stop' | 'cancel') => void) => on('voice:record', fn)
  },
  xen: {
    ask: (text: string): Promise<XenResult> => ipcRenderer.invoke('xen:ask', text),
    reset: (): Promise<void> => ipcRenderer.invoke('xen:reset'),
    providers: (): Promise<XenProviderStatus[]> => ipcRenderer.invoke('xen:providers'),
    onConfirm: (fn: (requestId: string, items: string[]) => void) => on('xen:confirm', fn),
    confirmResult: (requestId: string, ok: boolean) => ipcRenderer.send('xen:confirmResult', requestId, ok)
  },
  remote: {
    state: (): Promise<RemoteState> => ipcRenderer.invoke('remote:state'),
    enable: (): Promise<RemoteState> => ipcRenderer.invoke('remote:enable'),
    disable: (): Promise<RemoteState> => ipcRenderer.invoke('remote:disable'),
    newPairCode: (): Promise<RemoteState> => ipcRenderer.invoke('remote:newPairCode'),
    revoke: (id: string): Promise<RemoteState> => ipcRenderer.invoke('remote:revoke', id),
    tunnel: (on: boolean): Promise<RemoteState> => ipcRenderer.invoke('remote:tunnel', on),
    onChanged: (fn: (s: RemoteState) => void) => on('remote:changed', fn)
  },
  usage: {
    report: (force?: boolean): Promise<UsageReport> => ipcRenderer.invoke('usage:report', force)
  },
  app: {
    platform: process.platform,
    onWarning: (fn: (message: string) => void) => on('app:warning', fn),
    onNotice: (fn: (message: string) => void) => on('app:notice', fn),
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info')
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
