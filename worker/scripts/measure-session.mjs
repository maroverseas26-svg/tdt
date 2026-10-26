// Plays one realistic CRM session in headless Chromium against a Worker and sums the D1
// rows read/written it caused (x-d1-rows-read / x-d1-rows-written response headers).
// Session: login, Overview, Customers, Projects, Quotations, PO List, Retention, Targets,
// reload, logout.
//
//   NODE_PATH=$(npm root -g) WORKER_URL=http://127.0.0.1:8787 TEST_EMAIL=... TEST_PASSWORD=... \
//     node scripts/measure-session.mjs [--detail] [--returning]
//
// A fresh browser also runs the app's one-time qty/sqm repair, which reads every PO once;
// --returning marks it as already done, like any browser that has signed in before.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // resolved via NODE_PATH
const BASE = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL, PASSWORD = process.env.TEST_PASSWORD;
const DETAIL = process.argv.includes("--detail");
const DETAIL_W = +(process.env.DETAIL_WIDTH || 160);
const RETURNING = process.argv.includes("--returning");
if (!EMAIL || !PASSWORD) { console.error("TEST_EMAIL and TEST_PASSWORD are required"); process.exit(1); }

// Nav labels (en / vi), in session order.
const PAGES = [
  ["Overview", "Tổng quan"], ["Customers", "Khách hàng"], ["Projects", "Dự án"], ["Quotations", "Báo giá"],
  ["PO List"], ["Retention"], ["Targets", "Chỉ tiêu"],
];

const total = { read: 0, written: 0, requests: 0 };
const steps = [];
let step = { name: "load", read: 0, written: 0, requests: 0, calls: [] };
const startStep = (name) => { steps.push(step); step = { name, read: 0, written: 0, requests: 0, calls: [] }; };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("response", async (res) => {
  const h = res.headers();
  if (h["x-d1-rows-read"] === undefined) return;
  const r = +h["x-d1-rows-read"], w = +h["x-d1-rows-written"];
  total.read += r; total.written += w; total.requests++;
  step.read += r; step.written += w; step.requests++;
  const u = new URL(res.url());
  step.calls.push({ read: r, written: w, path: res.request().method() + " " + decodeURIComponent(u.pathname + u.search).slice(0, DETAIL_W) });
});
if (RETURNING) await page.addInitScript(() => localStorage.setItem("ttcrm_qty_sqm_fix_v1", "1"));
page.on("pageerror", (e) => console.error("pageerror:", e.message));

async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
}

await page.goto(BASE + "/");
await page.waitForSelector('input[type="email"]', { timeout: 60000 });
startStep("login");
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.keyboard.press("Enter");
await page.waitForSelector(".nav-item", { timeout: 120000 });
await settle();

for (const labels of PAGES) {
  startStep(labels[0]);
  const btn = page.locator(".nav-item").filter({ hasText: new RegExp("^\\W*(" + labels.join("|") + ")\\s*$") }).first();
  await btn.click({ timeout: 30000 });
  await settle();
}

startStep("reload");
await page.reload();
await page.waitForSelector(".nav-item", { timeout: 120000 });
await settle();

startStep("logout");
await page.evaluate(() => fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
await settle();
steps.push(step);
await browser.close();

for (const s of steps) {
  console.log(`${s.name.padEnd(11)} read ${String(s.read).padStart(9)}  written ${String(s.written).padStart(6)}  requests ${s.requests}`);
  if (DETAIL) for (const c of s.calls.filter((c) => c.read || c.written).sort((a, b) => b.read - a.read)) console.log(`    ${String(c.read).padStart(8)} ${String(c.written).padStart(4)}  ${c.path}`);
}
console.log(`TOTAL       read ${String(total.read).padStart(9)}  written ${String(total.written).padStart(6)}  requests ${total.requests}`);
