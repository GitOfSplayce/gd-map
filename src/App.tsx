import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import HelpPage from './pages/HelpPage'
import MapPage from './pages/MapPage'

// L'admin (et SheetJS) ne sont chargés que sur /admin
const AdminApp = lazy(() => import('./admin/AdminApp'))

export default function App() {
  return (
    <Suspense fallback={<div className="map-empty">Chargement…</div>}>
      <Routes>
        <Route path="/aide" element={<HelpPage />} />
        <Route path="/" element={<MapPage />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
