import { CaretDown, Check } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * Chips y menús del compositor, con el lenguaje de Deska: botones «fantasma» de 26 px sin borde y un menú
 * anclado con grupos, marcas de verificación y descripciones. El menú se dibuja en el <body>, así que
 * ni el recorte de los paneles ni el zoom del lienzo lo afectan.
 */

export function Chip({
  label,
  leading,
  caret,
  active,
  disabled,
  title,
  expanded,
  onClick,
  className = ''
}: {
  label?: ReactNode
  leading?: ReactNode
  caret?: boolean
  active?: boolean
  disabled?: boolean
  title?: string
  expanded?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`xchip ${className}`}
      data-active={active ? 'true' : undefined}
      disabled={disabled}
      title={title}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {leading}
      {label !== undefined && label !== '' && <span className="xchip-label">{label}</span>}
      {caret && <CaretDown className="xchip-caret" size={10} weight="bold" aria-hidden />}
    </button>
  )
}

export interface MenuItem {
  value: string
  label: string
  detail?: string
  group?: string
  leading?: ReactNode
  disabled?: boolean
}

interface MenuProps {
  items: MenuItem[]
  /** Valores marcados con ✓ (uno por grupo en los menús de ajustes). */
  selected: string[]
  anchorRef: RefObject<HTMLElement | null>
  width?: number
  footer?: ReactNode
  /** Si es true, el menú sigue abierto al elegir (para ajustar varias cosas seguidas). */
  keepOpen?: boolean
  onPick: (value: string) => void
  onClose: () => void
}

export function ChipMenu({ items, selected, anchorRef, width = 280, footer, keepOpen, onPick, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => selected.includes(i.value))))

  // Colocación respecto al ancla: por encima si hay sitio (como en Deska) y, si no, por debajo.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const menu = ref.current
    if (!anchor || !menu) return
    const r = anchor.getBoundingClientRect()
    const margin = 10
    const height = menu.offsetHeight
    const above = r.top - margin
    const below = window.innerHeight - r.bottom - margin
    const up = above >= Math.min(height, 360) || above > below
    const maxHeight = Math.max(160, Math.min(520, up ? above - 4 : below - 4))
    const shown = Math.min(height, maxHeight)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ left, top: up ? r.top - shown - 6 : r.bottom + 6, maxHeight })
  }, [anchorRef, width, items.length])

  useEffect(() => {
    ref.current?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [anchorRef, onClose])

  const pick = (item: MenuItem): void => {
    if (item.disabled) return
    onPick(item.value)
    if (!keepOpen) onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      let next = active
      for (let i = 0; i < items.length; i++) {
        next = (next + step + items.length) % items.length
        if (!items[next].disabled) break
      }
      setActive(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) pick(item)
    }
  }

  let lastGroup: string | undefined
  return createPortal(
    <div
      ref={ref}
      className="xmenu"
      role="menu"
      tabIndex={-1}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
    >
      <div className="xmenu-list">
        {items.map((item, i) => {
          const heading = item.group && item.group !== lastGroup ? <div className="xmenu-group">{item.group}</div> : null
          lastGroup = item.group
          const isSelected = selected.includes(item.value)
          return (
            <div key={item.value || `__${i}`} style={{ display: 'contents' }}>
              {heading}
              <button
                type="button"
                role="menuitem"
                className="xmenu-item"
                data-active={i === active ? 'true' : undefined}
                data-selected={isSelected ? 'true' : undefined}
                disabled={item.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
              >
                <span className="xmenu-check">{isSelected && <Check size={13} weight="bold" aria-hidden />}</span>
                {item.leading}
                <span className="xmenu-text">
                  <span className="xmenu-label">{item.label}</span>
                  {item.detail && <span className="xmenu-detail">{item.detail}</span>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
      {footer && <div className="xmenu-footer">{footer}</div>}
    </div>,
    document.body
  )
}
