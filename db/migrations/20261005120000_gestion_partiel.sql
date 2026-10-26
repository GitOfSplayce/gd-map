-- Nouvelle couverture « gestion-partiel » (suffixe GP dans le fichier Excel), en plus de propre, partiel et gestion.
alter table public.affectations
  drop constraint affectations_couverture_check,
  add constraint affectations_couverture_check
    check (couverture in ('propre', 'partiel', 'gestion', 'gestion_partiel'));
