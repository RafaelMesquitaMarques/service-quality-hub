# Service Quality Hub — Architecture Document
**Version 1.0 — May 2026**
**For: Foliot Furniture | Sales & Quality Teams**

---

## 1. Overview

Service Quality Hub (SQH) is a full-stack web application that replaces the current Excel + SharePoint workflow for tracking post-installation quality defects. It supports the complete lifecycle from defect report to resolution, with weekly review dashboards for management.

The application is **completely independent** from SupplirQ but follows the same GitHub-hosted deployment model.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 18 + Vite | Fast dev, same ecosystem as SupplirQ |
| Styling | Tailwind CSS v3 | Responsive (mobile/tablet/desktop) |
| Backend | Node.js + Express | JavaScript full-stack, familiar |
| Database | PostgreSQL via Supabase | Free tier, auth included, file storage |
| File Storage | Supabase Storage | Replaces SharePoint for photos |
| Auth | Supabase Auth (JWT) | Email + password, role-based |
| Hosting | Railway (backend) + GitHub Pages or Vercel (frontend) | Same pattern as SupplirQ |
| i18n | react-i18next | French / English per user |

---

## 3. Repository Structure

```
service-quality-hub/
├── client/                   # React frontend (Vite)
│   ├── src/
│   │   ├── components/       # Shared UI components
│   │   ├── pages/            # Route-level pages
│   │   │   ├── Dashboard/
│   │   │   ├── Tickets/
│   │   │   ├── WeeklyReview/
│   │   │   ├── Import/
│   │   │   └── Admin/
│   │   ├── hooks/            # Custom React hooks
│   │   ├── services/         # API calls
│   │   ├── store/            # State management (Zustand)
│   │   ├── i18n/             # FR / EN translations
│   │   │   ├── fr.json
│   │   │   └── en.json
│   │   └── utils/
│   ├── public/
│   └── package.json
│
├── server/                   # Node.js + Express backend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── tickets.js
│   │   │   ├── users.js
│   │   │   ├── meetings.js
│   │   │   └── import.js
│   │   ├── middleware/
│   │   │   ├── auth.js       # JWT verification + role check
│   │   │   └── upload.js     # Multer for photo upload
│   │   ├── db/
│   │   │   ├── schema.sql    # Database schema
│   │   │   └── client.js     # Supabase client
│   │   └── app.js
│   └── package.json
│
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD pipeline
├── README.md
└── docker-compose.yml        # Local development
```

---

## 4. Database Schema (PostgreSQL / Supabase)

### 4.1 Users & Auth

```sql
-- Managed by Supabase Auth, extended with profile table
CREATE TABLE user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name   VARCHAR(100) NOT NULL,
  role        VARCHAR(20) NOT NULL
                CHECK (role IN ('admin','manager','cpm','service_desk','viewer')),
  language    CHAR(2) DEFAULT 'fr' CHECK (language IN ('fr','en')),
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 Tickets (Quality Issues)

```sql
CREATE TABLE tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dates
  meeting_date        DATE,
  issue_reception_date DATE NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Location & Order
  ship_to             VARCHAR(200),
  dd                  INTEGER,            -- Foliot DD number
  ref_so              VARCHAR(50),        -- SAP Sales Order
  sc_number           VARCHAR(50),        -- SAP Service Call #
  item                VARCHAR(50),
  material_number     VARCHAR(100),       -- Foliot ID
  sold_to             VARCHAR(200),

  -- Classification
  department          VARCHAR(50),
  brand               VARCHAR(50),
  plant               VARCHAR(20),
  categories          VARCHAR(100),
  status              VARCHAR(30) DEFAULT 'not_started'
                        CHECK (status IN (
                          'not_started','wip','completed','cancelled'
                        )),

  -- Issue details
  quality_issue       TEXT NOT NULL,
  root_cause          TEXT,
  corrective_action   TEXT,
  corrective_action_no VARCHAR(50),

  -- Quantities
  affected_qty        INTEGER,
  total_qty           INTEGER,
  affected_pct        DECIMAL(6,4),       -- computed or entered

  -- Costs
  cost_approx         DECIMAL(10,2),      -- shipping included
  supplier_credit     DECIMAL(10,2),

  -- SAP data (entered manually by Service Desk)
  cortex_data         TEXT,

  -- Fiscal
  fiscal_year         INTEGER,
  fiscal_month        INTEGER,
  date_yyyy_mm        CHAR(7),

  -- Assignment
  created_by          UUID REFERENCES user_profiles(id),
  assigned_to         UUID REFERENCES user_profiles(id),

  -- Sharepoint legacy link (for imported data)
  legacy_link         TEXT
);

-- Full-text search index
CREATE INDEX tickets_fts ON tickets
  USING GIN (to_tsvector('english', coalesce(quality_issue,'') || ' ' || coalesce(ship_to,'')));

-- Fast filters
CREATE INDEX tickets_status       ON tickets(status);
CREATE INDEX tickets_meeting_date ON tickets(meeting_date);
CREATE INDEX tickets_brand        ON tickets(brand);
CREATE INDEX tickets_department   ON tickets(department);
```

### 4.3 Photos

```sql
CREATE TABLE ticket_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,    -- Supabase Storage path
  filename    TEXT,
  uploaded_by UUID REFERENCES user_profiles(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.4 Status History (Audit Trail)

```sql
CREATE TABLE ticket_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by  UUID REFERENCES user_profiles(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  field       VARCHAR(50),
  old_value   TEXT,
  new_value   TEXT,
  note        TEXT
);
```

### 4.5 Meetings (Weekly Review Sessions)

```sql
CREATE TABLE meetings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_date DATE NOT NULL UNIQUE,
  type         VARCHAR(30) DEFAULT 'quality_review',
  notes        TEXT,
  created_by   UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. User Roles & Permissions

| Action | Admin | Manager | CPM | Service Desk | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Create ticket | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit any ticket | ✅ | ✅ | Own only | ✅ | ❌ |
| Delete ticket | ✅ | ❌ | ❌ | ❌ | ❌ |
| Upload photos | ✅ | ✅ | ✅ | ✅ | ❌ |
| Change status | ✅ | ✅ | ✅ | ✅ | ❌ |
| Enter SC# / SAP data | ✅ | ✅ | ❌ | ✅ | ❌ |
| View all tickets | ✅ | ✅ | ✅ | ✅ | ✅ |
| Weekly review | ✅ | ✅ | ✅ | ✅ | ✅ |
| Import Excel | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ | ❌ | ❌ |
| View KPI dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 6. API Routes

### Authentication
```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
PATCH  /api/auth/me/language
PATCH  /api/auth/me/password
```

### Tickets
```
GET    /api/tickets              # List with filters & pagination
POST   /api/tickets              # Create new ticket
GET    /api/tickets/:id          # Get single ticket + photos + history
PATCH  /api/tickets/:id          # Update ticket (role-checked)
DELETE /api/tickets/:id          # Admin only
GET    /api/tickets/export/xlsx  # Download filtered list as Excel
```

### Photos
```
POST   /api/tickets/:id/photos         # Upload (multipart)
DELETE /api/tickets/:id/photos/:photoId
GET    /api/tickets/:id/photos/:photoId/url  # Signed URL
```

### Meetings
```
GET    /api/meetings             # List meetings
GET    /api/meetings/:date       # Tickets for that week
POST   /api/meetings             # Create meeting record
```

### Import
```
POST   /api/import/excel         # Upload + parse Excel history
GET    /api/import/status/:jobId # Import job progress
```

### Admin
```
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:id
DELETE /api/admin/users/:id
GET    /api/admin/stats
```

---

## 7. Frontend Pages

### 7.1 Dashboard (`/`)
- KPI cards: total open tickets, total cost (month/year), completion rate, by department
- Bar chart: tickets by category (Damaged, Missing Unit, Missing Component, etc.)
- Line chart: tickets over time (monthly trend)
- Table: top 10 most costly open tickets
- Quick-filter: this week / this month / this fiscal year

### 7.2 Tickets (`/tickets`)
- Full table with all columns (sortable, filterable)
- Filters: status, department, brand, plant, date range, search text
- Click row → detail panel (or navigate to `/tickets/:id`)
- Bulk status update (manager/admin)
- Export to Excel button

### 7.3 Ticket Detail (`/tickets/:id`)
- All fields, editable based on role
- Photo gallery (upload, view, delete)
- Status history timeline
- Status transition buttons (role-based)
- SAP section: SC#, REF SO, Cortex Data (Service Desk only)

### 7.4 New Ticket (`/tickets/new`)
- Form with all required fields
- Photo upload (drag & drop)
- Auto-populate: fiscal year/month from date

### 7.5 Weekly Review (`/meetings`)
- Calendar view of past/upcoming meetings
- Click week → meeting view with all tickets for that meeting date
- Live status changes during meeting
- Filter within meeting view (by status, department, brand)
- Notes field per meeting

### 7.6 Import (`/import`)
- Drag & drop Excel upload
- Preview first 20 rows before confirming
- Progress bar for large files
- Conflict resolution: skip / overwrite existing SC#

### 7.7 Admin (`/admin`)
- User list with role badges
- Create/edit/deactivate users
- System stats (total tickets, storage used)

---

## 8. Ticket Workflow

```
1. CPM receives email from client/installer
          ↓
2. CPM creates ticket in SQH
   (photos attached, all available fields filled)
          ↓
3. Status: NOT STARTED
   Ticket assigned to Service Desk
          ↓
4. Service Desk enters SC#, SAP data, adds photos
   Status: WIP
          ↓
5. Service Desk returns ticket to CPM
   Status: WIP → Completed (or back to CPM)
          ↓
6. Ticket forwarded to Production (status note)
          ↓
7. Weekly: Manager reviews list with Quality + Service Desk
8. Weekly: VP Operations joins broader sales review
```

---

## 9. Data Migration Plan

### Phase 1 (Launch)
- Import `Quality_Meeting__Data_.xlsx` → Data sheet
- Import `KPI_Quality_Meeting.xlsx` → Data Quality sheet
- All imported records get `legacy_link` field preserved
- Status mapping: "Not started" → `not_started`, "Completed" → `completed`, "WIP" → `wip`

### Phase 2 (Later)
- Import SAP task/service call data when ready
- Import cost estimates when format is confirmed

---

## 10. Deployment

### Development
```bash
# Clone repo
git clone https://github.com/[org]/service-quality-hub.git

# Install dependencies
cd client && npm install
cd ../server && npm install

# Set environment variables
cp server/.env.example server/.env
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, JWT_SECRET

# Start dev servers
npm run dev  # starts both client (5173) + server (3001) via concurrently
```

### Production
- **Backend**: Railway (auto-deploy from `main` branch)
- **Frontend**: Vercel or GitHub Pages (Vite build → `dist/`)
- **Database**: Supabase (hosted PostgreSQL, free tier = 500MB, 2GB storage)
- **Photos**: Supabase Storage (free tier = 1GB)

### Environment Variables
```
# Server
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
JWT_SECRET=
CORS_ORIGIN=https://your-frontend.vercel.app
PORT=3001

# Client (Vite)
VITE_API_URL=https://your-api.railway.app
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## 11. Phase 2 Roadmap (Future)

- Email parsing: auto-create draft ticket from forwarded email (Zapier or custom webhook)
- SAP integration: auto-populate SC# and service call data via SAP API
- Mobile notifications: push notifications when ticket assigned
- KPI exports: auto-generated weekly PDF report for VP Operations
- Microsoft SSO: migrate from email/password to Azure AD login
- Supplier portal: external link for suppliers to view their tickets (read-only)

---

## 12. Key Design Decisions

**Why Supabase instead of AWS/Azure?**
Free tier covers the initial data volume (~500 tickets/month). Built-in auth, storage, and real-time subscriptions. Can migrate to self-hosted later if needed.

**Why not replace SAP?**
SAP is the system of record. SQH is a workflow layer on top — it captures the defect data and photos, while SC# and service call numbers remain the link back to SAP. Phase 2 can add bi-directional sync.

**Why separate repo from SupplirQ?**
Different teams, different deployment cadence, different stakeholders. Clean separation avoids merge conflicts and lets each app evolve independently.

**Why not use email integration in Phase 1?**
Email parsing is unreliable (variable formats, attachments, spam). CPMs already read the emails — having them create the ticket takes 2 minutes and ensures data quality. Phase 2 can add automation once the workflow is stable.
