# Surface de l'API — relevé des appels du front

Relevé le 2026-11-19 en parcourant les 120 points d'appel à Supabase dans
`client/src/`. Ce document dérive la liste des endpoints de ce que le front
fait réellement aujourd'hui, pas de ce qu'on aimerait qu'il fasse.

Il complète [02-modele-autorisation.md](02-modele-autorisation.md), qui dit
**qui** a le droit de faire quoi ; celui-ci dit **quoi** exposer.

## Où vivent les appels

| Emplacement | Appels | Ce qu'il couvre |
|---|---|---|
| `services/api.js` | ~50 | occurrences, rapports, revenus, admin |
| 16 fichiers de pages et composants | ~70 | réunions, usines, lignes, photos, référentiels |

**C'est le point important pour chiffrer le travail :** la couche de données ne
couvre que la moitié. L'autre moitié est écrite directement dans les composants,
donc bâtir l'API ne touche pas un fichier mais dix-sept.

## Ce que l'API corrige au passage

Ces défauts viennent tous du même fait : le navigateur parle directement à la
base, donc il ne peut pas ouvrir de transaction.

### 1. Les écritures multi-étapes ne sont pas atomiques

| Opération | Aujourd'hui | Si une étape échoue |
|---|---|---|
| Créer une occurrence | 3 insertions séparées (en-tête, lignes, photos), **dupliquées dans 3 composants** | occurrence sans ses lignes |
| Modifier une occurrence | 3 allers-retours (lecture du snapshot, écriture, historique) | modification sans trace |
| Supprimer une occurrence | 3 suppressions en cascade côté client (photos, lignes, en-tête) | lignes et photos orphelines |
| Enregistrer les revenus | transaction via la fonction `save_revenue_year` | déjà corrigé — le repli non transactionnel est du code mort |

Chacune devient **un endpoint, une transaction**.

### 2. La piste d'audit est écrite par le client

`ticket_history` est alimentée depuis le navigateur (`logTicketHistory`,
`logLineHistory`, `logLineEvent`). Le client décide donc de ce qui entre dans
le journal d'audit — et peut ne rien y mettre. Un journal que l'auditté
contrôle n'est pas un journal d'audit.

Côté serveur, l'historique devient un effet de bord de l'écriture, impossible
à contourner.

### 3. La pagination et le découpage en lots disparaissent

`fetchLineCostTotals` et `fetchOccurrenceLines` découpent les identifiants par
paquets de 150 (limite de longueur d'URL de PostgREST) et paginent chaque
paquet par 1000 (PostgREST tronque **silencieusement** au-delà). Le tableau de
bord d'une année fiscale déclenche ainsi une vingtaine de requêtes.

Côté serveur, c'est une jointure.

De même, `fetchReportDataset` charge **toute la base** dans le navigateur —
2 565 occurrences sur 37 colonnes, 2 817 lignes sur 22, plus les profils, les
liens de réunion et les référentiels — avec des vérifications de complétude
pour détecter une troncature. Un endpoint, ou un moteur de rapport côté
serveur, remplace tout ça.

## Les endpoints

### Authentification
```
POST   /auth/login              POST   /auth/logout
GET    /auth/session            POST   /auth/password
```

### Occurrences
```
GET    /occurrences             filtres : fiscal_year, status, plant, brand,
                                department, search, date_from, date_to
GET    /occurrences/:id
POST   /occurrences             transactionnel : en-tête + lignes + photos
PATCH  /occurrences/:id         transactionnel : écriture + historique
DELETE /occurrences/:id         transactionnel : cascade photos + lignes
GET    /occurrences/:id/history
```

### Lignes d'occurrence
```
POST   /occurrences/:id/lines
PATCH  /lines/:id
DELETE /lines/:id
```
Chacune doit aussi écrire l'historique et resynchroniser l'intitulé de
l'occurrence — aujourd'hui `syncOccurrenceTitle` est un appel client distinct
qu'on peut oublier.

### Photos
```
GET    /occurrences/:id/photos  POST   /occurrences/:id/photos
PATCH  /photos/:id              DELETE /photos/:id
```
La suppression doit retirer **le fichier stocké en plus de la ligne**, ce qui
n'est pas garanti aujourd'hui.

### Tableau de bord et rapports
```
GET    /dashboard?fiscal_year=  occurrences + lignes du périmètre, en une fois
GET    /reports/dataset         le jeu de données complet
GET    /saved-reports           POST   /saved-reports
PATCH  /saved-reports/:id       DELETE /saved-reports/:id
```

### Revenus
```
GET    /revenue
PUT    /revenue/:fiscalYear     remplace l'année entière, transactionnel
```

### Référentiels
```
GET|POST /plants  /brands  /departments  /categories  /clients
PATCH|DELETE  .../:id
```

### Réunions
```
GET|POST /meetings        PATCH|DELETE /meetings/:id
GET|PUT  /meetings/:id/occurrences      (table meeting_tickets)
GET|POST /meetings/:id/actions
PATCH|DELETE /actions/:id
```

### Administration
```
GET    /users             POST   /users          (invitation)
PATCH  /users/:id         DELETE /users/:id
POST   /users/:id/avatar  GET    /admin/stats
POST   /import            (Excel — déjà partiellement dans server/)
```

Soit une quarantaine d'endpoints pour 120 points d'appel : le rapport vient de
ce que beaucoup d'appels actuels sont des morceaux d'une même opération.

## Bogue confirmé — CORRIGÉ le 2026-11-19

> Politique UPDATE ajoutée (`migration_2026-11-19b_meetings_update_policy.sql`,
> appliquée et vérifiée : 4 politiques sur `meetings`) et les 4 écritures de
> `Meetings/index.jsx` contrôlent désormais le nombre de lignes touchées.
> Le récit ci-dessous est conservé parce que le piège vaut pour toute la base.

### Enregistrer des notes de réunion ne faisait rien

`Meetings/index.jsx` ligne 608 :

```js
const { error } = await supabase.from('meetings')
  .update({ notes, updated_at: new Date().toISOString() }).eq('id', selId)
if (error) throw error
```

La table `meetings` n'a **aucune politique RLS pour UPDATE** (vérifié le
2026-11-19 : seulement SELECT, INSERT et DELETE). Un UPDATE ne correspond donc
à aucune ligne autorisée : PostgREST ne renvoie pas d'erreur, il modifie zéro
ligne. Le code ne teste que `error`, donc `onSuccess` se déclenche et un toast
annonce que les notes sont enregistrées.

Vérifié sur les données de production du 2026-11-18 :

| | |
|---|---|
| Réunions (juin → novembre 2026) | 24 |
| Avec des notes non vides | **0** |
| Avec `updated_at` différent de `created_at` | **0** |

Aucune réunion n'a jamais été modifiée avec succès, en six mois d'utilisation.

**Correctif :** ajouter la politique UPDATE manquante, alignée sur la création
et la suppression (admin / manager / service_desk). C'est un **élargissement**,
volontairement exclu de la migration de sécurité du 2026-11-19 qui ne faisait
que resserrer — mais il s'agit d'une fonctionnalité cassée, pas d'une mesure de
sécurité.

À faire en même temps : le front doit vérifier le **nombre de lignes affectées**
et pas seulement l'absence d'erreur. Dans l'API, une modification qui ne touche
aucune ligne devra répondre 404, jamais 200.
