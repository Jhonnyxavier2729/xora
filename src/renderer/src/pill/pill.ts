import type { VoiceState } from '@shared/types'
import './pill.css'

const pill = document.getElementById('pill')!
const phaseEl = document.getElementById('pill-phase')!
const detailEl = document.getElementById('pill-detail')!

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let cancelled = false
let startedAt = 0

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

async function speak(text: string): Promise<void> {
  const settings = await window.api.settings.get()
  if (!settings.speakReplies || !('speechSynthesis' in window)) return
  const first = text.split('\n')[0]
  const u = new SpeechSynthesisUtterance(first)
  u.lang = settings.language || 'es'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

async function start(): Promise<void> {
  cancelled = false
  chunks = []
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch {
    window.api.voice.pillError('No hay acceso al micrófono. Revisa los permisos de micrófono de Windows.')
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
    window.api.voice.sendAudio(await blob.arrayBuffer(), 'audio/webm')
  }
  startedAt = Date.now()
  recorder.start(250)
  meter(stream)
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
  if (state.phase === 'done') void speak(state.reply)
})

pill.addEventListener('click', () => {
  if (recorder) window.api.voice.stop(false)
  else window.api.voice.dismiss()
})

render({ phase: 'idle' })
