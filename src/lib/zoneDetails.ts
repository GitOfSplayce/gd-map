import { strongest, type MapModel, type ZoneEntry } from './mapModel'
import { structureCodes } from './structures'
import type { Commercial, Couverture, Objectif, Structure } from './types'
import { ZONE_BY_CODE, compareZoneCodes, isParisArr, shortZoneLabel } from './zones'

export interface ZonePerson {
  key: string
  commercial: Commercial
  structure: Structure
  couverture: Couverture
  /** Précision pour Paris : "Tout Paris", "Arrondissements 7e, 8e", "Via 75 (tout Paris)". */
  scope: string | null
  objectif?: Objectif
}

const arrLabel = (code: string) => shortZoneLabel(code).replace('Paris ', '')

/** Commerciaux d'une zone, regroupés par commercial et structure. */
export function zonePeople(code: string, model: MapModel): ZonePerson[] {
  const order = structureCodes(model.structures)
  const groups = new Map<string, ZoneEntry[]>()
  for (const e of model.entries.get(code) ?? []) {
    const k = `${e.commercial.id}|${e.affectation.structure}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }

  return [...groups.values()]
    .map((g) => {
      const first = g[0]
      const sources = [...new Set(g.map((e) => e.sourceZone))].sort(compareZoneCodes)
      let scope: string | null = null
      if (code === '75') {
        scope = sources.includes('75') ? 'Tout Paris' : `Arrondissements ${sources.map(arrLabel).join(', ')}`
      } else if (isParisArr(code) && sources.includes('75')) {
        scope = 'Via « 75 » (tout Paris)'
      }
      return {
        key: first.key,
        commercial: first.commercial,
        structure: first.affectation.structure,
        couverture: strongest(g.map((e) => e.affectation.couverture)),
        scope,
        objectif: model.objectifOf(first.commercial.id, first.affectation.structure),
      }
    })
    .sort(
      (a, b) =>
        order.indexOf(a.structure) - order.indexOf(b.structure) ||
        a.commercial.nom.localeCompare(b.commercial.nom, 'fr'),
    )
}

export function zoneTitle(code: string): { title: string; subtitle: string } {
  const z = ZONE_BY_CODE.get(code)
  if (!z) return { title: code, subtitle: '' }
  if (z.type === 'arrondissement') return { title: z.nom, subtitle: `${code} · Île-de-France` }
  if (z.type === 'monaco') return { title: 'Monaco', subtitle: '98 · Principauté' }
  if (z.type === 'drom') return { title: z.nom, subtitle: `${code} · Outre-mer` }
  return { title: z.nom, subtitle: `${code} · ${z.region}` }
}

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const formatEuros = (n: number | null | undefined) => (n === null || n === undefined ? '—' : euros.format(n))

const scoreFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** « Couverte · score 1,5 (2 commerciaux) » pour la carte de chaleur. */
export function coverageText(code: string, model: MapModel): string {
  const c = model.coverageOf(code)
  const people = c.people === 0 ? 'aucun commercial' : c.people === 1 ? '1 commercial' : `${c.people} commerciaux`
  return `${c.bucket.label} · score ${scoreFormat.format(c.score)} (${people})`
}
