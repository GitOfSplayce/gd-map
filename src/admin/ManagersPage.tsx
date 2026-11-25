import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import ColorPicker from '../components/ColorPicker'
import Icon from '../components/Icon'
import { EmailInput, PhoneInput } from '../components/ContactInputs'
import { MissingContact } from '../components/ContactLinks'
import MultiSelect from '../components/MultiSelect'
import NameInput from '../components/NameInput'
import Select from '../components/Select'
import { useConfirm } from '../hooks/useConfirm'
import { createManager, deleteManager, listAccess, renameManager, setManagerColor, updateManager, type KnownUser, type RoleEntry } from '../lib/api'
import { isTooLight, managerColors, rankedFreeColors } from '../lib/colors'
import { emailIssue, formatPhone, normalizeEmail, phoneIssue } from '../lib/contacts'
import { activeManagers, managerLabel, type ManagerField } from '../lib/managers'
import { inStructureOrder, structureCodes, structureName } from '../lib/structures'
import { nameKey, plural } from '../lib/text'
import type { Commercial, Manager } from '../lib/types'
import type { AdminDataProps } from './AdminApp'

interface EditForm {
  nom: string
  telephone: string
  email: string
  compte: string
  /** Sa fiche de commercial, ou ''. */
  fiche: string
  structures: string[]
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

export default function ManagersPage({ data, reload }: AdminDataProps) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Manager | null>(null)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [access, setAccess] = useState<{ roles: RoleEntry[]; users: KnownUser[] } | null>(null)

  const active = activeManagers(data.settings)
  const codes = useMemo(() => structureCodes(data.structures), [data.structures])
  const colors = useMemo(() => managerColors([], data.managers), [data])
  const rows = useMemo(
    () =>
      [...data.managers]
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map((m) => ({
          ...m,
          color: colors.get(m.nom)!,
          of: Object.fromEntries((['manager1', 'manager2'] as const).map((f) => [f, data.commerciaux.filter((c) => c[f] === m.nom)])) as Record<ManagerField, Commercial[]>,
        })),
    [data, colors],
  )

  // Qui est déjà venu par le portail : pour dire si un compte relié marche, et proposer des adresses
  const loadAccess = useCallback(async () => {
    try {
      setAccess(await listAccess())
    } catch {
      setAccess(null)
    }
  }, [])
  useEffect(() => {
    void loadAccess()
  }, [loadAccess])
  const userOf = (compte: string | null | undefined) => (compte ? access?.users.find((u) => u.email === compte) : undefined)
  const isAdmin = (compte: string | null | undefined) => Boolean(compte && access?.roles.some((r) => r.email === compte))

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
    setEditing(m)
    setError(null)
    setNotice(null)
  }

  /** Nom (renommage ou fusion), coordonnées, compte et structures, en une validation. Renvoie l'erreur, ou null. */
  const save = async (m: Manager, form: EditForm): Promise<string | null> => {
    const oldName = m.nom
    const target = form.nom.trim()
    if (!target) return 'Le nom du manager est obligatoire.'
    const issue = phoneIssue(form.telephone) ?? emailIssue(form.email) ?? emailIssue(form.compte)
    if (issue) return issue
    const next = {
      telephone: formatPhone(form.telephone) || null,
      email: normalizeEmail(form.email) || null,
      compte: normalizeEmail(form.compte) || null,
      commercial_id: form.fiche || null,
      structures: inStructureOrder(form.structures, codes),
    }
    const patch = {
      ...(next.telephone !== (m.telephone ?? null) && { telephone: next.telephone }),
      ...(next.email !== (m.email ?? null) && { email: next.email }),
      ...(next.compte !== (m.compte ?? null) && { compte: next.compte }),
      ...(next.commercial_id !== (m.commercial_id ?? null) && { commercial_id: next.commercial_id }),
      ...(!sameList(next.structures, m.structures ?? []) && { structures: next.structures }),
    }
    const renamed = target !== oldName

    const existing = renamed ? data.managers.find((x) => x.nom !== oldName && nameKey(x.nom) === nameKey(target)) : undefined
    if (existing) {
      const ok = await confirm({
        title: `Fusionner « ${oldName} » avec « ${existing.nom} » ?`,
        message: `Les commerciaux de ${oldName} passeront sous ${existing.nom}, et ${oldName} sera retiré de la liste. ${existing.nom} garde ses coordonnées et son compte (ceux de ${oldName} complètent seulement ce qui manque) et prend aussi ses structures.`,
        confirmLabel: 'Fusionner',
      })
      if (!ok) return null
      try {
        await renameManager(oldName, existing.nom)
      } catch (e) {
        return (e as Error).message
      }
      setNotice(`${oldName} a été fusionné avec ${existing.nom}.`)
    } else {
      try {
        if (renamed) await renameManager(oldName, target)
        if (Object.keys(patch).length) await updateManager(target, patch)
      } catch (e) {
        if (renamed) await reload()
        return (e as Error).message
      }
      setNotice(renamed ? `${oldName} s'appelle maintenant ${target}.` : `${target} a été enregistré.`)
    }
    await Promise.all([reload(), loadAccess()])
    setEditing(null)
    return null
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
            <NameInput style={{ width: 240 }} autoFocus placeholder="NOM Prénom du manager" value={addName} onChange={setAddName} />
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
          Relié à son compte GD One, un manager modifie les départements, le CA et les objectifs de ses commerciaux, dans ses structures.
          Téléphone et e-mail de contact sont visibles sur la carte avec le code d'accès ; en rouge, ceux qui manquent.
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
              <th>Compte GD One</th>
              <th>Structures</th>
              <th>Couleur</th>
              {active.map((f) => (
                <th key={f}>{active.length > 1 ? `${managerLabel(f, active)} de` : 'Équipe'}</th>
              ))}
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const user = userOf(m.compte)
              return (
                <tr key={m.nom}>
                  <td>
                    <div className="who">
                      <span className="swatch" style={{ background: m.color }} />
                      <div>
                        <div className="who-name">
                          {m.nom}
                          {!nameKey(m.nom).startsWith('a recruter') && <MissingContact telephone={m.telephone} email={m.email} />}
                        </div>
                        {(m.telephone || m.email) && <div className="who-sub">{[m.telephone, m.email].filter(Boolean).join(' · ')}</div>}
                        {m.commercial_id && <div className="who-sub">fiche de commercial : {data.commerciaux.find((c) => c.id === m.commercial_id)?.nom ?? '—'}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.compte ? (
                      <div>
                        <div>{m.compte}</div>
                        <div className="who-sub">
                          {isAdmin(m.compte)
                            ? 'aussi admin'
                            : !user
                              ? 'aucune connexion'
                              : !user.has_access
                                ? 'sans accès à la carte sur le portail'
                                : user.last_sign_in_at
                                  ? `dernière connexion le ${new Date(user.last_sign_in_at).toLocaleDateString('fr-FR')}`
                                  : 'compte connu'}
                        </div>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {m.structures?.length ? (
                      <span className="row" style={{ gap: 4 }}>
                        {inStructureOrder(m.structures, codes).map((s) => (
                          <span key={s} className="struct-tag">
                            {s}
                          </span>
                        ))}
                      </span>
                    ) : m.compte ? (
                      <span className="badge warning">aucune</span>
                    ) : (
                      <span className="muted">—</span>
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
                  {active.map((f) => (
                    <td key={f} title={names(m.of[f])}>
                      {m.of[f].length ? plural(m.of[f].length, 'commercial', 'commerciaux') : <span className="muted">—</span>}
                    </td>
                  ))}
                  <td className="col-actions">
                    <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn small ghost icon" title="Modifier" aria-label={`Modifier ${m.nom}`} onClick={() => startEdit(m)}>
                        <Icon name="pencil" size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn small ghost icon danger"
                        title="Supprimer"
                        aria-label={`Supprimer ${m.nom}`}
                        onClick={() => void remove(m.nom, new Set([...m.of.manager1, ...m.of.manager2]).size)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5 + active.length} className="muted">
                  Aucun manager. Ajoutez-en un, ou saisissez-le dans la fiche d'un commercial.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ManagerDrawer
          key={editing.nom}
          manager={editing}
          color={colors.get(editing.nom)!}
          structures={codes.map((code) => ({ code, nom: structureName(data.structures, code) }))}
          accounts={access?.users ?? []}
          adminEmails={access?.roles.map((r) => r.email) ?? []}
          commerciaux={data.commerciaux.filter((c) => c.id === editing.commercial_id || !data.managers.some((m) => m.commercial_id === c.id))}
          onClose={() => setEditing(null)}
          onSave={(form) => save(editing, form)}
        />
      )}
    </>
  )
}

interface DrawerProps {
  manager: Manager
  color: string
  structures: { code: string; nom: string }[]
  /** Comptes déjà venus par le portail, proposés à la saisie. */
  accounts: KnownUser[]
  adminEmails: string[]
  /** Fiches qu'on peut lui relier : celles d'aucun autre manager. */
  commerciaux: Commercial[]
  onClose: () => void
  onSave: (form: EditForm) => Promise<string | null>
}

/** Panneau latéral d'un manager : nom, coordonnées, compte GD One et structures. */
function ManagerDrawer({ manager: m, color, structures, accounts, adminEmails, commerciaux, onClose, onSave }: DrawerProps) {
  const [form, setForm] = useState<EditForm>({ nom: m.nom, telephone: m.telephone ?? '', email: m.email ?? '', compte: m.compte ?? '', fiche: m.commercial_id ?? '', structures: m.structures ?? [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<EditForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setError(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const compte = normalizeEmail(form.compte)
  const contact = normalizeEmail(form.email)
  const known = accounts.find((u) => u.email === compte)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const issue = await onSave(form)
    setSaving(false)
    if (issue) setError(issue)
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Modifier ${m.nom}`}>
        <form onSubmit={submit} className="drawer-form">
          <header className="drawer-head">
            <span className="swatch" style={{ background: color, width: 18, height: 18 }} />
            <h2 className="grow">{m.nom}</h2>
            <button type="button" className="btn small ghost icon" onClick={onClose} aria-label="Fermer" title="Fermer">
              <Icon name="x" size={18} />
            </button>
          </header>
          <div className="drawer-body">
            <section>
              <h3>Identité</h3>
              <div className="form-grid">
                <label className="field span-2">
                  <span>Nom (renommer met à jour ses commerciaux)</span>
                  <NameInput required value={form.nom} onChange={(nom) => set({ nom })} />
                </label>
                <div className="field">
                  <span>Téléphone</span>
                  <PhoneInput value={form.telephone} onChange={(v) => set({ telephone: v })} ariaLabel={`Téléphone de ${m.nom}`} />
                </div>
                <div className="field">
                  <span>E-mail de contact</span>
                  <EmailInput value={form.email} onChange={(v) => set({ email: v })} ariaLabel={`E-mail de ${m.nom}`} />
                </div>
              </div>
            </section>

            <section>
              <h3>Compte GD One</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Le compte utilisé pour se connecter au portail : il ouvre « Mon équipe ». Vide : code d'accès seulement. L'e-mail de contact, lui,
                n'ouvre rien.
              </p>
              <div className="stack">
                <input
                  className="input"
                  type="email"
                  list="comptes-gd-one"
                  placeholder={contact || 'prenom.nom@exemple.fr'}
                  aria-label={`Compte GD One de ${m.nom}`}
                  value={form.compte}
                  onChange={(e) => set({ compte: e.target.value })}
                />
                <datalist id="comptes-gd-one">
                  {[...new Set([contact, ...accounts.map((u) => u.email)].filter(Boolean))].map((email) => (
                    <option key={email} value={email}>
                      {accounts.find((u) => u.email === email)?.name ?? 'e-mail de contact'}
                    </option>
                  ))}
                </datalist>
                {!form.compte && contact && (
                  <div>
                    <button type="button" className="btn small" onClick={() => set({ compte: contact })}>
                      <Icon name="key" size={15} />
                      Utiliser {contact}
                    </button>
                  </div>
                )}
                {compte && adminEmails.includes(compte) && <p className="muted small" style={{ margin: 0 }}>Ce compte est admin : il peut déjà tout modifier, et garde ce rôle.</p>}
                {compte && known && !known.has_access && (
                  <p className="field-issue small">Ce compte s'est déjà connecté, mais le portail ne lui ouvre pas la carte : l'accès se donne sur GD One.</p>
                )}
                {compte && !known && !emailIssue(compte) && (
                  <p className="muted small" style={{ margin: 0 }}>
                    Ce compte ne s'est encore jamais connecté à la carte. Il doit exister sur GD One, et le portail doit lui ouvrir la carte.
                  </p>
                )}
              </div>
            </section>

            <section>
              <h3>Sa fiche de commercial</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Pour un manager qui a aussi ses propres départements. Reliée, sa fiche fait partie de son équipe : ses départements prennent sa couleur
                en vue Manager, son CA compte avec celui de l'équipe, et il peut la modifier.
              </p>
              <Select
                ariaLabel={`Fiche de commercial de ${m.nom}`}
                value={form.fiche}
                options={[...commerciaux].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((c) => ({ value: c.id, label: c.nom, color: c.couleur, hint: c.statut ?? undefined }))}
                onChange={(v) => set({ fiche: v })}
                emptyLabel="— Aucune —"
              />
            </section>

            <section>
              <h3>Ses structures</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Ses départements et ses chiffres se modifient dans ces structures seulement.
              </p>
              <MultiSelect
                ariaLabel={`Structures de ${m.nom}`}
                values={form.structures}
                options={structures.map((s) => ({ value: s.code, label: s.nom, tag: s.code }))}
                onChange={(list) => set({ structures: list })}
                placeholder="Aucune structure"
              />
            </section>
          </div>
          <footer className="drawer-foot">
            {error && (
              <div className="alert error" role="alert">
                <Icon name="alert" size={16} />
                {error}
              </div>
            )}
            <div className="row">
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="btn primary" disabled={saving}>
                <Icon name={saving ? 'refresh' : 'save'} size={16} className={saving ? 'spin' : undefined} />
                Enregistrer
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </>
  )
}
