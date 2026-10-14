import { app, BrowserWindow, Menu, Notification, session, shell } from 'electron'
import { join } from 'node:path'
import type { PtyInfo, TaskEvent } from '@shared/types'
import { tasks } from './tasks'
import { setCanvasWindow } from './canvas'
import { registerIpc } from './ipc'
import { ptys } from './pty'
import { broadcastState, disableRemote, remoteState, setRemoteChangeListener } from './remote'
import { flushStore, store } from './store'
import { registerUpdater } from './updater'
import { startAgentUpdateChecks } from './agent-updates'
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
    // Sin barra de título: la interfaz flota sobre el lienzo. Windows y Linux dibujan sus botones a la
    // derecha; en macOS quedan los semáforos a la izquierda (la barra superior les deja sitio).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#e6ebf5', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true
    }
  })
  // Clic derecho en una palabra mal escrita: sugerencias y «Añadir al diccionario».
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.misspelledWord) return
    const items: Electron.MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 6).map((suggestion) => ({
      label: suggestion,
      click: () => win.webContents.replaceMisspelling(suggestion)
    }))
    if (!items.length) items.push({ label: 'Sin sugerencias', enabled: false })
    items.push(
      { type: 'separator' },
      { label: 'Añadir al diccionario', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: 'separator' },
      { role: 'cut', label: 'Cortar', enabled: params.editFlags.canCut },
      { role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy },
      { role: 'paste', label: 'Pegar', enabled: params.editFlags.canPaste }
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  // Si el proceso de la ventana se cae, se vuelve a abrir en vez de dejar la pantalla en blanco.
  let lastCrash = 0
  win.webContents.on('render-process-gone', () => {
    if (Date.now() - lastCrash < 10_000) return
    lastCrash = Date.now()
    win.reload()
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

// Defensa global para todo contenido web (incluidas las páginas del panel navegador):
// ventanas nuevas → navegador del sistema; nada de file://, javascript: ni <webview> anidados.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (contents.getType() === 'webview') {
    const guard = (e: Electron.Event, url: string) => {
      if (!/^(https?:|about:blank)/i.test(url)) e.preventDefault()
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    contents.on('will-attach-webview', (e) => e.preventDefault())
  }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  // En macOS el menú de la app es el que da Cmd+C/V/Z/Q; en Windows y Linux no hace falta.
  Menu.setApplicationMenu(
    process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null
  )
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
  registerUpdater()
  startAgentUpdateChecks()
  try {
    // Corrige en español e inglés (Windows y Linux; en macOS lo decide el sistema).
    session.defaultSession.setSpellCheckerLanguages(['es', 'en-US'])
  } catch {
    // Diccionario no disponible: se usa el del sistema.
  }
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
