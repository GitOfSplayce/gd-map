export const STRUCTURES = ['MD', 'SP', 'MC', 'BK'] as const
export type Structure = (typeof STRUCTURES)[number]

export const STRUCTURE_LABELS: Record<Structure, string> = {
  MD: 'Maison Davoise',
  SP: 'Splayce',
  MC: 'MaucoCartex',
  BK: 'BK Event',
}

export const COUVERTURES = ['propre', 'partiel', 'gestion'] as const
export type Couverture = (typeof COUVERTURES)[number]

export const COUVERTURE_LABELS: Record<Couverture, string> = {
  propre: 'Propre',
  partiel: 'Partiel',
  gestion: 'Gestion',
}

export interface Commercial {
  id: string
  nom: string
  statut: string | null
  manager1: string | null
  manager2: string | null
  couleur: string
  actif: boolean
  structures: Structure[]
  secteur: string | null
  ordre: number
  // Champs réservés aux admins (absents des données lues avec le code d'accès)
  notes?: string | null
  jours_an?: number | null
  date_manager1?: string | null
  date_manager2?: string | null
  actions?: string | null
  updated_at?: string
}

export interface Affectation {
  id: string
  commercial_id: string
  structure: Structure
  zone_code: string
  couverture: Couverture
}

export interface Objectif {
  commercial_id: string
  structure: Structure
  annee: number
  ca: number | null
  objectif: number | null
}

export interface Manager {
  nom: string
  /** null : couleur automatique. */
  couleur: string | null
}

export interface DisplaySettings {
  default_shared_mode: 'rayures' | 'decoupage' | 'camemberts' | 'dominante'
}

export interface MapData {
  admin: boolean
  /** Réglages d'affichage choisis par les admins. */
  settings?: DisplaySettings
  commerciaux: Commercial[]
  managers: Manager[]
  affectations: Affectation[]
  objectifs: Objectif[]
  updated_at: string | null
}

/** Affectation sans identifiant, telle que saisie ou importée. */
export interface ZoneAssignment {
  structure: Structure
  zone_code: string
  couverture: Couverture
}

/** Données envoyées à save_commercial / apply_import. */
export interface CommercialPayload {
  id?: string
  nom?: string
  statut?: string | null
  manager1?: string | null
  manager2?: string | null
  couleur?: string
  actif?: boolean
  notes?: string | null
  structures?: Structure[]
  jours_an?: number | null
  date_manager1?: string | null
  date_manager2?: string | null
  actions?: string | null
  secteur?: string | null
  ordre?: number
  affectations?: ZoneAssignment[]
  objectifs?: Omit<Objectif, 'commercial_id'>[]
}
