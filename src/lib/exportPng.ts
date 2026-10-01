// Export PNG : la carte (SVG sérialisé) avec un titre et la légende, dessinés sur un canvas.

export interface ExportLegendItem {
  label: string
  color: string
  /** Titre du groupe (« À recruter ») : les éléments d'un groupe sont listés à part, sous ce titre. */
  group?: string
}

interface ExportOptions {
  title: string
  subtitle: string
  legend: ExportLegendItem[]
  filename: string
}

type LegendRow = { kind: 'item'; label: string; color: string } | { kind: 'title'; text: string } | { kind: 'gap' }

/** Lignes de la légende réparties en colonnes : un titre de groupe n'est jamais seul en bas d'une colonne. */
function legendRows(legend: ExportLegendItem[], perCol: number): LegendRow[] {
  const rows: LegendRow[] = []
  legend.forEach((item, i) => {
    if (item.group && item.group !== legend[i - 1]?.group) {
      if (rows.length % perCol !== 0) rows.push({ kind: 'gap' })
      if (rows.length % perCol === perCol - 1) rows.push({ kind: 'gap' })
      rows.push({ kind: 'title', text: item.group })
    }
    rows.push({ kind: 'item', label: item.label, color: item.color })
  })
  return rows
}

const FONT = 'Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

export async function exportMapPng(svg: SVGSVGElement, { title, subtitle, legend, filename }: ExportOptions) {
  const w = svg.width.baseVal.value
  const h = svg.height.baseVal.value

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.querySelectorAll('title').forEach((t) => t.remove())
  const xml = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  await img.decode()

  const header = 64
  const rowH = 20
  const colW = 230
  const perCol = Math.max(2, Math.floor((h - 16) / rowH))
  const rows = legendRows(legend, perCol)
  const cols = rows.length ? Math.ceil(rows.length / perCol) : 0
  const width = w + cols * colW + (cols ? 16 : 0)
  const height = header + h + 8

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#1b2232'
  ctx.font = `700 20px ${FONT}`
  ctx.fillText(title, 16, 30)
  ctx.fillStyle = '#667085'
  ctx.font = `13px ${FONT}`
  ctx.fillText(subtitle, 16, 50)

  ctx.drawImage(img, 0, header, w, h)

  rows.forEach((row, i) => {
    const x = w + 16 + Math.floor(i / perCol) * colW
    const y = header + 8 + (i % perCol) * rowH
    if (row.kind === 'gap') return
    if (row.kind === 'title') {
      ctx.font = `700 11px ${FONT}`
      ctx.fillStyle = '#1a428a'
      ctx.fillText(row.text.toUpperCase(), x, y + 13)
      ctx.fillStyle = '#f5a800'
      ctx.fillRect(x, y + 17, 22, 2)
      return
    }
    const item = row
    ctx.font = `12.5px ${FONT}`
    ctx.fillStyle = item.color
    ctx.fillRect(x, y, 13, 13)
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.strokeRect(x + 0.5, y + 0.5, 12, 12)
    ctx.fillStyle = '#1b2232'
    let label = item.label
    while (ctx.measureText(label).width > colW - 30 && label.length > 4) label = label.slice(0, -2)
    ctx.fillText(label === item.label ? label : label + '…', x + 20, y + 11)
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Export PNG impossible')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
