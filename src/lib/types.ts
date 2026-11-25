import type { StructureDef } from './structures'

/** Code d'une structure (MD, SP…) ; la liste est gérée dans l'admin (voir structures.ts). */
export type Structure = string

export const COUVERTURES = ['propre', 'partiel', 'gestion', 'gestion_partiel'] as const
export type Couverture = (typeof COUVERTURES)[number]

export const COUVERTURE_LABELS: Record<Couverture, string> = {
  propre: 'Propre',
  partiel: 'Partiel',
  gestion: 'Gestion',
  gestion_partiel: 'Gestion-partiel',
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
  /** Coordonnées, visibles avec le code d'accès. */
  telephone?: string | null
  email?: string | null
  // Champs réservés aux admins
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
  /** Coordonnées, visibles avec le code d'accès. */
  telephone?: string | null
  email?: string | null
  /** Structures qu'il gère (reçues des admins seulement). */
  structures?: Structure[]
  /** Sa propre fiche de commercial, s'il en a une (D-013). */
  commercial_id?: string | null
  /** Compte GD One qui lui ouvre « Mon équipe » (reçu des admins seulement). */
  compte?: string | null
}

export interface DisplaySettings {
  default_shared_mode: 'rayures' | 'decoupage' | 'camemberts' | 'dominante'
  /** Manager 1 et Manager 2, pour toute la carte ; il en reste toujours un. */
  manager1_actif: boolean
  manager2_actif: boolean
}

export type Priorite = 1 | 2 | 3

/** Priorité ou secteur d'un département vide (sans ligne : à recruter, sans priorité). */
export interface ARecruter {
  structure: Structure
  zone_code: string
  priorite: Priorite | null
  secteur: string | null
}

export interface MapData {
  admin: boolean
  /** CA et objectifs présents : un admin, ou un manager (toutes les équipes). */
  chiffres: boolean
  /** Le manager connecté et les structures qu'il gère ; null pour tout autre. */
  manager: { nom: string; structures: Structure[] } | null
  /** Réglages d'affichage choisis par les admins. */
  settings?: DisplaySettings
  /** Structures dans l'ordre choisi par les admins. */
  structures: StructureDef[]
  commerciaux: Commercial[]
  managers: Manager[]
  affectations: Affectation[]
  objectifs: Objectif[]
  a_recruter: ARecruter[]
  updated_at: string | null
}

/** Affectation sans identifiant, telle que saisie ou importée. */
export interface ZoneAssignment {
  structure: Structure
  zone_code: string
  couverture: Couverture
}

/** Données envoyées à save_commercial. */
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
  telephone?: string | null
  email?: string | null
  affectations?: ZoneAssignment[]
  objectifs?: Omit<Objectif, 'commercial_id'>[]
}

/** Une ligne du journal : un changement, avant et après. `lot` réunit celles d'un même enregistrement. */
export interface JournalLine {
  id: number
  le: string
  lot: number
  auteur: string | null
  auteur_nom: string | null
  objet: 'commercial' | 'zone' | 'chiffres' | 'manager' | 'structure' | 'recrutement' | 'acces' | 'reglage'
  action: 'ajout' | 'modification' | 'retrait'
  commercial_id: string | null
  nom: string | null
  structure: string | null
  zone_code: string | null
  annee: number | null
  avant: Record<string, unknown> | null
  apres: Record<string, unknown> | null
}
