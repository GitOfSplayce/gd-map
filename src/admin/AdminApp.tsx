import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import GateLayout from '../components/GateLayout'
import Icon from '../components/Icon'
import { useSession } from '../hooks/useSession'
import { fetchMapData, MAP_DATA_ERRORS } from '../lib/api'
import { signIn, signInFailed, signOut } from '../lib/session'
import type { MapData } from '../lib/types'
import ChiffresPage from './ChiffresPage'
import CommerciauxPage from './CommerciauxPage'
import EquipePage from './EquipePage'
import ExportPage from './ExportPage'
import JournalPage from './JournalPage'
import ManagersPage from './ManagersPage'
import RecrutementPage from './RecrutementPage'
import SynthesePage from './SynthesePage'
import SettingsPage from './SettingsPage'
import StructuresPage from './StructuresPage'

export interface AdminDataProps {
  data: MapData
  reload: () => Promise<void>
}

function PortalLogin() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(signInFailed() ? 'La connexion par le portail n\'a pas abouti. Réessayez.' : null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn('/admin')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <GateLayout title="Admins et managers" subtitle="Carte commerciale">
      <div className="stack">
        <p className="gate-note" style={{ marginTop: 0 }}>
          Pour les admins et les managers. La connexion passe par le portail du groupe : mot de passe, passkey et double authentification s'y
          gèrent.
        </p>
        {error && (
          <div className="alert error" role="alert">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}
        <button type="button" className="btn primary" onClick={() => void start()} disabled={busy}>
          <Icon name={busy ? 'refresh' : 'lock'} className={busy ? 'spin' : undefined} />
          {busy ? 'Redirection…' : 'Se connecter avec GD One'}
        </button>
      </div>
      <div className="gate-footer">
        <Link to="/">Retour à la carte</Link>
      </div>
    </GateLayout>
  )
}

const leave = async () => {
  await signOut()
  window.location.assign('/admin')
}

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

/** Données lues une fois pour toutes les pages, rechargées après chaque enregistrement. */
function WithData({ children }: { children: (props: AdminDataProps) => ReactNode }) {
  const { data, error, reload } = useAdminData()
  return (
    <main className="admin-main">
      {error && <div className="alert error">{error}</div>}
      {!data && !error && <p className="muted">Chargement…</p>}
      {data && children({ data, reload })}
    </main>
  )
}

function SessionActions({ email, portalUrl }: { email: string; portalUrl?: string | null }) {
  return (
    <>
      <Link className="btn small" to="/">
        <Icon name="map" size={16} />
        Voir la carte
      </Link>
      {portalUrl && (
        <a className="btn small ghost" href={`${portalUrl}/compte/securite`} target="_blank" rel="noopener noreferrer" title="Mon compte GD One">
          <Icon name="lock" size={16} />
          <span className="hide-below-1600">Mon compte</span>
        </a>
      )}
      <UserBadge email={email} />
      <button type="button" className="btn small ghost" onClick={() => void leave()} title="Déconnexion">
        <Icon name="logout" size={16} />
        <span className="hide-below-1600">Déconnexion</span>
      </button>
    </>
  )
}

function AdminLayout({ email, portalUrl }: { email: string; portalUrl: string | null }) {
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
            <NavLink to="/admin/recrutement">Recrutement</NavLink>
            <NavLink to="/admin/synthese">Synthèse</NavLink>
            <NavLink to="/admin/journal">Journal</NavLink>
            <NavLink to="/admin/export">Export</NavLink>
            <NavLink to="/admin/parametres">Paramètres</NavLink>
          </nav>
        }
        actions={<SessionActions email={email} />}
      />
      <WithData>
        {({ data, reload }) => (
          <Routes>
            <Route index element={<CommerciauxPage data={data} reload={reload} />} />
            <Route path="managers" element={<ManagersPage data={data} reload={reload} />} />
            <Route path="structures" element={<StructuresPage data={data} reload={reload} />} />
            <Route path="recrutement" element={<RecrutementPage data={data} reload={reload} />} />
            <Route path="synthese" element={<SynthesePage data={data} reload={reload} />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="export" element={<ExportPage data={data} />} />
            <Route path="import" element={<Navigate to="/admin/export" replace />} />
            <Route path="parametres" element={<SettingsPage email={email} portalUrl={portalUrl} data={data} reload={reload} />} />
          </Routes>
        )}
      </WithData>
    </div>
  )
}

/** Manager (D-010) : son équipe, ses chiffres et leur journal ; rien d'autre ne se modifie. */
function ManagerLayout({ email, portalUrl }: { email: string; portalUrl: string | null }) {
  return (
    <div className="admin-shell">
      <AppHeader
        subtitle="Espace manager"
        home="/admin"
        nav={
          <nav className="tabs">
            <NavLink to="/admin" end>
              Mon équipe
            </NavLink>
            <NavLink to="/admin/chiffres">CA et objectifs</NavLink>
            <NavLink to="/admin/journal">Journal</NavLink>
          </nav>
        }
        actions={<SessionActions email={email} portalUrl={portalUrl} />}
      />
      <WithData>
        {({ data, reload }) =>
          data.manager ? (
            <Routes>
              <Route index element={<EquipePage data={data} reload={reload} />} />
              <Route path="chiffres" element={<ChiffresPage data={data} reload={reload} />} />
              <Route path="journal" element={<JournalPage team />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          ) : (
            <p className="muted">Votre compte n'est plus relié à un manager. Rechargez la page, ou demandez à un admin.</p>
          )
        }
      </WithData>
    </div>
  )
}

export default function AdminApp() {
  const { loading, me } = useSession()

  if (loading) return <div className="map-empty">Chargement…</div>
  if (!me.user) return <PortalLogin />
  if (me.role === 'manager') return <ManagerLayout email={me.user.email} portalUrl={me.portalUrl} />
  if (me.role !== 'admin') {
    return (
      <GateLayout title="Accès refusé">
        <div className="stack">
          <p style={{ margin: 0, textAlign: 'center' }}>
            Le compte <strong>{me.user.email}</strong> n'a pas de rôle sur la carte. Un admin peut le relier à un manager ou le nommer
            admin ; la carte reste ouverte à tous avec le code d'accès.
          </p>
          <button type="button" className="btn" onClick={() => void leave()}>
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
  return <AdminLayout email={me.user.email} portalUrl={me.portalUrl} />
}
