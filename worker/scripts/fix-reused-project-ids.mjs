// Untangles project ids that were handed out twice. The old id scheme ("P-" + count + random)
// reused ids, and a save upserts by id, so a new project overwrote an older one — while the
// older project's timeline (logs whose customerId is the project id) stayed behind and now
// shows on the new project.
//
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/fix-reused-project-ids.mjs            # dry run (default)
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/fix-reused-project-ids.mjs --apply    # write it
//
// Env: MIGRATION_TOKEN (required, the Worker secret), WORKER_URL (default the workers.dev URL).
//
// For every live project: its creation moment is the activity entry "Created project" with the
// project's name (and creator) on its createdAt day, else the start of createdAt. Logs of the
// project id written before that belong to an overwritten ("lost") project. All of one id's
// older logs form one lost project; when their authors clearly come from different countries
// they are split per country.
// Each lost project gets a placeholder project — id <CC><YYMMDD>-R<n> dated by its first log,
// _recovered: true, name / creator / creation date recovered from the activity feed where an
// unclaimed "Created project" entry by one of its authors precedes its first log (else
// "(recovered) <old id>"), stage from its last status log, no customer — and its logs are
// re-pointed to it, so the current project's timeline only shows its own history.
// Idempotent: moved logs no longer predate anything; a placeholder left by an interrupted run
// is found again by its _recoveredKey and reused.
//
// Reported only (nothing changed): quotation numbers whose logs / activity name more than one
// customer, and samples / quotations linked to a reused project id from before its creation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKER = (process.env.WORKER_URL || "https://tdt.todaytec.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
if (args.some((a) => a !== "--apply" && a !== "--dry-run")) { console.error("usage: fix-reused-project-ids.mjs [--dry-run | --apply]"); process.exit(1); }
if (!TOKEN) { console.error("MIGRATION_TOKEN is required"); process.exit(1); }
const H = { "x-migration-token": TOKEN, "content-type": "application/json" };
const PAGE = 1000;
const NOW = new Date().toISOString();

// ---- the app's helpers (frontend/src/app/data.js, core.jsx) ----------------------------
function normCountry(c) {
  const s = String(c || "").trim();
  if (/^(vn|viet\s*nam|vietnam|việt\s*nam)$/i.test(s)) return "Vietnam";
  if (/^(th|thai|thailand|ไทย)$/i.test(s)) return "Thailand";
  if (/^(id|idn|indonesia)$/i.test(s)) return "Indonesia";
  return s;
}
const KPI_NONE = "-";
function kpiCountryOf(u) {
  if (!u) return "";
  const tc = u.targetCountry;
  if (tc === KPI_NONE) return "";
  if (tc) return normCountry(tc);
  const first = (u.countries || []).filter((x) => x && x !== "*")[0];
  return first ? normCountry(first) : "";
}
const PROJECT_CC = { Vietnam: "VN", Thailand: "TL", Indonesia: "ID", Malaysia: "MY" };
const PROJECT_STAGES = ["Proposal", "Sample", "Quotation", "PO", "Won", "Lost"];
function ts(r) {
  if (!r || !r._updated) return 0;
  let s = String(r._updated);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
  return +new Date(s) || 0;
}
// Stage labels in every language (logs store t("st_" + stage)), label → stage.
const STAGE_OF = (() => {
  const w = {};
  new Function("window", readFileSync(fileURLToPath(new URL("../../frontend/src/app/i18n.js", import.meta.url)), "utf8"))(w);
  const m = {};
  for (const lang of Object.values(w.I18N || {})) for (const s of PROJECT_STAGES) if (lang["st_" + s]) m[lang["st_" + s].trim().toLowerCase()] = s;
  for (const s of PROJECT_STAGES) m[s.toLowerCase()] = s;
  return m;
})();

// ---- HTTP ------------------------------------------------------------------------------
const d1 = { read: 0, written: 0 };
async function call(method, path, body) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(WORKER + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
      d1.read += +(res.headers.get("x-d1-rows-read") || 0);
      d1.written += +(res.headers.get("x-d1-rows-written") || 0);
      if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.status === 204 || res.status === 201 ? null : await res.json();
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
async function readTable(table) {
  const rows = [];
  for (let after = null; ;) {
    const page = await call("GET", `/rest/v1/${table}?select=id,data&order=id.asc&limit=${PAGE}` + (after == null ? "" : `&id=gt.${encodeURIComponent(after)}`));
    rows.push(...page);
    if (page.length < PAGE) return rows;
    after = page[page.length - 1].id;
  }
}
// Records of a table, newest _updated per id (like SB.getRows / getShards).
function recordsOf(rows, idKey = "id") {
  const m = new Map();
  for (const row of rows) for (const r of Array.isArray(row.data) ? row.data : row.data && typeof row.data === "object" ? [row.data] : []) {
    if (!r || r[idKey] == null) continue;
    const ex = m.get(String(r[idKey]));
    if (!ex || ts(r) >= ts(ex)) m.set(String(r[idKey]), r);
  }
  return m;
}
const tsKey = (s) => String(s || "").trim().replace("T", " ").slice(0, 16);
const day = (s) => tsKey(s).slice(0, 10);
const yymmdd = (d) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${WORKER}\n`);
  const [projRows, logRows, actRows, quoteRows, sampleRows, custRows] = await Promise.all(
    ["projects", "logs", "activity", "quotations", "samples", "customers"].map(readTable));
  const users = (await call("GET", "/rest/v1/users?id=eq._all&select=data"))?.[0]?.data || [];
  const countryOfUser = new Map();
  for (const u of Array.isArray(users) ? users : []) {
    if (!u || u._deleted) continue;
    const c = kpiCountryOf(u);
    if (c) for (const k of [u.salesCode, u.name]) if (k) countryOfUser.set(String(k).trim().toUpperCase(), c);
  }
  const userCountry = (code) => countryOfUser.get(String(code || "").trim().toUpperCase()) || "";

  const projects = recordsOf(projRows);
  const customers = recordsOf(custRows);
  const live = [...projects.values()].filter((p) => !p._deleted);
  const liveNames = new Set(live.map((p) => String(p.name || "").trim().toLowerCase()));
  // Every log with where it is stored (shard row + index), so changed shards can be rewritten.
  const logs = [];
  for (const row of logRows) {
    if (!Array.isArray(row.data)) continue;
    row.data.forEach((l, i) => { if (l && typeof l === "object") logs.push({ l, row, i }); });
  }
  const logsByCust = new Map();
  for (const x of logs) if (x.l.customerId) (logsByCust.get(x.l.customerId) || logsByCust.set(x.l.customerId, []).get(x.l.customerId)).push(x);
  const activity = (actRows.find((r) => r.id === "_all") || {}).data || [];
  const created = (Array.isArray(activity) ? activity : []).filter((a) => a && a.action === "project" && a.detail === "Created project");
  const usedAct = new Set();

  // ---- detect ----
  const plans = [], skipped = [];
  const rUsed = new Map(); // prefix → highest R in use
  for (const p of projects.values()) { const m = /^([A-Z]{2}\d{6}-R)(\d+)$/.exec(String(p.id)); if (m) rUsed.set(m[1], Math.max(rUsed.get(m[1]) || 0, +m[2])); }
  const byKey = new Map([...projects.values()].filter((p) => p._recoveredKey).map((p) => [p._recoveredKey, p]));
  for (const p of live.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (p._recovered) continue;
    const own = logsByCust.get(String(p.id)) || [];
    if (!own.length) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(p.createdAt || ""))) { skipped.push(`${p.id}: no createdAt, ${own.length} log(s) left as they are`); continue; }
    const cDay = day(p.createdAt);
    const act = created.find((a) => day(a.ts) === cDay && String(a.target || "").trim() === String(p.name || "").trim() && (!p.createdBy || a.user === p.createdBy));
    if (act) usedAct.add(act);
    const cutoff = act ? tsKey(act.ts) : cDay + " 00:00";
    const older = own.filter((x) => tsKey(x.l.ts) && tsKey(x.l.ts) < cutoff).sort((a, b) => tsKey(a.l.ts).localeCompare(tsKey(b.l.ts)));
    if (!older.length) continue;
    // One lost project, or one per author country when those clearly differ.
    const byCountry = new Map();
    for (const x of older) { const c = userCountry(x.l.user); (byCountry.get(c) || byCountry.set(c, []).get(c)).push(x); }
    const known = [...byCountry.keys()].filter(Boolean);
    let groups;
    if (known.length > 1) {
      groups = known.map((c) => ({ country: c, logs: byCountry.get(c) }));
      const unknown = byCountry.get("") || [];
      if (unknown.length) groups.sort((a, b) => b.logs.length - a.logs.length)[0].logs.push(...unknown);
      groups.forEach((g) => g.logs.sort((a, b) => tsKey(a.l.ts).localeCompare(tsKey(b.l.ts))));
    } else groups = [{ country: known[0] || "", logs: older }];
    plans.push({ p, cutoff, act, groups });
  }
  // ---- recover + placeholder per lost project (oldest first, so activity entries are claimed in order) ----
  const lost = plans.flatMap((pl) => pl.groups.map((g) => ({ pl, g }))).sort((a, b) => tsKey(a.g.logs[0].l.ts).localeCompare(tsKey(b.g.logs[0].l.ts)));
  for (const { pl, g } of lost) {
    const first = g.logs[0].l, last = g.logs[g.logs.length - 1].l;
    const authors = new Set(g.logs.map((x) => x.l.user).filter(Boolean));
    const firstTs = tsKey(first.ts);
    const rec = created.filter((a) => !usedAct.has(a) && tsKey(a.ts) && tsKey(a.ts) <= firstTs && tsKey(a.ts) < pl.cutoff &&
      authors.has(a.user) && !liveNames.has(String(a.target || "").trim().toLowerCase()) && !/\(import\)$/.test(String(a.target || "")))
      .sort((a, b) => tsKey(b.ts).localeCompare(tsKey(a.ts)))[0] || null;
    if (rec) usedAct.add(rec);
    const statusLog = [...g.logs].reverse().find((x) => x.l.type === "status" && STAGE_OF[String(x.l.text || "").trim().toLowerCase()]);
    const stage = statusLog ? STAGE_OF[String(statusLog.l.text).trim().toLowerCase()] : "Proposal";
    const country = g.country || userCountry(rec && rec.user) || "";
    const key = `${pl.p.id}|${first.id || firstTs}`;
    let id;
    if (byKey.has(key)) id = byKey.get(key).id;
    else {
      const pre = (PROJECT_CC[country] || "XX") + yymmdd(day(first.ts)) + "-R";
      const n = (rUsed.get(pre) || 0) + 1; rUsed.set(pre, n); id = pre + n;
    }
    const createdBy = (rec && rec.user) || first.user || "";
    const createdAt = rec && day(rec.ts) < day(first.ts) ? day(rec.ts) : day(first.ts);
    g.rec = rec; g.id = id; g.stage = stage; g.authors = [...authors];
    g.project = {
      id, name: rec ? String(rec.target) : `(recovered) ${pl.p.id}`, customerId: "", nameCode: "",
      classification: "New project", stage, potential: "Medium", probability: 0, items: [], value: 0,
      following: createdBy, createdBy, createdAt,
      ...(stage === "Won" || stage === "Lost" ? { result: stage } : {}),
      note: `Recovered from ${pl.p.id}: original details were overwritten on ${day(pl.p.createdAt)} by "${pl.p.name || pl.p.id}"` + (pl.p.createdBy ? ` (${pl.p.createdBy})` : "") + ".",
      _recovered: true, _recoveredFrom: String(pl.p.id), _recoveredKey: key, _updated: NOW, _updatedBy: "RECOVER",
    };
    g.lastTs = tsKey(last.ts);
  }

  // ---- print the plan ----
  for (const pl of plans) {
    const p = pl.p;
    console.log(`${p.id}  current: "${p.name}"  by ${p.createdBy || "?"} on ${day(p.createdAt)}  (cutoff ${pl.cutoff}${pl.act ? ", from activity" : ", start of createdAt"})`);
    for (const g of pl.groups) {
      const cust = "";
      console.log(`  lost project → ${g.id}${byKey.has(g.project._recoveredKey) ? " (exists, reused)" : ""}  country ${g.country || "?"}`);
      console.log(`    name "${g.project.name}"${g.rec ? ` (activity ${tsKey(g.rec.ts)} by ${g.rec.user})` : " (no activity match)"}${cust}`);
      console.log(`    created by ${g.project.createdBy || "?"} on ${g.project.createdAt}, stage ${g.stage}, authors ${g.authors.join(", ") || "?"}`);
      console.log(`    logs moved: ${g.logs.length} (${tsKey(g.logs[0].l.ts)} … ${g.lastTs})`);
      for (const x of g.logs.slice(0, 8)) console.log(`      ${tsKey(x.l.ts)}  ${String(x.l.user || "?").padEnd(8)} ${x.l.type || ""}: ${String(x.l.text || "").slice(0, 60)}`);
      if (g.logs.length > 8) console.log(`      … ${g.logs.length - 8} more`);
    }
    // Records linked to this id from before the current project existed (report only).
    const linked = [...sampleRows, ...quoteRows].flatMap((r) => (Array.isArray(r.data) ? r.data : [r.data])).filter((r) => r && !r._deleted && r.projectId === p.id);
    const before = linked.filter((r) => { const d = day(r.createdAt || r.sentDate || r.date || r.quoteDate || ""); return d && d < day(pl.cutoff); });
    if (before.length) console.log(`  linked before ${day(pl.cutoff)} (not changed): ${before.map((r) => r.id).join(", ")}`);
    console.log("");
  }
  if (!plans.length) console.log("No project has logs from before its creation.\n");
  for (const s of skipped) console.log("Skipped " + s);

  // Quotation numbers whose logs / activity name more than one customer (report only).
  const quotes = recordsOf(quoteRows);
  const qCust = new Map();
  const addQ = (no, who, how) => { (qCust.get(no) || qCust.set(no, new Map()).get(no)).set(who, how); };
  const custName = (id) => (customers.get(String(id)) || {}).name || id;
  const custIdByName = new Map([...customers.values()].map((c) => [String(c.name || "").trim().toLowerCase(), String(c.id)]));
  for (const x of logs) for (const no of String(x.l.text || "").match(/QT-\d{4}-\d+/g) || []) if (customers.has(String(x.l.customerId))) addQ(no, String(x.l.customerId), `log ${tsKey(x.l.ts)} ${x.l.user || "?"}`);
  for (const a of Array.isArray(activity) ? activity : []) for (const no of String((a && a.detail) || "").match(/QT-\d{4}-\d+/g) || []) {
    const id = custIdByName.get(String(a.target || "").trim().toLowerCase()) || "name:" + a.target;
    addQ(no, id, `activity ${tsKey(a.ts)} ${a.user || "?"}`);
  }
  for (const [no, q] of quotes) if (q && q.customerId && qCust.has(no)) qCust.get(no).set(String(q.customerId), "current quotation");
  const reusedQ = [...qCust].filter(([, m]) => m.size > 1).sort((a, b) => a[0].localeCompare(b[0]));
  if (reusedQ.length) {
    console.log("\nQuotation numbers used for more than one customer (not changed):");
    for (const [no, m] of reusedQ) console.log(`  ${no}: ` + [...m].map(([id, how]) => `${id.startsWith("name:") ? id.slice(5) : custName(id)} [${how}]`).join("; "));
  }

  // ---- writes ----
  const newProjects = lost.filter(({ g }) => !byKey.has(g.project._recoveredKey)).map(({ g }) => ({ id: g.id, data: g.project, updated_at: NOW }));
  const changedRows = new Map();
  for (const { g } of lost) for (const x of g.logs) {
    const data = changedRows.get(x.row.id) || x.row.data.slice();
    data[x.i] = { ...x.l, customerId: g.id, _updated: NOW };
    changedRows.set(x.row.id, data);
  }
  const nLogs = lost.reduce((s, { g }) => s + g.logs.length, 0);
  console.log(`\nPlan: ${plans.length} reused id(s), ${lost.length} lost project(s), ${newProjects.length} placeholder project(s) to create, ${nLogs} log(s) to move (${changedRows.size} log shard row(s) to rewrite)`);
  if (!APPLY) { console.log(`\nDry run — nothing written. Re-run with --apply to fix.\nD1: ${d1.read} rows read, ${d1.written} rows written`); return; }
  if (!newProjects.length && !changedRows.size) { console.log(`\nNothing to do.\nD1: ${d1.read} rows read, ${d1.written} rows written`); return; }
  // Placeholders first, then the logs: an interrupted run is finished by running it again.
  for (let i = 0; i < newProjects.length; i += 100) await call("POST", "/rest/v1/projects", newProjects.slice(i, i + 100));
  for (const [id, data] of changedRows) await call("POST", "/rest/v1/logs", { id, data, updated_at: NOW });
  console.log(`\nApplied.\nD1: ${d1.read} rows read, ${d1.written} rows written`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
