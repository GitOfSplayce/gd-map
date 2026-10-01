import { useMemo, useState } from 'react'
import type { WorkBook } from 'xlsx'
import { applyImport } from '../lib/api'
import {
  DEFAULT_SHEET,
  buildExportWorkbook,
  downloadWorkbook,
  parseSheet,
  readWorkbook,
} from '../lib/excel'
import { planImport, type DiffItem, type ImportMode } from '../lib/importDiff'
import { STRUCTURES } from '../lib/types'
import Icon from '../components/Icon'
import type { AdminDataProps } from './AdminApp'

const KIND_LABELS: Record<DiffItem['kind'], string> = {
  add: 'Ajout',
  update: 'Modification',
  unchanged: 'Inchangé',
  delete: 'Suppression',
}

function DiffEntry({ item }: { item: DiffItem }) {
  const changes = item.fields.length + item.zones.length
  return (
    <details className="diff-item" open={item.kind === 'update' && changes <= 3}>
      <summary>
        <span className={`badge ${item.kind === 'unchanged' ? '' : item.kind}`}>{KIND_LABELS[item.kind]}</span>
        <strong>{item.nom}</strong>
        {item.row && <span className="muted small">ligne {item.row.rowNumber}</span>}
        {item.kind === 'update' && <span className="muted small">{changes} changement(s)</span>}
        {item.row?.warnings.length ? <span className="badge warning">{item.row.warnings.length} avertissement(s)</span> : null}
      </summary>
      <div className="diff-body">
        {item.fields.map((f) => (
          <div className="field-change" key={f.label}>
            <span className="muted">{f.label}</span>
            <span>
              <del>{f.before}</del> → <ins>{f.after}</ins>
            </span>
          </div>
        ))}
        {item.zones.map((z) => (
          <div className="field-change" key={z.structure}>
            <span className="muted">Zones {z.structure}</span>
            <div className="chips">
              {z.added.map((c) => (
                <span key={'a' + c} className="chip added" title="Ajoutée">
                  + {c}
                </span>
              ))}
              {z.removed.map((c) => (
                <span key={'r' + c} className="chip removed" title="Retirée">
                  {c}
                </span>
              ))}
              {z.changed.map((c) => (
                <span key={'c' + c} className="chip changed" title="Couverture modifiée">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
        {item.row?.warnings.map((w) => (
          <div key={w} className="small" style={{ color: 'var(--warning)' }}>
            ⚠ {w}
          </div>
        ))}
        {item.kind === 'add' && item.row && (
          <div className="small muted">
            {[item.row.statut, item.row.manager1 && `Manager 1 : ${item.row.manager1}`, item.row.manager2 && `Manager 2 : ${item.row.manager2}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>
    </details>
  )
}

const THIS_YEAR = new Date().getFullYear()

/** Zone de dépôt du fichier Excel (glisser-déposer ou clic), à la place du bouton natif. */
function Dropzone({ onFile }: { onFile: (file: File | undefined) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    <label
      className={'dropzone' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onFile(e.dataTransfer.files[0])
      }}
    >
      <input
        type="file"
        accept=".xlsx,.xlsm,.xls"
        aria-label="Choisir le fichier Excel"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <span className="dz-icon">
        <Icon name="upload" size={22} />
      </span>
      <strong>{dragging ? 'Déposez le fichier ici' : 'Glissez le fichier Excel ici'}</strong>
      <span className="dz-hint">ou cliquez pour le choisir · .xlsx, onglet « V3 » par défaut</span>
    </label>
  )
}

export default function ImportExportPage({ data, reload }: AdminDataProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [workbook, setWorkbook] = useState<WorkBook | null>(null)
  const [sheet, setSheet] = useState(DEFAULT_SHEET)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [year, setYear] = useState(THIS_YEAR)
  const [filter, setFilter] = useState<DiffItem['kind'] | 'changes'>('changes')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [exportYear, setExportYear] = useState(THIS_YEAR)

  const parsed = useMemo(() => (workbook ? parseSheet(workbook, sheet) : null), [workbook, sheet])
  const plan = useMemo(() => (parsed && !parsed.errors.length ? planImport(parsed.rows, data, mode, year) : null), [parsed, data, mode, year])

  const unknownZones = useMemo(
    () =>
      parsed?.rows.flatMap((r) =>
        STRUCTURES.flatMap((s) => r.zoneIssues[s].map((i) => ({ row: r.rowNumber, nom: r.nom, structure: s, ...i }))),
      ) ?? [],
    [parsed],
  )

  const onFile = async (file: File | undefined) => {
    setError(null)
    setDone(null)
    if (!file) return
    try {
      const wb = readWorkbook(await file.arrayBuffer())
      setWorkbook(wb)
      setFileName(file.name)
      setSheet(wb.SheetNames.includes(DEFAULT_SHEET) ? DEFAULT_SHEET : wb.SheetNames[0])
    } catch {
      setError('Fichier illisible. Choisissez un fichier Excel (.xlsx).')
    }
  }

  const apply = async () => {
    if (!plan) return
    if (mode === 'replace' && plan.deleteIds.length) {
      const ok = confirm(`${plan.deleteIds.length} commercial(aux) absent(s) du fichier vont être supprimé(s) avec leurs zones. Continuer ?`)
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await applyImport(plan.payload, plan.deleteIds)
      await reload()
      setDone(`Import terminé : ${res.saved} commercial(aux) enregistré(s), ${res.deleted} supprimé(s).`)
      setWorkbook(null)
      setFileName(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setWorkbook(null)
    setFileName(null)
    setError(null)
  }

  const exportExcel = () => {
    const wb = buildExportWorkbook(data.commerciaux, data.affectations, data.objectifs, exportYear)
    downloadWorkbook(wb, `carte-commerciale-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const shown = plan?.items.filter((i) => (filter === 'changes' ? i.kind !== 'unchanged' : i.kind === filter)) ?? []
  const step = done ? 4 : plan ? 3 : workbook ? 2 : 1

  return (
    <>
      <header>
        <h1>Import / export Excel</h1>
      </header>

      <div className="card stack" style={{ marginBottom: 20 }}>
        <h2>Exporter</h2>
        <p className="muted" style={{ margin: 0 }}>
          Même format que le fichier d'origine (onglet V3, en-têtes en ligne 3), avec en plus les colonnes Couleur, Actif et
          Notes. Le fichier exporté peut être réimporté tel quel.
        </p>
        <div className="row">
          <label className="row small">
            CA et objectifs de
            <input className="input" type="number" style={{ width: 100 }} value={exportYear} onChange={(e) => setExportYear(Number(e.target.value))} />
          </label>
          <button type="button" className="btn primary" onClick={exportExcel}>
            <Icon name="download" size={16} />
            Télécharger l'Excel
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Importer</h2>
        <div className="steps">
          {['Fichier', 'Onglet et mode', 'Aperçu des changements', 'Terminé'].map((label, i) => (
            <span key={label} className={i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''}>
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {done && (
          <div className="alert success">
            <Icon name="check" size={16} />
            {done}
          </div>
        )}
        {error && (
          <div className="alert error">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}

        {workbook && fileName ? (
          <div className="file-chip">
            <span className="fc-icon">
              <Icon name="sheet" size={20} />
            </span>
            <div className="grow">
              <div className="fc-name">{fileName}</div>
              <div className="small muted">
                {workbook.SheetNames.length} onglet{workbook.SheetNames.length > 1 ? 's' : ''}
                {parsed && !parsed.errors.length && ` · ${parsed.rows.length} commerciaux lus dans « ${sheet} »`}
              </div>
            </div>
            <label className="btn small">
              <Icon name="upload" size={16} />
              Changer
              <input type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }} />
            </label>
            <button type="button" className="btn small ghost icon" onClick={reset} aria-label="Retirer le fichier" title="Retirer">
              <Icon name="x" size={18} />
            </button>
          </div>
        ) : (
          <Dropzone onFile={(f) => void onFile(f)} />
        )}

        {workbook && (
          <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
            <label className="field">
              <span>Onglet</span>
              <select className="select" value={sheet} onChange={(e) => setSheet(e.target.value)}>
                {workbook.SheetNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Mode</span>
              <div className="seg">
                <button type="button" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
                  Fusionner
                </button>
                <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
                  Remplacer tout
                </button>
              </div>
            </div>
            <label className="field">
              <span>Année des CA / objectifs</span>
              <input className="input" type="number" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </label>
          </div>
        )}
        {workbook && (
          <p className="small muted" style={{ margin: 0 }}>
            {mode === 'merge'
              ? 'Fusionner : les commerciaux du fichier sont ajoutés ou mis à jour (zones remplacées par celles du fichier). Les autres ne bougent pas.'
              : 'Remplacer tout : le fichier devient la référence. Les commerciaux absents du fichier sont supprimés.'}{' '}
            Couleurs et notes existantes sont conservées.
          </p>
        )}

        {parsed?.errors.map((e) => (
          <div key={e} className="alert error">
            {e}
          </div>
        ))}

        {parsed && !parsed.errors.length && (
          <div className="small muted">
            En-têtes trouvés en ligne {parsed.headerRow} · {parsed.rows.length} ligne(s) avec un nom
            {parsed.missing.length > 0 && <> · colonnes absentes : {parsed.missing.join(', ')}</>}
          </div>
        )}

        {plan && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <b style={{ color: 'var(--success)' }}>{plan.counts.add}</b>ajout(s)
              </div>
              <div className="stat">
                <b style={{ color: 'var(--accent)' }}>{plan.counts.update}</b>modification(s)
              </div>
              <div className="stat">
                <b style={{ color: 'var(--danger)' }}>{plan.counts.delete}</b>suppression(s)
              </div>
              <div className="stat">
                <b>{plan.counts.unchanged}</b>inchangé(s)
              </div>
            </div>

            {unknownZones.length > 0 && (
              <div className="alert warning">
                <strong>{unknownZones.filter((z) => z.level === 'error').length} valeur(s) de zone inconnue(s)</strong>, ignorée(s) à
                l'import :
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {unknownZones.map((z, i) => (
                    <li key={i}>
                      Ligne {z.row} ({z.nom}), DPT {z.structure} : {z.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.duplicates.length > 0 && (
              <div className="alert warning">
                Nom(s) en double, seule la première ligne est prise en compte :{' '}
                {plan.duplicates.map((d) => `${d.nom} (ligne ${d.rowNumber})`).join(', ')}
              </div>
            )}

            <div className="row">
              <div className="seg">
                {(
                  [
                    ['changes', 'Changements'],
                    ['add', 'Ajouts'],
                    ['update', 'Modifications'],
                    ['delete', 'Suppressions'],
                    ['unchanged', 'Inchangés'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="diff-list">
              {shown.map((item) => (
                <DiffEntry key={item.kind + item.nom} item={item} />
              ))}
              {!shown.length && <p className="muted">Rien dans cette catégorie.</p>}
            </div>

            <div className="row">
              <button type="button" className="btn primary" disabled={busy || !plan.payload.length} onClick={() => void apply()}>
                <Icon name={busy ? 'refresh' : 'check'} size={16} className={busy ? 'spin' : undefined} />
                {busy ? 'Import en cours…' : `Valider l'import (${plan.counts.add + plan.counts.update} à enregistrer, ${plan.counts.delete} à supprimer)`}
              </button>
              <button type="button" className="btn ghost" onClick={reset}>
                Annuler
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
