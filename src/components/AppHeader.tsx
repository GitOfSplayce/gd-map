import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'

interface Props {
  /** Précision sous le nom de l'application (ex. « Administration »). */
  subtitle?: string
  /** Lien du logo. */
  home?: string
  nav?: ReactNode
  actions?: ReactNode
}

export default function AppHeader({ subtitle, home = '/', nav, actions }: Props) {
  return (
    <header className="topbar">
      <Link to={home} className="brand">
        <Logo className="brand-logo" />
        <Logo variant="mark" className="brand-mark" title="" />
        <span className="brand-name">
          Carte commerciale
          {subtitle && <small>{subtitle}</small>}
        </span>
      </Link>
      {nav}
      <div className="actions">{actions}</div>
    </header>
  )
}
