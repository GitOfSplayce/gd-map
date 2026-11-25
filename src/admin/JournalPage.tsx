import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
import { fetchJournal, type JournalPageData } from '../lib/api'
import { groupJournal } from '../lib/journal'
import { plural } from '../lib/text'

const day = (le: string) => new Date(le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const time = (le: string) => new Date(le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Qui a modifié quoi, quand : tout pour un admin, son équipe pour un manager. */
export default function JournalPage({ team = false }: { team?: boolean }) {
  const [data, setData] = useState<JournalPageData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  /** Recherche envoyée : la saisie, une fois posée. */
  const [query, setQuery] = useState('')
  const top = useRef<HTMLElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      // « 1 077 » se cherche comme il est enregistré : 1077
      setQuery(search.trim().replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1'))
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Une réponse arrivée après une demande plus récente est ignorée
  const latest = useRef(0)
  const load = useCallback(async () => {
    const mine = ++latest.current
    setBusy(true)
    try {
      const res = await fetchJournal(page, query)
      if (mine !== latest.current) return
      setData(res)
      setError(null)
    } catch (e) {
      if (mine === latest.current) setError((e as Error).message)
    } finally {
      if (mine === latest.current) setBusy(false)
    }
  }, [page, query])
  useEffect(() => {
    void load()
  }, [load])

  const entries = useMemo(() => groupJournal(data?.lignes ?? []), [data])
  const pages = data ? Math.ceil(data.total / data.taille) : 0
  const go = (p: number) => {
    setPage(p)
    top.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <>
      <header ref={top}>
        <h1>Journal des modifications</h1>
        <span className="muted">{team ? 'Votre équipe' : 'Toute la carte'}</span>
      </header>
      <div className="toolbar-row">
        <SearchInput style={{ width: 'min(360px, 100%)' }} value={search} onChange={setSearch} placeholder="Personne, commercial, département…" ariaLabel="Rechercher dans le journal" />
        <button type="button" className="btn small" disabled={busy} onClick={() => void load()}>
          <Icon name="refresh" size={15} className={busy ? 'spin' : undefined} />
          Actualiser
        </button>
        {data && (
          <span className="muted small">
            {plural(data.total, 'enregistrement')}
            {pages > 1 && ` · page ${data.page} sur ${pages}`}
          </span>
        )}
      </div>
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}
      {!data && !error && <p className="muted">Chargement…</p>}
      {data && !entries.length && <p className="muted">{query ? 'Aucune ligne ne correspond à la recherche.' : 'Aucune modification enregistrée pour l\'instant.'}</p>}
      <div className="journal" aria-busy={busy}>
        {entries.map((e, i) => (
          <div key={e.key}>
            {(i === 0 || day(e.le) !== day(entries[i - 1].le)) && <h2 className="journal-day">{day(e.le)}</h2>}
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
      <Pagination page={page} pages={pages} busy={busy} onChange={go} />
    </>
  )
}
