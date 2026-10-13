import { app, BrowserWindow, Menu, Notification, session, shell } from 'electron'
import { join } from 'node:path'
import type { PtyInfo, TaskEvent } from '@shared/types'
import { tasks } from './tasks'
import { setCanvasWindow } from './canvas'
import { registerIpc } from './ipc'
import { ptys } from './pty'
import { broadcastState, disableRemote, remoteState, setRemoteChangeListener } from './remote'
import { flushStore, store } from './store'
import { createPillWindow, startHotkeys, stopHotkeys } from './voice'
import { handleAssetScheme, registerAssetScheme } from './wallpaper'

registerAssetScheme()

let mainWindow: BrowserWindow | null = null

function isOwnUrl(url: string): boolean {
  const dev = process.env.ELECTRON_RENDERER_URL
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Xora',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    // Sin barra de título: la interfaz flota sobre el lienzo y Windows dibuja solo sus botones.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e6ebf5', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())
  // Los enlaces externos se abren en el navegador del sistema, nunca en una ventana con preload.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url)) e.preventDefault()
  })
  // Los <webview> del panel navegador no reciben preload ni Node.
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    if (!/^https?:\/\/|^about:blank/.test(params.src)) params.src = 'about:blank'
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    mainWindow = null
    setCanvasWindow(null)
    // La píldora de voz sigue viva oculta; cerrar la ventana principal cierra la app.
    if (process.platform !== 'darwin') app.quit()
  })
  setCanvasWindow(win)
  return win
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function wirePtyEvents(): void {
  tasks.on('event', (ev: TaskEvent) => send('task:event', ev))
  ptys.on('data', (id: string, data: string) => send('pty:data', id, data))
  ptys.on('exit', (id: string, code: number) => send('pty:exit', id, code))
  ptys.on('status', (info: PtyInfo) => send('pty:status', info))
  ptys.on('attention', (a: { ptyId: string; title: string; message: string }) => {
    send('pty:attention', a)
    const focused = mainWindow?.isFocused()
    if (!focused && store.getSettings().notifyOnWaiting && Notification.isSupported()) {
      const n = new Notification({ title: a.title, body: a.message, silent: false })
      n.on('click', () => {
        mainWindow?.show()
        send('pty:reveal', a.ptyId)
      })
      n.show()
    }
  })
}

// Permite aislar los datos (pruebas o un segundo perfil) sin tocar el perfil normal.
if (process.env.XORA_USER_DATA) app.setPath('userData', process.env.XORA_USER_DATA)

app.setAppUserModelId('dev.xora.app')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  handleAssetScheme()
  // Micrófono solo para las páginas propias (píldora y lienzo); los <webview> no lo obtienen.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = isOwnUrl(details.requestingUrl || wc.getURL())
    callback(own && (permission === 'media' || permission === 'notifications' || permission === 'clipboard-sanitized-write'))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
    return isOwnUrl(origin || wc?.getURL() || '') && (permission === 'media' || permission === 'clipboard-sanitized-write')
  })

  registerIpc()
  wirePtyEvents()
  setRemoteChangeListener(async () => send('remote:changed', await remoteState()))
  ptys.on('status', () => broadcastState())

  mainWindow = createMainWindow()
  createPillWindow()
  const hotkeyWarning = await startHotkeys()
  if (hotkeyWarning) mainWindow.webContents.once('did-finish-load', () => send('app:warning', hotkeyWarning))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  flushStore()
  ptys.killAll()
  tasks.closeAll()
  void stopHotkeys()
  void disableRemote()
})
