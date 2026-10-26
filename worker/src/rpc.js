// The Postgres aggregate functions the app calls via /rest/v1/rpc/<fn>, ported to D1.
// Same inputs, column names and grouping as the Supabase versions
// (po_agg, po_agg_material, po_count, po_customer_stats, po_month_totals).
//
// They read the aggregate caches of migrations/0003_po_aggregates.sql instead of scanning
// `pos`: po_agg_cache holds every PO-date bucket (month of a well-formed date, or '#' for
// any other date) already grouped, po_cust_stats one stats row per customer. Triggers on
// `pos` mark the buckets/customers a write touches as dirty; dirty ones are recomputed here
// with the same SQL the full scans used, restricted to that bucket/customer (index ranges).
// A date range answers its whole months from the cache and only a partial first/last month
// from `pos` (through the date index).
import { json } from "./util.js";

// Text of a JSON field, like Postgres data->>'x'.
const jt = (k) => `CAST(json_extract(data, '$.${k}') AS TEXT)`;
// coalesce(nullif(data->>'x','')::numeric, 0)
const num = (k) => `coalesce(CAST(nullif(${jt(k)}, '') AS REAL), 0)`;
const LIVE = "is_obj = 1 AND deleted = 0";
const DATE_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
const GRP_RAW = `upper(coalesce(${jt("group")}, ''))`;
const GRP = `CASE WHEN ${GRP_RAW} = 'DE' OR ${GRP_RAW} GLOB 'DE[^A-Z]*' THEN 'DE' ELSE substr(${GRP_RAW}, 1, 1) END`;
// Base material code source: the first non-empty code field (mapped to the code in JS).
const SRC_FIELDS = ["items[0].structureCode", "structureCode", "items[0].sku", "items[0].productCode", "productCode", "materialName", "commercial"];
const SRC = `coalesce(${SRC_FIELDS.map((f) => `nullif(${jt(f)}, '')`).join(", ")})`;

// Live POs of one month bucket (?1 = 'YYYY-MM-01', ?2 = 'YYYY-MM-31'), of the '#' bucket,
// or of a date range inside one month (a partial month of a requested range).
const MONTH_WHERE = `${LIVE} AND d >= ?1 AND d <= ?2 AND d GLOB ${DATE_GLOB}`;
const ODD_WHERE = `${LIVE} AND NOT coalesce(d GLOB ${DATE_GLOB} AND substr(d, 9, 2) BETWEEN '01' AND '31', 0)`;

// Grouped rows as SQL (one row per group) and as one JSON array (for the cache).
// dd = the PO date, kept only for the '#' bucket, whose rows are filtered by date in JS.
const aggRows = (where, withD) => `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
    ${GRP} AS grp, sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt, ${withD ? "d" : "NULL"} AS dd
  FROM pos WHERE ${where} GROUP BY 1, 2, 3, 4, 5, 9`;
const matRows = (where, withD) => `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, ${SRC} AS src, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
    sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt, ${withD ? "d" : "NULL"} AS dd
  FROM pos WHERE ${where} GROUP BY 1, 2, 3, 4, 5, 9`;
const totRows = (where) => `SELECT ${jt("year")} AS yr, CAST(${jt("month")} AS INTEGER) AS mi,
    sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt
  FROM pos WHERE ${where} GROUP BY 1, 2`;
const AGG_COLS = ["yr", "mo", "pic", "cust", "grp", "amount", "sqm", "cnt", "dd"];
const MAT_COLS = ["yr", "mo", "src", "pic", "cust", "amount", "sqm", "cnt", "dd"];
const asJson = (sql, cols) => `(SELECT json_group_array(json_array(${cols.join(", ")})) FROM (${sql}))`;
const refreshSql = (where, withD) => `UPDATE po_agg_cache SET
    agg = ${asJson(aggRows(where, withD), AGG_COLS)},
    mat = ${asJson(matRows(where, withD), MAT_COLS)},
    tot = ${asJson(totRows(where), ["yr", "mi", "amount", "sqm", "cnt"])}
  WHERE dk = ?3 RETURNING dk, agg, mat, tot`;
const REFRESH_MONTH = refreshSql(MONTH_WHERE, false);
const REFRESH_ODD = refreshSql(ODD_WHERE, true).replace("?3", "'#'");

// Cache rows (dk + the wanted column parsed) for the buckets a date range touches, with
// dirty buckets recomputed first. Returns { full: [{dk, v}], partial: [dk] }: `full` buckets
// lie wholly inside the range (or are '#', filtered by date later), `partial` months only
// partly — those are read from `pos`.
async function buckets(env, col, from, to) {
  const { results } = await env.DB.prepare(
    `SELECT dk, ${col} AS v FROM po_agg_cache
     WHERE dk = '#' OR ((?1 IS NULL OR dk || '-31' >= ?1) AND (?2 IS NULL OR dk || '-01' <= ?2))`
  ).bind(from, to).all();
  const full = [], partial = [];
  for (const r of results) {
    if (r.dk === "#" || ((from == null || r.dk + "-01" >= from) && (to == null || r.dk + "-31" <= to))) full.push(r);
    else partial.push(r.dk);
  }
  const dirty = full.filter((r) => r.v == null);
  if (dirty.length) {
    const fresh = await env.DB.batch(dirty.map((r) => (r.dk === "#" ? env.DB.prepare(REFRESH_ODD) : env.DB.prepare(REFRESH_MONTH).bind(r.dk + "-01", r.dk + "-31", r.dk))));
    fresh.forEach((res, i) => { dirty[i].v = res.results[0] ? res.results[0][col] : "[]"; });
  }
  return { full: full.map((r) => ({ dk: r.dk, v: JSON.parse(r.v) })), partial };
}

// Rows of the partial months, straight from `pos` through the date index.
async function partialRows(env, rowsSql, months, from, to) {
  if (!months.length) return [];
  const stmts = months.map((m) => {
    const lo = from != null && from > m + "-01" ? from : m + "-01";
    const hi = to != null && to < m + "-31" ? to : m + "-31";
    return env.DB.prepare(rowsSql(MONTH_WHERE, false)).bind(lo, hi);
  });
  return (await env.DB.batch(stmts)).flatMap((r) => r.results);
}

// Entries of the cached buckets that fall in [from, to] ('#' entries carry their date).
function cachedEntries(full, cols, from, to) {
  const di = cols.indexOf("dd");
  const out = [];
  for (const b of full) {
    for (const e of b.v) {
      if (b.dk === "#") {
        const d = e[di];
        if (from != null && !(d != null && d >= from)) continue;
        if (to != null && !(d != null && d <= to)) continue;
      }
      const o = {};
      cols.forEach((c, i) => { o[c] = e[i]; });
      out.push(o);
    }
  }
  return out;
}

// SQLite ORDER BY on text-or-null columns: NULL first, then binary text order.
const cmpVal = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
const cmpBy = (keys) => (a, b) => { for (const k of keys) { const c = cmpVal(a[k], b[k]); if (c) return c; } return 0; };

function sumInto(map, keyCols, row, extra) {
  const key = JSON.stringify(keyCols.map((c) => row[c]));
  const cur = map.get(key);
  if (cur) { cur.amount += row.amount; cur.sqm += row.sqm; cur.cnt += row.cnt; }
  else { const o = {}; keyCols.forEach((c) => { o[c] = row[c]; }); Object.assign(o, extra, { amount: row.amount, sqm: row.sqm, cnt: row.cnt }); map.set(key, o); }
}

const rangeOf = (args) => [args.p_from ? String(args.p_from) : null, args.p_to ? String(args.p_to) : null];

async function poAgg(env, args) {
  const [from, to] = rangeOf(args);
  if (from != null && to != null && from > to) return [];
  const { full, partial } = await buckets(env, "agg", from, to);
  const keys = ["yr", "mo", "pic", "cust", "grp"];
  const out = new Map();
  for (const r of cachedEntries(full, AGG_COLS, from, to)) sumInto(out, keys, r);
  for (const r of await partialRows(env, aggRows, partial, from, to)) sumInto(out, keys, r);
  return [...out.values()].sort(cmpBy(keys));
}

// Base material code: first token of the code source, before . space · | /
// ("TDM240.110×300" → "TDM240"), upper-cased; "—" when there is none.
const codeOf = (src) => { const m = src == null ? null : /^[^.\s·|/]+/.exec(src); return (m ? m[0] : "—").toUpperCase(); };
async function poAggMaterial(env, args) {
  const [from, to] = rangeOf(args);
  if (from != null && to != null && from > to) return [];
  const { full, partial } = await buckets(env, "mat", from, to);
  const keys = ["yr", "mo", "code", "pic", "cust"];
  const out = new Map();
  const add = (r) => sumInto(out, keys, { ...r, code: codeOf(r.src) });
  for (const r of cachedEntries(full, MAT_COLS, from, to)) add(r);
  for (const r of await partialRows(env, matRows, partial, from, to)) add(r);
  return [...out.values()].sort(cmpBy(keys));
}

// Every bucket's month totals (the year filter is on the record's `year`, not its date).
async function allTotals(env) {
  return (await buckets(env, "tot", null, null)).full.flatMap((b) => b.v);
}

async function poCount(env) {
  let n = 0;
  for (const e of await allTotals(env)) n += e[4];
  return n;
}

async function poMonthTotals(env, args) {
  const year = String(args.p_year ?? "");
  const out = new Map();
  for (const [yr, mi, amount, sqm, cnt] of await allTotals(env)) {
    if (yr !== year) continue;
    const cur = out.get(mi);
    if (cur) { cur.amount += amount; cur.sqm += sqm; cur.cnt += cnt; }
    else out.set(mi, { mo: mi, amount, sqm, cnt });
  }
  return [...out.values()].sort((a, b) => (a.mo === b.mo ? 0 : a.mo == null ? -1 : b.mo == null ? 1 : a.mo - b.mo));
}

// Per-customer stats of the dirty customers (?1 = JSON array of ids), written back to
// po_cust_stats ('' when a customer has no live POs left). Every CTE is MATERIALIZED: left
// inline, SQLite re-runs the window queries for each joined row.
const STATS_COLS = ["customer_id", "po_count", "inv_count", "first_date", "last_date", "total_amt", "avg_gap_days", "distinct_products", "last_pic", "last_product"];
const REFRESH_STATS = `WITH dirty AS MATERIALIZED (SELECT value AS cid FROM json_each(?1)),
    base AS MATERIALIZED (
      SELECT cust AS cid, d, ${num("amountVnd")} AS amt, nullif(inv_no, '') AS inv, nullif(${jt("commercial")}, '') AS prod, pic
      FROM pos WHERE ${LIVE} AND cust IN (SELECT cid FROM dirty)
    ),
    agg AS MATERIALIZED (
      SELECT cid, count(*) AS po_count, count(DISTINCT inv) AS inv_count, min(d) AS first_date, max(d) AS last_date,
        sum(amt) AS total_amt, count(DISTINCT prod) AS distinct_products
      FROM base GROUP BY cid
    ),
    gapavg AS MATERIALIZED (
      SELECT cid, avg(gap) AS avg_gap FROM (
        SELECT cid, julianday(d) - julianday(lag(d) OVER (PARTITION BY cid ORDER BY d)) AS gap
        FROM base WHERE d GLOB ${DATE_GLOB}
      ) WHERE gap > 0 GROUP BY cid
    ),
    lastrow AS MATERIALIZED (
      SELECT cid, pic AS last_pic, prod AS last_product FROM (
        SELECT cid, pic, prod, row_number() OVER (PARTITION BY cid ORDER BY d DESC) AS rn FROM base WHERE d IS NOT NULL
      ) WHERE rn = 1
    ),
    stats AS MATERIALIZED (
      SELECT a.cid, json_array(a.cid, a.po_count, a.inv_count, a.first_date, a.last_date, a.total_amt,
        ga.avg_gap, a.distinct_products, lr.last_pic, lr.last_product) AS j
      FROM agg a LEFT JOIN gapavg ga ON ga.cid = a.cid LEFT JOIN lastrow lr ON lr.cid = a.cid
    )
  UPDATE po_cust_stats SET data = coalesce((SELECT j FROM stats WHERE stats.cid = po_cust_stats.cust), '')
  WHERE cust IN (SELECT cid FROM dirty) RETURNING cust, data`;

async function poCustomerStats(env) {
  const { results } = await env.DB.prepare("SELECT cust, data FROM po_cust_stats ORDER BY cust").all();
  const dirty = results.filter((r) => r.data == null).map((r) => r.cust);
  if (dirty.length) {
    const fresh = new Map((await env.DB.prepare(REFRESH_STATS).bind(JSON.stringify(dirty)).all()).results.map((r) => [r.cust, r.data]));
    for (const r of results) if (r.data == null) r.data = fresh.get(r.cust) ?? "";
  }
  const out = [];
  for (const r of results) {
    if (!r.data) continue;
    const a = JSON.parse(r.data), o = {};
    STATS_COLS.forEach((c, i) => { o[c] = a[i]; });
    out.push(o);
  }
  return out;
}

const FNS = { po_agg: poAgg, po_agg_material: poAggMaterial, po_count: poCount, po_month_totals: poMonthTotals, po_customer_stats: poCustomerStats };

export async function rpcRoute(req, env, url) {
  const fn = FNS[url.pathname.slice("/rest/v1/rpc/".length)];
  if (!fn) return json({ message: "function not found" }, 404);
  const args = await req.json().catch(() => ({}));
  let result = await fn(env, args || {});
  // PostgREST applies ?limit/offset to set-returning functions (older app builds page with them).
  if (Array.isArray(result)) {
    const limit = parseInt(url.searchParams.get("limit"), 10);
    const offset = parseInt(url.searchParams.get("offset"), 10) || 0;
    result = Number.isFinite(limit) ? result.slice(offset, offset + limit) : result.slice(offset);
  }
  return json(result);
}
