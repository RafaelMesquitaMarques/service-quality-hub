# Service Quality Hub

Application web de suivi des défauts qualité post-installation — Foliot Furniture.

Remplace le workflow Excel + SharePoint par une application full-stack responsive (mobile, tablette, desktop).

## Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **Base de données**: PostgreSQL via Supabase
- **Stockage photos**: Supabase Storage
- **Auth**: Supabase Auth (email + mot de passe)
- **i18n**: Français / Anglais

---

## Démarrage rapide

### 1. Prérequis
- Node.js 18+
- Un projet Supabase (gratuit sur supabase.com)

### 2. Cloner et installer

```bash
git clone https://github.com/rafaelmesquitamarques/service-quality-hub.git
cd service-quality-hub
npm run install:all
```

### 3. Base de données (Supabase)

1. Créer un nouveau projet sur [supabase.com](https://supabase.com)
2. Aller dans **SQL Editor**
3. Copier-coller le contenu de `server/src/db/schema.sql` et exécuter
4. Dans **Storage**, créer un bucket nommé `ticket-photos` (non-public)

### 4. Variables d'environnement

**Backend** (`server/.env`):
```bash
cp server/.env.example server/.env
# Remplir avec vos clés Supabase
```

**Frontend** (`client/.env.local`):
```bash
cp client/.env.example client/.env.local
# Remplir avec vos clés Supabase
```

Les clés se trouvent dans Supabase > Settings > API.

### 5. Lancer en développement

```bash
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

### 6. Créer le premier utilisateur admin

Dans Supabase > Authentication > Users, créer un utilisateur manuellement, puis dans SQL Editor:

```sql
INSERT INTO user_profiles (id, full_name, role, language)
VALUES ('uuid-de-l-utilisateur', 'Votre Nom', 'admin', 'fr');
```

---

## Importer l'historique Excel

1. Aller dans **Import Excel** (menu — rôle admin/manager requis)
2. Glisser-déposer `Quality_Meeting__Data_.xlsx` ou `KPI_Quality_Meeting.xlsx`
3. Vérifier l'aperçu (20 premières lignes)
4. Confirmer l'import

---

## Déploiement production

### Backend (Railway)
1. Créer un projet sur [railway.app](https://railway.app)
2. Connecter le repo GitHub
3. Configurer les variables d'environnement (même que `.env`)
4. Deploy automatique à chaque push sur `main`

### Frontend (Vercel ou GitHub Pages)
```bash
cd client && npm run build
# Déployer le dossier dist/
```

---

## Structure du projet

```
service-quality-hub/
├── client/          # React frontend
├── server/          # Node.js backend
│   └── src/
│       ├── db/      # Schema SQL + client Supabase
│       ├── routes/  # auth, tickets, photos, meetings, import, admin
│       └── middleware/
└── ARCHITECTURE.md  # Documentation technique complète
```

---

## Profils utilisateurs

| Rôle | Description |
|---|---|
| `admin` | Accès complet + gestion des utilisateurs |
| `manager` | Vue complète, approbation, rapports |
| `cpm` | Création/édition de ses propres tickets |
| `service_desk` | Traitement des tickets, saisie SC#/SAP |
| `viewer` | Lecture seule (VP Opérations, Production) |
