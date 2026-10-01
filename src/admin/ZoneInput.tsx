import { useMemo } from 'react'
import { parseZoneList } from '../lib/parseZones'
import { COUVERTURE_LABELS } from '../lib/types'
import { ZONE_BY_CODE } from '../lib/zones'

interface Props {
  value: string
  onChange: (value: string) => void
  label: string
}

/** Saisie au format Excel ("22, 35P, 52G, 75-7") avec aperçu en pastilles. */
export default function ZoneInput({ value, onChange, label }: Props) {
  const parsed = useMemo(() => parseZoneList(value), [value])

  return (
    <div className="zone-cell">
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ex. 22, 35P, 75-7"
        aria-label={label}
        aria-invalid={parsed.issues.some((i) => i.level === 'error')}
        spellCheck={false}
      />
      {(parsed.zones.length > 0 || parsed.issues.length > 0) && (
        <div className="chips">
          {parsed.zones.map((z) => (
            <span
              key={z.code}
              className={`chip ${z.couverture}`}
              title={`${ZONE_BY_CODE.get(z.code)?.nom ?? z.code} – ${COUVERTURE_LABELS[z.couverture]}`}
            >
              {z.code}
            </span>
          ))}
          {parsed.issues.map((i, n) => (
            <span key={n} className={`chip ${i.level}`} title={i.message}>
              {i.level === 'error' ? i.raw : '⚠'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
