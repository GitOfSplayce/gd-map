import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import HelpPage from './pages/HelpPage'
import MapPage from './pages/MapPage'

// L'admin (et SheetJS) ne sont chargés que sur /admin
const AdminApp = lazy(() => import('./admin/AdminApp'))

function ConfigMissing() {
  return (
    <div className="config-missing card">
      <h1>Configuration manquante</h1>
      <p>
        Les variables <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> ne sont pas renseignées.
      </p>
      <p className="muted">
        En local : créez le fichier <code>.env.local</code> (voir <code>.env.example</code>). En ligne : ajoutez-les dans les
        variables GitHub Actions du dépôt, puis relancez le déploiement.
      </p>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<div className="gate muted">Chargement…</div>}>
      <Routes>
        <Route path="/aide" element={<HelpPage />} />
        <Route path="/" element={isConfigured ? <MapPage /> : <ConfigMissing />} />
        <Route path="/admin/*" element={isConfigured ? <AdminApp /> : <ConfigMissing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
