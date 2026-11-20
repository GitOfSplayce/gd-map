-- Carte commerciale Groupe : règles d'accès
--  * aucune lecture anonyme des tables : la carte passe par get_map_data(p_code) ;
--  * lecture et écriture réservées aux utilisateurs présents dans public.admins.

alter table public.zones enable row level security;
alter table public.commerciaux enable row level security;
alter table public.affectations enable row level security;
alter table public.objectifs enable row level security;
alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.access_attempts enable row level security;

-- Défense en profondeur : en plus de RLS, le rôle anonyme n'a aucun droit sur les tables.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- Droits explicites, pour ne pas dépendre de l'option « exposer automatiquement les nouvelles tables ».
-- RLS limite ensuite ces droits aux seuls admins.
grant usage on schema public to authenticated, service_role;
grant select on public.zones to authenticated;
grant select, insert, update, delete on public.commerciaux, public.affectations, public.objectifs to authenticated;
grant select, insert, delete on public.admins to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Code d'accès et journal des essais : uniquement via les fonctions SECURITY DEFINER.
revoke all on public.settings, public.access_attempts from authenticated;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "Admins : lecture des zones"
  on public.zones for select to authenticated
  using ((select public.is_admin()));

create policy "Admins : gestion des commerciaux"
  on public.commerciaux for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins : gestion des affectations"
  on public.affectations for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins : gestion des objectifs"
  on public.objectifs for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins : lecture des admins"
  on public.admins for select to authenticated
  using ((select public.is_admin()));

create policy "Admins : ajout d'un admin"
  on public.admins for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins : retrait d'un autre admin"
  on public.admins for delete to authenticated
  using ((select public.is_admin()) and user_id <> (select auth.uid()));
