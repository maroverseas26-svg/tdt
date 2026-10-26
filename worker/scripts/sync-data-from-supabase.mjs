// Copies the CRM tables from Supabase into D1 through the Worker's /rest/v1 API (so inline
// attachments are moved to `files` exactly as live writes are). Safe to re-run: rows are
// upserted by id and rows that no longer exist in Supabase are removed from D1.
//
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/sync-data-from-supabase.mjs [table ...]
//
// Env: MIGRATION_TOKEN (required, the Worker secret), WORKER_URL (default the workers.dev URL).
const SUPABASE = "https://trmdqpgsdvujodhgyvlv.supabase.co/rest/v1";
const KEY = "sb_publishable_oyNvDtCWmqijIP_DTiqlmA_3tn_W3_p"; // public key, already in the old frontend
const WORKER = (process.env.WORKER_URL || "https://tdt.todaytec.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
const TABLES = ["activity", "customers", "forecast", "logs", "pipelines", "products", "projects", "quotations", "retention",
  "samples", "skuForecast", "targetCust", "targetGroups", "targets", "users", "pos"];
const PAGE = 200;
const MAX_BODY = 1_500_000;

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
async function ok(res, label) {
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

async function workerIds(table) {
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await retry(async () => (await ok(await fetch(`${WORKER}/rest/v1/${table}?select=id&order=id.asc&limit=1000&offset=${offset}`, { headers: wHeaders }), `ids ${table}`)).json(), `ids ${table}`);
    ids.push(...page.map((r) => r.id));
    if (page.length < 1000) return ids;
  }
}

async function syncTable(table) {
  const t0 = Date.now();
  // users(_all) is the account list — it lives in the accounts table (sync-users-from-supabase.cjs).
  const rows = (await readSupabase(table)).filter((r) => !(table === "users" && r.id === "_all"));
  await writeWorker(table, rows);
  const keep = new Set(rows.map((r) => String(r.id)));
  const stale = (await workerIds(table)).filter((id) => !keep.has(id) && !(table === "users" && id === "_all"));
  for (const id of stale) {
    await retry(async () => ok(await fetch(`${WORKER}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: wHeaders }), `delete ${table}`), `delete ${table}`);
  }
  console.log(`${table.padEnd(13)} ${String(rows.length).padStart(6)} rows synced, ${stale.length} removed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const only = process.argv.slice(2);
for (const t of only.length ? only : TABLES) await syncTable(t);
