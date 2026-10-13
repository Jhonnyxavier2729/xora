/** Quita el prefijo que Electron añade a los errores de ipcRenderer.invoke. */
export function errMsg(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}
