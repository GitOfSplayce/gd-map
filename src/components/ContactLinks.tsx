import { phoneHref } from '../lib/contacts'
import Icon from './Icon'

/** Téléphone et e-mail cliquables (appel, message), ou rien s'il n'y en a pas. */
export default function ContactLinks({ telephone, email }: { telephone?: string | null; email?: string | null }) {
  if (!telephone && !email) return null
  return (
    <span className="contact-links">
      {telephone && (
        <a href={phoneHref(telephone)}>
          <Icon name="phone" size={13} />
          {telephone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`}>
          <Icon name="mail" size={13} />
          <span className="contact-email">{email}</span>
        </a>
      )}
    </span>
  )
}

/** Pastilles rouges « téléphone » et « e-mail » quand l'information manque (tableaux de l'admin). */
export function MissingContact({ telephone, email }: { telephone?: string | null; email?: string | null }) {
  const missing = [!telephone && 'téléphone', !email && 'e-mail'].filter(Boolean) as string[]
  if (!missing.length) return null
  const label = missing.join(' et ')
  return (
    <span className="contact-missing" role="img" aria-label={`${label[0].toUpperCase()}${label.slice(1)} à compléter`}>
      {!telephone && <Icon name="phone" size={13} />}
      {!email && <Icon name="mail" size={13} />}
    </span>
  )
}
