# Modèle d'autorisation — relevé avant de bâtir la couche API

Relevé le 2026-11-19 à partir du `pg_dump` de la base de production
(44 politiques RLS). Ce document est la **spécification de référence** pour
porter l'autorisation de la base vers l'API.

## Pourquoi ce document

Aujourd'hui le navigateur parle directement à PostgREST et ce sont les
politiques RLS qui décident qui voit et modifie quoi. En déplaçant
l'autorisation dans l'API, il faut reproduire ces règles **volontairement** :
ce qui n'est pas réécrit devient une permission perdue, ou pire, une
permission accordée par défaut.

## Avertissement : les politiques RLS se combinent en OU

Une politique PostgreSQL « permissive » (le défaut, et toutes le sont ici)
s'ajoute aux autres : une ligne passe si **au moins une** politique l'accepte.
Deux politiques sur la même table et la même commande ne se restreignent donc
jamais l'une l'autre — la plus large gagne.

C'est la source des trois écarts ci-dessous.

## Écarts constatés : des restrictions neutralisées

### 1. `tickets` DELETE — « admins seulement » ne s'applique pas

```sql
CREATE POLICY "Only admins can delete tickets" ON public.tickets FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_profiles
                 WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "delete tickets" ON public.tickets FOR DELETE
  USING (auth.role() = 'authenticated');
```

La seconde accepte tout utilisateur connecté. **N'importe quel compte peut
supprimer n'importe quelle occurrence.** La première ne sert à rien.

### 2. `tickets` UPDATE — la règle « CPM sur ses propres occurrences » ne s'applique pas

```sql
CREATE POLICY "CPMs can update own tickets, others can update any" ON public.tickets
  FOR UPDATE USING (auth.uid() = created_by OR EXISTS (... 'admin','manager','service_desk' ...));

CREATE POLICY "update tickets" ON public.tickets FOR UPDATE
  USING (auth.role() = 'authenticated');
```

Même effet : **tout compte connecté modifie n'importe quelle occurrence.**

### 3. `plants` — l'écriture réservée aux admins ne s'applique pas

```sql
CREATE POLICY plants_write ON public.plants USING (EXISTS (... role = 'admin' ...));
CREATE POLICY authenticated_all ON public.plants TO authenticated USING (true) WITH CHECK (true);
```

**Tout compte connecté peut créer, modifier et supprimer une usine.**

> Ces trois écarts ressemblent à deux générations de politiques empilées sans
> retirer les anciennes. Dans l'application l'utilisateur ne voit pas les
> boutons (le garde-fou est `usePermissions` côté client), mais un appel REST
> direct avec un jeton de session valide passe.

## Le rôle `viewer` n'est pas appliqué par la base

Seule la modification/suppression de photos exclut `viewer`. Partout ailleurs
un `viewer` peut créer et modifier des occurrences, éditer les lignes
(**donc les coûts**) et supprimer des réunions. Le caractère « lecture seule »
du rôle n'existe que dans le hook `usePermissions` du navigateur.

**Conséquence pour l'API :** l'interface qui masque un bouton n'est pas une
autorisation. L'API doit porter la règle elle-même.

## Modèle retenu pour l'API

Rôles : `admin > manager > cpm > service_desk > viewer`.
« Authentifié » = tout compte actif, `viewer` compris.

| Ressource | Lecture | Création | Modification | Suppression |
|---|---|---|---|---|
| `brands`, `categories`, `clients`, `departments` | authentifié | admin | admin | admin |
| `plants` | authentifié | admin | admin | admin |
| `tickets` | authentifié | sauf `viewer` | créateur, ou admin/manager/service_desk | admin |
| `occurrence_lines` | authentifié | sauf `viewer` | sauf `viewer` | sauf `viewer` |
| `ticket_photos` | authentifié | sauf `viewer` | sauf `viewer` | sauf `viewer` |
| `ticket_history` | authentifié | API seulement | **jamais** | **jamais** |
| `meetings` | authentifié | admin/manager/service_desk | admin/manager/service_desk | admin/manager/service_desk |
| `meeting_tickets`, `meeting_actions` | authentifié | sauf `viewer` | sauf `viewer` | sauf `viewer` |
| `monthly_revenue` | authentifié | admin/manager | admin/manager | admin/manager |
| `saved_reports` | propriétaire ou `shared` | propriétaire ; `shared` réservé admin/manager | propriétaire, ou admin si `shared` | propriétaire ou admin |
| `user_profiles` | authentifié | admin | soi-même ou admin | admin |

### Ce qui change par rapport à aujourd'hui

Les lignes suivantes **resserrent** le comportement réel et demandent une
validation explicite avant d'être appliquées :

1. Supprimer une occurrence redevient réservé aux admins.
2. Modifier une occurrence redevient limité au créateur et aux rôles encadrants.
3. Écrire une usine redevient réservé aux admins.
4. `viewer` devient réellement en lecture seule partout.
5. `meetings` : modification et suppression alignées sur la création
   (admin/manager/service_desk) au lieu de « suppression ouverte à tous ».

### Ce qui est conservé tel quel

- `ticket_history` reste en ajout seul : jamais modifié, jamais supprimé.
- `saved_reports` garde son modèle (propriétaire / `shared`), déjà cohérent et
  le plus récent du lot, y compris le refus des comptes désactivés.
- `user_profiles` garde l'interdiction d'auto-élévation de rôle, aujourd'hui
  portée par le déclencheur `user_profiles_guard_privileges`. **Cette règle
  doit être reportée dans l'API**, elle ne survivra pas au changement de base.

## Points à vérifier

- `meetings` n'a **aucune politique UPDATE**. Les modifications de réunion
  devraient donc échouer aujourd'hui pour tout compte non `service_role`. À
  confirmer sur la page Réunions avant de trancher le comportement cible.
- `occurrence_lines` n'a aucune restriction de rôle alors que ces lignes
  portent les coûts. Le tableau ci-dessus propose « sauf viewer » ; à valider.


## Statut : appliqué en production le 2026-11-19

La migration `server/src/db/migration_2026-11-19_rls_cleanup.sql` a été exécutée
sur la base de production via le SQL Editor Supabase (`Success. No rows returned`),
puis vérifiée : **21 politiques** sur les 7 tables touchées, exactement celles
attendues.

| Table | Politiques restantes |
|---|---|
| `tickets` | delete (admin), insert (non-viewer), select (authentifié), update (créateur/encadrant) |
| `plants` | `plants_read` (SELECT), `plants_write` (ALL, admin) |
| `occurrence_lines` | select (authentifié), insert/update/delete (non-viewer) |
| `ticket_photos` | select (authentifié), insert (non-viewer), update/delete (Editors) |
| `meetings` | select (authentifié), insert et delete (admin/manager/service_desk) |
| `meeting_tickets`, `meeting_actions` | `_read` (SELECT), `_write` (ALL, non-viewer) |

Les trois politiques qui neutralisaient les restrictions (`delete tickets`,
`update tickets`, `authenticated_all`) ont disparu, ainsi que les deux doublons.

**Reste à faire :** ouvrir une session avec un compte `viewer` et confirmer que
la liste des occurrences et le tableau de bord s'affichent toujours — le
resserrement ne doit toucher que l'écriture.
