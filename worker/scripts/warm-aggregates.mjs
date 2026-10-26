// Fills the PO aggregate caches (migration 0003) right after it is applied, one month per
// request so no single request has to build a whole year (free plan: 10 ms CPU per request).
// Safe to re-run: buckets that are already built cost one cache read.
//
//   MIGRATION_TOKEN=... [WORKER_URL=...] node scripts/warm-aggregates.mjs [fromYear]
const WORKER = (process.env.WORKER_URL || "https://tdt.todaytec.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
if (!TOKEN) { console.error("MIGRATION_TOKEN is required"); process.exit(1); }
const fromYear = +(process.argv[2] || 2020);
const H = { "x-migration-token": TOKEN, "content-type": "application/json" };
const total = { read: 0, written: 0 };

async function rpc(fn, args) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${WORKER}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    total.read += +(r.headers.get("x-d1-rows-read") || 0);
    total.written += +(r.headers.get("x-d1-rows-written") || 0);
    if (r.ok) return r.json();
    if (i >= 3) throw new Error(`${fn} ${JSON.stringify(args)} HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
}

const now = new Date();
for (let y = fromYear; y <= now.getUTCFullYear(); y++) {
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    await rpc("po_agg", { p_from: `${y}-${mm}-01`, p_to: `${y}-${mm}-31` });
  }
}
console.log(`po_count ${await rpc("po_count", {})}`);
console.log(`po_customer_stats ${(await rpc("po_customer_stats", {})).length} customers`);
console.log(`D1: ${total.read} rows read, ${total.written} rows written`);
