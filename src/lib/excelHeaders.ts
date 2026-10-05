// En-têtes du fichier Excel reconnus pour chaque champ d'un commercial (sans espaces ni accents, comme headerKey).
// Module léger : partagé par l'import (excel.ts) et par le contrôle des codes de structure (structures.ts).

export type BaseField =
  | 'nom' | 'statut' | 'jours_an' | 'manager1' | 'date_manager1' | 'manager2' | 'date_manager2'
  | 'actions' | 'secteur' | 'couleur' | 'actif' | 'notes' | 'telephone' | 'email'

export const BASE_ALIASES: Record<BaseField, string[]> = {
  nom: ['nom', 'nomducommercial', 'commercial'],
  statut: ['statut'],
  jours_an: ['nbdejouran', 'nbdejoursan', 'nbjoursan', 'joursan'],
  manager1: ['manager1'],
  date_manager1: ['date1'],
  manager2: ['manager2'],
  date_manager2: ['date2'],
  actions: ['actions', 'action'],
  secteur: ['region', 'secteur'],
  couleur: ['couleur'],
  actif: ['actif'],
  notes: ['notes', 'note'],
  telephone: ['telephone', 'tel', 'portable', 'mobile', 'gsm', 'numerodetelephone'],
  email: ['email', 'mail', 'courriel', 'adressemail', 'adresseemail'],
}
