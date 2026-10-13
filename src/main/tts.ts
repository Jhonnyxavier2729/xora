import { OPENAI_TTS_VOICES } from '@shared/types'
import { redact } from './redact'
import { secrets, store } from './store'

const MAX_CHARS = 2000
const TIMEOUT_MS = 15_000

/**
 * Pone voz natural a un texto con OpenAI (gpt-4o-mini-tts), como Deska. Devuelve null si el motor
 * elegido es el del sistema: entonces la píldora usa speechSynthesis con la voz de Windows/macOS.
 */
export async function synthesize(text: string, voiceOverride?: string): Promise<{ audio: ArrayBuffer; mime: string } | null> {
  const settings = store.getSettings()
  if (settings.ttsProvider !== 'openai') return null
  const key = secrets.get('openai') ?? process.env.OPENAI_API_KEY ?? null
  if (!key) throw new Error('Falta la clave de OpenAI para la voz natural. Añádela en Ajustes → Claves API.')
  const input = String(text).slice(0, MAX_CHARS).trim()
  if (!input) return null
  const voice = [voiceOverride, settings.ttsVoice].find((v) => v && OPENAI_TTS_VOICES.some((o) => o.id === v)) ?? 'marin'
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input,
      instructions:
        settings.language === 'es' || !settings.language
          ? 'Habla en español neutro, con naturalidad y calidez, como un compañero de trabajo atento. Ritmo tranquilo y claro.'
          : 'Speak naturally and warmly, like an attentive colleague, at a calm and clear pace.',
      response_format: 'mp3'
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new Error('La clave de OpenAI no es válida. Cámbiala en Ajustes → Claves API.')
    if (res.status === 429) throw new Error('OpenAI rechazó la voz por límite o saldo. Revisa tu cuenta de OpenAI.')
    throw new Error(redact(`La voz de OpenAI falló (${res.status}): ${body.slice(0, 160)}`))
  }
  return { audio: await res.arrayBuffer(), mime: 'audio/mpeg' }
}
