-- ============================================================
-- Service Quality Hub — Supabase / PostgreSQL Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USER PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   VARCHAR(100) NOT NULL,
  role        VARCHAR(20)  NOT NULL
                CHECK (role IN ('admin','manager','cpm','service_desk','viewer')),
  language    CHAR(2)      DEFAULT 'fr' CHECK (language IN ('fr','en')),
  active      BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all profiles"
  ON user_profiles FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can manage all profiles"
  ON user_profiles FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- 2. TICKETS (core table)
-- ============================================================
CREATE TABLE tickets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dates
  meeting_date          DATE,
  issue_reception_date  DATE        NOT NULL,
  date_yyyy_mm          CHAR(7),
  fiscal_year           INTEGER,
  fiscal_month          INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  -- Location & Order
  ship_to               VARCHAR(200),
  dd                    INTEGER,
  ref_so                VARCHAR(50),
  sc_number             VARCHAR(50),
  item                  VARCHAR(50),
  material_number       VARCHAR(100),
  sold_to               VARCHAR(200),

  -- Classification
  department            VARCHAR(50),
  brand                 VARCHAR(50),
  plant                 VARCHAR(20),
  categories            VARCHAR(100),
  status                VARCHAR(30)  DEFAULT 'not_started'
                          CHECK (status IN ('not_started','wip','completed','cancelled')),

  -- Issue details
  quality_issue         TEXT         NOT NULL,
  root_cause            TEXT,
  corrective_action     TEXT,
  corrective_action_no  VARCHAR(50),
  cortex_data           TEXT,

  -- Quantities
  affected_qty          INTEGER,
  total_qty             INTEGER,
  affected_pct          DECIMAL(8,6),

  -- Costs
  cost_approx           DECIMAL(10,2),
  supplier_credit       DECIMAL(10,2),

  -- Assignment
  created_by            UUID         REFERENCES user_profiles(id),
  assigned_to           UUID         REFERENCES user_profiles(id),

  -- Legacy import
  legacy_link           TEXT
);

-- Indexes
CREATE INDEX idx_tickets_status        ON tickets(status);
CREATE INDEX idx_tickets_meeting_date  ON tickets(meeting_date);
CREATE INDEX idx_tickets_reception     ON tickets(issue_reception_date);
CREATE INDEX idx_tickets_brand         ON tickets(brand);
CREATE INDEX idx_tickets_department    ON tickets(department);
CREATE INDEX idx_tickets_fiscal        ON tickets(fiscal_year, fiscal_month);
CREATE INDEX idx_tickets_sc            ON tickets(sc_number);
CREATE INDEX idx_tickets_created_by    ON tickets(created_by);

-- Full-text search
CREATE INDEX idx_tickets_fts ON tickets
  USING GIN (
    to_tsvector('english',
      COALESCE(quality_issue, '') || ' ' ||
      COALESCE(ship_to, '') || ' ' ||
      COALESCE(sold_to, '') || ' ' ||
      COALESCE(brand, '') || ' ' ||
      COALESCE(sc_number, '')
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read all tickets"
  ON tickets FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "CPMs can create tickets"
  ON tickets FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "CPMs can update own tickets, others can update any"
  ON tickets FOR UPDATE USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','manager','service_desk')
    )
  );

CREATE POLICY "Only admins can delete tickets"
  ON tickets FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- 3. TICKET PHOTOS
-- ============================================================
CREATE TABLE ticket_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  storage_key  TEXT        NOT NULL,
  filename     TEXT,
  mime_type    VARCHAR(50),
  size_bytes   INTEGER,
  uploaded_by  UUID        REFERENCES user_profiles(id),
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photos_ticket ON ticket_photos(ticket_id);

ALTER TABLE ticket_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read photos"
  ON ticket_photos FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload photos"
  ON ticket_photos FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Uploader or admin can delete photos"
  ON ticket_photos FOR DELETE USING (
    auth.uid() = uploaded_by OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- 4. TICKET HISTORY (audit trail)
-- ============================================================
CREATE TABLE ticket_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by  UUID        REFERENCES user_profiles(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  field       VARCHAR(50),
  old_value   TEXT,
  new_value   TEXT,
  note        TEXT
);

CREATE INDEX idx_history_ticket ON ticket_history(ticket_id);
CREATE INDEX idx_history_date   ON ticket_history(changed_at);

ALTER TABLE ticket_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read history"
  ON ticket_history FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "System can insert history"
  ON ticket_history FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 5. MEETINGS
-- ============================================================
CREATE TABLE meetings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_date DATE        NOT NULL UNIQUE,
  type         VARCHAR(30) DEFAULT 'quality_review'
                 CHECK (type IN ('quality_review','sales_review')),
  notes        TEXT,
  created_by   UUID        REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meetings_date ON meetings(meeting_date);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read meetings"
  ON meetings FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Managers and admins can create meetings"
  ON meetings FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','manager','service_desk')
    )
  );

-- ============================================================
-- 6. SUPABASE STORAGE BUCKET
-- ============================================================
-- Run this separately in Supabase Storage settings or via API:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('ticket-photos', 'ticket-photos', false);

-- Storage policy (authenticated users can upload, read own uploads)
-- CREATE POLICY "Authenticated upload" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'ticket-photos' AND auth.role() = 'authenticated');
-- CREATE POLICY "Authenticated read" ON storage.objects
--   FOR SELECT USING (bucket_id = 'ticket-photos' AND auth.role() = 'authenticated');

-- ============================================================
-- 7. HELPER VIEW — tickets with user info
-- ============================================================
CREATE VIEW tickets_with_users AS
  SELECT
    t.*,
    cp.full_name  AS created_by_name,
    cp.role       AS created_by_role,
    ap.full_name  AS assigned_to_name
  FROM tickets t
  LEFT JOIN user_profiles cp ON cp.id = t.created_by
  LEFT JOIN user_profiles ap ON ap.id = t.assigned_to;
