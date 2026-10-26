# Carte commerciale Groupe

Cartographie des secteurs commerciaux du groupe, par structure : **MD** (Maison Davoise), **SP** (Splayce), **MC** (MaucoCartex) et **BK** (BK Event) au départ ; les admins ajoutent les suivantes dans l'admin (onglet *Structures*).

- **Consultation** : par le portail du groupe (GD One), sans code, pour les personnes dont l'organisation a accès à la carte ; ou avec le **code d'accès** pour celles qui n'ont pas de compte sur le portail. On envoie le lien et le code séparément.
- **Administration** (`/admin`, connexion par le portail) : saisie des commerciaux et de leurs zones, managers, structures, import et export du fichier Excel, code d'accès, admins et affichage par défaut des zones partagées.

Stack : front Vite + React + TypeScript, carte en D3 + SVG, SheetJS pour l'Excel dans le navigateur ; serveur Node (Hono) avec Better Auth, client OIDC du portail GDCOM ; PostgreSQL 17. Une seule image Docker, déployée par Dokploy sur le serveur interne exposé (`https://carte.gdone.fr`). Les choix sont dans **[DECISIONS.md](DECISIONS.md)**, la mise en service dans **[MIGRATION.md](MIGRATION.md)**.

---

## Démarrage rapide

```bash
npm install
npm run demo        # carte avec des données fictives, sans serveur ni base : http://localhost:5173 (n'importe quel code)
```

Avec le serveur et une base locale :

```bash
docker run -d --name gd-map-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=gd_map -p 5432:5432 postgres:17-alpine
cp .env.example .env.local   # GD_MAP_AUTH_SECRET, et GD_MAP_DEV_SESSION=ton.adresse pour travailler sans portail
npm run dev:server           # serveur sur le port 3600 : migrations au démarrage, puis l'API
npm run dev                  # le front sur http://localhost:5173, qui passe /api au serveur
```

Avec `GD_MAP_DEV_SESSION`, le serveur fait comme si cette personne était connectée par le portail (refusé en production). Pour essayer la vraie connexion, déclarer sur un portail local un client `native` (retour `http://localhost:5173/api/auth/callback/gdcom`, `metadata.app = gd-map`) et renseigner `GD_MAP_OIDC_ISSUER` et `GD_MAP_OIDC_CLIENT_ID`.

## Déploiement

Dokploy construit le `Dockerfile` depuis `main`, comme pour Tikko. Au démarrage, le conteneur attend la base, applique les migrations (`db/migrations`), ajoute les premiers admins (`GD_MAP_ADMINS`) puis écoute sur le port 3600 (`/api/health` pour la sonde). Toutes les étapes, de la base Dokploy à la bascule depuis Supabase, sont dans **[MIGRATION.md](MIGRATION.md)**.

| Variable | Rôle |
|---|---|
| `GD_MAP_BASE_URL` | adresse publique : `https://carte.gdone.fr` |
| `GD_MAP_DATABASE_URL` | base PostgreSQL (service Dokploy) |
| `GD_MAP_AUTH_SECRET` | secret des sessions, 32 caractères au moins |
| `GD_MAP_OIDC_ISSUER`, `GD_MAP_OIDC_CLIENT_ID`, `GD_MAP_OIDC_CLIENT_SECRET` | client OIDC déclaré sur le portail (`https://portail.gdone.fr`) |
| `GD_MAP_ADMINS` | premiers admins, adresses séparées par des virgules |

La CI (`.github/workflows/ci.yml`) vérifie types, lint, tests et build à chaque envoi ; sur une pull request, elle construit aussi l'image.

## Utilisation

### Carte

- Onglets **Globale** puis un par structure (MD, SP, MC, BK…, dans l'ordre choisi dans l'admin) ; vues **France** (Corse, DROM et Monaco en encarts), **Île-de-France**, **Paris** par arrondissement.
- Couleur par **commercial**, **Manager 1** ou **Manager 2**. Couleurs des commerciaux attribuées automatiquement, modifiables dans l'admin.
- **Propre** = plein, **Gestion** (G) = trame de points, **Partiel** (P) = rayé comme une zone partagée, avec du **blanc** s'il est seul sur la zone, **Gestion-partiel** (GP) = traits pointillés (avec du blanc s'il est seul). Une zone partagée montre chaque part avec son motif (bande en points pour une gestion…). Zone partagée, au choix dans la légende : **Rayures** aux couleurs de chacun, **Découpage** (une bande verticale par commercial), **Camemberts** (teinte légère et petit camembert) ou **Dominante** (couleur du principal et badge « +N »). Le mode proposé par défaut se règle dans l'admin (*Paramètres → Affichage de la carte*) ; Rayures au départ.
- **CA et objectifs** (admins connectés uniquement) : saisie par structure et par année dans le panneau d'un commercial (raccourcis `120k`, `1,2M`) ou par l'Excel ; sur la carte, sélecteur d'année, CA et taux d'atteinte dans la légende, vue **Performance** (zones du rouge au vert selon le taux d'atteinte de leurs commerciaux) ; onglet **Synthèse** de l'admin (par commercial, manager ou structure, export Excel).
- Vue **Couverture** (dans « Couleur ») : carte de chaleur du niveau de couverture par zone (propre = 1, partiel = ½, gestion = ¼, gestion-partiel = ⅛, additionnés sur les commerciaux), du gris (non couverte) au bleu saphir.
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
- suffixe `P` = partiel, `G` = gestion, `GP` = gestion-partiel (`PG` accepté), sans suffixe = propre ;
- `9` → `09` ; `20` ou `2AB` → `2A` + `2B` ;
- `75-7` = Paris 7e (`75007` accepté), `75` = tout Paris ;
- `?` est ignoré ; toute valeur inconnue est signalée dans l'aperçu.

**Fusionner** ajoute ou met à jour les commerciaux du fichier, sans toucher aux autres. **Remplacer tout** supprime en plus ceux qui sont absents du fichier. Les commerciaux sont reconnus par leur nom (sans tenir compte de la casse ni des accents). Leurs couleurs et leurs notes sont conservées. L'import est appliqué en une seule transaction.

## Sécurité

| Qui | Peut |
|---|---|
| Anonyme | rien, sauf ouvrir la carte avec le code (`POST /api/carte`) |
| Avec le bon code, ou lecteur venu par le portail | lire la carte : commerciaux **actifs**, managers et zones, **avec leur téléphone et leur e-mail** (choix validé). Le CA, les objectifs, les notes, actions, dates et jours/an restent réservés aux admins. |
| Venu par le portail sans droit d'usage `gd-map` | comme un anonyme : le code reste possible |
| Admin (rôle dans `acces`, et droit d'usage sur le portail) | lire et modifier les données, changer le code, nommer les admins, régler l'affichage par défaut |

- **Le portail dit qui est la personne et si elle peut entrer**, d'après le claim `urn:gdcom:organizations` relu à chaque connexion ; **les rôles de la carte sont dans gd-map** (table `acces`), relus à chaque requête : un rôle retiré cesse aussitôt (D-002).
- Le serveur exécute chaque requête avec les droits du visiteur (rôle `anon` ou `authenticated`, utilisateur de la session) : les règles RLS et les fonctions SQL décident, testées dans `db/tests`. Les tables de connexion ne sont lisibles par aucun rôle de l'API.
- Personne ne modifie son profil ni ne se donne l'accès : les routes de modification de compte de Better Auth sont fermées, et le droit d'usage ne s'écrit qu'au retour du portail. Les jetons du portail sont chiffrés en base, l'ID token n'est pas gardé.
- Le code est stocké en **bcrypt** (`settings.access_code_hash`), illisible même par un admin.
- Anti-bruteforce : 10 essais ratés par IP en 15 min, 300 au total par heure. L'IP est celle que Traefik écrit dans `X-Forwarded-For` ; `cf-connecting-ip` n'est pas lu (D-004).

## Structure du projet

```
src/
  pages/        MapPage (carte), CodeGate (code d'accès ou portail), HelpPage (/aide)
  components/   MapView (D3 : projections, encarts, zones partagées, zoom), légende, filtres, infobulle, panneau
  admin/        connexion, commerciaux, managers, structures, synthèse, import/export Excel, paramètres
  lib/          parseZones (listes de zones), excel (lecture/écriture), importDiff (aperçu),
                mapModel (couleurs, zones partagées, filtres), zones (référentiel), api (appels au serveur), session
server/         serveur Hono : API (app.ts), connexion par le portail (auth.ts), base (db.ts), migrations
db/
  migrations/   socle, schéma, RLS, fonctions, zones, connexion par le portail et rôles
  tests/        tests des règles d'accès (PGlite)
public/geo/     contours GeoJSON : départements + DROM, détail Île-de-France, arrondissements, Monaco
scripts/        contours, migration des zones, fichier d'exemple, reprise des données de Supabase
exemples/       exemple-import.xlsx (données fictives)
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | front de développement (passe `/api` au serveur) |
| `npm run dev:server` | serveur de développement, relancé à chaque modification (lit `.env.local`) |
| `npm run demo` | front avec les données d'exemple, sans serveur |
| `npm start` | serveur de production (`node server/index.ts`) |
| `npm test` | tests : listes de zones, Excel, règles d'accès SQL, API |
| `npm run build` | types, puis build du front dans `dist/` |
| `npm run lint` | oxlint |
| `npm run auth:schema` | réécrit les tables de Better Auth en SQL, à reporter dans une migration |
| `npm run build:geo` | retélécharge et simplifie les contours (`public/geo/`) |
| `npm run gen:zones-sql` | régénère la migration des zones depuis `src/lib/zones.ts` |
| `npm run sample:excel` | régénère `exemples/exemple-import.xlsx` |

Les tests SQL et ceux de l'API jouent toutes les migrations dans [PGlite](https://pglite.dev) (Postgres en WebAssembly), puis chaque requête passe avec le rôle, l'utilisateur et l'IP que pose le serveur. Si `Classeur V3.xlsx` est présent à la racine (non versionné), un test vérifie aussi qu'il se lit sans valeur inconnue.

## Sources des contours

- Départements et DROM (vue France) : [gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson), d'après l'IGN (Licence Ouverte).
- Île-de-France détaillée et arrondissements de Paris (vues Île-de-France et Paris) : [API Découpage administratif](https://geo.api.gouv.fr), IGN Admin Express (Licence Ouverte). Les départements sont reconstitués à partir des communes et simplifiés dans la même topologie que les arrondissements, pour que les frontières coïncident exactement.
- Monaco : [geoBoundaries](https://www.geoboundaries.org), d'après OpenStreetMap (ODbL).
