// Couleurs : attribution automatique de couleurs bien distinctes, et couleurs des managers.

export const isHexColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

// Palette catégorielle lisible en aplat comme en opacité réduite (pas de teintes trop claires).
export const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42b4d4', '#f032e6', '#9bc53d',
  '#469990', '#9a6324', '#800000', '#808000', '#000075', '#e6ab02', '#1b9e77', '#d95f02',
  '#7570b3', '#e7298a', '#66a61e', '#a6761d', '#1f78b4', '#b15928', '#6a3d9a', '#ff7f00',
  '#33a02c', '#fb9a99', '#cab2d6', '#b2df8a', '#a6cee3', '#fdbf6f',
]

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

function distance(a: string, b: string): number {
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
  if (free && taken.every((t) => distance(t, free) > 12)) return free
  let best = PALETTE[0]
  let bestScore = -1
  for (const c of [...PALETTE, ...EXTRA]) {
    const score = taken.length ? Math.min(...taken.map((t) => distance(t, c))) : 100
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

/** Couleurs stables pour une liste de managers (triée par nom). */
export function managerColors(names: string[]): Map<string, string> {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'fr'))
  return new Map(
    sorted.map((name, i) => [
      name,
      i < MANAGER_PALETTE.length ? MANAGER_PALETTE[i] : hslToHex((i * 137.508) % 360, 0.6, 0.45),
    ]),
  )
}

/** Noir ou blanc selon la luminosité du fond. */
export function readableTextColor(bg: string): string {
  if (!isHexColor(bg)) return '#111'
  return toLab(bg)[0] > 60 ? '#111' : '#fff'
}
