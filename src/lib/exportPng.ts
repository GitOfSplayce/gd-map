// Export PNG : la carte (SVG sérialisé) avec un titre et la légende, dessinés sur un canvas.
import { BRAND } from './colors'
import { layoutPage, wrapItems, type LegendEntry, type LegendSection, type Placed, type Segment, type Swatch, type ZoneToken } from './exportLegend'
import { COUVERTURE_OPACITY } from './mapModel'

interface ExportOptions {
  title: string
  subtitle: string
  legend: LegendSection[]
  filename: string
}

const FAMILY = 'Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const FONTS = {
  title: `700 22px ${FAMILY}`,
  subtitle: `400 13px ${FAMILY}`,
  section: `700 11.5px ${FAMILY}`,
  suite: `500 10.5px ${FAMILY}`,
  label: `600 12.5px ${FAMILY}`,
  detail: `400 11px ${FAMILY}`,
  zone: `500 11px ${FAMILY}`,
  strong: `700 11px ${FAMILY}`,
}
const INK = '#1b2232'
const MUTED = '#667085'
const LINE = '#dce6ef'

const PAD = 24
const HEADER = 78
/** Entre la carte et la légende, et entre deux colonnes. */
const GUTTER = 30
const SWATCH = 16
const TEXT_X = SWATCH + 10
/** Titre de section : texte, trait jaune, puis de l'air avant la première ligne. */
const SIZES = { title: 36, gap: 22 }
const LINES = { label: 16, detail: 15, zone: 15.5 }

export async function exportMapPng(svg: SVGSVGElement, { title, subtitle, legend, filename }: ExportOptions) {
  const w = svg.width.baseVal.value
  const h = svg.height.baseVal.value
  const layers = await mapLayers(svg)
  await document.fonts.load(FONTS.title).catch(() => undefined)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const colW = columnWidth(ctx, legend)
  const entries = legend.map((s) => s.entries.map((e) => measureEntry(ctx, e, colW)))
  const heights = entries.map((list) => list.map((e) => e.height))

  const { columns, xs, top, mapScale, width, height } = layoutPage({ w, h }, heights, { ...SIZES, pad: PAD, header: HEADER, gutter: GUTTER, column: colW })
  const [mapW, mapH] = [w * mapScale, h * mapScale]

  // Deux pixels par point, dans la limite des navigateurs mobiles (16 millions de pixels)
  const density = Math.min(2, Math.sqrt(16_000_000 / (width * height)))
  canvas.width = Math.round(width * density)
  canvas.height = Math.round(height * density)
  ctx.scale(density, density)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = INK
  ctx.font = FONTS.title
  ctx.fillText(title, PAD, 38)
  ctx.fillStyle = MUTED
  ctx.font = FONTS.subtitle
  ctx.fillText(subtitle, PAD, 60)

  ctx.save()
  roundedRect(ctx, PAD, HEADER, mapW, mapH, 12)
  ctx.clip()
  for (const layer of layers) ctx.drawImage(layer, PAD, HEADER, mapW, mapH)
  ctx.restore()
  roundedRect(ctx, PAD + 0.5, HEADER + 0.5, mapW - 1, mapH - 1, 12)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1
  ctx.stroke()

  columns.forEach((rows, c) => rows.forEach((row) => drawRow(ctx, row, xs[c], top + row.y, colW, legend, entries)))

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Export PNG impossible')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- Carte ----------

/** Codes des zones visibles à l'écran : la légende ne parle que d'elles (zoom, vues Île-de-France et Paris). */
export function visibleZones(svg: SVGSVGElement): Set<string> {
  const shown = new Set<string>()
  const frame = svg.getBoundingClientRect()
  const main = svg.querySelector<SVGRectElement>('#main-clip rect')
  for (const path of svg.querySelectorAll<SVGPathElement>('path[data-code]')) {
    const code = path.getAttribute('data-code')!
    // Les encarts sont toujours entiers ; le reste est coupé par le cadre de la carte
    if (!main || !path.closest('[clip-path]')) {
      shown.add(code)
      continue
    }
    const left = frame.left + main.x.baseVal.value
    const top = frame.top + main.y.baseVal.value
    const right = left + main.width.baseVal.value
    const bottom = top + main.height.baseVal.value
    const r = path.getBoundingClientRect()
    if (r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom) {
      shown.add(code)
      continue
    }
    if (r.right <= left || r.left >= right || r.bottom <= top || r.top >= bottom) continue
    // À cheval sur le cadre : un point de la zone au moins doit s'y trouver
    const toPath = path.getScreenCTM()?.inverse()
    if (!toPath) continue
    const [x0, x1, y0, y1] = [Math.max(left, r.left), Math.min(right, r.right), Math.max(top, r.top), Math.min(bottom, r.bottom)]
    const inside = (i: number) => {
      const at = new DOMPoint(x0 + (((i % 30) + 0.5) / 30) * (x1 - x0), y0 + ((Math.floor(i / 30) + 0.5) / 30) * (y1 - y0))
      return path.isPointInFill(at.matrixTransform(toPath))
    }
    if (Array.from({ length: 900 }, (_, i) => i).some(inside)) shown.add(code)
  }
  return shown
}

/**
 * La carte en deux images : les formes, puis les textes avec leur police (une image SVG ne voit pas celles de
 * la page). Ensemble, Chrome perd les masques, donc le contour des groupes, quand la police arrive.
 */
async function mapLayers(svg: SVGSVGElement): Promise<HTMLImageElement[]> {
  const shapes = svg.cloneNode(true) as SVGSVGElement
  shapes.querySelectorAll('title, text').forEach((el) => el.remove())

  const texts = svg.cloneNode(true) as SVGSVGElement
  texts.querySelectorAll('title, mask, [mask], pattern, path, circle, rect').forEach((el) => {
    if (!el.closest('clipPath')) el.remove()
  })
  const font = await fontData()
  if (font) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `@font-face{font-family:Montserrat;font-weight:100 900;src:url(${font}) format('woff2')}`
    texts.append(style)
  }
  const layers = await Promise.all([shapes, texts].map(toImage))
  if (font) {
    // Certains navigateurs ne chargent la police qu'au premier dessin : un dessin pour rien, puis un instant
    document.createElement('canvas').getContext('2d')?.drawImage(layers[1], 0, 0, 1, 1)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return layers
}

async function toImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
  await img.decode()
  return img
}

let fontCache: Promise<string | null> | null = null

function fontData(): Promise<string | null> {
  fontCache ??= (async () => {
    try {
      const res = await fetch(new URL('../assets/fonts/montserrat-latin-normal.woff2', import.meta.url))
      if (!res.ok) return null
      const blob = await res.blob()
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, 'data:font/woff2'))
        reader.onerror = () => reject(reader.error ?? new Error('Police illisible'))
        reader.readAsDataURL(blob)
      })
    } catch {
      // Sans elle, la carte garde la police du système
      fontCache = null
      return null
    }
  })()
  return fontCache
}

// ---------- Légende ----------

interface MeasuredEntry {
  label: string[]
  detail: string[]
  zones: ZoneToken[][]
  height: number
}

const widthOf = (ctx: CanvasRenderingContext2D, text: string, font: string) => {
  ctx.font = font
  return ctx.measureText(text).width
}

/** Largeur d'une colonne : celle du plus long nom, dans des bornes raisonnables. */
function columnWidth(ctx: CanvasRenderingContext2D, legend: LegendSection[]) {
  const entries = legend.flatMap((s) => s.entries)
  const widest = Math.max(
    0,
    ...entries.map((e) => TEXT_X + Math.max(widthOf(ctx, e.label, FONTS.label) + countWidth(ctx, e), e.detail ? widthOf(ctx, e.detail, FONTS.detail) : 0)),
  )
  const [min, max] = entries.some((e) => e.zones?.length) ? [270, 300] : [210, 290]
  return Math.ceil(Math.max(min, Math.min(max, widest)))
}

const countWidth = (ctx: CanvasRenderingContext2D, e: LegendEntry) => (e.count ? widthOf(ctx, e.count, FONTS.detail) + 14 : 0)

const segmentWidth = (ctx: CanvasRenderingContext2D, s: Segment) => widthOf(ctx, s.text, s.strong ? FONTS.strong : FONTS.zone)

function measureEntry(ctx: CanvasRenderingContext2D, e: LegendEntry, colW: number): MeasuredEntry {
  const words = (text: string, font: string, max: number) =>
    wrapItems(text.split(/\s+/), max, (word) => widthOf(ctx, word, font), widthOf(ctx, ' ', font)).map((line) => line.join(' '))
  const room = colW - TEXT_X
  const label = words(e.label, FONTS.label, room - countWidth(ctx, e))
  const detail = e.detail ? words(e.detail, FONTS.detail, room) : []
  // La virgule suit chaque département, sauf le dernier
  const zones = wrapItems(
    (e.zones ?? []).map((token, i, all) => (i < all.length - 1 ? [...token, { text: ',' }] : token)),
    room,
    (token) => token.reduce((sum, s) => sum + segmentWidth(ctx, s), 0),
    widthOf(ctx, ' ', FONTS.zone),
  )
  const height = label.length * LINES.label + detail.length * LINES.detail + zones.length * LINES.zone + (zones.length ? 11 : 8)
  return { label, detail, zones, height }
}

function drawRow(ctx: CanvasRenderingContext2D, row: Placed, x: number, y: number, colW: number, legend: LegendSection[], measured: MeasuredEntry[][]) {
  const section = legend[row.section]
  if (row.entry === null) {
    ctx.font = FONTS.section
    ctx.fillStyle = BRAND.saphir
    const text = section.title.toUpperCase()
    ctx.fillText(text, x, y + 11)
    if (row.suite) {
      const after = x + ctx.measureText(text).width + 6
      ctx.font = FONTS.suite
      ctx.fillStyle = MUTED
      ctx.fillText('(suite)', after, y + 11)
    }
    ctx.fillStyle = BRAND.jaune
    ctx.fillRect(x, y + 18, 24, 2)
    return
  }
  const entry = section.entries[row.entry]
  const m = measured[row.section][row.entry]
  drawSwatch(ctx, entry.swatch, x, y)

  const left = x + TEXT_X
  let line = y + 12.5
  ctx.font = FONTS.label
  ctx.fillStyle = INK
  for (const text of m.label) {
    ctx.fillText(text, left, line)
    line += LINES.label
  }
  if (entry.count) {
    ctx.font = FONTS.detail
    ctx.fillStyle = MUTED
    ctx.textAlign = 'right'
    ctx.fillText(entry.count, x + colW, y + 12.5)
    ctx.textAlign = 'left'
  }
  ctx.font = FONTS.detail
  ctx.fillStyle = MUTED
  for (const text of m.detail) {
    ctx.fillText(text, left, line)
    line += LINES.detail
  }
  for (const tokens of m.zones) {
    let at = left
    tokens.forEach((token, i) => {
      if (i) at += widthOf(ctx, ' ', FONTS.zone)
      for (const s of token) {
        const width = segmentWidth(ctx, s)
        ctx.fillStyle = s.strong ? BRAND.saphir : '#3c4658'
        ctx.fillText(s.text, at, line)
        at += width
      }
    })
    line += LINES.zone
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Pastille dessinée comme sur la carte et dans la légende à l'écran (repère de 18 points). */
function drawSwatch(ctx: CanvasRenderingContext2D, swatch: Swatch, x: number, y: number) {
  const c = BRAND.saphir
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(SWATCH / 18, SWATCH / 18)
  ctx.save()
  roundedRect(ctx, 0, 0, 18, 18, 4.5)
  ctx.clip()
  const fill = (color: string, opacity = 1) => {
    ctx.globalAlpha = opacity
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 18, 18)
    ctx.globalAlpha = 1
  }
  const band = (offset: number, color: string, opacity = 1) => {
    ctx.globalAlpha = opacity
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(offset, 18)
    ctx.lineTo(offset + 18, 0)
    ctx.lineTo(offset + 22.5, 0)
    ctx.lineTo(offset + 4.5, 18)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  const line = (x0: number, y0: number, x1: number, y1: number, color: string, width: number, dash: number[] = []) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.setLineDash([])
  }
  const half = (color: string, from: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(9, 9)
    ctx.arc(9, 9, 5.5, from, from + Math.PI)
    ctx.fill()
  }
  fill('#ffffff')
  if (swatch.kind === 'couleur') fill(swatch.color)
  else if (swatch.kind === 'couverture') {
    if (swatch.couverture === 'propre') fill(c, COUVERTURE_OPACITY.propre)
    else if (swatch.couverture === 'partiel') for (const o of [-18, -9, 0, 9, 18]) band(o, c, COUVERTURE_OPACITY.partiel)
    else if (swatch.couverture === 'gestion_partiel') for (const o of [-13.5, -4.5, 4.5, 13.5]) line(o, 18, o + 18, 0, c, 1.6, [2.6, 1.9])
    else {
      fill(c, 0.16)
      ctx.fillStyle = c
      for (let dy = 2.25; dy < 18; dy += 4.5) {
        for (let dx = 2.25; dx < 18; dx += 4.5) {
          ctx.beginPath()
          ctx.arc(dx, dy, 1.05, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  } else if (swatch.kind === 'partage') {
    if (swatch.mode === 'rayures') [-18, -9, 0, 9, 18].forEach((o, i) => band(o, i % 2 ? BRAND.jaune : c))
    else if (swatch.mode === 'decoupage') {
      ;[c, BRAND.jaune, '#3f9b6b'].forEach((color, i) => {
        ctx.fillStyle = color
        ctx.fillRect(i * 6, 0, 6, 18)
      })
    } else if (swatch.mode === 'camemberts') {
      fill('#eef3fa')
      half(c, -Math.PI / 2)
      half(BRAND.jaune, Math.PI / 2)
    } else {
      fill(c, COUVERTURE_OPACITY.propre)
      ctx.fillStyle = '#ffffff'
      roundedRect(ctx, 7, 9.5, 10, 7, 3.5)
      ctx.fill()
      ctx.fillStyle = c
      ctx.font = `700 5.6px ${FAMILY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+2', 12, 13.2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
  } else if (swatch.color) {
    fill(swatch.color, 0.14)
    for (const o of [-12, -6, 0, 6, 12]) line(o, 0, o + 18, 18, swatch.color, 1.8)
  } else fill('#e9ecf1')
  ctx.restore()

  const outline = swatch.kind === 'recruter' ? swatch.outline : null
  const width = outline ? 2.6 : 1
  roundedRect(ctx, width / 2, width / 2, 18 - width, 18 - width, 4.5 - width / 2)
  ctx.strokeStyle = outline ?? (swatch.kind === 'recruter' && !swatch.color ? '#b4c0cf' : 'rgba(0,0,0,0.12)')
  ctx.lineWidth = width
  ctx.stroke()
  ctx.restore()
}
