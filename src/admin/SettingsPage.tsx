import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminUsers, getAccessStatus, setAccessCode, type AccessStatus, type AdminUser } from '../lib/api'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import Switch from '../components/Switch'
import { requireSupabase } from '../lib/supabase'

const MIN_CODE = 6
const MIN_PASSWORD = 10

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

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

function AdminsCard({ email }: { email: string }) {
  const confirm = useConfirm()
  const [admins, setAdmins] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAdmins(await adminUsers<AdminUser[]>({ action: 'list' }))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      // Repli : la liste reste lisible même si l'Edge Function n'est pas déployée
      const { data } = await requireSupabase().from('admins').select('user_id, email, created_at').order('created_at')
      if (data) setAdmins(data.map((a) => ({ ...a, last_sign_in_at: null })))
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

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (newPassword.length < MIN_PASSWORD) return setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`)
    const ok = await run(
      () => adminUsers({ action: 'create', email: newEmail, password: newPassword }),
      `Admin ajouté : ${newEmail}. Transmettez-lui son mot de passe par un canal sûr (s'il avait déjà un compte, son mot de passe est inchangé).`,
    )
    if (ok) {
      setNewEmail('')
      setNewPassword('')
    }
  }

  return (
    <div className="card stack">
      <h2>Administrateurs</h2>
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
              <th>Admin depuis</th>
              <th>Dernière connexion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins?.map((a) => (
              <tr key={a.user_id}>
                <td>
                  {a.email} {a.email === email && <span className="badge">vous</span>}
                </td>
                <td>{formatDate(a.created_at)}</td>
                <td>{formatDate(a.last_sign_in_at)}</td>
                <td>
                  {a.email !== email && (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {resetFor === a.user_id ? (
                        <form
                          className="row"
                          style={{ flexWrap: 'nowrap' }}
                          onSubmit={async (e) => {
                            e.preventDefault()
                            const ok = await run(
                              () => adminUsers({ action: 'set_password', user_id: a.user_id, password: resetPassword }),
                              `Mot de passe de ${a.email} modifié.`,
                            )
                            if (ok) setResetFor(null)
                          }}
                        >
                          <input className="input" style={{ width: 170 }} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} aria-label="Nouveau mot de passe" />
                          <button type="submit" className="btn small primary" disabled={busy}>
                            OK
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setResetFor(null)}>
                            Annuler
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setResetFor(a.user_id)
                            setResetPassword(randomPassword())
                          }}
                        >
                          <Icon name="key" size={15} />
                          Nouveau mot de passe
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={busy}
                        onClick={() => {
                          void confirm({
                            title: `Retirer l'accès de ${a.email} ?`,
                            message: 'Son compte administrateur est supprimé.',
                            confirmLabel: 'Retirer',
                            danger: true,
                          }).then((ok) => ok && run(() => adminUsers({ action: 'remove', user_id: a.user_id }), `${a.email} n'est plus admin.`))
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

      <form className="stack" onSubmit={create} style={{ maxWidth: 520 }}>
        <h3 style={{ margin: 0 }}>Ajouter un admin</h3>
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Mot de passe provisoire</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button type="button" className="btn" onClick={() => setNewPassword(randomPassword())}>
              <Icon name="shuffle" size={16} />
              Générer
            </button>
          </div>
        </label>
        <div>
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="plus" size={16} />
            Ajouter
          </button>
        </div>
      </form>
    </div>
  )
}

function MyPasswordCard() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return setMessage({ kind: 'error', text: `Au moins ${MIN_PASSWORD} caractères.` })
    const { error } = await requireSupabase().auth.updateUser({ password })
    setMessage(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Mot de passe modifié.' })
    if (!error) setPassword('')
  }

  return (
    <div className="card stack">
      <h2>Mon mot de passe</h2>
      <form className="row" onSubmit={submit} style={{ maxWidth: 520, flexWrap: 'nowrap' }}>
        <input className="input" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="btn">
          Modifier
        </button>
      </form>
      {message && (
          <div className={`alert ${message.kind}`}>
            <Icon name={message.kind === 'success' ? 'check' : 'alert'} size={16} />
            {message.text}
          </div>
        )}
    </div>
  )
}

export default function SettingsPage({ email }: { email: string }) {
  return (
    <>
      <header>
        <h1>Paramètres</h1>
      </header>
      <div className="stack" style={{ gap: 20 }}>
        <AccessCodeCard />
        <AdminsCard email={email} />
        <MyPasswordCard />
      </div>
    </>
  )
}
