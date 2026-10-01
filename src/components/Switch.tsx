import type { ReactNode } from 'react'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  className?: string
}

/** Interrupteur pour les réglages oui/non (remplace la case à cocher native). */
export default function Switch({ checked, onChange, label, className }: Props) {
  return (
    <label className={'switch' + (className ? ' ' + className : '')}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  )
}
