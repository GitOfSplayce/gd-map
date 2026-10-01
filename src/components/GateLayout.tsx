import type { ReactNode } from 'react'
import Logo from './Logo'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
}

/** Écrans d'accès (code, connexion) : grand arc azurin et trame de points, comme les pages de la charte. */
export default function GateLayout({ title, subtitle, children }: Props) {
  return (
    <div className="gate">
      <div className="gate-arc" aria-hidden="true" />
      <div className="gate-trame" aria-hidden="true" />
      <main className="card">
        <div className="gate-logo">
          <Logo />
        </div>
        <div className="gate-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  )
}
