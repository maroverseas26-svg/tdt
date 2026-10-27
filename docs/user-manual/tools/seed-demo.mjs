// Seeds a LOCAL Worker (wrangler dev --local) with fictional demo data for the user manual
// screenshots. Never point this at the deployed Worker: it wipes the local D1 tables first.
//
//   cd worker && npx wrangler d1 migrations apply tdt --local && npm run build
//   npx wrangler dev --local            # in another terminal
//   node ../docs/user-manual/tools/seed-demo.mjs
//
// Accounts it creates (local only):
//   sales.demo@example.com / demo1234  — Sales Executive "Mai Demo" (code MAI), Edit on every team module
//   admin.demo@example.com / demo1234  — BOD "Demo Admin", used only for the Permissions shot
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) { console.error("seed-demo only runs against a local Worker"); process.exit(1); }
const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "worker");
const PASSWORD = "demo1234";

/* ---------- accounts (PBKDF2-SHA256 like worker/src/auth.js) ---------- */
const b64 = (u8) => Buffer.from(u8).toString("base64");
async function hashPassword(pw, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(bits)}`;
}
const TEAM = ["overview", "customers", "pipelines", "projects", "samples", "quotations", "polist", "products", "target", "forecast", "retention"];
const ALL = [...TEAM, "admin"];
const salesPerms = Object.fromEntries(TEAM.map((m) => [m, "edit"]));
const USERS = [
  { id: "u-demo-mai", name: "Mai Demo", email: "sales.demo@example.com", role: "SALEEXEC", salesCode: "MAI",
    countries: ["Vietnam", "Thailand"], targetCountry: "Vietnam", modules: TEAM, perms: salesPerms, active: true, avatar: "M", phone: "+84 90 000 0001" },
  { id: "u-demo-nam", name: "Nam Demo", email: "nam.demo@example.com", role: "SALEEXEC", salesCode: "NAM",
    countries: ["Vietnam"], modules: TEAM, perms: salesPerms, active: true, avatar: "N" },
  { id: "u-demo-admin", name: "Demo Admin", email: "admin.demo@example.com", role: "BOD", salesCode: "",
    countries: ["*"], modules: ALL, active: true, avatar: "D" },
];
const ROLES = [
  { id: "BOD", name: "Admin", scope: "all", fixed: true, modules: ALL, perms: Object.fromEntries(ALL.map((m) => [m, "admin"])) },
  { id: "SMGR", name: "Sales Manager", scope: "country", modules: TEAM, perms: { ...Object.fromEntries(TEAM.map((m) => [m, "admin"])) } },
  { id: "SALEEXEC", name: "Sales Executive", scope: "own", modules: TEAM, perms: salesPerms },
  { id: "TELE", name: "Telesales", scope: "own", modules: ["overview", "customers", "pipelines"], perms: { overview: "view", customers: "edit", pipelines: "edit" } },
  { id: "SUPPORT", name: "Sales Support", scope: "own", modules: TEAM, perms: Object.fromEntries(TEAM.map((m) => [m, "view"])) },
  { id: "SALE", name: "Sales", scope: "own", fixed: true, modules: TEAM, perms: salesPerms },
];

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const stamp = new Date().toISOString();
let sql = "DELETE FROM crm_rows; DELETE FROM pos; DELETE FROM sessions; DELETE FROM users; DELETE FROM login_failures; DELETE FROM password_resets;\n";
sql += "DELETE FROM po_agg_cache; DELETE FROM po_cust_stats;\n";
for (const u of USERS) {
  sql += `INSERT INTO users (id, email, active, deleted, profile, pw_hash, pw_updated_at, updated_at) VALUES (${q(u.id)}, ${q(u.email)}, 1, 0, ${q(JSON.stringify(u))}, ${q(await hashPassword(PASSWORD))}, ${q(stamp)}, ${q(stamp)});\n`;
}
const tmp = mkdtempSync(join(tmpdir(), "tdt-seed-"));
writeFileSync(join(tmp, "seed.sql"), sql);
execFileSync("npx", ["wrangler", "d1", "execute", "tdt", "--local", "--file", join(tmp, "seed.sql")], { cwd: WORKER_DIR, stdio: ["ignore", "ignore", "inherit"] });
console.log("accounts:", USERS.map((u) => u.email).join(", "));

/* ---------- sign in as the demo admin and write the data through /rest/v1 ---------- */
const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin.demo@example.com", password: PASSWORD }) });
if (!login.ok) { console.error("login failed", login.status, await login.text()); process.exit(1); }
const cookie = login.headers.get("set-cookie").split(";")[0];
async function post(table, rows) {
  const r = await fetch(BASE + "/rest/v1/" + table, { method: "POST", headers: { cookie, "content-type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(table + " HTTP " + r.status + " " + (await r.text()));
}
const row = (id, data) => ({ id, data, updated_at: stamp });

/* ---------- dates: everything is relative to today ---------- */
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const daysAhead = (n) => daysAgo(-n);
const monthOf = (n) => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };

/* ---------- customers (fictional) ---------- */
const C = (id, o) => ({
  id, bizId: "", shortName: "", city: "", district: "", address: "", type: "Dealer", leadSource: "Referral",
  pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "", email: "", website: "", note: "",
  contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "", decisionMaker: false, companySizeEstimate: "",
  owner: "MAI", status: "", funnel: "New", group: "", created: daysAgo(200), _updated: stamp.slice(0, 16).replace("T", " "), ...o,
});
const CUSTOMERS = [
  C("CD-01", { name: "Demo Label Co., Ltd.", shortName: "Demo Label", nameCode: "DML", bizId: "0300000101", country: "Vietnam", city: "Ho Chi Minh City", district: "Tan Binh", type: "Printing Service", phone: "+84 28 0000 0101", email: "purchase@demolabel.example", pic: "Ms. Lan", title: "Purchasing", status: "Current Customer", funnel: "Hot Lead", group: "A", leadSource: "Referral", nextActionDate: daysAhead(3), nextActionNote: "Confirm November order quantity",
    contactHistory: [{ date: daysAgo(2), channel: "Call", summary: "Ms. Lan confirmed the next order will include wax resin.", by: "MAI" }, { date: daysAgo(9), channel: "Visit", summary: "Checked printer settings at the factory.", by: "MAI" }], lastContactDate: daysAgo(2) }),
  C("CD-02", { name: "Saigon Print Demo JSC", shortName: "Saigon Print", nameCode: "SGP", bizId: "0300000202", country: "Vietnam", city: "Ho Chi Minh City", district: "District 7", type: "Printing Service", phone: "+84 28 0000 0202", email: "info@saigonprint.example", pic: "Mr. Hai", status: "Current Customer", funnel: "Hot Lead", group: "A", leadSource: "Website" }),
  C("CD-03", { name: "Saigon Print Demo JSC – Ha Noi Branch", shortName: "Saigon Print HN", nameCode: "SGP", bizId: "0300000202-001", country: "Vietnam", city: "Ha Noi", district: "Cau Giay", type: "Printing Service", phone: "+84 24 0000 0203", status: "Quotation / Quote", funnel: "Warm Lead", group: "B", leadSource: "Website" }),
  C("CD-04", { name: "Mekong Ribbon Demo Co., Ltd.", shortName: "Mekong Ribbon", nameCode: "MKR", bizId: "1800000404", country: "Vietnam", city: "Can Tho", type: "Dealer", phone: "+84 292 000 0404", status: "Send samples", funnel: "Warm Lead", group: "B", leadSource: "Zalo / Line" }),
  C("CD-05", { name: "Hanoi Barcode Demo Trading", shortName: "Hanoi Barcode", nameCode: "HNB", bizId: "0100000505", country: "Vietnam", city: "Ha Noi", type: "System Integrator", phone: "+84 24 0000 0505", status: "Customer requested a meeting", funnel: "Warm Lead", group: "C", leadSource: "Search / AI Search", nextActionDate: daysAhead(1), nextActionNote: "Meeting at their office" }),
  C("CD-06", { name: "Da Nang Tag & Label Demo", shortName: "Da Nang Tag", nameCode: "DNT", bizId: "0400000606", country: "Vietnam", city: "Da Nang", type: "Slitter", phone: "+84 236 000 0606", status: "Send company profile via Line/Email", funnel: "Cold Lead", group: "E", leadSource: "Data" }),
  C("CD-07", { name: "Binh Duong Packaging Demo", shortName: "BD Packaging", nameCode: "BDP", bizId: "3700000707", country: "Vietnam", city: "Binh Duong", type: "End-User", phone: "+84 274 000 0707", status: "No response from customer", funnel: "Attempted Contact", group: "", leadSource: "Hotline / Call" }),
  C("CD-08", { name: "Dong Nai Sticker Demo", shortName: "Dong Nai Sticker", nameCode: "DNS", bizId: "3600000808", country: "Vietnam", city: "Bien Hoa", type: "Printing Service", phone: "+84 251 000 0808", status: "", funnel: "New", leadSource: "Social / Mess" }),
  C("CD-09", { name: "Bangkok Ribbon Demo Co., Ltd.", shortName: "Bangkok Ribbon", nameCode: "BKR", bizId: "0105500000901", country: "Thailand", city: "Bangkok", type: "Dealer", phone: "+66 2 000 0901", email: "sales@bkkribbon.example", pic: "K. Somchai", status: "Current Customer", funnel: "Hot Lead", group: "A", leadSource: "Referral" }),
  C("CD-10", { name: "Chiang Mai Label Demo", shortName: "Chiang Mai Label", nameCode: "CML", bizId: "0505500001002", country: "Thailand", city: "Chiang Mai", type: "Printing Service", phone: "+66 53 000 1002", status: "Move to Quote - Project", funnel: "Hot Lead", group: "B", leadSource: "Website" }),
  C("CD-11", { name: "Siam Barcode Demo Ltd.", shortName: "Siam Barcode", nameCode: "SMB", bizId: "0105500001103", country: "Thailand", city: "Bangkok", type: "System Integrator", phone: "+66 2 000 1103", status: "Currently buying ribbon from another supplier", funnel: "Warm Lead", group: "C", leadSource: "Zalo / Line" }),
  C("CD-12", { name: "Rayong Print Demo", shortName: "Rayong Print", nameCode: "RYP", bizId: "0215500001204", country: "Thailand", city: "Rayong", type: "End-User", phone: "+66 38 000 1204", status: "Customer asked to call back later", funnel: "Cold Lead", leadSource: "Data" }),
  C("CD-13", { name: "Phuket Tag Demo", shortName: "Phuket Tag", nameCode: "PKT", bizId: "0835500001305", country: "Thailand", city: "Phuket", type: "Slitter", phone: "+66 76 000 1305", status: "Hung up abruptly", funnel: "Attempted Contact", leadSource: "Hotline / Call" }),
  C("CD-14", { name: "Thai Sticker Demo Co., Ltd.", shortName: "Thai Sticker", nameCode: "TSD", bizId: "0105500001406", country: "Thailand", city: "Nonthaburi", type: "Printing Service", phone: "+66 2 000 1406", status: "", funnel: "New", leadSource: "Social / Mess" }),
  C("CD-15", { name: "Hue Label Demo", shortName: "Hue Label", nameCode: "HUL", bizId: "3300001515", country: "Vietnam", city: "Hue", type: "Printing Service", phone: "+84 234 000 1515", status: "Current Customer", funnel: "Hot Lead", group: "D", leadSource: "Referral", owner: "NAM" }),
];
await post("customers", CUSTOMERS.map((c) => row(c.id, c)));

/* ---------- POs over the last 3 months ---------- */
const PRODUCTS = {
  TDW108: { grade: "Wax", w: 110, l: 300, vnd: 2300, thb: 3.2 },
  TDW121: { grade: "Wax", w: 110, l: 300, vnd: 2500, thb: 3.5 },
  TDM238: { grade: "Wax Resin", w: 110, l: 300, vnd: 4200, thb: 5.8 },
  TDM230: { grade: "Wax Resin", w: 90, l: 300, vnd: 3900, thb: 5.4 },
  TDR330: { grade: "Resin", w: 110, l: 300, vnd: 7600, thb: 10.5 },
};
let poN = 0;
function po(cust, monthsBack, day, code, qty, newRepeat, orderCount) {
  const { y, m } = monthOf(monthsBack);
  const p = PRODUCTS[code], c = CUSTOMERS.find((x) => x.id === cust);
  const dd = Math.min(day, monthsBack === 0 ? Math.max(1, today.getUTCDate() - 1) : 28);
  const date = `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const sqm = Math.round((p.w / 1000) * p.l * qty);
  poN++;
  return {
    id: "PO-D" + String(poN).padStart(3, "0"), customerId: cust, group: c.group || "E", pic: c.owner, year: y, month: m, date,
    productType: "FR", commercial: code, grade: p.grade, materialName: code, structureCode: `${code}.${p.w}×${p.l}`,
    width: p.w, length: p.l, qty, unit: "Cuộn", amountVnd: Math.round(sqm * p.vnd), sqm,
    poNumber: `PO-${c.nameCode}-${y}${String(m).padStart(2, "0")}${String(poN).padStart(2, "0")}`, poDate: date,
    invNo: "", edpCode: "", partNumber: "", itm: "", reportCode: "", deliveryCode: "",
    newRepeat, orderCount, commissionRate: 0, commissionAmt: 0, priceList: 0, warning: "", country: c.country,
  };
}
const POS = [
  po("CD-01", 2, 6, "TDW108", 480, "Repeat", 5), po("CD-01", 1, 8, "TDW108", 520, "Repeat", 6), po("CD-01", 0, 9, "TDM238", 240, "Repeat", 7),
  po("CD-02", 2, 12, "TDW121", 360, "Repeat", 3), po("CD-02", 1, 14, "TDW121", 400, "Repeat", 4), po("CD-02", 0, 15, "TDR330", 96, "Repeat", 5),
  po("CD-03", 0, 20, "TDW108", 120, "New", 1),
  po("CD-09", 2, 4, "TDW108", 600, "Repeat", 8), po("CD-09", 1, 5, "TDM230", 288, "Repeat", 9), po("CD-09", 0, 6, "TDW108", 640, "Repeat", 10),
  po("CD-10", 1, 22, "TDR330", 72, "New", 1),
  po("CD-04", 2, 25, "TDW121", 96, "New", 1),
  po("CD-15", 2, 18, "TDW108", 240, "Repeat", 3), po("CD-15", 1, 19, "TDW108", 260, "Repeat", 4),
];
// The demo admin's session writes them; the aggregate triggers fill the RPC caches.
await post("pos", POS.map((p) => row(p.id, p)));

/* ---------- projects, samples, quotations ---------- */
const PROJECTS = [
  { id: "P-D01", name: "Saigon Print — resin for outdoor labels", customerId: "CD-02", classification: "New project", product: "TTR Resin 110mm", ink: "Resin", productName: "TDR330",
    width: 110, length: 300, qtyRolls: 600, qtySqm: 19800, pricePerSqm: 7600, value: 150480000, closeMonth: monthOf(-1).y + "-" + String(monthOf(-1).m).padStart(2, "0"),
    sampleSent: true, quoteSent: true, poReceived: false, potential: "High", stage: "Quotation", result: "", endCustomer: "Outdoor signage", industry: "Label printing",
    application: "Outdoor asset labels", supplier: "", competitor: "", failReason: "", createdBy: "MAI", following: "MAI", note: "Customer tests against current resin supplier.",
    createdAt: daysAgo(20), probability: 50, expectedCloseDate: daysAhead(25), lossCompetitorPrice: 0, decisionCriteria: "Quality", linkedSampleId: "SMP-D01" },
  { id: "P-D02", name: "Mekong Ribbon — wax/resin trial", customerId: "CD-04", classification: "New project", product: "TTR Wax/Resin 110mm", ink: "Wax/Resin", productName: "TDM238",
    width: 110, length: 300, qtyRolls: 300, qtySqm: 9900, pricePerSqm: 4200, value: 41580000, closeMonth: "", sampleSent: true, quoteSent: false, poReceived: false,
    potential: "Medium", stage: "Sample", result: "", endCustomer: "", industry: "Ribbon dealer", application: "Carton labels", supplier: "", competitor: "", failReason: "",
    createdBy: "MAI", following: "MAI", note: "", createdAt: daysAgo(14), probability: 20, expectedCloseDate: daysAhead(45), lossCompetitorPrice: 0, decisionCriteria: "Price", linkedSampleId: "SMP-D02" },
  { id: "P-D03", name: "Chiang Mai Label — annual resin supply", customerId: "CD-10", classification: "Resupply", product: "TTR Resin 110mm", ink: "Resin", productName: "TDR330",
    width: 110, length: 300, qtyRolls: 900, qtySqm: 29700, pricePerSqm: 7600, value: 225720000, closeMonth: "", sampleSent: true, quoteSent: true, poReceived: true,
    potential: "High", stage: "PO", result: "", endCustomer: "", industry: "Label printing", application: "Pharma labels", supplier: "", competitor: "", failReason: "",
    createdBy: "MAI", following: "MAI", note: "First PO received, follow-up orders expected monthly.", createdAt: daysAgo(24), probability: 80, expectedCloseDate: daysAhead(10), lossCompetitorPrice: 0, decisionCriteria: "Quality", linkedSampleId: "" },
  { id: "P-D04", name: "Siam Barcode — switch from current supplier", customerId: "CD-11", classification: "New project", product: "TTR Wax 110mm", ink: "Wax", productName: "TDW108",
    width: 110, length: 300, qtyRolls: 1200, qtySqm: 39600, pricePerSqm: 2300, value: 91080000, closeMonth: "", sampleSent: false, quoteSent: false, poReceived: false,
    potential: "Medium", stage: "Proposal", result: "", endCustomer: "", industry: "Barcode solutions", application: "Retail labels", supplier: "", competitor: "", failReason: "",
    createdBy: "MAI", following: "MAI", note: "", createdAt: daysAgo(6), probability: 10, expectedCloseDate: daysAhead(60), lossCompetitorPrice: 0, decisionCriteria: "Price", linkedSampleId: "" },
];
await post("projects", PROJECTS.map((p) => row(p.id, p)));

const SAMPLES = [
  { id: "SMP-D01", customerId: "CD-02", projectId: "P-D01", productCode: "TDR330", ink: "Resin", width: 110, length: 300, qtySent: 3, sentDate: daysAgo(22), courier: "Viettel Post", trackingNo: "DEMO000001",
    testStatus: "Đạt", feedbackDate: daysAgo(20), feedbackNote: "Print is sharp and passes the scratch test.", comparedAgainst: "Current resin", followUpDate: daysAgo(20), pic: "MAI", createdBy: "MAI" },
  { id: "SMP-D02", customerId: "CD-04", projectId: "P-D02", productCode: "TDM238", ink: "Wax/Resin", width: 110, length: 300, qtySent: 2, sentDate: daysAgo(12), courier: "GHTK", trackingNo: "DEMO000002",
    testStatus: "Đang test", feedbackDate: "", feedbackNote: "", comparedAgainst: "", followUpDate: daysAhead(2), pic: "MAI", createdBy: "MAI" },
  { id: "SMP-D03", customerId: "CD-11", projectId: "", productCode: "TDW108", ink: "Wax", width: 110, length: 300, qtySent: 2, sentDate: daysAgo(4), courier: "Flash Express", trackingNo: "DEMO000003",
    testStatus: "Chưa phản hồi", feedbackDate: "", feedbackNote: "", comparedAgainst: "", followUpDate: daysAhead(5), pic: "MAI", createdBy: "MAI" },
];
await post("samples", SAMPLES.map((s) => row(s.id, s)));

const line = (code, qty, price, currency) => { const p = PRODUCTS[code]; return { productId: "", productCode: code, structureCode: `${code}.${p.w}×${p.l}`, sku: "", grade: p.grade, productType: "FR", edpCode: "", width: p.w, length: p.l, sqmPerRoll: (p.w / 1000) * p.l, qty, price, unitPrice: price, currency }; };
const yr = today.getUTCFullYear();
const QUOTES = [
  { id: `QT-${yr}-D01`, customerId: "CD-02", projectId: "P-D01", quoteDate: daysAgo(15), validUntil: daysAhead(15), items: [line("TDR330", 600, 7600, "VND")], paymentTerms: "T/T 30 days", revisionNo: 2, status: "Negotiating", approvedBy: "", currency: "VND", pic: "MAI", createdBy: "MAI" },
  { id: `QT-${yr}-D02`, customerId: "CD-03", projectId: "", quoteDate: daysAgo(8), validUntil: daysAhead(22), items: [line("TDW108", 240, 2300, "VND"), line("TDM238", 96, 4200, "VND")], paymentTerms: "T/T 30 days", revisionNo: 1, status: "Sent", approvedBy: "", currency: "VND", pic: "MAI", createdBy: "MAI" },
  { id: `QT-${yr}-D03`, customerId: "CD-10", projectId: "P-D03", quoteDate: daysAgo(45), validUntil: daysAgo(15), items: [line("TDR330", 900, 10.5, "THB")], paymentTerms: "T/T 30 days", revisionNo: 1, status: "Won", approvedBy: "", currency: "THB", pic: "MAI", createdBy: "MAI" },
  { id: `QT-${yr}-D04`, customerId: "CD-11", projectId: "P-D04", quoteDate: daysAgo(2), validUntil: daysAhead(28), items: [line("TDW108", 1200, 3.2, "THB")], paymentTerms: "T/T 30 days", revisionNo: 1, status: "Draft", approvedBy: "", currency: "THB", pic: "MAI", createdBy: "MAI" },
];
await post("quotations", QUOTES.map((x) => row(x.id, x)));

/* ---------- price list (products shard) ---------- */
let pid = 0;
const PRICE_LIST = [];
for (const [code, p] of Object.entries(PRODUCTS)) {
  for (const [country, currency, price] of [["Vietnam", "VND", p.vnd], ["Thailand", "THB", p.thb]]) {
    PRICE_LIST.push({ id: "PRD-D" + String(++pid).padStart(2, "0"), name: code, code, grade: p.grade, country, currency, price, itmref: "", eccshoaxx: `${code}.${p.w}×${p.l}`, structureCode: `${code}.${p.w}×${p.l}`, productType: "FR", width: p.w, length: p.l, sqmPerRoll: (p.w / 1000) * p.l });
  }
}
await post("products", [row("products~0", PRICE_LIST)]);

/* ---------- contact logs, forecast, targets ---------- */
const ts = (n, hh = "10:00") => daysAgo(n) + " " + hh;
const LOGS = [
  { id: "L-D1", customerId: "CD-01", type: "call", outcome: "Connected", text: "Ms. Lan confirmed the next order will include wax resin.", user: "MAI", ts: ts(2, "09:30") },
  { id: "L-D2", customerId: "CD-01", type: "meeting", text: "Visit the factory to check printer settings.", when: daysAhead(3) + " 14:00", user: "MAI", ts: ts(5, "16:10") },
  { id: "L-D3", customerId: "CD-01", type: "note", text: "Prefers delivery on Monday mornings.", user: "MAI", ts: ts(9, "11:05") },
  { id: "L-D4", customerId: "CD-05", type: "call", outcome: "NoAnswer", text: "Called about the meeting time.", user: "MAI", ts: ts(1, "15:20") },
];
await post("logs", [row("logs~0", LOGS)]);

const cur = monthOf(0), next = monthOf(-1);
const FORECAST = [
  { forecastId: "FC-D01", customerId: "CD-01", salesId: "MAI", targetYear: cur.y, targetMonth: cur.m, fcQtyJumboSqm: 0, fcValueJumbo: 0, fcQtyFinishedRolls: 300, fcValueFinished: 45000000, status: "Submitted" },
  { forecastId: "FC-D02", customerId: "CD-09", salesId: "MAI", targetYear: cur.y, targetMonth: cur.m, fcQtyJumboSqm: 0, fcValueJumbo: 0, fcQtyFinishedRolls: 600, fcValueFinished: 50000000, status: "Submitted" },
  { forecastId: "FC-D03", customerId: "CD-02", salesId: "MAI", targetYear: next.y, targetMonth: next.m, fcQtyJumboSqm: 0, fcValueJumbo: 0, fcQtyFinishedRolls: 400, fcValueFinished: 60000000, status: "Draft" },
];
await post("forecast", [row("_all", FORECAST)]);

const months = (base) => Array.from({ length: 12 }, (_, i) => Math.round(base * (1 + i * 0.04)) * 1e6);
await post("targets", [row("targets~" + yr, { MAI: months(160), NAM: months(90) })]);
const GW = { A: 0.4, B: 0.25, C: 0.15, D: 0.1, E: 0.1 };
const groups = (base) => Object.fromEntries(Object.entries(GW).map(([g, w]) => [g, months(base).map((v) => Math.round(v * w))]));
await post("targetGroups", [row("targetGroups~" + yr, { MAI: groups(160), NAM: groups(90) })]);

/* ---------- settings: roles ---------- */
await post("settings", [row("roles", ROLES)]);

console.log(`seeded ${CUSTOMERS.length} customers, ${POS.length} POs, ${PROJECTS.length} projects, ${SAMPLES.length} samples, ${QUOTES.length} quotations, ${PRICE_LIST.length} price-list rows`);
