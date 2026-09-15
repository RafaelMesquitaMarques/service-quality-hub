# Edge Functions Supabase

Code source des fonctions déployées sur le projet `kbunsdmpesivntujvuzi`
(jusqu'au 2026-09-15, elles n'existaient que dans le tableau de bord Supabase).

| Fonction | Appelée par | Contrôle d'accès |
|---|---|---|
| `invite-user` | `client/src/pages/Admin/UserModal.jsx` (création d'utilisateur) | administrateur **actif** uniquement |
| `reset-password` | `client/src/pages/Admin/index.jsx` (réinitialisation du mot de passe) | administrateur **actif** uniquement |

Les deux fonctions utilisent la clé service (`SUPABASE_SERVICE_ROLE_KEY`, injectée
par Supabase) : elles contournent la RLS. Le contrôle de l'appelant est donc
fait **dans la fonction**, à partir du jeton de session (`Authorization: Bearer`) :
l'option « Verify JWT » de Supabase n'y suffit pas, la clé anon publique étant
elle-même un JWT valide.

Déploiement : copier `index.ts` dans l'éditeur de la fonction (Edge Functions →
fonction → Code → *Deploy updates*), ou `supabase functions deploy <nom>` avec la CLI.
