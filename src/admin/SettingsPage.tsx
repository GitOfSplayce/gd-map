import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { getAccessStatus, listAccess, removeRole, setAccessCode, setRole, type AccessStatus, type KnownUser, type Role, type RoleEntry } from '../lib/api'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import Switch from '../components/Switch'
import { KeySwatch } from '../components/Legend'
import { setDefaultSharedMode } from '../lib/api'
import { SHARED_MODES, type SharedMode } from '../lib/mapModel'
import type { Manager } from '../lib/types'
import type { AdminDataProps } from './AdminApp'

const MIN_CODE = 6

const formatDate = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

function AccessCodeCard() {
  const [status, setStatus] = useState<AccessStatus | null>(null)
  const [code, setCode] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [show, setShow] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    getAccessStatus()
      .then(setStatus)
      .catch((e) => setMessage({ kind: 'error', text: (e as Error).message }))
  }, [])
  useEffect(load, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = code.trim()
    if (value.length < MIN_CODE) return setMessage({ kind: 'error', text: `Le code doit contenir au moins ${MIN_CODE} caractères.` })
    if (value !== confirmCode.trim()) return setMessage({ kind: 'error', text: 'Les deux saisies ne correspondent pas.' })
    setBusy(true)
    try {
      await setAccessCode(value)
      setMessage({ kind: 'success', text: 'Code d\'accès modifié. Les personnes déjà connectées devront saisir le nouveau code.' })
      setCode('')
      setConfirmCode('')
      load()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <h2>Code d'accès à la carte</h2>
      <p className="muted" style={{ margin: 0 }}>
        {status === null
          ? 'Chargement…'
          : status.configured
            ? `Code défini, modifié le ${formatDate(status.updated_at)}${status.updated_by ? ` par ${status.updated_by}` : ''}.`
            : 'Aucun code défini : la carte est inaccessible tant qu\'il n\'est pas choisi.'}
      </p>
      <form className="stack" onSubmit={submit} style={{ maxWidth: 420 }}>
        <label className="field">
          <span>Nouveau code (8 caractères ou plus conseillés)</span>
          <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="field">
          <span>Confirmer le code</span>
          <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} />
        </label>
        <Switch checked={show} onChange={setShow} label="Afficher le code" />
        {message && (
          <div className={`alert ${message.kind}`}>
            <Icon name={message.kind === 'success' ? 'check' : 'alert'} size={16} />
            {message.text}
          </div>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={busy || !code}>
            <Icon name="key" size={16} />
            {status?.configured ? 'Changer le code' : 'Définir le code'}
          </button>
        </div>
      </form>
    </div>
  )
}

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', responsable: 'Responsable' }
const ROLE_HINTS: Record<Role, string> = {
  admin: 'gère tout : commerciaux, zones, chiffres, code d\'accès et rôles',
  responsable: 'saisit le CA et les objectifs des commerciaux de ses managers, rien d\'autre',
}

interface RoleForm {
  email: string
  role: Role
  managers: string[]
  /** Modification d'un rôle existant (adresse figée). */
  editing: boolean
  /** Managers cochés à la main : on ne les remplace plus par la suggestion. */
  touched: boolean
}

const EMPTY_FORM: RoleForm = { email: '', role: 'admin', managers: [], editing: false, touched: false }

/**
 * Accès nominatifs (D-009). La carte se lit avec le code d'accès ; le portail GD One ne sert qu'aux
 * personnes nommées ici. Les comptes eux-mêmes vivent sur le portail.
 */
function RolesCard({ email, managers }: { email: string; managers: Manager[] }) {
  const confirm = useConfirm()
  const [state, setState] = useState<{ roles: RoleEntry[]; users: KnownUser[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const load = useCallback(async () => {
    try {
      setState(await listAccess())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(success)
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Un manager qui a la même adresse e-mail est sans doute la personne : coché d'office pour un responsable
  const suggested = (mail: string) => {
    const target = mail.trim().toLowerCase()
    return target ? managers.filter((m) => m.email?.toLowerCase() === target).map((m) => m.nom) : []
  }

  const edit = (next: Partial<RoleForm>) =>
    setForm((f) => {
      const merged = { ...f, ...next }
      if (merged.role === 'responsable' && !merged.touched) merged.managers = suggested(merged.email)
      return merged
    })

  const start = (next: RoleForm) => {
    setForm(next)
    setNotice(null)
    setError(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const toggleManager = (nom: string) =>
    setForm((f) => ({ ...f, touched: true, managers: f.managers.includes(nom) ? f.managers.filter((m) => m !== nom) : [...f.managers, nom] }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const target = form.email.trim().toLowerCase()
    if (form.role === 'responsable' && !form.managers.length) return setError('Cochez au moins un manager : ses commerciaux forment l\'équipe du responsable.')
    const success =
      form.role === 'admin'
        ? `${target} est admin : l'administration lui est ouverte dès sa connexion par le portail.`
        : `${target} est responsable de ${form.managers.join(', ')} : la saisie de leurs chiffres lui est ouverte dès sa connexion par le portail.`
    const ok = await run(() => setRole(target, form.role, form.managers), success)
    if (ok) setForm(EMPTY_FORM)
  }

  const known = new Set(state?.roles.map((r) => r.email))
  const others = state?.users.filter((u) => !known.has(u.email)) ?? []
  const managerNames = managers.map((m) => m.nom)

  return (
    <div className="card stack">
      <h2>Admins et responsables</h2>
      <p className="muted" style={{ margin: 0 }}>
        La carte se consulte avec le code d'accès. La connexion par le portail GD One ne sert qu'aux personnes nommées ici : les <strong>admins</strong>{' '}
        gèrent tout ; un <strong>responsable</strong> saisit le CA et les objectifs des commerciaux de ses managers (Manager 1 ou Manager 2). Les autres
        comptes du portail passent par le code, comme tout le monde.
      </p>
      {error && (
        <div className="alert error">
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Personne</th>
              <th>Rôle</th>
              <th>Périmètre</th>
              <th>Dernière connexion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state?.roles.map((r) => (
              <tr key={r.email}>
                <td>
                  {r.name ? `${r.name} · ` : ''}
                  {r.email} {r.email === email && <span className="badge">vous</span>}
                </td>
                <td>{ROLE_LABELS[r.role]}</td>
                <td>
                  {r.role === 'admin' ? (
                    <span className="muted">toute la carte</span>
                  ) : r.managers.length ? (
                    r.managers.join(', ')
                  ) : (
                    <span className="badge warning">aucun manager</span>
                  )}
                </td>
                <td>{r.last_sign_in_at ? formatDate(r.last_sign_in_at) : <span className="muted">pas encore venu</span>}</td>
                <td>
                  {r.email !== email && (
                    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy}
                        onClick={() => start({ email: r.email, role: r.role, managers: r.managers, editing: true, touched: true })}
                      >
                        <Icon name="pencil" size={15} />
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={busy}
                        onClick={() => {
                          void confirm({
                            title: `Retirer le rôle de ${r.email} ?`,
                            message: 'Son compte reste sur le portail ; la carte lui reste ouverte avec le code d\'accès, comme à tout le monde.',
                            confirmLabel: 'Retirer',
                            danger: true,
                          }).then((ok) => ok && run(() => removeRole(r.email), `${r.email} n'est plus ${ROLE_LABELS[r.role].toLowerCase()}.`))
                        }}
                      >
                        <Icon name="trash" size={15} />
                        Retirer
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form ref={formRef} className="stack" onSubmit={submit} style={{ maxWidth: 680 }}>
        <h3 style={{ margin: 0 }}>{form.editing ? `Modifier le rôle de ${form.email}` : 'Nommer une personne'}</h3>
        <label className="field">
          <span>E-mail de son compte GD One</span>
          <input
            className="input"
            type="email"
            required
            readOnly={form.editing}
            value={form.email}
            onChange={(e) => edit({ email: e.target.value })}
          />
        </label>
        <div className="field">
          <span>Rôle</span>
          <div className="row">
            <div className="seg" role="radiogroup" aria-label="Rôle">
              {(['admin', 'responsable'] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={form.role === r} aria-pressed={form.role === r} onClick={() => edit({ role: r })}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <span className="muted small">{ROLE_HINTS[form.role]}</span>
          </div>
        </div>
        {form.role === 'responsable' && (
          <div className="field">
            <span>Ses managers</span>
            {managerNames.length ? (
              <div className="row" style={{ gap: '6px 16px' }}>
                {managers.map((m) => (
                  <label key={m.nom} className="check">
                    <input type="checkbox" checked={form.managers.includes(m.nom)} onChange={() => toggleManager(m.nom)} />
                    <span>{m.nom}</span>
                    {m.email && m.email.toLowerCase() === form.email.trim().toLowerCase() && <span className="badge">même adresse</span>}
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Aucun manager pour l'instant : créez-les dans l'onglet Managers.
              </p>
            )}
            <p className="muted small" style={{ margin: 0 }}>
              Son équipe : les commerciaux dont le Manager 1 ou le Manager 2 est coché. Un manager qui a la même adresse e-mail est coché d'office.
            </p>
          </div>
        )}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name={form.editing ? 'save' : 'plus'} size={16} />
            {form.editing ? 'Enregistrer' : 'Nommer'}
          </button>
          {(form.editing || form.email) && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setForm(EMPTY_FORM)}>
              Annuler
            </button>
          )}
        </div>
      </form>

      {others.length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>Venus par le portail, sans rôle</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Ces comptes se sont déjà connectés : sans rôle, ils n'ont que le code d'accès. Pour en nommer un, sans retaper son adresse :
          </p>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Portail</th>
                  <th>Dernière connexion</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {others.map((u) => (
                  <tr key={u.email}>
                    <td>
                      {u.name} · {u.email}
                    </td>
                    <td>{u.has_access ? 'droit d\'usage de la carte' : <span className="muted">sans droit d'usage : un rôle ne lui donnerait rien</span>}</td>
                    <td>{formatDate(u.last_sign_in_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy}
                        onClick={() => start({ ...EMPTY_FORM, email: u.email, role: 'responsable', managers: suggested(u.email) })}
                      >
                        <Icon name="key" size={15} />
                        Nommer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** Le compte (mot de passe, passkeys, double authentification) se gère sur le portail. */
function PortalAccountCard({ portalUrl }: { portalUrl: string | null }) {
  return (
    <div className="card stack">
      <h2>Mon compte</h2>
      <p className="muted" style={{ margin: 0 }}>
        Mot de passe, passkeys et double authentification se gèrent sur le portail GD One, pour toutes les applications du groupe.
      </p>
      {portalUrl && (
        <div>
          <a className="btn" href={`${portalUrl}/compte/securite`} target="_blank" rel="noopener noreferrer">
            <Icon name="lock" size={16} />
            Ouvrir la sécurité de mon compte
          </a>
        </div>
      )}
    </div>
  )
}

function DisplayCard({ data, reload }: AdminDataProps) {
  const current = data.settings?.default_shared_mode ?? 'rayures'
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const choose = async (mode: SharedMode) => {
    if (mode === current) return
    setBusy(true)
    setMessage(null)
    try {
      await setDefaultSharedMode(mode)
      await reload()
      setMessage({ kind: 'success', text: `Zones partagées affichées par défaut en « ${SHARED_MODES.find((m) => m.key === mode)!.label} ».` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <h2>Affichage de la carte</h2>
      <p className="muted" style={{ margin: 0 }}>
        Affichage des zones partagées par plusieurs commerciaux, proposé par défaut à tous ceux qui ouvrent la carte.
        Chacun peut ensuite en changer dans la légende.
      </p>
      <div className="mode-cards" role="radiogroup" aria-label="Zones partagées par défaut">
        {SHARED_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={current === m.key}
            className="mode-card"
            disabled={busy}
            onClick={() => void choose(m.key)}
          >
            <KeySwatch kind={m.key} />
            <span>
              <strong>{m.label}</strong>
              <small>{m.detail}</small>
            </span>
            {current === m.key && <Icon name="check" size={16} className="mode-check" />}
          </button>
        ))}
      </div>
      {message && (
        <div className={`alert ${message.kind}`}>
          <Icon name={message.kind === 'success' ? 'check' : 'alert'} size={16} />
          {message.text}
        </div>
      )}
    </div>
  )
}

export default function SettingsPage({ email, portalUrl, data, reload }: { email: string; portalUrl: string | null } & AdminDataProps) {
  return (
    <>
      <header>
        <h1>Paramètres</h1>
      </header>
      <div className="stack" style={{ gap: 20 }}>
        <AccessCodeCard />
        <DisplayCard data={data} reload={reload} />
        <RolesCard email={email} managers={data.managers} />
        <PortalAccountCard portalUrl={portalUrl} />
      </div>
    </>
  )
}
