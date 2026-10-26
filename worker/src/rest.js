// PostgREST-compatible subset over D1 — exactly the request shapes the frontend's storage
// layer (frontend/src/app/data.js, `SB`) sends, so the app keeps that layer and only swaps
// the base URL from Supabase to /rest/v1 on this origin.
//
// Storage: every table is rows of (id, data JSON, updated_at). `pos` has its own D1 table
// with generated columns + indexes for the fields the app filters/sorts on; every other
// table lives in `crm_rows` keyed by (tbl, id). The users(_all) blob is served from the
// accounts table (profiles only), see auth.js.
//
// Supported: GET with select (incl. alias:data->>field), filters eq/neq/gt/gte/lt/lte/like/
// ilike/in/is with not., or=()/and=() groups, order, limit/offset, Range + Prefer:
// count=exact (Content-Range); POST upsert (object or array); DELETE with filters.
import { json, lit, HttpError } from "./util.js";
import { externalizeRecord, hasInlineFiles } from "./files.js";
import { profilesBlob, saveProfilesBlob } from "./auth.js";

const TABLE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FIELD_RE = /^data((?:->>?[A-Za-z0-9_]+)+)$/;
// pos fields backed by generated, indexed columns (see migrations/0002_crm_data.sql).
const POS_COLS = { date: "d", customerId: "cust", pic: "pic", poNumber: "po_no", invNo: "inv_no" };
const CMP = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const MAX_PARAM_BYTES = 1_800_000; // D1 caps a single value at 2 MB

const bad = (code) => { throw new HttpError(400, code); };
const jsonPath = (segs) => "$" + segs.map((s) => (/^\d+$/.test(s) ? `[${s}]` : `."${s}"`)).join("");

function fieldSegs(field) {
  const m = FIELD_RE.exec(field);
  return m ? m[1].split(/->>?/).filter(Boolean) : null;
}

// SQL for a filter/select field with PostgREST `->>` semantics (text; JSON true/false as
// 'true'/'false', JSON null as SQL NULL).
function textExpr(ctx, field) {
  if (field === "id" || field === "updated_at") return field;
  const segs = fieldSegs(field) || bad("unsupported_field");
  if (ctx.pos && segs.length === 1 && POS_COLS[segs[0]]) return POS_COLS[segs[0]];
  const p = lit(jsonPath(segs));
  return `(CASE json_type(data, ${p}) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN NULL ELSE CAST(json_extract(data, ${p}) AS TEXT) END)`;
}
// Ordering uses the typed JSON value, so amounts sort numerically.
function orderExpr(ctx, field) {
  if (field === "id" || field === "updated_at") return field;
  const segs = fieldSegs(field) || bad("unsupported_order");
  if (ctx.pos && segs.length === 1 && POS_COLS[segs[0]]) return POS_COLS[segs[0]];
  return `json_extract(data, ${lit(jsonPath(segs))})`;
}

const globOf = (v) => v.replace(/[[?]/g, (c) => `[${c}]`).replace(/%/g, "*");
const likeOf = (v) => v.replace(/[\\%_]/g, (c) => "\\" + c).replace(/\*/g, "%");

// Split "a,b,(c,d),"e,f"" on top-level commas.
function splitTop(s) {
  const out = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}
const unquote = (s) => (/^".*"$/s.test(s) ? s.slice(1, -1).replace(/\\(["\\])/g, "$1") : s);
const stripParens = (s) => (/^\(.*\)$/s.test(s) ? s.slice(1, -1) : bad("bad_group"));

// inGroup: values inside or=()/and=() may be double-quoted (PostgREST strips the quotes).
function condition(ctx, field, spec, inGroup) {
  let neg = false;
  if (spec.startsWith("not.")) { neg = true; spec = spec.slice(4); }
  const dot = spec.indexOf(".");
  const op = dot < 0 ? spec : spec.slice(0, dot);
  const raw = dot < 0 ? "" : spec.slice(dot + 1);
  const val = inGroup && op !== "in" ? unquote(raw) : raw;
  const e = textExpr(ctx, field);
  let sql;
  if (CMP[op]) sql = `${e} ${CMP[op]} ${lit(val)}`;
  else if (op === "like") sql = `${e} GLOB ${lit(globOf(val))}`;
  else if (op === "ilike") sql = `${e} LIKE ${lit(likeOf(val))} ESCAPE '\\'`;
  else if (op === "in") sql = `${e} IN (${splitTop(stripParens(val)).map((v) => lit(unquote(v))).join(",") || "NULL"})`;
  else if (op === "is") sql = val === "null" ? `${e} IS NULL` : val === "true" || val === "false" ? `${e} = ${lit(val)}` : bad("bad_is");
  else bad("unsupported_operator");
  return neg ? `NOT (${sql})` : sql;
}

// "not deleted" — or=(data->>_deleted.is.null,data->>_deleted.eq.false) — hits pos.deleted.
const LIVE_PAIR = ["data->>_deleted.eq.false", "data->>_deleted.is.null"];
function group(ctx, kind, inner) {
  const items = splitTop(inner);
  if (ctx.pos && kind === "or" && items.length === 2 && [...items].sort().join() === LIVE_PAIR.join()) return "(deleted = 0)";
  const parts = items.map((item) => {
    const g = /^(not\.)?(or|and)\((.*)\)$/s.exec(item);
    if (g) { const s = group(ctx, g[2], g[3]); return g[1] ? `NOT ${s}` : s; }
    const dot = item.indexOf(".");
    if (dot < 0) bad("bad_condition");
    return condition(ctx, item.slice(0, dot), item.slice(dot + 1), true);
  });
  return "(" + parts.join(kind === "or" ? " OR " : " AND ") + ")";
}

function whereOf(ctx, params) {
  const where = ctx.pos ? [] : [`tbl = ${lit(ctx.table)}`];
  for (const [k, v] of params) {
    if (k === "select" || k === "order" || k === "limit" || k === "offset" || k === "columns" || k === "on_conflict") continue;
    if (k === "or" || k === "and") where.push(group(ctx, k, stripParens(v)));
    else where.push(condition(ctx, k, v));
  }
  return where.length ? " WHERE " + where.join(" AND ") : "";
}

function selectCols(ctx, sel) {
  const items = (sel || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const cols = [];
  for (const item of items) {
    if (item === "*") { cols.push({ key: "id", expr: "id" }, { key: "data", expr: "data", raw: true }, { key: "updated_at", expr: "updated_at" }); continue; }
    const ci = item.indexOf(":");
    const alias = ci > 0 && !item.slice(0, ci).includes("-") ? item.slice(0, ci) : null;
    const field = alias ? item.slice(ci + 1) : item;
    if (field === "data") cols.push({ key: alias || "data", expr: "data", raw: true });
    else cols.push({ key: alias || (fieldSegs(field) ? fieldSegs(field).slice(-1)[0] : field), expr: textExpr(ctx, field) });
  }
  return cols;
}

function orderOf(ctx, order) {
  if (!order) return "";
  const parts = order.split(",").map((o) => {
    const segs = o.split(".");
    let dir = "ASC", i = segs.length;
    while (i > 1 && /^(asc|desc|nullsfirst|nullslast)$/.test(segs[i - 1])) { if (segs[i - 1] === "desc") dir = "DESC"; i--; }
    return `${orderExpr(ctx, segs.slice(0, i).join("."))} ${dir}`;
  });
  return " ORDER BY " + parts.join(", ");
}

async function select(env, ctx, url, req) {
  const p = url.searchParams;
  // users(_all) is the account list, served from the accounts table.
  if (ctx.table === "users" && p.get("id") === "eq._all") {
    const blob = JSON.stringify(await profilesBlob(env));
    const sel = p.get("select") || "*";
    return new Response(sel === "data" ? `[{"data":${blob}}]` : `[{"id":"_all","data":${blob}}]`, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  const from = ctx.pos ? "pos" : "crm_rows";
  const where = whereOf(ctx, p);
  const cols = selectCols(ctx, p.get("select"));
  let limit = p.has("limit") ? Math.max(0, parseInt(p.get("limit"), 10) || 0) : null;
  let offset = p.has("offset") ? Math.max(0, parseInt(p.get("offset"), 10) || 0) : 0;
  const range = /^(\d+)-(\d+)$/.exec(req.headers.get("range") || "");
  if (range && limit === null) { offset = +range[1]; limit = +range[2] - +range[1] + 1; }
  const sql = `SELECT ${cols.map((c, i) => `${c.expr} AS c${i}`).join(", ")} FROM ${from}${where}${orderOf(ctx, p.get("order"))}` +
    (limit !== null ? ` LIMIT ${limit} OFFSET ${offset}` : offset ? ` LIMIT -1 OFFSET ${offset}` : "");
  const { results } = await env.DB.prepare(sql).all();
  const body = "[" + results.map((r) => "{" + cols.map((c, i) => JSON.stringify(c.key) + ":" + (c.raw ? (r["c" + i] ?? "null") : JSON.stringify(r["c" + i] ?? null))).join(",") + "}").join(",") + "]";
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const n = /count=exact/.test(req.headers.get("prefer") || "") ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}${where}`).first("n") : "*";
  headers["content-range"] = (results.length ? `${offset}-${offset + results.length - 1}` : "*") + "/" + n;
  return new Response(body, { headers });
}

// Upsert rows {id, data, updated_at}. Plain bodies go straight to SQLite (json_each) so the
// Worker never parses large imports; bodies with inline files, or too big for one bound
// value, are parsed so attachments can be moved to `files` and rows written one by one.
export async function upsertRows(env, ctx, text) {
  const trimmed = text.trimStart();
  const arrText = trimmed.startsWith("[") ? text : `[${text}]`;
  if (!hasInlineFiles(text) && arrText.length <= MAX_PARAM_BYTES && ctx.table !== "users") {
    const sql = ctx.pos
      ? `INSERT INTO pos (id, data, updated_at)
         SELECT CAST(value ->> '$.id' AS TEXT), value -> '$.data', value ->> '$.updated_at'
         FROM json_each(?1) WHERE value ->> '$.id' IS NOT NULL
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      : `INSERT INTO crm_rows (tbl, id, data, updated_at)
         SELECT ?2, CAST(value ->> '$.id' AS TEXT), value -> '$.data', value ->> '$.updated_at'
         FROM json_each(?1) WHERE value ->> '$.id' IS NOT NULL
         ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;
    const stmt = env.DB.prepare(sql);
    await (ctx.pos ? stmt.bind(arrText) : stmt.bind(arrText, ctx.table)).run();
    return;
  }
  let rows;
  try { rows = JSON.parse(arrText); } catch { bad("bad_json"); }
  const stmts = [];
  for (const row of rows) {
    if (!row || row.id == null) continue;
    if (ctx.table === "users" && String(row.id) === "_all") { await saveProfilesBlob(env, ctx.me, row.data); continue; }
    const data = await externalizeRecord(env, row.data);
    const dataText = JSON.stringify(data === undefined ? null : data);
    if (dataText.length > MAX_PARAM_BYTES) throw new HttpError(413, "row_too_large");
    stmts.push(ctx.pos
      ? env.DB.prepare("INSERT INTO pos (id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
        .bind(String(row.id), dataText, row.updated_at || null)
      : env.DB.prepare("INSERT INTO crm_rows (tbl, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
        .bind(ctx.table, String(row.id), dataText, row.updated_at || null));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function remove(env, ctx, url) {
  const where = whereOf(ctx, url.searchParams);
  if (!where || where === ` WHERE tbl = ${lit(ctx.table)}`) bad("filter_required");
  await env.DB.prepare(`DELETE FROM ${ctx.pos ? "pos" : "crm_rows"}${where}`).run();
  return new Response(null, { status: 204 });
}

export async function restRoute(req, env, url, me) {
  const table = url.pathname.slice("/rest/v1/".length);
  if (!TABLE_RE.test(table)) return json({ message: "unknown table" }, 404);
  const ctx = { table, pos: table === "pos", me };
  try {
    if (req.method === "GET" || req.method === "HEAD") return await select(env, ctx, url, req);
    if (req.method === "POST") { await upsertRows(env, ctx, await req.text()); return new Response(null, { status: 201 }); }
    if (req.method === "DELETE") return await remove(env, ctx, url);
    return json({ message: "method not allowed" }, 405);
  } catch (e) {
    if (e instanceof HttpError) return json({ message: e.code }, e.status);
    throw e;
  }
}
