import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { useAdminSession } from '../hooks/useAdminSession'
import { fetchMapData, MAP_DATA_ERRORS } from '../lib/api'
import { isDemo, requireSupabase } from '../lib/supabase'
import type { MapData } from '../lib/types'
import CommerciauxPage from './CommerciauxPage'
import ImportExportPage from './ImportExportPage'
import SettingsPage from './SettingsPage'

export interface AdminDataProps {
  data: MapData
  reload: () => Promise<void>
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : error.message)
  }

  return (
    <div className="gate">
      <div className="card">
        <div className="gate-logo">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <div>
            <h1 style={{ margin: 0, fontSize: 19 }}>Espace admin</h1>
            <div className="muted small">Carte commerciale</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <div className="gate-footer">
          <Link to="/">Retour à la carte</Link>
        </div>
      </div>
    </div>
  )
}

const signOut = () => (isDemo ? Promise.resolve() : requireSupabase().auth.signOut())

function useAdminData() {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const res = await fetchMapData(null)
    if ('data' in res) {
      setData(res.data)
      setError(null)
    } else setError(MAP_DATA_ERRORS[res.error])
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, reload }
}

function AdminLayout({ email }: { email: string }) {
  const { data, error, reload } = useAdminData()

  return (
    <div className="admin-shell">
      <header className="topbar">
        <Link to="/admin" className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span>Admin</span>
        </Link>
        <nav className="tabs">
          <NavLink to="/admin" end>
            Commerciaux
          </NavLink>
          <NavLink to="/admin/import">Import / export Excel</NavLink>
          <NavLink to="/admin/parametres">Paramètres</NavLink>
        </nav>
        <div className="actions">
          <span className="small hide-mobile" style={{ color: '#b9c4dc' }}>
            {email}
          </span>
          <Link className="btn small" to="/">
            Voir la carte
          </Link>
          <button type="button" className="btn small" onClick={() => void signOut()}>
            Déconnexion
          </button>
        </div>
      </header>
      <main className="admin-main">
        {error && <div className="alert error">{error}</div>}
        {!data && !error && <p className="muted">Chargement…</p>}
        {data && (
          <Routes>
            <Route index element={<CommerciauxPage data={data} reload={reload} />} />
            <Route path="import" element={<ImportExportPage data={data} reload={reload} />} />
            <Route path="parametres" element={<SettingsPage email={email} />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

export default function AdminApp() {
  const session = useAdminSession()

  if (session.loading) return <div className="gate muted">Chargement…</div>
  if (!session.session) return <LoginForm />
  if (!session.isAdmin) {
    return (
      <div className="gate">
        <div className="card stack">
          <h1 style={{ fontSize: 19 }}>Accès refusé</h1>
          <p>
            Le compte <strong>{session.session.user.email}</strong> n'est pas administrateur de la carte.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => void signOut()}>
              Se déconnecter
            </button>
            <Link to="/" className="btn ghost">
              Retour à la carte
            </Link>
          </div>
        </div>
      </div>
    )
  }
  return <AdminLayout email={session.session.user.email ?? ''} />
}
