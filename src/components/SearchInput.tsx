import type { CSSProperties } from 'react'
import Icon from './Icon'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Nom lu par les lecteurs d'écran ; par défaut le texte d'exemple. */
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

/** Champ de recherche avec loupe et bouton « Effacer » de l'application (la croix native du navigateur est masquée). */
export default function SearchInput({ value, onChange, placeholder, ariaLabel, className, style }: Props) {
  return (
    <div className={'input-icon search-input' + (className ? ' ' + className : '')} style={style}>
      <Icon name="search" size={16} />
      <input
        className="input"
        type="search"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder.replace(/…$/, '')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Échap vide la recherche (sans fermer le panneau autour)
          if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Effacer la recherche">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}
