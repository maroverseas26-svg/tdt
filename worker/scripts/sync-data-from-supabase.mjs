// Copies the CRM tables from Supabase into D1 through the Worker's /rest/v1 API (so inline
// attachments are moved to `files` exactly as live writes are). Safe to re-run: rows are
// upserted by id and rows that no longer exist in Supabase are removed from D1.
//
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/sync-data-from-supabase.mjs [--full] [--dry-run] [table ...]
//
// Incremental by default: compares (id, updated_at) on both sides and writes only rows that
// are new or whose updated_at differs, then deletes rows gone from Supabase — the free plan
// allows 100k D1 rows written per day and rewriting every PO costs ~8 each (row + indexes).
// --full rewrites every row (the first load); --dry-run only prints what would change.
//
// Env: MIGRATION_TOKEN (required, the Worker secret), WORKER_URL (default the workers.dev URL).
const SUPABASE = "https://trmdqpgsdvujodhgyvlv.supabase.co/rest/v1";
const KEY = "sb_publishable_oyNvDtCWmqijIP_DTiqlmA_3tn_W3_p"; // public key, already in the old frontend
const WORKER = (process.env.WORKER_URL || "https://tdt.todaytec.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
const TABLES = ["activity", "customers", "forecast", "logs", "pipelines", "products", "projects", "quotations", "retention",
  "samples", "skuForecast", "targetCust", "targetGroups", "targets", "users", "pos"];
const PAGE = 200;
const ID_PAGE = 1000;
const MAX_BODY = 1_500_000;
const args = process.argv.slice(2);
const FULL = args.includes("--full"), DRY = args.includes("--dry-run");

if (!TOKEN) { console.error("MIGRATION_TOKEN is required"); process.exit(1); }
const sbHeaders = { apikey: KEY, Authorization: "Bearer " + KEY };
const wHeaders = { "x-migration-token": TOKEN, "content-type": "application/json" };

async function retry(fn, label) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 3) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
const d1 = { read: 0, written: 0 }; // summed from the Worker's x-d1-rows-* headers
async function ok(res, label) {
  d1.read += +(res.headers.get("x-d1-rows-read") || 0);
  d1.written += +(res.headers.get("x-d1-rows-written") || 0);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function readSupabase(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await retry(async () => (await ok(await fetch(`${SUPABASE}/${table}?select=id,data,updated_at&order=id.asc&limit=${PAGE}&offset=${offset}`, { headers: sbHeaders }), `read ${table}`)).json(), `read ${table}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function writeWorker(table, rows) {
  let batch = [], size = 2;
  const flush = async () => {
    if (!batch.length) return;
    const body = JSON.stringify(batch);
    await retry(async () => ok(await fetch(`${WORKER}/rest/v1/${table}`, { method: "POST", headers: wHeaders, body }), `write ${table}`), `write ${table}`);
    batch = []; size = 2;
  };
  for (const r of rows) {
    const len = JSON.stringify(r).length + 1;
    if (batch.length && (size + len > MAX_BODY || batch.length >= 300)) await flush();
    batch.push(r); size += len;
  }
  await flush();
}

// (id, updated_at) of every Worker row, paged by id (keyset: D1 reads each row once).
async function workerStamps(table) {
  const rows = [];
  for (let after = null; ;) {
    const qs = `select=id,updated_at&order=id.asc&limit=${ID_PAGE}` + (after == null ? "" : `&id=gt.${encodeURIComponent(after)}`);
    const page = await retry(async () => (await ok(await fetch(`${WORKER}/rest/v1/${table}?${qs}`, { headers: wHeaders }), `ids ${table}`)).json(), `ids ${table}`);
    rows.push(...page);
    if (page.length < ID_PAGE) return rows;
    after = page[page.length - 1].id;
  }
}
async function workerIds(table) { return (await workerStamps(table)).map((r) => r.id); }

async function supabaseStamps(table) {
  const rows = [];
  for (let offset = 0; ; offset += ID_PAGE) {
    const page = await retry(async () => (await ok(await fetch(`${SUPABASE}/${table}?select=id,updated_at&order=id.asc&limit=${ID_PAGE}&offset=${offset}`, { headers: sbHeaders }), `stamps ${table}`)).json(), `stamps ${table}`);
    rows.push(...page);
    if (page.length < ID_PAGE) return rows;
  }
}
async function supabaseRowsById(table, ids) {
  const rows = [];
  const q = (id) => '"' + String(id).replace(/(["\\])/g, "\\$1") + '"';
  for (let i = 0; i < ids.length; i += 100) {
    const list = encodeURIComponent(ids.slice(i, i + 100).map(q).join(","));
    rows.push(...await retry(async () => (await ok(await fetch(`${SUPABASE}/${table}?select=id,data,updated_at&id=in.(${list})`, { headers: sbHeaders }), `read ${table}`)).json(), `read ${table}`));
  }
  return rows;
}
async function removeRows(table, ids) {
  for (const id of ids) {
    await retry(async () => ok(await fetch(`${WORKER}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: wHeaders }), `delete ${table}`), `delete ${table}`);
  }
}
const skipRow = (table, id) => table === "users" && String(id) === "_all";

// Only rows that are new or whose updated_at changed are fetched and written.
async function syncTableIncremental(table) {
  const t0 = Date.now();
  const [src, dst] = await Promise.all([supabaseStamps(table), workerStamps(table)]);
  const have = new Map(dst.map((r) => [String(r.id), r.updated_at ?? null]));
  const changed = src.filter((r) => !skipRow(table, r.id) && (!have.has(String(r.id)) || have.get(String(r.id)) !== (r.updated_at ?? null))).map((r) => r.id);
  const keep = new Set(src.map((r) => String(r.id)));
  const stale = dst.map((r) => String(r.id)).filter((id) => !keep.has(id) && !skipRow(table, id));
  if (!DRY) {
    if (changed.length) await writeWorker(table, await supabaseRowsById(table, changed));
    await removeRows(table, stale);
  }
  console.log(`${table.padEnd(13)} ${String(src.length).padStart(6)} rows, ${String(changed.length).padStart(5)} new/changed ${DRY ? "(dry run)" : "written"}, ${stale.length} removed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function syncTable(table) {
  const t0 = Date.now();
  // users(_all) is the account list — it lives in the accounts table (sync-users-from-supabase.cjs).
  const rows = (await readSupabase(table)).filter((r) => !(table === "users" && r.id === "_all"));
  await writeWorker(table, rows);
  const keep = new Set(rows.map((r) => String(r.id)));
  const stale = (await workerIds(table)).filter((id) => !keep.has(id) && !(table === "users" && id === "_all"));
  await removeRows(table, stale);
  console.log(`${table.padEnd(13)} ${String(rows.length).padStart(6)} rows synced, ${stale.length} removed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const only = args.filter((a) => !a.startsWith("--"));
for (const t of only.length ? only : TABLES) await (FULL ? syncTable(t) : syncTableIncremental(t));
console.log(`D1: ${d1.read} rows read, ${d1.written} rows written`);
