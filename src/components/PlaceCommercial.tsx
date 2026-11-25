import { useState } from 'react'
import { saveEquipe } from '../lib/api'
import { activeManagers, manages } from '../lib/managers'
import { atomsOf, blockedZones } from '../lib/recrutement'
import { COUVERTURE_LABELS, COUVERTURES, type Couverture, type MapData, type Structure, type ZoneAssignment } from '../lib/types'
import Icon from './Icon'
import Select from './Select'

interface Props {
  code: string
  data: MapData
  /** Structures à proposer : celles de l'onglet ouvert. */
  structures: Structure[]
  onSaved: () => Promise<unknown>
}

/** Un manager place un de ses commerciaux dans le département ouvert, s'il est libre ou déjà à son équipe. */
export default function PlaceCommercial({ code, data, structures, onSaved }: Props) {
  const me = data.manager!
  const active = activeManagers(data.settings)
  const [structure, setStructure] = useState<Structure | null>(null)
  const [id, setId] = useState('')
  const [couverture, setCouverture] = useState<Couverture>('propre')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const team = data.commerciaux.filter((c) => c.actif && manages(me.nom, c, active))
  const zonesOf = (commercial: string, s: Structure): ZoneAssignment[] =>
    data.affectations
      .filter((a) => a.commercial_id === commercial && a.structure === s)
      .map(({ structure: st, zone_code, couverture: c }) => ({ structure: st, zone_code, couverture: c }))
  /** Déjà là, sur toute la zone. */
  const here = (commercial: string, s: Structure) => {
    const own = new Set(zonesOf(commercial, s).flatMap((a) => atomsOf(a.zone_code)))
    return atomsOf(code).every((atom) => own.has(atom))
  }
  const candidates = (s: Structure) =>
    team.filter((c) => c.structures.includes(s) && !here(c.id, s) && !blockedZones(data, c, s, me.nom, active).has(code))
  const choices = structures.filter((s) => me.structures.includes(s) && candidates(s).length)
  if (!choices.length) return message ? <div className={`alert ${message.kind}`}>{message.text}</div> : null

  const s = structure && choices.includes(structure) ? structure : choices[0]
  const people = candidates(s)
  const chosen = people.find((c) => c.id === id)

  const save = async () => {
    if (!chosen) return
    setBusy(true)
    setMessage(null)
    try {
      // Les zones de ce commercial dans les autres structures du manager restent telles quelles
      const kept = me.structures.filter((x) => chosen.structures.includes(x)).flatMap((x) => zonesOf(chosen.id, x))
      const atoms = new Set(atomsOf(code))
      const others = kept.filter((z) => z.structure !== s || (z.zone_code !== code && !atoms.has(z.zone_code)))
      await saveEquipe(chosen.id, { affectations: [...others, { structure: s, zone_code: code, couverture }] })
      setId('')
      setMessage({ kind: 'success', text: `Département attribué à ${chosen.nom} (${s}).` })
      await onSaved()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="zp-section place">
      <h3>Placer un de mes commerciaux</h3>
      {choices.length > 1 && (
        <div className="seg">
          {choices.map((x) => (
            <button key={x} type="button" aria-pressed={x === s} onClick={() => setStructure(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      <Select
        ariaLabel="Commercial"
        value={chosen ? id : ''}
        options={people.map((c) => ({ value: c.id, label: c.nom, color: c.couleur }))}
        onChange={setId}
        placeholder="Choisir un commercial"
      />
      <div className="seg">
        {COUVERTURES.map((c) => (
          <button key={c} type="button" aria-pressed={couverture === c} onClick={() => setCouverture(c)}>
            {COUVERTURE_LABELS[c]}
          </button>
        ))}
      </div>
      <div>
        <button type="button" className="btn small primary" disabled={busy || !chosen} onClick={() => void save()}>
          <Icon name={busy ? 'refresh' : 'plus'} size={15} className={busy ? 'spin' : undefined} />
          Placer{choices.length === 1 ? ` (${s})` : ''}
        </button>
      </div>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </div>
  )
}
