import { describe, expect, it } from 'vitest'
import { describeLine, groupJournal } from './journal'
import type { JournalLine } from './types'

let id = 0
const line = (l: Partial<JournalLine>): JournalLine => ({
  id: ++id, le: '2026-11-25T10:00:00Z', lot: 1, auteur: 'a@exemple.fr', auteur_nom: 'Alex', objet: 'zone', action: 'ajout', commercial_id: null, nom: null, structure: null, zone_code: null, annee: null, avant: null, apres: null, ...l,
})

describe('journal en clair', () => {
  it('zones : ajoutée, changée de type, retirée', () => {
    expect(describeLine(line({ structure: 'MD', zone_code: '35', apres: { couverture: 'propre' } }))[0]).toMatch(/^MD · Ille-et-Vilaine \(35\) : ajouté en propre$/)
    expect(describeLine(line({ action: 'modification', structure: 'MD', zone_code: '75', avant: { couverture: 'partiel' }, apres: { couverture: 'gestion_partiel' } }))).toEqual(['MD · Paris (75) : partiel → gestion-partiel'])
    expect(describeLine(line({ action: 'retrait', structure: 'SP', zone_code: '35', avant: { couverture: 'gestion' } }))[0]).toMatch(/retiré \(était en gestion\)/)
  })

  it('chiffres, champs, réglages et retraits', () => {
    expect(describeLine(line({ objet: 'chiffres', action: 'modification', structure: 'MD', annee: 2026, avant: { ca: 10 }, apres: { ca: 1500 } }))[0].replace(/\s/g, ' ')).toBe('CA MD 2026 : 10 € → 1 500 €')
    expect(describeLine(line({ objet: 'chiffres', action: 'ajout', structure: 'MD', annee: 2026, apres: { objectif: 20 } }))[0].replace(/\s/g, ' ')).toBe('Objectif MD 2026 : — → 20 €')
    expect(describeLine(line({ objet: 'manager', action: 'modification', avant: { compte: null, structures: [] }, apres: { compte: 'x@exemple.fr', structures: ['MD', 'SP'] } }))).toEqual(['Compte GD One : — → x@exemple.fr', 'Structures : — → MD, SP'])
    expect(describeLine(line({ objet: 'reglage', action: 'modification', apres: { code: 'nouveau code d\'accès' } }))).toEqual(['Code d\'accès changé'])
    expect(describeLine(line({ objet: 'reglage', action: 'modification', avant: { manager1_actif: true }, apres: { manager1_actif: false } }))).toEqual(['Manager 1 : désactivé'])
    expect(describeLine(line({ objet: 'commercial', action: 'retrait', avant: { nom: 'X', zones: [1, 2], chiffres: [1] } }))).toEqual(['Commercial supprimé, avec 2 zones et 1 ligne de chiffres'])
    expect(describeLine(line({ objet: 'recrutement', action: 'ajout', structure: 'MD', zone_code: '18', apres: { priorite: 1, secteur: 'Centre' } }))[0]).toMatch(/Priorité 1, secteur Centre$/)
    expect(describeLine(line({ objet: 'recrutement', action: 'modification', structure: 'MD', zone_code: '18', avant: { secteur: 'Secteur Centre', priorite: null }, apres: { secteur: null, priorite: 1 } }))).toEqual(['MD · Cher (18), secteur : Secteur Centre → —', 'MD · Cher (18), priorité : — → 1'])
    expect(describeLine(line({ objet: 'acces', action: 'ajout', apres: { role: 'admin' } }))).toEqual(['Nommé admin'])
  })

  it('réunit un enregistrement par sujet, du plus récent au plus ancien', () => {
    const entries = groupJournal([
      line({ lot: 2, le: '2026-11-25T11:00:00Z', commercial_id: 'c1', nom: 'Léa', structure: 'MD', zone_code: '22', apres: { couverture: 'propre' } }),
      line({ lot: 2, le: '2026-11-25T11:00:00Z', commercial_id: 'c1', nom: 'Léa', objet: 'chiffres', structure: 'MD', annee: 2026, apres: { ca: 1 } }),
      line({ lot: 1, le: '2026-11-25T10:00:00Z', commercial_id: 'c2', nom: 'Max', objet: 'commercial', auteur_nom: null }),
      line({ lot: 1, le: '2026-11-25T10:00:00Z', objet: 'reglage', action: 'modification', auteur: null, auteur_nom: null, apres: { code: 'x' } }),
    ])
    expect(entries.map((e) => [e.sujet, e.auteur, e.changes.length])).toEqual([['Léa', 'Alex', 2], ['Max', 'a@exemple.fr', 1], ['Réglages', 'Automatique', 1]])
  })
})
