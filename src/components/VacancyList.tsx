import { isMarked, prioriteColor, vacancyText, type Vacancy } from '../lib/recrutement'
import { structureName, type StructureDef } from '../lib/structures'
import { shortZoneLabel } from '../lib/zones'
import { EmptySwatch, HatchSwatch } from './Legend'

const arrondissements = (v: Vacancy) => v.arrondissements && `arrondissements ${v.arrondissements.map((c) => shortZoneLabel(c).replace('Paris ', '')).join(', ')}`

interface Props {
  vacancies: Vacancy[]
  structures: StructureDef[]
  /** Un seul onglet de structure : son nom n'est pas répété. */
  single: boolean
}

/** Ce qui est à recruter dans une zone : d'abord ce qui a une priorité ou un groupe, même occupé, puis les autres en une ligne. */
export default function VacancyList({ vacancies, structures, single }: Props) {
  if (!vacancies.length) return null
  const known = single ? vacancies : vacancies.filter(isMarked)
  const others = vacancies.filter((v) => !known.includes(v))
  return (
    <div className="zp-section vacancies">
      <h3>À recruter</h3>
      {known.map((v) => (
        <div className="vacancy" key={v.structure}>
          {isMarked(v) ? <HatchSwatch color={prioriteColor(v.priorite)} /> : <EmptySwatch />}
          <div>
            {!single && (
              <strong>
                {v.structure} – {structureName(structures, v.structure)}
              </strong>
            )}
            <div>{vacancyText(v)}</div>
            {v.occupied && <div className="muted small">en plus de ceux déjà là</div>}
            {v.arrondissements && <div className="muted small">{arrondissements(v)}</div>}
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <p className="muted small" style={{ margin: known.length ? '6px 0 0' : 0 }}>
          {known.length ? 'Vide aussi' : 'Vide, sans priorité'} : {others.map((v) => v.structure).join(', ')}
        </p>
      )}
    </div>
  )
}
