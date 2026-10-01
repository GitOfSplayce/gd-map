import { useMemo, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import { createStructure, deleteStructure, reorderStructures, updateStructure } from '../lib/api'
import { normalizeStructureCode, sortStructures, structureCodeIssue } from '../lib/structures'
import { plural } from '../lib/text'
import type { AdminDataProps } from './AdminApp'

interface Form {
  code: string
  nom: string
}

/** Saisie du code et du nom d'une structure (ajout ou modification). */
function StructureFields({ form, onChange, issue }: { form: Form; onChange: (f: Form) => void; issue: string | null }) {
  return (
    <>
      <input
        className="input code-input"
        autoFocus
        placeholder="Code"
        aria-label="Code de la structure"
        maxLength={6}
        value={form.code}
        // Saisie gardée telle quelle (le curseur ne saute pas) ; majuscules à l'affichage, code normalisé à l'enregistrement
        onChange={(e) => onChange({ ...form, code: e.target.value })}
        aria-invalid={Boolean(form.code && issue)}
      />
      <input
        className="input"
        style={{ width: 240 }}
        placeholder="Nom (ex. Maison Davoise)"
        aria-label="Nom de la structure"
        value={form.nom}
        onChange={(e) => onChange({ ...form, nom: e.target.value })}
      />
    </>
  )
}

export default function StructuresPage({ data, reload }: AdminDataProps) {
  const confirm = useConfirm()
  const [adding, setAdding] = useState<Form | null>(null)
  const [editing, setEditing] = useState<{ code: string; form: Form } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      sortStructures(data.structures).map((s) => ({
        ...s,
        commerciaux: data.commerciaux.filter((c) => c.structures.includes(s.code)).length,
        zones: data.affectations.filter((a) => a.structure === s.code).length,
        objectifs: data.objectifs.filter((o) => o.structure === s.code).length,
      })),
    [data],
  )
  const codes = rows.map((r) => r.code)

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
      setNotice(success)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const addCode = adding ? normalizeStructureCode(adding.code) : ''
  const addIssue = adding ? structureCodeIssue(addCode, codes) : null
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!adding) return
    const nom = adding.nom.trim()
    if (addIssue) return setError(addIssue)
    if (!nom) return setError('Le nom est obligatoire.')
    const ordre = Math.max(0, ...rows.map((r) => r.ordre)) + 1
    if (await run(() => createStructure({ code: addCode, nom, ordre }), `${addCode} – ${nom} a été ajoutée : son onglet est sur la carte.`)) {
      setAdding(null)
    }
  }

  const editCode = editing ? normalizeStructureCode(editing.form.code) : ''
  const editIssue = editing ? structureCodeIssue(editCode, codes.filter((c) => c !== editing.code)) : null
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const { code } = editing
    const next = { code: editCode, nom: editing.form.nom.trim() }
    if (editIssue) return setError(editIssue)
    if (!next.nom) return setError('Le nom est obligatoire.')
    const before = rows.find((r) => r.code === code)!
    if (next.code === code && next.nom === before.nom) return setEditing(null)
    if (next.code !== code) {
      const ok = await confirm({
        title: `Remplacer le code ${code} par ${next.code} ?`,
        message: (
          <>
            Zones, CA et commerciaux suivent automatiquement. Dans le fichier Excel, les colonnes deviennent{' '}
            <strong>
              {next.code}, DPT {next.code}, CA {next.code}, Objectif {next.code}
            </strong>{' '}
            : renommez-les dans votre fichier avant le prochain import, ou repartez d'un export.
          </>
        ),
        confirmLabel: 'Changer le code',
      })
      if (!ok) return
    }
    if (await run(() => updateStructure(code, next), `${next.code} – ${next.nom} a été enregistrée.`)) setEditing(null)
  }

  const remove = async (r: (typeof rows)[number]) => {
    const used = r.commerciaux + r.zones + r.objectifs > 0
    const lost = [
      r.commerciaux && plural(r.commerciaux, 'commercial perd', 'commerciaux perdent') + ' cette structure',
      r.zones && plural(r.zones, 'zone saisie est supprimée', 'zones saisies sont supprimées'),
      r.objectifs && plural(r.objectifs, 'ligne de CA / objectif est supprimée', 'lignes de CA / objectif sont supprimées'),
    ].filter(Boolean)
    const ok = await confirm({
      title: `Supprimer ${r.code} – ${r.nom} ?`,
      message: used ? (
        <>
          {lost.join(', ')}. L'onglet {r.code} disparaît de la carte. Cette action est définitive : exportez l'Excel avant si vous
          voulez garder une trace.
        </>
      ) : (
        `Aucun commercial ne l'utilise. L'onglet ${r.code} disparaît de la carte.`
      ),
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (ok) await run(() => deleteStructure(r.code), `${r.code} – ${r.nom} a été supprimée.`)
  }

  const move = (index: number, delta: -1 | 1) => {
    const next = [...codes]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    void run(() => reorderStructures(next), 'Ordre enregistré.')
  }

  return (
    <>
      <header>
        <h1>Structures</h1>
        <span className="muted">{plural(rows.length, 'structure')}</span>
      </header>

      <div className="toolbar-row">
        {adding ? (
          <form className="row" onSubmit={add}>
            <StructureFields form={adding} onChange={(f) => {
                setAdding(f)
                setError(null)
              }} issue={addIssue} />
            <button type="submit" className="btn primary" disabled={busy || !adding.code || !adding.nom.trim()}>
              <Icon name="check" size={16} />
              Ajouter
            </button>
            <button type="button" className="btn ghost" onClick={() => {
                setAdding(null)
                setError(null)
              }}>
              Annuler
            </button>
          </form>
        ) : (
          <button type="button" className="btn primary" onClick={() => {
              setAdding({ code: '', nom: '' })
              setEditing(null)
              setNotice(null)
            }}>
            <Icon name="plus" size={16} />
            Ajouter une structure
          </button>
        )}
        <span className="muted small">
          Chaque structure a son onglet sur la carte et ses colonnes dans l'Excel (MD, DPT MD, CA MD, Objectif MD). L'ordre ci-dessous
          est celui des onglets et de l'export.
        </span>
      </div>

      {adding?.code && addIssue && (
        <div className="alert warning" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} />
          {addIssue}
        </div>
      )}
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" style={{ marginBottom: 12 }} onClick={() => setNotice(null)}>
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid list">
          <thead>
            <tr>
              <th className="col-order">
                <span className="sr-only">Ordre</span>
              </th>
              <th>Structure</th>
              <th>Commerciaux</th>
              <th>Zones saisies</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.code}>
                <td className="col-order">
                  <div className="order-btns">
                    <button type="button" className="btn small ghost icon" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${r.code}`}>
                      <Icon name="arrowUp" size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn small ghost icon"
                      disabled={busy || i === rows.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Descendre ${r.code}`}
                    >
                      <Icon name="arrowDown" size={15} />
                    </button>
                  </div>
                </td>
                <td>
                  {editing?.code === r.code ? (
                    <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={save}>
                      <StructureFields form={editing.form} onChange={(form) => {
                          setEditing({ ...editing, form })
                          setError(null)
                        }} issue={editIssue} />
                      <button type="submit" className="btn small primary" disabled={busy || !editing.form.code || !editing.form.nom.trim()}>
                        OK
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => {
                          setEditing(null)
                          setError(null)
                        }}>
                        Annuler
                      </button>
                    </form>
                  ) : (
                    <div className="who">
                      <span className="struct-tag">{r.code}</span>
                      <div className="who-name">{r.nom}</div>
                    </div>
                  )}
                  {editing?.code === r.code && editing.form.code && editIssue && <div className="small field-issue">{editIssue}</div>}
                </td>
                <td>{r.commerciaux ? plural(r.commerciaux, 'commercial', 'commerciaux') : <span className="muted">—</span>}</td>
                <td>{r.zones ? plural(r.zones, 'zone') : <span className="muted">—</span>}</td>
                <td className="col-actions">
                  <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn small ghost icon"
                      title="Modifier"
                      aria-label={`Modifier ${r.code}`}
                      onClick={() => {
                        setEditing({ code: r.code, form: { code: r.code, nom: r.nom } })
                        setAdding(null)
                        setError(null)
                      }}
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn small ghost icon danger"
                      title="Supprimer"
                      aria-label={`Supprimer ${r.code}`}
                      onClick={() => void remove(r)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucune structure. Ajoutez-en une pour qu'elle apparaisse sur la carte.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
