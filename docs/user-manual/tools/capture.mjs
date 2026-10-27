// Takes the user-manual screenshots from a LOCAL Worker seeded by seed-demo.mjs.
//
//   node docs/user-manual/tools/seed-demo.mjs          # fresh demo data first (it resets the local D1)
//   NODE_PATH=$(npm root -g) node docs/user-manual/tools/capture.mjs [shot-name …]
//
// Every shot: 1440×900 viewport, English UI, signed in as the Sales Executive demo account
// (the Permissions shot uses the demo admin). The 1–2 elements a step talks about get a red
// rounded outline (injected CSS, removed after the shot), then the shot is cropped to the
// relevant area. No email leaves the machine: /api/quotes/send is answered by Playwright.
import { createRequire } from "node:module";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright"); // resolved via NODE_PATH
const BASE = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "img");
const ONLY = process.argv.slice(2);
const SALES = { email: "sales.demo@example.com", password: "demo1234" };
const ADMIN = { email: "admin.demo@example.com", password: "demo1234" };
const MAX_BYTES = 250 * 1024;
mkdirSync(OUT, { recursive: true });

// Export libraries load from cdnjs: route them through the session proxy when there is one.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
// en_GB: native date inputs read dd/mm/yyyy, like the rest of the app.
const browser = await chromium.launch({ proxy, env: { ...process.env, LANG: "en_GB.UTF-8", LANGUAGE: "en_GB" } });
const sent = [];

async function newPage(acct) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, acceptDownloads: true, locale: "en-GB" });
  // English UI, and no local leftovers from an earlier run.
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("um_init")) {
      localStorage.clear();
      localStorage.setItem("ttcrm_lang_v1", JSON.stringify("en"));
      localStorage.setItem("ttcrm_activity_v1", "[]");
      sessionStorage.setItem("um_init", "1");
    }
  });
  await ctx.route("**/api/quotes/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, to: SALES.email }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(BASE + "/");
  await page.waitForSelector('input[type="email"]', { timeout: 60000 });
  if (acct) await signIn(page, acct);
  return page;
}
async function signIn(page, acct) {
  await page.fill('input[type="email"]', acct.email);
  await page.fill('input[type="password"]', acct.password);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".nav-item", { timeout: 60000 });
  await settle(page);
}
async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function nav(page, label) {
  await page.locator(".nav-item").filter({ hasText: new RegExp("^\\W*" + label + "\\s*$") }).first().click();
  await settle(page);
}

// ---- highlight + crop ----
const MARK_CSS = ".um-mark{outline:2px solid #E11D48 !important;outline-offset:3px !important;border-radius:8px !important}";
async function mark(page, locs) {
  await page.addStyleTag({ content: MARK_CSS });
  for (const l of locs) await l.first().evaluate((el) => el.classList.add("um-mark"));
}
async function unmark(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".um-mark").forEach((el) => el.classList.remove("um-mark"));
    document.querySelectorAll("style").forEach((s) => { if (s.textContent.includes(".um-mark")) s.remove(); });
  });
}
// area: locator(s) whose union (plus pad) is the crop; marks: the 1–2 elements to outline.
// fixed: the area sits in a fixed overlay (modal, popup) — crop the viewport, not the page.
async function shot(page, name, { area, marks = [], pad = 12, maxH = 900, fixed = false } = {}) {
  if (ONLY.length && !ONLY.includes(name)) return;
  if (!fixed) await page.evaluate(() => window.scrollTo(0, 0));
  await mark(page, marks);
  await page.waitForTimeout(150);
  let clip;
  if (area) {
    const boxes = [];
    for (const l of [].concat(area)) { const b = await l.first().boundingBox(); if (b) boxes.push(b); }
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
    const vw = 1440, vh = fixed ? 900 : await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
    const x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad);
    clip = { x, y, width: Math.min(vw, x1 + pad) - x, height: Math.min(vh, y1 + pad, y + maxH) - y };
  }
  const file = join(OUT, name + ".png");
  await page.screenshot({ path: file, clip, fullPage: !!clip && !fixed });
  await unmark(page);
  shrink(file);
  console.log(`${name}.png  ${Math.round(statSync(file).size / 1024)} KB`);
}
// Keep every PNG under 250 KB: palette-quantise, then scale down if still too big.
function shrink(file) {
  if (statSync(file).size <= MAX_BYTES) return;
  execFileSync("convert", [file, "-strip", "-colors", "128", "PNG8:" + file]);
  for (let pct = 90; statSync(file).size > MAX_BYTES && pct >= 50; pct -= 10) {
    execFileSync("convert", [file, "-resize", pct + "%", "PNG8:" + file]);
  }
}
const $ = (page, sel) => page.locator(sel);
const byText = (page, sel, text) => page.locator(sel).filter({ hasText: text });

/* ======================= 00 Getting started ======================= */
{
  const page = await newPage(null);
  const card = $(page, ".login-card");
  await page.fill('input[type="email"]', SALES.email);
  await shot(page, "login", { area: card, marks: [$(page, ".login-form .login-btn"), $(page, ".login-forgot")], pad: 20 });
  await page.click(".login-forgot");
  await page.waitForTimeout(300);
  await page.click("text=Back to sign in");
  await page.fill('input[type="password"]', SALES.password);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".nav-item", { timeout: 60000 });
  await settle(page, 2500);

  await shot(page, "topbar", { area: $(page, ".topbar"), marks: [$(page, ".dr-btn"), $(page, ".topbar-right")], pad: 6 });
  await page.click(".dr-btn");
  await page.waitForTimeout(300);
  await shot(page, "date-range", { fixed: true, area: [$(page, ".dr-btn"), $(page, ".dr-pop")], marks: [$(page, ".dr-preset.on"), $(page, ".dr-apply")] });
  await page.click(".dr-cancel");

  /* ======================= 01 Overview ======================= */
  await shot(page, "overview-kpis", { area: [$(page, ".page-head").first(), $(page, ".kpi-row").first()], marks: [] , maxH: 600 });

  /* ======================= 02 Customers ======================= */
  await nav(page, "Customers");
  await shot(page, "customers-toolbar", { area: [$(page, ".page-head"), $(page, ".list-toolbar")], marks: [$(page, ".search-box"), byText(page, "button", "Group by Name Code")] });

  await byText(page, "button", "Add customer").click();
  await page.waitForTimeout(300);
  await page.fill('.modal input[placeholder="Company Co., Ltd."]', "Saigon Print Demo");
  await page.fill('.modal input[placeholder="+84 / +66 …"]', "+84 28 0000 0202");
  await page.waitForTimeout(300);
  await $(page, ".modal .dup-panel").scrollIntoViewIfNeeded();
  await shot(page, "customer-add-duplicate", { area: [page.locator(".modal .field", { hasText: "Phone" }).first(), $(page, ".modal .modal-actions")], marks: [$(page, ".dup-panel")], fixed: true });
  await page.keyboard.press("Escape");
  await page.locator(".modal button", { hasText: "Cancel" }).click().catch(() => {});
  await page.waitForTimeout(300);

  // profile: Demo Label
  await byText(page, "tr.ret-acc-row", "DML").locator(".ret-detail-link").click();
  await settle(page);
  await shot(page, "customer-profile", { area: [$(page, ".back-btn"), $(page, ".profile-head")], marks: [$(page, ".profile-status select")] });
  await page.context().close();
}

/* ======================= 06 Quotations / 07 PO List ======================= */
{
  const page = await newPage(SALES);
  await nav(page, "Quotations");

  // detail of a quote (click the customer name)
  await page.locator(".pr-cust-link", { hasText: "Siam Barcode" }).first().click();
  await settle(page, 500);
  await shot(page, "quotation-detail", { area: [$(page, ".back-btn"), $(page, ".profile-head")], marks: [$(page, ".profile-head select"), byText(page, ".profile-head button", "Send quotation")] });

  // send quotation: Thailand seller block (first-time setup), currency + products, actions
  await byText(page, ".profile-head button", "Send quotation").click();
  await settle(page, 800);
  await shot(page, "send-quotation-seller", { area: [$(page, ".qx-page .back-btn"), $(page, ".qx-actions"), $(page, ".qx-company")], marks: [$(page, ".qx-company"), $(page, ".qx-actions")] });
  await $(page, ".qx-company .btn-primary").click();
  await settle(page, 800);
  await $(page, ".qx-actions select").selectOption("both");
  await $(page, ".qx-actions .btn-primary").click();
  await page.locator("p.login-sent, p.login-err").first().waitFor({ timeout: 60000 }).catch(() => {});
  await shot(page, "send-quotation-actions", { area: [$(page, ".qx-page .page-header"), page.locator("p.login-sent, p.login-err").first()], marks: [$(page, ".qx-actions select"), $(page, ".qx-actions .btn-primary")] });
  await $(page, ".qx-page .back-btn").click();
  await settle(page, 500);
  await page.locator(".back-btn").first().click();
  await settle(page, 500);

  // New PO from a won quote
  await page.locator(".pr-cust-link", { hasText: "Chiang Mai Label" }).first().click();
  await settle(page, 500);
  const won = page.locator(".card", { hasText: "Create PO" }).first();
  await shot(page, "po-from-quote", { area: [$(page, ".profile-head"), won], marks: [won.locator("button")] });
  await won.locator("button").click();
  await settle(page, 1200);
  await shot(page, "po-new-form", { area: [page.locator(".modal, .page").first()], marks: [page.locator(".li-row").first().locator("input").nth(1), page.locator(".field", { hasText: "Quotation reference" }).first()], maxH: 820, fixed: (await page.locator(".modal").count()) > 0 });
  await page.keyboard.press("Escape");
  await page.locator("button", { hasText: "Cancel" }).first().click().catch(() => {});

  await nav(page, "PO List");
  await page.locator("tr.ret-acc-row", { hasText: "DML" }).first().locator(".ret-exp-btn").click();
  await settle(page, 2000);
  await shot(page, "po-list", { area: [$(page, ".page-head"), $(page, ".table-card")], marks: [byText(page, "button", "New PO"), page.locator("tr.ret-acc-row", { hasText: "DML" }).first()], maxH: 760 });
  await page.context().close();
}

/* ======================= 03–05, 08–10 ======================= */
{
  const page = await newPage(SALES);
  // Pipelines
  await nav(page, "Pipelines");
  await shot(page, "pipelines-board", { area: [$(page, ".page-head, .page header").first(), $(page, ".kanban")], marks: [page.locator(".kcard").first(), page.locator(".seg").first()], maxH: 620 });

  // Projects: new project form, then a project's stage
  await nav(page, "Projects");
  await byText(page, "button", "New Project").click();
  await settle(page, 600);
  await shot(page, "project-new", { area: page.locator(".page").first(), marks: [page.locator(".field", { hasText: "Customer" }).locator("select").first(), page.locator(".field", { hasText: "Project name" }).locator("input").first()], maxH: 620 });
  await page.locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await nav(page, "Projects");
  await page.locator("tr.row-click", { hasText: "Mekong Ribbon" }).locator("td").nth(1).click();
  await settle(page, 600);
  await shot(page, "project-stage", { area: [$(page, ".back-btn"), $(page, ".profile-head")], marks: [$(page, ".profile-status select")] });

  // Samples: list, then feedback on one sample
  await nav(page, "Samples");
  await shot(page, "samples-list", { area: [$(page, ".page-head"), $(page, ".table-card")], marks: [byText(page, "button", "New sample"), page.locator(".table-card tbody tr").first().locator("td").nth(4)], maxH: 620 });
  await page.locator(".table-card tbody tr", { hasText: "Mekong Ribbon" }).first().locator("td").nth(1).click();
  await settle(page, 600);
  const tsCard = page.locator(".card", { hasText: "Test status" }).last();
  await shot(page, "sample-feedback", { area: tsCard, marks: [tsCard.locator("select").first(), tsCard.locator(".btn-primary").first()] });

  // Retention
  await nav(page, "Retention");
  await page.locator("tr.ret-acc-row").first().click();
  await settle(page, 600);
  await shot(page, "retention", { area: [$(page, ".page-head, .page header").first(), page.locator(".ret-sub-wrap.open").first()], marks: [page.locator(".seg, .ret-health-seg").first(), page.locator("tr.ret-acc-row").first()], maxH: 760 });

  // Targets
  await nav(page, "Targets");
  await shot(page, "targets", { area: [$(page, ".page-head, .page header").first(), page.locator("table").first()], marks: [page.locator(".seg, .tabs").first()], maxH: 560 });

  // Sales Forecast: commit one SKU row
  await nav(page, "Sales Forecast");
  const st = page.locator("select").filter({ has: page.locator("option[value=Submitted]") }).nth(1);
  await st.selectOption("Submitted").catch(() => {});
  await settle(page, 600);
  await shot(page, "forecast", { area: [$(page, ".page-head, .page header").first(), page.locator("tbody tr").nth(3)], marks: [page.locator("input.sf-in").nth(6), st], maxH: 620 });

  // Products
  await nav(page, "Products");
  await page.locator(".ret-exp-btn").nth(3).click();
  await page.waitForTimeout(400);
  await shot(page, "products", { area: [$(page, ".page-head"), $(page, ".table-card")], marks: [$(page, ".search-box"), page.locator("tr.nc-sub-row").first()], maxH: 620 });
  await page.context().close();
}

/* ======================= 11 Access (admin view of the matrix) ======================= */
{
  const page = await newPage(ADMIN);
  await nav(page, "Permissions");
  const card = $(page, ".perm-card");
  await shot(page, "permissions-matrix", { area: card, marks: [page.locator("select.perm-lv").nth(3), page.locator("select.perm-lv").nth(4)], maxH: 700 });
  await page.context().close();
}

await browser.close();
if (sent.length) console.log("intercepted quote emails:", sent.length);
