// Checks the app's keyset PO paging (SB.queryAll in frontend/src/app/data.js) against one
// unpaged query: same rows, same (date, id) order, no duplicates — for several filters, both
// directions, with caps, and with an undated and an odd-dated PO present (inserted through
// /rest/v1/pos for the test and removed afterwards).
//
//   NODE_PATH=$(npm root -g) WORKER_URL=http://127.0.0.1:8787 MIGRATION_TOKEN=... TEST_EMAIL=... TEST_PASSWORD=... \
//     node scripts/test-po-paging.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // resolved via NODE_PATH
const BASE = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const { MIGRATION_TOKEN: TOKEN, TEST_EMAIL: EMAIL, TEST_PASSWORD: PASSWORD } = process.env;
if (!TOKEN || !EMAIL || !PASSWORD) { console.error("MIGRATION_TOKEN, TEST_EMAIL and TEST_PASSWORD are required"); process.exit(1); }
const H = { "x-migration-token": TOKEN, "content-type": "application/json" };

const sample = (await (await fetch(`${BASE}/rest/v1/pos?select=id,data&order=data->>date.desc&limit=3`, { headers: H })).json());
const custIds = [...new Set(sample.map((r) => r.data.customerId))];
const extra = [
  { id: "paging-test-nodate", data: { ...sample[0].data, id: "paging-test-nodate", date: null } },
  { id: "paging-test-odd", data: { ...sample[0].data, id: "paging-test-odd", date: "2026/1/5" } },
  { id: "paging-test-tie", data: { ...sample[0].data, id: "paging-test-tie" } },
];
await fetch(`${BASE}/rest/v1/pos`, { method: "POST", headers: H, body: JSON.stringify(extra) });

const browser = await chromium.launch();
let failed = 0;
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("ttcrm_qty_sqm_fix_v1", "1"));
  await page.goto(BASE + "/");
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".nav-item", { timeout: 120000 });

  const cases = [
    [{ order: "date", dir: "desc" }, 0],
    [{ order: "date", dir: "asc" }, 0],
    [{ order: "date", dir: "desc" }, 6000],
    [{ order: "date", dir: "asc" }, 2500],
    [{ from: "2026-01-01", to: "2026-10-26", order: "date", dir: "desc" }, 0],
    [{ from: "2025-03-15", to: "2025-11-20", order: "date", dir: "asc" }, 0],
    [{ from: "2025-03-15", to: "2025-11-20", order: "date", dir: "desc" }, 1500],
    [{ customerIds: custIds, order: "date", dir: "desc" }, 0],
    [{ includeDeleted: true, order: "date", dir: "desc" }, 0],
    [{ search: "PO", order: "date", dir: "desc" }, 0],
  ];
  for (const [opts, cap] of cases) {
    const res = await page.evaluate(async ([opts, cap]) => {
      const SB = window.CRM.SB;
      const got = await SB.queryAll(opts, cap);
      // Reference: the same filter in one unpaged request, ordered by (date, id).
      const ref = await SB.queryPage(Object.assign({}, opts, { limit: 100000, offset: 0 }));
      return { got: got.rows.map((r) => r.id), total: got.total, capped: got.capped, ref: ref.rows.map((r) => r.id), refTotal: ref.total };
    }, [opts, cap]);
    const want = cap ? res.ref.slice(0, cap) : res.ref.slice(0, 20000);
    const same = want.length === res.got.length && want.every((id, i) => id === res.got[i]);
    const dups = res.got.length - new Set(res.got).size;
    const totalOk = res.total === res.refTotal && res.capped === (res.refTotal > res.got.length);
    const ok = same && !dups && (opts.noCount || totalOk);
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${JSON.stringify(opts).slice(0, 90).padEnd(90)} cap ${String(cap).padStart(5)}  rows ${res.got.length}/${res.refTotal}${dups ? ` dups ${dups}` : ""}${same ? "" : " ORDER/ROWS DIFFER"}${totalOk ? "" : ` total ${res.total} capped ${res.capped}`}`);
  }
} finally {
  await browser.close();
  for (const r of extra) await fetch(`${BASE}/rest/v1/pos?id=eq.${r.id}`, { method: "DELETE", headers: H });
}
process.exit(failed ? 1 : 0);
