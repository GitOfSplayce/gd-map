import { pageList } from '../lib/pagination'
import Icon from './Icon'

interface Props {
  page: number
  pages: number
  busy?: boolean
  onChange: (page: number) => void
}

export default function Pagination({ page, pages, busy, onChange }: Props) {
  if (pages < 2) return null
  return (
    <nav className="pagination" aria-label="Pages">
      <button type="button" className="btn small" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="arrowLeft" size={15} />
        <span className="hide-mobile">Précédent</span>
      </button>
      {pageList(page, pages).map((p, i) =>
        p === null ? (
          <span key={`saut-${i}`} className="muted" aria-hidden="true">
            …
          </span>
        ) : (
          <button key={p} type="button" className="btn small page" aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`} disabled={busy} onClick={() => p !== page && onChange(p)}>
            {p}
          </button>
        ),
      )}
      <button type="button" className="btn small" disabled={busy || page >= pages} onClick={() => onChange(page + 1)}>
        <span className="hide-mobile">Suivant</span>
        <Icon name="chevronRight" size={15} />
      </button>
    </nav>
  )
}
