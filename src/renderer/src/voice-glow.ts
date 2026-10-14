/**
 * Brillo de pantalla completa mientras se habla con Xen o se dicta, al estilo «Apple Intelligence»
 * (el mismo que usa Deska): luz suave y difusa de varios colores que sale de los bordes de la ventana,
 * gira despacio, respira y se intensifica con el volumen de la voz. No es un borde sólido.
 *
 * La luz se pinta en un canvas pequeño estirado a la ventana, sobre negro: con `mix-blend-mode: screen`
 * el negro no suma nada y el canvas se lee como luz emitida sobre la app.
 */

export type GlowState = 'listening' | 'dictating' | 'working'

type Palette = { a: string; b: string; c: string }

const PALETTES: Record<GlowState, Palette> = {
  listening: { a: '#8b7bff', b: '#b28dff', c: '#6d8dff' },
  dictating: { a: '#6fa4ff', b: '#a9c8ff', c: '#5f8dff' },
  working: { a: '#ff5fb1', b: '#c665ff', c: '#a94fff' }
}

interface Layer {
  /** Cuánto penetra la luz desde el borde (px). */
  fall: number
  /** Suavizado del borde (px). */
  blur: number
  opacity: number
  levelGrow: number
  levelBrightness: number
  saturate: number
  stops: (keyof Palette)[]
  fromDeg: number
  spinPeriodS: number
  spinDirection: 1 | -1
  breathePeriodS: number
}

const LAYERS: Layer[] = [
  { fall: 90, blur: 40, opacity: 0.3, levelGrow: 0.085, levelBrightness: 0, saturate: 1, stops: ['a', 'c', 'b', 'a'], fromDeg: 200, spinPeriodS: 0, spinDirection: 1, breathePeriodS: 0 },
  { fall: 55, blur: 24, opacity: 0.48, levelGrow: 0.055, levelBrightness: 1, saturate: 1, stops: ['c', 'a', 'b', 'a', 'c'], fromDeg: 0, spinPeriodS: 11, spinDirection: -1, breathePeriodS: 5.8 },
  { fall: 30, blur: 7, opacity: 0.8, levelGrow: 0.03, levelBrightness: 0.7, saturate: 1.1, stops: ['a', 'b', 'c', 'a', 'b', 'c', 'a'], fromDeg: 0, spinPeriodS: 7, spinDirection: 1, breathePeriodS: 4.2 }
]

const BREATHE_PEAK = 1.03
const FADE_MS = 600
const FRAME_GAP_MS = 28
const RASTER_SCALE = 0.5
const RASTER_MAX_SIDE = 1024
const RESIZE_SETTLE_MS = 140
const LEVEL_STEP = 0.02

// Volumen del micrófono (0–1), lo escribe App cada vez que llega una medida.
let level = 0
export function setGlowLevel(v: number): void {
  level = Math.min(1, Math.max(0, v))
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const curve = (a: number, b: number, s: number): number => {
    const inv = 1 - s
    return 3 * inv * inv * s * a + 3 * inv * s * s * b + s * s * s
  }
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (curve(x1, x2, mid) < x) lo = mid
      else hi = mid
    }
    return curve(y1, y2, (lo + hi) / 2)
  }
}
const easeOut = cubicBezier(0.25, 0.1, 0.25, 1)
const easeInOut = cubicBezier(0.42, 0, 0.58, 1)

const cyclePhase = (t: number, period: number): number => (((t % period) + period) % period) / period

function breatheScale(t: number, period: number): number {
  if (period <= 0) return 1
  const phase = cyclePhase(t, period)
  const rise = phase < 0.5 ? phase * 2 : (1 - phase) * 2
  return 1 + (BREATHE_PEAK - 1) * easeInOut(rise)
}

const spinAngle = (layer: Layer, t: number): number =>
  layer.spinPeriodS <= 0 ? layer.fromDeg : layer.fromDeg + layer.spinDirection * 360 * cyclePhase(t, layer.spinPeriodS)

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const k = 1 / (1 + 0.3275911 * ax)
  const poly = ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k
  return sign * (1 - poly * Math.exp(-ax * ax))
}
const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2))
const normalPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

function edgeProfile(d: number, fall: number, sigma: number): number {
  if (sigma <= 0) return d < 0 ? 0 : clamp01(1 - d / fall)
  const near = d / sigma
  const far = (d - fall) / sigma
  const mass = (1 - d / fall) * (normalCdf(near) - normalCdf(far))
  const skew = (sigma / fall) * (normalPdf(far) - normalPdf(near))
  return clamp01(mass + skew)
}
const edgeCoverage = (d: number, sigma: number): number => (sigma <= 0 ? (d < 0 ? 0 : 1) : normalCdf(d / sigma))

function maskAxis(length: number, raster: number, fall: number, sigma: number): { inside: Float32Array; hollow: Float32Array } {
  const inside = new Float32Array(length)
  const hollow = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const d = (Math.min(i, length - 1 - i) + 0.5) / raster
    inside[i] = edgeCoverage(d, sigma)
    hollow[i] = Math.max(0, inside[i] - edgeProfile(d, fall, sigma))
  }
  return { inside, hollow }
}

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const ch = (v: number): number => Math.min(255, Math.max(0, v))

function filterColor(c: Rgb, s: number, brightness: number): Rgb {
  const r = ch((0.213 + 0.787 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 - 0.072 * s) * c.b)
  const g = ch((0.213 - 0.213 * s) * c.r + (0.715 + 0.285 * s) * c.g + (0.072 - 0.072 * s) * c.b)
  const b = ch((0.213 - 0.213 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 + 0.928 * s) * c.b)
  return { r: ch(r * brightness), g: ch(g * brightness), b: ch(b * brightness) }
}

function makeSurface(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const surface = document.createElement('canvas')
  surface.width = width
  surface.height = height
  const ctx = surface.getContext('2d')
  return ctx ? [surface, ctx] : null
}

function buildMask(layer: Layer, raster: number, width: number, height: number): HTMLCanvasElement | null {
  const made = makeSurface(width, height)
  if (!made) return null
  const [surface, ctx] = made
  const cols = maskAxis(width, raster, layer.fall, layer.blur)
  const rows = maskAxis(height, raster, layer.fall, layer.blur)
  const image = ctx.createImageData(width, height)
  const px = image.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      px[i] = px[i + 1] = px[i + 2] = 255
      px[i + 3] = Math.round(clamp01(cols.inside[x] * rows.inside[y] - cols.hollow[x] * rows.hollow[y]) * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
  return surface
}

const css = (c: Rgb): string => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`

export interface GlowController {
  setTarget(state: GlowState, lit: boolean): void
  destroy(): void
}

export function createGlowController(canvas: HTMLCanvasElement): GlowController | null {
  const out = canvas.getContext('2d', { alpha: false })
  if (!out) return null

  let width = 0
  let height = 0
  let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null
  let masks: (HTMLCanvasElement | null)[] = []
  let state: GlowState = 'listening'
  let lit = false
  let litAt = 0
  let fade = { from: LAYERS.map(() => 0), to: LAYERS.map(() => 0), startedAt: 0 }
  let timer = 0
  let raf = 0
  let settle = 0
  let destroyed = false
  const reduced = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

  const fadedOpacities = (now: number): number[] => {
    const p = easeOut((now - fade.startedAt) / FADE_MS)
    return fade.to.map((to, i) => fade.from[i] + (to - fade.from[i]) * p)
  }

  const resize = (): void => {
    settle = 0
    const w = window.innerWidth
    const h = window.innerHeight
    const raster = Math.min(RASTER_SCALE, RASTER_MAX_SIDE / Math.max(w, h, 1))
    const nw = Math.max(1, Math.round(w * raster))
    const nh = Math.max(1, Math.round(h * raster))
    if (nw !== width || nh !== height) {
      width = nw
      height = nh
      canvas.width = nw
      canvas.height = nh
      scratch = makeSurface(nw, nh)
      masks = LAYERS.map((layer) => buildMask(layer, raster, nw, nh))
    }
    wake()
  }

  const paint = (now: number): void => {
    const t = reduced?.matches ? 0 : (now - litAt) / 1000
    const lv = Math.round(clamp01(level) / LEVEL_STEP) * LEVEL_STEP
    const opacities = fadedOpacities(now)
    out.globalCompositeOperation = 'source-over'
    out.globalAlpha = 1
    out.fillStyle = '#000'
    out.fillRect(0, 0, width, height)
    if (!scratch) return
    const [surface, layerCtx] = scratch
    const palette = PALETTES[state]
    LAYERS.forEach((layer, i) => {
      const mask = masks[i]
      const opacity = opacities[i] ?? 0
      if (!mask || opacity <= 0.002) return
      const brightness = 1 + lv * layer.levelBrightness
      const colors = layer.stops.map((key) => filterColor(parseHex(palette[key]), layer.saturate, brightness))
      const wheel = layerCtx.createConicGradient(((spinAngle(layer, t) - 90) * Math.PI) / 180, width / 2, height / 2)
      colors.forEach((color, stop) => wheel.addColorStop(stop / (colors.length - 1), css(color)))
      layerCtx.globalCompositeOperation = 'source-over'
      layerCtx.fillStyle = wheel
      layerCtx.fillRect(0, 0, width, height)
      const scale = (1 + lv * layer.levelGrow) * breatheScale(t, layer.breathePeriodS)
      const sw = width * scale
      const sh = height * scale
      layerCtx.globalCompositeOperation = 'destination-in'
      layerCtx.drawImage(mask, (width - sw) / 2, (height - sh) / 2, sw, sh)
      out.globalCompositeOperation = 'screen'
      out.globalAlpha = opacity
      out.drawImage(surface, 0, 0)
    })
  }

  const tick = (now: number): void => {
    raf = 0
    if (destroyed) return
    paint(now)
    const fading = now - fade.startedAt < FADE_MS
    if (lit || fading) schedule()
  }

  function schedule(): void {
    if (destroyed || timer || raf) return
    timer = window.setTimeout(() => {
      timer = 0
      raf = requestAnimationFrame(tick)
    }, FRAME_GAP_MS)
  }

  function wake(): void {
    if (destroyed) return
    if (timer) clearTimeout(timer)
    if (raf) cancelAnimationFrame(raf)
    timer = 0
    raf = requestAnimationFrame(tick)
  }

  const onResize = (): void => {
    if (settle) clearTimeout(settle)
    settle = window.setTimeout(resize, RESIZE_SETTLE_MS)
  }
  window.addEventListener('resize', onResize)
  resize()

  return {
    setTarget(next, nextLit) {
      const now = performance.now()
      const target = LAYERS.map((l) => (nextLit ? l.opacity : 0))
      if (target.some((v, i) => v !== fade.to[i])) fade = { from: fadedOpacities(now), to: target, startedAt: now }
      if (nextLit && !lit) litAt = now
      lit = nextLit
      state = next
      wake()
    },
    destroy() {
      destroyed = true
      if (timer) clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      if (settle) clearTimeout(settle)
      window.removeEventListener('resize', onResize)
    }
  }
}
