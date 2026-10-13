import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Busca versiones nuevas en GitHub Releases, las descarga en segundo plano y las instala al cerrar.
 * Solo en la app empaquetada. En macOS el sistema exige una app firmada para actualizarse sola,
 * así que allí se queda desactivado hasta que haya firma de Apple.
 */
export function startAutoUpdates(notify: (message: string) => void): void {
  if (!app.isPackaged || process.platform === 'darwin' || process.env.XORA_NO_UPDATES) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    notify(`Xora ${info.version} está lista: se instalará al cerrar la app.`)
  })
  autoUpdater.on('error', (err) => console.error('[updater]', err.message))
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 10_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
