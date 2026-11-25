import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import SearchInput from '../components/SearchInput'
import { fetchJournal } from '../lib/api'
import { groupJournal } from '../lib/journal'
import type { JournalLine } from '../lib/types'

const day = (le: string) => new Date(le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const time = (le: string) => new Date(le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Qui a modifié quoi, quand : tout pour un admin, son équipe pour un manager. */
export default function JournalPage({ team = false }: { team?: boolean }) {
  const [lines, setLines] = useState<JournalLine[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async (avant?: number) => {
    setBusy(true)
    try {
      const res = await fetchJournal(avant)
      setLines((prev) => (avant ? [...(prev ?? []), ...res.lignes] : res.lignes))
      setMore(res.suite)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const entries = useMemo(() => groupJournal(lines ?? []), [lines])
  const q = search.trim().toLowerCase()
  const shown = entries.filter((e) => !q || [e.auteur, e.sujet, ...e.changes.map((c) => c.text)].join(' ').toLowerCase().includes(q))

  return (
    <>
      <header>
        <h1>Journal des modifications</h1>
        <span className="muted">{team ? 'Votre équipe' : 'Toute la carte'}</span>
      </header>
      <div className="toolbar-row">
        <SearchInput style={{ width: 'min(360px, 100%)' }} value={search} onChange={setSearch} placeholder="Personne, commercial, département…" ariaLabel="Rechercher dans le journal" />
        <button type="button" className="btn small" disabled={busy} onClick={() => void load()}>
          <Icon name="refresh" size={15} className={busy ? 'spin' : undefined} />
          Actualiser
        </button>
      </div>
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}
      {lines === null && !error && <p className="muted">Chargement…</p>}
      {lines !== null && !shown.length && (
        <p className="muted">{entries.length ? 'Aucune ligne ne correspond à la recherche.' : 'Aucune modification enregistrée pour l\'instant.'}</p>
      )}
      <div className="journal">
        {shown.map((e, i) => (
          <div key={e.key}>
            {(i === 0 || day(e.le) !== day(shown[i - 1].le)) && <h2 className="journal-day">{day(e.le)}</h2>}
            <article className="journal-entry">
              <time dateTime={e.le}>{time(e.le)}</time>
              <div>
                <div>
                  <strong>{e.sujet}</strong> <span className="muted small">par {e.auteur}</span>
                </div>
                <ul>
                  {e.changes.map((c, j) => (
                    <li key={j} className={c.kind}>
                      {c.text}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </div>
        ))}
      </div>
      {more && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void load(lines?.[lines.length - 1]?.id)}>
            Afficher la suite
          </button>
        </div>
      )}
    </>
  )
}
