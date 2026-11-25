// Saisie des CA et objectifs d'un commercial, en texte, avant enregistrement.
import { formatAmountInput, parseAmountInput } from './amounts'
import type { Objectif, Structure } from './types'

/** CA et objectifs saisis, par année puis par structure (texte tel que tapé). */
export type ObjectifsDraft = Record<number, Partial<Record<Structure, { ca: string; objectif: string }>>>

const amountText = (n: number | null) => (n === null ? '' : formatAmountInput(Number(n)))

export function objectifsDraft(id: string, objectifs: Objectif[]): ObjectifsDraft {
  const out: ObjectifsDraft = {}
  for (const o of objectifs.filter((x) => x.commercial_id === id)) {
    out[o.annee] ??= {}
    out[o.annee][o.structure] = { ca: amountText(o.ca), objectif: amountText(o.objectif) }
  }
  return out
}

/** Toutes les lignes saisies : une ligne vidée (CA et objectif vides) est supprimée côté serveur. */
export const objectifsPayload = (draft: ObjectifsDraft) =>
  Object.entries(draft).flatMap(([annee, byStructure]) =>
    Object.entries(byStructure).map(([structure, v]) => ({
      structure,
      annee: Number(annee),
      ca: parseAmountInput(v!.ca),
      objectif: parseAmountInput(v!.objectif),
    })),
  )

/** Premier montant illisible, ou null. */
export function objectifsIssue(draft: ObjectifsDraft): string | null {
  for (const [annee, byStructure] of Object.entries(draft)) {
    for (const [s, v] of Object.entries(byStructure)) {
      if (Number.isNaN(parseAmountInput(v!.ca))) return `CA ${s} ${annee} : « ${v!.ca} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`
      if (Number.isNaN(parseAmountInput(v!.objectif))) return `Objectif ${s} ${annee} : « ${v!.objectif} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`
    }
  }
  return null
}
