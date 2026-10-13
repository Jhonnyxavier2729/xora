const REDACTED = '[oculto]'

/**
 * Oculta secretos en textos que se muestran al usuario, se envían al móvil o se registran:
 * cabeceras de autorización, claves con prefijos conocidos, campos JSON de tipo token y
 * variables de entorno con claves.
 */
const RULES: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`],
  [/\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abp]-[A-Za-z0-9-]{10,})/g, REDACTED],
  [/("(?:token|access_token|refresh_token|id_token|apiKey|api_key|password|secret|authorization)"\s*:\s*")[^"]*(")/gi, `$1${REDACTED}$2`],
  [/\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, `$1${REDACTED}`]
]

export function redact(text: string): string {
  let out = String(text)
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}
