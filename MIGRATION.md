# Mise en service sur Dokploy et bascule depuis Supabase

Ce guide suit l'ordre à respecter. Les choix qui le justifient sont dans [DECISIONS.md](DECISIONS.md) (D-001 à D-006).

Le site actuel (GitHub Pages + Supabase Cloud) reste en service jusqu'à l'étape 8. On peut donc tout préparer et tout essayer avant de basculer.

**Ne jamais coller dans un ticket, un chat ou le dépôt** :
- le secret du client OIDC ;
- `GD_MAP_AUTH_SECRET` ;
- les mots de passe des bases (Dokploy et Supabase).

---

## 1. Réseau : exposer le serveur interne (une fois pour toutes les applis)

Cette étape vaut aussi pour Tikko, quand il sera publié (D-004).

1. **Pare-feu ou box du bureau** : rediriger **seulement** les ports TCP **80** et **443** de l'IP publique vers `10.10.1.14`.
   - Ne jamais rediriger 3000 (panneau Dokploy), 22, 5432 ni 8080.
2. **IP publique** : vérifier auprès de l'opérateur qu'elle est **fixe**.
3. **Routes internes** : Traefik répond sur le port 443 quel que soit le nom demandé.
   - Depuis l'extérieur, par exemple un téléphone en 4G : `curl -H "Host: tikko.gdcommunication.local" http://<IP publique>` ne doit **pas** afficher Tikko.
   - Si Tikko répond, ajouter à son routeur un middleware Traefik `ipAllowList` limité au réseau du bureau.
4. **Conseillé** : placer le serveur dans un réseau séparé des postes (VLAN ou DMZ).

## 2. DNS

- **Zone publique de `gdone.fr`** : un enregistrement `A` `carte` vers l'IP publique du bureau.
- **DNS interne** : `carte.gdone.fr` vers `10.10.1.14`, pour que les postes du bureau n'aient pas à ressortir par la box.

## 3. Portail : ouvrir la carte

1. Fusionner puis déployer la PR du portail : https://github.com/GitOfSplayce/gdcom-portail/pull/1.
   - **Sans elle, personne n'a le droit d'usage `gd-map`, pas même GDCOM.**
2. Ajouter `GDCOM_PORTAIL_GD_MAP_URL=https://carte.gdone.fr` dans les variables du portail et redéployer. C'est ce qui fait apparaître la tuile.
3. Dans **Support → Clients OIDC → Nouveau client** :
   - Nom : `Carte commerciale` ; application : **Carte commerciale** (`gd-map`).
   - Type : **web**, **confidentiel**.
   - Adresse de retour : `https://carte.gdone.fr/api/auth/callback/gdcom`.
   - Noter l'**identifiant** et le **secret**. Le secret n'est affiché qu'une fois.
4. Les membres de l'organisation GDCOM ont l'accès d'office. Une **autre** organisation du groupe qui doit voir la carte reçoit le droit d'usage `gd-map` (Support → Organisations).

## 4. Dokploy : la base

Sur le Dokploy du serveur interne :

1. Créer le projet **gd-map**, puis un service **PostgreSQL 17** :
   - nom `gd-map-db` ;
   - mot de passe généré ;
   - **aucun port publié** : la base n'est joignable que par le réseau Dokploy.
2. Onglet **Backups** :
   - destination : le bucket de sauvegardes **OVH S3** ;
   - tous les jours à 3 h (`0 3 * * *`) ;
   - garder 14 sauvegardes.
3. Cliquer sur **Test** pour vérifier que la sauvegarde part bien.

## 5. Dokploy : l'application

1. Dans le projet, créer une **Application** :
   - Source : GitHub `GitOfSplayce/gd-map`, avec une **deploy key en lecture seule**, comme Tikko.
   - Branche : `migration-dokploy` pour les essais, puis `main` après la bascule.
   - Build : **Dockerfile**. Port : **3600**.
2. Renseigner les **variables d'environnement** :

   | Variable | Valeur |
   |---|---|
   | `GD_MAP_BASE_URL` | `https://carte.gdone.fr` |
   | `GD_MAP_DATABASE_URL` | l'URL interne du service `gd-map-db` (onglet de la base) |
   | `GD_MAP_AUTH_SECRET` | `openssl rand -base64 32` |
   | `GD_MAP_OIDC_ISSUER` | `https://portail.gdone.fr` |
   | `GD_MAP_OIDC_CLIENT_ID` | l'identifiant noté à l'étape 3 |
   | `GD_MAP_OIDC_CLIENT_SECRET` | le secret noté à l'étape 3 |
   | `GD_MAP_ADMINS` | les adresses GD One des premiers admins, séparées par des virgules |

3. **Domaine** : `carte.gdone.fr`, HTTPS avec Let's Encrypt, port 3600.
4. Cliquer sur **Deploy**.
   - Les journaux doivent afficher les migrations, puis `[serveur] carte sur le port 3600`.
   - `https://carte.gdone.fr/api/health` doit répondre `{"app":"up","db":"up"}`.

## 6. Premier essai, puis reprise des données

1. Ouvrir `https://carte.gdone.fr/admin` et cliquer sur **Se connecter avec GD One** : le portail renvoie sur l'administration.
   - Si l'écran dit « n'est pas administrateur », vérifier l'adresse dans `GD_MAP_ADMINS` et le droit d'usage (étape 3).
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
5. **Vérifier** :
   - la carte s'ouvre avec le **code d'accès actuel**, qui ne change pas ;
   - l'admin montre les mêmes commerciaux ;
   - un export Excel est identique à celui de l'ancien site.
6. **Restauration éprouvée** (D-006) : restaurer la dernière sauvegarde S3 dans une base de test et y relancer la carte. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

## 7. Contrôles de sécurité, depuis l'extérieur

- `https://carte.gdone.fr` s'ouvre ; `http://carte.gdone.fr` redirige vers HTTPS.
- `http://<IP publique>:3000` (Dokploy) et `:5432` ne répondent pas.
- Dix mauvais codes depuis un téléphone bloquent ce téléphone, pas un autre réseau.
- Un compte GD One sans droit d'usage voit « n'a pas accès à la carte » et peut encore utiliser le code.

## 8. Bascule

1. Fusionner la pull request de `migration-dokploy` dans `main`.
   - `main` ne déploie plus GitHub Pages : le workflow est supprimé.
   - Dans Dokploy, passer la branche de l'application sur `main` et redéployer.
2. Annoncer la nouvelle adresse, `https://carte.gdone.fr`, avec le code d'accès (envoyé séparément) pour ceux qui n'ont pas de compte GD One.
3. Couper l'ancien site : dans le dépôt GitHub, **Settings → Pages → Unpublish site**.
4. Passer le dépôt en **privé** (un admin de l'organisation GitOfSplayce). Le faire **après** la bascule, sinon l'ancien site s'arrête plus tôt que prévu (D-005).

## 9. Ménage, après une période de sécurité (deux semaines par exemple)

1. Faire un dernier export de la base Supabase et le ranger dans le bucket de sauvegardes OVH, **jamais dans le dépôt**.
2. Supprimer le projet Supabase.
3. Supprimer les variables `VITE_SUPABASE_*` des réglages Actions du dépôt.
4. En local, supprimer le dossier `supabase/.temp`, qui n'était que le cache de la CLI.

## Ensuite : les mises à jour

- **Dépendances** : Dependabot (`.github/dependabot.yml`) ouvre chaque semaine une PR groupée pour les paquets npm et l'image Node, et une par mois pour les actions GitHub. La CI les vérifie ; on fusionne, puis on redéploie dans Dokploy.
- **Système du serveur** : `unattended-upgrades` installe les correctifs de sécurité d'Ubuntu.
- **PostgreSQL** : les montées de version majeure (17 → 18) se font à la main, avec une sauvegarde juste avant.
