import { useSyncExternalStore } from 'react'

/** Estado de los Extras (Focus y Música) fuera de React: siguen vivos aunque el menú esté cerrado. */

function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sin almacenamiento: se pierde al cerrar, nada más.
  }
}

// ---------------------------------------------------------------------------
// Focus (pomodoro)

export interface FocusState {
  phase: 'focus' | 'break'
  status: 'ready' | 'running' | 'paused'
  /** Momento en que acaba la fase si está en marcha. */
  endsAt: number
  /** Lo que queda si está en pausa. */
  remainingMs: number
  focusMin: number
  breakMin: number
}

const FOCUS_KEY = 'xora.focus'
const focusDefaults: FocusState = { phase: 'focus', status: 'ready', endsAt: 0, remainingMs: 25 * 60_000, focusMin: 25, breakMin: 5 }
export const focus = createStore<FocusState>(load(FOCUS_KEY, focusDefaults))
focus.subscribe(() => save(FOCUS_KEY, focus.get()))

const phaseMs = (s: FocusState, phase = s.phase): number => (phase === 'focus' ? s.focusMin : s.breakMin) * 60_000

export function focusRemaining(s: FocusState = focus.get()): number {
  if (s.status === 'running') return Math.max(0, s.endsAt - Date.now())
  if (s.status === 'paused') return s.remainingMs
  return phaseMs(s)
}

export const focusActions = {
  start() {
    const s = focus.get()
    focus.set({ status: 'running', endsAt: Date.now() + (s.status === 'paused' ? s.remainingMs : phaseMs(s)) })
  },
  pause() {
    const s = focus.get()
    if (s.status === 'running') focus.set({ status: 'paused', remainingMs: focusRemaining(s) })
  },
  reset() {
    const s = focus.get()
    focus.set({ phase: 'focus', status: 'ready', remainingMs: phaseMs(s, 'focus') })
  },
  skipBreak() {
    focus.set({ phase: 'focus', status: 'ready' })
  },
  setMinutes(focusMin: number, breakMin: number) {
    focus.set({ focusMin, breakMin })
  }
}

/** Avisa al terminar cada fase; lo conecta App con su sistema de avisos. */
let onPhaseEnd: (message: string) => void = () => {}
export function setFocusNotifier(fn: (message: string) => void): void {
  onPhaseEnd = fn
}

function chime(): void {
  try {
    const ctx = new AudioContext()
    ;[660, 880].forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22)
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.22 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.5)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.22)
      o.stop(ctx.currentTime + i * 0.22 + 0.55)
    })
    setTimeout(() => void ctx.close(), 1500)
  } catch {
    // Sin audio.
  }
}

setInterval(() => {
  const s = focus.get()
  if (s.status !== 'running' || Date.now() < s.endsAt) return
  chime()
  if (s.phase === 'focus') {
    // Acaba el foco: empieza solo el descanso.
    focus.set({ phase: 'break', status: 'running', endsAt: Date.now() + phaseMs(s, 'break') })
    onPhaseEnd(`Sesión de foco terminada. Descansa ${s.breakMin} min.`)
  } else {
    focus.set({ phase: 'focus', status: 'ready' })
    onPhaseEnd('Descanso terminado. Cuando quieras, otra sesión de foco.')
  }
}, 1000)

export function useFocus(): FocusState {
  return useSyncExternalStore(focus.subscribe, focus.get)
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Música (reproductor de SoundCloud, como Deska)

export const PLAYLISTS: { id: string; name: string; category: 'Lofi' | 'Ambiente'; url: string }[] = [
  { id: 'relaxdaily', name: 'relaxdaily', category: 'Ambiente', url: 'https://soundcloud.com/relaxdaily' },
  { id: 'rain', name: 'Lluvia', category: 'Ambiente', url: 'https://soundcloud.com/rainsounds' },
  { id: 'ocean', name: 'Olas del mar', category: 'Ambiente', url: 'https://soundcloud.com/ocean-sounds' },
  { id: 'forest', name: 'Bosque', category: 'Ambiente', url: 'https://soundcloud.com/forest-sounds' },
  { id: 'coffee-shop', name: 'Cafetería', category: 'Ambiente', url: 'https://soundcloud.com/coffeeshopvibes' },
  { id: 'white-noise', name: 'Ruido blanco', category: 'Ambiente', url: 'https://soundcloud.com/white-noise' },
  { id: 'brian-eno', name: 'Brian Eno', category: 'Ambiente', url: 'https://soundcloud.com/brian-eno' },
  { id: 'lofigirl', name: 'Lofi Girl', category: 'Lofi', url: 'https://soundcloud.com/lofigirl' },
  { id: 'chillhop', name: 'Chillhop Music', category: 'Lofi', url: 'https://soundcloud.com/chillhopdotcom' },
  { id: 'chillhop-fall', name: 'Chillhop Essentials: Fall', category: 'Lofi', url: 'https://soundcloud.com/chillhopdotcom/sets/chillhop-essentials-fall-2023' },
  { id: 'lofi-hiphop', name: 'Lofi Hip Hop', category: 'Lofi', url: 'https://soundcloud.com/lofi-hip-hop' },
  { id: 'sleepyfish', name: 'Sleepy Fish', category: 'Lofi', url: 'https://soundcloud.com/sleepyfish' },
  { id: 'nujabes', name: 'Nujabes', category: 'Lofi', url: 'https://soundcloud.com/nujabes' }
]

export interface MusicState {
  playlistId: string
  /** El reproductor solo se carga la primera vez que se pulsa play. */
  mounted: boolean
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'failed'
  title: string | null
  artwork: string | null
}

const MUSIC_KEY = 'xora.music'
export const music = createStore<MusicState>({
  ...{ playlistId: 'relaxdaily', mounted: false, status: 'idle', title: null, artwork: null },
  playlistId: load(MUSIC_KEY, { playlistId: 'relaxdaily' }).playlistId
})
music.subscribe(() => save(MUSIC_KEY, { playlistId: music.get().playlistId }))

export function useMusic(): MusicState {
  return useSyncExternalStore(music.subscribe, music.get)
}

export const WIDGET_ORIGIN = 'https://w.soundcloud.com'

export function widgetSrc(playlistUrl: string): string {
  const params = new URLSearchParams({
    url: playlistUrl,
    auto_play: 'true',
    visual: 'false',
    show_comments: 'false',
    hide_related: 'true',
    show_teaser: 'false',
    single_active: 'false'
  })
  return `${WIDGET_ORIGIN}/player/?${params.toString()}`
}

/** El iframe del widget lo registra MusicHost; las acciones le hablan por postMessage. */
let widget: Window | null = null
export function setWidget(w: Window | null): void {
  widget = w
}

export function sendToWidget(method: string, value?: unknown): void {
  widget?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), WIDGET_ORIGIN)
}

export const musicActions = {
  play() {
    const s = music.get()
    if (!s.mounted) music.set({ mounted: true, status: 'loading' })
    else sendToWidget('play')
  },
  pause() {
    sendToWidget('pause')
  },
  next() {
    sendToWidget('next')
  },
  prev() {
    sendToWidget('prev')
  },
  choose(playlistId: string) {
    if (!PLAYLISTS.some((p) => p.id === playlistId)) return
    music.set({ playlistId, mounted: true, status: 'loading', title: null, artwork: null })
  }
}
