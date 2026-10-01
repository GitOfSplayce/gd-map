import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import GateLayout from '../components/GateLayout'
import Icon from '../components/Icon'
import { useAdminSession } from '../hooks/useAdminSession'
import { fetchMapData, MAP_DATA_ERRORS } from '../lib/api'
import { isDemo, requireSupabase } from '../lib/supabase'
import type { MapData } from '../lib/types'
import CommerciauxPage from './CommerciauxPage'
import ImportExportPage from './ImportExportPage'
import ManagersPage from './ManagersPage'
import SynthesePage from './SynthesePage'
import SettingsPage from './SettingsPage'
import StructuresPage from './StructuresPage'

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
    <GateLayout title="Espace admin" subtitle="Carte commerciale">
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
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          <Icon name={busy ? 'refresh' : 'lock'} className={busy ? 'spin' : undefined} />
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <div className="gate-footer">
        <Link to="/">Retour à la carte</Link>
      </div>
    </GateLayout>
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

/** Admin connecté : ce qui précède le @ (« mb »), ou ses initiales quand la place manque. */
function UserBadge({ email }: { email: string }) {
  const local = email.split('@')[0]
  const parts = local.split(/[._-]+/).filter(Boolean)
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase()
  return (
    <span className="user-badge" aria-label={`Connecté : ${email}`}>
      <Icon name="user" size={14} className="user-badge-icon" />
      <span className="user-badge-name">{local}</span>
      <span className="user-badge-initials" aria-hidden="true">
        {initials}
      </span>
    </span>
  )
}

function AdminLayout({ email }: { email: string }) {
  const { data, error, reload } = useAdminData()

  return (
    <div className="admin-shell">
      <AppHeader
        subtitle="Administration"
        home="/admin"
        nav={
          <nav className="tabs">
            <NavLink to="/admin" end>
              Commerciaux
            </NavLink>
            <NavLink to="/admin/managers">Managers</NavLink>
            <NavLink to="/admin/structures">Structures</NavLink>
            <NavLink to="/admin/synthese">Synthèse</NavLink>
            <NavLink to="/admin/import">Import / export</NavLink>
            <NavLink to="/admin/parametres">Paramètres</NavLink>
          </nav>
        }
        actions={
          <>
            <Link className="btn small" to="/">
              <Icon name="map" size={16} />
              Voir la carte
            </Link>
            <UserBadge email={email} />
            <button type="button" className="btn small ghost" onClick={() => void signOut()} title="Déconnexion">
              <Icon name="logout" size={16} />
              <span className="hide-below-1600">Déconnexion</span>
            </button>
          </>
        }
      />
      <main className="admin-main">
        {error && <div className="alert error">{error}</div>}
        {!data && !error && <p className="muted">Chargement…</p>}
        {data && (
          <Routes>
            <Route index element={<CommerciauxPage data={data} reload={reload} />} />
            <Route path="managers" element={<ManagersPage data={data} reload={reload} />} />
            <Route path="structures" element={<StructuresPage data={data} reload={reload} />} />
            <Route path="synthese" element={<SynthesePage data={data} reload={reload} />} />
            <Route path="import" element={<ImportExportPage data={data} reload={reload} />} />
            <Route path="parametres" element={<SettingsPage email={email} data={data} reload={reload} />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

export default function AdminApp() {
  const session = useAdminSession()

  if (session.loading) return <div className="map-empty">Chargement…</div>
  if (!session.session) return <LoginForm />
  if (!session.isAdmin) {
    return (
      <GateLayout title="Accès refusé">
        <div className="stack">
          <p style={{ margin: 0, textAlign: 'center' }}>
            Le compte <strong>{session.session.user.email}</strong> n'est pas administrateur de la carte.
          </p>
          <button type="button" className="btn" onClick={() => void signOut()}>
            <Icon name="logout" size={16} />
            Se déconnecter
          </button>
        </div>
        <div className="gate-footer">
          <Link to="/">Retour à la carte</Link>
        </div>
      </GateLayout>
    )
  }
  return <AdminLayout email={session.session.user.email ?? ''} />
}
