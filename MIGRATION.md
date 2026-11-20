# Mise en service sur Dokploy et bascule depuis Supabase

Ce guide suit l'ordre à respecter. Les choix qui le justifient sont dans [DECISIONS.md](DECISIONS.md) (D-001 à D-009).

La carte part d'abord sur le VPS **gdconnect-vps**, par le Dokploy central (D-008). Le serveur interne reste la cible : le passage se fera plus tard (annexe en fin de guide).

Le site actuel (GitHub Pages + Supabase Cloud) reste en service jusqu'à l'étape 7. On peut donc tout préparer et tout essayer avant de basculer.

**Ne jamais coller dans un ticket, un chat ou le dépôt** :
- le secret du client OIDC ;
- `GD_MAP_AUTH_SECRET` ;
- les mots de passe des bases (Dokploy et Supabase).

---

## 1. DNS : `carte.gdone.fr`

Cette étape vient en premier : Let's Encrypt doit pouvoir joindre le VPS pour délivrer le certificat, à l'étape 4.

1. Dans la zone DNS de `gdone.fr` chez **OVH** : un enregistrement `A` `carte` vers **`187.124.54.151`**. C'est gdconnect-vps, la même IP que `gdone.fr`.
2. Vérifier la propagation, quelques minutes en général : `dig +short carte.gdone.fr` doit répondre `187.124.54.151`.

Pas de Cloudflare devant, et on n'en ajoute pas (D-008).

## 2. Portail : ouvrir la carte

1. Vérifier que le portail en production contient la carte :
   - **D-031**, déjà dans `main` : sans elle, personne n'a le droit d'usage `gd-map`, pas même GDCOM ;
   - la PR **D-043** (gdcom-portail#6), qui fait ouvrir la carte déjà connecté par la tuile et allège son claim, à fusionner puis déployer.
2. **Ne pas encore** renseigner `GDCOM_PORTAIL_GD_MAP_URL` : la tuile mènerait vers une carte pas encore en ligne. On le fera à l'étape 7.
3. Dans **Support → Clients OIDC → Nouveau client** :
   - Nom : `Carte commerciale` ; application : **Carte commerciale** (`gd-map`).
   - Type : **web**, **confidentiel**.
   - Adresse de retour : `https://carte.gdone.fr/api/auth/callback/gdcom`.
   - Noter l'**identifiant** et le **secret**. Le secret n'est affiché qu'une fois.
4. Les membres de l'organisation GDCOM ont le droit d'usage d'office. Une **autre** organisation du groupe dont un membre sera admin ou responsable reçoit le droit d'usage `gd-map` (Support → Organisations). Ce droit ne donne rien d'autre : la lecture passe par le code, et les rôles se donnent dans la carte (D-009).

## 3. Dokploy : la base

Sur le Dokploy central, serveur **gdconnect-vps** :

1. Créer le projet **gd-map**, puis un service **PostgreSQL 17** :
   - nom `gd-map-db` ;
   - mot de passe généré ;
   - **aucun port publié** : la base n'est joignable que par le réseau Dokploy.
2. Onglet **Backups** :
   - destination : le bucket de sauvegardes **OVH S3** ;
   - tous les jours à 3 h (`0 3 * * *`) ;
   - garder 14 sauvegardes.
3. Cliquer sur **Test** pour vérifier que la sauvegarde part bien.

## 4. Dokploy : l'application

1. Dans le projet, créer une **Application** :
   - Source : fournisseur **GitHub** de Dokploy, dépôt `GitOfSplayce/gd-map`. Si le Dokploy central est déjà relié à GitHub, pour GD Connect par exemple, reprendre ce fournisseur. Sinon, l'installer sur l'organisation GitOfSplayce, avec l'accès au seul dépôt `gd-map`.
   - Branche : `migration-dokploy` pour les essais, puis `main` après la bascule.
   - Build : **Dockerfile**. Port : **3600**.
   - **Auto Deploy : activé.** Chaque push sur la branche déploie. Les tests tournent pendant la construction : un test qui échoue arrête le déploiement, et la version en ligne reste en place.
2. Renseigner les **variables d'environnement** :

   | Variable | Valeur |
   |---|---|
   | `GD_MAP_BASE_URL` | `https://carte.gdone.fr` |
   | `GD_MAP_DATABASE_URL` | l'URL interne du service `gd-map-db` (onglet de la base) |
   | `GD_MAP_AUTH_SECRET` | `openssl rand -base64 32` |
   | `GD_MAP_OIDC_ISSUER` | `https://portail.gdone.fr` |
   | `GD_MAP_OIDC_CLIENT_ID` | l'identifiant noté à l'étape 2 |
   | `GD_MAP_OIDC_CLIENT_SECRET` | le secret noté à l'étape 2 |
   | `GD_MAP_ADMINS` | les adresses GD One des premiers admins, séparées par des virgules |

3. **Domaine** : `carte.gdone.fr`, HTTPS avec Let's Encrypt, port 3600.
4. Cliquer sur **Deploy** pour le premier déploiement.
   - Les journaux doivent afficher les tests (`Tests … passed`), les migrations, puis `[serveur] carte sur le port 3600`.
   - `https://carte.gdone.fr/api/health` doit répondre `{"app":"up","db":"up"}`.

## 5. Premier essai, puis reprise des données

1. Ouvrir `https://carte.gdone.fr/admin` et cliquer sur **Se connecter avec GD One** : le portail renvoie sur l'administration.
   - Si l'écran dit « n'est pas administrateur », vérifier l'adresse dans `GD_MAP_ADMINS` et le droit d'usage (étape 2).
2. **Prévenir les admins** de ne plus rien modifier sur l'ancien site jusqu'à la bascule.
3. Dans Dokploy, ouvrir le **terminal** du conteneur de l'application.
   - L'adresse Supabase est celle du pooler de session : hôte `aws-1-eu-west-3.pooler.supabase.com` (`aws-0` répond « tenant not found »), port `5432`, utilisateur `postgres.<ref du projet>`, et le mot de passe de la base Supabase.
   - Lancer d'abord un essai à blanc, qui ne fait que lire :

   ```sh
   SUPABASE_DB_URL='postgresql://postgres.<ref>:<mot de passe>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres' \
     node scripts/import-supabase.ts
   ```

4. L'essai affiche ce qui serait copié. Si les nombres sont les bons, relancer la même commande avec `--ecrire` à la fin.
   - Tout est copié en une transaction : structures, managers, commerciaux, zones attribuées, CA et objectifs, code d'accès et affichage.
   - Les admins Supabase deviennent admins par leur adresse e-mail.
   - Le script recompte les lignes après la copie.
   - On peut le relancer autant de fois que nécessaire : il vide la nouvelle base, puis recopie tout.
5. **Vérifier** :
   - la carte s'ouvre avec le **code d'accès actuel**, qui ne change pas ;
   - l'admin montre les mêmes commerciaux ;
   - un export Excel est identique à celui de l'ancien site.
6. **Restauration éprouvée** (D-006) : restaurer la dernière sauvegarde S3 dans une base de test et y relancer la carte. Une sauvegarde jamais restaurée n'est pas une sauvegarde.
   - Une sauvegarde ne contient pas les rôles de Postgres. Sur une base **neuve**, les créer d'abord, dans le terminal de la base :

     ```sh
     psql -U gdmap -d gd_map -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role postgres nologin;"
     ```

   - Puis, onglet **Backups** de cette base → **Restore Backup** : destination OVH, fichier `carte-commerciale-db-…/carte-commerciale/<date>.sql.gz`, base `gd_map`.
   - Fait le 2026-11-20 dans une base jetable : mêmes nombres de lignes, 15 migrations, code d'accès présent, et la carte répond à un visiteur anonyme.
7. **Rôles** (D-009), dans *Paramètres → Admins et responsables* : nommer le patron **admin**, puis chaque **responsable** avec ses managers. Leur organisation doit avoir le droit d'usage `gd-map` sur le portail (étape 2).

## 6. Contrôles de sécurité, depuis l'extérieur

- `https://carte.gdone.fr` s'ouvre ; `http://carte.gdone.fr` redirige vers HTTPS.
- Le port 5432 du VPS ne répond pas : `nc -vz 187.124.54.151 5432` doit échouer.
- **La limite d'essais ne se laisse pas tromper** : dix mauvais codes envoyés avec un faux `X-Forwarded-For` différent à chaque fois bloquent quand même. Traefik remplace cet en-tête par la vraie IP.

  ```sh
  for i in $(seq 1 10); do curl -s -X POST https://carte.gdone.fr/api/carte -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 192.0.2.$i" -d '{"code":"faux"}'; echo; done
  ```

  Le onzième essai, même avec le bon code, doit répondre `too_many_attempts` pendant un quart d'heure, depuis cette connexion seulement.
- Un compte GD One sans rôle dans la carte voit « n'a pas de rôle sur la carte » et peut encore utiliser le code (D-009).

## 7. Bascule

1. Si besoin, refaire une **copie fraîche** des données (étape 5, avec `--ecrire`).
2. Fusionner la pull request de `migration-dokploy` dans `main`.
   - `main` ne déploie plus GitHub Pages : le workflow est supprimé.
   - Dans Dokploy, passer la branche de l'application sur `main`. Le déploiement automatique suit ensuite chaque push sur `main`.
3. Sur le portail, renseigner `GDCOM_PORTAIL_GD_MAP_URL=https://carte.gdone.fr` et redéployer : la tuile « Carte commerciale » apparaît et ouvre la carte déjà connecté.
4. Annoncer la nouvelle adresse, `https://carte.gdone.fr`, avec le code d'accès (envoyé séparément) pour ceux qui n'ont pas de compte GD One.
5. Couper l'ancien site : dans le dépôt GitHub, **Settings → Pages → Unpublish site**.
6. Passer le dépôt en **privé** (un admin de l'organisation GitOfSplayce). Le faire **après** la bascule, sinon l'ancien site s'arrête plus tôt que prévu (D-005).

## 8. Ménage, après une période de sécurité (deux semaines par exemple)

1. Faire un dernier export de la base Supabase et le ranger dans le bucket de sauvegardes OVH, **jamais dans le dépôt**.
2. Supprimer le projet Supabase.
3. Supprimer les variables `VITE_SUPABASE_*` des réglages Actions du dépôt.
4. En local, supprimer le dossier `supabase/.temp`, qui n'était que le cache de la CLI.

## Ensuite : les mises à jour

- **Dépendances** : Dependabot (`.github/dependabot.yml`) ouvre chaque semaine une PR groupée pour les paquets npm et l'image Node, et une par mois pour les actions GitHub. La CI les vérifie ; une fois fusionnée, Dokploy redéploie de lui-même.
- **Système du VPS** : `unattended-upgrades` installe les correctifs de sécurité de Debian.
- **PostgreSQL** : les montées de version majeure (17 → 18) se font à la main, avec une sauvegarde juste avant.

---

## Annexe : plus tard, passer sur le serveur interne

À faire quand le port 443 du bureau triera les visites par nom (D-004, D-008).

1. **Réseau du bureau** : rediriger **seulement** les ports TCP 80 et 443 vers `10.10.1.14`, vers le Traefik du Dokploy interne.
   - Ne jamais rediriger 3000 (panneau Dokploy), 22, 5432 ni 8080.
   - L'IP publique doit être **fixe**.
2. **Routes internes** : depuis l'extérieur, `curl -H "Host: tikko.gdcommunication.local" http://<IP publique>` ne doit **pas** afficher Tikko. Sinon, ajouter à son routeur un middleware Traefik `ipAllowList` limité au réseau du bureau.
3. **Conseillé** : placer le serveur dans un réseau séparé des postes (VLAN ou DMZ).
4. **Dokploy interne** : créer la base comme à l'étape 3, y créer les rôles (étape 5.6), restaurer la dernière sauvegarde S3, puis créer l'application comme à l'étape 4.
5. **DNS** : l'enregistrement `carte` pointe vers l'IP publique du bureau. Dans le DNS interne, `carte.gdone.fr` pointe vers `10.10.1.14`.
6. Vérifier (étapes 5 et 6), puis arrêter l'application sur gdconnect-vps.

L'adresse `carte.gdone.fr`, le client OIDC du portail et les variables d'environnement ne changent pas. Le Dokploy interne n'étant pas exposé, le déploiement automatique depuis GitHub n'y marchera pas. Il faudra soit déployer d'un clic, comme Tikko, soit relier ce Dokploy à GitHub autrement.
