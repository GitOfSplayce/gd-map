// Lecture des listes de zones au format du fichier Excel : "22, 35P, 52G, 75-7".
//  - séparateurs : , . / ; et espace
//  - suffixe P = partiel, G = gestion, sans suffixe = propre
//  - un code à un chiffre est complété par un 0 (9 → 09)
//  - 20 ou 2AB → 2A + 2B
//  - 75-7 = arrondissement, 75 seul = tout Paris (75007 est aussi accepté)
//  - ? est ignoré ; toute valeur inconnue est signalée
import type { Couverture } from './types'
import { ZONE_BY_CODE, compareZoneCodes, isParisArr } from './zones'

export interface ParsedZone {
  code: string
  couverture: Couverture
  raw: string
}

export interface ZoneParseIssue {
  raw: string
  level: 'error' | 'warning'
  message: string
}

export interface ZoneParseResult {
  zones: ParsedZone[]
  issues: ZoneParseIssue[]
}

const SUFFIXES: Record<string, Couverture> = { P: 'partiel', G: 'gestion' }

function resolveCodes(base: string): string[] | null {
  if (/^\d$/.test(base)) return ['0' + base]
  if (base === '20' || base === '2AB' || base === '2A2B') return ['2A', '2B']
  const arr = base.match(/^75-0*(\d{1,2})$/) ?? base.match(/^750(\d{2})$/) ?? base.match(/^751(16)$/)
  if (arr) {
    const n = Number(arr[1])
    return n >= 1 && n <= 20 ? [`75-${n}`] : null
  }
  if (base.startsWith('75-')) return null
  return ZONE_BY_CODE.has(base) ? [base] : null
}

export function parseZoneList(input: unknown): ZoneParseResult {
  const zones: ParsedZone[] = []
  const issues: ZoneParseIssue[] = []
  const text = String(input ?? '')
    .toUpperCase()
    .replace(/\s*[-–—]\s*/g, '-')

  for (const token of text.split(/[\s,.;/]+/)) {
    const raw = token.replace(/\?/g, '')
    if (!raw) continue

    const m = raw.match(/^(.+?)([PG])?$/)!
    const base = m[1]
    const couverture = m[2] ? SUFFIXES[m[2]] : 'propre'
    const codes = resolveCodes(base)

    if (!codes) {
      issues.push({ raw: token, level: 'error', message: `« ${token} » n'est pas une zone connue` })
      continue
    }

    for (const code of codes) {
      const existing = zones.find((z) => z.code === code)
      if (!existing) {
        zones.push({ code, couverture, raw: token })
      } else if (existing.couverture !== couverture) {
        issues.push({
          raw: token,
          level: 'warning',
          message: `${code} apparaît deux fois avec des couvertures différentes : « ${existing.raw} » est conservé`,
        })
      }
    }
  }

  if (zones.some((z) => z.code === '75') && zones.some((z) => isParisArr(z.code))) {
    issues.push({
      raw: '75',
      level: 'warning',
      message: '75 couvre déjà tout Paris : les arrondissements listés en plus sont redondants',
    })
  }

  return { zones, issues }
}

const SUFFIX_OF: Record<Couverture, string> = { propre: '', partiel: 'P', gestion: 'G' }

/** Format inverse, utilisé pour l'export Excel et l'édition : "22, 35P, 52G, 75-7". */
export function formatZoneList(zones: { zone_code: string; couverture: Couverture }[]): string {
  return [...zones]
    .sort((a, b) => compareZoneCodes(a.zone_code, b.zone_code))
    .map((z) => z.zone_code + SUFFIX_OF[z.couverture])
    .join(', ')
}
