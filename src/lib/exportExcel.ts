// Export Excel de la carte (admins) : Commerciaux, Départements (dont ceux à recruter), CA et objectifs, Managers.
import { pctTextColor, sheetOf, type Column } from './excelSheets'
import { activeManagers, fichesOf, managerLabel, teamManager, type ManagerField } from './managers'
import { strongest } from './mapModel'
import { formatZoneList } from './parseZones'
import { sumPerf, type Perf } from './performance'
import { isARecruter, occupancyOf, prioriteColor, prioriteLabel, vacancyIn, vacantZones } from './recrutement'
import { inStructureOrder, sortStructures, structureCodes } from './structures'
import { plural } from './text'
import { COUVERTURE_LABELS, type Commercial, type Couverture, type MapData, type Priorite, type Structure } from './types'
import { ZONE_BY_CODE, compareZoneCodes } from './zones'

const formatDay = (d: Date) => d.toLocaleDateString('fr-FR')
const pctColor = (perf: Perf) => pctTextColor(perf.pct)
const CENTER = { align: 'center' as const }

/** Fond pâle d'une priorité (la couleur de la carte, éclaircie). */
const PRIORITY_FILL: Record<Priorite, string> = { 1: '#F9DDD3', 2: '#FDEBCC', 3: '#DCEFF6' }

/** « MD : 22, 35P » : une ligne par structure. */
const zonesText = (c: Commercial, data: MapData, codes: readonly Structure[]) =>
  codes
    .map((s) => [s, formatZoneList(data.affectations.filter((a) => a.commercial_id === c.id && a.structure === s))] as const)
    .filter(([, zones]) => zones)
    .map(([s, zones]) => (codes.length > 1 ? `${s} : ${zones}` : zones))
    .join('\n')

function commerciauxSheet(data: MapData, year: number, active: ManagerField[], today: string) {
  const codes = structureCodes(data.structures)
  const rows = data.commerciaux
    .filter((c) => !isARecruter(c))
    .sort((a, b) => Number(b.actif) - Number(a.actif) || a.nom.localeCompare(b.nom, 'fr'))
    .map((c) => ({ c, perf: sumPerf(data.objectifs, [c.id], year, codes) }))
  type Row = (typeof rows)[number]
  const columns: Column<Row>[] = [
    { header: 'Nom', width: 28, value: ({ c }) => c.nom, bold: true },
    { header: 'Statut', width: 18, value: ({ c }) => c.statut },
    { header: 'Structures', width: 14, value: ({ c }) => inStructureOrder(c.structures, codes).join(', ') },
    ...active.map((f): Column<Row> => ({ header: managerLabel(f, active), width: 22, value: ({ c }) => c[f] })),
    { header: 'Région', width: 20, value: ({ c }) => c.secteur },
    { header: 'Départements', width: 48, value: ({ c }) => zonesText(c, data, codes), wrap: true },
    { header: `CA ${year}`, width: 14, kind: 'euros', value: ({ perf }) => (perf.hasData ? perf.ca : null) },
    { header: `Objectif ${year}`, width: 14, kind: 'euros', value: ({ perf }) => perf.objectif || null },
    { header: 'Atteint', width: 10, kind: 'percent', value: ({ perf }) => perf.pct, bold: true, color: ({ perf }) => pctColor(perf) },
    { header: 'Téléphone', width: 17, value: ({ c }) => c.telephone ?? null },
    { header: 'E-mail', width: 32, value: ({ c }) => c.email ?? null },
    { header: 'Jours / an', width: 11, kind: 'number', value: ({ c }) => c.jours_an ?? null, ...CENTER },
    ...active.map((f): Column<Row> => ({
      header: active.length === 1 ? 'Date' : f === 'manager1' ? 'Date 1' : 'Date 2',
      width: 13,
      value: ({ c }) => (f === 'manager1' ? c.date_manager1 : c.date_manager2) ?? null,
    })),
    { header: 'Actions', width: 26, value: ({ c }) => c.actions ?? null, wrap: true },
    { header: 'Notes', width: 34, value: ({ c }) => c.notes ?? null, wrap: true },
    { header: 'Actif', width: 9, value: ({ c }) => (c.actif ? 'Oui' : 'Non'), ...CENTER },
  ]
  const n = rows.filter(({ c }) => c.actif).length
  return sheetOf({
    name: 'Commerciaux',
    title: 'Commerciaux',
    subtitle: `Carte commerciale, export du ${today} · ${plural(n, 'commercial actif', 'commerciaux actifs')}${rows.length > n ? `, ${plural(rows.length - n, 'inactif')}` : ''} · CA et objectifs ${year}. P : partiel, G : gestion, GP : gestion-partiel.`,
    columns,
    rows,
    frozenColumns: 1,
  })
}

interface ZoneRow {
  structure: Structure
  code: string
  commercial: Commercial | null
  couverture: Couverture | null
  priorite: Priorite | null
  secteurs: string
}

/** Une ligne par département et par commercial, structure par structure ; un département vide est à recruter. */
export function zoneRows(data: MapData): ZoneRow[] {
  const occupancy = occupancyOf(data)
  const byId = new Map(data.commerciaux.map((c) => [c.id, c]))
  return sortStructures(data.structures).flatMap(({ code: structure }) => {
    const groups = new Map<string, { code: string; commercial: Commercial; couvertures: Couverture[] }>()
    for (const a of data.affectations) {
      const commercial = byId.get(a.commercial_id)
      if (a.structure !== structure || !commercial?.actif) continue
      const key = `${a.zone_code}|${commercial.id}`
      const group = groups.get(key) ?? { code: a.zone_code, commercial, couvertures: [] }
      group.couvertures.push(a.couverture)
      groups.set(key, group)
    }
    const filled: ZoneRow[] = [...groups.values()].map((g) => ({ structure, code: g.code, commercial: g.commercial, couverture: strongest(g.couvertures), priorite: null, secteurs: '' }))
    const vacant: ZoneRow[] = vacantZones(structure, occupancy).map((code) => {
      const v = vacancyIn(code, structure, occupancy, data.a_recruter)!
      return { structure, code, commercial: null, couverture: null, priorite: v.priorite, secteurs: v.secteurs.join(', ') }
    })
    return [...filled, ...vacant].sort((a, b) => compareZoneCodes(a.code, b.code) || (a.commercial?.nom ?? '').localeCompare(b.commercial?.nom ?? '', 'fr'))
  })
}

function departementsSheet(data: MapData, active: ManagerField[], today: string) {
  const rows = zoneRows(data)
  const vacant = rows.filter((r) => !r.commercial)
  const columns: Column<ZoneRow>[] = [
    { header: 'Structure', width: 11, value: (r) => r.structure, bold: true, ...CENTER },
    { header: 'Code', width: 9, value: (r) => r.code, bold: true, ...CENTER },
    { header: 'Département', width: 30, value: (r) => ZONE_BY_CODE.get(r.code)?.nom ?? r.code },
    { header: 'Région', width: 28, value: (r) => ZONE_BY_CODE.get(r.code)?.region ?? '' },
    { header: 'Situation', width: 14, value: (r) => (r.commercial && !isARecruter(r.commercial) ? 'Pourvu' : 'À recruter'), bold: true, color: (r) => (r.commercial ? '#137A48' : prioriteColor(r.priorite)) },
    { header: 'Commercial', width: 28, value: (r) => r.commercial?.nom ?? null },
    { header: 'Type', width: 16, value: (r) => (r.couverture ? COUVERTURE_LABELS[r.couverture] : null) },
    ...active.map((f): Column<ZoneRow> => ({ header: managerLabel(f, active), width: 22, value: (r) => r.commercial?.[f] ?? null })),
    { header: 'Priorité', width: 14, value: (r) => (r.priorite ? prioriteLabel(r.priorite) : null), fill: (r) => (r.priorite ? PRIORITY_FILL[r.priorite] : undefined), ...CENTER },
    { header: 'Groupe à recruter', width: 24, value: (r) => r.secteurs || null },
  ]
  return sheetOf({
    name: 'Départements',
    title: 'Départements',
    subtitle: `Carte commerciale, export du ${today} · par structure, ${plural(vacant.length, 'département à recruter', 'départements à recruter')}, dont ${vacant.filter((r) => r.priorite === 1).length} en priorité 1`,
    columns,
    rows,
    frozenColumns: 3,
  })
}

function chiffresSheet(data: MapData, active: ManagerField[], today: string) {
  const byId = new Map(data.commerciaux.map((c) => [c.id, c]))
  const order = structureCodes(data.structures)
  const rows = data.objectifs
    .flatMap((o) => {
      const c = byId.get(o.commercial_id)
      if (!c) return []
      const ca = o.ca === null ? null : Number(o.ca)
      const objectif = o.objectif === null ? null : Number(o.objectif)
      return [{ o, c, ca, objectif, pct: ca !== null && objectif ? ca / objectif : null }]
    })
    .sort((a, b) => b.o.annee - a.o.annee || a.c.nom.localeCompare(b.c.nom, 'fr') || order.indexOf(a.o.structure) - order.indexOf(b.o.structure))
  type Row = (typeof rows)[number]
  const columns: Column<Row>[] = [
    { header: 'Année', width: 10, kind: 'text', value: (r) => r.o.annee, bold: true, ...CENTER },
    { header: 'Commercial', width: 28, value: (r) => r.c.nom, bold: true },
    { header: 'Structure', width: 11, value: (r) => r.o.structure, ...CENTER },
    ...active.map((f): Column<Row> => ({ header: managerLabel(f, active), width: 22, value: (r) => r.c[f] })),
    { header: 'CA', width: 16, kind: 'euros', value: (r) => r.ca },
    { header: 'Objectif', width: 16, kind: 'euros', value: (r) => r.objectif },
    { header: 'Écart', width: 16, kind: 'euros', value: (r) => (r.ca !== null && r.objectif !== null ? r.ca - r.objectif : null), color: (r) => ((r.ca ?? 0) >= (r.objectif ?? 0) ? '#137A48' : '#C4320A') },
    { header: 'Atteint', width: 11, kind: 'percent', value: (r) => r.pct, bold: true, color: (r) => pctTextColor(r.pct) },
  ]
  return sheetOf({
    name: 'CA et objectifs',
    title: 'CA et objectifs',
    subtitle: `Carte commerciale, export du ${today} · une ligne par commercial, structure et année`,
    columns,
    rows,
    frozenColumns: 2,
  })
}

function managersSheet(data: MapData, year: number, active: ManagerField[], today: string) {
  const codes = structureCodes(data.structures)
  const fiches = fichesOf(data.managers)
  const rows = data.managers
    .map((m) => {
      const team = data.commerciaux.filter((c) => c.actif && !isARecruter(c) && active.some((f) => teamManager(c, f, fiches) === m.nom))
      return { m, team, perf: sumPerf(data.objectifs, team.map((c) => c.id), year, codes) }
    })
    .filter((r) => r.team.length || r.m.compte)
    .sort((a, b) => a.m.nom.localeCompare(b.m.nom, 'fr'))
  type Row = (typeof rows)[number]
  const columns: Column<Row>[] = [
    { header: 'Manager', width: 24, value: (r) => r.m.nom, bold: true },
    { header: 'Structures gérées', width: 18, value: (r) => inStructureOrder(r.m.structures ?? [], codes).join(', ') || null },
    { header: 'Téléphone', width: 17, value: (r) => r.m.telephone ?? null },
    { header: 'E-mail', width: 30, value: (r) => r.m.email ?? null },
    { header: 'Compte GD One', width: 30, value: (r) => r.m.compte ?? null },
    { header: 'Commerciaux', width: 13, kind: 'number', value: (r) => r.team.length, ...CENTER },
    { header: 'Équipe', width: 60, value: (r) => r.team.map((c) => c.nom).sort((a, b) => a.localeCompare(b, 'fr')).join(', ') || null, wrap: true },
    { header: `CA ${year}`, width: 15, kind: 'euros', value: (r) => (r.perf.hasData ? r.perf.ca : null) },
    { header: `Objectif ${year}`, width: 15, kind: 'euros', value: (r) => r.perf.objectif || null },
    { header: 'Atteint', width: 10, kind: 'percent', value: (r) => r.perf.pct, bold: true, color: (r) => pctColor(r.perf) },
  ]
  return sheetOf({
    name: 'Managers',
    title: 'Managers',
    subtitle: `Carte commerciale, export du ${today} · ${plural(rows.length, 'manager')} · CA et objectifs ${year} de leur équipe`,
    columns,
    rows,
    frozenColumns: 1,
  })
}

/** Les quatre feuilles de l'export, prêtes à écrire. */
export function exportSheets(data: MapData, year: number, now = new Date()) {
  const active = activeManagers(data.settings)
  const today = formatDay(now)
  return [commerciauxSheet(data, year, active, today), departementsSheet(data, active, today), chiffresSheet(data, active, today), managersSheet(data, year, active, today)]
}
