// Export PNG : la carte (SVG sérialisé) avec un titre et la légende, dessinés sur un canvas.

interface ExportOptions {
  title: string
  subtitle: string
  legend: { label: string; color: string }[]
  filename: string
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
  const perCol = Math.max(1, Math.floor((h - 16) / rowH))
  const cols = legend.length ? Math.ceil(legend.length / perCol) : 0
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

  ctx.font = `12.5px ${FONT}`
  legend.forEach((item, i) => {
    const x = w + 16 + Math.floor(i / perCol) * colW
    const y = header + 8 + (i % perCol) * rowH
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
