// Où poser le nom d'un groupe : à l'intérieur de ses zones, loin des numéros, près de son centre. Le calcul se
// fait sur une image réduite du groupe ; des tables de sommes donnent le contenu de n'importe quel rectangle
// en quatre lectures.

/** Image réduite d'un groupe : ses zones (`inside`) et les numéros déjà écrits (`taken`), en tables de sommes. */
export interface Raster {
  w: number
  h: number
  inside: Uint32Array
  taken: Uint32Array
  /** Points d'un numéro : `taken` se mesure en numéros cachés. */
  mark: number
  /** Centre de gravité des zones. */
  cx: number
  cy: number
}

/** Table de sommes : chaque case vaut le nombre de points pleins au-dessus et à gauche d'elle. */
export function summed(bits: ArrayLike<number | boolean>, w: number, h: number): Uint32Array {
  const out = new Uint32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += bits[y * w + x] ? 1 : 0
      out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1] + row
    }
  }
  return out
}

/** Points pleins d'un rectangle ; ce qui sort de l'image compte comme vide. */
export function countIn(table: Uint32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)))
  const [ax, bx, ay, by] = [clamp(x0, w), clamp(x1, w), clamp(y0, h), clamp(y1, h)]
  const at = (x: number, y: number) => table[y * (w + 1) + x]
  return at(bx, by) - at(ax, by) - at(bx, ay) + at(ax, ay)
}

export function rasterOf(inside: ArrayLike<number | boolean>, taken: ArrayLike<number | boolean>, w: number, h: number, mark: number): Raster {
  let n = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside[y * w + x]) continue
      n++
      sx += x
      sy += y
    }
  }
  return { w, h, inside: summed(inside, w, h), taken: summed(taken, w, h), mark: Math.max(1, mark), cx: n ? sx / n : w / 2, cy: n ? sy / n : h / 2 }
}

export interface Spot {
  x: number
  y: number
  /** Part du texte à l'intérieur du groupe ; numéros qu'il cache (0,5 : la moitié d'un numéro). */
  inside: number
  taken: number
  score: number
}

/** En dessous, le nom déborde trop ; au-dessus, il mord sur un numéro : il attend qu'on zoome. */
export const MIN_INSIDE = 0.8
export const MAX_TAKEN = 0.15

/** Meilleure place pour un texte de `bw` × `bh`, ou null s'il n'en trouve aucune. */
export function bestSpot(r: Raster, bw: number, bh: number): Spot | null {
  const area = bw * bh
  const diagonal = Math.hypot(r.w, r.h) || 1
  const step = Math.max(1, Math.round(Math.min(r.w, r.h) / 70))
  let best: Spot | null = null
  for (let y = 0; y <= r.h; y += step) {
    for (let x = 0; x <= r.w; x += step) {
      const box = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2] as const
      const inside = countIn(r.inside, r.w, r.h, ...box) / area
      // Aucune chance de faire mieux : on ne regarde pas le reste
      if (best && inside < best.score) continue
      if (inside < MIN_INSIDE) continue
      const taken = countIn(r.taken, r.w, r.h, ...box) / r.mark
      if (taken > MAX_TAKEN) continue
      const score = inside - 1.5 * taken - 0.15 * (Math.hypot(x - r.cx, y - r.cy) / diagonal)
      if (!best || score > best.score) best = { x, y, inside: Math.min(1, inside), taken, score }
    }
  }
  return best
}

/** Façons d'écrire un nom : sur une ligne, ou sur deux en le coupant au plus équilibré. */
export function lineBreaks(name: string): string[][] {
  const words = name.trim().split(/\s+/)
  const out = [[words.join(' ')]]
  if (words.length < 2) return out
  const cuts = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')])
  const widest = (lines: string[]) => Math.max(...lines.map((l) => l.length))
  return [...out, cuts.sort((a, b) => widest(a) - widest(b))[0]]
}

export interface Placement extends Spot {
  lines: string[]
  font: number
}

/**
 * La meilleure façon d'écrire un nom et sa place (`px` : points de l'image par pixel écran), ou null. Les
 * tailles de police sont essayées dans l'ordre : la première qui trouve une place est gardée.
 */
export function placeName(r: Raster, name: string, fonts: readonly number[], px: number): Placement | null {
  for (const font of fonts) {
    let best: Placement | null = null
    for (const lines of lineBreaks(name)) {
      const bw = (Math.max(...lines.map((l) => l.length)) * font * 0.6 + 4) * px
      const bh = (((lines.length - 1) * 1.15 + 0.95) * font + 2) * px
      const spot = bestSpot(r, bw, bh)
      // À place égale, une ligne se lit mieux que deux
      if (spot && (!best || spot.score > best.score + 0.04)) best = { ...spot, lines, font }
    }
    if (best) return best
  }
  return null
}
