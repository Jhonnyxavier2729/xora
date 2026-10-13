// Temas, acentos y fondos de Xora.

export interface Theme {
  id: string
  name: string
  light: boolean
  /** Color del punto de la muestra. */
  dot: string
  vars: Record<string, string>
}

const dark = (id: string, name: string, dot: string, c: [string, string, string, string, string, string, string, string, string]): Theme => ({
  id,
  name,
  light: false,
  dot,
  vars: {
    '--bg': c[0],
    '--bg-2': c[1],
    '--panel': c[2],
    '--panel-2': c[3],
    '--border': c[4],
    '--border-2': c[5],
    '--text': c[6],
    '--muted': c[7],
    '--glass': c[8],
    '--overlay': 'rgba(255, 255, 255, 0.05)',
    '--overlay-2': 'rgba(255, 255, 255, 0.1)',
    '--glass-border': 'rgba(255, 255, 255, 0.08)'
  }
})

const light = (id: string, name: string, dot: string, c: [string, string, string, string, string, string, string, string, string]): Theme => ({
  ...dark(id, name, dot, c),
  light: true,
  vars: {
    ...dark(id, name, dot, c).vars,
    '--overlay': 'rgba(0, 0, 0, 0.05)',
    '--overlay-2': 'rgba(0, 0, 0, 0.09)',
    '--glass-border': 'rgba(0, 0, 0, 0.1)'
  }
})

export const THEMES: Theme[] = [
  dark('graphite', 'Grafito', '#ff6b4a', ['#141519', '#191a1f', '#1c1d23', '#23242b', '#2c2d35', '#3a3b45', '#ecedf1', '#8d8f9c', 'rgba(24, 25, 31, 0.84)']),
  light('paper', 'Papel', '#ff6b4a', ['#f3eee4', '#ece6da', '#fbf8f2', '#f1ebdf', '#ddd5c5', '#cfc5b2', '#2a2620', '#7d7466', 'rgba(250, 247, 240, 0.88)']),
  dark('carbon', 'Carbón', '#ff6b4a', ['#070707', '#0d0d0d', '#111111', '#171717', '#232323', '#2f2f2f', '#eeeeee', '#888888', 'rgba(14, 14, 14, 0.86)']),
  dark('ink', 'Tinta', '#4f8cff', ['#0b0d12', '#10131a', '#12151d', '#171b25', '#232836', '#2f3647', '#e6ebf5', '#8a93a8', 'rgba(16, 19, 27, 0.84)']),
  light('sand', 'Arena', '#4f8cff', ['#d9cfba', '#d1c6af', '#e9e1cf', '#ded5c1', '#c2b69c', '#b3a68a', '#2b261c', '#6e6553', 'rgba(233, 225, 207, 0.88)']),
  dark('dusk', 'Ocaso', '#f472b6', ['#24252f', '#2a2b36', '#2e2f3b', '#353645', '#3f4051', '#4b4c60', '#ecebf3', '#9c9bb0', 'rgba(46, 47, 59, 0.86)']),
  dark('abyss', 'Abismo', '#22d3ee', ['#03050a', '#070a12', '#0a0e18', '#0f1422', '#18203a', '#22305a', '#e6ecff', '#7f8bb0', 'rgba(8, 12, 22, 0.86)']),
  light('blossom', 'Flor', '#e0218a', ['#fbeef2', '#f6e3e9', '#fff7fa', '#f9e9ef', '#ecd0da', '#e0bccb', '#3a2530', '#8f6c7b', 'rgba(255, 247, 250, 0.88)']),
  dark('mist', 'Niebla', '#8aa0b8', ['#23262b', '#282b31', '#2c2f35', '#33363d', '#3c4048', '#474b54', '#e8eaee', '#959aa5', 'rgba(44, 47, 53, 0.86)'])
]

export const ACCENTS = ['#ff6b4a', '#22d3ee', '#2dd4bf', '#a78bfa', '#f472b6', '#fbbf24', '#fb7185']

/** Obras de la colección de Birmingham Museums Trust, dominio público (CC0). */
export const WALLPAPERS: { id: string; name: string }[] = [
  { id: 'assembly', name: 'Asamblea' },
  { id: 'hillside', name: 'Ladera' },
  { id: 'river-bend', name: 'Recodo del río' },
  { id: 'vortex', name: 'Vórtice' },
  { id: 'wide-river', name: 'Río ancho' },
  { id: 'teahouse', name: 'Casa de té' },
  { id: 'riverside', name: 'Ribera' },
  { id: 'sleepers', name: 'Durmientes' },
  { id: 'thicket', name: 'Espesura' },
  { id: 'toy-horse', name: 'Caballito' },
  { id: 'pasture', name: 'Pasto' },
  { id: 'nave', name: 'Nave' },
  { id: 'green-valley', name: 'Valle verde' },
  { id: 'bare-trees', name: 'Árboles desnudos' },
  { id: 'golden-port', name: 'Puerto dorado' },
  { id: 'nightjar', name: 'Chotacabras' },
  { id: 'quiet-study', name: 'Estudio tranquilo' },
  { id: 'deep-valley', name: 'Valle profundo' },
  { id: 'hedge-row', name: 'Seto' },
  { id: 'green-hills', name: 'Colinas verdes' },
  { id: 'harbour', name: 'Puerto' },
  { id: 'long-crossing', name: 'Larga travesía' },
  { id: 'studio', name: 'Taller' },
  { id: 'blue-roof', name: 'Tejado azul' },
  { id: 'dusk-moor', name: 'Páramo al ocaso' },
  { id: 'headland', name: 'Cabo' },
  { id: 'gold-water', name: 'Agua dorada' },
  { id: 'open-water', name: 'Mar abierto' },
  { id: 'dark-lake', name: 'Lago oscuro' },
  { id: 'afternoon', name: 'Tarde' },
  { id: 'castle-green', name: 'Castillo verde' },
  { id: 'standing-stones', name: 'Menhires' },
  { id: 'cliff-castle', name: 'Castillo en el acantilado' },
  { id: 'grey-tide', name: 'Marea gris' },
  { id: 'blue-range', name: 'Sierra azul' },
  { id: 'pink-water', name: 'Agua rosa' },
  { id: 'teal-coast', name: 'Costa turquesa' },
  { id: 'desert-road', name: 'Camino del desierto' },
  { id: 'market-day', name: 'Día de mercado' },
  { id: 'alpine-falls', name: 'Cascada alpina' },
  { id: 'red-dunes', name: 'Dunas rojas' },
  { id: 'red-bridge', name: 'Puente rojo' },
  { id: 'wave-study', name: 'Estudio de ola' },
  { id: 'venice', name: 'Venecia' },
  { id: 'misty-valley', name: 'Valle brumoso' },
  { id: 'city-haze', name: 'Bruma urbana' },
  { id: 'still-lake', name: 'Lago en calma' },
  { id: 'low-horizon', name: 'Horizonte bajo' },
  { id: 'white-dome', name: 'Cúpula blanca' },
  { id: 'pale-shore', name: 'Orilla pálida' }
]

export const wallpaperUrl = (id: string, thumb = false) => `wallpapers/${id}${thumb ? '-thumb' : ''}.webp`

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Aplica tema y acento como variables CSS en :root. */
export function applyAppearance(themeId: string, accent: string): void {
  const theme = themeById(themeId)
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-2', accent)
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 22%, transparent)`)
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  root.dataset.mode = theme.light ? 'light' : 'dark'
}
