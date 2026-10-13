import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import {
  SECRET_NAMES,
  type AppInfo,
  type EnsurePtyOptions,
  type SecretName,
  type Settings,
  type TaskConfig,
  type TaskProvider,
  type VoiceState,
  type Workspace
} from '@shared/types'
import { accountStatuses, LOGIN_COMMANDS } from './accounts'
import { agentVersions, detectAgents, hasCloudflared } from './agents'
import { taskModels, tasks } from './tasks'
import { resolveCanvasRequest, resolveConfirm } from './canvas'
import {
  blankCanvasFolder,
  cloneRepo,
  defaultCloneDir,
  exportCanvas,
  githubRepos,
  importCanvas,
  pickFolder,
  recentProjects
} from './workspaces'
import { askXen, providerStatuses, resetXen } from './xen'
import { listDir, readFile, readNote, writeFile, writeNote } from './files'
import * as git from './git'
import { ptys } from './pty'
import {
  broadcastState,
  disableRemote,
  enableRemote,
  newPairCode,
  remoteState,
  revokeDevice,
  startTunnel,
  stopTunnel
} from './remote'
import { secrets, store } from './store'
import { pickWallpaper } from './wallpaper'
import {
  applyToggleShortcut,
  currentVoiceMode,
  forwardVoiceLevel,
  handleDictation,
  handleUtterance,
  setHoldKey,
  setPillState,
  stopRecording,
  toggleRecording,
  type VoiceMode
} from './voice'

export function registerIpc(): void {
  // --- Workspaces y lienzo -------------------------------------------------
  ipcMain.handle('workspaces:load', () => store.getWorkspaces())
  ipcMain.handle('workspaces:save', (_e, workspaces: Workspace[]) => {
    store.saveWorkspaces(workspaces)
    broadcastState()
  })
  ipcMain.handle('workspaces:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return { root: res.filePaths[0], name: basename(res.filePaths[0]) }
  })
  ipcMain.handle('workspaces:recents', () => recentProjects())
  ipcMain.handle('workspaces:forgetRecent', (_e, path: string) => store.forgetRecent(path))
  ipcMain.handle('workspaces:touch', (_e, path: string) => store.touchRecent(path))
  ipcMain.handle('workspaces:githubRepos', () => githubRepos())
  ipcMain.handle('workspaces:clone', (_e, url: string, parent?: string) => cloneRepo(url, parent))
  ipcMain.handle('workspaces:blank', () => blankCanvasFolder())
  ipcMain.handle('workspaces:defaultCloneDir', () => defaultCloneDir())
  ipcMain.handle('workspaces:pickCloneDir', (e) =>
    pickFolder(BrowserWindow.fromWebContents(e.sender)!, 'Carpeta donde clonar', defaultCloneDir())
  )
  ipcMain.handle('workspaces:export', (e, ws: Workspace) => exportCanvas(BrowserWindow.fromWebContents(e.sender)!, ws))
  ipcMain.handle('workspaces:import', (e) => importCanvas(BrowserWindow.fromWebContents(e.sender)!))
  ipcMain.handle('task:open', (_e, panelId: string, wsId: string, title: string, cwd: string, config: TaskConfig) =>
    tasks.open(panelId, wsId, title, cwd, config)
  )
  ipcMain.handle('task:config', (_e, panelId: string, config: TaskConfig) => tasks.setConfig(panelId, config))
  ipcMain.handle('task:send', (_e, panelId: string, text: string, files: string[]) => tasks.send(panelId, text, files))
  ipcMain.handle('task:approve', (_e, panelId: string, approvalId: string, allow: boolean) => tasks.approve(panelId, approvalId, allow))
  ipcMain.handle('task:stop', (_e, panelId: string) => tasks.stop(panelId))
  ipcMain.handle('task:close', (_e, panelId: string) => tasks.close(panelId))
  ipcMain.handle('task:models', (_e, force?: boolean) => taskModels(force))
  ipcMain.handle('task:pickFiles', async (e, cwd: string) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
      title: 'Adjuntar archivos a la tarea',
      defaultPath: cwd,
      properties: ['openFile', 'multiSelections']
    })
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle('accounts:status', () => accountStatuses())
  ipcMain.handle('accounts:loginCommand', (_e, id: TaskProvider) => LOGIN_COMMANDS[id])
  ipcMain.handle('xen:providers', () => providerStatuses())
  ipcMain.on('xen:confirmResult', (_e, requestId: string, ok: boolean) => resolveConfirm(requestId, ok))
  ipcMain.handle('agents:versions', () => agentVersions())
  ipcMain.handle(
    'app:info',
    (): AppInfo => ({
      user: userInfo().username,
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      userData: app.getPath('userData')
    })
  )
  ipcMain.on('canvas:commandResult', (_e, requestId: string, panelId: string | null, error?: string) =>
    resolveCanvasRequest(requestId, panelId, error)
  )

  // --- Terminales ------------------------------------------------------------
  ipcMain.handle('pty:ensure', (_e, opts: EnsurePtyOptions) => ptys.ensure(opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.handle('pty:kill', (_e, id: string) => ptys.kill(id))
  ipcMain.handle('pty:list', () => ptys.list())
  ipcMain.handle('pty:submit', (_e, id: string, text: string) => ptys.submit(id, text))
  ipcMain.handle('agents:detect', (_e, force?: boolean) => detectAgents(force))

  // --- Archivos y notas --------------------------------------------------------
  ipcMain.handle('fs:list', (_e, dir: string) => listDir(dir))
  ipcMain.handle('fs:read', (_e, path: string) => readFile(path))
  ipcMain.handle('fs:write', (_e, path: string, content: string) => writeFile(path, content))
  ipcMain.handle('notes:read', (_e, wsId: string, panelId: string) => readNote(wsId, panelId))
  ipcMain.handle('notes:write', (_e, wsId: string, panelId: string, content: string) => writeNote(wsId, panelId, content))

  // --- Git ---------------------------------------------------------------------
  ipcMain.handle('git:status', (_e, cwd: string) => git.status(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, file?: string) => git.diff(cwd, file))
  ipcMain.handle('git:commit', (_e, cwd: string, message: string, files?: string[]) => git.commit(cwd, message, files))
  ipcMain.handle('git:discard', (_e, cwd: string, file: string) => git.discard(cwd, file))
  ipcMain.handle('git:worktrees', (_e, cwd: string) => git.listWorktrees(cwd))
  ipcMain.handle('git:createWorktree', (_e, root: string, branch: string) => git.createWorktree(root, branch))
  ipcMain.handle('git:removeWorktree', (_e, root: string, path: string, force: boolean) =>
    git.removeWorktree(root, path, force)
  )

  // --- Ajustes y secretos ------------------------------------------------------
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    if (patch.holdKey) await setHoldKey(patch.holdKey)
    if (patch.toggleShortcut !== undefined && !applyToggleShortcut(patch.toggleShortcut)) {
      throw new Error('Ese atajo no está disponible (puede que otra app lo use).')
    }
    return store.setSettings(patch)
  })
  ipcMain.handle('wallpaper:pick', (e) => pickWallpaper(BrowserWindow.fromWebContents(e.sender)!))
  ipcMain.handle('secrets:status', () => secrets.status())
  ipcMain.handle('secrets:set', (_e, name: SecretName, value: string | null) => {
    if (!SECRET_NAMES.includes(name)) throw new Error(`Clave desconocida: ${String(name)}`)
    secrets.set(name, value)
    return secrets.status()
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path))

  // --- Voz y Xen ---------------------------------------------------------------
  ipcMain.on('voice:toggle', (_e, mode?: VoiceMode) => toggleRecording(mode === 'dictate' ? 'dictate' : 'xen'))
  ipcMain.on('voice:stop', (_e, cancel?: boolean) => stopRecording(!!cancel))
  ipcMain.on('voice:audio', async (_e, audio: ArrayBuffer, mime: string) => {
    try {
      if (currentVoiceMode() === 'dictate') await handleDictation(Buffer.from(audio), mime, setPillState)
      else await handleUtterance(Buffer.from(audio), mime, setPillState)
    } catch (err) {
      setPillState({ phase: 'error', message: (err as Error).message })
    }
  })
  ipcMain.on('voice:level', (_e, level: number) => forwardVoiceLevel(Math.max(0, Math.min(1, Number(level) || 0))))
  ipcMain.on('voice:pillError', (_e, message: string) => setPillState({ phase: 'error', message }))
  ipcMain.on('voice:dismiss', () => setPillState({ phase: 'idle' } satisfies VoiceState))
  ipcMain.handle('xen:ask', async (_e, text: string) => {
    const result = await askXen(text)
    return result
  })
  ipcMain.handle('xen:reset', () => resetXen())

  // --- Acceso remoto -----------------------------------------------------------
  ipcMain.handle('remote:state', () => remoteState())
  ipcMain.handle('remote:enable', async () => {
    await enableRemote()
    return remoteState()
  })
  ipcMain.handle('remote:disable', async () => {
    await disableRemote()
    return remoteState()
  })
  ipcMain.handle('remote:newPairCode', () => {
    newPairCode()
    return remoteState()
  })
  ipcMain.handle('remote:revoke', (_e, id: string) => {
    revokeDevice(id)
    return remoteState()
  })
  ipcMain.handle('remote:tunnel', async (_e, on: boolean) => {
    if (on) {
      if (!(await hasCloudflared())) throw new Error('cloudflared no está instalado. Instálalo con: winget install Cloudflare.cloudflared')
      startTunnel()
    } else stopTunnel()
    return remoteState()
  })
}
