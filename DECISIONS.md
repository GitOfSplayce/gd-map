# Décisions d'architecture — gd-map

Journal des décisions. Une entrée par décision, jamais réécrite : une décision qui change fait l'objet d'une nouvelle entrée.

---

## D-001 — Héberger gd-map chez nous, sans Supabase ni GitHub Pages (2026-10-26)

**Décision (validée par l'équipe).** gd-map quitte Supabase Cloud et GitHub Pages. L'application et sa base tournent sur le Dokploy du serveur interne (`gddocker`), exposé sur Internet (D-004). GitHub reste pour le code et la CI.

**Pourquoi.**

- Héberger chez nous, sans service tiers pour les données ni pour le site.
- La connexion par le portail (D-002) remplace l'auth de Supabase, qui était sa principale raison d'être. Il ne resterait que des intermédiaires à maintenir pour une seule application.
- Mémoire mesurée le 2026-10-26 sur 2 vCPU, avec 40 commerciaux et une charge bien supérieure à l'usage réel :
  - Supabase réduit à ce que gd-map utilise : ≈ 355 Mo (≈ 745 Mo avec Studio) ;
  - Postgres et un serveur Node : ≈ 130 à 160 Mo.

**Conséquences.** À la bascule, plusieurs éléments disparaissent :

- `@supabase/supabase-js`, l'Edge Function `admin-users` et `supabase/config.toml` ;
- `keepalive.yml`, le workflow Pages et `SUPABASE_SETUP.md`.

Les migrations SQL restent la source du schéma (D-003). Le projet Supabase est supprimé après une période de sécurité.

## D-002 — Identité par le portail, rôles et périmètre dans gd-map, code d'accès conservé (2026-10-26)

**Décision (validée par l'équipe).** gd-map devient cliente OIDC du portail GDCOM (`https://portail.gdone.fr`), comme la flotte (gdcom-flotte, D-002) :

- Better Auth `genericOAuth`, code + PKCE, ID token vérifié ;
- scopes `openid profile email organizations`, sans `offline_access` : la carte n'appelle plus le portail après la connexion ;
- admins et lecteurs se connectent par le portail, et gd-map ne garde aucun mot de passe.

Le portail ne décide que de deux choses :

- **Qui est la personne** : le claim `sub`.
- **Si elle peut entrer** : une de ses organisations doit avoir le droit d'usage `gd-map`. L'organisation opératrice GDCOM l'a d'office (gdcom-portail, D-017).

Ce que la personne peut faire est attribué et stocké **dans gd-map** :

| Rôle | Droits |
|---|---|
| Admin | Tout, dont l'attribution des rôles |
| Responsable (plus tard) | La carte, et la saisie des chiffres de son périmètre (par exemple les commerciaux d'un manager) |
| Lecteur | Rôle par défaut de toute personne admise par le portail : la carte |

Le **code d'accès** reste pour ceux qui n'auront jamais de compte sur le portail. Il ouvre la carte seule, comme aujourd'hui.

**Pourquoi ne pas faire porter ces rôles par le jeton.**

- **Fraîcheur.** Le jeton n'est lu qu'à la connexion, et une session dure plusieurs jours. gd-map relit ses rôles à chaque requête : un rôle retiré cesse aussitôt.
- **Le périmètre désigne des objets de gd-map.** Commerciaux, managers et structures sont inconnus du portail.
- **Le portail reste générique.** Il porte quatre rôles (gdcom-portail, D-006), et chaque application en dérive ses droits.

**À faire côté portail.** Le point 1 est une petite PR, les points 2 et 3 se font dans l'espace support.

1. Ajouter `gd-map` à `applications` dans `project.config.ts` : audience `internal`, `productPage: null`, `oidc: { envPrefix: 'GD_MAP_OIDC_', callbackPath: '/api/auth/callback/gdcom' }`. L'ajouter aussi à `ENTITLEMENT_SHAPES` dans `src/lib/entitlements.ts`, sans verticale ni niveau, comme la flotte.
2. Déclarer le client OAuth avec `metadata.app = "gd-map"`. Adresse de retour : `https://carte.gdone.fr/api/auth/callback/gdcom`.
3. Attribuer le droit d'usage `gd-map` aux organisations, autres que GDCOM, dont les membres consultent la carte.

**Conséquences.**

- Les premiers admins sont désignés par configuration (liste d'adresses), sur le modèle de `SUPPORT_ADMINS` du portail.
- Les admins actuels sont repris par leur adresse e-mail.
- La table des rôles prévoit le périmètre dès le départ, même si le rôle « responsable » vient plus tard.
- La gestion des comptes (création, mot de passe, double authentification) quitte gd-map.
- Personne ne se donne l'accès lui-même : les routes de Better Auth qui modifient un compte sont fermées, et `hasAccess` ne s'écrit qu'au retour du portail (route `/callback/gdcom`).
- Les jetons du portail sont chiffrés en base, et l'ID token n'est pas gardé : la carte n'appelle plus le portail après la connexion.
- Si le portail est indisponible, plus personne ne peut se connecter. La carte reste lisible avec le code d'accès.

## D-003 — Socle : front Vite conservé, petite API Node (Hono), SQL sans ORM (2026-10-26)

**Décision (validée par l'équipe).**

- Le front Vite + React reste tel quel.
- Une API Hono sur Node 22 sert le build, les routes `/api` et Better Auth, le tout dans une seule image.
- Base PostgreSQL 17.
- Le schéma reste en migrations SQL. Les fonctions actuelles (`get_map_data`, `save_commercial`, `apply_import`…) sont reprises, et l'utilisateur de la session y remplace `auth.uid()`.
- Les tests des règles d'accès restent dans PGlite.

**Pourquoi.** C'est un écart au socle du groupe, Next.js 16 + Prisma (gdcom-flotte, D-001).

- La carte est une application D3 rendue dans le navigateur, sans page serveur. La passer en Next obligerait à réécrire le routage et le chargement, sans rien gagner.
- Hono est un petit serveur web en TypeScript, comparable à Express. Il reçoit les requêtes du navigateur, vérifie les droits et répond depuis la base : c'est le rôle que tenait Supabase. Next.js l'inclut d'office, Vite non. C'est déjà le serveur du guichet des bornes de lummea-play (`apps/api`).
- Les règles d'accès sont écrites en SQL et testées. Prisma n'ajouterait qu'une seconde description du schéma.

**Conséquences.** Better Auth est branché directement sur `pg`. Ses tables (`user`, `session`, `account`, `verification`) arrivent par une migration SQL.

## D-004 — Le serveur interne est exposé, Traefik seul joignable (2026-10-26)

**Décision (validée par l'équipe).** Héberger chez nous n'interdit pas d'exposer. Le serveur interne publie gd-map sur Internet, puis Tikko quand il passera par le portail. Le plan d'hébergement du 2026-10-08 le gardait fermé surtout à cause du runner GitHub, qui aurait eu les droits Docker : il n'y aura pas de runner local (D-005).

**Règles.**

- **Pare-feu du bureau.** Seuls les ports 80 et 443 (TCP) sont redirigés vers `10.10.1.14`. Jamais 3000 (panneau Dokploy), 22, 5432 ni 8080.
- **Routes internes filtrées.** Traefik répond sur 443 quel que soit le nom demandé. Toute route qui doit rester interne (applications en `.local`) porte donc un filtre limité aux adresses du bureau. Sinon, on l'atteint de l'extérieur en forçant l'en-tête `Host`.
- **DNS.** Un nom public par application (`carte.gdone.fr` pour gd-map) pointe vers l'IP publique. Le DNS interne renvoie le même nom vers `10.10.1.14` pour les postes du bureau.
- **Certificats.** Let's Encrypt, obtenus par Dokploy (validation HTTP sur le port 80).
- **À confirmer** : l'IP publique est fixe.
- **Conseillé** : placer le serveur dans un réseau séparé des postes (VLAN ou DMZ). Une application exposée compromise ne doit pas ouvrir le réseau du bureau.

**Limite d'essais du code d'accès.** L'IP du visiteur est celle que Traefik écrit dans `X-Forwarded-For`. `cf-connecting-ip` n'est plus jamais lu : sans Cloudflare devant, le visiteur l'écrit lui-même (vérifié le 2026-10-26).

## D-005 — Repo privé, CI sur les runners de GitHub, déploiement par Dokploy (2026-10-26)

**Décision (validée par l'équipe).**

- **Repo privé, après la bascule.** Sur l'offre gratuite, GitHub Pages ne publie pas un repo privé : le site actuel s'arrêterait. Le changement demande un admin de l'organisation GitOfSplayce.
- **CI** (tests et build) sur les runners hébergés par GitHub. Compter ≈ 2 à 3 minutes par passage, prises sur le quota de minutes de l'organisation.
- **Déploiement comme Tikko.** Dokploy clone `main` par une deploy key en lecture seule, construit le `Dockerfile` et applique les migrations au démarrage. Le déploiement se déclenche à la main dans Dokploy, dont le panneau reste interne.

**Évolution possible.** N'exposer que l'adresse de déploiement de Dokploy, pour que la CI la déclenche après les tests (à étudier).

## D-006 — Sauvegardes : dump quotidien vers le S3 OVH (2026-10-26)

**Décision (validée par l'équipe).**

- La base est un service PostgreSQL de Dokploy.
- Un `pg_dump` quotidien part vers le bucket de sauvegardes OVH, avec la sauvegarde intégrée de Dokploy ou votre propre tâche.
- Jamais de sauvegarde vers GitHub.
- Une restauration est éprouvée avant la bascule.

## D-007 — La tuile du portail ouvre la carte déjà connecté ; le claim se limite à ce qu'elle lit (2026-11-19)

**Décision (validée par l'équipe).** La carte a une entrée par le portail : `GET /api/connexion?retour=<chemin>`.

- **Déjà venu avec l'accès** : on va tout droit au chemin demandé, sans repasser par le portail.
- **Sinon** : départ vers le portail, par la même route de Better Auth que le bouton (`sign-in/social`), en gardant son cookie d'état ; au retour, la session est ouverte sur `retour`. Un compte connecté sans droit d'usage repasse aussi par le portail, qui a pu le lui donner depuis.
- **Échec** : retour sur le chemin avec `?connexion=echec`, que l'écran affiche ; le code d'accès reste possible.

Le bouton « Se connecter avec GD One » passe lui aussi par cette entrée : il n'y a qu'un chemin de connexion.

**Côté portail.**

- La déclaration demandée par D-002 a été faite sous **D-031** du portail (2026-11-10).
- **D-043** du portail fait pointer la tuile sur `/api/connexion` (`signInPath`) et limite le claim envoyé à la carte : GDCOM et les organisations qui ont le droit d'usage `gd-map`, comme pour BK Studio (portail, D-034).

**Pourquoi.**

- **La tuile** menait à l'accueil, où il fallait cliquer une seconde fois sur « Se connecter avec GD One ».
- **Le claim complet** portait, pour un membre de GDCOM, 68 organisations (un ID token de plus de 29 000 caractères), alors que la carte ne lit que la présence d'un droit d'usage.

**Sécurité.**

- `retour` n'accepte qu'un chemin de la carte (ni `//…`, ni adresse complète) : pas de redirection ouverte.
- Une entrée en `GET` qui démarre une connexion ne fait courir aucun risque : au pire, quelqu'un se connecte à la carte avec son propre compte du portail.

## D-008 — Hébergement provisoire sur gdconnect-vps, déploiement automatique à chaque push (2026-11-19)

**Décision (validée par l'équipe).**

- **En attendant le serveur interne**, la carte et sa base tournent sur le VPS existant **gdconnect-vps** (Hostinger KVM 2, Debian, Dokploy central). Son Traefik trie déjà les visites par nom sur le port 443 (vitrine, GD Connect). Le serveur interne reste la cible (D-004) : y passer ne demandera qu'une sauvegarde restaurée et un changement d'IP dans le DNS. L'adresse `carte.gdone.fr` et le client OIDC ne changent pas.
- **DNS** : `carte.gdone.fr` (zone OVH) pointe vers l'IP du VPS. Pas de Cloudflare, et on n'en ajoute pas : Traefik écrit la vraie IP du visiteur dans `X-Forwarded-For`, que lit la limite d'essais du code (D-004).
- **Déploiement** : l'intégration GitHub de Dokploy déploie à chaque push sur la branche choisie (`main` après la bascule). Les **tests tournent pendant la construction de l'image** : un test qui échoue arrête la construction, et la version en ligne reste en place. Cette règle remplace le déploiement à la main de D-005.

**Pourquoi.**

- **Le port 443 du bureau** est déjà pris par un autre service, sans tri par nom de domaine.
- **Déployer depuis la CI** après les tests demanderait de mettre dans GitHub une clé d'API Dokploy, qui ouvre tout le Dokploy central, donc tous les VPS. Les tests se jouent plutôt dans la construction de l'image, sans aucun secret.

**Conséquences.**

- **Construction** : `npm ci`, build et tests prennent environ 1 Go de mémoire et un peu de processeur pendant une à deux minutes sur gdconnect-vps, à côté de la vitrine et de GD Connect. La carte tourne ensuite dans environ 120 Mo.
- **CI GitHub** : elle reste pour les pull requests et pour Dependabot.

## D-009 — La carte se lit avec le code ; le portail est réservé aux admins et aux responsables (2026-11-20)

**Décision (validée par l'équipe).** Elle remplace le rôle « Lecteur » de D-002.

- **Lire la carte** : tout le monde, avec le **code d'accès** (6 caractères au moins). Avoir un compte GD One ne donne plus la lecture sans code.
- **Se connecter par le portail** sert seulement aux personnes **nommées dans la carte** (table `acces`, page *Paramètres*) :

| Rôle | Droits |
|---|---|
| Admin (le patron, et qui il désigne) | tout : commerciaux, zones, managers, structures, import, code d'accès, rôles |
| Responsable (responsable commercial, manager) | la carte sans code, et le **CA et les objectifs** des commerciaux de son équipe, rien d'autre |

- **L'équipe d'un responsable** : les commerciaux dont le **Manager 1 ou le Manager 2** fait partie de son périmètre, une liste de managers choisie par un admin. Un manager qui a la même adresse e-mail que la personne est proposé d'office. Renommer ou fusionner un manager le suit dans les périmètres, le supprimer l'en retire.
- **Pas d'organisation dédiée sur le portail.** Chacun reste dans l'organisation de son entité. Le portail continue de dire qui est la personne, et si son organisation a le droit d'usage `gd-map` : c'est nécessaire, mais plus suffisant. Qui, dans l'organisation, a un rôle se décide dans la carte.

**Pourquoi.**

- Dans une entité, tout le monde n'est pas commercial : le droit d'usage du portail, donné à toute une organisation, ouvrirait les chiffres et les coordonnées à des personnes qui n'ont pas à les voir.
- Le code existe déjà, tout le monde le connaît ; il suffit pour lire.
- Un rôle par personne, gardé dans gd-map, garde le portail générique (D-002) et suit les managers de la carte, que le portail ne connaît pas.

**Conséquences.**

- `has_map_access()` disparaît ; `map_role()` dit admin, responsable ou rien, et `get_map_data` n'ouvre la carte sans code qu'à un rôle.
- Un responsable lit et écrit ses chiffres par `get_equipe()` et `save_objectifs_equipe()`, qui vérifient en base que chaque commercial est de son équipe. Il n'a aucun accès direct aux tables, ni aux fonctions d'admin. Sur la carte, il ne voit pas le CA ni la vue Performance (réservés aux admins, comme avant).
- Pour qu'un responsable d'une autre entité puisse se connecter, l'organisation de son entité reçoit le droit d'usage `gd-map` sur le portail (Support → Organisations). Sans rôle dans la carte, ce droit ne donne rien de plus que le code.
- Un compte venu par le portail sans rôle voit l'écran du code, avec un message qui le dit.

## D-010 — Les managers gèrent leur équipe avec leur compte GD One ; Manager 1 et Manager 2 se désactivent ; journal (2026-11-25)

**Décision (validée par l'équipe).** Elle remplace le rôle « Responsable » de D-009 et la table des rôles qui va avec.

| Qui | Droits |
|---|---|
| Tout le monde, avec le code | la carte, sans CA ni objectifs |
| Manager, relié à son compte GD One | toute la carte sans code, **CA et objectifs de toutes les équipes** compris ; il modifie les **départements, CA et objectifs** de ses commerciaux, rien d'autre |
| Admin | tout, sans les limites ci-dessous |

- **Un manager, un compte.** `managers.compte` est distinct de l'e-mail de contact : changer un contact ne donne ni ne retire d'accès. Les admins restent dans `acces`. Un admin aussi manager est admin.
- **Son équipe** : les commerciaux dont il est le Manager 1 ou le Manager 2, **parmi ceux activés** dans *Paramètres*. Désactivé, un manager n'a plus de vue, de filtre, de colonne ni de droits ; rien n'est effacé, et il en reste toujours un (« Manager » à l'écran quand il est seul).
- **Ses structures**, cochées par un admin dans l'onglet *Managers* (au départ : celles de ses commerciaux). Il n'ajoute pas un commercial à une structure.
- **Un département, dans une structure, est à un seul manager**, quel que soit le type (propre, partiel, gestion, gestion-partiel). Il le partage entre ses commerciaux, pas avec ceux d'un autre. Un commercial sans manager actif garde son département : seul un admin y touche. Les partages décidés par un admin restent. Un commercial inactif n'occupe rien. Paris se compare par arrondissement.
- **Publication immédiate**, et un **journal** : qui, quand, avant, après. Tout pour un admin ; pour un manager, son équipe, sans les champs réservés aux admins.
- **Le portail ouvre la carte** par une organisation qui a le droit d'usage, ou par un accès donné à la personne (claim `urn:gdcom:personal_access`, gdcom-portail D-046).

**Pourquoi.** Ce sont les managers qui tiennent les secteurs et les chiffres. Bientôt, seul Manager 2 restera sur la carte. Certains managers sont dans plusieurs organisations du portail : l'accès par personne évite d'ouvrir la carte à toute une organisation.

**Conséquences.**

- `save_equipe()` écrit pour un manager, sous verrou : deux managers qui prennent le même département passent l'un après l'autre. Elle revérifie l'équipe, les structures et les départements libres.
- Le journal s'écrit par déclencheurs, sans accès direct à sa table. `save_commercial` n'écrit plus que ce qui change. Les suites automatiques (structure renommée, manager supprimé…) n'ajoutent pas de lignes. La valeur du code d'accès n'est jamais notée.
- Reprise : un responsable d'un seul manager devient ce manager ; les autres repassent au code.

## D-011 — Un département vide est à recruter : priorités et secteurs à la place des fiches « À recruter » (2026-11-25)

**Décision (validée par l'équipe).**

- Plus de faux commerciaux « À recruter ». Un département **vide** d'une structure est à recruter ; n'importe quel manager de cette structure peut le prendre.
- Les admins seuls lui donnent une **priorité** de 1 à 3, en couleur sur la carte, et un **secteur**, qui réunit les départements d'un même poste. Sans priorité ni secteur, rien n'est écrit et il reste gris.
- Pourvu, il perd priorité et secteur. Si tout Paris était à recruter et qu'un arrondissement est pourvu, les autres le restent.
- Sur l'onglet Globale, un département n'est à recruter que si aucune structure n'y a quelqu'un ; son détail dit lesquelles manquent.
- Les fiches existantes se suppriment depuis l'onglet *Recrutement*, après les avoir listées et proposé un export : leurs départements vides prennent leur nom pour secteur, leurs CA et objectifs partent avec elles (le journal en garde la trace). Pas de suppression automatique par la migration.

**Pourquoi.** Ces fiches occupaient des départements, comptaient comme des commerciaux, et auraient empêché les managers de les prendre.

## D-012 — La carte est la source des données : plus d'import Excel, un export mis en forme (2026-11-25)

**Décision (validée par l'équipe).** L'import Excel est retiré. Il effaçait, même en « Fusionner », les CA de l'année et les zones quand leurs colonnes manquaient : il aurait écrasé la saisie des managers. L'export reste, réservé aux admins : quatre feuilles (Commerciaux, Départements, CA et objectifs, Managers), avec titres, couleurs, filtres et volets figés.

**Conséquences.** SheetJS, qui n'écrit pas de mise en forme dans sa version libre, laisse la place à `write-excel-file`, chargée seulement à l'export. Les données de démonstration sont figées dans `src/lib/demoData.json`. `scripts/import-supabase.ts` est retiré : le relancer effacerait ce que la carte a reçu depuis la reprise.
