import type { Settings } from '@shared/types'

/** Lectura en voz alta de Xen: voz natural de OpenAI o, si no, la del sistema. La usan la píldora y Ajustes. */

let current: HTMLAudioElement | null = null

export function stopSpeaking(): void {
  if (current) {
    current.pause()
    URL.revokeObjectURL(current.src)
    current = null
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

/** Voces del sistema; Chromium las carga de forma asíncrona la primera vez. */
export function systemVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
}

type SpeakOptions = Pick<Settings, 'ttsProvider' | 'ttsVoice' | 'systemVoice' | 'speechRate' | 'language'>

/** Lee el texto. Si la voz natural falla (sin clave, sin red…), cae a la del sistema y avisa con el error. */
export async function speak(text: string, opts: SpeakOptions): Promise<string | null> {
  stopSpeaking()
  const rate = Math.min(1.5, Math.max(0.7, opts.speechRate || 1))
  let fallbackError: string | null = null
  if (opts.ttsProvider === 'openai') {
    try {
      const res = await window.api.voice.tts(text, opts.ttsVoice)
      if (res) {
        const audio = new Audio(URL.createObjectURL(new Blob([res.audio], { type: res.mime })))
        audio.playbackRate = rate
        audio.preservesPitch = true
        current = audio
        audio.onended = () => {
          if (current === audio) stopSpeaking()
        }
        await audio.play()
        return null
      }
    } catch (err) {
      fallbackError = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
    }
  }
  if (!('speechSynthesis' in window)) return fallbackError
  const voices = await systemVoices()
  const lang = (opts.language || 'es').toLowerCase()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = rate
  const voice = voices.find((v) => v.name === opts.systemVoice) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang))
  if (voice) u.voice = voice
  speechSynthesis.speak(u)
  return fallbackError
}
