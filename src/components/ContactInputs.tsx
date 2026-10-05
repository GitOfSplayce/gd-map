import { emailIssue, formatPhone, normalizeEmail, phoneIssue } from '../lib/contacts'

interface Props {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

/** Numéro de téléphone, remis au format « 06 12 34 56 78 » en quittant le champ ; en rouge s'il est illisible. */
export function PhoneInput({ value, onChange, ariaLabel }: Props) {
  const invalid = Boolean(phoneIssue(value))
  return (
    <input
      className="input"
      inputMode="tel"
      autoComplete="off"
      placeholder="06 12 34 56 78"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const f = formatPhone(value)
        if (!invalid && f !== value) onChange(f)
      }}
      aria-label={ariaLabel}
      aria-invalid={invalid}
    />
  )
}

/** Adresse e-mail, mise en minuscules en quittant le champ ; en rouge si elle est illisible. */
export function EmailInput({ value, onChange, ariaLabel }: Props) {
  const invalid = Boolean(emailIssue(value))
  return (
    <input
      className="input"
      // Pas de type="email" : sa bulle de validation est celle du navigateur
      inputMode="email"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder="prenom.nom@exemple.fr"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const e = normalizeEmail(value)
        if (!invalid && e !== value) onChange(e)
      }}
      aria-label={ariaLabel}
      aria-invalid={invalid}
    />
  )
}
