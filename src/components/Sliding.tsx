import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

// Choix exclusifs (.seg) et onglets (.tabs) : la marque du choix actif glisse de l'un à l'autre. Elle suit
// l'attribut aria du bouton actif, quel que soit ce qui le change (état, adresse, données).

const ACTIVE = '[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [aria-current="page"]'
const ATTRIBUTES = ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-current']

type Write = () => void

// Une page peut en avoir une centaine (liste des départements) : toutes les mesures d'abord, les écritures
// ensuite, pour ne pas refaire la mise en page à chacune. Avant l'affichage, donc sans saut visible.
let jobs: (() => Write)[] = []
function measure(job: () => Write) {
  if (jobs.push(job) > 1) return
  queueMicrotask(() => {
    const batch = jobs
    jobs = []
    for (const write of batch.map((read) => read())) write()
  })
}

interface Props extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'nav'
}

export default function Sliding({ as: Tag = 'div', children, ...props }: Props) {
  const root = useRef<HTMLElement | null>(null)
  const mark = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = root.current!
    const m = mark.current!
    let last = ''
    let alive = true

    const place = (slide: boolean) =>
      measure(() => {
        const on = alive ? el.querySelector<HTMLElement>(ACTIVE) : null
        const box = on?.offsetWidth ? [on.offsetLeft, on.offsetTop, on.offsetWidth, on.offsetHeight] : null
        return () => {
          const next = box?.join(' ') ?? ''
          if (!alive || next === last) return
          // Première position, ou boutons redimensionnés : la marque se pose sans glisser
          const still = !slide || !last
          last = next
          if (!box) {
            delete el.dataset.slides
            return
          }
          if (still) m.style.transition = 'none'
          ;['--x', '--y', '--w', '--h'].forEach((name, i) => m.style.setProperty(name, `${box[i]}px`))
          el.dataset.slides = ''
          if (still) requestAnimationFrame(() => requestAnimationFrame(() => (m.style.transition = '')))
        }
      })

    place(false)
    const changes = new MutationObserver(() => place(true))
    changes.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRIBUTES })
    const sizes = new ResizeObserver(() => place(false))
    sizes.observe(el)
    for (const child of el.children) if (child !== m) sizes.observe(child)
    return () => {
      alive = false
      changes.disconnect()
      sizes.disconnect()
    }
  }, [])

  return (
    <Tag
      {...props}
      ref={(node: HTMLElement | null) => {
        root.current = node
      }}
    >
      <span ref={mark} className="slide-mark" aria-hidden="true" />
      {children}
    </Tag>
  )
}
