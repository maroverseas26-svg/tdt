// Merges duplicate customer records (same company name + country) into one master record,
// through the Worker's /rest/v1 API — the same storage path the app uses.
//
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/merge-duplicate-customers.mjs            # dry run (default)
//   MIGRATION_TOKEN=... NODE_USE_ENV_PROXY=1 node scripts/merge-duplicate-customers.mjs --apply    # write it
//
// Env: MIGRATION_TOKEN (required, the Worker secret), WORKER_URL (default the workers.dev URL).
//
// Groups: live customers whose company name + country match after the app's own
// normalisation (normName / normCountry in frontend/src/app/data.js, ported verbatim below).
// Records with different non-empty Business IDs (MST) are never merged together: each MST
// is its own sub-group, records without an MST join the single MST sub-group, and when there
// are several MSTs the MST-less records are left alone and reported.
//
// Master, first rule that decides: has MST, most live POs, most other linked records, most
// non-empty fields, oldest `created` (then lowest id, so the choice is stable).
//
// Merge: the master's empty fields are filled from the duplicates (never overwritten);
// contactHistory is the union (identical entries once, newest first like the app writes it);
// lastContactDate / nextActionDate (+ its note) keep the latest; differing notes are appended.
//
// References re-pointed from every duplicate id to the master id:
//   pos.customerId, projects.customerId, samples.customerId, quotations.customerId (row per
//   record); logs.customerId (sharded blob, logs~n); forecast.customerId, activity,
//   pipelines, retention (blobs, any customerId / *CustomerIds inside); skuForecast (one row
//   per customer, skuForecast~<id>: moved into the master's row); targetCust (one row per
//   year, keyed by customer id inside: moved under the master). Any other place a duplicate
//   id shows up is reported, not changed.
//
// Duplicates are then soft-deleted exactly like the app's deleteCustomers: the record stays
// with _deleted: true and a fresh _updated (plus _mergedInto: <master id>). Order is master →
// references → tombstones, so an interrupted run is finished by running it again; a re-run
// also re-points stragglers that still reference a merged (tombstoned) duplicate. Running it
// twice changes nothing the second time.
const WORKER = (process.env.WORKER_URL || "https://tdt.todaytec.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
if (args.some((a) => a !== "--apply" && a !== "--dry-run")) { console.error("usage: merge-duplicate-customers.mjs [--dry-run | --apply]"); process.exit(1); }
if (!TOKEN) { console.error("MIGRATION_TOKEN is required"); process.exit(1); }
const H = { "x-migration-token": TOKEN, "content-type": "application/json" };
const PAGE = 1000;
const NOW = new Date().toISOString();
const BY = "MERGE";

// ---- the app's normalisation (frontend/src/app/data.js) --------------------------------
const LEGAL_WORDS = /\b(co|ltd|limited|company|corporation|corp|public|pcl|plc|inc|head office|thailand|th)\b/g;
function normName(s) {
  return (s || "").toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9฀-๿ ]+/g, " ")
    .replace(LEGAL_WORDS, " ")
    .replace(/\s+/g, " ").trim();
}
function normCountry(c) {
  const s = String(c || "").trim();
  if (/^(vn|viet\s*nam|vietnam|việt\s*nam)$/i.test(s)) return "Vietnam";
  if (/^(th|thai|thailand|ไทย)$/i.test(s)) return "Thailand";
  if (/^(id|idn|indonesia)$/i.test(s)) return "Indonesia";
  return s;
}
function normBizId(s) { return (s || "").replace(/\D+/g, "").replace(/^0+/, ""); }
// SB.ts: a stamp without a zone is UTC.
function ts(r) {
  if (!r || !r._updated) return 0;
  let s = String(r._updated);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
  return +new Date(s) || 0;
}

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
// Every row of a table, keyset-paged by id.
async function readTable(table, filter = "") {
  const rows = [];
  for (let after = null; ;) {
    const page = await call("GET", `/rest/v1/${table}?select=id,data&order=id.asc&limit=${PAGE}${filter}` + (after == null ? "" : `&id=gt.${encodeURIComponent(after)}`));
    rows.push(...page);
    if (page.length < PAGE) return rows;
    after = page[page.length - 1].id;
  }
}
const inList = (ids) => "(" + ids.map((x) => encodeURIComponent('"' + String(x).replace(/"/g, "") + '"')).join(",") + ")";
async function writeRows(table, rows) {
  for (let i = 0; i < rows.length; i += 100) await call("POST", `/rest/v1/${table}`, rows.slice(i, i + 100));
}

// ---- helpers ---------------------------------------------------------------------------
const isEmpty = (v) => v === undefined || v === null || v === false || (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const nonEmptyCount = (c) => Object.keys(c).filter((k) => !k.startsWith("_") && !isEmpty(c[k])).length;
// Comparable key for a date field ("YYYY-MM-DD", "YYYY-MM-DD HH:mm", ISO, or anything Date reads).
function dateKey(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace("T", " ");
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().replace("T", " ") : "";
}
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + "..." : s; };
// Fields the merge never copies or handles on its own.
const META = new Set(["id", "created", "funnel", "status", "contactHistory", "lastContactDate", "nextActionDate", "nextActionNote", "note", "notes"]);

// Re-point customer ids inside any record. `remap` maps old id → master id. Returns the new
// value (same object when nothing changed) and logs every replaced / unknown occurrence.
function repoint(value, remap, path, found) {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v, i) => { const n = repoint(v, remap, path + "[" + i + "]", found); if (n !== v) changed = true; return n; });
    return changed ? out : value;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && remap.has(value)) found.unknown.push(path);
    return value;
  }
  let out = value;
  const set = (k, v) => { if (out === value) out = { ...value }; out[k] = v; };
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (remap.has(k)) found.unknown.push(path + "{key " + k + "}");
    if (k === "customerId" && typeof v === "string" && remap.has(v)) { set(k, remap.get(v)); found.moved++; continue; }
    if (/customerIds$/i.test(k) && Array.isArray(v) && v.some((x) => remap.has(x))) {
      set(k, [...new Set(v.map((x) => (remap.has(x) ? remap.get(x) : x)))]); found.moved++; continue;
    }
    const n = repoint(v, remap, path + "." + k, found);
    if (n !== v) set(k, n);
  }
  return out;
}
// A record that changed gets a fresh _updated, so the app's newest-wins merge keeps it.
const stampRec = (r) => (r && typeof r === "object" && !Array.isArray(r) && ("_updated" in r || "id" in r || "forecastId" in r) ? { ...r, _updated: NOW } : r);
const isDeleted = (c) => !!(c && c._deleted);

// Tables that can hold customer references, by storage shape (see SB in data.js).
const RECORD_TABLES = ["projects", "samples", "quotations"]; // one row per record
const BLOB_TABLES = ["logs", "forecast", "activity", "pipelines", "retention"]; // shards / _all blobs of records

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${WORKER}\n`);

  // ---- customers (row per record; legacy array rows merged newest-wins like SB.getRows) ----
  const custRows = await readTable("customers");
  const byId = new Map();
  for (const row of custRows) {
    const recs = Array.isArray(row.data) ? row.data : row.data && typeof row.data === "object" ? [row.data] : [];
    for (const r of recs) if (r && r.id != null) { const ex = byId.get(String(r.id)); if (!ex || ts(r) >= ts(ex)) byId.set(String(r.id), r); }
  }
  const overrides = (await call("GET", "/rest/v1/custOverrides?id=eq._all&select=data"))?.[0]?.data || {};
  const effDeleted = (c) => isDeleted(c) || isDeleted(overrides[c.id]);
  const live = [...byId.values()].filter((c) => !effDeleted(c));
  // Tombstones left by an earlier run: their stragglers are re-pointed too.
  const merged = new Map();
  for (const c of byId.values()) if (effDeleted(c) && c._mergedInto && byId.has(String(c._mergedInto))) merged.set(String(c.id), String(c._mergedInto));
  for (const [k, v] of merged) { let m = v, n = 0; while (merged.has(m) && n++ < 10) m = merged.get(m); merged.set(k, m); }

  const buckets = new Map();
  for (const c of live) {
    const n = normName(c.name);
    if (!n) continue;
    const key = n + "|" + normCountry(c.country);
    (buckets.get(key) || buckets.set(key, []).get(key)).push(c);
  }
  const groups = [], conflicts = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const byMst = new Map(), noMst = [];
    for (const c of members) { const b = normBizId(c.bizId); if (b) (byMst.get(b) || byMst.set(b, []).get(b)).push(c); else noMst.push(c); }
    if (byMst.size > 1) {
      conflicts.push({ key, members, leftAlone: noMst });
      for (const list of byMst.values()) if (list.length > 1) groups.push({ key, members: list });
    } else if (byMst.size === 1) {
      groups.push({ key, members: [...byMst.values()][0].concat(noMst) });
    } else groups.push({ key, members: noMst });
  }
  const remap = new Map(merged);
  // ---- linked records (counted before choosing masters) ----
  const groupIds = groups.flatMap((g) => g.members.map((c) => String(c.id)));
  const refIds = [...new Set([...groupIds, ...merged.keys(), ...conflicts.flatMap((c) => c.members.map((x) => String(x.id)))])];
  const posRows = [];
  for (let i = 0; i < refIds.length; i += 50) posRows.push(...await readTable("pos", "&data->>customerId=in." + inList(refIds.slice(i, i + 50))));
  const livePos = {}, links = {};
  for (const r of posRows) if (r.data && !isDeleted(r.data)) livePos[r.data.customerId] = (livePos[r.data.customerId] || 0) + 1;
  const tables = {};
  for (const t of [...RECORD_TABLES, ...BLOB_TABLES, "skuForecast", "targetCust"]) tables[t] = await readTable(t);
  const idSet = new Set(refIds);
  const countRefs = (v) => {
    if (Array.isArray(v)) return v.forEach(countRefs);
    if (!v || typeof v !== "object") return;
    for (const k of Object.keys(v)) {
      if (idSet.has(k)) links[k] = (links[k] || 0) + 1;
      if (k === "customerId" && idSet.has(v[k])) links[v[k]] = (links[v[k]] || 0) + 1;
      else countRefs(v[k]);
    }
  };
  for (const t of Object.keys(tables)) for (const r of tables[t]) {
    if (t === "skuForecast" && String(r.id).startsWith("skuForecast~") && idSet.has(String(r.id).slice(12))) links[String(r.id).slice(12)] = (links[String(r.id).slice(12)] || 0) + 1;
    else countRefs(r.data);
  }

  // ---- master + merged record per group ----
  const rank = (a, b) =>
    (!!normBizId(b.bizId) - !!normBizId(a.bizId)) ||
    ((livePos[b.id] || 0) - (livePos[a.id] || 0)) ||
    ((links[b.id] || 0) - (links[a.id] || 0)) ||
    (nonEmptyCount(b) - nonEmptyCount(a)) ||
    String(a.created || "9999").localeCompare(String(b.created || "9999")) ||
    String(a.id).localeCompare(String(b.id));
  for (const g of groups) {
    g.members.sort(rank);
    const [master, ...dups] = g.members;
    g.master = master; g.dups = dups;
    for (const d of dups) remap.set(String(d.id), String(master.id));
    const next = { ...master }, filled = [];
    for (const d of dups) for (const k of Object.keys(d)) {
      if (k.startsWith("_") || META.has(k)) continue;
      if (isEmpty(next[k]) && !isEmpty(d[k])) { next[k] = d[k]; filled.push(`${k} = ${short(d[k])} (from ${d.id})`); }
    }
    // status drives the pipeline stage: an empty one is filled together with its funnel.
    const st = isEmpty(master.status) && dups.find((d) => !isEmpty(d.status));
    if (st) { next.status = st.status; next.funnel = st.funnel || next.funnel; filled.push(`status = ${short(st.status)}, funnel = ${short(next.funnel)} (from ${st.id})`); }
    // contactHistory: union, identical entries once, newest first (stable).
    const seen = new Set(), hist = [];
    for (const c of g.members) for (const h of Array.isArray(c.contactHistory) ? c.contactHistory : []) { const s = stable(h); if (!seen.has(s)) { seen.add(s); hist.push(h); } }
    const order = hist.map((h, i) => [h, i]).sort((a, b) => dateKey(b[0] && b[0].date).localeCompare(dateKey(a[0] && a[0].date)) || a[1] - b[1]).map((x) => x[0]);
    const own = Array.isArray(master.contactHistory) ? master.contactHistory : [];
    if (order.length > own.length) { next.contactHistory = order; filled.push(`contactHistory: ${own.length} → ${order.length} entries`); }
    // Latest lastContactDate; latest nextActionDate with its note.
    const latest = (k) => g.members.reduce((best, c) => (dateKey(c[k]) > dateKey(best ? best[k] : "") ? c : best), null);
    const lc = latest("lastContactDate");
    if (lc && lc !== master && dateKey(lc.lastContactDate) > dateKey(master.lastContactDate)) { next.lastContactDate = lc.lastContactDate; filled.push(`lastContactDate = ${lc.lastContactDate} (from ${lc.id})`); }
    const na = latest("nextActionDate");
    if (na && na !== master && dateKey(na.nextActionDate) > dateKey(master.nextActionDate)) {
      next.nextActionDate = na.nextActionDate; next.nextActionNote = na.nextActionNote || "";
      filled.push(`nextActionDate = ${na.nextActionDate} + its note (from ${na.id})`);
    }
    // Notes: append the ones the master's note doesn't already contain.
    for (const k of ["note", "notes"]) {
      let note = typeof master[k] === "string" ? master[k] : "";
      for (const d of dups) {
        const dn = typeof d[k] === "string" ? d[k].trim() : "";
        if (dn && !note.includes(dn)) { note = note.trim() ? note.trimEnd() + "\n" + dn : dn; filled.push(`${k} += ${short(dn)} (from ${d.id})`); }
      }
      if (note !== (typeof master[k] === "string" ? master[k] : "")) next[k] = note;
    }
    g.next = filled.length ? { ...next, _updated: NOW, _updatedBy: BY } : null;
    g.filled = filled;
  }

  // ---- reference re-pointing plan ----
  const writes = {}, deletes = [], unknown = [], perGroup = new Map();
  const groupOf = new Map();
  for (const g of groups) for (const c of g.members) groupOf.set(String(c.id), g);
  const tally = (oldId, table, n = 1) => {
    const g = groupOf.get(oldId) || groupOf.get(remap.get(oldId));
    const key = g || "stragglers";
    const m = perGroup.get(key) || perGroup.set(key, {}).get(key);
    m[table] = (m[table] || 0) + n;
  };
  const queue = (table, row) => (writes[table] = writes[table] || []).push(row);
  // pos + row-per-record tables: one record per row (a legacy array row is rewritten whole).
  const repointRows = (table, rows) => {
    for (const r of rows) {
      const found = { moved: 0, unknown: [] };
      const oldIds = [];
      const collect = (v) => { if (v && typeof v === "object") { if (Array.isArray(v)) v.forEach(collect); else { if (typeof v.customerId === "string" && remap.has(v.customerId)) oldIds.push(v.customerId); Object.values(v).forEach(collect); } } };
      collect(r.data);
      const data = repoint(r.data, remap, `${table}/${r.id}`, found);
      found.unknown.forEach((p) => unknown.push(p));
      if (data === r.data) continue;
      oldIds.forEach((id) => tally(id, table));
      const stamped = Array.isArray(data) ? data.map((x, i) => (x !== r.data[i] ? stampRec(x) : x)) : stampRec(data);
      queue(table, { id: r.id, data: stamped, updated_at: NOW });
    }
  };
  repointRows("pos", posRows);
  for (const t of [...RECORD_TABLES, ...BLOB_TABLES]) repointRows(t, tables[t]);
  // skuForecast: row skuForecast~<customer id> → merged into the master's row (master wins).
  const deepMerge = (base, over) => {
    const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  };
  const skuById = new Map(tables.skuForecast.map((r) => [String(r.id), r]));
  const skuOut = new Map();
  for (const r of tables.skuForecast) {
    const cid = String(r.id).startsWith("skuForecast~") ? String(r.id).slice(12) : null;
    if (!cid || !remap.has(cid)) { if (r.id === "_all" && r.data && typeof r.data === "object") for (const k of Object.keys(r.data)) if (remap.has(k)) unknown.push(`skuForecast/_all{key ${k}}`); continue; }
    const mid = "skuForecast~" + remap.get(cid);
    const cur = skuOut.has(mid) ? skuOut.get(mid) : (skuById.get(mid) ? skuById.get(mid).data : {});
    skuOut.set(mid, deepMerge(r.data && typeof r.data === "object" ? r.data : {}, cur || {}));
    deletes.push(["skuForecast", r.id]);
    tally(cid, "skuForecast", Object.keys(r.data || {}).length);
  }
  for (const [id, data] of skuOut) queue("skuForecast", { id, data, updated_at: NOW });
  // targetCust: targetCust~<year> = { customerId: { code: row } } → items move under the master;
  // an item the master already has for that year stays the master's (reported).
  const tcConflicts = [];
  for (const r of tables.targetCust) {
    if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) continue;
    if (!Object.keys(r.data).some((k) => remap.has(k))) continue;
    const y = { ...r.data };
    for (const cid of Object.keys(r.data)) {
      if (!remap.has(cid)) continue;
      const mid = remap.get(cid);
      const into = { ...(y[mid] || {}) };
      for (const [code, item] of Object.entries(r.data[cid] || {})) {
        if (into[code]) tcConflicts.push(`${r.id}: ${cid} item ${code} dropped (master ${mid} has its own)`);
        else into[code] = item;
      }
      y[mid] = into; delete y[cid];
      tally(cid, "targetCust", Object.keys(r.data[cid] || {}).length);
    }
    queue("targetCust", { id: r.id, data: y, updated_at: NOW });
  }
  for (const id of Object.keys(overrides)) if (remap.has(id) && !merged.has(id)) unknown.push(`custOverrides/_all{key ${id}} (override of a duplicate, left as is)`);

  // ---- print the plan ----
  const custWrites = [];
  let gi = 0;
  for (const g of groups) {
    gi++;
    const m = g.master;
    console.log(`Group ${gi}: "${m.name}" [${normCountry(m.country) || "-"}] — ${g.members.length} records`);
    console.log(`  master    ${m.id}  MST ${m.bizId || "-"}  POs ${livePos[m.id] || 0}  links ${links[m.id] || 0}  created ${m.created || "-"}`);
    for (const d of g.dups) console.log(`  duplicate ${d.id}  MST ${d.bizId || "-"}  POs ${livePos[d.id] || 0}  links ${links[d.id] || 0}  created ${d.created || "-"}  name "${d.name}"`);
    console.log(g.filled.length ? "  fills:\n" + g.filled.map((f) => "    " + f).join("\n") : "  fills: none");
    const refs = perGroup.get(g) || {};
    console.log("  references moved: " + (Object.keys(refs).length ? Object.entries(refs).map(([t, n]) => `${t} ${n}`).join(", ") : "none"));
    console.log("");
    if (g.next) custWrites.push({ id: String(m.id), data: g.next, updated_at: NOW });
  }
  if (!groups.length) console.log("No duplicate groups.\n");
  if (perGroup.has("stragglers")) console.log("References to already-merged customers: " + Object.entries(perGroup.get("stragglers")).map(([t, n]) => `${t} ${n}`).join(", ") + "\n");
  for (const c of conflicts) {
    console.log(`NOT MERGED — same name, different MSTs: "${c.members[0].name}" [${normCountry(c.members[0].country) || "-"}]`);
    for (const x of c.members) console.log(`  ${x.id}  MST ${x.bizId || "-"}  POs ${livePos[x.id] || 0}${c.leftAlone.includes(x) ? "  (no MST: left alone, which entity it is is unclear)" : ""}`);
    console.log("");
  }
  if (tcConflicts.length) console.log("targetCust items kept on the master:\n" + tcConflicts.map((s) => "  " + s).join("\n") + "\n");
  if (unknown.length) console.log("Other places a duplicate id appears (not changed):\n" + unknown.map((s) => "  " + s).join("\n") + "\n");
  const tombstones = groups.flatMap((g) => g.dups.map((d) => ({ id: String(d.id), data: { ...d, _deleted: true, _mergedInto: String(g.master.id), _updated: NOW, _updatedBy: BY }, updated_at: NOW })));
  const nWrites = custWrites.length + tombstones.length + Object.values(writes).reduce((s, a) => s + a.length, 0);
  console.log(`Plan: ${groups.length} group(s), ${tombstones.length} duplicate(s) to soft-delete, ${custWrites.length} master record(s) to update, ` +
    `${nWrites} row(s) to write (${Object.entries(writes).map(([t, a]) => `${t} ${a.length}`).join(", ") || "no references"}), ${deletes.length} row(s) to delete`);

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to merge.`);
    console.log(`D1: ${d1.read} rows read, ${d1.written} rows written`);
    return;
  }
  if (!nWrites && !deletes.length) { console.log(`\nNothing to do.\nD1: ${d1.read} rows read, ${d1.written} rows written`); return; }

  // ---- apply: master → references → tombstones ----
  const statsOf = async () => new Map((await call("POST", "/rest/v1/rpc/po_customer_stats", {})).map((s) => [String(s.customer_id), s]));
  const before = await statsOf();
  await writeRows("customers", custWrites);
  for (const [t, rows] of Object.entries(writes)) await writeRows(t, rows);
  for (const [t, id] of deletes) await call("DELETE", `/rest/v1/${t}?id=eq.${encodeURIComponent(id)}`);
  await writeRows("customers", tombstones);
  // PO totals per customer must be unchanged: the master now carries the group's sum.
  const after = await statsOf();
  let bad = 0;
  for (const g of groups) {
    const sum = (k) => g.members.reduce((s, c) => s + (+(before.get(String(c.id)) || {})[k] || 0), 0);
    const a = after.get(String(g.master.id)) || {};
    const okCount = sum("po_count") === (+a.po_count || 0);
    const okAmt = Math.abs(sum("total_amt") - (+a.total_amt || 0)) <= 1e-6 * Math.max(1, Math.abs(sum("total_amt")));
    const leftover = g.dups.filter((d) => after.has(String(d.id)));
    if (!okCount || !okAmt || leftover.length) bad++;
    console.log(`  ${okCount && okAmt && !leftover.length ? "OK " : "BAD"} ${g.master.id}: POs ${sum("po_count")} → ${a.po_count || 0}, total ${sum("total_amt")} → ${a.total_amt || 0}${leftover.length ? ", still has POs: " + leftover.map((d) => d.id).join(" ") : ""}`);
  }
  console.log(`\nApplied. ${bad ? bad + " group(s) FAILED the PO totals check." : "PO totals per customer unchanged."}`);
  console.log(`D1: ${d1.read} rows read, ${d1.written} rows written`);
  if (bad) process.exitCode = 2;
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
