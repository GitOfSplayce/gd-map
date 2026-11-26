import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { PerfBar } from '../components/Legend'
import SearchInput from '../components/SearchInput'
import { useConfirm } from '../hooks/useConfirm'
import { saveEquipe } from '../lib/api'
import { isMine, myStructures, teamOf } from '../lib/equipe'
import { activeManagers } from '../lib/managers'
import { objectifsDraft, objectifsIssue, objectifsPayload } from '../lib/objectifsDraft'
import { formatZoneList, parseZoneList } from '../lib/parseZones'
import { defaultYear, sumPerf } from '../lib/performance'
import { blockedZones } from '../lib/recrutement'
import { inStructureOrder, structureCodes, structureName } from '../lib/structures'
import { plural } from '../lib/text'
import type { Commercial, MapData, Structure } from '../lib/types'
import type { AdminDataProps } from './AdminApp'
import GroupPicker from './GroupPicker'
import ObjectifsEditor from './ObjectifsEditor'
import ZoneAssistant from './ZoneAssistant'
import ZoneInput from './ZoneInput'

// Espace d'un manager (D-010) : les départements, le CA et les objectifs de ses commerciaux, dans les
// structures qu'un admin lui a cochées. La base revérifie l'équipe, les structures et les départements libres.

const zonesText = (c: Commercial, data: MapData, s: Structure) =>
  formatZoneList(data.affectations.filter((a) => a.commercial_id === c.id && a.structure === s))

export default function EquipePage({ data, reload }: AdminDataProps) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Commercial | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const codes = structureCodes(data.structures)
  const year = defaultYear(data.objectifs)
  const team = teamOf(data)
  const q = search.trim().toLowerCase()
  const rows = team.filter((c) => !q || [c.nom, c.statut, c.secteur, ...codes.map((s) => zonesText(c, data, s))].join(' ').toLowerCase().includes(q))
  const me = data.manager!

  return (
    <>
      <header>
        <h1>Mon équipe</h1>
        <span className="muted">{plural(team.length, 'commercial', 'commerciaux')}</span>
      </header>

      <div className="toolbar-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, département…" ariaLabel="Rechercher un commercial" />
        <span className="muted small">
          {me.structures.length
            ? `Vos structures : ${inStructureOrder(me.structures, codes).map((s) => `${s} (${structureName(data.structures, s)})`).join(', ')}. Vos changements se voient aussitôt sur la carte.`
            : 'Aucune structure ne vous est encore attribuée : demandez à un admin de les cocher.'}
        </span>
      </div>

      {notice && (
        <div className="alert success" style={{ marginBottom: 12 }} onClick={() => setNotice(null)}>
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid list">
          <thead>
            <tr>
              <th>Commercial</th>
              <th>Départements</th>
              <th style={{ width: 260 }}>CA et objectif {year}</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const mine = myStructures(data, c)
              const perf = sumPerf(data.objectifs, [c.id], year, codes)
              return (
                <tr
                  key={c.id}
                  className={(mine.length ? 'clickable' : '') + (c.actif ? '' : ' inactive')}
                  onClick={() => mine.length && setEditing(c)}
                  tabIndex={mine.length ? 0 : undefined}
                  onKeyDown={(e) => e.key === 'Enter' && mine.length && setEditing(c)}
                >
                  <td>
                    <div className="who">
                      <span className="swatch" style={{ background: c.couleur }} />
                      <div>
                        <div className="who-name">
                          {c.nom} {isMine(data, c) && <span className="badge">vous</span>}
                        </div>
                        <div className="who-sub">{[c.statut, c.secteur, !c.actif && 'inactif'].filter(Boolean).join(' · ') || ' '}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="zone-summary">
                      {codes
                        .filter((s) => c.structures.includes(s))
                        .map((s) => (
                          <div key={s}>
                            <span className="struct-tag">{s}</span>
                            <span className={zonesText(c, data, s) ? 'zone-text' : 'zone-text muted'}>{zonesText(c, data, s) || 'aucun département'}</span>
                            {!mine.includes(s) && <span className="muted small">(hors de vos structures)</span>}
                          </div>
                        ))}
                      {!c.structures.length && <span className="muted small">Aucune structure : un admin doit la cocher.</span>}
                    </div>
                  </td>
                  <td>{perf.hasData ? <PerfBar perf={perf} /> : <span className="muted">—</span>}</td>
                  <td className="col-actions">
                    {mine.length > 0 && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing(c)
                        }}
                      >
                        <Icon name="pencil" size={15} />
                        Modifier
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="muted">
                  {team.length ? 'Aucun commercial ne correspond à la recherche.' : 'Aucun commercial dans votre équipe : un admin vous les attribue.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <TeamDrawer
          key={editing.id}
          commercial={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload()
            setNotice(`${editing.nom} a été enregistré.`)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

interface DrawerProps {
  commercial: Commercial
  data: MapData
  onClose: () => void
  onSaved: () => Promise<void>
}

/** Panneau latéral : les départements et les chiffres d'un commercial, dans les structures du manager. */
function TeamDrawer({ commercial: c, data, onClose, onSaved }: DrawerProps) {
  const confirm = useConfirm()
  const mine = useMemo(() => myStructures(data, c), [data, c])
  const initial = useMemo(() => ({ zones: Object.fromEntries(mine.map((s) => [s, zonesText(c, data, s)])), objectifs: objectifsDraft(c.id, data.objectifs.filter((o) => mine.includes(o.structure))) }), [c, data, mine])
  const [zones, setZones] = useState<Record<Structure, string>>(initial.zones)
  const [objectifs, setObjectifs] = useState(initial.objectifs)
  const [assistantFor, setAssistantFor] = useState<Structure | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const blocked = useMemo(() => {
    const active = activeManagers(data.settings)
    return new Map(mine.map((s) => [s, blockedZones(data, c, s, data.manager!.nom, active)]))
  }, [data, c, mine])

  const list = (s: Structure, text: string) => parseZoneList(text).zones.map((z) => ({ structure: s, zone_code: z.code, couverture: z.couverture }))
  const zonesDirty = mine.some((s) => formatZoneList(list(s, zones[s])) !== formatZoneList(list(s, initial.zones[s])))
  const figures = objectifsPayload(objectifs)
  const before = new Map(objectifsPayload(initial.objectifs).map((o) => [`${o.structure}|${o.annee}`, o]))
  const changed = figures.filter((o) => {
    const b = before.get(`${o.structure}|${o.annee}`)
    return o.ca !== (b?.ca ?? null) || o.objectif !== (b?.objectif ?? null)
  })
  const dirty = zonesDirty || changed.length > 0

  const close = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Abandonner les modifications ?',
        message: 'Les changements faits sur ce commercial ne sont pas enregistrés.',
        confirmLabel: 'Abandonner',
        cancelLabel: 'Continuer la saisie',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  useEffect(() => {
    if (assistantFor) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    for (const s of mine) {
      const bad = parseZoneList(zones[s]).issues.filter((i) => i.level === 'error')
      if (bad.length) return setError(`Départements ${s} : ${bad.map((i) => `« ${i.raw} »`).join(', ')} ${bad.length > 1 ? 'ne sont pas des zones connues' : 'n\'est pas une zone connue'}.`)
      const taken = list(s, zones[s]).find((z) => blocked.get(s)!.has(z.zone_code))
      if (taken) return setError(`Le ${taken.zone_code} (${s}) est occupé par ${blocked.get(s)!.get(taken.zone_code)}.`)
    }
    const issue = objectifsIssue(objectifs)
    if (issue) return setError(issue)
    setSaving(true)
    setError(null)
    try {
      await saveEquipe(c.id, {
        ...(zonesDirty && { affectations: mine.flatMap((s) => list(s, zones[s])) }),
        ...(changed.length && { objectifs: changed }),
      })
      await onSaved()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={() => void close()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Modifier ${c.nom}`}>
        <form onSubmit={submit} className="drawer-form">
          <header className="drawer-head">
            <span className="swatch" style={{ background: c.couleur, width: 18, height: 18 }} />
            <h2 className="grow">{c.nom}</h2>
            {dirty && <span className="badge warning">Non enregistré</span>}
            <button type="button" className="btn small ghost icon" onClick={() => void close()} aria-label="Fermer" title="Fermer">
              <Icon name="x" size={18} />
            </button>
          </header>

          <div className="drawer-body">
            <section>
              <h3>Départements</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Saisie rapide (<code>22, 35P, 52G, 54GP, 75-7</code> : P = partiel, G = gestion, GP = gestion-partiel, 75 = tout Paris) ou avec
                l'assistant, ou d'un coup avec « Ajouter un groupe » (les départements d'un groupe à recruter, en propre). Un département
                occupé par le commercial d'un autre manager ne se prend pas.
              </p>
              <div className="stack" style={{ gap: 12 }}>
                {mine.map((s) => (
                  <div key={s} className="struct-block on">
                    <div className="struct-head">
                      <span className="row" style={{ fontWeight: 600 }}>
                        <span className="struct-tag">{s}</span>
                        {structureName(data.structures, s)}
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <GroupPicker
                          rows={data.a_recruter}
                          structure={s}
                          value={zones[s]}
                          blocked={blocked.get(s)}
                          onAdd={(text, skipped) => {
                            setZones({ ...zones, [s]: text })
                            setError(null)
                            setNotice(
                              skipped.length
                                ? `${skipped.map(([code, who]) => `${code} (${who})`).join(', ')} : ${skipped.length > 1 ? 'occupés' : 'occupé'} par le commercial d'un autre manager, ${skipped.length > 1 ? 'pas ajoutés' : 'pas ajouté'}.`
                                : null,
                            )
                          }}
                        />
                        <button type="button" className="btn small" onClick={() => setAssistantFor(s)}>
                          <Icon name="map" size={15} />
                          Assistant
                        </button>
                      </span>
                    </div>
                    <ZoneInput
                      value={zones[s]}
                      onChange={(v) => {
                        setZones({ ...zones, [s]: v })
                        setError(null)
                      }}
                      label={`Départements ${s}`}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>CA et objectifs</h3>
              <ObjectifsEditor
                value={objectifs}
                known={data.objectifs}
                structures={mine}
                onChange={(v) => {
                  setObjectifs(v)
                  setError(null)
                }}
                note="Vus des admins et des managers."
              />
            </section>
          </div>

          <footer className="drawer-foot">
            {notice && (
              <div className="alert warning" role="status">
                <Icon name="alert" size={16} />
                {notice}
              </div>
            )}
            {error && (
              <div className="alert error" role="alert">
                <Icon name="alert" size={16} />
                {error}
              </div>
            )}
            <div className="row">
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={() => void close()}>
                Annuler
              </button>
              <button type="submit" className="btn primary" disabled={saving || !dirty}>
                <Icon name={saving ? 'refresh' : 'save'} size={16} className={saving ? 'spin' : undefined} />
                Enregistrer
              </button>
            </div>
          </footer>
        </form>
      </aside>

      {assistantFor && (
        <ZoneAssistant
          title={`Départements ${assistantFor} (${structureName(data.structures, assistantFor)}) – ${c.nom}`}
          value={zones[assistantFor]}
          blocked={blocked.get(assistantFor)}
          onApply={(text) => setZones({ ...zones, [assistantFor]: text })}
          onClose={() => setAssistantFor(null)}
        />
      )}
    </>
  )
}
