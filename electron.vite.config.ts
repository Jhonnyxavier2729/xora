import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const DESKTOP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http: ac-asset:; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://w.soundcloud.com"
const REMOTE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:"

/** CSP solo en producción: en desarrollo Vite necesita scripts inline para el hot reload. */
function cspPlugin(): Plugin {
  return {
    name: 'xora-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const csp = ctx.filename.endsWith('remote.html') ? REMOTE_CSP : DESKTOP_CSP
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), cspPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          pill: resolve('src/renderer/pill.html'),
          remote: resolve('src/renderer/remote.html')
        }
      }
    },
    // El cliente remoto se sirve desde la misma build; rutas relativas para que funcione detrás de un túnel.
    base: './'
  }
})
