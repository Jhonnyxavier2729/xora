import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import type { VoiceState } from '@shared/types'
import { getCanvasWindow } from './canvas'
import { askXen } from './xen'
import { redact } from './redact'
import { secrets, store } from './store'

const STT = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' }
} as const

/** Pulsaciones más cortas que esto se ignoran (evita grabar al usar la tecla para otra cosa). */
const MIN_HOLD_MS = 250

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const settings = store.getSettings()
  const provider = settings.sttProvider
  const key = secrets.get(provider) ?? process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'] ?? null
  if (!key) throw new Error(`Falta la clave de ${provider === 'groq' ? 'Groq' : 'OpenAI'} para transcribir. Añádela en Ajustes.`)
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), `audio.${ext}`)
  form.append('model', STT[provider].model)
  if (settings.language) form.append('language', settings.language)
  const res = await fetch(STT[provider].url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(redact(`La transcripción falló (${res.status}): ${body.slice(0, 200)}`))
  }
  const json = (await res.json()) as { text?: string }
  const text = (json.text ?? '').trim()
  return isHallucination(text) ? '' : text
}

/**
 * Whisper "inventa" frases de cierre cuando el audio es casi silencio
 * ("Gracias por ver el video", "Subtítulos por…"). Se descartan si son toda la transcripción.
 */
const HALLUCINATIONS = [
  /^(¡?gracias( por (ver|vernos|mirar)( el video)?)?!?\.?)$/i,
  /^subt[ií]tulos (realizados )?por/i,
  /^(thanks|thank you)( for watching)?[.!]?$/i,
  /^suscr[ií]bete/i,
  /^amara\.org/i,
  /^\.+$/
]

function isHallucination(text: string): boolean {
  const t = text.trim()
  return !t || (t.split(/\s+/).length <= 8 && HALLUCINATIONS.some((re) => re.test(t)))
}

/** Transcribe y pasa el texto a Xen. Lo usan la píldora de escritorio y el cliente remoto. */
export async function handleUtterance(
  audio: Buffer,
  mime: string,
  onState: (s: VoiceState) => void
): Promise<{ transcript: string; reply: string }> {
  onState({ phase: 'transcribing' })
  const transcript = await transcribe(audio, mime)
  if (!transcript) {
    onState({ phase: 'error', message: 'No se entendió nada. Intenta de nuevo.' })
    return { transcript: '', reply: '' }
  }
  onState({ phase: 'thinking', transcript })
  const result = await askXen(transcript)
  const reply = [result.reply, ...result.actions.map((a) => `• ${a.summary}`)].join('\n')
  onState({ phase: 'done', transcript, reply })
  return { transcript, reply }
}

/** Dictado: transcribe y entrega el texto al lienzo para escribirlo en el panel enfocado. */
export async function handleDictation(audio: Buffer, mime: string, onState: (s: VoiceState) => void): Promise<void> {
  onState({ phase: 'transcribing' })
  const transcript = await transcribe(audio, mime)
  if (!transcript) {
    onState({ phase: 'error', message: 'No se entendió nada. Intenta de nuevo.' })
    return
  }
  const win = getCanvasWindow()
  win?.webContents.send('voice:dictation', transcript)
  onState({ phase: 'done', transcript, reply: `Dictado: ${transcript}` })
}

// ---------------------------------------------------------------------------
// Píldora flotante: una ventana pequeña, siempre encima, que graba el micrófono.

export type VoiceMode = 'xen' | 'dictate'

let pill: BrowserWindow | null = null
let pillReady = false
let hideTimer: NodeJS.Timeout | null = null
let recording = false
let recordingMode: VoiceMode = 'xen'

export function currentVoiceMode(): VoiceMode {
  return recordingMode
}

function pillBounds() {
  const area = screen.getPrimaryDisplay().workArea
  const width = 420
  const height = 132
  return { width, height, x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height - 24 }
}

export function createPillWindow(): BrowserWindow {
  if (pill && !pill.isDestroyed()) return pill
  pill = new BrowserWindow({
    ...pillBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  pill.setAlwaysOnTop(true, 'screen-saver')
  pill.setVisibleOnAllWorkspaces(true)
  pill.webContents.on('did-finish-load', () => {
    pillReady = true
  })
  if (process.env.ELECTRON_RENDERER_URL) pill.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pill.html`)
  else pill.loadFile(join(__dirname, '../renderer/pill.html'))
  pill.on('closed', () => {
    pill = null
    pillReady = false
  })
  return pill
}

export function setPillState(state: VoiceState): void {
  if (!pill || pill.isDestroyed()) return
  // Cualquier fase distinta de "escuchando" (incluido un error de micrófono) cierra la grabación.
  if (state.phase !== 'listening') recording = false
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  pill.webContents.send('voice:state', state)
  // La ventana principal muestra su propia tarjeta de voz y el brillo de bordes.
  const main = getCanvasWindow()
  main?.webContents.send('voice:state', state, recordingMode)
  // La píldora flotante solo hace falta cuando Xora no está en primer plano.
  const appInFront = !!main && main.isVisible() && main.isFocused()
  if (state.phase !== 'idle' && !appInFront) pill.showInactive()
  if (state.phase === 'done' || state.phase === 'error') {
    hideTimer = setTimeout(() => {
      pill?.hide()
      getCanvasWindow()?.webContents.send('voice:state', { phase: 'idle' }, recordingMode)
    }, state.phase === 'done' ? 9000 : 6000)
  }
  if (state.phase === 'idle') pill.hide()
}

/** Nivel del micrófono (0–1) que mide la píldora; se reenvía al lienzo para animar la onda y el brillo. */
export function forwardVoiceLevel(level: number): void {
  getCanvasWindow()?.webContents.send('voice:level', level)
}

export function startRecording(mode: VoiceMode = 'xen'): void {
  if (recording || !pill || !pillReady) return
  recording = true
  recordingMode = mode
  pill.webContents.send('voice:record', 'start')
  setPillState({ phase: 'listening' })
}

export function stopRecording(cancel = false): void {
  if (!recording || !pill) return
  recording = false
  pill.webContents.send('voice:record', cancel ? 'cancel' : 'stop')
  if (cancel) setPillState({ phase: 'idle' })
}

// ---------------------------------------------------------------------------
// Tecla de mantener pulsado (uiohook) + atajo alternativo para alternar.

let hookStarted = false
let holdKeyCode: number | null = null
let holdStartedAt = 0
let holdTimer: NodeJS.Timeout | null = null
let registeredShortcut: string | null = null

export async function startHotkeys(): Promise<string | null> {
  const settings = store.getSettings()
  applyToggleShortcut(settings.toggleShortcut)
  try {
    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    holdKeyCode = (UiohookKey as Record<string, number>)[settings.holdKey] ?? UiohookKey.CtrlRight
    if (!hookStarted) {
      uIOhook.on('keydown', (e) => {
        if (e.keycode !== holdKeyCode || holdStartedAt) return
        holdStartedAt = Date.now()
        holdTimer = setTimeout(() => startRecording(), MIN_HOLD_MS)
      })
      uIOhook.on('keyup', (e) => {
        if (e.keycode !== holdKeyCode) return
        const held = Date.now() - holdStartedAt
        holdStartedAt = 0
        if (holdTimer) clearTimeout(holdTimer)
        holdTimer = null
        if (held >= MIN_HOLD_MS) stopRecording()
      })
      uIOhook.start()
      hookStarted = true
    }
    return null
  } catch (err) {
    console.error('[voice] no se pudo iniciar el hook de teclado', err)
    return 'No se pudo activar la tecla de mantener pulsado; usa el atajo alternativo.'
  }
}

export async function setHoldKey(name: string): Promise<void> {
  const { UiohookKey } = await import('uiohook-napi')
  const code = (UiohookKey as Record<string, number>)[name]
  if (code === undefined) throw new Error(`Tecla desconocida: ${name}`)
  holdKeyCode = code
  store.setSettings({ holdKey: name })
}

export function toggleRecording(mode: VoiceMode = 'xen'): void {
  if (recording) stopRecording()
  else startRecording(mode)
}

export function applyToggleShortcut(accelerator: string): boolean {
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
  registeredShortcut = null
  if (!accelerator) return true
  const ok = globalShortcut.register(accelerator, () => toggleRecording('xen'))
  if (ok) registeredShortcut = accelerator
  return ok
}

export async function stopHotkeys(): Promise<void> {
  globalShortcut.unregisterAll()
  if (!hookStarted) return
  try {
    const { uIOhook } = await import('uiohook-napi')
    uIOhook.stop()
  } catch {
    // nada
  }
  hookStarted = false
}
