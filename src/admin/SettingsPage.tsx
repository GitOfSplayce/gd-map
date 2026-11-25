import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { addAdmin, getAccessStatus, listAccess, removeAdmin, setAccessCode, setDefaultSharedMode, setManagersActifs, type AccessStatus, type RoleEntry } from '../lib/api'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import Switch from '../components/Switch'
import { KeySwatch } from '../components/Legend'
import { activeManagers, managersOf, type ManagerField } from '../lib/managers'
import { SHARED_MODES, type SharedMode } from '../lib/mapModel'
import { plural } from '../lib/text'
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

/** Nom et adresse sur deux lignes ; l'adresse seule tant que le portail n'a pas transmis le nom. */
function Person({ name, email, self = false }: { name: string | null; email: string; self?: boolean }) {
  return (
    <div className="who">
      <div>
        <div className="who-name">
          {name || email} {self && <span className="badge">vous</span>}
        </div>
        {name && <div className="who-sub">{email}</div>}
      </div>
    </div>
  )
}

/** Les admins de la carte. Les managers, eux, se relient à leur compte dans l'onglet Managers (D-010). */
function AdminsCard({ email }: { email: string }) {
  const confirm = useConfirm()
  const [roles, setRoles] = useState<RoleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRoles((await listAccess()).roles)
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const mail = target.trim().toLowerCase()
    if (await run(() => addAdmin(mail), `${mail} est admin : l'administration lui est ouverte dès sa connexion par le portail.`)) setTarget('')
  }

  return (
    <div className="card stack">
      <h2>Admins</h2>
      <p className="muted" style={{ margin: 0 }}>
        Un admin gère tout : commerciaux, départements, chiffres, managers, structures, code d'accès et réglages. Un <strong>manager</strong> gère
        seulement son équipe : il se relie à son compte GD One dans l'onglet <Link to="/admin/managers">Managers</Link>. Tous les autres consultent
        la carte avec le code d'accès.
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
        <table className="grid list">
          <thead>
            <tr>
              <th>Personne</th>
              <th>Dernière connexion</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roles?.map((r) => (
              <tr key={r.email}>
                <td>
                  <Person name={r.name} email={r.email} self={r.email === email} />
                </td>
                <td className="nowrap">{r.last_sign_in_at ? formatDate(r.last_sign_in_at) : <span className="muted">Jamais</span>}</td>
                <td className="col-actions">
                  {r.email !== email && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        void confirm({
                          title: `Retirer ${r.email} des admins ?`,
                          message: 'Son compte reste sur le portail ; la carte lui reste ouverte avec le code d\'accès, ou comme manager si son compte est relié.',
                          confirmLabel: 'Retirer',
                          danger: true,
                        }).then((ok) => ok && run(() => removeAdmin(r.email), `${r.email} n'est plus admin.`))
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

      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 'min(380px, 100%)' }}>
          <span>E-mail de son compte GD One</span>
          <input className="input" type="email" required value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !target.trim()}>
          <Icon name="plus" size={16} />
          Nommer admin
        </button>
      </form>
    </div>
  )
}

/** Manager 1 et Manager 2, pour toute la carte. */
function ManagersCard({ data, reload }: AdminDataProps) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const active = activeManagers(data.settings)
  const on = { manager1: active.includes('manager1'), manager2: active.includes('manager2') }

  const toggle = async (field: ManagerField, value: boolean) => {
    const next = { ...on, [field]: value }
    const name = field === 'manager1' ? 'Manager 1' : 'Manager 2'
    if (!value) {
      const left = (['manager1', 'manager2'] as const).filter((f) => next[f])
      const orphans = data.commerciaux.filter((c) => c.actif && managersOf(c, active).length && !managersOf(c, left).length)
      const ok = await confirm({
        title: `Désactiver ${name} ?`,
        message: `Il disparaît de la carte, des filtres, des fiches et de l'export, et ne donne plus de droits. Rien n'est effacé : le réactiver le remet comme avant. ${
          orphans.length
            ? `${plural(orphans.length, 'commercial se retrouve', 'commerciaux se retrouvent')} sans manager (${orphans.slice(0, 5).map((c) => c.nom).join(', ')}${orphans.length > 5 ? '…' : ''}) : seul un admin pourra les modifier.`
            : 'Aucun commercial ne se retrouve sans manager.'
        }`,
        confirmLabel: 'Désactiver',
        danger: orphans.length > 0,
      })
      if (!ok) return
    }
    setBusy(true)
    setMessage(null)
    try {
      await setManagersActifs(next.manager1, next.manager2)
      await reload()
      setMessage({ kind: 'success', text: `${name} ${value ? 'activé' : 'désactivé'} pour toute la carte.` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <h2>Manager 1 et Manager 2</h2>
      <p className="muted" style={{ margin: 0 }}>
        Un manager désactivé n'a plus de vue sur la carte, de filtre ni de droits, pour personne. Il en reste toujours un : quand il est seul, la
        carte l'appelle simplement « Manager ».
      </p>
      {(['manager1', 'manager2'] as const).map((f) => {
        const last = on[f] && active.length === 1
        return (
          <div className="row" key={f}>
            <Switch checked={on[f]} onChange={(v) => !busy && !last && void toggle(f, v)} label={f === 'manager1' ? 'Manager 1' : 'Manager 2'} />
            <span className="muted small">
              {on[f] ? `actif, ${plural(data.commerciaux.filter((c) => c.actif && c[f]).length, 'commercial', 'commerciaux')}` : 'désactivé'}
              {last && ' · le dernier actif ne se désactive pas'}
            </span>
          </div>
        )
      })}
      {message && (
        <div className={`alert ${message.kind}`}>
          <Icon name={message.kind === 'success' ? 'check' : 'alert'} size={16} />
          {message.text}
        </div>
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
        <ManagersCard data={data} reload={reload} />
        <AdminsCard email={email} />
        <PortalAccountCard portalUrl={portalUrl} />
      </div>
    </>
  )
}
