// Le journal en clair : les changements d'un même enregistrement réunis, une phrase par changement.
import { formatEuros } from './zoneDetails'
import { prioriteLabel, sectorLabel } from './recrutement'
import { COUVERTURE_LABELS, type Couverture, type JournalLine, type Priorite } from './types'
import { ZONE_BY_CODE, isParisArr } from './zones'

export interface JournalEntry {
  key: string
  le: string
  auteur: string
  /** Ce qui a changé : un commercial, un manager, un réglage… */
  sujet: string
  changes: { text: string; kind: JournalLine['action'] }[]
}

const FIELD_LABELS: Record<string, string> = {
  nom: 'Nom', statut: 'Statut', manager1: 'Manager 1', manager2: 'Manager 2', couleur: 'Couleur', actif: 'Actif', notes: 'Notes',
  structures: 'Structures', jours_an: 'Jours par an', date_manager1: 'Date 1', date_manager2: 'Date 2', actions: 'Actions', secteur: 'Région',
  telephone: 'Téléphone', email: 'E-mail', compte: 'Compte GD One', code: 'Code', role: 'Rôle', priorite: 'Priorité', ca: 'CA', objectif: 'Objectif',
}

const REGLAGES: Record<string, string> = { default_shared_mode: 'Zones partagées par défaut', manager1_actif: 'Manager 1', manager2_actif: 'Manager 2' }

const show = (key: string, v: unknown): string => {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—'
  if (key === 'ca' || key === 'objectif') return formatEuros(Number(v))
  if (key === 'manager1_actif' || key === 'manager2_actif') return v ? 'activé' : 'désactivé'
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

const zoneName = (code: string | null) => {
  if (!code) return ''
  const nom = ZONE_BY_CODE.get(code)?.nom
  return isParisArr(code) ? `${nom} (${code})` : code === '75' ? 'Paris (75)' : nom ? `${nom} (${code})` : code
}
const couverture = (v: unknown) => COUVERTURE_LABELS[v as Couverture]?.toLowerCase() ?? String(v)

/** Une phrase par ligne du journal. */
export function describeLine(l: JournalLine): string[] {
  const avant = l.avant ?? {}
  const apres = l.apres ?? {}
  if (l.objet === 'zone') {
    const where = `${l.structure} · ${zoneName(l.zone_code)}`
    if (l.action === 'ajout') return [`${where} : ajouté en ${couverture(apres.couverture)}`]
    if (l.action === 'retrait') return [`${where} : retiré (était en ${couverture(avant.couverture)})`]
    return [`${where} : ${couverture(avant.couverture)} → ${couverture(apres.couverture)}`]
  }
  if (l.objet === 'recrutement') {
    const where = `${l.structure} · ${zoneName(l.zone_code)}`
    const text = (o: Record<string, unknown>) => [prioriteLabel((o.priorite as Priorite) ?? null), o.secteur && sectorLabel(String(o.secteur))].filter(Boolean).join(', ')
    if (l.action === 'ajout') return [`${where} : ${text(apres)}`]
    if (l.action === 'retrait') return [`${where} : plus de priorité ni de secteur (était ${text(avant)})`]
    return Object.keys(apres).map((k) => `${where}, ${k === 'secteur' ? 'secteur' : 'priorité'} : ${show(k, avant[k])} → ${show(k, apres[k])}`)
  }
  if (l.objet === 'chiffres') {
    const keys = [...new Set([...Object.keys(avant), ...Object.keys(apres)])]
    return keys.map((k) => `${FIELD_LABELS[k] ?? k} ${l.structure} ${l.annee} : ${show(k, avant[k])} → ${show(k, apres[k])}`)
  }
  if (l.objet === 'reglage') {
    if ('code' in apres) return ['Code d\'accès changé']
    return Object.keys(apres).map((k) => `${REGLAGES[k] ?? k} : ${k.endsWith('_actif') ? show(k, apres[k]) : `${show(k, avant[k])} → ${show(k, apres[k])}`}`)
  }
  const what = { commercial: 'Commercial', manager: 'Manager', structure: 'Structure', acces: 'Admin' }[l.objet]
  if (l.action === 'ajout') return [l.objet === 'acces' ? 'Nommé admin' : `${what} ajouté`.replace('Structure ajouté', 'Structure ajoutée')]
  if (l.action === 'retrait') {
    const zones = Array.isArray(avant.zones) ? avant.zones.length : 0
    const chiffres = Array.isArray(avant.chiffres) ? avant.chiffres.length : 0
    const suite = [zones && `${zones} zone${zones > 1 ? 's' : ''}`, chiffres && `${chiffres} ligne${chiffres > 1 ? 's' : ''} de chiffres`].filter(Boolean).join(' et ')
    return [(l.objet === 'acces' ? 'N\'est plus admin' : `${what} supprimé`.replace('Structure supprimé', 'Structure supprimée')) + (suite ? `, avec ${suite}` : '')]
  }
  return Object.keys(apres).map((k) => `${FIELD_LABELS[k] ?? k} : ${show(k, avant[k])} → ${show(k, apres[k])}`)
}

const SUJETS: Partial<Record<JournalLine['objet'], string>> = { recrutement: 'Départements à recruter', reglage: 'Réglages' }

/** Réunit les lignes d'un même enregistrement sur un même sujet (du plus récent au plus ancien). */
export function groupJournal(lines: JournalLine[]): JournalEntry[] {
  const groups = new Map<string, JournalEntry>()
  // L'identifiant croît dans l'ordre de l'enregistrement : à l'intérieur d'un groupe, on le remet dans cet ordre
  for (const l of [...lines].sort((a, b) => a.id - b.id)) {
    const sujet = SUJETS[l.objet] ?? (l.objet === 'structure' ? `Structure ${l.nom}` : l.objet === 'manager' ? `Manager ${l.nom}` : (l.nom ?? '—'))
    const key = `${l.lot}|${l.commercial_id ?? sujet}`
    const entry = groups.get(key) ?? { key, le: l.le, auteur: l.auteur_nom || l.auteur || 'Automatique', sujet, changes: [] }
    groups.set(key, entry)
    entry.changes.push(...describeLine(l).map((text) => ({ text, kind: l.action })))
  }
  return [...groups.values()].sort((a, b) => b.le.localeCompare(a.le))
}
