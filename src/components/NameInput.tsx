import { useRef, type CSSProperties } from 'react'
import { formatName } from '../lib/names'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  required?: boolean
  style?: CSSProperties
}

/**
 * Nom d'une personne, mis en « NOM Prénom » en quittant le champ. Une seule fois : corrigé à la main ensuite, il
 * reste comme on l'écrit. Un nom qu'on n'a pas touché ne change pas.
 */
export default function NameInput({ value, onChange, placeholder = 'DUPONT Marie', autoFocus, required, style }: Props) {
  const initial = useRef(value)
  const done = useRef(false)
  const tidy = () => {
    if (done.current || value === initial.current) return
    const next = formatName(value)
    if (next === value) return
    done.current = true
    onChange(next)
  }
  return (
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onBlur={tidy}
      onKeyDown={(e) => e.key === 'Enter' && tidy()}
    />
  )
}
