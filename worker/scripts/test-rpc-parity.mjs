// Parity test for the cached PO RPCs (src/rpc.js, migration 0003): every RPC answer from a
// local Worker must equal the old full-scan SQL (scripts/parity/rpc-old.mjs) run directly on
// the same local D1 SQLite file. With --writes it also inserts / edits / soft-deletes /
// un-deletes / moves / hard-deletes POs through /rest/v1/pos (single and bulk) and re-checks
// after every step, then puts the data back.
//
//   WORKER_URL=http://127.0.0.1:8787 MIGRATION_TOKEN=... node scripts/test-rpc-parity.mjs [--writes]
//
// Floats: the cache sums each month separately and adds the months in JS, so an amount/sqm
// may differ from the single-pass SUM in the last bits; values are equal when they agree to
// 1e-9 relative (the report also counts the bit-exact ones).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { FNS as OLD } from "./parity/rpc-old.mjs";

const WORKER = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
if (!TOKEN) { console.error("MIGRATION_TOKEN is required"); process.exit(1); }
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "../.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = fs.readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
const db = new DatabaseSync(path.join(dir, file), { readOnly: true });
const oldEnv = {
  DB: {
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first(col) { const r = db.prepare(sql).get(...args); return r ? (col ? r[col] : r) : null; },
      };
      return st;
    },
  },
};
const H = { "x-migration-token": TOKEN, "content-type": "application/json" };
async function rpcNew(fn, args) {
  const r = await fetch(`${WORKER}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn} HTTP ${r.status} ${await r.text()}`);
  return { body: await r.json(), read: +r.headers.get("x-d1-rows-read"), written: +r.headers.get("x-d1-rows-written") };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

const today = new Date().toISOString().slice(0, 10);
const RANGES = [
  ["2025-01-01", "2025-12-31"], ["2026-01-01", today], ["2026-01-01", "2026-12-31"], ["2025-03-15", "2025-11-20"],
  ["2025-06-10", "2026-02-03"], ["2026-10-05", "2026-10-20"], [null, null], ["2025-07-01", null], [null, "2025-02-14"],
];

let exact = 0, close = 0;
function numEq(a, b) {
  if (a === b) { exact++; return true; }
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { close++; return true; }
  return false;
}
function rowsEq(a, b, keyCols, label) {
  const k = (r) => JSON.stringify(keyCols.map((c) => r[c]));
  const ma = new Map(a.map((r) => [k(r), r])), mb = new Map(b.map((r) => [k(r), r]));
  const errs = [];
  if (ma.size !== a.length || mb.size !== b.length) errs.push(`duplicate keys (old ${a.length}/${ma.size}, new ${b.length}/${mb.size})`);
  for (const [key, ra] of ma) {
    const rb = mb.get(key);
    if (!rb) { errs.push(`missing in new: ${key}`); continue; }
    for (const c of Object.keys(ra)) if (!numEq(ra[c], rb[c])) errs.push(`${key} ${c}: old ${ra[c]} new ${rb[c]}`);
    if (Object.keys(rb).length !== Object.keys(ra).length) errs.push(`${key}: columns ${Object.keys(rb)} vs ${Object.keys(ra)}`);
  }
  for (const key of mb.keys()) if (!ma.has(key)) errs.push(`extra in new: ${key}`);
  const order = a.map(k).join("\n") === b.map(k).join("\n");
  return { ok: !errs.length, errs, n: a.length, order };
}

// po_customer_stats: last_pic/last_product come from row_number() over the last date, which
// is arbitrary when a customer has several POs on that date — accept any of those rows.
function lastRowCandidates(cid) {
  return db.prepare(`SELECT pic, nullif(CAST(json_extract(data, '$.commercial') AS TEXT), '') AS prod FROM pos
    WHERE is_obj = 1 AND deleted = 0 AND cust = ?1 AND d = (SELECT max(d) FROM pos WHERE is_obj = 1 AND deleted = 0 AND cust = ?1)`).all(cid);
}

const results = [];
function record(name, res, cost) {
  results.push({ name, ...res });
  console.log(`${res.ok ? "OK  " : "FAIL"} ${name.padEnd(48)} rows ${String(res.n).padStart(5)}${res.order === false ? " (order differs)" : ""}  [new: read ${cost.read}, written ${cost.written}]`);
  if (!res.ok) res.errs.slice(0, 8).forEach((e) => console.log("       " + e));
}

async function checkAll(tag) {
  for (const [f, t] of RANGES) {
    const args = { p_from: f, p_to: t };
    for (const [fn, keys] of [["po_agg", ["yr", "mo", "pic", "cust", "grp"]], ["po_agg_material", ["yr", "mo", "code", "pic", "cust"]]]) {
      const o = plain(await OLD[fn](oldEnv, args)), n = await rpcNew(fn, args);
      record(`${tag}${fn} ${f}..${t}`, rowsEq(o, n.body, keys), n);
    }
  }
  for (const y of ["2025", "2026"]) {
    const o = plain(await OLD.po_month_totals(oldEnv, { p_year: y })), n = await rpcNew("po_month_totals", { p_year: y });
    record(`${tag}po_month_totals ${y}`, rowsEq(o, n.body, ["mo"]), n);
  }
  {
    const o = await OLD.po_count(oldEnv), n = await rpcNew("po_count", {});
    record(`${tag}po_count`, { ok: o === n.body, errs: [`old ${o} new ${n.body}`], n: 1 }, n);
  }
  {
    const o = plain(await OLD.po_customer_stats(oldEnv)), n = await rpcNew("po_customer_stats", {});
    const res = rowsEq(o.map((r) => ({ ...r, last_pic: null, last_product: null })), n.body.map((r) => ({ ...r, last_pic: null, last_product: null })), ["customer_id"]);
    let ties = 0;
    const byId = new Map(n.body.map((r) => [r.customer_id, r]));
    for (const r of o) {
      const nr = byId.get(r.customer_id);
      if (!nr || (nr.last_pic === r.last_pic && nr.last_product === r.last_product)) continue;
      if (lastRowCandidates(r.customer_id).some((c) => c.pic === nr.last_pic && c.prod === nr.last_product)) ties++;
      else { res.ok = false; res.errs.push(`${r.customer_id} last: old ${r.last_pic}/${r.last_product} new ${nr.last_pic}/${nr.last_product}`); }
    }
    record(`${tag}po_customer_stats (${o.length} customers${ties ? `, ${ties} tie(s) on the last date` : ""})`, res, n);
  }
}

async function upsert(rows) {
  const r = await fetch(`${WORKER}/rest/v1/pos`, { method: "POST", headers: H, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`upsert HTTP ${r.status} ${await r.text()}`);
  return { read: +r.headers.get("x-d1-rows-read"), written: +r.headers.get("x-d1-rows-written") };
}
async function del(id) {
  const r = await fetch(`${WORKER}/rest/v1/pos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: H });
  if (!r.ok) throw new Error(`delete HTTP ${r.status}`);
  return { read: +r.headers.get("x-d1-rows-read"), written: +r.headers.get("x-d1-rows-written") };
}
const rowOf = (id) => { const r = db.prepare("SELECT id, data, updated_at FROM pos WHERE id = ?").get(id); return { id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at }; };

await checkAll("");

if (process.argv.includes("--writes")) {
  const pick = (sql) => db.prepare(sql).all().map((r) => r.id);
  // Live POs in a few different months, plus one already soft-deleted.
  const live = pick(`SELECT id FROM pos WHERE is_obj = 1 AND deleted = 0 AND d IN (SELECT max(d) FROM pos WHERE is_obj = 1 AND deleted = 0 GROUP BY substr(d, 1, 7) ORDER BY 1 DESC LIMIT 6) GROUP BY d`);
  const dead = pick("SELECT id FROM pos WHERE is_obj = 1 AND deleted = 1 LIMIT 1");
  const originals = [...live, ...dead].map(rowOf);
  const now = () => new Date().toISOString();
  const edit = (r, patch) => ({ id: r.id, data: { ...r.data, ...patch }, updated_at: now() });
  const [a, b, c, d, e, f] = originals;
  const costs = [];
  const step = async (name, fn) => { const cost = await fn(); costs.push([name, cost]); console.log(`\n# ${name}  (write: read ${cost.read}, written ${cost.written})`); await checkAll(`[${name}] `); };
  const testId = "parity-test-" + Date.now();
  try {
    await step("insert new PO (single)", () => upsert({ id: testId, data: { ...a.data, id: testId, amountVnd: 1234567.89, sqm: 12.345, poNumber: "PARITY-1", _deleted: false }, updated_at: now() }));
    await step("edit amount + sqm (single)", () => upsert(edit(a, { amountVnd: (parseFloat(a.data.amountVnd) || 0) + 1000.5, sqm: (parseFloat(a.data.sqm) || 0) + 0.25 })));
    await step("soft-delete (single)", () => upsert(edit(b, { _deleted: true })));
    await step("un-delete (single)", () => upsert(edit(b, { _deleted: false })));
    await step("un-delete an old tombstone (single)", () => upsert(edit(e || f, { _deleted: false })));
    await step("move PO to another month + customer (single)", () => upsert(edit(c, { date: "2025-02-14", year: "2025", month: "02", customerId: d.data.customerId, pic: "ZZ" })));
    await step("bulk: edit + soft-delete + odd date + no date", () => upsert([
      edit(d, { amountVnd: 777, group: "de-x" }), edit(f || e, { _deleted: true }),
      { id: testId + "-odd", data: { ...a.data, id: testId + "-odd", date: "2026/10/03", amountVnd: 5 }, updated_at: now() },
      { id: testId + "-nodate", data: { ...a.data, id: testId + "-nodate", date: null, amountVnd: 6 }, updated_at: now() },
    ]));
    await step("hard DELETE via REST", () => del(testId));
  } finally {
    for (const id of [testId, testId + "-odd", testId + "-nodate"]) await del(id);
    await upsert(originals);
    console.log("\n# restored originals");
    await checkAll("[restored] ");
  }
  console.log("\nWrite costs:");
  for (const [n, c] of costs) console.log(`  ${n.padEnd(48)} read ${c.read}, written ${c.written}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks equal (${exact} values bit-exact, ${close} within 1e-9 relative)`);
process.exit(bad.length ? 1 : 0);
