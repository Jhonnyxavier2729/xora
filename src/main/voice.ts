import { BrowserWindow, globalShortcut, screen, systemPreferences } from 'electron'
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
/** Al soltar la tecla se sigue grabando un instante para no cortar la última sílaba. */
const TAIL_MS = 300

/**
 * Vocabulario que se pasa al transcriptor (como hace Deska): el nombre del asistente va primero y
 * como vocativo, porque suelto Whisper lo oye como «Zen» o «Sen». Luego, nombres que suele destrozar.
 */
const VOCABULARY_PROMPT = [
  'Oye Xen. Hey Xen. Xen es el asistente de Xora.',
  'Claude, Claude Code, Claude Opus, Claude Sonnet, Claude Haiku, Anthropic, Codex, OpenCode, OpenAI, Groq.',
  'terminal, panel, agente, tarea, workspace, editor, navegador, notas, git, GitHub, commit, push, pull request, repo, rama,',
  'npm, Node, React, TypeScript, JavaScript, Electron, Vite, API, frontend, backend, refactor, deploy.'
].join(' ')

/** Correcciones de errores típicos del transcriptor con nombres propios. */
type Correction = [RegExp, string | ((match: string, ...groups: string[]) => string)]

const CORRECTIONS: Correction[] = [
  [/^(oye,?\s+|hey,?\s+)?(zen|sen|shen|chen|xem|ksen)\b/i, '$1Xen'],
  [/\b(oye|hey),?\s+(zen|sen|shen|chen)\b/gi, '$1 Xen'],
  [/\bzen\b/gi, 'Xen'],
  [/\b(cl(?:ou|au|o)d|clawed|quad)\s+(code|cod|coat|cou)\b/gi, 'Claude Code'],
  [/\bcl(?:ou|au|o)d\s+(opus|sonnet|haiku)\b/gi, (_m, model) => `Claude ${model[0].toUpperCase()}${model.slice(1).toLowerCase()}`],
  [/\b(claud|clode|cloude|klaud)\b/gi, 'Claude'],
  [/\bopen\s+codes?\b/gi, 'OpenCode'],
  [/\bcode\s*x\b/gi, 'Codex']
]

function correctTranscript(text: string): string {
  let out = text
  for (const [re, to] of CORRECTIONS) out = out.replace(re, to as string)
  return out
}

const normalize = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const NORMALIZED_PROMPT = normalize(VOCABULARY_PROMPT)

/** Con audio casi vacío, el transcriptor a veces «devuelve» el propio vocabulario. */
function isPromptEcho(text: string): boolean {
  const t = normalize(text)
  if (!t) return false
  if (NORMALIZED_PROMPT.includes(t) && t.split(' ').length >= 4) return true
  return t.includes(NORMALIZED_PROMPT)
}

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
  form.append('prompt', VOCABULARY_PROMPT)
  form.append('response_format', 'json')
  const res = await fetch(STT[provider].url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[voice] transcripción', res.status, redact(body.slice(0, 300)))
    const name = provider === 'groq' ? 'Groq' : 'OpenAI'
    if (res.status === 400) throw new Error('No se pudo procesar la grabación: habla un momento y vuelve a intentarlo.')
    if (res.status === 401 || res.status === 403) throw new Error(`La clave de ${name} no es válida o caducó. Cámbiala en Ajustes → Claves API.`)
    if (res.status === 429) throw new Error(`Llegaste al límite gratuito de ${name} por ahora. Espera unos minutos y vuelve a probar.`)
    throw new Error(redact(`La transcripción falló (${res.status}): ${body.slice(0, 200)}`))
  }
  const json = (await res.json()) as { text?: string }
  const text = (json.text ?? '').trim()
  if (isHallucination(text) || isPromptEcho(text)) return ''
  return correctTranscript(text)
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
let announceTimer: NodeJS.Timeout | null = null
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

/**
 * Abre el micrófono. Con `announceAfterMs`, la píldora y el lienzo no muestran «Escuchando» hasta
 * pasado ese tiempo: así la tecla de mantener pulsado graba desde el primer instante (no se come el
 * principio de la frase) sin parpadear cuando solo se pulsa de pasada.
 */
export function startRecording(mode: VoiceMode = 'xen', announceAfterMs = 0): void {
  if (recording || !pill || !pillReady) return
  // macOS pide permiso de micrófono la primera vez; hasta concederlo no se graba.
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    void systemPreferences.askForMediaAccess('microphone').then((ok) => {
      if (ok) startRecording(mode)
      else setPillState({ phase: 'error', message: 'Xora no tiene acceso al micrófono (Ajustes del Sistema → Privacidad y seguridad → Micrófono).' })
    })
    return
  }
  recording = true
  recordingMode = mode
  pill.webContents.send('voice:record', 'start')
  if (!announceAfterMs) setPillState({ phase: 'listening' })
  else
    announceTimer = setTimeout(() => {
      announceTimer = null
      if (recording) setPillState({ phase: 'listening' })
    }, announceAfterMs)
}

export function stopRecording(cancel = false): void {
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = null
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
  let settings = store.getSettings()
  applyToggleShortcut(settings.toggleShortcut)
  if (process.platform === 'darwin') {
    // Los teclados de Mac no suelen tener Ctrl derecho: por defecto, Opción derecha.
    if (settings.holdKey === 'CtrlRight') settings = store.setSettings({ holdKey: 'AltRight' })
    // macOS solo deja escuchar el teclado global con permiso de Accesibilidad (esto abre el aviso).
    if (!systemPreferences.isTrustedAccessibilityClient(true)) {
      return 'Para mantener una tecla y hablar, da permiso a Xora en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad, y reinicia la app. Mientras tanto, usa el atajo alternativo.'
    }
  }
  try {
    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    holdKeyCode = (UiohookKey as Record<string, number>)[settings.holdKey] ?? UiohookKey.CtrlRight
    if (!hookStarted) {
      uIOhook.on('keydown', (e) => {
        if (e.keycode !== holdKeyCode || holdStartedAt) return
        if (holdTimer) {
          // Se volvió a pulsar durante la cola de la grabación anterior: sigue la misma grabación.
          clearTimeout(holdTimer)
          holdTimer = null
          holdStartedAt = Date.now() - MIN_HOLD_MS
          return
        }
        holdStartedAt = Date.now()
        startRecording(holdKeyMode(), MIN_HOLD_MS)
      })
      uIOhook.on('keyup', (e) => {
        if (e.keycode !== holdKeyCode || !holdStartedAt) return
        const held = Date.now() - holdStartedAt
        holdStartedAt = 0
        if (held < MIN_HOLD_MS) return stopRecording(true)
        holdTimer = setTimeout(() => {
          holdTimer = null
          stopRecording()
        }, TAIL_MS)
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

/** El lienzo avisa cuando el cursor está en un cuadro de texto (no en una terminal ni en el editor). */
let textFieldFocused = false

export function setTextFieldFocused(focused: boolean): void {
  textFieldFocused = focused
}

/**
 * Como Deska: con el cursor en un cuadro de texto de Xora, la tecla de voz dicta ahí;
 * en cualquier otro sitio, lo que dices va a Xen.
 */
function holdKeyMode(): VoiceMode {
  const main = getCanvasWindow()
  return main && !main.isDestroyed() && main.isFocused() && textFieldFocused ? 'dictate' : 'xen'
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
