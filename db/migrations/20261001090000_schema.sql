-- Carte commerciale Groupe : tables
create extension if not exists pgcrypto with schema extensions;

-- Référentiel des zones (départements, arrondissements de Paris, DROM, Monaco).
-- Rempli par la migration *_zones.sql, générée depuis src/lib/zones.ts.
create table public.zones (
  code text primary key,
  nom text not null,
  type text not null check (type in ('departement', 'arrondissement', 'drom', 'monaco')),
  region text not null default ''
);

create table public.commerciaux (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (btrim(nom) <> ''),
  statut text,
  manager1 text,
  manager2 text,
  couleur text not null default '#4363d8' check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  actif boolean not null default true,
  notes text,
  -- Colonnes reprises du fichier Excel (onglet V3) pour un export fidèle
  structures text[] not null default '{}' check (structures <@ array['MD', 'SP', 'MC', 'BK']),
  jours_an numeric,
  date_manager1 text,
  date_manager2 text,
  actions text,
  secteur text, -- colonne « Région » du fichier
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index commerciaux_nom_key on public.commerciaux (lower(btrim(nom)));

create table public.affectations (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.commerciaux (id) on delete cascade,
  structure text not null check (structure in ('MD', 'SP', 'MC', 'BK')),
  zone_code text not null references public.zones (code) on update cascade,
  couverture text not null default 'propre' check (couverture in ('propre', 'partiel', 'gestion')),
  unique (commercial_id, structure, zone_code)
);

create index affectations_zone_code_idx on public.affectations (zone_code);

-- Prévu pour plus tard : CA et objectif par commercial, structure et année
create table public.objectifs (
  commercial_id uuid not null references public.commerciaux (id) on delete cascade,
  structure text not null check (structure in ('MD', 'SP', 'MC', 'BK')),
  annee integer not null check (annee between 2000 and 2100),
  ca numeric,
  objectif numeric,
  primary key (commercial_id, structure, annee)
);

-- Ligne unique : hash bcrypt du code d'accès à la carte
create table public.settings (
  id integer primary key default 1 check (id = 1),
  access_code_hash text,
  access_code_updated_at timestamptz,
  access_code_updated_by uuid references auth.users (id) on delete set null
);

insert into public.settings (id) values (1);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- Essais de code ratés, pour limiter le bruteforce de get_map_data
create table public.access_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index access_attempts_ip_created_at_idx on public.access_attempts (ip, created_at);
create index access_attempts_created_at_idx on public.access_attempts (created_at);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger commerciaux_touch_updated_at
before update on public.commerciaux
for each row execute function public.touch_updated_at();
