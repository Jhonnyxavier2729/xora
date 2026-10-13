import { useId } from 'react'

/** Marca de Xora: una X de dos trazos cruzados con un destello en el centro. */
export function XoraMark({ size = 20 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="xora-mark">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d2236" />
          <stop offset="1" stopColor="#0b0e17" />
        </linearGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ce1e6" />
          <stop offset="1" stopColor="#7c6bff" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc36b" />
          <stop offset="1" stopColor="#ff5c8a" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}bg)`} />
      <path d="M19.5 18.5 L44.5 45.5" stroke={`url(#${id}a)`} strokeWidth="8.5" strokeLinecap="round" />
      <path d="M44.5 18.5 L19.5 45.5" stroke="#0b0e17" strokeWidth="12" strokeLinecap="round" opacity=".55" />
      <path d="M44.5 18.5 L19.5 45.5" stroke={`url(#${id}b)`} strokeWidth="8.5" strokeLinecap="round" />
      <path d="M32 25.6 L33.7 30.3 L38.4 32 L33.7 33.7 L32 38.4 L30.3 33.7 L25.6 32 L30.3 30.3 Z" fill="#fff" />
    </svg>
  )
}
