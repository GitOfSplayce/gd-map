import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import Icon from '../components/Icon'
import { PerfBar } from '../components/Legend'
import Select from '../components/Select'
import Switch from '../components/Switch'
import { downloadWorkbook } from '../lib/excel'
import { NO_MANAGER } from '../lib/mapModel'
import { availableYears, defaultYear, formatPct, sumPerf, type Perf } from '../lib/performance'
import { plural } from '../lib/text'
import { STRUCTURE_LABELS, STRUCTURES, type Structure } from '../lib/types'
import { formatEuros } from '../lib/zoneDetails'
import type { AdminDataProps } from './AdminApp'

type GroupBy = 'commercial' | 'manager1' | 'manager2' | 'structure'
type SortKey = 'nom' | 'ca' | 'objectif' | 'ecart' | 'pct'

const GROUPS: { key: GroupBy; label: string; first: string }[] = [
  { key: 'commercial', label: 'Commercial', first: 'Commercial' },
  { key: 'manager1', label: 'Manager 1', first: 'Manager 1' },
  { key: 'manager2', label: 'Manager 2', first: 'Manager 2' },
  { key: 'structure', label: 'Structure', first: 'Structure' },
]

interface Row {
  key: string
  nom: string
  detail: string
  perf: Perf
}

/** Tableau de synthèse des CA et objectifs (admins). */
export default function SynthesePage({ data }: AdminDataProps) {
  const [year, setYear] = useState(() => defaultYear(data.objectifs))
  const [scope, setScope] = useState<Structure | 'ALL'>('ALL')
  const [groupBy, setGroupBy] = useState<GroupBy>('commercial')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'pct', desc: true })
  const [showEmpty, setShowEmpty] = useState(false)

  const years = availableYears(data.objectifs)
  const structures: readonly Structure[] = scope === 'ALL' ? STRUCTURES : [scope]

  const rows = useMemo<Row[]>(() => {
    const people = data.commerciaux.filter((c) => scope === 'ALL' || c.structures.includes(scope))
    if (groupBy === 'structure') {
      return STRUCTURES.map((s) => ({
        key: s,
        nom: `${s} – ${STRUCTURE_LABELS[s]}`,
        detail: plural(data.commerciaux.filter((c) => c.structures.includes(s)).length, 'commercial', 'commerciaux'),
        perf: sumPerf(data.objectifs, data.commerciaux.map((c) => c.id), year, [s]),
      }))
    }
    if (groupBy === 'commercial') {
      return people.map((c) => ({
        key: c.id,
        nom: c.nom,
        detail: [c.statut, c.structures.join(' · '), !c.actif && 'inactif'].filter(Boolean).join(' – '),
        perf: sumPerf(data.objectifs, [c.id], year, structures),
      }))
    }
    const teams = new Map<string, string[]>()
    for (const c of people) {
      const m = c[groupBy] || NO_MANAGER
      teams.set(m, [...(teams.get(m) ?? []), c.id])
    }
    return [...teams].map(([nom, ids]) => ({
      key: nom,
      nom,
      detail: plural(ids.length, 'commercial', 'commerciaux'),
      perf: sumPerf(data.objectifs, ids, year, structures),
    }))
  }, [data, year, scope, groupBy, structures])

  const value = (r: Row): number | string => {
    if (sort.key === 'nom') return r.nom
    if (sort.key === 'ca') return r.perf.ca
    if (sort.key === 'objectif') return r.perf.objectif
    if (sort.key === 'ecart') return r.perf.ca - r.perf.objectif
    return r.perf.pct ?? -1
  }

  const shown = rows
    .filter((r) => showEmpty || r.perf.hasData)
    .sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb), 'fr') : va - (vb as number)
      return (sort.desc ? -cmp : cmp) || a.nom.localeCompare(b.nom, 'fr')
    })

  const total = shown.reduce(
    (t, r) => ({ ca: t.ca + r.perf.ca, objectif: t.objectif + r.perf.objectif, hasData: t.hasData || r.perf.hasData }),
    { ca: 0, objectif: 0, hasData: false },
  )
  const totalPerf: Perf = { ...total, pct: total.objectif > 0 ? total.ca / total.objectif : null }
  const groupLabel = GROUPS.find((g) => g.key === groupBy)!.first

  const header = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? 'num' : undefined}>
      <button
        type="button"
        className={'sort-btn' + (sort.key === key ? ' active' : '')}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'nom' }))}
      >
        {label}
        {sort.key === key && <Icon name="chevronDown" size={14} className={sort.desc ? undefined : 'flip'} />}
      </button>
    </th>
  )

  const exportExcel = () => {
    const aoa: (string | number | null)[][] = [
      [`Synthèse CA et objectifs ${year} – ${scope === 'ALL' ? 'toutes structures' : scope} – par ${groupLabel.toLowerCase()}`],
      [],
      [groupLabel, 'CA', 'Objectif', 'Écart', '% atteint'],
      ...shown.map((r) => [r.nom, r.perf.ca, r.perf.objectif || null, r.perf.objectif ? r.perf.ca - r.perf.objectif : null, r.perf.pct]),
      ['Total', totalPerf.ca, totalPerf.objectif || null, totalPerf.objectif ? totalPerf.ca - totalPerf.objectif : null, totalPerf.pct],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 11 }]
    for (let r = 3; r < aoa.length; r++) {
      for (const c of [1, 2, 3]) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell) cell.z = '#,##0 €'
      }
      const pct = ws[XLSX.utils.encode_cell({ r, c: 4 })]
      if (pct) pct.z = '0%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Synthèse ${year}`)
    downloadWorkbook(wb, `synthese-ca-${year}-${scope.toLowerCase()}-${groupBy}.xlsx`)
  }

  return (
    <>
      <header>
        <h1>Synthèse CA et objectifs</h1>
        <span className="muted">Réservée aux admins</span>
      </header>

      <div className="toolbar-row">
        <div className="row small muted">
          Année
          <Select
            className="auto year-select"
            ariaLabel="Année"
            value={String(year)}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setYear(Number(v))}
            searchable={false}
          />
        </div>
        <div className="seg">
          {(['ALL', ...STRUCTURES] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} disabled={groupBy === 'structure'}>
              {s === 'ALL' ? 'Toutes' : s}
            </button>
          ))}
        </div>
        <div className="row small muted">
          Regrouper par
          <div className="seg">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" aria-pressed={groupBy === g.key} onClick={() => setGroupBy(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <Switch checked={showEmpty} onChange={setShowEmpty} label="Lignes sans chiffres" />
        <span className="grow" />
        <button type="button" className="btn" onClick={exportExcel} disabled={!shown.length}>
          <Icon name="download" size={16} />
          Exporter
        </button>
      </div>

      {!data.objectifs.length && (
        <div className="alert warning" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} />
          <div>
            Aucun CA ni objectif saisi pour l'instant. Renseignez-les dans le panneau d'un commercial (onglet Commerciaux), ou
            importez un fichier Excel avec les colonnes « CA MD », « Objectif MD »…
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="grid list synth">
          <thead>
            <tr>
              {header('nom', groupLabel)}
              {header('ca', `CA ${year}`, true)}
              {header('objectif', 'Objectif', true)}
              {header('ecart', 'Écart', true)}
              {header('pct', 'Atteint')}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td>
                  <div className="who-name">{r.nom}</div>
                  <div className="who-sub">{r.detail}</div>
                </td>
                <td className="num">{r.perf.hasData ? formatEuros(r.perf.ca) : '—'}</td>
                <td className="num">{r.perf.objectif ? formatEuros(r.perf.objectif) : '—'}</td>
                <td className={'num ' + (r.perf.objectif ? (r.perf.ca >= r.perf.objectif ? 'pos' : 'neg') : '')}>
                  {r.perf.objectif ? formatEuros(r.perf.ca - r.perf.objectif) : '—'}
                </td>
                <td>{r.perf.pct !== null ? <PerfBar perf={r.perf} /> : <span className="muted">{r.perf.hasData ? 'sans objectif' : '—'}</span>}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucune ligne avec des chiffres pour {year}.
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 1 && (
            <tfoot>
              <tr>
                <td>Total ({plural(shown.length, 'ligne')})</td>
                <td className="num">{formatEuros(totalPerf.ca)}</td>
                <td className="num">{totalPerf.objectif ? formatEuros(totalPerf.objectif) : '—'}</td>
                <td className={'num ' + (totalPerf.objectif ? (totalPerf.ca >= totalPerf.objectif ? 'pos' : 'neg') : '')}>
                  {totalPerf.objectif ? formatEuros(totalPerf.ca - totalPerf.objectif) : '—'}
                </td>
                <td>{totalPerf.pct !== null ? <strong>{formatPct(totalPerf.pct)}</strong> : '—'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}
