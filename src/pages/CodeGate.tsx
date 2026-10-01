import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
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
    <div className="gate">
      <div className="card">
        <div className="gate-logo">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <div>
            <h1 style={{ margin: 0, fontSize: 19 }}>Carte commerciale</h1>
            <div className="muted small">Secteurs MD · SP · MC · BK</div>
          </div>
        </div>
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
              {error}
            </div>
          )}
          <button type="submit" className="btn primary" disabled={busy || !code.trim()}>
            {busy ? 'Vérification…' : 'Ouvrir la carte'}
          </button>
        </form>
        <div className="gate-footer">
          <Link to="/aide">Aide</Link>
          <Link to="/admin">Espace admin</Link>
        </div>
      </div>
    </div>
  )
}
