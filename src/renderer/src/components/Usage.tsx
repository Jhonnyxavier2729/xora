import { useEffect, useRef, useState } from 'react'
import type { AgentUsage, UsageReport, UsageWindow } from '@shared/types'
import { IconReload } from './Icons'

/** Uso que le queda a Claude Code y a Codex (como el «Usage left» de Deska): chip bajo el dock + popover. */

const REFRESH_MS = 5 * 60_000

const AGENTS: { key: 'claude' | 'codex'; name: string; glyph: string }[] = [
  { key: 'claude', name: 'Claude Code', glyph: '✳' },
  { key: 'codex', name: 'Codex', glyph: '◎' }
]

const WINDOW_LABEL: Record<UsageWindow['kind'], string> = { session: 'Sesión', week: 'Semana' }

const PROBLEM: Record<NonNullable<AgentUsage['problem']>, string> = {
  'signed-out': 'Sin sesión iniciada en este equipo',
  expired: 'La sesión caducó: abre el agente una vez para renovarla',
  'api-key': 'Usa clave de API: el uso se mide en la consola del proveedor',
  'rate-limited': 'El proveedor pidió esperar; se reintentará pronto',
  unreachable: 'No se pudo consultar ahora'
}

const left = (w: UsageWindow): number => 100 - w.usedPercent

/** Lo que más limita: la ventana (sesión o semana) con menos porcentaje restante. */
function tightest(u: AgentUsage): { percent: number; kind: UsageWindow['kind'] } | null {
  if (!u.windows.length) return null
  const w = u.windows.reduce((a, b) => (left(b) < left(a) ? b : a))
  return { percent: left(w), kind: w.kind }
}

function resetText(at: number | null): string {
  if (!at) return ''
  const ms = at - Date.now()
  if (ms <= 0) return 'Se renueva ahora'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h < 24) return `Se renueva en ${h ? `${h} h ` : ''}${m} min`
  const d = new Date(at)
  const day = d.toLocaleDateString('es', { weekday: 'short' })
  const time = d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })
  return `Se renueva el ${day} a las ${time}`
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'ahora mismo'
  const m = Math.round(s / 60)
  return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`
}

const DURATION: Record<UsageWindow['kind'], number> = { session: 5 * 3_600_000, week: 7 * 86_400_000 }

/** Cuánto «debería» quedar si repartieras el uso por igual hasta que se renueve la ventana. */
function pace(w: UsageWindow): number | null {
  if (!w.resetsAt) return null
  const remaining = (w.resetsAt - Date.now()) / DURATION[w.kind]
  return remaining > 0 && remaining < 1 ? Math.round(remaining * 100) : null
}

function tone(p: number): string {
  return p <= 10 ? 'crit' : p <= 25 ? 'low' : 'ok'
}

export function UsageChip() {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = async (force = false): Promise<void> => {
    setLoading(true)
    try {
      setReport(await window.api.usage.report(force))
    } catch {
      // Se reintenta en el próximo ciclo.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const shown = AGENTS.filter((a) => report && report[a.key].problem !== 'signed-out')
  if (!report || shown.length === 0) return null

  return (
    <div className="usage menu-anchor" ref={ref}>
      <button className="usage-chip glass" title="Uso que te queda" onClick={() => setOpen(!open)}>
        {shown.map((a) => {
          const t = tightest(report[a.key])
          return (
            <span key={a.key} className="usage-mini" title={t ? `${a.name}: te queda ${t.percent} % de la ${t.kind === 'week' ? 'semana' : 'sesión'}` : a.name}>
              <span className="usage-glyph">{a.glyph}</span>
              <span className="usage-track">
                <span className={`usage-fill ${t === null ? '' : tone(t.percent)}`} style={{ width: `${t?.percent ?? 0}%` }} />
              </span>
              <span>{t === null ? '—' : `${t.kind === 'week' ? 'Sem' : 'Ses'} ${t.percent}%`}</span>
            </span>
          )
        })}
      </button>
      {open && (
        <div className="usage-pop glass">
          <div className="usage-head">
            <div>
              <strong>Uso disponible</strong>
              <p className="muted small">Agentes con sesión en este equipo</p>
            </div>
            <button className="icon-btn" title="Actualizar" disabled={loading} onClick={() => void load(true)}>
              <IconReload size={15} />
            </button>
          </div>
          {shown.map((a) => {
            const u = report[a.key]
            return (
              <section key={a.key} className="usage-agent">
                <div className="usage-agent-head">
                  <strong>
                    <span className="usage-glyph">{a.glyph}</span> {a.name}
                  </strong>
                  {u.plan && <span className="muted">{u.plan}</span>}
                </div>
                {u.problem && <p className="muted small">{PROBLEM[u.problem]}</p>}
                {u.windows.map((w) => (
                  <div key={w.kind} className="usage-window">
                    <div className="usage-row">
                      <span>{WINDOW_LABEL[w.kind]}</span>
                      <strong>Queda {left(w)} %</strong>
                    </div>
                    <div className="usage-bar">
                      <span className={`usage-fill ${tone(left(w))}`} style={{ width: `${left(w)}%` }} />
                      {pace(w) !== null && <span className="usage-pace" title="Ritmo para llegar justo al final" style={{ left: `${pace(w)}%` }} />}
                    </div>
                    {w.resetsAt && <p className="muted small">{resetText(w.resetsAt)}</p>}
                  </div>
                ))}
              </section>
            )
          })}
          <p className="muted small usage-foot">Actualizado {ago(report.updatedAt)}</p>
        </div>
      )}
    </div>
  )
}
