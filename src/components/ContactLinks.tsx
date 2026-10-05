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
