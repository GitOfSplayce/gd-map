import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import GateLayout from '../components/GateLayout'
import Icon from '../components/Icon'
import { loadGeo } from '../hooks/useGeo'

interface Props {
  error: string | null
  busy: boolean
  onSubmit: (code: string) => void
}

export default function CodeGate({ error, busy, onSubmit }: Props) {
  const [code, setCode] = useState('')

  // Les contours se chargent pendant la saisie du code
  useEffect(() => {
    loadGeo().catch(() => undefined)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) onSubmit(code)
  }

  return (
    <GateLayout title="Carte commerciale" subtitle="Secteurs MD · SP · MC · BK">
      <form onSubmit={submit}>
        <label className="field">
          <span>Code d'accès</span>
          <input
            className="input code-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={Boolean(error)}
          />
        </label>
        {error && (
          <div className="alert error" role="alert">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}
        <button type="submit" className="btn primary" disabled={busy || !code.trim()}>
          <Icon name={busy ? 'refresh' : 'map'} className={busy ? 'spin' : undefined} />
          {busy ? 'Vérification…' : 'Ouvrir la carte'}
        </button>
      </form>
      <div className="gate-footer">
        <Link to="/aide">Aide</Link>
        <Link to="/admin">Espace admin</Link>
      </div>
    </GateLayout>
  )
}
