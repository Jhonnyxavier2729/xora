import { useEffect, useRef, useState } from 'react'
import type { Panel } from '@shared/types'
import { IconBack, IconBrowser, IconForward, IconReload } from '../components/Icons'
import { useApp } from '../state'

interface WebviewTag extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  getURL(): string
  getTitle(): string
}

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return 'about:blank'
  if (/^https?:\/\//i.test(v)) return v
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) return `https://${v}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`
}

export function BrowserPanel({ wsId, panel }: { wsId: string; panel: Panel }) {
  const ref = useRef<WebviewTag>(null)
  const [initial] = useState(() => {
    const start = panel.url || useApp.getState().settings?.browserHome || ''
    return start ? normalizeUrl(start) : 'about:blank'
  })
  const [address, setAddress] = useState(initial === 'about:blank' ? '' : initial)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onNav = () => {
      const url = wv.getURL()
      setAddress(url === 'about:blank' ? '' : url)
      if (url !== 'about:blank') useApp.getState().updatePanel(wsId, panel.id, { url })
    }
    const onTitle = () => {
      const title = wv.getTitle()
      if (title) useApp.getState().updatePanel(wsId, panel.id, { title: title.slice(0, 60) })
    }
    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
    }
  }, [wsId, panel.id])

  return (
    <div className="browser-panel">
      <div className="browser-bar">
        <button className="icon-btn small" title="Atrás" onClick={() => ref.current?.canGoBack() && ref.current.goBack()}>
          <IconBack size={14} />
        </button>
        <button className="icon-btn small" title="Adelante" onClick={() => ref.current?.canGoForward() && ref.current.goForward()}>
          <IconForward size={14} />
        </button>
        <button className="icon-btn small" title="Recargar" onClick={() => ref.current?.reload()}>
          <IconReload size={14} />
        </button>
        <input
          className="address"
          value={address}
          placeholder="Escribe una URL (p. ej. localhost:3000) o una búsqueda"
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ref.current) ref.current.src = normalizeUrl(address)
          }}
        />
        {loading && <span className="spinner" />}
      </div>
      <div className="browser-view">
        {initial === 'about:blank' && !address && (
          <div className="browser-empty">
            <IconBrowser size={28} />
            <p>Abre tu app en desarrollo (localhost) o cualquier web.</p>
          </div>
        )}
        <webview ref={ref as unknown as React.Ref<HTMLWebViewElement>} src={initial} partition="persist:browser" />
      </div>
    </div>
  )
}
