import Select from '../components/Select'
import { groupsOf } from '../lib/recrutement'
import type { ARecruter, Structure } from '../lib/types'
import { addZonesToText } from '../lib/zoneEditing'

interface Props {
  rows: readonly ARecruter[]
  structure: Structure
  /** Zones saisies pour cette structure (« 22, 35P »). */
  value: string
  /** Le texte complété, et les départements laissés de côté, avec qui y est. */
  onAdd: (text: string, skipped: [string, string][]) => void
  /** Zones qu'on ne peut pas prendre, avec qui y est (manager). */
  blocked?: ReadonlyMap<string, string>
}

/** « Ajouter un groupe » : les départements d'un groupe à recruter, d'un coup, en propre (D-016). */
export default function GroupPicker({ rows, structure, value, onAdd, blocked }: Props) {
  const groups = groupsOf(rows, structure)
  if (!groups.size) return null
  return (
    <Select
      className="auto group-picker"
      ariaLabel={`Ajouter un groupe à recruter (${structure})`}
      value=""
      placeholder="Ajouter un groupe"
      options={[...groups].map(([g, codes]) => ({ value: g, label: g, hint: codes.join(', ') }))}
      onChange={(g) => {
        const codes = groups.get(g) ?? []
        const skipped = codes.filter((c) => blocked?.has(c)).map((c): [string, string] => [c, blocked!.get(c)!])
        onAdd(addZonesToText(value, codes.filter((c) => !blocked?.has(c))), skipped)
      }}
      searchable={false}
    />
  )
}
