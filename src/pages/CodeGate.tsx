import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import GateLayout from '../components/GateLayout'
import Icon from '../components/Icon'
import { loadGeo } from '../hooks/useGeo'
import { signInFailed } from '../lib/session'

interface Props {
  error: string | null
  busy: boolean
  onSubmit: (code: string) => void
  /** Connexion par le portail GDCOM (GD One) : part vers le portail, ou échoue avec un message. */
  onPortal: () => Promise<void>
  /** Connecté par le portail, mais sans rôle dans la carte (D-009) : l'adresse, pour le dire. */
  deniedEmail: string | null
  /** Ferme la session de la carte, pour se connecter avec un autre compte. */
  onSignOut: () => Promise<void>
}

export default function CodeGate({ error, busy, onSubmit, onPortal, deniedEmail, onSignOut }: Props) {
  const [code, setCode] = useState('')
  const [portalError, setPortalError] = useState<string | null>(() =>
    signInFailed() ? 'La connexion par le portail n\'a pas abouti. Réessayez, ou utilisez le code d\'accès.' : null,
  )
  const [leaving, setLeaving] = useState(false)

  const portal = async () => {
    setLeaving(true)
    setPortalError(null)
    try {
      await onPortal()
    } catch (e) {
      setPortalError((e as Error).message)
      setLeaving(false)
    }
  }

  // Les contours se chargent pendant la saisie du code
  useEffect(() => {
    loadGeo().catch(() => undefined)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) onSubmit(code)
  }

  return (
    <GateLayout title="Carte commerciale" subtitle="Secteurs commerciaux du groupe">
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

      <div className="gate-or">ou</div>
      {deniedEmail ? (
        <>
          <div className="alert warning" role="status">
            <Icon name="alert" size={16} />
            <span>
              Le compte {deniedEmail} n'a pas de rôle sur la carte : utilisez le code d'accès. Pour saisir des chiffres ou administrer la carte, demandez un
              rôle à un admin.
            </span>
          </div>
          <button type="button" className="btn ghost" onClick={() => void onSignOut()}>
            <Icon name="logout" size={16} />
            Changer de compte
          </button>
        </>
      ) : (
        <>
          {portalError && (
            <div className="alert error" role="alert">
              <Icon name="alert" size={16} />
              {portalError}
            </div>
          )}
          <button type="button" className="btn portal" onClick={() => void portal()} disabled={leaving}>
            <Icon name={leaving ? 'refresh' : 'user'} size={16} className={leaving ? 'spin' : undefined} />
            {leaving ? 'Redirection…' : 'Se connecter avec GD One'}
          </button>
          <p className="gate-note">Pour les admins et les responsables nommés dans la carte.</p>
        </>
      )}

      <div className="gate-footer">
        <Link to="/aide">Aide</Link>
        <Link to="/admin">Espace admin</Link>
      </div>
    </GateLayout>
  )
}
