import { parseAmountInput, tidyAmountInput } from '../lib/amounts'

interface Props {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

/** Champ de montant en euros : « 120k » ou « 1,2M » acceptés, remis en forme (« 120 000 ») en quittant le champ. */
export default function AmountInput({ value, onChange, ariaLabel }: Props) {
  const invalid = Number.isNaN(parseAmountInput(value))
  return (
    <span className={'amount-field' + (invalid ? ' invalid' : '')}>
      <input
        className="input amount"
        inputMode="decimal"
        placeholder="ex. 120k"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const tidy = tidyAmountInput(value)
          if (tidy !== value) onChange(tidy)
        }}
        aria-label={ariaLabel}
        aria-invalid={invalid}
      />
      <span className="amount-unit" aria-hidden="true">
        €
      </span>
    </span>
  )
}
