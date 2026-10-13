/** Imán al mover paneles: bordes con bordes y centros con centros (sin guías visibles). */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function bestDelta(moving: number[], targets: number[][], threshold: number): number {
  // moving y cada target: [inicio, centro, fin] en un eje.
  let best: number | null = null
  for (const t of targets) {
    const pairs: [number, number][] = [
      [moving[0], t[0]],
      [moving[0], t[2]],
      [moving[2], t[0]],
      [moving[2], t[2]],
      [moving[1], t[1]]
    ]
    for (const [m, target] of pairs) {
      const delta = target - m
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) best = delta
    }
  }
  return best ?? 0
}

/**
 * Cuánto hay que desplazar un rectángulo para alinearlo con los paneles cercanos.
 * `threshold` va en unidades del mundo (en pantalla son ~8 px a cualquier zoom).
 */
export function snapRect(rect: Rect, others: Rect[], threshold: number): { dx: number; dy: number } {
  const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w]
  const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h]
  return { dx: bestDelta(xs(rect), others.map(xs), threshold), dy: bestDelta(ys(rect), others.map(ys), threshold) }
}
