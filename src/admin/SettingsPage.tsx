import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { getAccessStatus, listAccess, removeRole, setAccessCode, setRole, type AccessStatus, type KnownUser, type RoleEntry } from '../lib/api'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import Switch from '../components/Switch'
import { KeySwatch } from '../components/Legend'
import { setDefaultSharedMode } from '../lib/api'
import { SHARED_MODES, type SharedMode } from '../lib/mapModel'
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

const ROLE_LABELS: Record<RoleEntry['role'], string> = { admin: 'Admin', responsable: 'Responsable' }

/**
 * Rôles de la carte (D-002). Toute personne dont l'organisation a accès à la carte sur le portail la
 * consulte sans code ; ici, on choisit qui l'administre. Les comptes eux-mêmes vivent sur le portail.
 */
function RolesCard({ email }: { email: string }) {
  const confirm = useConfirm()
  const [state, setState] = useState<{ roles: RoleEntry[]; users: KnownUser[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)

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

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const target = newEmail.trim().toLowerCase()
    const ok = await run(() => setRole(target, 'admin'), `${target} est admin : l'administration lui est ouverte dès sa connexion par le portail.`)
    if (ok) setNewEmail('')
  }

  const known = new Set(state?.roles.map((r) => r.email))
  const others = state?.users.filter((u) => !known.has(u.email)) ?? []

  return (
    <div className="card stack">
      <h2>Administrateurs</h2>
      <p className="muted" style={{ margin: 0 }}>
        Ils se connectent par le portail GD One. Les personnes dont l'organisation a accès à la carte sur le portail la consultent sans code ; ici, on choisit
        celles qui l'administrent.
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
              <th>E-mail</th>
              <th>Rôle</th>
              <th>Depuis</th>
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
                <td>{formatDate(r.created_at)}</td>
                <td>{r.last_sign_in_at ? formatDate(r.last_sign_in_at) : <span className="muted">pas encore venu</span>}</td>
                <td>
                  {r.email !== email && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        void confirm({
                          title: `Retirer le rôle de ${r.email} ?`,
                          message: 'Son compte reste sur le portail : il garde la lecture de la carte si son organisation y a droit.',
                          confirmLabel: 'Retirer',
                          danger: true,
                        }).then((ok) => ok && run(() => removeRole(r.email), `${r.email} n'est plus ${ROLE_LABELS[r.role].toLowerCase()}.`))
                      }}
                    >
                      <Icon name="trash" size={15} />
                      Retirer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="stack" onSubmit={add} style={{ maxWidth: 520 }}>
        <h3 style={{ margin: 0 }}>Ajouter un admin</h3>
        <label className="field">
          <span>E-mail de son compte GD One</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <button type="submit" className="btn primary" disabled={busy}>
              <Icon name="plus" size={16} />
              Ajouter
            </button>
          </div>
        </label>
      </form>

      {others.length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>Déjà venus par le portail</h3>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Accès à la carte</th>
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
                    <td>{u.has_access ? 'Lecture' : <span className="muted">aucun sur le portail</span>}</td>
                    <td>{formatDate(u.last_sign_in_at)}</td>
                    <td>
                      <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => setRole(u.email, 'admin'), `${u.email} est admin.`)}>
                        <Icon name="key" size={15} />
                        Nommer admin
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
        <RolesCard email={email} />
        <PortalAccountCard portalUrl={portalUrl} />
      </div>
    </>
  )
}
