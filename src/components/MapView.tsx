import {
  geoClipRectangle,
  geoConicConformal,
  geoMercator,
  geoPath,
  geoStream,
  type GeoPermissibleObjects,
  type GeoProjection,
  type GeoStream,
} from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import polylabel from 'polylabel'
import Icon from './Icon'
import type { GeoData } from '../hooks/useGeo'
import { blendWithWhite, mixColors, readableTextColor, shade } from '../lib/colors'
import { placeName, rasterOf } from '../lib/labelPlacement'
import { dashesId, dotsId, type MapModel, type SharedMode, type Stripe, type ZonePattern, type ZoneStyle } from '../lib/mapModel'
import { DROM_CODES, IDF_CODES, MONACO_CODE, ZONE_BY_CODE, isParisArr } from '../lib/zones'

export type MapViewMode = 'france' | 'idf' | 'paris'

type ZoneFeature = Feature<Polygon | MultiPolygon, { code: string; nom: string }>

interface Shape {
  code: string
  d: string
  /** Emprise projetée (découpage en bandes). */
  bounds: { x0: number; y0: number; x1: number; y1: number }
  label: string
  /** Ancre de l'étiquette et place disponible autour (rayon en px), ou null si la zone n'est pas visible. */
  anchor: { x: number; y: number; room: number } | null
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Inset extends Box {
  code: string
  title: string
  shape: Shape
}

interface Layout {
  main: Box
  shapes: Shape[]
  insets: Inset[]
  marker: { code: string; x: number; y: number } | null
}

const MONACO_POINT: [number, number] = [7.4246, 43.7384]
const INSET_CODES = [...DROM_CODES, MONACO_CODE]
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const lambert = () => geoConicConformal().parallels([44, 49]).rotate([-3, 0])

function shapeLabel(code: string) {
  if (!isParisArr(code)) return code
  const n = Number(code.slice(3))
  return n === 1 ? '1er' : `${n}e`
}

// Arrondissements dont la plus grande partie est un bois : l'étiquette va dans la partie urbaine
const LABEL_ANCHORS: Record<string, [number, number]> = {
  '75-12': [2.3935, 48.8405],
  '75-16': [2.2735, 48.8605],
}

const ringArea = (ring: [number, number][]) =>
  Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]
    return sum + x * ny - nx * y
  }, 0) / 2)

/**
 * Point le plus « intérieur » de la plus grande partie visible de la zone (algorithme polylabel),
 * calculé sur la géométrie projetée et découpée au cadre : une zone en croissant (92) ou à moitié hors
 * de l'écran garde son étiquette bien à l'intérieur.
 */
function labelAnchor(f: ZoneFeature, proj: GeoProjection, box: Box): Shape['anchor'] {
  const polygons: [number, number][][][] = []
  let rings: [number, number][][] = []
  let ring: [number, number][] = []
  const sink = {
    point: (x: number, y: number) => void ring.push([x, y]),
    lineStart: () => void (ring = []),
    lineEnd: () => void (ring.length > 2 && rings.push(ring)),
    polygonStart: () => void (rings = []),
    polygonEnd: () => void (rings.length && polygons.push(rings)),
    sphere: () => undefined,
  } as GeoStream
  geoStream(f as GeoPermissibleObjects, proj.stream(geoClipRectangle(box.x, box.y, box.x + box.w, box.y + box.h)(sink)))

  const parts = polygons.map((p) => [...p].sort((a, b) => ringArea(b) - ringArea(a)))
  const biggest = parts.sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0]
  if (!biggest) return null
  const p = polylabel(biggest, 0.5)
  const fixed = LABEL_ANCHORS[f.properties.code] && proj(LABEL_ANCHORS[f.properties.code])
  return fixed ? { x: fixed[0], y: fixed[1], room: p.distance } : { x: p[0], y: p[1], room: p.distance }
}

function toShape(f: ZoneFeature, path: ReturnType<typeof geoPath>, proj: GeoProjection, box: Box | null): Shape {
  const [[x0, y0], [x1, y1]] = path.bounds(f as GeoPermissibleObjects)
  return {
    code: f.properties.code,
    d: path(f as GeoPermissibleObjects) ?? '',
    bounds: { x0, y0, x1, y1 },
    label: shapeLabel(f.properties.code),
    anchor: box ? labelAnchor(f, proj, box) : null,
  }
}

function insetBoxes(w: number, h: number): { main: Box; boxes: Box[] } {
  const gap = 6
  if (w >= h * 0.95) {
    // Encarts en colonne à gauche
    const iw = clamp(w * 0.15, 84, 150)
    const ih = Math.min((h - 2 * gap) / INSET_CODES.length - gap, iw)
    return {
      main: { x: iw + 2 * gap, y: 0, w: w - iw - 2 * gap, h },
      boxes: INSET_CODES.map((_, i) => ({ x: gap, y: gap + i * (ih + gap), w: iw, h: ih })),
    }
  }
  // Encarts en bas (écran en hauteur)
  const cols = w / INSET_CODES.length >= 100 ? INSET_CODES.length : 3
  const rows = Math.ceil(INSET_CODES.length / cols)
  const iw = (w - gap * (cols + 1)) / cols
  const ih = clamp(iw * 0.58, 60, 96)
  const top = h - rows * (ih + gap)
  return {
    main: { x: 0, y: 0, w, h: top },
    boxes: INSET_CODES.map((_, i) => ({ x: gap + (i % cols) * (iw + gap), y: top + Math.floor(i / cols) * (ih + gap), w: iw, h: ih })),
  }
}

function computeLayout(view: MapViewMode, geo: GeoData, w: number, h: number): Layout {
  const deps = geo.departements.features as ZoneFeature[]
  const metro = deps.filter((f) => !DROM_CODES.includes(f.properties.code))
  const arrs = geo.paris.features as ZoneFeature[]
  const fc = (features: ZoneFeature[]) => ({ type: 'FeatureCollection', features }) as GeoPermissibleObjects

  if (view === 'france') {
    const { main, boxes } = insetBoxes(w, h)
    const pad = 12
    const proj = lambert().fitExtent([[main.x + pad, main.y + pad], [main.x + main.w - pad, main.y + main.h - pad]], fc(metro))
    const path = geoPath(proj)
    const [mx, my] = proj(MONACO_POINT) ?? [0, 0]

    const insets = INSET_CODES.map((code, i): Inset => {
      const b = boxes[i]
      const feature = (code === MONACO_CODE ? geo.monaco.features[0] : deps.find((f) => f.properties.code === code)) as ZoneFeature
      const ip = geoMercator().fitExtent([[b.x + 6, b.y + 18], [b.x + b.w - 6, b.y + b.h - 6]], feature as GeoPermissibleObjects)
      const nom = ZONE_BY_CODE.get(code)?.nom ?? code
      return { ...b, code, title: `${nom} (${code})`, shape: toShape(feature, geoPath(ip), ip, b) }
    })

    return { main, shapes: metro.map((f) => toShape(f, path, proj, main)), insets, marker: { code: MONACO_CODE, x: mx, y: my } }
  }

  const main = { x: 0, y: 0, w, h }
  const pad = view === 'paris' ? 18 : 12
  const detailed = new Map((geo.idf.features as ZoneFeature[]).map((f) => [f.properties.code, f]))
  const local = metro.map((f) => detailed.get(f.properties.code) ?? f)
  const target = view === 'paris' ? arrs : local.filter((f) => IDF_CODES.includes(f.properties.code))
  const proj = lambert().fitExtent([[pad, pad], [w - pad, h - pad]], fc(target))
  const path = geoPath(proj)

  // Départements voisins visibles à l'écran, puis Paris par arrondissement
  const shapes = [...local.filter((f) => f.properties.code !== '75'), ...arrs]
    .filter((f) => {
      const [[x0, y0], [x1, y1]] = path.bounds(f as GeoPermissibleObjects)
      return x1 >= 0 && y1 >= 0 && x0 <= w && y0 <= h
    })
    // Pas d'étiquettes d'arrondissement à l'échelle de l'Île-de-France : trop petites
    .map((f) => toShape(f, path, proj, view === 'idf' && isParisArr(f.properties.code) ? null : main))

  return { main, shapes, insets: [], marker: null }
}

/** Texte clair sur fond foncé, foncé sur fond clair ; rayures : texte foncé avec halo blanc. */
function labelColors(st: ZoneStyle | undefined): { text: string; halo: string } {
  const dark = { text: '#1b2232', halo: 'rgba(255,255,255,0.85)' }
  if (!st || st.pattern || !st.fill.startsWith('#')) return dark
  return readableTextColor(blendWithWhite(st.fill, st.fillOpacity)) === '#fff' ? { text: '#ffffff', halo: 'rgba(0,0,0,0.35)' } : dark
}

/** Taille du nom d'un groupe à recruter, en pixels écran ; la plus petite quand le groupe est étroit. */
const GROUP_LABEL = 11.5
const GROUP_FONTS = [GROUP_LABEL, 9.5]

/** Largeur d'une rayure et hauteur du motif (multiple de l'écart des points et du pas des pointillés). */
const STRIPE = 6
const STRIPE_H = 12

/**
 * Une rayure d'un motif : couleur pleine, points (gestion), trait pointillé (gestion-partiel) ou blanc.
 * Points et pointillés sont dessinés directement dans la rayure (pas de motif imbriqué, donc pas de joints visibles).
 */
function Band({ slice, x }: { slice: Stripe; x: number }) {
  const cx = x + STRIPE / 2
  if (slice.kind === 'plein') return <rect x={x} width={STRIPE} height={STRIPE_H} fill={slice.color} fillOpacity={slice.opacity} />
  if (slice.kind === 'points') {
    return (
      <>
        <rect x={x} width={STRIPE} height={STRIPE_H} fill={slice.color} fillOpacity={0.16} />
        <circle cx={cx} cy={STRIPE / 2} r={1.35} fill={slice.color} />
        <circle cx={cx} cy={STRIPE * 1.5} r={1.35} fill={slice.color} />
      </>
    )
  }
  if (slice.kind === 'tirets') {
    return <line x1={cx} y1={0} x2={cx} y2={STRIPE_H} stroke={slice.color} strokeWidth={1.8} strokeDasharray="3.5 2.5" />
  }
  return null
}

export interface MapViewProps {
  view: MapViewMode
  geo: GeoData
  model: MapModel
  highlighted: Set<string>
  selected: string | null
  showLabels: boolean
  /** Position du curseur et taille de la carte, pour placer l'infobulle. */
  onHover: (code: string | null, pos?: { x: number; y: number; w: number; h: number }) => void
  onSelect: (code: string) => void
  /** Clic à côté des zones (fond de carte, cadre d'un encart) : sert à tout désélectionner. */
  onBackground: () => void
  sharedMode: SharedMode
  onSvg: (el: SVGSVGElement | null) => void
  /**
   * Peindre en restant appuyé (souris, ou appui long au doigt) : reçoit chaque zone traversée, `start` pour la
   * première. Renvoie faux si la zone ne se peint pas. Une zone ne déplace alors plus la carte : le fond, le
   * clic droit ou deux doigts le font.
   */
  onPaint?: (code: string, start: boolean) => boolean
}

/** Appui long avant de peindre au doigt, en ms. */
const LONG_PRESS = 350

export default function MapView({
  view,
  geo,
  model,
  highlighted,
  selected,
  showLabels,
  onHover,
  onSelect,
  onBackground,
  sharedMode,
  onSvg,
  onPaint,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerSvg = useRef<SVGSVGElement | null>(null)
  const layerRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [scale, setScale] = useState(1)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current!
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Toujours la dernière version, sans refaire le zoom ni les écouteurs
  const paintRef = useRef(onPaint)
  useLayoutEffect(() => {
    paintRef.current = onPaint
  })
  const canPaint = Boolean(onPaint)
  /** Trait en cours : bouton enfoncé, première zone déjà peinte, clic à ignorer ensuite. */
  const stroke = useRef({ down: false, started: false, skipClick: false })
  const paintAt = (code: string) => {
    const s = stroke.current
    if (paintRef.current?.(code, !s.started)) s.started = s.skipClick = true
  }
  useEffect(() => {
    const up = () => {
      stroke.current.down = stroke.current.started = false
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  // Au doigt : un appui long peint, un glissement simple déplace la carte. Écouté avant le zoom (phase de capture).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !canPaint) return
    let timer = 0
    let painting = false
    let last: string | null = null
    let from = { x: 0, y: 0 }
    const zoneAt = (p: { clientX: number; clientY: number }) => document.elementFromPoint(p.clientX, p.clientY)?.closest('[data-code]')?.getAttribute('data-code') ?? null
    const cancel = () => window.clearTimeout(timer)
    const start = (e: TouchEvent) => {
      cancel()
      painting = false
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      from = { x: touch.clientX, y: touch.clientY }
      timer = window.setTimeout(() => {
        last = zoneAt(touch)
        if (last && paintRef.current?.(last, true)) {
          painting = true
          navigator.vibrate?.(12)
        }
      }, LONG_PRESS)
    }
    const move = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!painting) {
        if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > 10) cancel()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const code = zoneAt(touch)
      if (code && code !== last) {
        last = code
        paintRef.current?.(code, false)
      }
    }
    const end = (e: TouchEvent) => {
      cancel()
      // Pas de clic après un trait : il effacerait la dernière zone
      if (painting) e.preventDefault()
      painting = false
    }
    el.addEventListener('touchstart', start, { capture: true, passive: true })
    el.addEventListener('touchmove', move, { capture: true, passive: false })
    el.addEventListener('touchend', end, { capture: true, passive: false })
    el.addEventListener('touchcancel', cancel, { capture: true })
    return () => {
      cancel()
      el.removeEventListener('touchstart', start, { capture: true })
      el.removeEventListener('touchmove', move, { capture: true })
      el.removeEventListener('touchend', end, { capture: true })
      el.removeEventListener('touchcancel', cancel, { capture: true })
    }
  }, [canPaint])

  const layout = useMemo(() => (size ? computeLayout(view, geo, size.w, size.h) : null), [view, geo, size])

  const labelSize = view === 'paris' ? 13 : view === 'idf' ? 11 : 9.5
  // L'étiquette n'est affichée que si elle tient dans la zone (la place disponible grandit avec le zoom)
  const fits = (s: Shape) =>
    s.anchor !== null && s.anchor.room * scale >= Math.max(labelSize * 0.6, (labelSize * 0.62 * s.label.length) / 2 * 0.85)

  // Zoom et déplacement sur la carte principale (les encarts restent fixes)
  useEffect(() => {
    if (!layout || !innerSvg.current || !layerRef.current) return
    const svg = select(innerSvg.current)
    const layer = select(layerRef.current)
    const { x, y, w, h } = layout.main
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, view === 'paris' ? 6 : 12])
      .extent([[x, y], [x + w, y + h]])
      .translateExtent([[x, y], [x + w, y + h]])
      .filter((event: Event & { button?: number; target: EventTarget | null }) => {
        // En peinture, le clic droit déplace la carte, et appuyer sur une zone la peint
        if (event.button) return canPaint && event.button === 2
        if (canPaint && event.type === 'mousedown' && event.target instanceof Element && event.target.closest('.zone')) return false
        // Le zoom ne démarre que sur la carte principale, pas sur les encarts
        return !(event.target instanceof Element && event.target.closest('.inset'))
      })
      .on('zoom', (event) => {
        // Pendant le geste, on agit directement sur le DOM ; React reprend la main à la fin
        const t = event.transform
        layer.attr('transform', t.toString())
        layer.select('.labels').attr('font-size', labelSize / t.k)
        layer.select('.group-labels').attr('font-size', GROUP_LABEL / t.k)
        layer.selectAll('.marker').attr('r', 5 / t.k)
      })
      .on('end', (event) => setScale(event.transform.k))
    svg.call(z).on('dblclick.zoom', null)
    svg.call(z.transform, zoomIdentity)
    zoomRef.current = z
    return () => {
      svg.on('.zoom', null)
    }
  }, [layout, view, labelSize, canPaint])

  const zoomBy = (k: number) => {
    if (innerSvg.current && zoomRef.current) select(innerSvg.current).call(zoomRef.current.scaleBy, k)
  }
  const resetZoom = () => {
    if (innerSvg.current && zoomRef.current) select(innerSvg.current).call(zoomRef.current.transform, zoomIdentity)
  }

  const styles = useMemo(() => {
    const map = new Map<string, ZoneStyle>()
    if (!layout) return map
    for (const s of layout.shapes) map.set(s.code, model.styleOf(s.code, highlighted))
    for (const i of layout.insets) map.set(i.code, model.styleOf(i.code, highlighted))
    return map
  }, [layout, model, highlighted])

  // Motifs à définir : ceux des zones, plus points et pointillés des parts utilisées en découpage, camemberts ou dominante
  const patterns = useMemo(() => {
    const byId = new Map<string, ZonePattern>()
    for (const st of styles.values()) {
      if (st.pattern) byId.set(st.pattern.id, st.pattern)
      if (st.overlay) byId.set(st.overlay.pattern.id, st.overlay.pattern)
      for (const sl of st.slices ?? []) {
        if (sl.kind === 'points') byId.set(dotsId(sl.color), { id: dotsId(sl.color), kind: 'dots', color: sl.color })
        if (sl.kind === 'tirets') byId.set(dashesId(sl.color), { id: dashesId(sl.color), kind: 'dashes', color: sl.color })
      }
    }
    return [...byId.values()]
  }, [styles])

  /** Remplissage d'une part : couleur, trame de points (gestion), traits pointillés (gestion-partiel) ou blanc. */
  const sliceFill = (sl: Stripe) =>
    sl.kind === 'points' ? `url(#${dotsId(sl.color)})` : sl.kind === 'tirets' ? `url(#${dashesId(sl.color)})` : sl.color
  const sliceOpacity = (sl: Stripe) => (sl.kind === 'plein' ? sl.opacity : 1)

  /** Mode découpage : une bande verticale par part, découpée à la forme de la zone. */
  const bandsFor = (s: Shape, key: string) => {
    const st = styles.get(s.code)
    if (sharedMode !== 'decoupage' || !st?.slices) return null
    const { x0, y0, x1, y1 } = s.bounds
    const w = (x1 - x0) / st.slices.length
    const clipId = 'clip-' + key
    return (
      <g pointerEvents="none" opacity={st.fillOpacity}>
        <clipPath id={clipId}>
          <path d={s.d} />
        </clipPath>
        {st.slices.map((sl, i) => (
          <rect key={i} x={x0 + i * w} y={y0} width={w + 0.01} height={y1 - y0} fill={sliceFill(sl)} fillOpacity={sliceOpacity(sl)} clipPath={`url(#${clipId})`} />
        ))}
      </g>
    )
  }

  const setSvg = (el: SVGSVGElement | null) => {
    innerSvg.current = el
    onSvg(el)
  }

  const pointer = (code: string) => ({
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = containerRef.current!.getBoundingClientRect()
      onHover(code, { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height })
    },
    onPointerLeave: () => onHover(null),
    onPointerDown: (e: React.PointerEvent) => {
      stroke.current.skipClick = false
      if (!canPaint || e.pointerType === 'touch' || e.button !== 0) return
      stroke.current.down = true
      paintAt(code)
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (stroke.current.down && e.buttons & 1) paintAt(code)
    },
    onClick: () => {
      if (stroke.current.skipClick) stroke.current.skipClick = false
      else onSelect(code)
    },
  })

  // Groupes à recruter : chaque groupe visible, avec ses zones et leur emprise
  const uid = useId().replace(/:/g, '')
  const groups = useMemo(() => {
    if (!layout) return []
    return (model.groups ?? []).flatMap((g) => {
      const shapes = layout.shapes.filter((s) => g.codes.includes(s.code) || (isParisArr(s.code) && g.codes.includes('75')))
      if (!shapes.length) return []
      const { x, y, w, h } = layout.main
      const x0 = Math.max(x, Math.min(...shapes.map((s) => s.bounds.x0)))
      const y0 = Math.max(y, Math.min(...shapes.map((s) => s.bounds.y0)))
      const box = { x0, y0, w: Math.min(x + w, Math.max(...shapes.map((s) => s.bounds.x1))) - x0, h: Math.min(y + h, Math.max(...shapes.map((s) => s.bounds.y1))) - y0 }
      return box.w > 0 && box.h > 0 ? [{ ...g, shapes, box }] : []
    })
  }, [layout, model])
  // Le nom de chaque groupe, à la meilleure place pour ce niveau de zoom ; absent s'il n'y tient pas
  const groupNames = useMemo(() => {
    if (!layout || !groups.length) return []
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    const codes = showLabels ? layout.shapes.filter(fits) : []
    return groups.flatMap((g) => {
      const { x0, y0 } = g.box
      const s = Math.min(6, 150 / Math.max(g.box.w, g.box.h))
      const w = Math.max(1, Math.ceil(g.box.w * s))
      const h = Math.max(1, Math.ceil(g.box.h * s))
      ctx.canvas.width = w
      ctx.canvas.height = h
      const bits = (draw: () => void) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, w, h)
        ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s)
        draw()
        const { data } = ctx.getImageData(0, 0, w, h)
        return Array.from({ length: w * h }, (_, i) => data[i * 4 + 3] > 127)
      }
      const inside = bits(() => g.shapes.forEach((shape) => ctx.fill(new Path2D(shape.d))))
      const up = (labelSize * 0.55) / scale
      const taken = bits(() => {
        for (const c of codes) {
          const half = (c.label.length * labelSize * 0.34 + 1) / scale
          ctx.fillRect(c.anchor!.x - half, c.anchor!.y - up, half * 2, up * 2)
        }
      })
      // Un numéro de deux chiffres, en points de l'image
      const mark = ((2 * labelSize * 0.34 + 1) / scale) * 2 * s * (up * 2 * s)
      const spot = placeName(rasterOf(inside, taken, w, h, mark), g.label, GROUP_FONTS, s / scale)
      return spot ? [{ key: g.key, color: g.color, lines: spot.lines, font: spot.font, x: x0 + spot.x / s, y: y0 + spot.y / s }] : []
    })
    // `fits` ne dépend que de l'échelle et de la taille des numéros
  }, [layout, groups, scale, showLabels, labelSize])
  const groupDim = (key: string) => (highlighted.size && !highlighted.has(key) ? 0.2 : 1)

  // Zones partagées en camemberts : rayon en pixels écran, selon la place disponible dans la zone
  const pieRadius = (s: Shape) => (s.anchor ? clamp(s.anchor.room * 0.7, 6, 11) : 0)
  const hasPie = (s: Shape) =>
    sharedMode === 'camemberts' && Boolean(styles.get(s.code)?.slices) && s.anchor !== null && s.anchor.room >= 6

  const pieFor = (s: Shape, k: number) => {
    if (!hasPie(s)) return null
    const slices = styles.get(s.code)!.slices!
    const r = pieRadius(s) / k
    const { x, y } = s.anchor!
    const step = (2 * Math.PI) / slices.length
    return (
      <g key={'pie-' + s.code} pointerEvents="none">
        <circle cx={x} cy={y} r={r + 1.6 / k} fill="#ffffff" />
        {slices.map((sl, i) => {
          const a0 = -Math.PI / 2 + i * step
          const a1 = a0 + step
          const large = step > Math.PI ? 1 : 0
          const [x0, y0] = [x + r * Math.cos(a0), y + r * Math.sin(a0)]
          const [x1, y1] = [x + r * Math.cos(a1), y + r * Math.sin(a1)]
          return (
            <path
              key={i}
              d={`M${x},${y}L${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}Z`}
              fill={sliceFill(sl)}
              fillOpacity={sl.kind === 'plein' ? Math.max(sl.opacity, 0.35) : 1}
              stroke="#ffffff"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </g>
    )
  }

  const isSelected = (code: string) => selected === code || (selected === '75' && isParisArr(code))

  /** Commercial (ou manager) principal d'une zone partagée : la couverture la plus forte. */
  const dominant = (slices: Stripe[]) => slices.reduce((best, sl) => (sl.rank > best.rank ? sl : best), slices[0])
  /** Un partiel seul (part blanche) n'a pas de « principal » : il reste rayé, quel que soit l'affichage. */
  const hasBlank = (slices: Stripe[] | null | undefined) => Boolean(slices?.some((sl) => sl.kind === 'blanc'))

  /** Style effectif d'une zone selon l'affichage choisi pour les zones partagées. */
  const effectiveStyle = (code: string, shape?: Shape): ZoneStyle => {
    const base = styles.get(code)!
    if (!base.slices) return base
    const dim = base.fillOpacity // < 1 quand la zone est estompée (mise en évidence d'un autre commercial)
    // Découpage : les bandes sont dessinées sous la zone (bandsFor), qui ne garde que son contour et ses événements
    if (sharedMode === 'decoupage' && shape) return { ...base, fill: 'transparent', fillOpacity: 1 }
    if (sharedMode === 'dominante' && !hasBlank(base.slices)) {
      const top = dominant(base.slices)
      return { ...base, fill: sliceFill(top), fillOpacity: sliceOpacity(top) * dim }
    }
    // Camemberts : la zone reste claire, le camembert porte les couleurs
    if (shape && hasPie(shape)) return { ...base, fill: mixColors(base.slices.map((sl) => sl.color)), fillOpacity: dim * 0.3 }
    return base
  }

  // Mode dominante : badge « +2 » (autres commerciaux de la zone)
  const hasBadge = (s: Shape) =>
    sharedMode === 'dominante' &&
    Boolean(styles.get(s.code)?.slices) &&
    !hasBlank(styles.get(s.code)?.slices) &&
    s.anchor !== null &&
    s.anchor.room >= 6
  const badgeFor = (s: Shape, k: number) => {
    if (!hasBadge(s)) return null
    const others = styles.get(s.code)!.slices!.length - 1
    const { x, y } = s.anchor!
    const dy = showLabels && fits(s) ? (labelSize * 0.95) / k : 0
    const h = 13 / k
    const w = (others > 9 ? 26 : 20) / k
    return (
      <g key={'badge-' + s.code} pointerEvents="none">
        <rect x={x - w / 2} y={y + dy - h / 2} width={w} height={h} rx={h / 2} fill="#1a428a" stroke="#ffffff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <text x={x} y={y + dy} fontSize={9 / k} fill="#ffffff" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'Montserrat, system-ui, sans-serif', fontWeight: 700 }}>
          +{others}
        </text>
      </g>
    )
  }

  const zonePath = (code: string, d: string, key?: string, shape?: Shape) => {
    const st = effectiveStyle(code, shape)
    return (
      <Fragment key={key ?? code}>
        <path
          data-code={code}
          className="zone"
          d={d}
          fill={st.fill}
          fillOpacity={st.fillOpacity}
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          aria-label={ZONE_BY_CODE.get(code)?.nom ?? code}
          {...pointer(code)}
        />
        {/* Occupé mais à recruter : les hachures par-dessus (D-016) */}
        {st.overlay && <path d={d} fill={`url(#${st.overlay.pattern.id})`} fillOpacity={st.overlay.opacity} stroke="none" pointerEvents="none" />}
      </Fragment>
    )
  }

  const k = scale

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      {layout && size && (
        <svg
          ref={setSvg}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          role="img"
          aria-label="Carte des secteurs commerciaux"
          onContextMenu={canPaint ? (e) => e.preventDefault() : undefined}
        >
          <defs>
            {patterns.map((p) => {
              if (p.kind === 'dots') {
                return (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={6} height={6}>
                    <rect width={6} height={6} fill="#ffffff" />
                    <rect width={6} height={6} fill={p.color} fillOpacity={0.16} />
                    <circle cx={3} cy={3} r={1.35} fill={p.color} />
                  </pattern>
                )
              }
              if (p.kind === 'hatch') {
                // À recruter : hachures fines, inclinées à l'inverse des rayures des zones partagées
                return (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(-45)">
                    <rect width={5} height={5} fill="#ffffff" />
                    <rect width={5} height={5} fill={p.color} fillOpacity={0.14} />
                    <line x1={2.5} y1={0} x2={2.5} y2={5} stroke={p.color} strokeWidth={1.4} />
                  </pattern>
                )
              }
              if (p.kind === 'overlay') {
                // À recruter là où quelqu'un est déjà : les mêmes hachures, sans fond, bordées de blanc pour se
                // lire sur toutes les couleurs
                return (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(-45)">
                    <line x1={3} y1={0} x2={3} y2={6} stroke="#ffffff" strokeOpacity={0.85} strokeWidth={2.6} />
                    <line x1={3} y1={0} x2={3} y2={6} stroke={p.color} strokeWidth={1.3} />
                  </pattern>
                )
              }
              if (p.kind === 'dashes') {
                // Gestion-partiel : traits en pointillés sur fond blanc, inclinés comme les rayures
                return (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={STRIPE * 2} height={STRIPE_H / 2} patternTransform="rotate(45)">
                    <rect width={STRIPE * 2} height={STRIPE_H / 2} fill="#ffffff" />
                    <line x1={STRIPE / 2} y1={0} x2={STRIPE / 2} y2={STRIPE_H / 2} stroke={p.color} strokeWidth={1.8} strokeDasharray="3.5 2.5" />
                  </pattern>
                )
              }
              const total = STRIPE * p.stripes.length
              return (
                <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={total} height={STRIPE_H} patternTransform="rotate(45)">
                  <rect width={total} height={STRIPE_H} fill="#ffffff" />
                  {p.stripes.map((sl, i) => (
                    <Band key={i} slice={sl} x={i * STRIPE} />
                  ))}
                </pattern>
              )
            })}
            <clipPath id="main-clip">
              <rect x={layout.main.x} y={layout.main.y} width={layout.main.w} height={layout.main.h} />
            </clipPath>
          </defs>

          <rect width={size.w} height={size.h} fill="#f4f8fb" onClick={onBackground} />

          <g clipPath="url(#main-clip)">
            <rect x={layout.main.x} y={layout.main.y} width={layout.main.w} height={layout.main.h} fill="transparent" onClick={onBackground} />
            <g ref={layerRef}>
              {layout.shapes.map((s) => (
                <Fragment key={s.code}>
                  {bandsFor(s, s.code)}
                  {zonePath(s.code, s.d, undefined, s)}
                </Fragment>
              ))}

              {/* Contour de chaque groupe à recruter : le trait de ses zones, masqué à l'intérieur du groupe */}
              {groups.map((g, i) => (
                <g key={g.key} pointerEvents="none" opacity={groupDim(g.key)}>
                  <mask id={`${uid}-g${i}`} maskUnits="userSpaceOnUse" x={layout.main.x} y={layout.main.y} width={layout.main.w} height={layout.main.h}>
                    <rect x={layout.main.x} y={layout.main.y} width={layout.main.w} height={layout.main.h} fill="#fff" />
                    {g.shapes.map((s) => (
                      <path key={s.code} d={s.d} fill="#000" stroke="#000" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                    ))}
                  </mask>
                  <g mask={`url(#${uid}-g${i})`}>
                    {g.shapes.map((s) => (
                      <path key={s.code} d={s.d} fill="none" stroke={g.color} strokeWidth={4.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                </g>
              ))}

              {/* Contour de la zone sélectionnée, dessiné au-dessus des voisines */}
              {layout.shapes.filter((s) => isSelected(s.code)).map((s) => (
                <path key={'sel-' + s.code} d={s.d} fill="none" stroke="#111" strokeWidth={2.4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              ))}

              {layout.shapes.map((s) => pieFor(s, k))}

              {layout.marker && (
                <circle
                  className="marker zone"
                  cx={layout.marker.x}
                  cy={layout.marker.y}
                  r={5 / k}
                  fill={styles.get(MONACO_CODE) ? effectiveStyle(MONACO_CODE).fill : '#ccc'}
                  fillOpacity={Math.max(styles.get(MONACO_CODE) ? effectiveStyle(MONACO_CODE).fillOpacity : 1, 0.6)}
                  stroke="#1b2232"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                  aria-label="Monaco (98)"
                  {...pointer(MONACO_CODE)}
                />
              )}

              {showLabels && (
                <g className="labels" fontSize={labelSize / k} textAnchor="middle" dominantBaseline="central">
                  {layout.shapes.filter(fits).map((s) => {
                    const c = labelColors(effectiveStyle(s.code, s))
                    return (
                      <text
                        key={s.code}
                        className="zone-label"
                        x={s.anchor!.x}
                        y={s.anchor!.y + (hasPie(s) ? (pieRadius(s) + labelSize * 0.8) / k : 0)}
                        fill={c.text}
                        stroke={c.halo}
                        strokeWidth={2.5}
                        style={{ paintOrder: 'stroke', fontFamily: 'Montserrat, system-ui, sans-serif', fontWeight: 600 }}
                        vectorEffect="non-scaling-stroke"
                      >
                        {s.label}
                      </text>
                    )
                  })}
                </g>
              )}

              {layout.shapes.map((s) => badgeFor(s, k))}

              {/* Nom des groupes, sur une ou deux lignes */}
              <g className="group-labels" fontSize={GROUP_LABEL / k} textAnchor="middle" dominantBaseline="central">
                {groupNames.map((g) => (
                  <text
                    key={g.key}
                    x={g.x}
                    y={g.y}
                    fontSize={`${g.font / GROUP_LABEL}em`}
                    fill={shade(g.color, 0.3)}
                    stroke="rgba(255,255,255,0.92)"
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    opacity={groupDim(g.key)}
                    pointerEvents="none"
                    style={{ paintOrder: 'stroke', fontFamily: 'Montserrat, system-ui, sans-serif', fontWeight: 700 }}
                  >
                    {/* vector-effect ne s'hérite pas : sans lui sur chaque ligne, le halo grossirait au zoom */}
                    {g.lines.map((line, i) => (
                      <tspan key={i} vectorEffect="non-scaling-stroke" x={g.x} dy={i === 0 ? `${-(g.lines.length - 1) * 0.575}em` : '1.15em'}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                ))}
              </g>
            </g>
          </g>

          {layout.insets.map((inset) => (
            <g key={inset.code} className="inset">
              <rect x={inset.x} y={inset.y} width={inset.w} height={inset.h} rx={8} fill="#ffffff" stroke="#dce6ef" onClick={onBackground} />
              <text x={inset.x + 7} y={inset.y + 12} fontSize={10} fill="#5b6475" style={{ fontFamily: 'Montserrat, system-ui, sans-serif', fontWeight: 600 }}>
                {inset.title}
              </text>
              {bandsFor(inset.shape, `inset-${inset.code}`)}
              {zonePath(inset.code, inset.shape.d, `inset-${inset.code}`, inset.shape)}
              {pieFor(inset.shape, 1)}
              {isSelected(inset.code) && <path d={inset.shape.d} fill="none" stroke="#111" strokeWidth={2.4} pointerEvents="none" />}
            </g>
          ))}
        </svg>
      )}

      <div className="map-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoomer" title="Zoomer">
          <Icon name="plus" size={18} />
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Dézoomer" title="Dézoomer">
          <Icon name="minus" size={18} />
        </button>
        <button type="button" onClick={resetZoom} aria-label="Recentrer la carte" title="Recentrer">
          <Icon name="recenter" size={18} />
        </button>
      </div>
    </div>
  )
}
