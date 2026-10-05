import { useMemo, useState, type FormEvent } from 'react'
import ColorPicker from '../components/ColorPicker'
import Icon from '../components/Icon'
import { EmailInput, PhoneInput } from '../components/ContactInputs'
import { useConfirm } from '../hooks/useConfirm'
import { createManager, deleteManager, renameManager, setManagerColor, setManagerContact } from '../lib/api'
import { isTooLight, managerColors, rankedFreeColors } from '../lib/colors'
import { emailIssue, formatPhone, normalizeEmail, phoneIssue } from '../lib/contacts'
import { nameKey, plural } from '../lib/text'
import type { Manager } from '../lib/types'
import type { AdminDataProps } from './AdminApp'

interface EditForm {
  nom: string
  telephone: string
  email: string
}

export default function ManagersPage({ data, reload }: AdminDataProps) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState<{ nom: string; form: EditForm } | null>(null)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const colors = useMemo(() => managerColors([], data.managers), [data])
  const rows = useMemo(
    () =>
      [...data.managers]
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map((m) => ({
          ...m,
          color: colors.get(m.nom)!,
          as1: data.commerciaux.filter((c) => c.manager1 === m.nom),
          as2: data.commerciaux.filter((c) => c.manager2 === m.nom),
        })),
    [data, colors],
  )

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

  const startEdit = (m: Manager) => {
    setEditing({ nom: m.nom, form: { nom: m.nom, telephone: m.telephone ?? '', email: m.email ?? '' } })
    setError(null)
    setNotice(null)
  }

  /** Nom (renommage ou fusion) puis coordonnées, en une validation. */
  const save = async (m: Manager, form: EditForm) => {
    const oldName = m.nom
    const target = form.nom.trim()
    if (!target) return setError('Le nom du manager est obligatoire.')
    const issue = phoneIssue(form.telephone) ?? emailIssue(form.email)
    if (issue) return setError(issue)
    const contact = { telephone: formatPhone(form.telephone) || null, email: normalizeEmail(form.email) || null }
    const contactChanged = contact.telephone !== (m.telephone ?? null) || contact.email !== (m.email ?? null)
    const renamed = target !== oldName

    const existing = renamed ? data.managers.find((x) => x.nom !== oldName && nameKey(x.nom) === nameKey(target)) : undefined
    if (existing) {
      const ok = await confirm({
        title: `Fusionner « ${oldName} » avec « ${existing.nom} » ?`,
        message: `Les commerciaux de ${oldName} passeront sous ${existing.nom}, et ${oldName} sera retiré de la liste. ${existing.nom} garde ses coordonnées (celles de ${oldName} complètent seulement ce qui manque).`,
        confirmLabel: 'Fusionner',
      })
      if (!ok) return
      if (await run(() => renameManager(oldName, existing.nom), `${oldName} a été fusionné avec ${existing.nom}.`)) setEditing(null)
      return
    }
    if (!renamed && !contactChanged) return setEditing(null)
    const done = await run(
      async () => {
        if (renamed) await renameManager(oldName, target)
        if (contactChanged) await setManagerContact(target, contact)
      },
      renamed ? `${oldName} s'appelle maintenant ${target}.` : `Coordonnées de ${target} enregistrées.`,
    )
    if (done) setEditing(null)
  }

  const remove = async (nom: string, links: number) => {
    const ok = await confirm({
      title: `Supprimer ${nom} ?`,
      message: links
        ? `${plural(links, 'commercial le cite', 'commerciaux le citent')} comme manager : ce champ sera vidé.`
        : 'Aucun commercial ne le cite comme manager.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (ok) await run(() => deleteManager(nom), `${nom} a été supprimé.`)
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const nom = addName.trim()
    if (!nom) return
    const couleur = rankedFreeColors([...colors.values()], 1)[0] ?? null
    if (await run(() => createManager({ nom, couleur }), `${nom} a été ajouté.`)) {
      setAddName('')
      setAdding(false)
    }
  }

  const names = (list: { nom: string }[]) => list.map((c) => c.nom).join(', ')

  return (
    <>
      <header>
        <h1>Managers</h1>
        <span className="muted">{plural(rows.length, 'manager')}</span>
      </header>

      <div className="toolbar-row">
        {adding ? (
          <form className="row" onSubmit={add}>
            <input className="input" style={{ width: 240 }} autoFocus placeholder="Nom du manager" value={addName} onChange={(e) => setAddName(e.target.value)} />
            <button type="submit" className="btn primary" disabled={busy || !addName.trim()}>
              <Icon name="check" size={16} />
              Ajouter
            </button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
              Annuler
            </button>
          </form>
        ) : (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            Ajouter un manager
          </button>
        )}
        <span className="muted small">
          La couleur sert sur la carte en mode « Manager 1 » ou « Manager 2 ». Renommer un manager met à jour ses commerciaux.
          Téléphone et e-mail sont visibles sur la carte avec le code d'accès.
        </span>
      </div>

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
              <th>Manager</th>
              <th>Couleur</th>
              <th>Manager 1 de</th>
              <th>Manager 2 de</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.nom}>
                <td>
                  {editing?.nom === m.nom ? (
                    <form
                      className="manager-edit"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void save(m, editing.form)
                      }}
                    >
                      <input
                        className="input"
                        autoFocus
                        value={editing.form.nom}
                        onChange={(e) => setEditing({ ...editing, form: { ...editing.form, nom: e.target.value } })}
                        aria-label={`Nom de ${m.nom}`}
                      />
                      <PhoneInput
                        value={editing.form.telephone}
                        onChange={(v) => setEditing({ ...editing, form: { ...editing.form, telephone: v } })}
                        ariaLabel={`Téléphone de ${m.nom}`}
                      />
                      <EmailInput
                        value={editing.form.email}
                        onChange={(v) => setEditing({ ...editing, form: { ...editing.form, email: v } })}
                        ariaLabel={`E-mail de ${m.nom}`}
                      />
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button type="submit" className="btn small primary" disabled={busy}>
                          Enregistrer
                        </button>
                        <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                          Annuler
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="who">
                      <span className="swatch" style={{ background: m.color }} />
                      <div>
                        <div className="who-name">{m.nom}</div>
                        {(m.telephone || m.email) && <div className="who-sub">{[m.telephone, m.email].filter(Boolean).join(' · ')}</div>}
                      </div>
                    </div>
                  )}
                </td>
                <td style={{ width: 300 }}>
                  <ColorPicker
                    value={m.color}
                    ariaLabel={`Couleur de ${m.nom}`}
                    used={rows.filter((x) => x.nom !== m.nom).map((x) => ({ color: x.color, owner: x.nom }))}
                    onChange={(c) =>
                      isTooLight(c)
                        ? setError('Couleur trop claire : le blanc est réservé à la part libre des zones en partiel.')
                        : void run(() => setManagerColor(m.nom, c), `Couleur de ${m.nom} enregistrée.`)
                    }
                  />
                </td>
                <td title={names(m.as1)}>{m.as1.length ? plural(m.as1.length, 'commercial', 'commerciaux') : <span className="muted">—</span>}</td>
                <td title={names(m.as2)}>{m.as2.length ? plural(m.as2.length, 'commercial', 'commerciaux') : <span className="muted">—</span>}</td>
                <td className="col-actions">
                  <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn small ghost icon"
                      title="Modifier"
                      aria-label={`Modifier ${m.nom}`}
                      onClick={() => startEdit(m)}
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn small ghost icon danger"
                      title="Supprimer"
                      aria-label={`Supprimer ${m.nom}`}
                      onClick={() => void remove(m.nom, m.as1.length + m.as2.length)}
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
                  Aucun manager. Ils sont créés automatiquement à l'import Excel, ou ajoutez-en un.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
