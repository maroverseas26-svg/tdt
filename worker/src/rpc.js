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
// from `pos` (through the date index). Each month also keeps its rows in output form
// (aggf/matf), so a range of whole months is a concatenation of stored JSON — the per-row
// work happens once per change, not per request (free plan: 10 ms CPU per request).
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
// dd = the PO date, kept only for the '#' bucket, whose rows are filtered by date in JS
// (read through the partial index of odd dates, see migrations/0003).
const posFor = (withD) => (withD ? "pos INDEXED BY pos_odd_date" : "pos");
const aggRows = (where, withD) => `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
    ${GRP} AS grp, sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt, ${withD ? "d" : "NULL"} AS dd
  FROM ${posFor(withD)} WHERE ${where} GROUP BY 1, 2, 3, 4, 5, 9`;
const matRows = (where, withD) => `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, ${SRC} AS src, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
    sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt, ${withD ? "d" : "NULL"} AS dd
  FROM ${posFor(withD)} WHERE ${where} GROUP BY 1, 2, 3, 4, 5, 9`;
const totRows = (where, withD) => `SELECT ${jt("year")} AS yr, CAST(${jt("month")} AS INTEGER) AS mi,
    sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt
  FROM ${posFor(withD)} WHERE ${where} GROUP BY 1, 2`;
const AGG_COLS = ["yr", "mo", "pic", "cust", "grp", "amount", "sqm", "cnt", "dd"];
const MAT_COLS = ["yr", "mo", "src", "pic", "cust", "amount", "sqm", "cnt", "dd"];
const asJson = (sql, cols) => `(SELECT json_group_array(json_array(${cols.join(", ")})) FROM (${sql}))`;
const refreshSql = (where, withD) => `UPDATE po_agg_cache SET
    agg = ${asJson(aggRows(where, withD), AGG_COLS)},
    mat = ${asJson(matRows(where, withD), MAT_COLS)},
    tot = ${asJson(totRows(where, withD), ["yr", "mi", "amount", "sqm", "cnt"])}
  WHERE dk = ?3 RETURNING dk, agg, mat, tot`;
const REFRESH_MONTH = refreshSql(MONTH_WHERE, false);
const REFRESH_ODD = refreshSql(ODD_WHERE, true).replace("?3", "'#'");

// SQLite ORDER BY on text-or-null columns: NULL first, then binary text order.
const cmpVal = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
const cmpBy = (keys) => (a, b) => { for (const k of keys) { const c = cmpVal(a[k], b[k]); if (c) return c; } return 0; };
const AGG_KEYS = ["yr", "mo", "pic", "cust", "grp"];
const MAT_KEYS = ["yr", "mo", "code", "pic", "cust"];
const kv = (v) => (v === null || v === undefined ? "\u0002" : v);
const keyOf = (keys) => (o) => keys.map((k) => kv(o[k])).join("\u0001");

// Base material code: first token of the code source, before . space · | /
// ("TDM240.110×300" → "TDM240"), upper-cased; "—" when there is none.
const codeOf = (src) => { const m = src == null ? null : /^[^.\s·|/]+/.exec(src); return (m ? m[0] : "—").toUpperCase(); };

// Raw entries ([yr, mo, pic|src, ...] arrays) → output rows, summed per output key. po_agg
// entries are already one per key; material entries collapse by base code.
function sumRows(rows, key) {
  const out = new Map();
  for (const o of rows) {
    const k = key(o), cur = out.get(k);
    if (cur) { cur.amount += o.amount; cur.sqm += o.sqm; cur.cnt += o.cnt; }
    else out.set(k, { ...o });
  }
  return [...out.values()];
}
const aggOut = (list) => list.map((e) => ({ yr: e[0], mo: e[1], pic: e[2], cust: e[3], grp: e[4], amount: e[5], sqm: e[6], cnt: e[7] }));
const matOut = (list) => sumRows(list.map((e) => ({ yr: e[0], mo: e[1], code: codeOf(e[2]), pic: e[3], cust: e[4], amount: e[5], sqm: e[6], cnt: e[7] })), keyOf(MAT_KEYS));
const KINDS = {
  agg: { rows: aggRows, cols: AGG_COLS, keys: AGG_KEYS, out: aggOut },
  mat: { rows: matRows, cols: MAT_COLS, keys: MAT_KEYS, out: matOut },
};
// The one (yr, mo) shared by every entry, as JSON; '*' when there are several (or a null),
// '' when there are none.
function ymOf(list) {
  let ym = "";
  for (const e of list) {
    if (e[0] == null || e[1] == null) return "*";
    const k = JSON.stringify([e[0], e[1]]);
    if (ym && k !== ym) return "*";
    ym = k;
  }
  return ym;
}

// Recompute dirty buckets (one atomic UPDATE each), then store their output form (ym, aggf,
// matf) — only if the bucket was not dirtied again meanwhile. Bucket by bucket, so a request
// cut short still leaves the finished ones done. Returns dk → { agg, mat, tot, ym, aggf, matf }.
async function refresh(env, dks, dirty) {
  const got = new Map();
  if (!dks.length) return got;
  const stale = dks.filter((dk) => !dirty.has(dk));
  if (stale.length) {
    const { results } = await env.DB.prepare("SELECT dk, agg, mat, tot, ym FROM po_agg_cache WHERE dk IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(stale)).all();
    for (const r of results) if (r.agg != null) got.set(r.dk, r); else dirty.add(r.dk);
  }
  for (const dk of dks) {
    let r = got.get(dk);
    if (!r) {
      const res = await (dk === "#" ? env.DB.prepare(REFRESH_ODD) : env.DB.prepare(REFRESH_MONTH).bind(dk + "-01", dk + "-31", dk)).all();
      r = res.results[0] || { dk, agg: "[]", mat: "[]", tot: "[]" };
      got.set(dk, r);
    }
    if (dk === "#") { if (r.ym === "*") continue; r.ym = "*"; r.aggf = r.matf = null; }
    else {
      const a = JSON.parse(r.agg);
      r.ym = ymOf(a);
      r.aggf = JSON.stringify(aggOut(a).sort(cmpBy(AGG_KEYS)));
      r.matf = JSON.stringify(matOut(JSON.parse(r.mat)).sort(cmpBy(MAT_KEYS)));
    }
    await env.DB.prepare("UPDATE po_agg_cache SET ym = ?2, aggf = ?3, matf = ?4 WHERE dk = ?1 AND agg IS ?5 AND mat IS ?6")
      .bind(dk, r.ym, r.aggf, r.matf, r.agg, r.mat).run();
  }
  return got;
}

const rangeOf = (args) => [args.p_from ? String(args.p_from) : null, args.p_to ? String(args.p_to) : null];

// po_agg / po_agg_material over [from, to] as JSON text. Whole months come from the cache
// in output form; a partial first/last month is read from `pos` (date index); '#' entries
// are filtered by their date. When every piece covers one distinct (yr, mo) — the normal
// case, a PO's year/month matching its date — the answer is the pieces' rows concatenated
// in (yr, mo) order; otherwise the rows are merged by key and sorted.
async function rangeRpc(env, kind, from, to) {
  if (from != null && to != null && from > to) return "[]";
  const K = KINDS[kind], F = kind + "f";
  const { results } = await env.DB.prepare(
    `SELECT dk, ym, ${F} AS f, agg IS NULL AS dirty FROM po_agg_cache
     WHERE dk = '#' OR ((?1 IS NULL OR dk || '-31' >= ?1) AND (?2 IS NULL OR dk || '-01' <= ?2))`
  ).bind(from, to).all();
  const full = [], partial = [];
  for (const r of results) {
    if (r.dk === "#" || ((from == null || r.dk + "-01" >= from) && (to == null || r.dk + "-31" <= to))) full.push(r);
    else partial.push(r.dk);
  }
  const need = full.filter((r) => r.dk === "#" || r.dirty || r.ym == null || r.f == null).map((r) => r.dk);
  const fresh = await refresh(env, need, new Set(full.filter((r) => r.dirty).map((r) => r.dk)));
  const pieces = [];
  for (const r of full) {
    if (r.dk !== "#") { const f = fresh.get(r.dk); pieces.push(f ? { ym: f.ym, text: f[F] } : { ym: r.ym, text: r.f }); continue; }
    const di = K.cols.indexOf("dd");
    const list = JSON.parse(fresh.get("#")[kind]).filter((e) => {
      const d = e[di];
      return (from == null || (d != null && d >= from)) && (to == null || (d != null && d <= to));
    });
    if (list.length) pieces.push({ ym: "*", rows: K.out(list) });
  }
  if (partial.length) {
    const stmts = partial.map((m) => env.DB.prepare(K.rows(MONTH_WHERE, false))
      .bind(from != null && from > m + "-01" ? from : m + "-01", to != null && to < m + "-31" ? to : m + "-31"));
    for (const res of await env.DB.batch(stmts)) {
      const list = res.results.map((o) => K.cols.map((c) => o[c]));
      if (list.length) pieces.push({ ym: ymOf(list), rows: K.out(list).sort(cmpBy(K.keys)) });
    }
  }
  const live = pieces.filter((p) => p.ym !== "");
  const yms = new Set(live.map((p) => p.ym));
  if (!yms.has("*") && yms.size === live.length) {
    live.sort((a, b) => { const x = JSON.parse(a.ym), y = JSON.parse(b.ym); return cmpVal(x[0], y[0]) || cmpVal(x[1], y[1]); });
    const parts = live.map((p) => (p.text != null ? p.text : JSON.stringify(p.rows)).slice(1, -1)).filter(Boolean);
    return "[" + parts.join(",") + "]";
  }
  const all = live.flatMap((p) => (p.rows ? p.rows : JSON.parse(p.text)));
  return JSON.stringify(sumRows(all, keyOf(K.keys)).sort(cmpBy(K.keys)));
}

const poAgg = (env, args) => rangeRpc(env, "agg", ...rangeOf(args));
const poAggMaterial = (env, args) => rangeRpc(env, "mat", ...rangeOf(args));

// Every bucket's month totals (the year filter is on the record's `year`, not its date).
async function allTotals(env) {
  const { results } = await env.DB.prepare("SELECT dk, tot FROM po_agg_cache").all();
  const fresh = await refresh(env, results.filter((r) => r.tot == null).map((r) => r.dk), new Set(results.filter((r) => r.tot == null).map((r) => r.dk)));
  return results.flatMap((r) => JSON.parse(r.tot ?? fresh.get(r.dk).tot));
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
      FROM pos INDEXED BY pos_cust WHERE ${LIVE} AND cust IN (SELECT cid FROM dirty)
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
  const paged = url.searchParams.has("limit") || url.searchParams.has("offset");
  if (typeof result === "string") {   // already JSON text
    if (!paged) return new Response(result, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    result = JSON.parse(result);
  }
  // PostgREST applies ?limit/offset to set-returning functions (older app builds page with them).
  if (Array.isArray(result)) {
    const limit = parseInt(url.searchParams.get("limit"), 10);
    const offset = parseInt(url.searchParams.get("offset"), 10) || 0;
    result = Number.isFinite(limit) ? result.slice(offset, offset + limit) : result.slice(offset);
  }
  return json(result);
}
