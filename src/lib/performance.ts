// CA et objectifs : totaux, taux d'atteinte et niveaux de la vue « Performance ». Données réservées aux admins.
import type { Objectif, Structure } from './types'

export interface Perf {
  ca: number
  objectif: number
  /** CA / objectif ; null sans objectif. */
  pct: number | null
  /** Au moins un chiffre saisi (CA ou objectif). */
  hasData: boolean
}

export function sumPerf(objectifs: Objectif[], commercialIds: Iterable<string>, year: number, structures: readonly Structure[]): Perf {
  const ids = new Set(commercialIds)
  let ca = 0
  let objectif = 0
  let hasData = false
  for (const o of objectifs) {
    if (o.annee !== year || !ids.has(o.commercial_id) || !structures.includes(o.structure)) continue
    if (o.ca !== null) {
      ca += Number(o.ca)
      hasData = true
    }
    if (o.objectif !== null) {
      objectif += Number(o.objectif)
      hasData = true
    }
  }
  return { ca, objectif, pct: objectif > 0 ? ca / objectif : null, hasData }
}

export interface PerfBucket {
  key: string
  label: string
  detail: string
  color: string
  /** Taux minimal (inclus) ; null pour « sans objectif ». */
  min: number | null
}

// Du rouge (loin de l'objectif) au vert (objectif dépassé)
export const PERF_BUCKETS: PerfBucket[] = [
  { key: 'perf:none', label: 'Sans objectif', detail: 'aucun objectif saisi', color: '#e3e8ee', min: null },
  { key: 'perf:0', label: 'Moins de 50 %', detail: 'très en retard', color: '#d64545', min: 0 },
  { key: 'perf:1', label: '50 à 80 %', detail: 'en retard', color: '#ef8a3c', min: 0.5 },
  { key: 'perf:2', label: '80 à 100 %', detail: 'proche de l\'objectif', color: '#f2c230', min: 0.8 },
  { key: 'perf:3', label: '100 à 120 %', detail: 'objectif atteint', color: '#79c267', min: 1 },
  { key: 'perf:4', label: '120 % et plus', detail: 'objectif dépassé', color: '#2b9a4e', min: 1.2 },
]

export function perfBucketOf(pct: number | null): PerfBucket {
  if (pct === null) return PERF_BUCKETS[0]
  return [...PERF_BUCKETS].reverse().find((b) => b.min !== null && pct >= b.min)!
}

/** Années disponibles (avec des chiffres), plus l'année en cours ; de la plus récente à la plus ancienne. */
export function availableYears(objectifs: Objectif[], now = new Date().getFullYear()): number[] {
  return [...new Set([now, ...objectifs.map((o) => o.annee)])].sort((a, b) => b - a)
}

/** Année affichée par défaut : l'année en cours si elle a des chiffres, sinon la plus récente qui en a. */
export function defaultYear(objectifs: Objectif[], now = new Date().getFullYear()): number {
  const years = objectifs.map((o) => o.annee)
  return years.includes(now) || !years.length ? now : Math.max(...years)
}

const oneDecimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const noDecimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const NARROW_SPACE = '\u202f'

/** « 950 € », « 80 k€ », « 1,3 M€ » */
export function formatEurosCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${oneDecimal.format(n / 1e6)}${NARROW_SPACE}M€`
  if (abs >= 1e3) return `${oneDecimal.format(n / 1e3)}${NARROW_SPACE}k€`
  return `${noDecimal.format(n)}${NARROW_SPACE}€`
}

/** « 80 % » */
export const formatPct = (pct: number | null) => (pct === null ? '—' : `${noDecimal.format(pct * 100)}${NARROW_SPACE}%`)

/** « 120 k€ / 150 k€ · 80 % » */
export function perfText(p: Perf): string {
  if (!p.hasData) return 'aucun chiffre'
  if (p.objectif <= 0) return `${formatEurosCompact(p.ca)} · sans objectif`
  return `${formatEurosCompact(p.ca)} / ${formatEurosCompact(p.objectif)} · ${formatPct(p.pct)}`
}
