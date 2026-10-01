// Couleurs : attribution automatique de couleurs bien distinctes, et couleurs des managers.

/** Couleurs de la charte GDCom 2023. */
export const BRAND = { saphir: '#1A428A', jaune: '#F5A800', azurin: '#95D4E9', grisNoir: '#3C3C3B' }

export const isHexColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

// Palette organisée : une colonne par teinte, une ligne par nuance (du plus foncé au plus clair).
// Teintes lisibles en aplat comme en opacité réduite sur la carte.
export const PALETTE_HUES = ['Rouge', 'Orange', 'Ambre', 'Citron vert', 'Vert', 'Sarcelle', 'Cyan', 'Bleu', 'Violet', 'Rose']
export const PALETTE_GRID: string[][] = [
  ['#991b1b', '#9a3412', '#92400e', '#3f6212', '#166534', '#115e59', '#155e75', '#1e40af', '#5b21b6', '#9d174d'],
  ['#b91c1c', '#c2410c', '#b45309', '#4d7c0f', '#15803d', '#0f766e', '#0e7490', '#1d4ed8', '#6d28d9', '#be185d'],
  ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
  ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'],
]

/** Ordre d'attribution automatique : nuances moyennes d'abord (les plus lisibles), puis foncées, puis claires. */
export const PALETTE = [...PALETTE_GRID[2], ...PALETTE_GRID[1], ...PALETTE_GRID[3], ...PALETTE_GRID[0]]

const MANAGER_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf',
  '#bcbd22', '#393b79', '#ad494a', '#637939',
]

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

function toLab(hex: string): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hexToRgb(hex).map(lin)
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a)
  const [l2, a2, b2] = toLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// Candidats au-delà de la palette : teintes réparties par l'angle d'or.
const EXTRA = Array.from({ length: 72 }, (_, i) => hslToHex((i * 137.508) % 360, 0.65, i % 2 ? 0.42 : 0.55))

/** Couleur la plus éloignée de celles déjà utilisées (la palette est prioritaire). */
export function pickDistinctColor(used: string[]): string {
  const taken = used.filter(isHexColor).map((c) => c.toLowerCase())
  const free = PALETTE.find((c) => !taken.includes(c))
  if (free && taken.every((t) => colorDistance(t, free) > 12)) return free
  let best = PALETTE[0]
  let bestScore = -1
  for (const c of [...PALETTE, ...EXTRA]) {
    const score = taken.length ? Math.min(...taken.map((t) => colorDistance(t, c))) : 100
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

/** Seuil (ΔE) sous lequel deux couleurs se confondent sur la carte. */
export const TOO_CLOSE = 14

/** Candidats classés du plus éloigné au plus proche des couleurs déjà utilisées. */
export function rankedFreeColors(used: string[], count = 12): string[] {
  const taken = used.filter(isHexColor).map((c) => c.toLowerCase())
  const score = (c: string) => (taken.length ? Math.min(...taken.map((t) => colorDistance(t, c))) : 100)
  return [...new Set([...PALETTE, ...EXTRA])]
    .map((c) => ({ c, d: score(c) }))
    .filter((x) => x.d > 0.5)
    .sort((a, b) => b.d - a.d)
    .slice(0, count)
    .map((x) => x.c)
}

/** « Autre couleur » : parcourt les meilleures couleurs libres, une nouvelle à chaque clic. */
export function nextDistinctColor(used: string[], current: string): string {
  const ranked = rankedFreeColors(used)
  const i = ranked.indexOf(current.toLowerCase())
  return ranked[(i + 1) % ranked.length] ?? pickDistinctColor(used)
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(isHexColor(hex) ? hex : '#888888').map((v) => v / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max]
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255)
}

/**
 * Couleurs des managers : celle choisie dans l'admin, sinon une couleur stable de la palette
 * (même attribution que la migration qui a créé la table, par ordre alphabétique).
 */
export function managerColors(names: string[], chosen: { nom: string; couleur: string | null }[] = []): Map<string, string> {
  const sorted = [...new Set([...names, ...chosen.map((m) => m.nom)])].sort((a, b) => a.localeCompare(b, 'fr'))
  const fixed = new Map(chosen.filter((m) => m.couleur && isHexColor(m.couleur)).map((m) => [m.nom, m.couleur!]))
  return new Map(
    sorted.map((name, i) => [
      name,
      fixed.get(name) ?? (i < MANAGER_PALETTE.length ? MANAGER_PALETTE[i] : hslToHex((i * 137.508) % 360, 0.6, 0.45)),
    ]),
  )
}

/** Assombrit une couleur (mélange avec du noir, `amount` entre 0 et 1). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}

/** Moyenne de plusieurs couleurs (teinte de fond d'une zone partagée en mode camemberts). */
export function mixColors(colors: string[]): string {
  const rgbs = colors.filter(isHexColor).map(hexToRgb)
  if (!rgbs.length) return '#ffffff'
  const avg = (i: number) => rgbs.reduce((sum, c) => sum + c[i], 0) / rgbs.length
  return rgbToHex(avg(0), avg(1), avg(2))
}

/** Couleur obtenue en posant `hex` avec l'opacité donnée sur un fond blanc. */
export function blendWithWhite(hex: string, opacity: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => c * opacity + 255 * (1 - opacity)
  return rgbToHex(mix(r), mix(g), mix(b))
}

/** Noir ou blanc selon la luminosité du fond. */
export function readableTextColor(bg: string): string {
  if (!isHexColor(bg)) return '#111'
  return toLab(bg)[0] > 60 ? '#111' : '#fff'
}
