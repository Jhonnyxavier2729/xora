import { app, dialog, net, protocol, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Settings } from '@shared/types'
import { store } from './store'

const SCHEME = 'ac-asset'
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']

/** Debe llamarse antes de app.ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

function currentWallpaperFile(): string | null {
  const dir = app.getPath('userData')
  const file = readdirSync(dir).find((f) => f.startsWith('wallpaper.') && IMAGE_EXTS.includes(extname(f).toLowerCase()))
  return file ? join(dir, file) : null
}

/** Sirve únicamente la imagen de fondo elegida: ac-asset://wallpaper */
export function handleAssetScheme(): void {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    if (url.hostname !== 'wallpaper') return new Response('No encontrado', { status: 404 })
    const file = currentWallpaperFile()
    if (!file || !existsSync(file)) return new Response('No encontrado', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

export async function pickWallpaper(win: BrowserWindow): Promise<Settings | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elige una imagen de fondo',
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: IMAGE_EXTS.map((e) => e.slice(1)) }]
  })
  const source = res.filePaths[0]
  if (res.canceled || !source) return null
  const old = currentWallpaperFile()
  if (old) unlinkSync(old)
  copyFileSync(source, join(app.getPath('userData'), `wallpaper${extname(source).toLowerCase()}`))
  return store.setSettings({ wallpaper: 'file', wallpaperVersion: Date.now() })
}
