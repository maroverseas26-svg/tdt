-- Todaytec CRM data (moved from Supabase). Every app table is rows of (id, data JSON,
-- updated_at), served to the frontend through the PostgREST-compatible /rest/v1 API.

-- All tables except pos, keyed by (table name, row id).
CREATE TABLE IF NOT EXISTS crm_rows (
  tbl        TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (tbl, id)
) WITHOUT ROWID;

-- POs: one row per record. Generated columns expose the fields the app filters, sorts and
-- aggregates on, so those queries use indexes instead of parsing every row.
CREATE TABLE IF NOT EXISTS pos (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT,
  is_obj  INTEGER GENERATED ALWAYS AS (json_type(data) = 'object') VIRTUAL,
  deleted INTEGER GENERATED ALWAYS AS (
    CASE WHEN json_type(data, '$._deleted') = 'true'
           OR lower(CAST(json_extract(data, '$._deleted') AS TEXT)) IN ('true', 't', 'yes', 'y', 'on', '1')
         THEN 1 ELSE 0 END) VIRTUAL,
  d       TEXT GENERATED ALWAYS AS (CAST(json_extract(data, '$.date') AS TEXT)) VIRTUAL,
  cust    TEXT GENERATED ALWAYS AS (CAST(json_extract(data, '$.customerId') AS TEXT)) VIRTUAL,
  pic     TEXT GENERATED ALWAYS AS (CAST(json_extract(data, '$.pic') AS TEXT)) VIRTUAL,
  po_no   TEXT GENERATED ALWAYS AS (CAST(json_extract(data, '$.poNumber') AS TEXT)) VIRTUAL,
  inv_no  TEXT GENERATED ALWAYS AS (CAST(json_extract(data, '$.invNo') AS TEXT)) VIRTUAL
);
CREATE INDEX IF NOT EXISTS pos_live_date ON pos (deleted, d);
CREATE INDEX IF NOT EXISTS pos_cust ON pos (cust);
CREATE INDEX IF NOT EXISTS pos_pic ON pos (pic);
CREATE INDEX IF NOT EXISTS pos_po_no ON pos (po_no);
CREATE INDEX IF NOT EXISTS pos_inv_no ON pos (inv_no);

-- Attachments moved out of records (see src/files.js): content-addressed, chunked.
CREATE TABLE IF NOT EXISTS files (
  key        TEXT NOT NULL,                     -- sha256 of the content
  part       INTEGER NOT NULL,
  mime       TEXT,
  name       TEXT,
  size       INTEGER,
  data       BLOB NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (key, part)
) WITHOUT ROWID;
