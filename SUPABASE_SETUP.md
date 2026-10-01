# Configuration Supabase – Carte commerciale Groupe

Ce document liste ce qu'il faut faire côté Supabase, dans l'ordre, et ce que j'ai besoin que tu m'envoies.
Les tables, les règles RLS, les fonctions et la liste des zones sont dans des **migrations SQL du dépôt** (`supabase/migrations/`). Tu n'as rien à créer à la main dans le Table Editor.

---

## 1. Ce que tu m'envoies dès le début

| Info | Où la trouver | Sensible ? |
|---|---|---|
| **Project URL** (`https://xxxxxxxx.supabase.co`) | bouton **Connect** en haut du dashboard, ou *Project Settings → Data API* | Non |
| **Publishable key** (`sb_publishable_…`), ou la clé `anon` si tu n'as que les « Legacy API keys » | *Project Settings → API Keys* | Non : elle est publique et finit de toute façon dans le site |
| **Project ref** (les 20 caractères de l'URL : `https://supabase.com/dashboard/project/<ref>`) | barre d'adresse | Non |
| **CLI liée : oui / non** (voir étape 5) | — | — |

Tu peux me les coller dans le chat, ou créer toi-même le fichier `.env.local` à la racine (il est ignoré par git) :

```env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxx
```

**Ne m'envoie jamais** :
- le mot de passe de la base de données ;
- la *secret key* (`sb_secret_…`) ou la clé `service_role` ;
- ton *access token* Supabase (`sbp_…`) ;
- le mot de passe du compte admin ;
- le code d'accès à la carte.

Je n'en ai pas besoin. Les commandes qui en ont besoin passent par la CLI connectée sur ta machine (étape 5), et l'Edge Function récupère la clé secrète toute seule côté Supabase.

Hors Supabase, plus tard :
- l'URL du repo GitHub quand tu l'auras créé (je m'occupe du `git init`, du push et du workflow GitHub Actions) ;
- si tu veux un domaine personnalisé au lieu de `https://<user>.github.io/<repo>/`, son nom ;
- en option : logo et couleurs du groupe, et couleurs souhaitées par structure (MD, SP, MC, BK).

---

## 2. Créer le projet

1. Sur https://supabase.com/dashboard, clique sur **New project** (crée une organisation si besoin).
2. Remplis les champs :
   - **Name** : `carte-commerciale` (ou ce que tu veux).
   - **Database password** : clique sur *Generate a password* et garde-le dans ton gestionnaire de mots de passe. **Ne me l'envoie pas.**
   - **Region** : **West EU (Paris)**, pour avoir des données en France (RGPD, noms des commerciaux).
   - **Plan** : Free suffit pour démarrer (voir la remarque sur la mise en pause, section 8).
3. **Security options**, si l'écran les propose : garde les valeurs par défaut.
   - *Data API* : **activée**. Le site l'utilise via `supabase-js`.
   - Schéma exposé : **public**.
   - *Automatic RLS* (si proposé) : **activé**. De toute façon, les migrations activent RLS sur chaque table.
   - *Exposer automatiquement les nouvelles tables* (si proposé) : peu importe. Les migrations donnent elles-mêmes les droits nécessaires, et c'est testé dans les deux cas.

---

## 3. Authentification

### 3.1 Fermer les inscriptions

*Authentication → Sign In / Providers* :
- **Email** : activé (c'est le cas par défaut).
- **Allow new users to sign up** : **désactivé**. Personne ne peut créer de compte tout seul : les admins sont créés depuis le dashboard ou depuis la page `/admin` du site.
- *Confirm email* : peu importe, les comptes sont créés déjà confirmés.

On n'utilise ni lien magique ni e-mail de réinitialisation, donc **pas besoin de configurer un SMTP**. Un admin peut redéfinir le mot de passe d'un autre admin depuis `/admin`.

### 3.2 URLs

*Authentication → URL Configuration* :
- **Site URL** : `http://localhost:5173` pour l'instant, puis `https://<user>.github.io/<repo>/` quand le repo existe.
- **Redirect URLs** : ajoute
  - `http://localhost:5173/**`
  - `https://<user>.github.io/<repo>/**` (plus tard)

### 3.3 Mots de passe (recommandé)

*Authentication → Sign In / Providers → Email* (ou *Policies* selon la version du dashboard) : **longueur minimale 10**.

---

## 4. Créer ton compte admin

*Authentication → Users → Add user → Create new user* :
- ton e-mail et un mot de passe solide ;
- coche **Auto Confirm User**.

À ce stade, ce compte n'a encore **aucun droit**. Il devient admin à l'étape 7, une fois les tables créées.

---

## 5. Relier ce dossier au projet (CLI)

Cette étape me permet d'appliquer les migrations et de déployer l'Edge Function **sans voir aucun secret** : la CLI garde ton token dans le trousseau macOS.

Dans un terminal, depuis le dossier du projet (`gd-map`). Le `package.json` et `supabase/config.toml` sont déjà en place.

```bash
npm install                       # installe aussi la CLI Supabase (devDependency)
npx supabase login                # ouvre le navigateur et autorise la CLI
npx supabase link --project-ref <ton-project-ref>
```

Si `link` te demande le mot de passe de la base, tape-le : il reste sur ta machine. Selon la version, tu peux aussi laisser vide et valider.

Ensuite, dis-moi simplement « CLI liée ». Je lancerai :
- `npm run db:push` : tables, RLS, fonctions, remplissage des zones ;
- `npm run functions:deploy` : Edge Function `admin-users`, pour gérer les admins depuis l'interface.

### Alternative sans CLI

Si tu préfères ne pas installer la CLI :
- Ouvre *SQL Editor*, puis colle et exécute chaque fichier de `supabase/migrations/` **dans l'ordre des noms**.
- Pour l'Edge Function : *Edge Functions → Deploy a new function → Via Editor*. Nomme-la `admin-users`, colle le contenu de `supabase/functions/admin-users/index.ts`, puis **désactive « Verify JWT »** (la fonction vérifie elle-même l'utilisateur et son statut d'admin).

---

## 6. Ce que créent les migrations (pour info)

| Élément | Rôle |
|---|---|
| `zones` | 96 départements métropolitains (dont 2A/2B), 5 DROM, 20 arrondissements de Paris, Monaco (`98`) |
| `commerciaux` | nom, statut, managers, couleur, actif, notes, plus les colonnes du fichier Excel (structures cochées, jours/an, dates, actions, région) |
| `affectations` | commercial × structure × zone × couverture (`propre` / `partiel` / `gestion`) |
| `objectifs` | CA et objectif par commercial, structure et année (prévu pour plus tard) |
| `settings` | hash bcrypt du code d'accès (une seule ligne) |
| `admins` | comptes autorisés à modifier les données |
| `access_attempts` | journal des essais de code ratés, pour limiter le bruteforce |
| `get_map_data(p_code)` | `SECURITY DEFINER` : vérifie le code et renvoie toutes les données de la carte |
| `set_access_code(p_code)` | admin uniquement : change le code d'accès |
| RLS | **aucune lecture anonyme**. Lecture et écriture des tables réservées aux utilisateurs présents dans `admins`. |

---

## 7. Après les migrations : activer ton compte admin

*SQL Editor → New query* : remplace l'e-mail, puis exécute.

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'ton.email@exemple.com';
```

Ensuite, sur le site (en local ou en ligne) :
1. Va sur `/admin` et connecte-toi.
2. Dans *Paramètres*, définis le code d'accès à la carte. **8 caractères minimum** recommandés (6 au minimum) : le site est public, seul le code protège la lecture.
3. Dans *Import / export Excel*, choisis `Classeur V3.xlsx`, vérifie l'aperçu des changements, puis valide.

Les autres admins s'ajoutent ensuite depuis `/admin` (*Paramètres → Admins*).

---

## 8. Vérifications et remarques

- *Table Editor* : aucune table ne doit afficher le badge « RLS disabled ».
- *Advisors → Security Advisor* : aucune alerte de niveau *Error*.
- **Mise en pause (plan Free)** : un projet Free sans activité pendant 7 jours est mis en pause. La carte ne répond plus jusqu'à ce que tu le relances depuis le dashboard. Le workflow GitHub Actions `keepalive.yml` interroge la base deux fois par jour et se réactive lui-même, pour que GitHub ne le coupe pas après 60 jours sans commit. Si l'outil devient critique, le plan Pro supprime ce risque.
- **Sauvegardes** : le plan Free n'a pas de sauvegardes restaurables en un clic. L'export Excel depuis `/admin` sert de sauvegarde simple : pense à en faire un après les grosses modifications.

---

## 9. Plus tard, côté GitHub (pour mémoire, détaillé dans le README)

- *Settings → Pages → Source* : **GitHub Actions**.
- *Settings → Secrets and variables → Actions → Variables* : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Le repo peut être public : **aucune donnée n'est dans le code**. Le fichier Excel réel (`Classeur V3.xlsx`) est exclu par `.gitignore`. Seul un fichier d'exemple fictif est versionné.
