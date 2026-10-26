-- Aggregate caches for the PO RPCs (src/rpc.js), so the dashboards stop scanning `pos`
-- (the free plan allows 5M rows read per day; one session used ~900k before this).
--
-- po_agg_cache: one row per PO-date bucket — the month of `date` (YYYY-MM) for well-formed
-- YYYY-MM-DD dates, '#' for every other date (blank, null, odd formats). Each row holds that
-- bucket's live POs already grouped the way po_agg / po_agg_material / po_month_totals
-- group them (JSON, computed by the same SQL the RPCs used before, see rpc.js). agg IS NULL
-- marks the bucket dirty: it is recomputed from `pos` (through the date index) the next
-- time an RPC needs it. Recomputing instead of keeping running sums keeps the numbers
-- exactly what a full scan gives (no float drift from subtracting).
-- aggf / matf are the bucket's rows already in the RPC's output form (objects, codes
-- mapped, sorted), so a range of whole months is answered by concatenating them — no
-- per-request parsing/sorting, which would not fit the free plan's 10 ms CPU per request.
CREATE TABLE IF NOT EXISTS po_agg_cache (
  dk   TEXT PRIMARY KEY,  -- 'YYYY-MM' or '#'
  agg  TEXT,              -- [[yr, mo, pic, cust, grp, amount, sqm, cnt, d], ...]  (d only in '#')
  mat  TEXT,              -- [[yr, mo, src, pic, cust, amount, sqm, cnt, d], ...]  (d only in '#')
  tot  TEXT,              -- [[yr, CAST(mo AS INTEGER), amount, sqm, cnt], ...]
  ym   TEXT,              -- the one (yr, mo) of every row, '*' when there are several / '#'
  aggf TEXT,              -- po_agg output rows of this bucket
  matf TEXT               -- po_agg_material output rows of this bucket
) WITHOUT ROWID;

-- po_customer_stats per customer: data NULL = dirty, '' = no live POs, else the stats row
-- as a JSON array (recomputed for dirty customers only, through the cust index).
CREATE TABLE IF NOT EXISTS po_cust_stats (
  cust TEXT PRIMARY KEY,
  data TEXT
) WITHOUT ROWID;

-- Any write that adds, changes or removes a live PO marks its old and new date bucket and
-- customer dirty. A rewrite with identical data (re-sync, idempotent upsert) changes nothing.
CREATE TRIGGER IF NOT EXISTS pos_cache_ins AFTER INSERT ON pos
WHEN NEW.is_obj = 1 AND NEW.deleted = 0
BEGIN
  INSERT INTO po_agg_cache (dk)
    SELECT CASE WHEN NEW.d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(NEW.d, 9, 2) BETWEEN '01' AND '31' THEN substr(NEW.d, 1, 7) ELSE '#' END
    WHERE 1
    ON CONFLICT (dk) DO UPDATE SET agg = NULL, mat = NULL, tot = NULL, ym = NULL, aggf = NULL, matf = NULL;
  INSERT INTO po_cust_stats (cust) SELECT NEW.cust WHERE NEW.cust IS NOT NULL
    ON CONFLICT (cust) DO UPDATE SET data = NULL;
END;

CREATE TRIGGER IF NOT EXISTS pos_cache_upd AFTER UPDATE ON pos
WHEN OLD.data IS NOT NEW.data AND ((OLD.is_obj = 1 AND OLD.deleted = 0) OR (NEW.is_obj = 1 AND NEW.deleted = 0))
BEGIN
  INSERT INTO po_agg_cache (dk)
    SELECT CASE WHEN OLD.d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(OLD.d, 9, 2) BETWEEN '01' AND '31' THEN substr(OLD.d, 1, 7) ELSE '#' END
    WHERE OLD.is_obj = 1 AND OLD.deleted = 0
    UNION
    SELECT CASE WHEN NEW.d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(NEW.d, 9, 2) BETWEEN '01' AND '31' THEN substr(NEW.d, 1, 7) ELSE '#' END
    WHERE NEW.is_obj = 1 AND NEW.deleted = 0
    ON CONFLICT (dk) DO UPDATE SET agg = NULL, mat = NULL, tot = NULL, ym = NULL, aggf = NULL, matf = NULL;
  INSERT INTO po_cust_stats (cust)
    SELECT OLD.cust WHERE OLD.cust IS NOT NULL AND OLD.is_obj = 1 AND OLD.deleted = 0
    UNION
    SELECT NEW.cust WHERE NEW.cust IS NOT NULL AND NEW.is_obj = 1 AND NEW.deleted = 0
    ON CONFLICT (cust) DO UPDATE SET data = NULL;
END;

CREATE TRIGGER IF NOT EXISTS pos_cache_del AFTER DELETE ON pos
WHEN OLD.is_obj = 1 AND OLD.deleted = 0
BEGIN
  INSERT INTO po_agg_cache (dk)
    SELECT CASE WHEN OLD.d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(OLD.d, 9, 2) BETWEEN '01' AND '31' THEN substr(OLD.d, 1, 7) ELSE '#' END
    WHERE 1
    ON CONFLICT (dk) DO UPDATE SET agg = NULL, mat = NULL, tot = NULL, ym = NULL, aggf = NULL, matf = NULL;
  INSERT INTO po_cust_stats (cust) SELECT OLD.cust WHERE OLD.cust IS NOT NULL
    ON CONFLICT (cust) DO UPDATE SET data = NULL;
END;

-- The app pages POs by (date, id) keyset (SB.queryAll); with id in the date index the
-- order comes straight from the index (no temp sort that reads every row twice).
DROP INDEX IF EXISTS pos_live_date;
CREATE INDEX IF NOT EXISTS pos_live_date_id ON pos (deleted, d, id);

-- POs whose date is not a plain YYYY-MM-DD (bucket '#'): normally none, so this partial index
-- is empty and costs nothing on writes, but it keeps a '#' refresh from scanning every PO.
CREATE INDEX IF NOT EXISTS pos_odd_date ON pos (deleted)
  WHERE NOT coalesce(d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(d, 9, 2) BETWEEN '01' AND '31', 0);

-- Backfill: register every bucket and customer that has live POs, all dirty. The first RPC
-- call computes them (or run the warm-up call in CUTOVER.md right after applying this).
INSERT INTO po_agg_cache (dk)
  SELECT DISTINCT CASE WHEN d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(d, 9, 2) BETWEEN '01' AND '31' THEN substr(d, 1, 7) ELSE '#' END
  FROM pos WHERE is_obj = 1 AND deleted = 0
  ON CONFLICT (dk) DO NOTHING;
INSERT INTO po_cust_stats (cust)
  SELECT DISTINCT cust FROM pos WHERE is_obj = 1 AND deleted = 0 AND cust IS NOT NULL
  ON CONFLICT (cust) DO NOTHING;
