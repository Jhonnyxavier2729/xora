import type { VoiceState } from '@shared/types'
import './pill.css'
import { speak, stopSpeaking } from '../speech'

const pill = document.getElementById('pill')!
const phaseEl = document.getElementById('pill-phase')!
const detailEl = document.getElementById('pill-detail')!

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let cancelled = false
let startedAt = 0
/** El micrófono tarda un momento en abrirse; una orden de parar en ese intervalo se aplica al terminar. */
let starting = false
let pendingStop: 'stop' | 'cancel' | null = null

const LABELS: Record<VoiceState['phase'], string> = {
  idle: '',
  listening: 'Escuchando…',
  transcribing: 'Transcribiendo…',
  thinking: 'Xen está pensando…',
  done: 'Xen',
  error: 'No se pudo'
}

function render(state: VoiceState): void {
  pill.className = `pill ${state.phase === 'idle' ? 'hidden' : ''} phase-${state.phase}`
  phaseEl.textContent = LABELS[state.phase]
  if (state.phase === 'thinking') detailEl.textContent = `«${state.transcript}»`
  else if (state.phase === 'done') detailEl.textContent = state.reply
  else if (state.phase === 'error') detailEl.textContent = state.message
  else if (state.phase === 'listening') detailEl.textContent = 'Suelta la tecla (o pulsa aquí) cuando termines'
  else detailEl.textContent = ''
}

async function speakReply(text: string): Promise<void> {
  const settings = await window.api.settings.get()
  if (!settings.speakReplies) return
  // Solo la primera línea: el resto es la lista de acciones que hizo Xen.
  await speak(text.split('\n')[0], settings)
}

async function start(): Promise<void> {
  cancelled = false
  chunks = []
  pendingStop = null
  starting = true
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    })
  } catch {
    starting = false
    window.api.voice.pillError('No hay acceso al micrófono. Revisa los permisos de micrófono de Windows.')
    return
  } finally {
    starting = false
  }
  // Se pidió parar mientras el micrófono se abría: si era cancelar, se suelta sin enviar nada.
  if (pendingStop === 'cancel') {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
    return
  }
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  recorder = new MediaRecorder(stream, { mimeType: mime })
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.onstop = async () => {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    const duration = Date.now() - startedAt
    if (cancelled) return
    if (duration < 400 || !chunks.length) {
      window.api.voice.pillError('Grabación demasiado corta.')
      return
    }
    const blob = new Blob(chunks, { type: 'audio/webm' })
    // Como Deska: se decodifica aquí y se envía WAV mono a 16 kHz. Un webm cortado o casi vacío es
    // justo lo que el transcriptor rechaza con «could not process file».
    let samples: Float32Array
    try {
      samples = await decodeToMono16k(blob)
    } catch {
      window.api.voice.pillError('No se pudo leer la grabación. Mantén la tecla un poco más mientras hablas.')
      return
    }
    if (samples.length < TARGET_RATE * 0.3) {
      window.api.voice.pillError('Grabación demasiado corta.')
      return
    }
    if (isSilent(samples)) {
      window.api.voice.pillError('No se oyó nada. Revisa que el micrófono correcto esté activo en Windows.')
      return
    }
    window.api.voice.sendAudio(encodeWav(samples, TARGET_RATE), 'audio/wav')
  }
  startedAt = Date.now()
  recorder.start(250)
  meter(stream)
  if (pendingStop) stop(false)
}

const TARGET_RATE = 16_000
/** Por debajo de este volumen (RMS en ventanas de 50 ms) se considera silencio. */
const SILENT_RMS = 0.003

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * TARGET_RATE)), TARGET_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void ctx.close()
  }
}

function isSilent(samples: Float32Array): boolean {
  const frame = Math.floor(TARGET_RATE * 0.05)
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let sum = 0
    for (let i = start; i < start + frame; i++) sum += samples[i] * samples[i]
    if (Math.sqrt(sum / frame) >= SILENT_RMS) return false
  }
  return true
}

/** WAV PCM de 16 bits, mono. */
function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

/** Mide el volumen (RMS) del micrófono y lo envía a main ~20 veces por segundo. */
function meter(source: MediaStream): void {
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(source).connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  // setInterval y no requestAnimationFrame: la píldora suele estar oculta y ahí rAF no se ejecuta.
  const timer = setInterval(() => {
    if (!stream || stream !== source) {
      clearInterval(timer)
      window.api.voice.sendLevel(0)
      void ctx.close()
      return
    }
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    window.api.voice.sendLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
  }, 50)
}

function stop(cancel: boolean): void {
  if (starting) {
    pendingStop = cancel ? 'cancel' : 'stop'
    return
  }
  cancelled = cancel
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  recorder = null
}

window.api.voice.onRecord((cmd) => {
  if (cmd === 'start') void start()
  else stop(cmd === 'cancel')
})

window.api.voice.onState((state) => {
  render(state)
  if (state.phase === 'done') void speakReply(state.reply)
  // Al volver a hablar, Xen se calla.
  if (state.phase === 'listening') stopSpeaking()
})

pill.addEventListener('click', () => {
  if (recorder) window.api.voice.stop(false)
  else window.api.voice.dismiss()
})

render({ phase: 'idle' })
