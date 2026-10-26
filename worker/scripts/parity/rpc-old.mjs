// Reference copy of src/rpc.js as it was before the aggregate caches (migration 0003): the
// full-scan SQL whose answers the cached RPCs must reproduce. Used by test-rpc-parity.mjs only.

// Text of a JSON field, like Postgres data->>'x'.
const jt = (k) => `CAST(json_extract(data, '$.${k}') AS TEXT)`;
// coalesce(nullif(data->>'x','')::numeric, 0)
const num = (k) => `coalesce(CAST(nullif(${jt(k)}, '') AS REAL), 0)`;
const LIVE = "is_obj = 1 AND deleted = 0";

function dateRange(args, binds) {
  let sql = "";
  if (args.p_from) { binds.push(String(args.p_from)); sql += ` AND d >= ?${binds.length}`; }
  if (args.p_to) { binds.push(String(args.p_to)); sql += ` AND d <= ?${binds.length}`; }
  return sql;
}

async function poAgg(env, args) {
  const binds = [];
  const grp = `upper(coalesce(${jt("group")}, ''))`;
  const sql = `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
      CASE WHEN ${grp} = 'DE' OR ${grp} GLOB 'DE[^A-Z]*' THEN 'DE' ELSE substr(${grp}, 1, 1) END AS grp,
      sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt
    FROM pos WHERE ${LIVE}${dateRange(args, binds)}
    GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`;
  return (await env.DB.prepare(sql).bind(...binds).all()).results;
}

// Base material code: first token of the first non-empty code field, before . space · | /
// ("TDM240.110×300" → "TDM240"), upper-cased; "—" when there is none.
const SRC_FIELDS = ["items[0].structureCode", "structureCode", "items[0].sku", "items[0].productCode", "productCode", "materialName", "commercial"];
async function poAggMaterial(env, args) {
  const binds = [];
  const src = `coalesce(${SRC_FIELDS.map((f) => `nullif(${jt(f)}, '')`).join(", ")})`;
  const sql = `SELECT ${jt("year")} AS yr, ${jt("month")} AS mo, ${src} AS src, upper(coalesce(pic, '')) AS pic, coalesce(cust, '') AS cust,
      sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt
    FROM pos WHERE ${LIVE}${dateRange(args, binds)}
    GROUP BY 1, 2, 3, 4, 5`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  // The regex step has no SQLite equivalent, so the final grouping by code happens here.
  const out = new Map();
  for (const r of results) {
    const m = r.src == null ? null : /^[^.\s·|/]+/.exec(r.src);
    const code = (m ? m[0] : "—").toUpperCase();
    const key = [r.yr, r.mo, code, r.pic, r.cust].join("\u0001");
    const cur = out.get(key);
    if (cur) { cur.amount += r.amount; cur.sqm += r.sqm; cur.cnt += r.cnt; }
    else out.set(key, { yr: r.yr, mo: r.mo, code, pic: r.pic, cust: r.cust, amount: r.amount, sqm: r.sqm, cnt: r.cnt });
  }
  const key = (x) => [x.yr, x.mo, x.code, x.pic, x.cust].join("\u0001");
  return [...out.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

async function poCount(env) {
  return await env.DB.prepare(`SELECT count(*) AS n FROM pos WHERE ${LIVE}`).first("n");
}

async function poMonthTotals(env, args) {
  const sql = `SELECT CAST(${jt("month")} AS INTEGER) AS mo, sum(${num("amountVnd")}) AS amount, sum(${num("sqm")}) AS sqm, count(*) AS cnt
    FROM pos WHERE ${LIVE} AND ${jt("year")} = ?1 GROUP BY 1 ORDER BY 1`;
  return (await env.DB.prepare(sql).bind(String(args.p_year ?? "")).all()).results;
}

// Every CTE is MATERIALIZED: left inline, SQLite re-runs the window queries for each joined
// row (172M rows read and 11 s per call on 14k POs); materialized it is a few scans.
async function poCustomerStats(env) {
  const sql = `WITH base AS MATERIALIZED (
      SELECT cust AS cid, d, ${num("amountVnd")} AS amt, nullif(inv_no, '') AS inv, nullif(${jt("commercial")}, '') AS prod, pic
      FROM pos WHERE ${LIVE} AND cust IS NOT NULL
    ),
    agg AS MATERIALIZED (
      SELECT cid, count(*) AS po_count, count(DISTINCT inv) AS inv_count, min(d) AS first_date, max(d) AS last_date,
        sum(amt) AS total_amt, count(DISTINCT prod) AS distinct_products
      FROM base GROUP BY cid
    ),
    gapavg AS MATERIALIZED (
      SELECT cid, avg(gap) AS avg_gap FROM (
        SELECT cid, julianday(d) - julianday(lag(d) OVER (PARTITION BY cid ORDER BY d)) AS gap
        FROM base WHERE d GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      ) WHERE gap > 0 GROUP BY cid
    ),
    lastrow AS MATERIALIZED (
      SELECT cid, pic AS last_pic, prod AS last_product FROM (
        SELECT cid, pic, prod, row_number() OVER (PARTITION BY cid ORDER BY d DESC) AS rn FROM base WHERE d IS NOT NULL
      ) WHERE rn = 1
    )
    SELECT a.cid AS customer_id, a.po_count, a.inv_count, a.first_date, a.last_date, a.total_amt,
      ga.avg_gap AS avg_gap_days, a.distinct_products, lr.last_pic, lr.last_product
    FROM agg a LEFT JOIN gapavg ga ON ga.cid = a.cid LEFT JOIN lastrow lr ON lr.cid = a.cid
    ORDER BY a.cid`;
  return (await env.DB.prepare(sql).all()).results;
}

export const FNS = { po_agg: poAgg, po_agg_material: poAggMaterial, po_count: poCount, po_month_totals: poMonthTotals, po_customer_stats: poCustomerStats };

