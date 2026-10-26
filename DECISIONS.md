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
