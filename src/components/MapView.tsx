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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import polylabel from 'polylabel'
import Icon from './Icon'
import type { GeoData } from '../hooks/useGeo'
import { blendWithWhite, readableTextColor } from '../lib/colors'
import type { MapModel, ZoneStyle } from '../lib/mapModel'
import { DROM_CODES, IDF_CODES, MONACO_CODE, ZONE_BY_CODE, isParisArr } from '../lib/zones'

export type MapViewMode = 'france' | 'idf' | 'paris'

type ZoneFeature = Feature<Polygon | MultiPolygon, { code: string; nom: string }>

interface Shape {
  code: string
  d: string
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
  return {
    code: f.properties.code,
    d: path(f as GeoPermissibleObjects) ?? '',
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
      return { ...b, code, title: `${nom} (${code})`, shape: toShape(feature, geoPath(ip), ip, null) }
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
  onSvg: (el: SVGSVGElement | null) => void
}

export default function MapView({ view, geo, model, highlighted, selected, showLabels, onHover, onSelect, onBackground, onSvg }: MapViewProps) {
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
        if (event.button) return false
        // Le zoom ne démarre que sur la carte principale, pas sur les encarts
        return !(event.target instanceof Element && event.target.closest('.inset'))
      })
      .on('zoom', (event) => {
        // Pendant le geste, on agit directement sur le DOM ; React reprend la main à la fin
        const t = event.transform
        layer.attr('transform', t.toString())
        layer.select('.labels').attr('font-size', labelSize / t.k)
        layer.selectAll('.marker').attr('r', 5 / t.k)
      })
      .on('end', (event) => setScale(event.transform.k))
    svg.call(z).on('dblclick.zoom', null)
    svg.call(z.transform, zoomIdentity)
    zoomRef.current = z
    return () => {
      svg.on('.zoom', null)
    }
  }, [layout, view, labelSize])

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

  const patterns = useMemo(() => {
    const byId = new Map<string, NonNullable<ZoneStyle['pattern']>>()
    for (const st of styles.values()) if (st.pattern) byId.set(st.pattern.id, st.pattern)
    return [...byId.values()]
  }, [styles])

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
    onClick: () => onSelect(code),
  })

  const outlinePath = (code: string, d: string, key: string) => {
    const outline = styles.get(code)?.outline
    if (!outline) return null
    return (
      <path
        key={key}
        d={d}
        fill="none"
        stroke={outline.color}
        strokeWidth={2.4}
        strokeDasharray="7 4"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    )
  }

  const isSelected = (code: string) => selected === code || (selected === '75' && isParisArr(code))

  const zonePath = (code: string, d: string, key?: string) => {
    const st = styles.get(code)!
    return (
      <path
        key={key ?? code}
        data-code={code}
        className="zone"
        d={d}
        fill={st.fill}
        fillOpacity={st.fillOpacity}
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        {...pointer(code)}
      >
        <title>{ZONE_BY_CODE.get(code)?.nom ?? code}</title>
      </path>
    )
  }

  const k = scale

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      {layout && size && (
        <svg ref={setSvg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label="Carte des secteurs commerciaux">
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
              const sw = 6
              const total = sw * p.stripes.length
              return (
                <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse" width={total} height={total} patternTransform="rotate(45)">
                  <rect width={total} height={total} fill="#ffffff" />
                  {p.stripes.map((s, i) => (
                    <rect key={i} x={i * sw} y={0} width={sw} height={total} fill={s.color} fillOpacity={s.opacity} />
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
              {layout.shapes.map((s) => zonePath(s.code, s.d))}

              {/* Contours « gestion » puis zone sélectionnée, dessinés au-dessus des voisines */}
              {layout.shapes.map((s) => outlinePath(s.code, s.d, 'out-' + s.code))}
              {layout.shapes.filter((s) => isSelected(s.code)).map((s) => (
                <path key={'sel-' + s.code} d={s.d} fill="none" stroke="#111" strokeWidth={2.4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              ))}

              {layout.marker && (
                <circle
                  className="marker zone"
                  cx={layout.marker.x}
                  cy={layout.marker.y}
                  r={5 / k}
                  fill={styles.get(MONACO_CODE)?.pattern ? `url(#${styles.get(MONACO_CODE)!.pattern!.id})` : (styles.get(MONACO_CODE)?.fill ?? '#ccc')}
                  fillOpacity={Math.max(styles.get(MONACO_CODE)?.fillOpacity ?? 1, 0.6)}
                  stroke="#1b2232"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                  {...pointer(MONACO_CODE)}
                >
                  <title>Monaco (98)</title>
                </circle>
              )}

              {showLabels && (
                <g className="labels" fontSize={labelSize / k} textAnchor="middle" dominantBaseline="central">
                  {layout.shapes.filter(fits).map((s) => {
                    const c = labelColors(styles.get(s.code))
                    return (
                      <text
                        key={s.code}
                        className="zone-label"
                        x={s.anchor!.x}
                        y={s.anchor!.y}
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
            </g>
          </g>

          {layout.insets.map((inset) => (
            <g key={inset.code} className="inset">
              <rect x={inset.x} y={inset.y} width={inset.w} height={inset.h} rx={8} fill="#ffffff" stroke="#dce6ef" onClick={onBackground} />
              <text x={inset.x + 7} y={inset.y + 12} fontSize={10} fill="#5b6475" style={{ fontFamily: 'Montserrat, system-ui, sans-serif', fontWeight: 600 }}>
                {inset.title}
              </text>
              {zonePath(inset.code, inset.shape.d, `inset-${inset.code}`)}
              {outlinePath(inset.code, inset.shape.d, `inset-out-${inset.code}`)}
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
