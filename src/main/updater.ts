import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Actualizaciones como en Deska: Xora mira GitHub Releases al abrirse y cada pocas horas; si hay una
 * versión más nueva avisa, la descarga cuando el usuario quiere (con progreso) y ofrece reiniciar.
 * Si no se reinicia, se instala sola al cerrar. En Windows solo baja los bloques que cambiaron (blockmap).
 * En macOS la app tiene que estar firmada para instalarse sola: ahí se ofrece abrir la página de la versión.
 */

const RELEASES = 'https://github.com/Jhonnyxavier2729/xora/releases'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_MS = 8_000

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let manualCheck = false
/** Última versión nueva vista: si la descarga falla, la tarjeta sigue mostrándola con Reintentar. */
let lastVersion: string | null = null

const canSelfInstall = (): boolean => process.platform !== 'darwin'
const enabled = (): boolean => app.isPackaged && !process.env.XORA_NO_UPDATES

function broadcast(next: Partial<UpdateStatus> & Pick<UpdateStatus, 'state'>): void {
  status = { current: app.getVersion(), ...next } as UpdateStatus
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('update:status', status)
}

async function check(manual: boolean): Promise<void> {
  if (!enabled()) {
    if (manual) broadcast({ state: 'error', message: 'Las actualizaciones solo funcionan en la app instalada.' })
    return
  }
  if (status.state === 'downloading' || status.state === 'downloaded') return
  manualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    if (manual) broadcast({ state: 'error', message: (err as Error).message })
    manualCheck = false
  }
}

export function registerUpdater(): void {
  ipcMain.handle('update:getStatus', () => status)
  ipcMain.on('update:check', () => void check(true))
  ipcMain.on('update:download', () => {
    const version = status.state === 'available' ? status.version : status.state === 'error' ? lastVersion : null
    if (!version) return
    if (!canSelfInstall()) {
      void shell.openExternal(`${RELEASES}/tag/v${version}`)
      return
    }
    broadcast({ state: 'downloading', version, percent: 0 })
    autoUpdater.downloadUpdate().catch((err: Error) => broadcast({ state: 'error', message: err.message, ...(lastVersion ? { version: lastVersion } : {}) }))
  })
  ipcMain.on('update:install', () => {
    if (status.state === 'downloaded') autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.on('update:openRelease', () => void shell.openExternal(status.state === 'idle' ? RELEASES : `${RELEASES}/latest`))

  if (!enabled()) return
  // El repositorio va aquí y no solo en app-update.yml: así funciona en cualquier empaquetado.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'Jhonnyxavier2729', repo: 'xora', releaseType: 'release' })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    if (manualCheck) broadcast({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    lastVersion = String(info.version)
    broadcast({ state: 'available', version: String(info.version), canSelfInstall: canSelfInstall() })
  })
  autoUpdater.on('update-not-available', () => {
    broadcast(manualCheck ? { state: 'latest' } : { state: 'idle' })
    manualCheck = false
  })
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') broadcast({ state: 'downloading', version: status.version, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: String(info.version) }))
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
    // Un fallo al comprobar en segundo plano no molesta; uno pedido a mano sí se muestra.
    if (manualCheck || status.state === 'downloading') broadcast({ state: 'error', message: err.message, ...(lastVersion ? { version: lastVersion } : {}) })
    manualCheck = false
  })

  setTimeout(() => void check(false), FIRST_CHECK_MS)
  setInterval(() => void check(false), CHECK_EVERY_MS)
  // Tras suspender el equipo, se vuelve a mirar.
  powerMonitor.on('resume', () => setTimeout(() => void check(false), 15_000))
}
