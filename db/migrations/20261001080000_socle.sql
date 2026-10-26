-- Socle : ce que Supabase fournissait avant nos migrations, pour un PostgreSQL ordinaire (D-001).
--
-- Les migrations suivantes datent de Supabase et restent telles quelles : elles attendent des rôles
-- anon / authenticated / service_role, un schéma `extensions`, une table auth.users et auth.uid().
-- Elles ne s'appliquent qu'à une base neuve : les données de Supabase Cloud y sont copiées ensuite
-- (MIGRATION.md).
--
-- Sans PostgREST, c'est le serveur (server/db.ts) qui pose, pour chaque requête et dans sa
-- transaction, le rôle (anon sans session, authenticated avec), l'utilisateur de la session
-- (request.jwt.claim.sub, nom repris de PostgREST) et l'adresse IP du visiteur (app.client_ip).

create schema if not exists extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  -- Les droits par défaut de *_security.sql nomment le rôle postgres, absent si la base a un autre
  -- propriétaire : un rôle sans connexion suffit.
  if not exists (select from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
end;
$$;

-- Remplacée par la table "user" de Better Auth (*_portail.sql), puis supprimée.
create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
