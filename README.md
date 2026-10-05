# Carte commerciale Groupe

Cartographie des secteurs commerciaux du groupe, par structure : **MD** (Maison Davoise), **SP** (Splayce), **MC** (MaucoCartex) et **BK** (BK Event) au départ ; les admins ajoutent les suivantes dans l'admin (onglet *Structures*).

- **Consultation** : protégée par un code d'accès. On envoie le lien et le code séparément.
- **Administration** (`/admin`, e-mail + mot de passe) : saisie des commerciaux et de leurs zones, managers, structures, import et export du fichier Excel, gestion du code, des admins et de l'affichage par défaut des zones partagées.

Stack : Vite + React + TypeScript, carte en D3 + SVG, Supabase (Postgres, Auth, RLS, Edge Function), SheetJS pour l'Excel dans le navigateur. Hébergement sur GitHub Pages, déployé par GitHub Actions.

---

## Démarrage rapide

```bash
npm install
npm run demo        # carte avec des données fictives, sans Supabase : http://localhost:5173 (n'importe quel code)
```

Avec Supabase :

```bash
cp .env.example .env.local   # puis renseigner l'URL et la publishable key
npm run dev
```

## Installer Supabase

Toutes les étapes sont dans **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** : création du projet, réglages d'authentification, CLI, migrations, premier admin.

En résumé, une fois la CLI liée :

```bash
npm run db:push            # tables, RLS, fonctions, liste des zones
npm run functions:deploy   # Edge Function admin-users (gestion des admins)
```

Puis, dans *SQL Editor*, déclarer le premier admin (compte créé au préalable dans *Authentication → Users*) :

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'ton.email@exemple.com';
```

Enfin, sur `/admin` : définir le code d'accès (*Paramètres*), puis importer le fichier Excel (*Import / export*).

## Déployer sur GitHub Pages

1. *Settings → Pages → Build and deployment → Source* : **GitHub Actions**.
2. *Settings → Secrets and variables → Actions*, onglet **Variables** (ou **Secrets**, les deux sont lus) :
   - `VITE_SUPABASE_URL` : `https://xxxx.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` : `sb_publishable_…` (ou la clé `anon`)
   - `BASE_PATH` (facultatif) : à mettre à `/` seulement avec un domaine personnalisé. Par défaut `/<nom-du-repo>/`.
3. Chaque push sur `main` lance les tests, construit le site et le publie (`.github/workflows/deploy.yml`).
4. Dans Supabase, *Authentication → URL Configuration* : ajouter `https://<user>.github.io/<repo>/` en Site URL et `https://<user>.github.io/<repo>/**` en Redirect URL.

Le dépôt peut être public : il ne contient **aucune donnée**. Les fichiers Excel sont exclus par `.gitignore`, sauf l'exemple fictif `exemples/exemple-import.xlsx`. Les deux variables ci-dessus sont publiques par nature : elles finissent dans le site, et la sécurité repose sur RLS et les fonctions SQL.

Le workflow `keepalive.yml` appelle la base deux fois par jour pour éviter la mise en pause des projets Free (Supabase demande quelques requêtes par jour sur la semaine). GitHub désactive les workflows planifiés d'un dépôt public sans commit depuis 60 jours : le workflow se réactive lui-même à chaque passage pour l'éviter. Avec le plan Pro de Supabase, il devient inutile.

## Utilisation

### Carte

- Onglets **Globale** puis un par structure (MD, SP, MC, BK…, dans l'ordre choisi dans l'admin) ; vues **France** (Corse, DROM et Monaco en encarts), **Île-de-France**, **Paris** par arrondissement.
- Couleur par **commercial**, **Manager 1** ou **Manager 2**. Couleurs des commerciaux attribuées automatiquement, modifiables dans l'admin.
- **Propre** = plein, **Partiel** = atténué, **Gestion** = trame de points. Zone partagée, au choix dans la légende : **Rayures** aux couleurs de chacun, **Découpage** (une bande verticale par commercial), **Camemberts** (teinte légère et petit camembert) ou **Dominante** (couleur du principal et badge « +N »). Le mode proposé par défaut se règle dans l'admin (*Paramètres → Affichage de la carte*) ; Rayures au départ.
- **CA et objectifs** (admins connectés uniquement) : saisie par structure et par année dans le panneau d'un commercial (raccourcis `120k`, `1,2M`) ou par l'Excel ; sur la carte, sélecteur d'année, CA et taux d'atteinte dans la légende, vue **Performance** (zones du rouge au vert selon le taux d'atteinte de leurs commerciaux) ; onglet **Synthèse** de l'admin (par commercial, manager ou structure, export Excel).
- Vue **Couverture** (dans « Couleur ») : carte de chaleur du niveau de couverture par zone (propre = 1, partiel = ½, gestion = ¼, additionnés sur les commerciaux), du gris (non couverte) au bleu saphir.
- « 75 » seul couvre les 20 arrondissements ; en vue France, le département 75 réunit tout ce qui est saisi sur Paris.
- Survol : zone et commerciaux (structure, couverture, managers, CA/objectif s'ils sont saisis). Clic : panneau de détail, avec le téléphone et l'e-mail du commercial et de ses managers (liens d'appel et d'envoi).
- Filtres (manager, commercial, couverture, statut, « masquer les À recruter »), légende cliquable, export PNG.
- L'adresse garde l'onglet, la vue, le mode de couleur et l'affichage des zones partagées (`?onglet=MD&vue=paris&couleur=couverture&partage=camemberts`).
- Charte graphique GDCom 2023 : couleurs, Montserrat (auto-hébergée), logotype officiel.

### Format Excel

Onglet `V3` par défaut, en-têtes en ligne 3. Les colonnes sont **repérées par le nom de l'en-tête**, pas par leur position :

| Colonne | Contenu |
|---|---|
| `Nom` | nom du commercial (vide = ligne ignorée) |
| une colonne par structure : `MD`, `SP`, `MC`, `BK`… | « X » = appartient à la structure |
| `Statut`, `Manager 1`, `Manager 2` | texte |
| `DPT MD`, `DPT SP`… (une par structure) | liste de zones |
| `CA MD`, `Objectif MD`… (par structure) | nombres, facultatifs (année choisie à l'import) |
| `Nb de jour / an`, `Date 1`, `Date 2`, `Actions`, `Région` | facultatifs, conservés pour l'export |
| `Téléphone`, `E-mail` | facultatifs ; numéros français remis au format `06 12 34 56 78`, valeur illisible ignorée avec un avertissement ; sans ces colonnes, les coordonnées existantes ne bougent pas |
| `Couleur`, `Actif`, `Notes` | facultatifs, ajoutés par l'export |

Les colonnes d'une structure sont celles de son code (onglet *Structures* de l'admin) : une structure créée dans l'admin est lue à l'import et ajoutée à l'export. Une colonne `DPT XY` dont la structure n'existe pas est ignorée et signalée dans l'aperçu.

Lecture des listes de zones (`src/lib/parseZones.ts`) :

- séparateurs `,` `.` `/` `;` et espace ;
- suffixe `P` = partiel, `G` = gestion, sans suffixe = propre ;
- `9` → `09` ; `20` ou `2AB` → `2A` + `2B` ;
- `75-7` = Paris 7e (`75007` accepté), `75` = tout Paris ;
- `?` est ignoré ; toute valeur inconnue est signalée dans l'aperçu.

**Fusionner** ajoute ou met à jour les commerciaux du fichier, sans toucher aux autres. **Remplacer tout** supprime en plus ceux qui sont absents du fichier. Les commerciaux sont reconnus par leur nom (sans tenir compte de la casse ni des accents). Leurs couleurs et leurs notes sont conservées. L'import est appliqué en une seule transaction.

## Sécurité

| Qui | Peut |
|---|---|
| Anonyme | rien, sauf appeler `get_map_data(code)` et `ping()` |
| Avec le bon code | lire la carte : commerciaux **actifs**, managers et zones, **avec leur téléphone et leur e-mail** (choix validé). Le CA, les objectifs, les notes, actions, dates et jours/an restent réservés aux admins. |
| Connecté, non admin | rien |
| Admin (`public.admins`) | lire et modifier les données, changer le code, gérer les admins, régler l'affichage par défaut |

- Aucune règle RLS n'autorise la lecture anonyme ; les droits du rôle `anon` sur les tables sont en plus révoqués.
- Le code est stocké en **bcrypt** (`settings.access_code_hash`), illisible même par un admin.
- Anti-bruteforce : 10 essais ratés par IP en 15 min, 300 au total par heure.
- La création de comptes admin passe par l'Edge Function `admin-users`, qui garde la clé secrète côté serveur et vérifie que l'appelant est admin.
- Les inscriptions libres sont désactivées dans Supabase (voir SUPABASE_SETUP.md).

## Structure du projet

```
src/
  pages/        MapPage (carte), CodeGate (code d'accès), HelpPage (/aide)
  components/   MapView (D3 : projections, encarts, zones partagées, zoom), légende, filtres, infobulle, panneau
  admin/        connexion, commerciaux, managers, structures, synthèse, import/export Excel, paramètres
  lib/          parseZones (listes de zones), excel (lecture/écriture), importDiff (aperçu),
                mapModel (couleurs, zones partagées, filtres), zones (référentiel), api (Supabase)
public/geo/     contours GeoJSON : départements + DROM, détail Île-de-France, arrondissements, Monaco
supabase/
  migrations/   schéma, RLS, fonctions, remplissage des zones
  functions/    admin-users (Edge Function)
  tests/        tests des règles d'accès (PGlite)
scripts/        génération des contours, de la migration des zones et du fichier d'exemple
exemples/       exemple-import.xlsx (données fictives)
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement (Supabase requis) |
| `npm run demo` | serveur de développement avec les données d'exemple, sans Supabase |
| `npm test` | tests : listes de zones, import/export Excel, règles d'accès SQL |
| `npm run build` | build de production dans `dist/` |
| `npm run lint` | oxlint |
| `npm run db:push` | applique les migrations sur le projet Supabase lié |
| `npm run functions:deploy` | déploie l'Edge Function `admin-users` |
| `npm run build:geo` | retélécharge et simplifie les contours (`public/geo/`) |
| `npm run gen:zones-sql` | régénère la migration des zones depuis `src/lib/zones.ts` |
| `npm run sample:excel` | régénère `exemples/exemple-import.xlsx` |

Les tests SQL jouent les migrations dans [PGlite](https://pglite.dev) (Postgres en WebAssembly), avec un environnement qui imite Supabase. Ils vérifient les règles d'accès avec et sans l'exposition automatique des tables. Si `Classeur V3.xlsx` est présent à la racine (non versionné), un test vérifie aussi qu'il se lit sans valeur inconnue.

## Sources des contours

- Départements et DROM (vue France) : [gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson), d'après l'IGN (Licence Ouverte).
- Île-de-France détaillée et arrondissements de Paris (vues Île-de-France et Paris) : [API Découpage administratif](https://geo.api.gouv.fr), IGN Admin Express (Licence Ouverte). Les départements sont reconstitués à partir des communes et simplifiés dans la même topologie que les arrondissements, pour que les frontières coïncident exactement.
- Monaco : [geoBoundaries](https://www.geoboundaries.org), d'après OpenStreetMap (ODbL).
