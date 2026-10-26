-- Sortie de Supabase : connexion par le portail GDCOM, rôles de la carte tenus par gd-map (D-001, D-002).

-- ---------------------------------------------------------------------------------------------------
-- 1. Tables de connexion de Better Auth, telles que les écrit `npm run auth:schema`. Ne pas les
--    retoucher à la main : relancer la commande et reporter ses changements dans une nouvelle migration.
-- ---------------------------------------------------------------------------------------------------

create table public."user" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
  "idpUserId" text,
  "hasAccess" boolean
);

create table public."session" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid not null references public."user" ("id") on delete cascade
);

create table public."account" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" uuid not null references public."user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null
);

create table public."verification" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create index "session_userId_idx" on public."session" ("userId");
create index "account_userId_idx" on public."account" ("userId");
create index "verification_identifier_idx" on public."verification" ("identifier");

-- Seul le serveur, propriétaire des tables, les lit et les écrit : RLS sans aucune règle, et aucun droit
-- pour les rôles de l'API.
alter table public."user" enable row level security;
alter table public."session" enable row level security;
alter table public."account" enable row level security;
alter table public."verification" enable row level security;
revoke all on public."user", public."session", public."account", public."verification" from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Rôles de la carte (D-002). Une personne admise par le portail sans ligne ici est lectrice.
-- ---------------------------------------------------------------------------------------------------

create table public.acces (
  email text primary key
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('admin', 'responsable')),
  -- Périmètre d'un responsable : les managers dont il saisira les chiffres (rôle à venir).
  managers text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by text
);

alter table public.acces enable row level security;
revoke all on public.acces from anon;
grant select, insert, update, delete on public.acces to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Qui est connecté, et avec quels droits
-- ---------------------------------------------------------------------------------------------------

create function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from public."user" u where u.id = (select auth.uid());
$$;

-- Une de ses organisations a le droit d'usage `gd-map` (relu par le portail à chaque connexion).
create function public.has_map_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u."hasAccess" from public."user" u where u.id = (select auth.uid())), false);
$$;

-- Admin : droit d'usage du portail et rôle admin dans gd-map. Le rôle est relu à chaque requête :
-- un retrait vaut aussitôt.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."user" u
    join public.acces a on a.email = lower(u.email)
    where u.id = (select auth.uid()) and coalesce(u."hasAccess", false) and a.role = 'admin'
  );
$$;

create policy "Admins : lecture des rôles"
  on public.acces for select to authenticated
  using ((select public.is_admin()));

create policy "Admins : ajout d'un rôle"
  on public.acces for insert to authenticated
  with check ((select public.is_admin()));

-- Personne ne change ni ne retire son propre rôle : il reste donc toujours au moins un admin.
create policy "Admins : modification du rôle d'un autre"
  on public.acces for update to authenticated
  using ((select public.is_admin()) and email <> (select public.current_email()))
  with check ((select public.is_admin()));

create policy "Admins : retrait du rôle d'un autre"
  on public.acces for delete to authenticated
  using ((select public.is_admin()) and email <> (select public.current_email()));

-- Dernière connexion par le portail : la session la plus récente, ou, une fois déconnecté, le compte,
-- que Better Auth met à jour à chaque retour du portail.
create function public.last_sign_in(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select max(s."createdAt") from public."session" s where s."userId" = p_user),
    (select max(a."updatedAt") from public."account" a where a."userId" = p_user)
  );
$$;

-- Page Paramètres : les rôles, et les personnes déjà venues par le portail (pour en nommer une admin).
create function public.list_acces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', a.email, 'role', a.role, 'managers', a.managers,
        'created_at', a.created_at, 'created_by', a.created_by,
        'name', u.name, 'last_sign_in_at', public.last_sign_in(u.id)
      ) order by a.role, a.email)
      from public.acces a
      left join public."user" u on lower(u.email) = a.email
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', lower(u.email), 'name', u.name, 'has_access', coalesce(u."hasAccess", false),
        'last_sign_in_at', public.last_sign_in(u.id)
      ) order by u.name)
      from public."user" u
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Ce qui pointait vers les comptes Supabase
-- ---------------------------------------------------------------------------------------------------

alter table public.settings
  drop constraint settings_access_code_updated_by_fkey,
  add constraint settings_access_code_updated_by_fkey
    foreign key (access_code_updated_by) references public."user" ("id") on delete set null;

create or replace function public.get_access_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'configured', s.access_code_hash is not null,
      'updated_at', s.access_code_updated_at,
      'updated_by', (select lower(u.email) from public."user" u where u.id = s.access_code_updated_by)
    )
    from public.settings s where s.id = 1
  );
end;
$$;

-- get_map_data : un lecteur connecté par le portail ouvre la carte sans code ; l'IP du visiteur
-- vient du serveur, qui la lit dans X-Forwarded-For tel que l'écrit Traefik. cf-connecting-ip n'est
-- plus lu : sans Cloudflare devant, le visiteur l'écrit lui-même (D-004).
create or replace function public.get_map_data(p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_reader boolean := v_admin or public.has_map_access();
  v_ip text := coalesce(nullif(current_setting('app.client_ip', true), ''), 'inconnue');
  v_hash text;
begin
  if not v_reader then
    delete from public.access_attempts where created_at < now() - interval '1 day';

    if (select count(*) from public.access_attempts
        where ip = v_ip and created_at > now() - interval '15 minutes') >= 10
      or (select count(*) from public.access_attempts
        where created_at > now() - interval '1 hour') >= 300 then
      return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
    end if;

    select access_code_hash into v_hash from public.settings where id = 1;
    if v_hash is null then
      return jsonb_build_object('ok', false, 'error', 'not_configured');
    end if;

    if p_code is null or extensions.crypt(p_code, v_hash) is distinct from v_hash then
      insert into public.access_attempts (ip) values (v_ip);
      return jsonb_build_object('ok', false, 'error', 'invalid_code');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'admin', v_admin,
    'commerciaux', coalesce((
      select jsonb_agg(
        case when v_admin then to_jsonb(c) - 'created_at'
        else jsonb_build_object(
          'id', c.id, 'nom', c.nom, 'statut', c.statut, 'manager1', c.manager1, 'manager2', c.manager2,
          'couleur', c.couleur, 'actif', c.actif, 'structures', c.structures, 'secteur', c.secteur, 'ordre', c.ordre,
          'telephone', c.telephone, 'email', c.email
        ) end
        order by c.ordre, c.nom)
      from public.commerciaux c
      where v_admin or c.actif
    ), '[]'::jsonb),
    'affectations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'commercial_id', a.commercial_id, 'structure', a.structure,
        'zone_code', a.zone_code, 'couverture', a.couverture))
      from public.affectations a
      join public.commerciaux c on c.id = a.commercial_id
      where v_admin or c.actif
    ), '[]'::jsonb),
    -- CA et objectifs : réservés aux admins (ni avec le code d'accès, ni pour un lecteur)
    'objectifs', case when v_admin then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
    ), '[]'::jsonb) else '[]'::jsonb end,
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('nom', m.nom, 'couleur', m.couleur, 'telephone', m.telephone, 'email', m.email) order by m.nom)
      from public.managers m
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'ordre', s.ordre) order by s.ordre, s.code)
      from public.structures s
    ), '[]'::jsonb),
    'settings', (select jsonb_build_object('default_shared_mode', s.default_shared_mode) from public.settings s where s.id = 1),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

-- Les admins Supabase deviennent des rôles par adresse (la copie des données les reprend, MIGRATION.md).
insert into public.acces (email, role, created_at, created_by)
select lower(btrim(email)), 'admin', created_at, 'reprise Supabase' from public.admins
on conflict (email) do nothing;

drop table public.admins;
drop table auth.users;
-- Le maintien en éveil du plan Free de Supabase n'a plus lieu d'être.
drop function public.ping();

-- ---------------------------------------------------------------------------------------------------
-- 5. Droits d'exécution
-- ---------------------------------------------------------------------------------------------------

revoke execute on function public.current_email(), public.has_map_access(), public.list_acces(), public.last_sign_in(uuid) from public, anon, authenticated;
revoke execute on function public.current_email(), public.has_map_access(), public.list_acces() from public, anon;
grant execute on function public.current_email(), public.has_map_access(), public.list_acces() to authenticated;
revoke execute on function public.get_access_status() from public, anon;
grant execute on function public.get_access_status() to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
