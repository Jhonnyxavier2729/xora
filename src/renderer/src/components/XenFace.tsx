import { useEffect, useId, useRef } from 'react'

export type XenMood = 'idle' | 'listening' | 'thinking' | 'done' | 'error' | 'attention'

/** Desplazamiento máximo de los ojos (unidades del viewBox) y giro máximo de la cara. */
const MAX_X = 5
const MAX_Y = 3.5
const MAX_TILT = 4
const QUIET_MS = 3500
const GLANCE_EVERY: [number, number] = [6000, 11000]
const BLINK_EVERY: [number, number] = [2400, 6000]

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a)

/**
 * Xen sigue el cursor con la mirada. Calcula el vector desde su centro hasta el puntero,
 * lo atenúa con la distancia y lo aplica como variables CSS (sin re-renderizar React).
 * Si el ratón y el teclado están quietos, mira de reojo de vez en cuando y parpadea.
 */
export function XenFace({ mood = 'idle', size = 42 }: { mood?: XenMood; size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const id = useId().replace(/:/g, '')

  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    let frame = 0
    let pointer: { x: number; y: number } | null = null
    let lastActivity = Date.now()
    const timers = new Set<number>()
    const later = (ms: number, fn: () => void) => {
      const t = window.setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
    }

    const aim = (x: number, y: number, tilt: number) => {
      svg.style.setProperty('--gx', `${x.toFixed(2)}px`)
      svg.style.setProperty('--gy', `${y.toFixed(2)}px`)
      svg.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`)
    }

    const follow = () => {
      frame = 0
      if (!pointer) return aim(0, 0, 0)
      const box = svg.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist < 1) return aim(0, 0, 0)
      // Cerca de la cara la mirada es suave; a partir de ~6 veces su tamaño mira de lleno.
      // Las transformaciones CSS dentro del SVG van en unidades del viewBox (64×64).
      const strength = Math.min(1, dist / (box.width * 6))
      aim((dx / dist) * MAX_X * strength, (dy / dist) * MAX_Y * strength, (dx / dist) * MAX_TILT * strength)
    }

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      lastActivity = Date.now()
      svg.classList.remove('glancing')
      if (!frame) frame = requestAnimationFrame(follow)
    }
    const onLeave = (e: PointerEvent) => {
      if (e.relatedTarget) return
      pointer = null
      aim(0, 0, 0)
    }
    const onKey = () => {
      lastActivity = Date.now()
    }

    const blink = () => {
      later(between(BLINK_EVERY), () => {
        svg.classList.add('blink')
        later(160, () => svg.classList.remove('blink'))
        // A veces parpadea dos veces.
        if (Math.random() < 0.25) later(320, () => {
          svg.classList.add('blink')
          later(150, () => svg.classList.remove('blink'))
        })
        blink()
      })
    }

    const glance = () => {
      later(between(GLANCE_EVERY), () => {
        if (Date.now() - lastActivity > QUIET_MS) {
          const side = Math.random() < 0.5 ? -1 : 1
          svg.classList.add('glancing')
          aim(side * MAX_X, 0, side * MAX_TILT)
          later(1200, () => {
            if (Math.random() < 0.5) aim(-side * MAX_X, 0, -side * MAX_TILT)
            later(1100, () => {
              svg.classList.remove('glancing')
              follow()
            })
          })
        }
        glance()
      })
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onLeave)
    window.addEventListener('keydown', onKey)
    blink()
    glance()
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach((t) => clearTimeout(t))
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onLeave)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <svg ref={ref} className={`xen xen-${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-label="Xen">
      <defs>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#262c44" />
          <stop offset="1" stopColor="#10131d" />
        </linearGradient>
        <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ce1e6" />
          <stop offset=".5" stopColor="#7c6bff" />
          <stop offset="1" stopColor="#ff5c8a" />
        </linearGradient>
      </defs>
      <g className="xen-head">
        <rect x="5" y="5" width="54" height="54" rx="17" fill={`url(#${id}body)`} />
        <rect x="5.75" y="5.75" width="52.5" height="52.5" rx="16.25" fill="none" stroke={`url(#${id}rim)`} strokeWidth="2.5" />
        <g className="xen-eyes">
          {mood === 'done' ? (
            <>
              <path className="xen-eye-arc" d="M19 30 Q24 23 29 30" />
              <path className="xen-eye-arc" d="M35 30 Q40 23 45 30" />
            </>
          ) : (
            <>
              <rect className="xen-eye" x="20" y={mood === 'attention' ? 20 : 23} width="7" height={mood === 'attention' ? 15 : 12} rx="3.5" />
              <rect className="xen-eye" x="37" y={mood === 'attention' ? 20 : 23} width="7" height={mood === 'attention' ? 15 : 12} rx="3.5" />
            </>
          )}
        </g>
        {mood === 'listening' ? (
          <g className="xen-bars">
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} className="xen-bar" x={24 + i * 5} y="39" width="3" height="9" rx="1.5" style={{ ['--i' as string]: i }} />
            ))}
          </g>
        ) : (
          <rect
            className="xen-mouth"
            x={mood === 'thinking' ? 28 : mood === 'error' ? 26 : 25}
            y={mood === 'error' ? 44 : 42}
            width={mood === 'thinking' ? 8 : mood === 'error' ? 12 : 14}
            height="3.5"
            rx="1.75"
          />
        )}
      </g>
    </svg>
  )
}
