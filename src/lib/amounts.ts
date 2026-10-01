// Montants saisis à la main (CA, objectifs) : raccourcis « 120k », « 1,2M », espaces et « € » acceptés.

const grouped = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/**
 * « 120k », « 120 k€ », « 1,2M », « 120 000 », « 120.000 », « 0,5 » → nombre ; '' → null ; illisible → NaN.
 * k = milliers, M = millions ; la virgule (ou un point isolé) marque les décimales.
 */
export function parseAmountInput(raw: string | null | undefined): number | null {
  let t = String(raw ?? '')
    .replace(/[\s  €]/g, '')
    .toLowerCase()
  if (!t) return null
  let factor = 1
  const unit = /(k|m)$/.exec(t)
  if (unit) {
    factor = unit[1] === 'k' ? 1e3 : 1e6
    t = t.slice(0, -1)
  }
  // « 120.000 » ou « 1.200.000 » : points des milliers
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  t = t.replace(',', '.')
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN
  return Math.round(Number(t) * factor * 100) / 100
}

/** 120000 → « 120 000 » (espaces fines des milliers, comme à l'affichage). */
export const formatAmountInput = (n: number) => grouped.format(n)

/** Texte saisi remis en forme s'il est lisible (« 120k » → « 120 000 »), sinon laissé tel quel pour être corrigé. */
export function tidyAmountInput(raw: string): string {
  const n = parseAmountInput(raw)
  return n === null ? '' : Number.isNaN(n) ? raw : formatAmountInput(n)
}
