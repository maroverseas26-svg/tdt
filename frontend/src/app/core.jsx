// Todaytec CRM — app shell: contexts, login, sidebar+topbar, shared UI
const { useState, useEffect, useMemo, useCallback, useContext, useRef, createContext } = React;
const C = window.CRM;
// Timestamp every create/edit/delete so the Supabase merge layer can resolve concurrent
// changes from different users (newest write wins per record; see SB.mergeArrById).
const NOW = () => new Date().toISOString();
const LOGO_FULL = (window.__resources && window.__resources.logoFull) || "assets/logo-full.png";
const LOGO_MINI = (window.__resources && window.__resources.logoMini) || "assets/logo-mini.png";

// Role ids that have named the same fixed role over time. Records written under an old id
// must keep their scope — see roleOf().
const ROLE_ALIAS = { admin: "BOD", administrator: "BOD", boss: "BOD", bod: "BOD", sales: "SALE", sale: "SALE" };
const canonRoleUser = (u) => {
  const id = String((u && u.role) || "");
  const seedRole = (C.SEED_ROLES || []).find(r => r.id === id);
  const alias = ROLE_ALIAS[id.toLowerCase()];
  let out = (!seedRole && alias && alias !== id) ? { ...u, role: alias } : u;
  // An all-scope account is full-access by definition: repair a countries/modules list that
  // an earlier edit narrowed, so an admin can never lock itself out of its own data or of
  // the Permissions tab.
  const r = (C.SEED_ROLES || []).find(x => x.id === out.role);
  if (r && r.scope === "all") {
    const cs = out.countries || [];
    const mods = out.modules || [];
    const needC = !cs.includes("*");
    const needM = (C.MODULES || []).some(m => !mods.includes(m));
    if (needC || needM) out = { ...out, countries: needC ? ["*"] : cs, modules: needM ? [...(C.MODULES || [])] : mods };
  }
  return out;
};

/* ---------- App store ---------- */
const AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

function AppProvider({ children, tweaks }) {
  const [lang, setLangState] = useState(() => C.loadJSON(C.LS.lang, "en"));
  const setLang = (l) => { setLangState(l); C.saveJSON(C.LS.lang, l); };
  const t = useCallback((k) => (window.I18N[lang] && window.I18N[lang][k]) || window.I18N.en[k] || k, [lang]);

  const [users, setUsersState] = useState(() => {
    const saved = C.loadJSON(C.LS.users, null);
    if (!saved) return C.SEED_USERS;
    const ids = new Set(saved.map(u => u.id));
    const merged = saved.map(({ password, ...u }) => { const s = C.SEED_USERS.find(x => x.id === u.id); return s ? { ...u, email: u.email || s.email } : u; }).map(canonRoleUser);
    C.SEED_USERS.forEach(s => { if (!ids.has(s.id)) merged.push(s); });
    return merged;
  });
  // Accounts live in the Worker (D1): only the records that changed are PUT, one each. A
  // password typed in the admin UI travels with that PUT once and is never kept in state.
  const setUsers = (next) => {
    const before = new Map(users.map(u => [u.id, JSON.stringify(u)]));
    const clean = next.map(({ password, ...u }) => u);
    setUsersState(clean); C.saveJSON(C.LS.users, clean);
    // Resolves to the Worker's reply for each account that was saved, so a caller (the
    // Permissions page) can show "Saving… / Saved" and name the accounts that failed.
    return Promise.all(next.filter((u, i) => u.password || before.get(u.id) !== JSON.stringify(clean[i]))
      .map(u => C.API.saveUser(u).then(r => ({ id: u.id, ok: r.ok, error: r.error || r.status }), e => ({ id: u.id, ok: false, error: String(e) }))));
  };
  const updateUser = (id, patch) => setUsers(users.map(u => u.id === id ? { ...u, ...patch } : u));

  // ---- session ----
  // The session is the Worker's HttpOnly cookie; sessionId only remembers whose it is so the
  // UI can render at once. On load the Worker confirms it (/api/auth/me); any 401 from the
  // data API (expired / revoked session) signs the UI out.
  const [sessionId, setSessionId] = useState(() => C.loadJSON(C.LS.session, null));
  const [authReady, setAuthReady] = useState(false);
  const user = users.find(u => u.id === sessionId && u.active) || null;
  const login = (id, profile) => {
    if (profile) setUsersState(cur => cur.some(u => u.id === profile.id) ? cur.map(u => u.id === profile.id ? { ...u, ...profile } : u) : [...cur, profile]);
    setSessionId(id); C.saveJSON(C.LS.session, id);
  };
  const dropSession = () => { setSessionId(null); C.saveJSON(C.LS.session, null); };
  const logout = () => { C.API.logout(); dropSession(); };
  useEffect(() => {
    C.API.me().then(r => { if (r.ok && r.user) login(r.user.id, canonRoleUser(r.user)); else dropSession(); })
      .catch(() => {}).finally(() => setAuthReady(true));
    window.addEventListener("tdt:unauthorized", dropSession);
    return () => window.removeEventListener("tdt:unauthorized", dropSession);
  }, []);
  const authed = authReady && !!user;

  // True once the Worker's account list has replaced the local copy — the Permissions page
  // derives role module lists from real accounts only after this.
  const [usersSynced, setUsersSynced] = useState(false);
  // Roles live in settings/roles on the server (shared by every admin and read by every
  // account for its data scope); localStorage is only a cache. rolesRemote: "loading" until the
  // first read, then "loaded", "missing" (nothing stored yet) or "error" (read failed).
  const [roles, setRolesState] = useState(() => C.loadJSON(C.LS.roles, C.SEED_ROLES));
  const [rolesRemote, setRolesRemote] = useState("loading");
  const [rolesLocalOnly, setRolesLocalOnly] = useState([]);
  const [rolesSave, setRolesSave] = useState(null); // "saving" | "saved" | "error"
  const rolesRef = useRef(roles);
  const rolesOps = useRef({ put: new Map(), del: new Set(), busy: false });
  const keepRoles = (list) => { setRolesState(list); rolesRef.current = list; C.saveJSON(C.LS.roles, list); };
  // The fixed roles must always exist, whatever the stored list says.
  const withFixedRoles = (list) => [...C.SEED_ROLES.filter(f => f.fixed && !list.some(r => r.id === f.id)), ...list];
  const readRoles = async () => {
    const r = await fetch(C.SB.url + "/settings?id=eq.roles&select=data", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const v = j && j[0] ? j[0].data : null;
    return Array.isArray(v) && v.length ? v : null;
  };
  // Each write re-reads the stored list and applies only this browser's changes (per role id),
  // so two admins editing different roles never undo each other. Edits made while a write is
  // in flight are coalesced into the next one.
  const flushRoles = async () => {
    const ops = rolesOps.current;
    if (ops.busy) return;
    ops.busy = true; setRolesSave("saving");
    let merged = null, failed = false;
    while (ops.put.size || ops.del.size) {
      const put = ops.put, del = ops.del;
      ops.put = new Map(); ops.del = new Set();
      try {
        const base = (await readRoles()) || [];
        merged = base.filter(r => !del.has(r.id)).map(r => put.get(r.id) || r);
        put.forEach((r, id) => { if (!merged.some(x => x.id === id)) merged.push(r); });
        const w = await fetch(C.SB.url + "/settings", { method: "POST", headers: C.SB.headers(), body: JSON.stringify({ id: "roles", data: merged, updated_at: new Date().toISOString() }) });
        if (!w.ok) throw new Error("HTTP " + w.status);
      } catch (e) {
        console.warn("[roles] save failed", e); failed = true;
        // keep the unsaved changes queued for the next edit
        put.forEach((r, id) => { if (!ops.put.has(id)) ops.put.set(id, r); });
        del.forEach(id => ops.del.add(id));
        break;
      }
    }
    ops.busy = false;
    setRolesSave(failed ? "error" : "saved");
    // nothing left queued: show the stored list (it may hold another admin's changes too)
    if (!failed && merged && !ops.put.size && !ops.del.size) keepRoles(withFixedRoles(merged));
  };
  // opts.all writes every role (first seed), not just the ones that changed.
  const setRoles = (next, opts) => {
    const prev = rolesRef.current;
    keepRoles(next);
    if (!isBoss) return;
    const ops = rolesOps.current;
    next.forEach(r => {
      const p = prev.find(x => x.id === r.id);
      if ((opts && opts.all) || !p || JSON.stringify(p) !== JSON.stringify(r)) { ops.put.set(r.id, r); ops.del.delete(r.id); }
    });
    prev.forEach(p => { if (!next.some(r => r.id === p.id)) { ops.del.add(p.id); ops.put.delete(p.id); } });
    if (ops.put.size || ops.del.size) setTimeout(flushRoles, 400);
  };
  const roleOf = useCallback((u) => {
    const id = String((u && u.role) || "");
    const hit = roles.find(r => r.id === id);
    if (hit) return hit;
    // A legacy or renamed role id must NOT silently fall through to "own" scope: an admin
    // account whose role read "admin" (the fixed role's id is "BOD") was scoped to its own
    // sales code, so every list came back empty and looked like the database had been wiped.
    const alias = ROLE_ALIAS[id.toLowerCase()];
    const ar = alias && roles.find(r => r.id === alias);
    return ar || { id, name: id, scope: "own" };
  }, [roles]);

  const [overrides, setOverrides] = useState(() => C.loadJSON(C.LS.custOverrides, {}));
  const [extras, setExtras] = useState(() => C.loadJSON(C.LS.extras, []));
  const customers = useMemo(() => {
    const base = window.CRM_CUSTOMERS.concat(extras);
    return base.map(c => overrides[c.id] ? { ...c, ...overrides[c.id] } : c).filter(c => !c._deleted);
  }, [overrides, extras]);

  const [projects, setProjectsState] = useState(() => C.loadJSON(C.LS.projects, C.SEED_PROJECTS));
  const setProjects = (p) => { setProjectsState(p); C.saveJSON(C.LS.projects, p); };

  // ---- products ----
  const [products, setProductsState] = useState(() => C.loadJSON(C.LS.products, window.CRM_PRODUCTS));
  const setProducts = (p) => { setProductsState(p); C.saveJSON(C.LS.products, p); };
  const addProduct = (p) => setProducts([{ id: "PRD" + Date.now().toString(36).toUpperCase(), ...p, _updated: NOW() }, ...products]);
  const updateProductItem = (id, patch) => setProducts(products.map(x => x.id === id ? { ...x, ...patch, _updated: NOW() } : x));
  const deleteProduct = (id) => setProducts(products.map(x => x.id === id ? { ...x, _deleted: true, _updated: NOW() } : x));

  // ---- PO list ----
  const [pos, setPosState] = useState(() => C.normalizePOs(C.loadJSON(C.LS.polist, C.SEED_POS)));
  // Startup hydration progress for the PO table (it is paged and can be large) — the PO
  // List shows a progress bar off this instead of an empty "no data" table.
  const [posLoad, setPosLoad] = useState({ loading: true, n: 0, total: 0 });
  // State only — PO changes persist to Supabase per-row (syncPos below), never as one
  // whole-array localStorage blob (that blob was the original quota bug + data loss).
  const setPos = (p) => { setPosState(p); };
  // Persist PO changes to Supabase ONE ROW PER RECORD (batched + retried) — only the
  // changed rows, never the whole table. This is what scales to millions and makes
  // import + concurrent entry safe (each row is independent, no whole-blob clobber).
  const syncPos = (recs) => { try { const a = (Array.isArray(recs) ? recs : [recs]).filter(Boolean); if (a.length) C.SB.putRows("pos", a); } catch (e) {} };
  // Same per-row sync for the other high-volume record tables (customers/projects/samples/
  // quotations): push ONLY the changed rows (batched + retried), never the whole table —
  // this is what makes import + entry scale to ~1M and keeps concurrent edits independent.
  const syncRows = (table, recs) => { try { const a = (Array.isArray(recs) ? recs : [recs]).filter(Boolean); if (a.length) C.SB.putRows(table, a); } catch (e) {} };

  // ---- VLOOKUP: PIC & Customer group always come from the Customer list ----
  // Each PO keeps whatever pic/group it was imported with, but every consumer
  // (PO List, Retention, Targets, Forecast) sees the values looked up from the
  // customer record: owner → Sales PIC, group → Customer group type.
  const canonCode = useMemo(() => C.canonCodeFn(users), [users]);
  const posLinked = useMemo(() => {
    const byId = {}; customers.forEach(c => { byId[c.id] = c; });
    // group may be stored as a full label ("A - Big & Regular") — normalize to its id
    const normGroup = C.normGroup;
    return pos.filter(p => !p._deleted).map(p => {
      const c = byId[p.customerId];
      if (!c) { const ng = normGroup(p.group); return ng && ng !== p.group ? { ...p, group: ng } : p; }
      const pic = canonCode(c.owner || p.pic || "");
      const group = normGroup(c.group) || normGroup(p.group) || "";
      return (pic === String(p.pic || "").trim() && group === (p.group || "")) ? p : { ...p, pic, group };
    });
  }, [pos, customers, canonCode]);

  // ---- MODULE A: Samples ----
  const [samples, setSamplesState] = useState(() => C.loadJSON(C.LS.samples, C.SEED_SAMPLES));
  const setSamples = (s) => { setSamplesState(s); C.saveJSON(C.LS.samples, s); };
  const addSample = (data) => {
    const id = "SMP-" + Date.now().toString(36).toUpperCase();
    const rec = {
      id, testStatus: "Chưa phản hồi", feedbackDate: "", feedbackNote: "", comparedAgainst: "",
      courier: "", trackingNo: "", followUpDate: "", projectId: "",
      ...data,
      createdBy: user ? (user.salesCode || user.name) : "?",
      _updated: NOW(),
    };
    setSamples([rec, ...samples]);
    syncRows("samples", rec);
    if (data.customerId) {
      const cust = customers.find(c => c.id === data.customerId);
      addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "sample", target: cust ? cust.name : data.customerId, detail: "Sample sent: " + (data.productCode || "") });
      addLog({ customerId: data.customerId, type: "note", text: t("log_sample_sent").replace("{code}", data.productCode || "") + (data.comparedAgainst ? " " + t("log_sample_cmp").replace("{x}", data.comparedAgainst) : "") });
    }
    if (data.projectId) advanceProjectStage(data.projectId, "Sample");
    return rec;
  };
  const updateSample = (id, patch) => {
    let up = null;
    setSamples(samples.map(s => s.id === id ? (up = { ...s, ...patch, _updated: NOW() }) : s));
    if (up) syncRows("samples", up);
    const smp = samples.find(s => s.id === id);
    if (patch.testStatus && smp && patch.testStatus !== smp.testStatus && smp.customerId) {
      addLog({ customerId: smp.customerId, type: "note", text: t("log_sample_result").replace("{code}", smp.productCode || "").replace("{status}", patch.testStatus) + (patch.feedbackNote ? " — " + patch.feedbackNote : "") });
    }
    if (patch.projectId) advanceProjectStage(patch.projectId, "Sample");
  };
  const samplesFor = (customerId) => samples.filter(s => s.customerId === customerId && !s._deleted);

  // ---- MODULE B: Quotations ----
  const [quotations, setQuotationsState] = useState(() => C.loadJSON(C.LS.quotations, C.SEED_QUOTATIONS));
  const setQuotations = (q) => { setQuotationsState(q); C.saveJSON(C.LS.quotations, q); };
  const nextQuoteNo = () => {
    const year = new Date().getFullYear();
    const nums = quotations
      .map(q => { const m = (q.id || "").match(/QT-(\d{4})-(\d+)/); return (m && +m[1] === year) ? +m[2] : 0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return "QT-" + year + "-" + String(next).padStart(3, "0");
  };
  const addQuotation = (data) => {
    const id = data.id || nextQuoteNo();
    const rec = {
      id, items: [], paymentTerms: "T/T 30 days", revisionNo: 1, status: "Draft",
      approvedBy: "", projectId: "",
      ...data,
      _updated: NOW(),
    };
    setQuotations([rec, ...quotations]);
    syncRows("quotations", rec);
    if (data.customerId) {
      const cust = customers.find(c => c.id === data.customerId);
      addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "quote", target: cust ? cust.name : data.customerId, detail: "Quotation " + id + " — " + (data.status || "Draft") });
      addLog({ customerId: data.customerId, type: "note", text: t("log_quote_created").replace("{id}", id).replace("{status}", data.status || "Draft") });
    }
    if (data.projectId) advanceProjectStage(data.projectId, "Quotation");
    return rec;
  };
  // updating status auto-bumps revisionNo when items/price changes are made via "revise"
  const updateQuotation = (id, patch, opts) => {
    let up = null;
    setQuotations(quotations.map(q => {
      if (q.id !== id) return q;
      const next = { ...q, ...patch, _updated: NOW() };
      if (opts && opts.revise) next.revisionNo = (q.revisionNo || 1) + 1;
      up = next; return next;
    }));
    if (up) syncRows("quotations", up);
    const quo = quotations.find(q => q.id === id);
    if (patch.status && quo && patch.status !== quo.status && quo.customerId) {
      addLog({ customerId: quo.customerId, type: "note", text: t("log_quote_status").replace("{id}", id).replace("{status}", patch.status) });
      // when Won, prompt PO creation (handled in UI); also auto-mark project quoteSent
      if (patch.status === "Won" && quo.projectId) {
        updateProject(quo.projectId, { quoteSent: true, stage: "PO" });
      }
    }
    if (patch.projectId) advanceProjectStage(patch.projectId, "Quotation");
  };
  const quotationsFor = (customerId) => quotations.filter(q => q.customerId === customerId && !q._deleted);

  // ---- MODULE D: Reorder Engine ----
  const reorderEngine = useMemo(() => C.computeReorderEngine(posLinked), [posLinked]);
  const [reorderLog, setReorderLogState] = useState(() => C.loadJSON(C.LS.reorderLog, {}));
  const setReorderLog = (l) => { setReorderLogState(l); C.saveJSON(C.LS.reorderLog, l); };
  // record a quick sales action for a customer+productCode key
  const setReorderAction = (key, patch) => {
    const next = { ...reorderLog, [key]: { ...(reorderLog[key] || {}), ...patch } };
    setReorderLog(next);
    const entry = reorderEngine.find(r => r.key === key);
    if (entry) {
      addLog({
        customerId: entry.customerId, type: "note",
        text: "Re-order: " + (patch.salesAction || "") + (patch.reminderChannel ? " · " + patch.reminderChannel : ""),
      });
    }
  };
  // merge reorder engine rows with logged actions
  const reorderRows = useMemo(() => reorderEngine.map(r => ({ ...r, ...(reorderLog[r.key] || {}) })), [reorderEngine, reorderLog]);

  // ---- Sales Forecast (FC vs Actual) ----
  const [forecast, setForecastState] = useState(() => C.loadJSON(C.LS.forecast, C.SEED_FORECAST));
  const setForecast = (f) => { setForecastState(f); C.saveJSON(C.LS.forecast, f); };
  // create or update the forecast entry for a given customer/sales/period (one entry per combo)
  const upsertForecast = (data) => {
    const { customerId, salesId, targetYear, targetMonth } = data;
    const existing = forecast.find(f => f.customerId === customerId && f.salesId === salesId && f.targetYear === targetYear && f.targetMonth === targetMonth);
    if (existing) {
      setForecast(forecast.map(f => f === existing ? { ...f, ...data, _updated: NOW() } : f));
      return { ...existing, ...data };
    }
    const rec = {
      forecastId: "FC-" + Date.now().toString(36).toUpperCase(),
      fcQtyJumboSqm: 0, fcValueJumbo: 0, fcQtyFinishedRolls: 0, fcValueFinished: 0, status: "Draft",
      ...data,
      _updated: NOW(),
    };
    setForecast([rec, ...forecast]);
    return rec;
  };
  const deleteForecast = (forecastId) => setForecast(forecast.map(f => f.forecastId === forecastId ? { ...f, _deleted: true, _updated: NOW() } : f));
  const forecastFor = (customerId, year, month) =>
    forecast.find(f => f.customerId === customerId && f.targetYear === year && f.targetMonth === month && !f._deleted);

  // ---- Per-SKU Sales Forecast (template grid: actuals from PO, editable FC per month) ----
  // shape: { [customerId]: { [sku]: { note, status, cells: { [ymKey]: { fcQty, fcValue } } } } }
  const [skuForecast, setSkuForecastState] = useState(() => C.loadJSON(C.LS.skuForecast, {}));
  const setSkuForecast = (f) => { setSkuForecastState(f); C.saveJSON(C.LS.skuForecast, f); C.SB.pushDeep("skuForecast", f); };
  const saveSkuCell = (customerId, sku, ymKey, field, val) => {
    setSkuForecastState(prev => {
      const next = { ...prev };
      const c = next[customerId] = { ...(next[customerId] || {}) };
      const s = c[sku] = { ...(c[sku] || { note: "", status: "Draft", cells: {} }) };
      s.cells = { ...(s.cells || {}) };
      const patch = (field && typeof field === "object") ? field : { [field]: val };
      s.cells[ymKey] = { ...(s.cells[ymKey] || {}), ...patch };
      C.saveJSON(C.LS.skuForecast, next);
      C.SB.pushDeep("skuForecast", next, [customerId]);
      return next;
    });
  };
  // field may be a single key or a whole patch object (used when a row is added by hand
  // from the Forecast tab: product attributes + status land in one write).
  const saveSkuMeta = (customerId, sku, field, val) => {
    setSkuForecastState(prev => {
      const next = { ...prev };
      const c = next[customerId] = { ...(next[customerId] || {}) };
      const patch = (field && typeof field === "object") ? field : { [field]: val };
      c[sku] = { ...(c[sku] || { note: "", status: "Draft", cells: {} }), ...patch };
      C.saveJSON(C.LS.skuForecast, next);
      C.SB.pushDeep("skuForecast", next, [customerId]);
      return next;
    });
  };
  // Hand-added rows can be taken back off the forecast. Tombstone rather than delete so
  // the removal propagates to the other browsers instead of being re-seeded on next pull.
  const deleteSkuRow = (customerId, sku) => {
    setSkuForecastState(prev => {
      const next = { ...prev };
      const c = next[customerId] = { ...(next[customerId] || {}) };
      c[sku] = { _deleted: true };
      C.saveJSON(C.LS.skuForecast, next);
      C.SB.pushDeep("skuForecast", next, [customerId]);
      return next;
    });
  };

  // ---- targets ----
  const [targets, setTargetsState] = useState(() => C.loadJSON(C.LS.targets, C.SEED_TARGETS));
  const setTargets = (tg) => { setTargetsState(tg); C.saveJSON(C.LS.targets, tg); C.SB.pushDeep("targets", tg); };
  const setTarget = (year, pic, monthIdx, value) => {
    const next = { ...targets, [year]: { ...(targets[year] || {}) } };
    const arr = (next[year][pic] || Array(12).fill(0)).slice();
    arr[monthIdx] = value;
    next[year][pic] = arr;
    setTargetsState(next); C.saveJSON(C.LS.targets, next); C.SB.pushDeep("targets", next, [String(year)]);
  };
  const [targetGroups, setTargetGroupsState] = useState(() => C.loadJSON(C.LS.targetGroups, C.SEED_TARGET_GROUPS));
  const setTargetGroups = (tg) => { setTargetGroupsState(tg); C.saveJSON(C.LS.targetGroups, tg); C.SB.pushDeep("targetGroups", tg); };
  const setTargetGroup = (year, pic, group, monthIdx, value) => {
    const next = JSON.parse(JSON.stringify(targetGroups));
    next[year] = next[year] || {};
    next[year][pic] = next[year][pic] || {};
    next[year][pic][group] = (next[year][pic][group] || Array(12).fill(0)).slice();
    next[year][pic][group][monthIdx] = value;
    setTargetGroupsState(next); C.saveJSON(C.LS.targetGroups, next); C.SB.pushDeep("targetGroups", next, [String(year)]);
  };
  // Target BY CUSTOMER BY ITEM: targetCust[year][customerId][code] = { pic, code, grade,
  // roll, price, cur, sqm:[12], usd:[12] }. The budget file carries BOTH measures per month
  // — area and value — so both are stored as entered; value falls back to sqm × price only
  // when the file had no value column.
  const [targetCust, setTargetCustState] = useState(() => C.loadJSON(C.LS.targetCust, {}));
  const setTargetCustMonth = (year, customerId, code, field, monthIdx, value) => {
    const next = JSON.parse(JSON.stringify(targetCust));
    const y = next[year] = next[year] || {};
    const c = y[customerId] = y[customerId] || {};
    const row = c[code] = { ...(c[code] || { code, price: 0 }) };
    row[field] = (row[field] || Array(12).fill(0)).slice();
    row[field][monthIdx] = value;
    c[code] = row;
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", next, [String(year)]);
  };
  const setTargetCustField = (year, customerId, code, field, value) => {
    const next = JSON.parse(JSON.stringify(targetCust));
    const y = next[year] = next[year] || {};
    const c = y[customerId] = y[customerId] || {};
    c[code] = { ...(c[code] || { code, sqm: Array(12).fill(0) }), [field]: value };
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", next, [String(year)]);
  };
  // Bulk write from the budget file. rows: [{ year, customerId, code, pic, grade, roll,
  // price, cur, sqm:[12], usd:[12] }] — one row per customer×item, REPLACING that item's plan.
  const setTargetCustBulk = (rows) => {
    const next = JSON.parse(JSON.stringify(targetCust));
    const years = new Set();
    const arr12 = (a) => (a || []).slice(0, 12).concat(Array(12).fill(0)).slice(0, 12).map(v => +v || 0);
    (rows || []).forEach(r => {
      if (!r || !r.customerId || !r.code) return;
      const yk = String(r.year);
      years.add(yk);
      const y = next[yk] = next[yk] || {};
      const c = y[r.customerId] = y[r.customerId] || {};
      c[r.code] = {
        code: r.code, pic: r.pic || "", grade: r.grade || "", roll: r.roll || "",
        price: +r.price || 0, cur: r.cur || "USD", country: r.country || "",
        sqm: arr12(r.sqm), usd: arr12(r.usd),
      };
    });
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", next, [...years]);
    return { years: [...years], rows: (rows || []).length };
  };
  const deleteTargetCustYear = (year) => {
    const next = JSON.parse(JSON.stringify(targetCust));
    delete next[String(year)];
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", { [String(year)]: null }, [String(year)]);
  };
  // Rows imported before the PIC resolver folded diacritics still hold the file's full name
  // ("Hoàng Lê Khương") instead of the sales code ("KHUONG"), so they never link to a rep.
  // One pass rewrites a whole year in a single push; already-coded rows are left alone.
  const normalizeTargetCustPics = (year) => {
    const yk = String(year);
    const y = targetCust && targetCust[yk];
    if (!y) return 0;
    const fold = (v) => String(v == null ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D").trim().toUpperCase();
    const lastTok = (v) => { const p = fold(v).split(/\s+/).filter(Boolean); return p.length ? p[p.length - 1] : ""; };
    const map = {}, known = new Set();
    const put = (k, code) => { if (k && !map[k]) map[k] = code; };
    (users || []).forEach(u => {
      if (u._deleted) return;
      const code = String(u.salesCode || u.name || "").trim();
      if (!code) return;
      known.add(code.toUpperCase());
      put(code.toUpperCase(), code); put(fold(code), code);
      [u.name, u.shortName].forEach(nm => { put(fold(nm), code); put(lastTok(nm), code); });
    });
    const next = JSON.parse(JSON.stringify(targetCust));
    let n = 0;
    Object.keys(next[yk]).forEach(cid => {
      const items = next[yk][cid];
      Object.keys(items).forEach(code => {
        const raw = String(items[code].pic || "").trim();
        if (!raw || known.has(raw.toUpperCase())) return;
        const hit = map[fold(raw)] || map[lastTok(raw)];
        if (hit && hit !== raw) { items[code] = { ...items[code], pic: hit }; n++; }
      });
    });
    if (!n) return 0;
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", next, [yk]);
    return n;
  };
  // Delete SELECTED rows, not a whole year. pairs: [{ customerId, code }]. A customer left
  // with no items is dropped too, so it stops showing as an empty group.
  const deleteTargetCustRows = (year, pairs) => {
    const yk = String(year);
    const next = JSON.parse(JSON.stringify(targetCust));
    const y = next[yk]; if (!y) return 0;
    let n = 0;
    (pairs || []).forEach(({ customerId, code }) => {
      if (y[customerId] && y[customerId][code]) { delete y[customerId][code]; n++; }
      if (y[customerId] && !Object.keys(y[customerId]).length) delete y[customerId];
    });
    if (!n) return 0;
    setTargetCustState(next); C.saveJSON(C.LS.targetCust, next); C.SB.pushDeep("targetCust", next, [yk]);
    return n;
  };
  // Delete SELECTED PIC × customer-type target rows. pairs: [{ pic, group }].
  const deleteTargetGroupRows = (year, pairs) => {
    const yk = String(year);
    const next = JSON.parse(JSON.stringify(targetGroups));
    const y = next[yk]; if (!y) return 0;
    let n = 0;
    (pairs || []).forEach(({ pic, group }) => {
      if (y[pic] && y[pic][group]) { delete y[pic][group]; n++; }
      if (y[pic] && !Object.keys(y[pic]).length) delete y[pic];
    });
    if (!n) return 0;
    setTargetGroupsState(next); C.saveJSON(C.LS.targetGroups, next); C.SB.pushDeep("targetGroups", next, [yk]);
    return n;
  };
  // country of a sales code (from account settings)
  const repCountry = useCallback((pic) => {
    let u = users.find(x => x.salesCode === pic) || (C.SEED_USERS || []).find(x => x.salesCode === pic);
    // Code-less accounts (e.g. an Admin who still carries a KPI, like Thuy) are keyed
    // in the Targets grid by their account NAME — resolve those too so their KPI
    // country is honoured instead of defaulting to Thailand.
    if (!u) u = users.find(x => !x.salesCode && (x.name || "").trim() === pic);
    // An explicit KPI country ticked in Permissions (targetCountry) always wins — it's
    // what the Permissions chip shows, so Targets must group by the same value. Untick it
    // ("-") and the account carries no KPI country at all.
    const kpiC = u ? C.kpiCountryOf(u) : "";
    if (kpiC) return kpiC;
    if (u && u.targetCountry === C.KPI_NONE) return "";
    if (!u || !u.countries || u.countries.includes("*")) {
      // fall back to the country of a customer this rep owns
      const owned = customers.find(c => c.owner === pic && c.country);
      if (owned) return C.normCountry(owned.country);
      return "Thailand";
    }
    return C.normCountry(u.countries[0] || "Thailand");
  }, [users, customers]);

  // ---- Customer Retention Dashboard ----
  const parentMap = useMemo(() => C.parentMapOf(customers), [customers]);
  // Retention health from SERVER per-customer stats (scales to millions of POs); recompute
  // locally when targets/customers change; refetch when the PO set changes. Falls back to
  // the RAM engine (computeRetentionEngine over posLinked) until the stats have loaded /
  // when Supabase is unreachable, so the tab is never empty.
  const [retStats, setRetStats] = useState(null);
  const [retMonthAgg, setRetMonthAgg] = useState(null);
  const _posCountSig = posLinked.length;
  useEffect(() => {
    if (!authed) return;
    let on = true;
    (async () => {
      try {
        const cy = new Date().getFullYear();
        const [stats, months] = await Promise.all([C.SB.customerStats(), C.SB.aggRange((cy - 1) + "-01-01", cy + "-12-31")]);
        if (on) { setRetStats(Array.isArray(stats) && stats.length ? stats : null); setRetMonthAgg(Array.isArray(months) ? months : null); }
      } catch (e) { if (on) setRetStats(null); }
    })();
    return () => { on = false; };
  }, [_posCountSig, authed]);
  const retentionRows = useMemo(() => {
    if (retStats) { const custById = {}; customers.forEach(c => custById[c.id] = c); return C.computeRetentionFromStats(retStats, retMonthAgg || [], targets, parentMap, custById, null); }
    return C.computeRetentionEngine(posLinked, targets, null, parentMap);
  }, [retStats, retMonthAgg, posLinked, targets, parentMap, customers]);

  const [activity, setActivityState] = useState(() => C.loadJSON(C.LS.activity, C.SEED_ACTIVITY));
  const addActivity = (entry) => {
    const next = [{ id: "A" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString().slice(0, 16).replace("T", " "), ...entry }, ...activity].slice(0, 80);
    setActivityState(next); C.saveJSON(C.LS.activity, next);
  };

  const updateCustomer = (id, patch, actName) => {
    const stamp = {
      _updated: new Date().toISOString().slice(0, 16).replace("T", " "),
      _updatedBy: user ? (user.salesCode || user.name) : "?",
    };
    // Customers live in the `extras` blob, which syncs to the "customers" table that
    // actually exists on Supabase. Patch the record IN PLACE and push, so edits
    // propagate to every browser/deployment. (The old code wrote per-field patches to
    // a separate "custOverrides" table that was never created server-side — so every
    // customer edit silently failed to sync. We also fold any leftover local override
    // for this id into the record and drop it, migrating to a single source of truth.)
    const ov = overrides[id] || {};
    let hit = false;
    const nextExtras = extras.map(c => c.id === id ? (hit = true, { ...c, ...ov, ...patch, ...stamp }) : c);
    if (hit) {
      setExtras(nextExtras); C.saveJSON(C.LS.extras, nextExtras);
      syncRows("customers", nextExtras.find(c => c.id === id));
      if (overrides[id]) { const no = { ...overrides }; delete no[id]; setOverrides(no); C.saveJSON(C.LS.custOverrides, no); }
    } else {
      // fallback: a hardcoded seed record (none today) keeps using an override
      const next = { ...overrides, [id]: { ...ov, ...patch, ...stamp } };
      setOverrides(next); C.saveJSON(C.LS.custOverrides, next);
    }
    if (actName) {
      const cust = customers.find(c => c.id === id);
      addActivity({ user: stamp._updatedBy, action: "status", target: cust ? cust.name : id, detail: actName });
    }
  };
  const addCustomer = (data) => {
    const id = "CX" + Date.now().toString(36).toUpperCase();
    const funnel = C.STATUS_TO_FUNNEL[data.status] || "New";
    const cust = {
      id, bizId: "", shortName: "", city: "", district: "", address: "", type: "", leadSource: "",
      pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "",
      email: "", website: "", note: "",
      contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "",
      decisionMaker: false, companySizeEstimate: "",
      ...data,
      funnel, created: new Date().toISOString().slice(0, 10),
      _updated: new Date().toISOString().slice(0, 16).replace("T", " "),
      _updatedBy: user ? (user.salesCode || user.name) : "?",
    };
    if (!cust.nameCode) cust.nameCode = C.suggestNameCode(cust.name) || cust.shortName || "";
    const next = [...extras, cust];
    setExtras(next); C.saveJSON(C.LS.extras, next);
    syncRows("customers", cust);
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "added", target: cust.name, detail: data.status || "New lead" });
    return cust;
  };
  // bulk import: returns {imported, updated, skipped, matchedByName, issues}
  const addCustomersBulk = (list) => {
    let all = customers.slice();
    const added = [];
    const issues = [];
    const patchById = {};   // newest import wins: existing rows are refreshed, not skipped
    let skipped = 0, updated = 0, matchedByName = 0;
    // Fields the file never owns — an import must not wipe history or re-key a record.
    const KEEP = { _row: 1, id: 1, created: 1, contactHistory: 1, lastContactDate: 1, _updated: 1, _updatedBy: 1 };
    // Same company name + country (live records only) — the fallback key for rows the
    // Business ID can't place. The index grows as the file is read, so a company repeated
    // in the same file lands on one record.
    const nameKey = (c) => { const n = C.normName(c.name); return n ? n + "|" + C.normCountry(c.country) : ""; };
    const byName = {};
    const index = (c) => { const k = nameKey(c); if (!k) return; (byName[k] = (byName[k] || []).filter(x => x.id !== c.id)).push(c); };
    all.forEach(index);
    const poCount = {};
    if (retStats) retStats.forEach(r => { poCount[r.customer_id] = +r.po_count || 0; });
    else pos.forEach(p => { if (!p._deleted && p.customerId) poCount[p.customerId] = (poCount[p.customerId] || 0) + 1; });
    // A same-name record with a different Business ID is another legal entity. Among the
    // rest prefer the one with a Business ID, then the most POs, then the oldest.
    const byNameMatch = (data) => {
      const k = nameKey(data); if (!k || !byName[k]) return null;
      const biz = C.normBizId(data.bizId);
      const cands = byName[k].filter(c => { const cb = C.normBizId(c.bizId); return !biz || !cb || cb === biz; });
      cands.sort((a, b) => (!!C.normBizId(b.bizId) - !!C.normBizId(a.bizId)) || ((poCount[b.id] || 0) - (poCount[a.id] || 0)) || String(a.created || "9").localeCompare(String(b.created || "9")));
      return cands[0] || null;
    };
    list.forEach((raw, i) => {
      // Normalise the tax code to its market's shape first — Excel strips the leading zero
      // off a Vietnamese code, and the padded form is what matches an existing record.
      const data = { ...raw, bizId: C.formatBizId(raw.bizId, raw.country) };
      // Business ID (TIN) first; without a match there, the same company name in the same
      // country (filling in the Business ID when the file has one and the record doesn't).
      let existing = C.findByBizId(data.bizId, all);
      if (!existing) { existing = byNameMatch(data); if (existing) matchedByName++; }
      if (existing) {
        // Overwrite whatever the file actually carries (PIC, owner, phone, address, status…)
        // and leave the rest of the record alone. A later row for the same company wins.
        const patch = {};
        Object.keys(data).forEach(k => {
          if (KEEP[k]) return;
          const v = data[k];
          if (v === undefined || v === null || v === "") return;
          patch[k] = v;
        });
        if (patch.status) patch.funnel = data.funnel || C.STATUS_TO_FUNNEL[patch.status] || existing.funnel || "New";
        if (Object.keys(patch).length) {
          // A record created earlier in this file is patched in place (it is written below).
          const fresh = added.findIndex(c => c.id === existing.id);
          if (fresh >= 0) added[fresh] = { ...added[fresh], ...patch };
          else patchById[existing.id] = { ...(patchById[existing.id] || {}), ...patch };
          updated++;
          const next = { ...existing, ...patch };
          all = all.map(c => c.id === existing.id ? next : c);
          if (nameKey(next) !== nameKey(existing)) { const ok = nameKey(existing); if (byName[ok]) byName[ok] = byName[ok].filter(c => c.id !== existing.id); }
          index(next);
        } else {
          skipped++; if (data._row) issues.push({ row: data._row, code: "dup" });
        }
        return;
      }
      const funnel = data.funnel || C.STATUS_TO_FUNNEL[data.status] || "New";
      const cust = {
        id: "CX" + Date.now().toString(36).toUpperCase() + i,
        bizId: "", shortName: "", city: "", district: "", address: "", type: "", leadSource: "", group: "A",
        pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "",
        email: "", website: "", note: "", status: "",
        contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "",
        decisionMaker: false, companySizeEstimate: "",
        ...data, _row: undefined,
        funnel, created: data.created || new Date().toISOString().slice(0, 10), _updated: NOW(),
      };
      if (!cust.nameCode) cust.nameCode = C.suggestNameCode(cust.name) || cust.shortName || "";
      added.push(cust); all = all.concat([cust]); index(cust);
    });
    const ids = Object.keys(patchById);
    if (added.length || ids.length) {
      const stamp = { _updated: NOW(), _updatedBy: user ? (user.salesCode || user.name) : "?" };
      const inExtras = new Set(extras.map(c => c.id));
      let nextExtras = ids.length
        ? extras.map(c => patchById[c.id] ? { ...c, ...(overrides[c.id] || {}), ...patchById[c.id], ...stamp } : c)
        : extras.slice();
      // A seed-only record (not in extras) keeps using the override blob.
      const leftovers = ids.filter(id => !inExtras.has(id));
      if (leftovers.length) {
        const no = { ...overrides };
        leftovers.forEach(id => { no[id] = { ...(no[id] || {}), ...patchById[id], ...stamp }; });
        setOverrides(no); C.saveJSON(C.LS.custOverrides, no);
      }
      // Patched extras no longer need their stale override.
      const cleared = ids.filter(id => inExtras.has(id) && overrides[id]);
      if (cleared.length) { const no = { ...overrides }; cleared.forEach(id => delete no[id]); setOverrides(no); C.saveJSON(C.LS.custOverrides, no); }
      if (added.length) nextExtras = [...nextExtras, ...added];
      setExtras(nextExtras); C.saveJSON(C.LS.extras, nextExtras);
      const touched = [...added, ...nextExtras.filter(c => patchById[c.id])];
      if (touched.length) syncRows("customers", touched);
      addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "added", target: added.length + " customers (CSV import)", detail: updated + " updated · " + skipped + " skipped · " + matchedByName + " matched by name" });
    }
    return { imported: added.length, updated, skipped, matchedByName, issues };
  };

  // log a contact attempt (Cold call / Line / Email / Visit) — updates contactHistory + lastContactDate
  const addContactLog = (customerId, entry) => {
    const cust = customers.find(c => c.id === customerId);
    if (!cust) return;
    const item = {
      date: new Date().toISOString().slice(0, 10),
      channel: "Call", summary: "", by: user ? (user.salesCode || user.name) : "?",
      ...entry,
    };
    const history = [item, ...(cust.contactHistory || [])];
    updateCustomer(customerId, { contactHistory: history, lastContactDate: item.date }, "Contact: " + item.channel);
    addLog({ customerId, type: "call", outcome: "Connected", text: (item.channel + (item.summary ? " — " + item.summary : "")) });
  };

  // ---- interaction logs ----
  const [logs, setLogsState] = useState(() => C.loadJSON(C.LS.logs, C.SEED_LOGS));
  const addLog = (entry) => {
    const e = {
      id: "L" + Date.now().toString(36),
      ts: new Date().toISOString().slice(0, 16).replace("T", " "),
      user: user ? (user.salesCode || user.name) : "?",
      ...entry,
    };
    const next = [e, ...logs];
    setLogsState(next); C.saveJSON(C.LS.logs, next);
    return e;
  };
  const logsFor = (customerId) => logs.filter(l => l.customerId === customerId);

  const [calendarConnected, setCalState] = useState(() => C.loadJSON(C.LS.calendar, false));
  const toggleCalendar = () => { setCalState(v => { C.saveJSON(C.LS.calendar, !v); return !v; }); };

  const [currency, setCurrencyState] = useState(() => C.loadJSON("ttcrm_currency_v1", "VND"));
  const setCurrency = (c) => { setCurrencyState(c); C.saveJSON("ttcrm_currency_v1", c); };
  // Global COUNTRY view filter (topbar). "All" = no restriction; a market name narrows
  // every scoped dataset to customers of that country. Persisted per browser.
  const [countryFilter, setCountryFilterState] = useState(() => C.loadJSON("ttcrm_country_filter_v1", "All"));
  const setCountryFilter = (c) => { setCountryFilterState(c); C.saveJSON("ttcrm_country_filter_v1", c); };
  // Global DATE RANGE filter (topbar) — the same idea as the country filter: ONE Looker-style
  // control drives every tab, with an optional comparison window.
  // Shape: {preset, from, to, cmp, cmpFrom, cmpTo}; resolved dates live in dateRangeR.
  // Every app open starts on "This month"; the user's pick holds until the next open
  // (the comparison setting is remembered).
  const [dateRange, setDateRangeState] = useState(() => ({ cmp: "none", cmpFrom: "", cmpTo: "", ...C.loadJSON("ttcrm_date_range_v1", {}), preset: "thisMonth", from: "", to: "" }));
  const setDateRange = (r) => { setDateRangeState(r); C.saveJSON("ttcrm_date_range_v1", r); };
  const dateRangeR = useMemo(() => (window.drResolve ? window.drResolve(dateRange) : { from: "", to: "", cmp: "none", cmpFrom: "", cmpTo: "", hasCmp: false }), [dateRange]);
  // default currency from the logged-in user's assigned market (still manually changeable)
  useEffect(() => {
    if (!user) return;
    const cs = (user.countries || []).filter(c => c && c !== "*");
    const tc = user.targetCountry;
    if (tc) setCurrencyState(tc === "Thailand" ? "THB" : "VND");
    // An all-scope account isn't tied to one market: it reports in VND unless a KPI country
    // says otherwise, even if its countries list happens to name a single market.
    else if (!isBoss && cs.length === 1 && cs[0] === "Thailand") setCurrencyState("THB");
    else setCurrencyState("VND");
  }, [user && user.id]);
  const money = useCallback((vnd) => C.fmtMoney(vnd, currency), [currency]);
  // ---- Server hydrate: pull remote rows once signed in ----
  // Supabase is the source of truth. SB.get() returns:
  //   • null  → the row was NEVER created (brand-new database) → keep the code seed.
  //   • []    → the row EXISTS but is empty (user deleted everything) → apply it, so a
  //             delete made on one deployment clears the data on every deployment.
  //   • [...] → real remote data → apply it.
  // The old guard (`&& d.length`) treated an emptied table the same as a fresh DB, so
  // deleted seed data kept "coming back". We now trust any array the server returns.
  useEffect(() => {
    if (!authed) return;
    let on = true;
    (async () => {
      // Merge remote into the CURRENT local state (union by id, newest _updated wins),
      // not into a snapshot captured at mount. Using the functional updater is critical:
      // the GET is async, so by the time it resolves the user may have already typed new
      // records — merging against `cur` keeps those, whereas merging against a stale
      // mount snapshot would overwrite (lose) them. We persist locally but do NOT re-push
      // (the data we just pulled is already on the server; local edits push themselves).
      const pull = async (tbl, rawSetter, lsKey) => {
        try {
          const d = await C.SB.get(tbl);
          if (on && Array.isArray(d)) rawSetter(cur => {
            const merged = C.SB.mergeArrById(d, Array.isArray(cur) ? cur : []);
            try { localStorage.setItem(lsKey, JSON.stringify(merged)); } catch (e) { try { localStorage.removeItem(lsKey); } catch (_) {} }
            return merged;
          });
        } catch (e) {}
      };
      // Object-blob tables (KPI targets / group targets / per-SKU forecast) merge deeply
      // so one user's edit to a branch doesn't wipe another's; remote wins at the leaf.
      const pullObj = async (tbl, rawSetter, lsKey) => {
        try {
          const d = await C.SB.get(tbl);
          if (on && d && typeof d === "object" && !Array.isArray(d)) rawSetter(cur => {
            const merged = C.SB.deepMergeWins(cur && typeof cur === "object" ? cur : {}, d);
            try { localStorage.setItem(lsKey, JSON.stringify(merged)); } catch (e) { try { localStorage.removeItem(lsKey); } catch (_) {} }
            return merged;
          });
        } catch (e) {}
      };
      // Activity feed has no stable id on older rows — union by id|composite key, then
      // sort newest-first and cap, so every user's recent actions show up once.
      const pullActivity = async () => {
        try {
          const d = await C.SB.get("activity");
          if (on && Array.isArray(d)) setActivityState(cur => {
            const keyOf = (a) => a && (a.id || (a.ts + "|" + (a.user || "") + "|" + (a.target || "") + "|" + (a.detail || "")));
            const m = new Map();
            d.forEach(a => { const k = keyOf(a); if (k) m.set(k, a); });
            (Array.isArray(cur) ? cur : []).forEach(a => { const k = keyOf(a); if (k) m.set(k, a); });
            const merged = [...m.values()].sort((x, y) => String(y.ts || "").localeCompare(String(x.ts || ""))).slice(0, 80);
            try { localStorage.setItem(C.LS.activity, JSON.stringify(merged)); } catch (e) { try { localStorage.removeItem(C.LS.activity); } catch (_) {} }
            return merged;
          });
        } catch (e) {}
      };
      pull("projects", setProjectsState, C.LS.projects); pull("samples", setSamplesState, C.LS.samples);
      // PO list: BOUNDED hydration — pull only the newest slice (RAM_CAP) into memory so
      // startup stays flat no matter how large the table grows (100k → 1M). Full history
      // lives on Supabase: every summary tab reads server aggregates, and the detail
      // views (PO profile, customer profile, forecast detail) fetch per-customer/id on
      // demand. Stale whole-table localStorage is cleared so it can never resurrect.
      (async () => {
        try {
          const r = await C.SB.queryAll({ order: "date", dir: "desc", noCount: true }, C.SB.RAM_CAP || 6000,
            (n, total) => { if (on) setPosLoad({ loading: true, n, total }); });
          if (on && r && Array.isArray(r.rows)) { setPosState(cur => C.SB.mergeArrById(r.rows, Array.isArray(cur) ? cur : [])); try { localStorage.removeItem(C.LS.polist); } catch (e) {} }
        } catch (e) {}
        if (on) setPosLoad({ loading: false, n: 0, total: 0 });
      })();
      pull("quotations", setQuotationsState, C.LS.quotations); pull("products", setProductsState, C.LS.products);
      // users/roles are defined by the code seed (Sales Team allocation) — don't let a
      // stale remote row override the team list.
      pull("forecast", setForecastState, C.LS.forecast);
      pull("customers", setExtras, C.LS.extras);
      // Contact logs / activity feed / KPI targets — previously never pulled, so they
      // lived only in the author's browser (invisible to admins/managers, lost on F5).
      pull("logs", setLogsState, C.LS.logs);
      pullActivity();
      pullObj("targets", setTargetsState, C.LS.targets);
      pullObj("targetGroups", setTargetGroupsState, C.LS.targetGroups);
      pullObj("targetCust", setTargetCustState, C.LS.targetCust);
      pullObj("skuForecast", setSkuForecastState, C.LS.skuForecast);
      // Customer deletions are tombstones ({ id: { _deleted:true } }) stored in the
      // custOverrides object, NOT in the customers array — pull it too, otherwise seed
      // customers deleted on the server reappear on every fresh browser/deployment.
      try {
        const ov = await C.SB.get("custOverrides");
        if (on && ov && typeof ov === "object" && !Array.isArray(ov)) {
          setOverrides(ov);
          try { localStorage.setItem(C.LS.custOverrides, JSON.stringify(ov)); } catch (e) {}
        }
      } catch (e) {}
      // ---- Roles: settings/roles is authoritative; keep local-only roles aside so the
      // Permissions page can add the ones accounts still use. ----
      try {
        const list = await readRoles();
        if (on && list) {
          const local = rolesRef.current;
          setRolesLocalOnly(local.filter(r => !list.some(x => x.id === r.id)));
          keepRoles(withFixedRoles(list));
          setRolesRemote("loaded");
        } else if (on) setRolesRemote("missing");
      } catch (e) { if (on) setRolesRemote("error"); }
      // ---- Users: the Worker's account list is authoritative (edits, password resets and
      // soft-deletes — tombstones with _deleted:true — all happen there). ----
      try {
        const r = await C.API.users();
        if (on && r.ok && Array.isArray(r.users) && r.users.length) {
          const list = r.users.map(canonRoleUser);
          setUsersState(list);
          try { localStorage.setItem(C.LS.users, JSON.stringify(list)); } catch (e) {}
        }
      } catch (e) {}
      if (on) setUsersSynced(true);
    })();
    return () => { on = false; };
  }, [authed]);

  // status change with auto pipeline move
  const updateStatus = (id, status) => {
    const funnel = C.STATUS_TO_FUNNEL[status] || (status === "" ? "New" : undefined);
    const patch = funnel ? { status, funnel } : { status };
    updateCustomer(id, patch, status || "Cleared status");
    addLog({ customerId: id, type: "status", text: status || "—", funnel: funnel || "" });
  };
  const moveToStage = (id, stage) => {
    const status = C.STAGE_DEFAULT_STATUS[stage] ?? "";
    updateCustomer(id, { funnel: stage, status }, `Moved to ${stage}`);
  };

  const addProject = (p) => {
    const id = "P-" + String(2600 + projects.length + 1 + Math.floor(Math.random() * 90)).padStart(4, "0");
    const proj = { ...p, id, createdAt: new Date().toISOString().slice(0, 10), _updated: NOW() };
    setProjects([proj, ...projects]);
    syncRows("projects", proj);
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "project", target: proj.name, detail: "Created project" });
    return proj;
  };
  const updateProject = (id, patch) => { let up = null; setProjects(projects.map(p => p.id === id ? (up = { ...p, ...patch, _updated: NOW() }) : p)); if (up) syncRows("projects", up); };
  // advance a project's stage forward only (never downgrade), and set sample/quote flags
  const advanceProjectStage = (projId, toStage) => {
    if (!projId) return;
    const p = projects.find(x => x.id === projId);
    if (!p) return;
    const order = C.PROJECT_STAGES;
    const cur = order.indexOf(p.stage), tgt = order.indexOf(toStage);
    const flags = toStage === "Sample" ? { sampleSent: true } : toStage === "Quotation" ? { quoteSent: true } : {};
    const stagePatch = (cur >= 0 && cur < tgt) ? { stage: toStage } : {};
    updateProject(projId, { ...stagePatch, ...flags });
    if (stagePatch.stage) addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "project", target: p.name, detail: "Stage → " + toStage });
  };
  // Who wrote a PO record. Stamped on every write so the input history can name the person
  // behind each row instead of only its timestamp. Rows written before this simply read "—".
  const WHO = () => (user ? (user.salesCode || user.name) : "?");
  const updatePO = (id, patch) => { let up = null; const next = pos.map(p => { if (p.id === id) { up = { ...p, ...patch, _updated: NOW(), _updatedBy: WHO() }; return up; } return p; }); setPos(next); if (up) syncPos(up); };

  // add a PO; also updates the customer's group classification
  const addPO = (data) => {
    const prior = pos.filter(p => p.customerId === data.customerId).length;
    const autoNewRepeat = prior === 0 ? "New" : "Repeat";
    const poRec = {
      id: "PO-" + Date.now().toString(36).toUpperCase(),
      unit: "Cuộn", productType: "FR", invNo: "", edpCode: "", partNumber: "", itm: "",
      reportCode: "", deliveryCode: "", commissionRate: 0, commissionAmt: 0, priceList: 0, warning: "",
      quoteRef: "", attachments: [],
      ...data,
      orderCount: prior + 1,
      newRepeat: data.orderType || autoNewRepeat,
      orderType: data.orderType || autoNewRepeat,
      _updated: NOW(), _updatedBy: WHO(),
    };
    setPos([poRec, ...pos]);
    syncPos(poRec);
    if (data.customerId) {
      const patch = { group: data.group };
      updateCustomer(data.customerId, patch, "PO " + (poRec.poNumber || poRec.id) + " · Group " + data.group);
    }
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "po", target: poRec.poNumber || poRec.id, detail: C.fmtVND(poRec.amountVnd) });
    return poRec;
  };

  // bulk PO import: auto-creates a customer profile for any PO whose customer name isn't found.
  // items: [{ customerName, country, group, pic, date, poNumber, commercial, grade, materialName, width, length, qty, amountVnd }]
  const addPOsBulk = (items, opts = {}) => {
    const createMissing = opts.createMissing !== false; // default: create
    let all = customers.slice();
    const nameIdx = {};
    all.forEach(c => { nameIdx[C.normName(c.name)] = c; if (c.shortName) nameIdx[C.normName(c.shortName)] = c; });
    const today = new Date().toISOString().slice(0, 10);
    const priorCount = {};
    pos.forEach(p => { priorCount[p.customerId] = (priorCount[p.customerId] || 0) + 1; });
    // A PO record models ONE order LINE (a single product / size / qty / amount).
    // A PO with many product lines must therefore yield many PO records. Keying dedup
    // on PO number alone collapsed every line into a single PO (last line won), so we
    // dedup on a COMPOSITE line key instead: distinct lines of the same PO all survive,
    // while an EXACT re-imported line overwrites its twin (idempotent re-import).
    // Line identity = PO number + PRODUCT CODE + size + qty. Grade and product type are
    // NOT part of it (they are attributes), and neither is the amount (it is re-derived on
    // every import, so tiny rounding differences used to fork a new line). Genuinely
    // identical lines inside one PO are told apart by an occurrence index, so a re-import
    // maps 1:1 onto what is already stored instead of piling up duplicates.
    const codeOf = (r) => (C.cleanCode(r.structureCode) || C.cleanCode(r.commercial) || C.cleanCode(r.materialName) || "").toUpperCase();
    const prodOf = (r) => (C.cleanCode(r.materialName) || C.baseCode(codeOf(r)) || "").toUpperCase();
    // Match key: PO number | STRUCTURE CODE as the file writes it. Qty and size are NOT part
    // of it, so a re-import with corrected numbers OVERWRITES the stored line instead of
    // adding a second one. Repeated identical lines inside one PO are matched in file order.
    // The RESOLVED product code is deliberately NOT in the key: it changes the moment the
    // price list learns the code (T151 → TDW136), and a key that moves forks a second record
    // for one physical line — that is how 1901SON26080112 came to hold 56 rolls twice.
    const lineKeyOf = (poNo, r) => poNo ? [poNo, codeOf(r)].join("|") : "";
    // Fallback identity for exactly that case: same PO + same resolved product + same size and
    // qty is the same line even when the two codes read differently.
    const altKeyOf = (poNo, r) => (poNo && prodOf(r)) ? [poNo, prodOf(r), r.width || 0, r.length || 0, r.qty || 0].join("#") : "";
    const byLine = {};   // key → [existing PO records in stored order]
    const byAlt = {};    // alt key → [existing PO records]
    const consumed = {}; // record id → already matched by a row of this file
    // Seed from RAM *and* from opts.existing — the server rows the importer pre-fetched for
    // the PO numbers in this file. RAM only holds the loaded date window, so without those
    // rows a re-import cannot see (and therefore duplicates) every PO outside it.
    const seedSeen = {};
    (opts.existing && opts.existing.length ? pos.concat(opts.existing) : pos).forEach(p => {
      if (!p || p._deleted || seedSeen[p.id]) return; seedSeen[p.id] = 1;
      const pn = String(p.poNumber == null ? "" : p.poNumber).trim();
      const k = lineKeyOf(pn, p); if (k) (byLine[k] = byLine[k] || []).push(p);
      const ak = altKeyOf(pn, p); if (ak) (byAlt[ak] = byAlt[ak] || []).push(p);
    });
    const seen = {};     // key → how many times this import used it
    const normG = C.normGroup;
    const newCusts = [], poRecs = [];
    const updatedPos = {};        // id → patched PO (overwrite duplicates)
    const groupUpdates = {};      // existing customerId → group to write back
    let created = 0, skippedNoCustomer = 0, overwritten = 0, altMerged = 0;
    items.forEach((it, i) => {
      const rawName = (it.customerName || "").trim();
      const key = C.normName(rawName);
      let cust = nameIdx[key] || all.find(c => (c.name || "").toLowerCase().includes(rawName.toLowerCase()) || (c.shortName || "").toLowerCase() === rawName.toLowerCase());
      const gimp = normG(it.group);
      if (!cust) {
        if (!createMissing) { skippedNoCustomer++; return; } // skip this PO entirely
        cust = {
          id: "CX" + Date.now().toString(36).toUpperCase() + i,
          name: rawName, bizId: "", shortName: "", city: "", district: "", address: "", type: "", leadSource: "",
          pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "",
          email: "", website: "", note: "", status: "",
          contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "",
          decisionMaker: false, companySizeEstimate: "",
          country: C.normCountry(it.country) || "Thailand", owner: (it.pic || "").toUpperCase(), group: gimp || "A",
          funnel: "New", created: today, _origin: "po-import", _updated: NOW(),
        };
        newCusts.push(cust); all.push(cust); nameIdx[key] = cust; created++;
      } else if (gimp && normG(cust.group) !== gimp) {
        // existing customer: adopt the group from the import so it shows via VLOOKUP
        cust.group = gimp; groupUpdates[cust.id] = gimp;
      }
      const grp = gimp || normG(cust.group) || "A";
      const date = it.date || today;
      const poDate = it.poDate || date;
      const w = it.width || 0, len = it.length || 0, qty = it.qty || 0;
      const sqm = it.sqm || Math.round(w / 1000 * len * qty);
      const invNo = String(it.invNo || "").trim();
      const poNo = String(it.poNumber || invNo || "").trim();
      // Price model (one source of truth, see poPricing in data.js):
      //   unit price = price per m² · roll price = unit price × area/roll · value = roll price × qty
      // An import carries only VALUE and QTY, so the two prices are derived backwards.
      const areaRoll = (parseFloat(it.sqmPerRoll) || 0) > 0 ? parseFloat(it.sqmPerRoll) : (w / 1000 * len);
      const pr = C.poPricing({ unitPrice: it.unitPrice, rollPrice: it.rollPrice, amount: it.amountVnd, qty, areaRoll });
      const unitPrice = pr.unitPrice, rollPrice = pr.rollPrice, amountVnd = pr.amount;
      const structureCode = C.cleanCode(it.structureCode) || C.cleanCode(it.commercial) || "";
      const baseProdCode = C.cleanCode(it.materialName) || C.baseCode(structureCode);
      const base = {
        unit: it.unit || "Cuộn", productType: it.productType || "FR", invNo, edpCode: "", partNumber: "", itm: "",
        reportCode: "", deliveryCode: "", commissionRate: 0, commissionAmt: 0, priceList: 0, warning: "",
        quoteRef: "", attachments: [],
        customerId: cust.id, group: grp,
        pic: (it.pic || "").toUpperCase(), date, poDate,
        commercial: C.cleanCode(it.commercial) || structureCode, grade: it.grade || "", materialName: baseProdCode,
        // The amount AS ENTERED and its unit. `amountVnd` stays canonical VND — every KPI,
        // target and aggregate sums it — so the original figure is kept alongside rather
        // than converted away: a PO entered in USD can still be shown in USD.
        srcAmount: (it.srcAmount == null || it.srcAmount === "") ? "" : it.srcAmount, srcCurrency: it.srcCurrency || "",
        structureCode, sqmPerRoll: parseFloat(it.sqmPerRoll) || "",
        width: w, length: len,
        qty, amountVnd, sqm,
        items: (structureCode || unitPrice) ? [{
          sku: structureCode, structureCode, productCode: baseProdCode,
          grade: it.grade || "", productType: it.productType || "FR", width: w, length: len,
          sqmPerRoll: parseFloat(it.sqmPerRoll) || "", qty, price: unitPrice, unitPrice, rollPrice,
          amountVnd, currency: "VND",
        }] : undefined,
        unitPrice, rollPrice,
        poNumber: poNo,
        year: +String(date).slice(0, 4), month: +String(date).slice(5, 7),
      };
      // Duplicate PO LINE → overwrite that line instead of adding a new one.
      const lineKey = lineKeyOf(poNo, base);
      const nth = lineKey ? (seen[lineKey] = (seen[lineKey] || 0) + 1) : 0;
      let dup = lineKey && (byLine[lineKey] || [])[nth - 1];
      let viaAlt = false;
      if (!dup) {
        // No line with this code — but the same PO may already hold this exact line under a
        // different code (an unmapped T-code stored before the price list knew it). Adopt it
        // instead of writing a twin.
        const ak = altKeyOf(poNo, base);
        const cand = ak ? (byAlt[ak] || []).find(x => !consumed[x.id] && codeOf(x) !== codeOf(base)) : null;
        if (cand) { dup = cand; viaAlt = true; }
      }
      if (dup) {
        const merged = { ...dup, ...base, id: dup.id, orderCount: dup.orderCount, newRepeat: dup.newRepeat, orderType: dup.orderType, _deleted: undefined, _updated: NOW(), _updatedBy: WHO() + " · import" };
        updatedPos[dup.id] = merged; consumed[dup.id] = 1;
        if (lineKey) (byLine[lineKey] = byLine[lineKey] || [])[nth - 1] = merged;
        if (viaAlt) altMerged++;
        overwritten++;
        return;
      }
      const prior = priorCount[cust.id] || 0; priorCount[cust.id] = prior + 1;
      const rec = { id: "PO-" + Date.now().toString(36).toUpperCase() + i, ...base,
        orderCount: prior + 1, newRepeat: prior === 0 ? "New" : "Repeat", orderType: prior === 0 ? "New" : "Repeat", _updated: NOW(), _updatedBy: WHO() + " · import" };
      poRecs.push(rec);
      if (lineKey) (byLine[lineKey] = byLine[lineKey] || [])[nth - 1] = rec;
      const nak = altKeyOf(poNo, rec); if (nak) { (byAlt[nak] = byAlt[nak] || []).push(rec); consumed[rec.id] = 1; }
    });
    // Replace-by-PO: for every PO number the file contains, the FILE is the record. Any
    // stored line of those POs that this import did not match is removed — otherwise a
    // corrected re-import leaves the old line (a product code the file never mentions)
    // sitting next to the new one, which both invents a product and inflates the qty.
    let staleRemoved = 0;
    if (opts.replacePOs) {
      const fileNos = new Set(items.map(it => String(it.poNumber || it.invNo || "").trim()).filter(Boolean));
      const pool = (opts.existing && opts.existing.length ? pos.concat(opts.existing) : pos);
      const seenStale = {};
      pool.forEach(p => {
        if (!p || p._deleted || seenStale[p.id] || consumed[p.id] || updatedPos[p.id]) return;
        if (!fileNos.has(String(p.poNumber == null ? "" : p.poNumber).trim())) return;
        seenStale[p.id] = 1;
        updatedPos[p.id] = { ...p, _deleted: true, _updated: NOW(), _updatedBy: WHO() + " · import" };
        staleRemoved++;
      });
    }
    // Same PO + same product + same size + same qty stored MORE times than the file has
    // them = leftovers from an earlier import (when grade / type were treated as product
    // names). Re-importing the source file now cleans them up instead of adding more.
    let dupRemoved = 0;
    Object.keys(seen).forEach(k => {
      const bucket = byLine[k] || [];
      for (let j = seen[k]; j < bucket.length; j++) {
        const old = bucket[j];
        if (!old || updatedPos[old.id]) continue;
        updatedPos[old.id] = { ...old, _deleted: true, _updated: NOW(), _updatedBy: WHO() + " · import" };
        dupRemoved++;
      }
    });
    if (newCusts.length) { const nx = [...extras, ...newCusts]; setExtras(nx); C.saveJSON(C.LS.extras, nx); syncRows("customers", newCusts); }
    // write back group changes to existing customers (so PO List / retention VLOOKUP
    // shows them). Patch the `extras` records directly and push — same single source
    // of truth as updateCustomer, so the change syncs to the "customers" table.
    if (Object.keys(groupUpdates).length) {
      const nextExtras = extras.map(c => groupUpdates[c.id] ? { ...c, group: groupUpdates[c.id], _updated: NOW() } : c);
      setExtras(nextExtras); C.saveJSON(C.LS.extras, nextExtras);
      syncRows("customers", nextExtras.filter(c => groupUpdates[c.id]));
    }
    const hasUpd = Object.keys(updatedPos).length > 0;
    if (poRecs.length || hasUpd) {
      const next = pos.map(p => updatedPos[p.id] || p);
      setPos([...poRecs.reverse(), ...next]);
      syncPos([...poRecs, ...Object.values(updatedPos)]);
    }
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "po", target: (poRecs.length + overwritten) + " POs (import)", detail: created + " new customers · " + overwritten + " overwritten" });
    return { imported: poRecs.length + overwritten, created, skippedNoCustomer, overwritten, dupRemoved, staleRemoved, altMerged };
  };
  // Count how many distinct customers referenced by import items don't exist yet.
  const countNewPOCustomers = (items) => {
    const idx = {};
    customers.forEach(c => { idx[C.normName(c.name)] = 1; if (c.shortName) idx[C.normName(c.shortName)] = 1; });
    const missing = new Set();
    (items || []).forEach(it => {
      const raw = (it.customerName || "").trim(); if (!raw) return;
      const key = C.normName(raw);
      const exists = idx[key] || customers.some(c => (c.name || "").toLowerCase().includes(raw.toLowerCase()) || (c.shortName || "").toLowerCase() === raw.toLowerCase());
      if (!exists) missing.add(key);
    });
    return missing.size;
  };

  // shared bulk customer resolver: returns { get(rawName,country,pic,i), commit() }.
  // get() finds an existing customer by name/short-name or stages a new minimal profile;
  // commit() persists every staged new customer in ONE setExtras call (avoids stale-closure loss).
  const _custResolver = (defaultCountry, origin) => {
    let all = customers.slice();
    const nameIdx = {};
    all.forEach(c => { nameIdx[C.normName(c.name)] = c; if (c.shortName) nameIdx[C.normName(c.shortName)] = c; });
    const today = new Date().toISOString().slice(0, 10);
    const newCusts = [];
    const get = (rawName, country, pic, i) => {
      const key = C.normName(rawName);
      let cust = nameIdx[key] || all.find(c => (c.name || "").toLowerCase().includes(rawName.toLowerCase()) || (c.shortName || "").toLowerCase() === rawName.toLowerCase());
      if (!cust) {
        cust = {
          id: "CX" + Date.now().toString(36).toUpperCase() + i,
          name: rawName, bizId: "", shortName: "", city: "", district: "", address: "", type: "", leadSource: "",
          pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "",
          email: "", website: "", note: "", status: "",
          contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "",
          decisionMaker: false, companySizeEstimate: "",
          country: C.normCountry(country) || C.normCountry(defaultCountry) || "Thailand", owner: (pic || "").toUpperCase(), group: "A",
          funnel: "New", created: today, _origin: origin, _updated: NOW(),
        };
        newCusts.push(cust); all.push(cust); nameIdx[key] = cust;
      }
      return cust;
    };
    const commit = () => { if (newCusts.length) { const nx = [...extras, ...newCusts]; setExtras(nx); C.saveJSON(C.LS.extras, nx); syncRows("customers", newCusts); } return newCusts.length; };
    return { get, commit };
  };

  // bulk import: Samples. items: [{ customerName, country, pic, productCode, ink, width, length, qtySent, sentDate, courier, trackingNo, comparedAgainst, followUpDate, testStatus, feedbackNote }]
  const addSamplesBulk = (items) => {
    const r = _custResolver(null, "sample-import");
    const recs = items.map((it, i) => {
      const rawName = (it.customerName || "").trim();
      if (!rawName) return null;
      const cust = r.get(rawName, it.country, it.pic, i);
      return {
        id: "SMP-" + Date.now().toString(36).toUpperCase() + i,
        testStatus: it.testStatus || "Chưa phản hồi", feedbackDate: "", feedbackNote: it.feedbackNote || "",
        comparedAgainst: it.comparedAgainst || "", courier: it.courier || "", trackingNo: it.trackingNo || "",
        followUpDate: it.followUpDate || "", projectId: "", customerId: cust.id,
        productCode: it.productCode || "", ink: it.ink || "Wax",
        width: it.width || 0, length: it.length || 0, qtySent: it.qtySent || 1,
        sentDate: it.sentDate || new Date().toISOString().slice(0, 10),
        createdBy: user ? (user.salesCode || user.name) : "?", _updated: NOW(),
      };
    }).filter(Boolean);
    const created = r.commit();
    if (recs.length) { setSamples([...recs.reverse(), ...samples]); syncRows("samples", recs); }
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "sample", target: recs.length + " samples (import)", detail: created + " new customers" });
    return { imported: recs.length, created };
  };

  // bulk import: Projects. items carry parsed numeric value/pricePerSqm (already currency-converted).
  const addProjectsBulk = (items) => {
    const r = _custResolver(null, "project-import");
    const base = projects.length;
    const recs = items.map((it, i) => {
      const rawName = (it.customerName || "").trim();
      if (!rawName) return null;
      const cust = r.get(rawName, it.country, it.following, i);
      const me = user ? (user.salesCode || user.name) : "?";
      return {
        id: "P-" + String(2600 + base + 1 + i + Math.floor(Math.random() * 90)).padStart(4, "0"),
        customerId: cust.id, name: it.name || "(imported)", classification: it.classification || "New project",
        product: it.product || "", ink: it.ink || "Wax", width: it.width || 0, length: it.length || 0,
        qtyRolls: it.qtyRolls || 0, qtySqm: it.qtySqm || 0, pricePerSqm: it.pricePerSqm || 0, value: it.value || 0,
        // The figure AS ENTERED plus its unit. `value` stays canonical VND (every total, KPI
        // and forecast sums it), so the original is kept beside it instead of being lost.
        srcValue: (it.srcValue == null || it.srcValue === "") ? "" : it.srcValue, srcCurrency: it.srcCurrency || "",
        closeMonth: it.closeMonth || "", stage: it.stage || "Proposal", potential: it.potential || "Medium",
        probability: it.probability || 0, expectedCloseDate: it.expectedCloseDate || "",
        endCustomer: it.endCustomer || "", industry: it.industry || "", application: it.application || "",
        supplier: it.supplier || "", competitor: it.competitor || "", note: it.note || "",
        following: (it.following || "").toUpperCase() || me, createdBy: me,
        createdAt: new Date().toISOString().slice(0, 10), _updated: NOW(),
      };
    }).filter(Boolean);
    const created = r.commit();
    if (recs.length) { setProjects([...recs, ...projects]); syncRows("projects", recs); }
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "project", target: recs.length + " projects (import)", detail: created + " new customers" });
    return { imported: recs.length, created };
  };

  // bulk import: Quotations (one row = one quote with a single line item; unitPrice already currency-converted).
  const addQuotationsBulk = (items) => {
    const r = _custResolver(null, "quotation-import");
    const year = new Date().getFullYear();
    let maxN = quotations.map(q => { const m = (q.id || "").match(/QT-(\d{4})-(\d+)/); return (m && +m[1] === year) ? +m[2] : 0; }).reduce((a, b) => Math.max(a, b), 0);
    const today = new Date().toISOString().slice(0, 10);
    const recs = items.map((it, i) => {
      const rawName = (it.customerName || "").trim();
      if (!rawName) return null;
      const cust = r.get(rawName, it.country, it.pic, i);
      const id = (it.quoteNo || "").trim() || ("QT-" + year + "-" + String(++maxN).padStart(3, "0"));
      return {
        id, customerId: cust.id,
        items: [{ productCode: it.productCode || "", width: it.width || 0, length: it.length || 0, qty: it.qty || 0, unitPrice: it.unitPrice || 0, currency: it.currency || "VND" }],
        paymentTerms: it.paymentTerms || "T/T 30 days", revisionNo: 1, status: it.status || "Draft",
        approvedBy: "", projectId: "", quoteDate: it.quoteDate || today, validUntil: it.validUntil || "", _updated: NOW(),
      };
    }).filter(Boolean);
    const created = r.commit();
    if (recs.length) { setQuotations([...recs, ...quotations]); syncRows("quotations", recs); }
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "quote", target: recs.length + " quotations (import)", detail: created + " new customers" });
    return { imported: recs.length, created };
  };

  // Find an existing customer (dedup by Business ID, then name / short name) or create a new
  // profile. Always returns a customer ID so callers reference customers by ID, never by name.
  const findOrCreateCustomer = (data, origin) => {
    const name = (data.name || data.customerName || "").trim();
    if (!name) return null;
    const key = C.normName(name);
    const bid = (data.bizId || "").trim();
    const existing =
      (bid && customers.find(c => c.bizId && c.bizId.trim() === bid)) ||
      customers.find(c => C.normName(c.name) === key || (c.shortName && C.normName(c.shortName) === key)) ||
      customers.find(c => (c.name || "").toLowerCase().includes(name.toLowerCase()) || (c.shortName || "").toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const cust = {
      id: "CX" + Date.now().toString(36).toUpperCase(),
      name, bizId: bid, shortName: "", city: "", district: "", address: "", type: "", leadSource: "",
      pic: "", call: "", dept: "", title: "", phone: "", phone2: "", phone3: "",
      email: "", website: "", note: "", status: "",
      contactHistory: [], lastContactDate: "", nextActionDate: "", nextActionNote: "",
      decisionMaker: false, companySizeEstimate: "",
      country: data.country || "Thailand", owner: (data.owner || "").toUpperCase(), group: data.group || "A",
      funnel: "New", created: new Date().toISOString().slice(0, 10), _origin: origin || "auto", _updated: NOW(),
    };
    const next = [...extras, cust]; setExtras(next); C.saveJSON(C.LS.extras, next);
    syncRows("customers", cust);
    addActivity({ user: user ? (user.salesCode || user.name) : "?", action: "added", target: cust.name, detail: (origin || "auto") + " · auto-created" });
    return cust.id;
  };


  // ---- permission scoping ----
  // Admin / BOD sees everything. Treat the fixed BOD role id as boss even if a
  // custom role rename left roleOf() unable to resolve its scope.
  const isBoss = !!user && (roleOf(user).scope === "all" || user.role === "BOD");
  // Country manager: sees ALL sales reps' data within their assigned countries.
  const isCountryMgr = !!user && !isBoss && roleOf(user).scope === "country";
  const userCountries = (user && user.countries) || [];
  // An all-scope role sees every market, whatever its countries list says. A BOD account left
  // with countries:["Thailand"] by an earlier edit used to be silently narrowed to Thailand —
  // the country switch disappeared and the Vietnam data looked deleted.
  const seesAllCountries = isBoss || userCountries.includes("*");
  // Country permission matched on the CANONICAL name so a member permitted "Vietnam"
  // still sees records tagged "VN"/"việt nam" (and vice-versa). Without this, dirty
  // country values silently drop records out of a member's scope.
  const userCountriesN = userCountries.map(c => c === "*" ? "*" : C.normCountry(c));
  const inUserCountries = (country) => seesAllCountries || userCountriesN.includes(C.normCountry(country));
  // ids of every customer inside the manager's assigned countries (drives PO /
  // project / forecast scoping, which key off customerId rather than country).
  const countryCustIds = useMemo(() => {
    if (!isCountryMgr || seesAllCountries) return null;
    return new Set(customers.filter(c => inUserCountries(c.country)).map(c => c.id));
  }, [customers, isCountryMgr, seesAllCountries, userCountries.join(",")]);

  // ---- Members allowed (team delegation) ----
  // A manager can be granted a list of subordinate sales codes (user.members). The
  // manager then sees every record where a team member is the PIC/owner — in
  // addition to their own — and can assign those members as PIC on records.
  // Members must be REGISTERED sales accounts; unknown/stale codes grant nothing.
  const registeredSalesCodes = useMemo(
    () => new Set((users || []).filter(u => u.salesCode && !u._deleted).map(u => u.salesCode)),
    [users]
  );
  const allSalesCodes = useMemo(() => [...registeredSalesCodes].sort(), [registeredSalesCodes]);
  // A manager sees their own data PLUS the ENTIRE downline — not just the members
  // directly assigned to them, but those members' members too, recursively down the
  // reporting tree. We walk salesCode -> members breadth-first, guarding against
  // cycles, so any depth of hierarchy resolves to a flat set of visible codes.
  const teamCodes = useMemo(() => {
    if (!user || !user.salesCode) return user ? [] : [];
    const byCode = {};
    (users || []).forEach(u => { if (u.salesCode && !u._deleted) byCode[u.salesCode] = u; });
    const set = new Set([user.salesCode]);
    const queue = [user.salesCode];
    while (queue.length) {
      const u = byCode[queue.shift()];
      ((u && u.members) || []).forEach(code => {
        if (registeredSalesCodes.has(code) && !set.has(code)) { set.add(code); queue.push(code); }
      });
    }
    return [...set];
  }, [user, users, registeredSalesCodes]);
  const teamKey = teamCodes.join(",");
  // Codes a user may assign as PIC/owner: everyone (boss) or self + allowed members.
  const assignableCodes = isBoss ? allSalesCodes : teamCodes;
  // PIC/owner options that FOLLOW the Permissions tab: every active account (incl.
  // code-less admins like Thuy/Thao, keyed by name) — not just accounts with a sales
  // code. Each carries its country (targetCountry / countries[0]) and a `global` flag
  // (admins / all-country accounts) so they show for customers of ANY country.
  const assignablePics = useMemo(() => {
    // KPI country first; when it is unticked, fall back to the account's ASSIGNED
    // countries so a Thailand-only rep is never offered on a Vietnam/Indonesia record.
    const countryOf = (u) => C.kpiCountryOf(u) || C.normCountry(((u.countries || []).filter(x => x && x !== "*")[0]) || "");
    const isGlobal = (u) => !u.salesCode || (u.countries && u.countries.includes("*"));
    const actives = (users || []).filter(u => !u._deleted && u.active !== false && (u.salesCode || (u.name || "").trim()));
    const pool = isBoss ? actives : actives.filter(u => u.salesCode && teamCodes.includes(u.salesCode));
    const seen = new Set(); const out = [];
    pool.forEach(u => { const code = u.salesCode || (u.name || "").trim(); if (!code || seen.has(code)) return; seen.add(code); out.push({ code, country: countryOf(u), global: !!isGlobal(u) }); });
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }, [users, isBoss, teamKey]);
  // ---- KPI PIC roster -------------------------------------------------------
  // ONE list drives every PIC filter dropdown and the Targets grid: an account with a
  // KPI country ticked in Permissions shows up (under that country) even before it has
  // any data; untick the chip and it disappears from filters and Targets alike.
  const kpiPics = useMemo(() => {
    const seen = new Set(); const out = [];
    (users || []).forEach(u => {
      if (u._deleted || u.active === false) return;
      const country = C.kpiCountryOf(u);
      if (!country) return;
      const code = (u.salesCode || u.name || "").trim().toUpperCase();
      if (!code || seen.has(code)) return;
      seen.add(code); out.push({ code, country });
    });
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }, [users]);

  // For an own-scope sales rep: the set of customers they can touch. A customer
  // is "theirs" when it is assigned to them (owner) OR when a higher-up assigned
  // them to any record of that customer (project / PO / sample / quotation /
  // forecast) — being tagged on a record auto-grants the linked customer. With
  // Members Allowed, "them" expands to the whole team (self + allowed members).
  // Customer ids reachable through the rep's POs, resolved ON THE SERVER: RAM `pos` is only
  // a date window, so PO-based ownership has to be asked for explicitly or a rep whose
  // customers carry no `owner` sees nothing at all.
  const [picCustIds, setPicCustIds] = useState(null);
  useEffect(() => {
    let on = true;
    if (!user || isBoss || isCountryMgr || !teamKey) { setPicCustIds(null); return; }
    C.SB.custIdsForPics(teamCodes).then(ids => { if (on) setPicCustIds(new Set(ids)); }).catch(() => {});
    return () => { on = false; };
  }, [user && user.id, isBoss, isCountryMgr, teamKey]);

  const ownCustIds = useMemo(() => {
    if (!user || isBoss || isCountryMgr) return null;
    const norm = (v) => canonCode(v).toUpperCase();
    const codes = new Set(teamCodes.map(norm));
    const has = (v) => { const k = norm(v); return !!k && codes.has(k); };
    const ids = new Set();
    const byId = {}; customers.forEach(c => { byId[c.id] = c; });
    const okCountry = (cid) => { const c = byId[cid]; return !!c && inUserCountries(c.country); };
    customers.forEach(c => { if (has(c.owner) && inUserCountries(c.country)) ids.add(c.id); });
    projects.forEach(p => { if ((has(p.createdBy) || has(p.following)) && okCountry(p.customerId)) ids.add(p.customerId); });
    pos.forEach(p => { if (has(p.pic) && okCountry(p.customerId)) ids.add(p.customerId); });
    if (picCustIds) picCustIds.forEach(cid => { if (okCountry(cid)) ids.add(cid); });
    samples.forEach(s => { if (has(s.createdBy) && okCountry(s.customerId)) ids.add(s.customerId); });
    quotations.forEach(q => { if (has(q.createdBy) && okCountry(q.customerId)) ids.add(q.customerId); });
    forecast.forEach(f => { if (has(f.salesId) && okCountry(f.customerId)) ids.add(f.customerId); });
    return ids;
  }, [user, isBoss, isCountryMgr, seesAllCountries, userCountries.join(","), teamKey, customers, projects, pos, samples, quotations, forecast, picCustIds, canonCode]);

  // Markets this user may pick in the topbar country filter (only markets present in
  // their permitted data). A user who effectively sees one country has nothing to switch.
  const visibleCountries = useMemo(() => {
    const markets = (C.MARKETS || ["Vietnam", "Thailand"]);
    return seesAllCountries ? markets : markets.filter(c => inUserCountries(c));
  }, [seesAllCountries, userCountries.join(",")]);
  // PIC options for every tab's filter dropdown: the KPI roster narrowed to what this
  // account may see and to the active topbar country.
  const picFilterCodes = useMemo(() => {
    const team = new Set((teamCodes || []).map(x => String(x).toUpperCase()));
    const target = (countryFilter && countryFilter !== "All") ? C.normCountry(countryFilter) : "";
    return kpiPics
      .filter(p => isBoss || isCountryMgr ? inUserCountries(p.country) : team.has(p.code))
      .filter(p => !target || p.country === target)
      .map(p => p.code);
  }, [kpiPics, isBoss, isCountryMgr, teamKey, countryFilter, userCountries.join(","), seesAllCountries]);
  // Which market's PRICE LIST the product pickers use, in order:
  //   1. the topbar country filter, when one is chosen;
  //   2. the account's KPI country (Permissions → KPI country) — a rep assigned to
  //      Thailand prices in the Thai list without touching anything;
  //   3. the single market the account can see, if there is only one.
  // Admins (and accounts with no KPI country) get "" = every market, as before.
  const productCountry = useMemo(() => {
    const cf = C.normCountry(countryFilter || "");
    if (cf && cf !== "All") return cf;
    if (isBoss) return "";
    const kpi = C.normCountry(C.kpiCountryOf(user) || "");
    if (kpi) return kpi;
    return visibleCountries.length === 1 ? visibleCountries[0] : "";
  }, [countryFilter, isBoss, user, visibleCountries.join(",")]);
  // Drop an invalid selection (a market this user can't see) back to "All".
  useEffect(() => {
    if (countryFilter !== "All" && !visibleCountries.includes(C.normCountry(countryFilter))) setCountryFilterState("All");
  }, [visibleCountries.join(","), countryFilter]);
  // Customer ids matching the active country filter (null = All → no restriction). Every
  // scope selector intersects with this, so ONE switch filters every tab at once.
  const countryFilterCustIds = useMemo(() => {
    if (!countryFilter || countryFilter === "All") return null;
    const target = C.normCountry(countryFilter);
    return new Set(customers.filter(c => C.normCountry(c.country) === target).map(c => c.id));
  }, [customers, countryFilter]);

  const scopeCustomers = useMemo(() => {
    if (!user) return [];
    let base;
    if (isBoss) base = customers;
    else if (isCountryMgr) base = seesAllCountries ? customers : customers.filter(c => inUserCountries(c.country));
    else base = customers.filter(c => ownCustIds && ownCustIds.has(c.id));
    return countryFilterCustIds ? base.filter(c => countryFilterCustIds.has(c.id)) : base;
  }, [customers, user, isBoss, isCountryMgr, seesAllCountries, userCountries.join(","), ownCustIds, countryFilterCustIds]);
  const scopeProjects = useMemo(() => {
    if (!user) return [];
    let live = projects.filter(p => !p._deleted);
    if (!isBoss) {
      if (isCountryMgr) live = countryCustIds ? live.filter(p => countryCustIds.has(p.customerId)) : live;
      else live = live.filter(p => teamCodes.includes(p.createdBy) || teamCodes.includes(p.following) || (ownCustIds && ownCustIds.has(p.customerId)));
    }
    return countryFilterCustIds ? live.filter(p => countryFilterCustIds.has(p.customerId)) : live;
  }, [projects, user, isBoss, isCountryMgr, countryCustIds, ownCustIds, teamKey, countryFilterCustIds]);
  const scopePOs = useMemo(() => {
    if (!user) return [];
    let base;
    if (isBoss) base = posLinked;
    else if (isCountryMgr) base = countryCustIds ? posLinked.filter(p => countryCustIds.has(p.customerId)) : posLinked;
    else base = posLinked.filter(p => teamCodes.includes(p.pic) || (ownCustIds && ownCustIds.has(p.customerId)));
    return countryFilterCustIds ? base.filter(p => countryFilterCustIds.has(p.customerId)) : base;
  }, [posLinked, user, isBoss, isCountryMgr, countryCustIds, ownCustIds, teamKey, countryFilterCustIds]);
  const scopeForecast = useMemo(() => {
    if (!user) return [];
    let live = forecast.filter(f => !f._deleted);
    if (!isBoss) {
      if (isCountryMgr) live = countryCustIds ? live.filter(f => countryCustIds.has(f.customerId)) : live;
      else live = live.filter(f => teamCodes.includes(f.salesId) || (ownCustIds && ownCustIds.has(f.customerId)));
    }
    return countryFilterCustIds ? live.filter(f => countryFilterCustIds.has(f.customerId)) : live;
  }, [forecast, user, isBoss, isCountryMgr, countryCustIds, ownCustIds, teamKey, countryFilterCustIds]);
  // An all-scope role sees every module, including Permissions. Otherwise an admin whose
  // module list was trimmed by an earlier edit loses the very tab needed to fix it.
  const canSee = (mod) => !!user && (isBoss || (user.modules || []).includes(mod));
  const canEdit = (mod) => !!user && (isBoss || (user.editModules ? user.editModules.includes(mod) : (user.modules || []).includes(mod)));
  // Delete is a permission distinct from edit. If an account has no explicit
  // deleteModules list yet, it falls back to its edit permissions (legacy behavior).
  const canDelete = (mod) => !!user && (isBoss || (user.deleteModules ? user.deleteModules.includes(mod) : (user.editModules ? user.editModules.includes(mod) : (user.modules || []).includes(mod))));
  const canExport = (mod) => !!user && (isBoss || (user.exportModules ? user.exportModules.includes(mod) : (user.modules || []).includes(mod)));
  // Deleting a customer REALLY removes the record from the `extras` blob and pushes
  // the smaller blob to Supabase ("customers"), exactly like every other tab removes
  // from its own array. All 2350 customers live in `extras` (window.CRM_CUSTOMERS is
  // empty), so this is the whole dataset. We also drop any leftover edit-override for
  // the removed ids. Only a hardcoded seed id (not present in extras) still needs a
  // _deleted tombstone as a fallback — none exist today, but it keeps this robust.
  const deleteCustomers = (ids) => {
    const s = new Set(ids);
    const inExtras = new Set(extras.map(c => c.id));
    // Soft-delete: tombstone the record (kept in the blob, hidden by the customers
    // filter) with a fresh _updated. The Supabase merge keeps the newest write per id,
    // so the deletion propagates to every user and is never resurrected by a stale copy.
    const nextExtras = extras.map(c => s.has(c.id) ? { ...c, _deleted: true, _updated: NOW() } : c);
    setExtras(nextExtras); C.saveJSON(C.LS.extras, nextExtras);
    // Persist the tombstones like any edit, or the delete stays in this browser only.
    const gone = nextExtras.filter(c => s.has(c.id));
    if (gone.length) syncRows("customers", gone);
    const seedIds = ids.filter(id => !inExtras.has(id));
    if (seedIds.length) setOverrides(o => { const n = { ...o }; seedIds.forEach(id => { n[id] = { ...(n[id] || {}), _deleted: true }; }); C.saveJSON(C.LS.custOverrides, n); return n; });
  };
  const deleteCustomer = (id) => deleteCustomers([id]);
  // Bulk edit: ONE patch applied to many customers in a single write. Only the fields the
  // user ticked are in `patch`, so nothing else on the record is touched.
  const updateCustomers = (ids, patch, actName) => {
    const s = new Set(ids || []);
    if (!s.size || !patch || !Object.keys(patch).length) return 0;
    const stamp = { _updated: NOW(), _updatedBy: user ? (user.salesCode || user.name) : "?" };
    const inExtras = new Set(extras.map(c => c.id));
    const nextExtras = extras.map(c => s.has(c.id) ? { ...c, ...(overrides[c.id] || {}), ...patch, ...stamp } : c);
    setExtras(nextExtras); C.saveJSON(C.LS.extras, nextExtras);
    const touched = nextExtras.filter(c => s.has(c.id));
    if (touched.length) syncRows("customers", touched);
    // Seed-only ids keep using the override blob; patched extras drop their stale override.
    const no = { ...overrides };
    let dirty = false;
    [...s].forEach(id => {
      if (inExtras.has(id)) { if (no[id]) { delete no[id]; dirty = true; } }
      else { no[id] = { ...(no[id] || {}), ...patch, ...stamp }; dirty = true; }
    });
    if (dirty) { setOverrides(no); C.saveJSON(C.LS.custOverrides, no); }
    addActivity({ user: stamp._updatedBy, action: "status", target: s.size + " customers", detail: actName || "Bulk edit" });
    return touched.length;
  };
  // Deletes are SOFT (tombstone {_deleted:true} + fresh _updated) instead of removing
  // from the array, so a delete survives the merge with other users' data and does not
  // get resurrected. Display selectors filter out tombstones.
  const deleteProject = (id) => { let up = null; setProjects(projects.map(p => p.id === id ? (up = { ...p, _deleted: true, _updated: NOW() }) : p)); if (up) syncRows("projects", up); };
  const deleteSample = (id) => { let up = null; setSamples(samples.map(s => s.id === id ? (up = { ...s, _deleted: true, _updated: NOW() }) : s)); if (up) syncRows("samples", up); };
  const deleteQuotation = (id) => { let up = null; setQuotations(quotations.map(q => q.id === id ? (up = { ...q, _deleted: true, _updated: NOW() }) : q)); if (up) syncRows("quotations", up); };
  const deletePO = (id) => { let d = null; const next = pos.map(p => { if (p.id === id) { d = { ...p, _deleted: true, _updated: NOW(), _updatedBy: WHO() }; return d; } return p; }); setPos(next); if (d) syncPos(d); };
  // ---- one-time maintenance: backfill unit price + roll price on existing POs -------
  // Legacy POs (and everything imported before the price model landed) carry a value and
  // a qty but no usable unitPrice/rollPrice. Solve both backwards from what IS known and
  // One-off repair of PO rows written before product identity was fixed: the "Product
  // Type" (FR/JR) and "Grade" (Resin/Wax) columns had been stored AS the product name, so
  // one physical order line landed several times under different names. This
  //   1. strips those tokens out of every name field (identity = product code only), and
  //   2. tombstones the leftover duplicates (same customer + PO + code + size + qty).
  // Walks the WHOLE table, not just the RAM slice.
  const cleanupPODuplicates = async (onProgress, opts = {}) => {
    const all = await C.SB.getRows("pos", onProgress ? (n) => onProgress({ phase: "read", n }) : undefined);
    if (!Array.isArray(all)) return { scanned: 0, fixed: 0, removed: 0 };
    const live = all.filter(p => p && !p._deleted);
    const codeOf = (p) => {
      const it = (Array.isArray(p.items) && p.items[0]) || {};
      return (C.cleanCode(p.structureCode) || C.cleanCode(it.structureCode) || C.cleanCode(it.sku)
        || C.cleanCode(p.commercial) || C.cleanCode(p.materialName) || "").toUpperCase();
    };
    // 1 — identity repair. The product code IS the identity, so commercial / materialName
    // are forced to agree with it — not only when they hold a type/grade token ("FR",
    // "Resin") but also when they hold a DIFFERENT code left over from an older import.
    const repaired = new Map();   // id → patched record
    live.forEach(p => {
      const it0 = (Array.isArray(p.items) && p.items[0]) || {};
      const code = C.cleanCode(p.structureCode) || C.cleanCode(it0.structureCode) || C.cleanCode(it0.sku) || C.cleanCode(p.commercial) || C.cleanCode(p.materialName) || "";
      const base = C.baseCode(code);
      const next = { ...p };
      let dirty = false;
      const setF = (k, v) => { if ((p[k] || "") !== v) { next[k] = v; dirty = true; } };
      if (code) { setF("structureCode", code); setF("commercial", code); setF("materialName", base); }
      else { setF("commercial", C.cleanCode(p.commercial)); setF("materialName", C.cleanCode(p.materialName)); setF("structureCode", C.cleanCode(p.structureCode)); }
      if (Array.isArray(p.items) && p.items.length) {
        let idirty = false;
        const items = p.items.map(it => {
          const sc = C.cleanCode(it.structureCode) || C.cleanCode(it.sku) || code;
          const pc = C.baseCode(sc);
          if (sc === (it.structureCode || "") && sc === (it.sku || "") && pc === (it.productCode || "")) return it;
          idirty = true;
          return { ...it, structureCode: sc, sku: sc, productCode: pc };
        });
        if (idirty) { next.items = items; dirty = true; }
      }
      if (dirty) { next._updated = NOW(); next._updatedBy = WHO() + " · " + "repair names"; repaired.set(String(p.id), next); }
    });
    // 2 — collapse duplicate lines. OFF by default: the Sage source itself legitimately
    // repeats identical lines (595 of them), so "same PO + code + size + qty + value" is
    // NOT proof of a bad row. Removing the real leftovers is the re-import's job — it
    // matches file rows to stored rows one-for-one and tombstones only the surplus.
    const score = (r) => {
      const sc = C.cleanCode(r.structureCode);
      let s = 0;
      if (sc) s += 4;
      if (sc && C.cleanCode(r.commercial) === sc) s += 2;
      if (sc && C.cleanCode(r.materialName) === C.baseCode(sc)) s += 1;
      if (Array.isArray(r.items) && r.items.length) s += 1;
      return s;
    };
    const groups = new Map();
    if (opts.deleteDupes) live.forEach(p => {
      const po = String(p.poNumber == null ? "" : p.poNumber).trim();
      if (!po) return;
      const key = [p.customerId || "", po, codeOf(p), p.width || 0, p.length || 0, p.qty || 0, p.amountVnd || 0].join("|");
      (groups.get(key) || groups.set(key, []).get(key)).push(p);
    });
    const tombs = [];
    groups.forEach(list => {
      if (list.length < 2) return;
      let keep = list[0];
      list.forEach(r => { if (score(r) > score(keep)) keep = r; });
      list.forEach(r => { if (r !== keep) tombs.push({ ...(repaired.get(String(r.id)) || r), _deleted: true, _updated: NOW(), _updatedBy: WHO() + " · repair names" }); });
    });
    const tombIds = new Set(tombs.map(x => String(x.id)));
    const fixes = [...repaired.values()].filter(r => !tombIds.has(String(r.id)));
    if (opts.dryRun) return { scanned: live.length, fixed: fixes.length, removed: tombs.length, dryRun: true };
    const writes = [...fixes, ...tombs];
    for (let i = 0; i < writes.length; i += 500) {
      await C.SB.putRows("pos", writes.slice(i, i + 500));
      if (onProgress) onProgress({ phase: "write", n: Math.min(i + 500, writes.length), total: writes.length });
    }
    if (writes.length) {
      const byId = new Map(writes.map(r => [String(r.id), r]));
      setPos(prev => prev.map(p => byId.get(String(p.id)) || p));
    }
    return { scanned: live.length, fixed: fixes.length, removed: tombs.length };
  };

  // push every patched row to Supabase, so the numbers exist for every account, not just
  // this browser. Walks the WHOLE table (not the RAM slice) in pages.
  const backfillPOPrices = async (onProgress) => {
    const all = await C.SB.getRows("pos", onProgress ? (n) => onProgress({ phase: "read", n }) : undefined);
    if (!Array.isArray(all)) return { scanned: 0, patched: 0 };
    const patched = [];
    all.forEach(p => {
      if (!p || p._deleted) return;
      const recArea = C.rollArea(p);
      const recQty = parseFloat(p.qty) || 0;
      const recAmt = parseFloat(p.amountVnd) || 0;
      let dirty = false;
      const next = { ...p };
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.map(it => {
          const area = C.rollArea(it) || recArea;
          const qty = parseFloat(it.qty) || recQty;
          const amt = parseFloat(it.amountVnd) || 0;
          // Value + qty are the trusted figures; a stored price is only used when there
          // is no value to solve from.
          const pr = C.poPricing({ unitPrice: amt ? 0 : (it.unitPrice || it.price), rollPrice: 0, amount: amt, qty, areaRoll: area });
          if (!pr.rollPrice && !pr.unitPrice) return it;
          const up = Math.round(pr.unitPrice * 100) / 100, rp = Math.round(pr.rollPrice);
          if (+it.unitPrice === up && +it.rollPrice === rp && +it.price === up) return it;
          dirty = true;
          return { ...it, price: up, unitPrice: up, rollPrice: rp, sqmPerRoll: it.sqmPerRoll || (area || "") };
        });
        if (dirty) next.items = items;
      }
      const rec = C.poPricing({ unitPrice: recAmt ? 0 : p.unitPrice, rollPrice: 0, amount: recAmt, qty: recQty, areaRoll: recArea });
      const rUp = Math.round(rec.unitPrice * 100) / 100, rRp = Math.round(rec.rollPrice);
      if ((rUp || rRp) && (+p.unitPrice !== rUp || +p.rollPrice !== rRp)) { next.unitPrice = rUp; next.rollPrice = rRp; dirty = true; }
      if (dirty) { next._updated = NOW(); next._updatedBy = WHO() + " · fix prices"; patched.push(next); }
    });
    // Push in batches; putRows already chunks + retries.
    for (let i = 0; i < patched.length; i += 500) {
      await C.SB.putRows("pos", patched.slice(i, i + 500));
      if (onProgress) onProgress({ phase: "write", n: Math.min(i + 500, patched.length), total: patched.length });
    }
    // Reflect the change in the rows already in RAM so the UI updates without a reload.
    if (patched.length) {
      const byId = new Map(patched.map(r => [String(r.id), r]));
      setPos(prev => prev.map(p => byId.get(String(p.id)) || p));
    }
    return { scanned: all.length, patched: patched.length };
  };

  // ---- one-time repair: 2025 rows whose Qty column received the m² figure ----
  // Those imports mapped the area column into "Qty (rolls)", and sqm was then derived as
  // qty × roll area — so one line reads 306,579 rolls and 4.74 BILLION m² at 2 đ/m², while
  // 2026 (qty = real rolls) reads 1,650 đ/m². The repair restores the 2026 meaning:
  // sqm = the figure that was put in Qty, qty = that area ÷ roll area.
  // Gate: sqm must equal qty × roll area (so it really was derived that way) AND the implied
  // price must be absurd (< 50 đ/m²). After the rewrite the price is back in the normal band,
  // so the row can never match again — the pass is idempotent and never touches a good row.
  const SQM_PRICE_FLOOR = 50;
  const repairPOSqm = async (onProgress) => {
    const all = await C.SB.getRows("pos", onProgress ? (n) => onProgress({ phase: "read", n }) : undefined);
    if (!Array.isArray(all)) return { scanned: 0, patched: 0 };
    const patched = [];
    all.forEach(p => {
      if (!p || p._deleted) return;
      const w = parseFloat(p.width) || 0, len = parseFloat(p.length) || 0;
      const qty = parseFloat(p.qty) || 0, sqm = parseFloat(p.sqm) || 0, amt = Math.abs(parseFloat(p.amountVnd) || 0);
      const rollArea = w / 1000 * len;
      if (!(rollArea > 0 && qty > 0 && sqm > 0 && amt > 0)) return;
      if (Math.abs(sqm / (rollArea * qty) - 1) > 0.01) return;   // sqm not derived from qty
      if (amt / sqm >= SQM_PRICE_FLOOR) return;                   // price already sane
      const newSqm = Math.round(qty);
      const newQty = Math.round(qty / rollArea * 100) / 100;
      if (!(newSqm > 0 && newQty > 0) || amt / newSqm < SQM_PRICE_FLOOR) return;
      const next = { ...p, sqm: newSqm, qty: newQty, _updated: NOW(), _updatedBy: WHO() + " · fix qty/sqm" };
      if (Array.isArray(p.items) && p.items.length === 1) {
        next.items = [{ ...p.items[0], qty: newQty, sqmPerRoll: p.items[0].sqmPerRoll || Math.round(rollArea) }];
      }
      patched.push(next);
    });
    for (let i = 0; i < patched.length; i += 500) {
      await C.SB.putRows("pos", patched.slice(i, i + 500));
      if (onProgress) onProgress({ phase: "write", n: Math.min(i + 500, patched.length), total: patched.length });
    }
    if (patched.length) {
      const byId = new Map(patched.map(r => [String(r.id), r]));
      setPos(prev => prev.map(x => byId.get(String(x.id)) || x));
      if (C.SB.clearAggCache) C.SB.clearAggCache();
    }
    return { scanned: all.length, patched: patched.length };
  };
  // Runs itself once per browser as soon as an account is signed in — historical data with
  // one correct answer, so there is nothing for the user to decide and no button to press.
  const sqmFixRan = React.useRef(false);
  useEffect(() => {
    if (!user || sqmFixRan.current) return;
    if (C.loadJSON(C.LS.sqmFix, 0)) { sqmFixRan.current = true; return; }
    sqmFixRan.current = true;
    let on = true;
    (async () => {
      try {
        const r = await repairPOSqm();
        if (!on) return;
        C.saveJSON(C.LS.sqmFix, 1);
        if (r.patched) {
          console.info("[CRM] qty/sqm repair: " + r.patched + " of " + r.scanned + " PO rows rewritten");
          addActivity({ user: user.salesCode || user.name, action: "po", target: r.patched + " PO rows", detail: "qty/sqm repaired (area was in the Qty column)" });
        }
      } catch (e) { sqmFixRan.current = false; }
    })();
    return () => { on = false; };
  }, [user]);

  // ---- bulk deletes (soft) ----
  const deleteProjects = (ids) => { const s = new Set(ids); const chg = []; setProjects(projects.map(p => s.has(p.id) ? (chg.push(p = { ...p, _deleted: true, _updated: NOW() }), p) : p)); if (chg.length) syncRows("projects", chg); };
  const deleteSamples = (ids) => { const s = new Set(ids); const chg = []; setSamples(samples.map(x => s.has(x.id) ? (chg.push(x = { ...x, _deleted: true, _updated: NOW() }), x) : x)); if (chg.length) syncRows("samples", chg); };
  const deleteQuotations = (ids) => { const s = new Set(ids); const chg = []; setQuotations(quotations.map(x => s.has(x.id) ? (chg.push(x = { ...x, _deleted: true, _updated: NOW() }), x) : x)); if (chg.length) syncRows("quotations", chg); };
  const deletePOs = (ids) => { const s = new Set(ids); const changed = []; const next = pos.map(p => { if (s.has(p.id)) { const d = { ...p, _deleted: true, _updated: NOW(), _updatedBy: WHO() }; changed.push(d); return d; } return p; }); setPos(next); syncPos(changed); };
  // Delete by FULL RECORDS (from the server working set), not by scanning the RAM slice —
  // so a selected PO that isn't currently in memory still gets tombstoned + synced. This
  // is what keeps FE and BE in sync at scale: exactly the selected rows are deleted.
  const deletePORecords = (records) => {
    const recs = (Array.isArray(records) ? records : [records]).filter(r => r && r.id != null);
    if (!recs.length) return;
    const tomb = recs.map(r => ({ ...r, _deleted: true, _updated: NOW(), _updatedBy: WHO() }));
    const byId = {}; tomb.forEach(x => byId[x.id] = x);
    setPos(pos.map(p => byId[p.id] || p));  // reflect any that are in RAM
    syncPos(tomb);                          // authoritative per-row write for ALL selected
  };
  const deleteProducts = (ids) => { const s = new Set(ids); setProducts(products.map(x => s.has(x.id) ? { ...x, _deleted: true, _updated: NOW() } : x)); };

  // Tombstone-filtered views exposed to the UI (raw arrays keep tombstones for the
  // merge/persist layer; the app only ever sees live records).
  const projectsLive = useMemo(() => projects.filter(p => !p._deleted), [projects]);
  const samplesLive = useMemo(() => samples.filter(s => !s._deleted), [samples]);
  const quotationsLive = useMemo(() => quotations.filter(q => !q._deleted), [quotations]);
  const productsLive = useMemo(() => products.filter(p => !p._deleted), [products]);
  const forecastLive = useMemo(() => forecast.filter(f => !f._deleted), [forecast]);

  const value = {
    t, lang, setLang, users, setUsers, updateUser, usersSynced, roles, setRoles, rolesRemote, rolesLocalOnly, rolesSave, roleOf,
    customers, projects: projectsLive, activity, addActivity,
    user, authReady, isBoss, isCountryMgr, teamCodes, assignableCodes, assignablePics, allSalesCodes, login, logout, updateCustomer, updateStatus, moveToStage, addCustomer, addCustomersBulk, addContactLog,
    logs, addLog, logsFor,
    addProject, updateProject, scopeCustomers, scopeProjects, canSee, canEdit, canDelete, canExport, tweaks, canonCode,
    findOrCreateCustomer,
    deleteCustomer, deleteProject, deleteSample, deleteQuotation, deletePO, deletePORecords,
    deleteCustomers, deleteProjects, deleteSamples, deleteQuotations, deletePOs, deleteProducts, updateCustomers,
    calendarConnected, toggleCalendar,
    products: productsLive, addProduct, updateProductItem, deleteProduct, replaceProducts: setProducts,
    pos: posLinked, posLoad, addPO, addPOsBulk, countNewPOCustomers, updatePO, scopePOs,
    addProjectsBulk, addSamplesBulk, addQuotationsBulk,
    targets, setTargets, setTarget,
    targetGroups, setTargetGroups, setTargetGroup, repCountry,
    targetCust, setTargetCustMonth, setTargetCustField, setTargetCustBulk, deleteTargetCustYear, deleteTargetCustRows, deleteTargetGroupRows, normalizeTargetCustPics,
    currency, setCurrency, money,
    countryFilter, setCountryFilter, dateRange, setDateRange, dateRangeR, visibleCountries, productCountry, kpiPics, picFilterCodes, backfillPOPrices, repairPOSqm, cleanupPODuplicates,
    samples: samplesLive, addSample, updateSample, samplesFor,
    quotations: quotationsLive, addQuotation, updateQuotation, quotationsFor, nextQuoteNo,
    reorderRows, setReorderAction,
    forecast: forecastLive, upsertForecast, deleteForecast, forecastFor, scopeForecast,
    skuForecast, saveSkuCell, saveSkuMeta, deleteSkuRow,
    retentionRows, retMonthAgg, parentMap,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/* ---------- Shared UI ---------- */
// Export dropdown: lets the user export ALL rows, the current FILTER, or just the current PAGE.
// `map` turns a raw item into a flat object for CSV. Pass arrays of raw items for each scope.
function ExportMenu({ name, map, all, filtered, page }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);
  const run = (rows) => { setOpen(false); window.exportCSV(name, (rows || []).map(map)); };
  const showPage = page && filtered && page.length < filtered.length;
  const isFiltered = filtered && all && filtered.length !== all.length;
  return (
    <div className="export-menu" ref={ref}>
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}>
        <Icon d={ICONS.download} size={15} /> {t("export")} <span className="export-caret">▾</span>
      </button>
      {open && (
        <div className="export-pop">
          <button className="export-opt" onClick={() => run(all)}>
            <span>{t("export_all")}</span><span className="export-count">{all ? all.length : 0}</span>
          </button>
          {isFiltered && (
            <button className="export-opt" onClick={() => run(filtered)}>
              <span>{t("export_filtered")}</span><span className="export-count">{filtered.length}</span>
            </button>
          )}
          {showPage && (
            <button className="export-opt" onClick={() => run(page)}>
              <span>{t("export_page")}</span><span className="export-count">{page.length}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
// "More ⋯" menu at the right of a list page's header actions: holds the maintenance /
// admin actions (items: { key, label, icon, onClick, title, disabled, danger }; falsy
// items are skipped). `busy` replaces the button label while one of them is running.
function MoreMenu({ items, busy }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="more-menu" ref={ref}>
      <button className={"btn btn-ghost" + (busy ? " btn-filter-active" : "")} title={t("more_actions")} onClick={() => setOpen(o => !o)}>
        <Icon d={ICONS.more} size={15} /> {busy || t("more")} <span className="export-caret">▾</span>
      </button>
      {open && (
        <div className="more-pop">
          {list.map(it => (
            <button key={it.key} className={"more-opt" + (it.danger ? " danger" : "")} title={it.title} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <Icon d={it.icon} size={14} />}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function StageBadge({ stage, t }) {
  const color = C.STAGE_COLORS[stage] || "#94A3B8";
  return (
    <span className="badge" style={{ color, background: color + "1A", borderColor: color + "40" }}>
      <span className="badge-dot" style={{ background: color }}></span>
      {t(C.STAGE_KEY[stage]) || stage}
    </span>
  );
}
function ProjStageBadge({ stage, t }) {
  const color = C.PROJECT_STAGE_COLORS[stage] || "#94A3B8";
  return (
    <span className="badge" style={{ color, background: color + "1A", borderColor: color + "40" }}>
      <span className="badge-dot" style={{ background: color }}></span>
      {t("st_" + stage)}
    </span>
  );
}
function Avatar({ name, size = 32, color, src }) {
  if (src) return <img className="avatar avatar-img" src={src} alt="" style={{ width: size, height: size }} />;
  const initials = (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: color || "var(--teal-soft)", color: "var(--teal-dark)" }}>
      {initials}
    </span>
  );
}
function OwnerChip({ code, t }) {
  const app = useContext(AppCtx);
  if (!code) return <span className="owner-chip owner-none">{t("unassigned")}</span>;
  const cc = String(code).trim().toUpperCase();
  const u = app && app.users.find(x => !x._deleted && ((x.salesCode || "").toUpperCase() === cc || (x.name || "").toUpperCase() === cc));
  if (!u) return <span className="owner-chip owner-nouser" title={t("owner_no_user")}>{code} <small>· {t("owner_no_user")}</small></span>;
  return <span className="owner-chip"><Avatar name={u.name} size={18} src={u.photo} />{u.name}</span>;
}
function GroupBadge({ group }) {
  // Match on the group id, but tolerate full labels stored from imports
  // ("A - Big & Regular", "D– Repeat Order", "DE – Repeat & New"…) by normalising to the
  // GROUPS id (multi-letter aware), so a labelled or two-letter group still renders.
  const gid = C.normGroup(group);
  const g = C.GROUPS.find(x => x.id === group) || C.GROUPS.find(x => x.id === gid);
  if (!g) return <span className="dim">—</span>;
  return (
    <span className="badge" style={{ color: g.color, background: g.color + "14", borderColor: g.color + "40" }}>
      <span className="badge-dot" style={{ background: g.color }}></span>
      {g.label}
    </span>
  );
}
function Modal({ title, onClose, children, width = 560 }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children, required }) {
  return (
    <label className="field">
      <span className="field-label">{label}{required ? <em> *</em> : null}</span>
      {children}
    </label>
  );
}
// ---- Reusable product line items (multi-SKU with auto-lookup + totals) ----
// Each row picks a SKU from the Products tab; width/length/grade/type/sqm-per-roll
// PRICING MODEL (roll-based):
//   Unit price is entered per SQM (Products tab only). Roll price =
//   Unit price × area/roll, area = sqmPerRoll (fallback width(mm)/1000 × length(m)).
//   A line's value = Roll price × qty(rolls). The number after the last "_" in the
//   structure code (lineTierQty) is the MOQ / price tier — a label only.
function lineTierQty(it) {
  const s = String((it && (it.structureCode || it.sku)) || "");
  const m = s.match(/_(\d+)\s*$/);
  let n = m ? parseInt(m[1], 10) : 0;
  if (!n && it) n = parseFloat(it.tierQty) || parseFloat(it.moq) || 0;
  return n > 0 ? n : 0;
}
// sqm of one roll: stored sqmPerRoll, else width(mm)/1000 × length(m).
function lineAreaPerRoll(it) {
  const spr = parseFloat(it && it.sqmPerRoll) || 0;
  if (spr > 0) return spr;
  const w = parseFloat(it && it.width) || 0, l = parseFloat(it && it.length) || 0;
  return (w / 1000) * l;
}
// Unit price = price per sqm (accepts `price` or `unitPrice`).
function lineUnitPrice(it) {
  const raw = (it && it.price != null && it.price !== "") ? it.price : (it && it.unitPrice);
  return parseFloat(raw) || 0;
}
// Roll price = unit price (per sqm) × area per roll. An explicit `rollPrice` typed on
// the line overrides the derived figure (the sale may negotiate a per-roll price).
function lineRollPrice(it) {
  const override = parseFloat(it && it.rollPrice);
  if (!isNaN(override) && override > 0) return override;
  return lineUnitPrice(it) * lineAreaPerRoll(it);
}
// Per-roll effective price (name kept for callers) = Roll price.
function lineEffUnitPrice(it) { return lineRollPrice(it); }
function lineValueEff(it) {
  return Math.round((parseFloat(it && it.qty) || 0) * lineRollPrice(it));
}
function lineItemTotals(items) {
  let qty = 0, sqm = 0, value = 0;
  (items || []).forEach(it => {
    const q = parseFloat(it.qty) || 0;
    sqm += lineAreaPerRoll(it) * q;
    qty += q; value += lineRollPrice(it) * q;
  });
  return { qty, sqm: Math.round(sqm), value: Math.round(value) };
}
// Searchable SKU picker: a text input with a white dropdown list. Users TYPE to
// filter products by name / code / grade / EDP; click or Enter selects one.
// onPick(text, product|null) fires on selection or free-text edit.
function SkuInput({ products, value, onPick, placeholder }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = React.useRef(null);
  const text = open ? q : (value || "");
  const filtered = React.useMemo(() => {
    const base = products || [];
    const needle = (open ? q : "").trim().toLowerCase();
    const arr = needle
      ? base.filter(p => (p.name + " " + (p.code || "") + " " + (p.grade || "") + " " + (p.itmref || "")).toLowerCase().includes(needle))
      : base;
    return arr.slice(0, 60);
  }, [q, open, products]);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const choose = (p) => { onPick(p.name, p); setQ(""); setOpen(false); };
  return (
    <div className="sku-combo" ref={wrapRef}>
      <input className="input" value={text} placeholder={placeholder || "Gõ để tìm SKU…"}
        onFocus={() => { setQ(value || ""); setHi(0); setOpen(true); }}
        onChange={e => {
          const v = e.target.value;
          setQ(v); setHi(0); setOpen(true);
          onPick(v, (products || []).find(x => x.name === v || x.code === v) || null);
        }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { if (open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); } }
          else if (e.key === "Escape") { setOpen(false); }
        }} />
      {open && (
        <div className="sku-pop">
          {filtered.length === 0 && <div className="sku-empty">Không tìm thấy SKU</div>}
          {filtered.map((p, i) => (
            <button type="button" key={p.id} className={"sku-opt" + (i === hi ? " hi" : "")}
              onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(p); }}>
              <span className="sku-opt-name">{p.name}</span>
              {p.grade && <span className="sku-opt-grade">{p.grade}</span>}
              {p.productType && <span className="sku-opt-grade" style={{ background: "#EEF2F6", color: "var(--muted)" }}>{p.productType}</span>}
              {p.itmref && <span className="sku-opt-edp">{p.itmref}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// ---- Product Code (Mã SP) → Structure Code cascade helpers ----
// Each product record in the catalogue is ONE structure variant. Records that
// share a Product Code (`code`) are the structure options under that code.
function pcOf(p) { return ((p.code || p.name) || "").toString().trim(); }
// The catalogue is COUNTRY-SCOPED: the same code exists once per market with its own price
// and currency, so every picker and every lookup must name a country. An unscoped lookup is
// what let Thai orders inherit Vietnamese prices.
function catalogueFor(products, country) {
  const c = C.normCountry(country || "");
  return c ? (products || []).filter(p => C.normCountry(p.country || "") === c) : (products || []);
}
function structLabel(p) { return (p.eccshoaxx || p.name || "").toString().trim() || "—"; }
function productCodeGroups(products) {
  const m = new Map();
  (products || []).forEach(p => {
    const code = pcOf(p); if (!code) return;
    if (!m.has(code)) m.set(code, { code, variants: [] });
    m.get(code).variants.push(p);
  });
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}
function variantsForCode(products, code) {
  const c = (code || "").toString().trim();
  return c ? (products || []).filter(p => pcOf(p) === c) : [];
}
// Fields a picked structure contributes to a line item.
function structFields(p) {
  const ecc = String(p.eccshoaxx || p.name || "").trim();
  const tm = ecc.match(/_(\d+)\s*$/);
  const patch = {
    productId: p.id, structureCode: structLabel(p), sku: structLabel(p),
    edpCode: p.itmref || "", width: p.width ?? "", length: p.length ?? "", sqmPerRoll: p.sqmPerRoll ?? "",
    price: (p.price != null && p.price !== "") ? p.price : "",
    rollPrice: "",
    // Persist the price tier + currency ON the item so the qty×(price÷tier) math and
    // currency survive even if the structure code is later cleared or free-typed.
    tierQty: tm ? parseInt(tm[1], 10) : (parseFloat(p.moq) || 0),
    qty: (tm ? parseInt(tm[1], 10) : (parseFloat(p.moq) || 0)) || "",
    currency: p.currency || "VND",
  };
  if (p.grade) patch.grade = p.grade;
  if (p.productType) patch.productType = p.productType;
  return patch;
}
// Searchable Product Code (Mã SP) combobox. onPick(code, variants) fires on select.
function CodeCombo({ products, value, onPick, placeholder }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = React.useRef(null);
  const groups = React.useMemo(() => productCodeGroups(products), [products]);
  const text = open ? q : (value || "");
  const filtered = React.useMemo(() => {
    const needle = (open ? q : "").trim().toLowerCase();
    const arr = needle
      ? groups.filter(g => (g.code + " " + [...new Set(g.variants.map(v => v.grade).filter(Boolean))].join(" ")).toLowerCase().includes(needle))
      : groups;
    return arr.slice(0, 80);
  }, [q, open, groups]);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const choose = (g) => { onPick(g.code, g.variants); setQ(""); setOpen(false); };
  return (
    <div className="sku-combo" ref={wrapRef}>
      <input className="input" value={text} placeholder={placeholder || "Mã SP…"}
        onFocus={() => { setQ(value || ""); setHi(0); setOpen(true); }}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { if (open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); } }
          else if (e.key === "Escape") { setOpen(false); }
        }} />
      {open && (
        <div className="sku-pop">
          {filtered.length === 0 && <div className="sku-empty">Không tìm thấy mã SP</div>}
          {filtered.map((g, i) => {
            const grades = [...new Set(g.variants.map(v => v.grade).filter(Boolean))];
            return (
              <button type="button" key={g.code} className={"sku-opt" + (i === hi ? " hi" : "")}
                onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(g); }}>
                <span className="sku-opt-name">{g.code}</span>
                {grades.map(gr => <span key={gr} className="sku-opt-grade">{gr}</span>)}
                <span className="sku-opt-edp">{g.variants.length} structure</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
// Searchable structure (ECCSHOAXX) combobox. Type "TDW132 110" to see every length for that
// width — each space-separated token must appear somewhere in the structure row, so partial
// codes narrow down fast and a no-result list means the code isn't in the catalogue yet.
function structHay(p) {
  return [structLabel(p), pcOf(p), p.itmref || "", p.grade || "", p.productType || "", p.width ?? "", p.length ?? ""].join(" ").toLowerCase();
}
function StructCombo({ products, value, code, onPick, disabled, placeholder }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = React.useRef(null);
  const all = products || [];
  const picked = value ? all.find(p => p.id === value) : null;
  const text = open ? q : (picked ? structLabel(picked) : "");
  const filtered = React.useMemo(() => {
    const toks = (open ? q : "").trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    const base = toks.length ? all : (code ? variantsForCode(all, code) : all);
    const arr = toks.length ? base.filter(p => { const h = structHay(p); return toks.every(tk => h.includes(tk)); }) : base;
    // Rank: the product code the user is already on first, then codes that START with the
    // first token (so "TDW132 110" puts TDW132.110×… above 110.DBIK… matches), then the rest.
    const t0 = toks[0] || "";
    const nums = toks.filter(tk => /^\d+$/.test(tk)).map(Number);
    const rank = (p) => {
      const pc = (pcOf(p) || "").toLowerCase();
      let s = pc === (code || "").toLowerCase() ? -4 : (t0 && pc.startsWith(t0) ? -2 : 0);
      // A bare number usually means a width (110 → 110mm); put real width matches on top.
      if (nums.length && nums.includes(parseFloat(p.width))) s -= 3;
      return s;
    };
    return arr.slice().sort((a, b) =>
      rank(a) - rank(b) || (pcOf(a) || "").localeCompare(pcOf(b) || "")
      || (parseFloat(a.width) || 0) - (parseFloat(b.width) || 0)
      || (parseFloat(a.length) || 0) - (parseFloat(b.length) || 0)
    ).slice(0, 120);
  }, [q, open, all, code]);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const choose = (p) => { onPick(p); setQ(""); setOpen(false); };
  return (
    <div className="sku-combo struct-combo" ref={wrapRef}>
      <input className="input" value={text} disabled={disabled}
        placeholder={placeholder || (code ? code + " 110…" : "— structure —")}
        onFocus={() => { setQ(code && !picked ? code + " " : (picked ? structLabel(picked) : "")); setHi(0); setOpen(true); }}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { if (open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); } }
          else if (e.key === "Escape") { setOpen(false); }
          else if (e.key === "Backspace" && !q) { onPick(null); }
        }} />
      {open && (
        <div className="sku-pop">
          {filtered.length === 0 && <div className="sku-empty">Không có mã cấu trúc nào khớp — mã này chưa có trên hệ thống</div>}
          {filtered.map((p, i) => (
            <button type="button" key={p.id} className={"sku-opt" + (i === hi ? " hi" : "")}
              onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(p); }}>
              <span className="sku-opt-name">{structLabel(p)}</span>
              {p.grade ? <span className="sku-opt-grade">{p.grade}</span> : null}
              <span className="sku-opt-edp">{(p.width ?? "—") + "mm · " + (p.length ?? "—") + "m"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function ProductLineItems({ items, onChange, products: allProducts, t, cur, country }) {
  const { productCountry } = useApp();
  const ctry = C.normCountry(country || "") || productCountry || "";
  const products = React.useMemo(() => catalogueFor(allProducts, ctry), [allProducts, ctry]);
  // Totals are shown in the market's own currency unless the caller names one.
  const curEff = cur || (ctry ? C.ccyOfCountry(ctry) : "");
  const list = items && items.length ? items : [];
  const update = (i, patch) => onChange(list.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const addRow = () => onChange([...list, { productId: "", productCode: "", structureCode: "", sku: "", grade: "", productType: "FR", width: "", length: "", sqmPerRoll: "", qty: "", price: "", edpCode: "" }]);
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  // codeOf: existing (stored) items may only carry productId — resolve their code for display.
  const codeOf = (it) => it.productCode || (it.productId ? pcOf(products.find(p => p.id === it.productId) || {}) : "");
  const pickCode = (i, code, variants) => {
    const vs = variants || variantsForCode(products, code);
    const grades = [...new Set(vs.map(v => v.grade).filter(Boolean))];
    const types = [...new Set(vs.map(v => v.productType).filter(Boolean))];
    const patch = { productCode: code, grade: grades[0] || "", productType: types[0] || "FR",
      structureCode: "", productId: "", sku: code, edpCode: "", width: "", length: "", sqmPerRoll: "", price: "", rollPrice: "" };
    if (vs.length === 1) Object.assign(patch, structFields(vs[0]));
    update(i, patch);
  };
  const pickStructure = (i, pid) => {
    const p = (products || []).find(x => x.id === pid);
    if (!p) { update(i, { productId: "", structureCode: "", sku: codeOf(list[i]) || "", edpCode: "", width: "", length: "", sqmPerRoll: "", price: "", rollPrice: "" }); return; }
    // A structure picked by free search may belong to another product code — bring the code along.
    const pc = pcOf(p);
    const head = pc && pc !== codeOf(list[i]) ? { productCode: pc, sku: pc } : {};
    update(i, { ...head, ...structFields(p) });
  };
  const fmt = (n) => n ? new Intl.NumberFormat("en-US").format(n) : "—";
  const dim = <span className="dim">—</span>;
  // Typing a unit price re-derives the roll price (drop any override); typing a roll
  // price back-solves the unit price so the two never disagree. Value follows from
  // roll price × qty in both directions.
  const setUnitPrice = (i, v) => update(i, { price: v, unitPrice: v, rollPrice: "" });
  const setRollPrice = (i, v) => {
    const it = list[i], area = lineAreaPerRoll(it), rp = parseFloat(v);
    const up = (!isNaN(rp) && area > 0) ? Math.round((rp / area) * 100) / 100 : it.price;
    update(i, { rollPrice: v, price: v === "" ? it.price : up, unitPrice: v === "" ? it.price : up });
  };
  const tot = lineItemTotals(list);
  return (
    <div className="li-wrap">
      {ctry && <div className="li-pricelist">{t("li_pricelist")}: <strong>{ctry}</strong> <span className="dim">· {products.length} {t("pd_count")}</span>{products.length === 0 && <em className="li-pricelist-warn">{t("li_no_codes")}</em>}</div>}
      <div className="li-head">
        <span>{t("pd_code")}</span><span>{t("pd_grade")}</span><span>Type</span><span>{t("pd_eccshoaxx")}</span><span>EDP</span><span>{t("pol_width")}</span><span>{t("pol_length")}</span><span>{t("pol_qty")}</span><span>{t("li_price")}</span><span>{t("pd_roll_price")}</span><span>{t("li_line_total")}</span><span></span>
      </div>
      {list.map((it, i) => {
        const code = codeOf(it);
        const vs = variantsForCode(products, code);
        return (
        <div className="li-row" key={i}>
          <CodeCombo products={products} value={code} placeholder="Mã SP…"
            onPick={(c, variants) => pickCode(i, c, variants)} />
          <div className="li-ro">{it.grade || dim}</div>
          <div className="li-ro">{it.productType || dim}</div>
          <StructCombo products={products} value={it.productId || ""} code={code}
            onPick={p => pickStructure(i, p ? p.id : "")} />
          <div className="li-ro">{it.edpCode || dim}</div>
          <div className="li-ro">{(it.width !== "" && it.width != null) ? it.width : dim}</div>
          <div className="li-ro">{(it.length !== "" && it.length != null) ? it.length : dim}</div>
          <input className="input" type="number" value={it.qty} onChange={e => update(i, { qty: e.target.value })} />
          <div className="li-price-cell">
            <input className="input" type="number" value={it.price} onChange={e => setUnitPrice(i, e.target.value)} placeholder="/m²" />
          </div>
          <div className="li-price-cell">
            <input className="input" type="number" title={t("li_roll_hint")} placeholder="/roll"
              value={it.rollPrice !== "" && it.rollPrice != null ? it.rollPrice : (lineRollPrice(it) > 0 ? Math.round(lineRollPrice(it)) : "")}
              onChange={e => setRollPrice(i, e.target.value)} />
          </div>
          <span className="li-line-val">{fmt(lineItemTotals([it]).value)}</span>
          <button className="icon-btn" type="button" onClick={() => remove(i)} aria-label="remove">✕</button>
        </div>
        );
      })}
      {list.length === 0 && <p className="empty" style={{ padding: "10px 0" }}>{t("li_empty")}</p>}
      <div className="li-foot">
        <button className="btn btn-ghost btn-sm" type="button" onClick={addRow}><Icon d={ICONS.plus} size={13} /> {t("li_add")}</button>
        <div className="li-totals">
          <span>{t("pol_qty")}: <strong>{fmt(tot.qty)}</strong></span>
          <span>{t("pol_sqm")}: <strong>{fmt(tot.sqm)}</strong></span>
          <span>{t("li_total")}: <strong>{fmt(tot.value)}{curEff ? " " + curEff : ""}</strong></span>
        </div>
      </div>
    </div>
  );
}
function FilterSelect({ value, onChange, options, allLabel }) {
  return (
    <select className="select" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
// ---- Reusable multi-row selection (checkboxes + select-all + bulk delete) ----
function useRowSelection() {
  const [selected, setSelected] = useState(() => new Set());
  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (ids) => setSelected(prev => {
    const allOn = ids.length > 0 && ids.every(id => prev.has(id));
    return allOn ? new Set() : new Set(ids);
  });
  const clear = () => setSelected(new Set());
  const isSel = (id) => selected.has(id);
  return { selected, setSelected, toggle, toggleAll, clear, isSel, count: selected.size };
}
function SelectAllCheck({ ids, selected, toggleAll }) {
  const ref = React.useRef(null);
  const allOn = ids.length > 0 && ids.every(id => selected.has(id));
  const some = ids.some(id => selected.has(id));
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = some && !allOn; }, [some, allOn]);
  return <input ref={ref} type="checkbox" className="row-check" checked={allOn} onChange={() => toggleAll(ids)} onClick={e => e.stopPropagation()} aria-label="select all" title={allOn ? "Bỏ chọn tất cả" : "Chọn tất cả"} />;
}
function RowCheck({ id, selected, toggle }) {
  return <input type="checkbox" className="row-check" checked={selected.has(id)} onChange={() => toggle(id)} onClick={e => e.stopPropagation()} aria-label="select row" />;
}
// Floating bar shown while rows are selected; offers a bulk delete.
// allIds = every row matching the CURRENT filter (not just the ones rendered), so the bar
// can offer "select all N" once a first row is ticked — the header checkbox alone only
// reaches what is on screen, which is misleading on paged tables like the PO list.
function BulkBar({ count, onDelete, onClear, noun, allIds, onSelectAll, onEdit }) {
  const { t } = useApp();
  if (!count) return null;
  const total = Array.isArray(allIds) ? allIds.length : 0;
  const canAll = !!onSelectAll && total > count;
  return (
    <div className="bulk-bar">
      <span className="bulk-bar-count"><strong>{count}</strong> {noun || t("bulk_selected")}</span>
      <div className="bulk-bar-actions">
        {canAll && <button className="btn btn-ghost btn-sm" onClick={() => onSelectAll(allIds)}>{t("bulk_select_all").replace("{n}", total.toLocaleString("vi-VN"))}</button>}
        <button className="btn btn-ghost btn-sm" onClick={onClear}>{t("bulk_clear")}</button>
        {onEdit && <button className="btn btn-primary btn-sm" onClick={onEdit}>{t("bulk_edit")}</button>}
        <button className="btn btn-danger btn-sm" onClick={onDelete}>{t("bulk_delete")}</button>
      </div>
    </div>
  );
}
// Shared file-drop zone for every import modal: click to browse OR drag & drop.
// Accepts .csv / .xlsx / .xls / .xlsm (readImportFile already understands all of them).
function ImportDrop({ t, onFile, note }) {
  const [over, setOver] = useState(false);
  const take = (e) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <label className={"import-drop" + (over ? " import-drop-over" : "")}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={take}>
      <Icon d={ICONS.upload} size={26} />
      <strong>{t("im_pick")}</strong>
      <small>{note || t("im_header_note")}</small>
      <small className="import-drop-hint">{t("im_drop_hint")}</small>
      <input type="file" accept=".csv,text/csv,.xlsx,.xls,.xlsm" hidden onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
  );
}
// Reusable step shown after picking a multi-sheet Excel file: choose which sheet to import.
function ImportSheetPicker({ t, fileName, sheets, onPick, onReplace }) {
  return (
    <div>
      <div className="import-fileline">
        <Icon d={ICONS.file} size={15} /> <strong>{fileName}</strong>
        <span className="dim">· {sheets.length} {t("im_sheets")}</span>
        {onReplace && <button className="link-btn" onClick={onReplace}>{t("im_replace")}</button>}
      </div>
      <div className="map-head">{t("im_pick_sheet")}</div>
      <div className="sheet-pick-list">
        {sheets.map((s, i) => {
          const dataRows = Math.max(0, s.rows.length - 1);
          return (
            <button key={i} className="sheet-pick" onClick={() => onPick(i)}>
              <span className="sheet-pick-tab"><Icon d={ICONS.grid || ICONS.overview} size={14} /></span>
              <span className="sheet-pick-meta">
                <strong>{s.name}</strong>
                <small className="dim">{dataRows} {t("im_rows")} · {(s.rows[0] || []).length} {t("im_cols")}</small>
              </span>
              <span className="sheet-pick-go">→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
// Reusable Excel/CSV import modal (sheet pick → currency/country → column mapping → run).
// `fields`: [{ key, labelKey, required, re, money }]. `onImport(items, {cur, country})` does the
// entity-specific create work and returns { imported, created, skipped }.
function GenericImportModal({ titleKey, hintKey, templateName, fields, onImport, onClose, defaultCountry, allCountryOption, noCountry, createdKey, storeAsEntered }) {
  const { t, customers, productCountry } = useApp();
  const fLabel = (f) => f.label || t(f.labelKey);
  const downloadTemplate = () => {
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const headers = fields.map(f => fLabel(f) + (f.required ? " *" : ""));
    const exRows = [0, 1].map(i => fields.map(f => (Array.isArray(f.ex) ? (f.ex[i] || "") : (i === 0 ? (f.ex || "") : ""))));
    const csv = [headers, ...exRows].map(r => r.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = (templateName || "import") + "-template.csv"; a.click();
  };
  const [book, setBook] = useState(null);
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState({});
  const [cur, setCur] = useState("");
  // Imports land in the market the user is working in (topbar filter / KPI country).
  const [country, setCountry] = useState(defaultCountry || productCountry || (allCountryOption ? "All" : (C.MARKETS[0] || "Thailand")));
  // Currency left blank = follow the market (Thailand → THB, Vietnam → VND). Picking one by
  // hand overrides that for the whole file: a price list quoted in USD stays USD: it is
  // STORED as entered and converted only when displayed, never relabelled at import.
  const curEff = cur || C.ccyOfCountry(country) || "VND";
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const importCountries = [...new Set([...C.MARKETS, ...customers.map(c => C.normCountry(c.country))].filter(Boolean))].sort();
  const hasMoney = fields.some(f => f.money);

  const applySheet = (sheetRows) => {
    if (!sheetRows || sheetRows.length < 2) { setError(t("im_excel_err")); return; }
    setRows(sheetRows);
    const headers = sheetRows[0].map(h => String(h || "").trim());
    const m = {};
    fields.forEach(f => { const idx = headers.findIndex(h => f.re.test(h)); if (idx >= 0 && !Object.values(m).includes(idx)) m[f.key] = idx; });
    setMap(m); setReport(null);
  };
  const onFile = (file) => {
    setError(""); setFileName(file.name);
    C.readImportFile(file).then(({ sheets }) => {
      if (!sheets.length) { setError(t("im_excel_err")); return; }
      if (sheets.length > 1) { setBook({ sheets }); setRows(null); }
      else applySheet(sheets[0].rows);
    }).catch(() => setError(t("im_excel_err")));
  };
  const reset = () => { setBook(null); setRows(null); setMap({}); setCur("VND"); setError(""); setReport(null); };

  const headers = rows ? rows[0] : [];
  const dataRows = rows ? rows.slice(1) : [];
  const requiredKeys = fields.filter(f => f.required).map(f => f.key);
  const canImport = requiredKeys.every(k => map[k] !== undefined) && dataRows.length > 0;

  const runImport = () => {
    if (!canImport) return;
    const val = (r, key) => (map[key] !== undefined ? String(r[map[key]] ?? "").trim() : "");
    // `_row` is the Excel row number (header is row 1) so a caller can report exactly
    // which source rows it rejected, and the modal can hand those rows back as a CSV.
    const items = dataRows.map((r, i) => { const o = { _row: i + 2 }; fields.forEach(f => o[f.key] = val(r, f.key)); return o; });
    const res = onImport(items, { cur: curEff, curPicked: cur, country }) || { imported: 0, created: 0, skipped: 0 };
    setReport(res);
  };

  // Hand the failing source rows back to the user: their own columns, verbatim, plus a
  // Reason column — fix in Excel, re-import, done.
  const downloadIssues = (issues) => {
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const head = [t("pol_iss_col_row"), ...headers.map(h => String(h || "")), t("pol_iss_col_reason")];
    const body = issues.map(is => {
      const src = dataRows[is.row - 2] || [];
      return [is.row, ...headers.map((_, i) => src[i] == null ? "" : src[i]), is.reason || ""];
    });
    const csv = [head, ...body].map(r => r.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (templateName || "import") + "-errors-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal title={t(titleKey)} onClose={onClose} width={680}>
      {error ? (
        <div>
          <p className="import-warn">{error}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" onClick={reset}>{t("im_replace")}</button>
          </div>
        </div>
      ) : report ? (
        <div className={"import-report" + (report.skipped > 0 ? " import-report-warn" : "")}>
          <div className="import-report-icon">{report.skipped > 0 ? "!" : "\u2713"}</div>
          <h3>{report.skipped > 0 ? t("im_done_partial") : t("im_done")}</h3>
          <p><strong>{report.imported}</strong> {t("im_imported")}{report.skipped > 0 ? <> · <strong>{report.skipped}</strong> {t("pol_import_skipped")}</> : null}</p>
          {report.created > 0 && <p className="import-note">+ {report.created} {t(createdKey || "pol_import_created")}</p>}
          {report.warn && <p className="import-warn" style={{ textAlign: "left", whiteSpace: "pre-line" }}>{report.warn}</p>}
          {report.skipped > 0 && !(report.issues && report.issues.length) && <p className="import-warn">{t("im_skipped_note")}</p>}
          <div className="modal-actions" style={{ justifyContent: "center" }}>
            {report.issues && report.issues.length > 0 && (
              <button className="btn btn-ghost" onClick={() => downloadIssues(report.issues)}>
                <Icon d={ICONS.download} size={14} /> {t("pol_iss_dl").replace("{n}", String(report.issues.length))}
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      ) : !rows && book ? (
        <ImportSheetPicker t={t} fileName={fileName} sheets={book.sheets}
          onPick={i => applySheet(book.sheets[i].rows)} onReplace={reset} />
      ) : !rows ? (
        <div>
          {hintKey && <p className="import-note">{t(hintKey)}</p>}
          <ImportDrop t={t} onFile={onFile} />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="link-btn" style={{ marginLeft: 0 }} onClick={downloadTemplate}>
              <Icon d={ICONS.download} size={13} /> {t("im_template")}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="import-fileline">
            <Icon d={ICONS.file} size={15} /> <strong>{fileName}</strong>
            <span className="dim">· {dataRows.length} {t("im_rows")}</span>
            {book && book.sheets.length > 1 && <button className="link-btn" onClick={() => setRows(null)}>{t("im_pick_sheet")}</button>}
            <button className="link-btn" onClick={reset}>{t("im_replace")}</button>
          </div>
          <div className="import-currency" style={(hasMoney || !noCountry) ? null : { display: "none" }}>
            <div className="import-currency-main">
              {hasMoney && <>
                <span className="import-currency-label">{t("pol_import_currency")}</span>
                <select className="select" value={cur} onChange={e => setCur(e.target.value)}>
                  <option value="">{t("im_cur_auto")}</option>
                  {Object.keys(C.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </>}
              {!noCountry && <>
                <span className="import-currency-label" style={{ marginLeft: hasMoney ? 14 : 0 }}>{t("country")}</span>
                <select className="select" value={country} onChange={e => setCountry(e.target.value)}>
                  {(allCountryOption ? ["All", ...importCountries] : importCountries).map(c => <option key={c} value={c}>{c === "All" ? t("all") : c}</option>)}
                </select>
              </>}
            </div>
            {hasMoney && <small className="import-currency-hint">
              {storeAsEntered
                ? (!cur ? t("im_cur_auto_note").replace("{cur}", curEff).replace("{c}", country === "All" ? t("all") : country) + " " : "")
                  + t("im_cur_keep_note").replace("{cur}", curEff).replace("{local}", C.ccyOfCountry(country) || "VND")
                : (!cur ? t("im_cur_auto_note").replace("{cur}", curEff).replace("{c}", country === "All" ? t("all") : country) + " " : "")
                  + (curEff === "VND" ? t("pol_import_currency_vnd")
                    : t("pol_import_currency_note").replace("{cur}", curEff).replace("{rate}", C.fmtNum((C.CURRENCIES[curEff] || { rate: 1 }).rate)) + " " + t("im_cur_src_note").replaceAll("{cur}", curEff))}
            </small>}
          </div>
          <div className="map-grid">
            <div className="map-head">{t("im_map")}</div>
            {fields.map(f => (
              <div className="map-row" key={f.key}>
                <span className="map-field">{fLabel(f)}{f.required ? <em> *</em> : null}</span>
                <select className="select" value={map[f.key] !== undefined ? map[f.key] : ""}
                  onChange={e => setMap(prev => ({ ...prev, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">{t("im_skip")}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{(h ? String(h).slice(0, 60) : "(col " + (i + 1) + ")")}</option>)}
                </select>
                <span className="map-sample dim">{map[f.key] !== undefined && dataRows[0] ? String(dataRows[0][map[f.key]] ?? "").slice(0, 36) : ""}</span>
              </div>
            ))}
          </div>
          {!canImport && <p className="import-warn">{t("im_need_name")}</p>}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={!canImport} onClick={runImport}>{t("im_run")} ({dataRows.length})</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// shared field: pick an existing project for a customer, or open the full project-create popup
function ProjectLinkField({ t, customerId, projects, value, onChange, kind }) {
  const [showForm, setShowForm] = useState(false);
  const custProjects = (projects || []).filter(p => p.customerId === customerId);
  const stage = kind === "quote" ? "Quotation" : "Sample";
  const PF = window.ProjectFormModal;
  return (
    <>
      <Field label={t("link_project")}>
        <select className="select" value={value || ""} disabled={!customerId}
          onChange={e => { const v = e.target.value; if (v === "__new__") setShowForm(true); else onChange(v); }}>
          <option value="">{t("link_no_project")}</option>
          {custProjects.map(p => <option key={p.id} value={p.id}>{p.name} · {t("st_" + p.stage)}</option>)}
          <option value="__new__">➕ {t("link_new_project")}</option>
        </select>
      </Field>
      {value && <p className="field-hint-full">{kind === "quote" ? t("link_auto_quote") : t("link_auto_sample")}</p>}
      {showForm && PF && <PF presetCustomerId={customerId} presetStage={stage}
        onClose={() => setShowForm(false)} onCreated={(p) => { setShowForm(false); onChange(p.id); }} />}
    </>
  );
}

/* ---------- Icons (inline, stroke) ---------- */
function Icon({ d, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
}
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pipelines: '<path d="M4 4h16l-6 8v6l-4 2v-8L4 4z"/>',
  projects: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12l2 2 3.5-4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  po: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  sample: '<path d="M9 2v6.5L4.5 17a3 3 0 0 0 2.6 4.5h9.8a3 3 0 0 0 2.6-4.5L15 8.5V2"/><path d="M9 2h6"/><path d="M8 16h8"/>',
  quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  forecast: '<path d="M3 3v18h18"/><path d="M18.7 8 13 13.7l-4-4L3 16.3"/><path d="M16 8h4v4"/>',
};

/* ---------- helpers ---------- */
function readPhoto(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      cb(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- Login ---------- */
function LoginScreen() {
  const { t, login, lang, setLang } = useApp();
  let remembered = null;
  try { remembered = JSON.parse(localStorage.getItem("ttcrm_login_remember") || "null"); } catch (e) {}
  const [email, setEmail] = useState(remembered ? remembered.email : "");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState("login");
  const [sent, setSent] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendReset = async (e) => {
    if (e) e.preventDefault();
    setResetErr("");
    const base = window.CRM.RESET_FN_BASE;
    if (!base) { setResetErr(t("reset_unconfigured")); return; }
    setSending(true);
    try {
      await fetch(base.replace(/\/$/, "") + "/request-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch (err) { /* generic UX: still show "sent" so we don't leak status */ }
    setSending(false);
    setSent(true);
  };
  // Credentials are checked by the Worker (PBKDF2 hashes in D1); it answers with the
  // profile and sets the session cookie.
  const submit = async (e) => {
    if (e) e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await C.API.login(email.trim(), pw).catch(() => ({ ok: false }));
    setBusy(false);
    if (!r.ok || !r.user) { setErr(t(r.error === "too_many_attempts" ? "login_locked" : "login_invalid")); return; }
    if (remember) localStorage.setItem("ttcrm_login_remember", JSON.stringify({ email: r.user.email }));
    else localStorage.removeItem("ttcrm_login_remember");
    login(r.user.id, canonRoleUser(r.user));
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src={LOGO_FULL} alt="Todaytec — Barcoding The World" className="login-logo" />
        <h1>{t("login_title")}</h1>
        {mode === "login" ? (
        <form className="login-form" onSubmit={submit}>
          <Field label={t("login_email")}>
            <input className="input" type="email" value={email} autoFocus placeholder="name@todaytec.vn"
              onChange={e => { setEmail(e.target.value); setErr(""); }} />
          </Field>
          <Field label={t("login_password")}>
            <input className="input" type="password" value={pw} placeholder="••••••••"
              onChange={e => { setPw(e.target.value); setErr(""); }} />
          </Field>
          <label className="login-remember">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> {t("login_remember")}
            <button type="button" className="login-forgot" onClick={() => { setMode("reset"); setSent(false); }}>{t("login_forgot")}</button>
          </label>
          {err && <p className="login-err">{err}</p>}
          <button type="submit" className="btn btn-primary login-btn" disabled={!email || !pw || busy}>{busy ? "…" : t("login_btn")}</button>
        </form>
        ) : (
        <form className="login-form" onSubmit={sendReset}>
          <h2 style={{ margin: "0 0 2px", fontSize: 15 }}>{t("reset_title")}</h2>
          <p className="login-sub" style={{ margin: 0 }}>{t("reset_sub")}</p>
          <Field label={t("login_email")}>
            <input className="input" type="email" value={email} autoFocus placeholder="name@todaytec.vn"
              onChange={e => setEmail(e.target.value)} />
          </Field>
          {sent && <p className="login-sent">{t("reset_sent")}</p>}
          {resetErr && <p className="login-err">{resetErr}</p>}
          <button type="submit" className="btn btn-primary login-btn" disabled={!email || sending}>{sending ? "…" : t("reset_send")}</button>
          <button type="button" className="login-forgot" style={{ textAlign: "center" }} onClick={() => setMode("login")}>{t("reset_back")}</button>
        </form>
        )}
        <div className="login-lang">
          {["en", "vi", "th"].map(l => (
            <button key={l} className={"lang-chip" + (lang === l ? " on" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- In-app password reset (opened via email link ?reset=token) ---------- */
function ResetPasswordScreen({ token }) {
  const { t, lang, setLang } = useApp();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const backToApp = () => { window.location.href = window.location.origin + window.location.pathname; };

  const submit = async (e) => {
    if (e) e.preventDefault();
    setErr("");
    if (pw.length < 4) { setErr(t("rp_short")); return; }
    if (pw !== confirm) { setErr(t("rp_mismatch")); return; }
    const base = window.CRM.RESET_FN_BASE;
    if (!base) { setErr(t("reset_unconfigured")); return; }
    setBusy(true);
    try {
      const r = await fetch(base.replace(/\/$/, "") + "/confirm-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw, newPassword: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { setDone(true); }
      else if (j.error === "invalid_or_expired") setErr(t("rp_expired"));
      else setErr(t("rp_error"));
    } catch (_e) { setErr(t("rp_error")); }
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src={LOGO_FULL} alt="Todaytec" className="login-logo" />
        {done ? (
          <>
            <h1>{t("rp_done")}</h1>
            <p className="login-sub">{t("rp_done_sub")}</p>
            <button className="btn btn-primary login-btn" onClick={backToApp}>{t("rp_to_login")}</button>
          </>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <h1 style={{ marginBottom: 2 }}>{t("rp_title")}</h1>
            <p className="login-sub" style={{ margin: "4px 0 6px" }}>{t("rp_sub")}</p>
            <Field label={t("rp_new")}>
              <input className="input" type="password" value={pw} autoFocus placeholder="••••••••"
                onChange={e => { setPw(e.target.value); setErr(""); }} />
            </Field>
            <Field label={t("rp_confirm")}>
              <input className="input" type="password" value={confirm} placeholder="••••••••"
                onChange={e => { setConfirm(e.target.value); setErr(""); }} />
            </Field>
            {err && <p className="login-err">{err}</p>}
            <button type="submit" className="btn btn-primary login-btn" disabled={!pw || !confirm || busy}>{busy ? "…" : t("rp_submit")}</button>
            <button type="button" className="login-forgot" style={{ textAlign: "center" }} onClick={backToApp}>{t("reset_back")}</button>
          </form>
        )}
        <div className="login-lang">
          {["en", "vi", "th"].map(l => (
            <button key={l} className={"lang-chip" + (lang === l ? " on" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Topbar pieces ---------- */
// Global date-range filter — one control for every tab (list windows, KPIs, forecast anchor).
function GlobalDateFilter() {
  const { dateRange, setDateRange } = useApp();
  return <DateRangeFilter value={dateRange} onChange={setDateRange} />;
}
// Global country view filter — narrows every scoped dataset (all list tabs) to one market.
// Hidden when the user effectively sees a single country (nothing to switch).
function CountryDropdown() {
  const { countryFilter, setCountryFilter, visibleCountries, t } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fn = () => setOpen(false);
    window.addEventListener("click", fn); return () => window.removeEventListener("click", fn);
  }, [open]);
  if (!visibleCountries || visibleCountries.length < 2) return null;
  const label = countryFilter === "All" ? t("all_countries") : countryFilter;
  const opts = ["All", ...visibleCountries];
  return (
    <div className="dropdown" onClick={e => e.stopPropagation()}>
      <button className="top-pill" onClick={() => setOpen(o => !o)} title={label} style={countryFilter !== "All" ? { borderColor: "var(--teal)", color: "var(--teal-dark)" } : undefined}>
        <Icon d='<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' size={15} /> <span className="top-pill-label">{label}</span> <span className="user-caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          {opts.map(c => (
            <button key={c} className={"dropdown-item" + (countryFilter === c ? " cur" : "")}
              onClick={() => { setCountryFilter(c); setOpen(false); }}>
              {c === "All" ? t("all_countries") : c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function LangDropdown() {
  const { lang, setLang } = useApp();
  const [open, setOpen] = useState(false);
  const NAMES = { en: "English", vi: "Tiếng Việt", th: "ไทย" };
  useEffect(() => {
    if (!open) return;
    const fn = () => setOpen(false);
    window.addEventListener("click", fn); return () => window.removeEventListener("click", fn);
  }, [open]);
  return (
    <div className="dropdown" onClick={e => e.stopPropagation()}>
      <button className="top-pill" onClick={() => setOpen(o => !o)} title={lang.toUpperCase()}>
        <Icon d={ICONS.globe} size={15} /> <span className="top-pill-label">{lang.toUpperCase()}</span> <span className="user-caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          {["en", "vi", "th"].map(l => (
            <button key={l} className={"dropdown-item" + (lang === l ? " cur" : "")}
              onClick={() => { setLang(l); setOpen(false); }}>
              <span className="dd-code">{l.toUpperCase()}</span> {NAMES[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Chip multiselect of the OTHER registered sales accounts a user may oversee.
// Reused by the Permissions account card (boss) and the profile self-service.
function MembersAllowedControl({ userObj, onChange }) {
  const { t, users } = useApp();
  const options = (users || []).filter(u => u.salesCode && !u._deleted && u.id !== userObj.id);
  const sel = new Set(userObj.members || []);
  const toggle = (code) => { const n = new Set(sel); n.has(code) ? n.delete(code) : n.add(code); onChange([...n]); };
  if (!options.length) return <span className="dim" style={{ fontSize: 12 }}>{t("mb_none_avail")}</span>;
  return (
    <div className="chip-row">
      {options.map(u => (
        <button key={u.id} type="button" className={"chip" + (sel.has(u.salesCode) ? " on" : "")}
          onClick={() => toggle(u.salesCode)}>{u.salesCode} · {u.shortName || u.name}</button>
      ))}
    </div>
  );
}

// ---- Reusable table sorting ----
// useSort: click a column key to sort; clicking the active key flips direction.
// apply(rows, accessors) returns a sorted COPY using the accessor for the active
// key. Values compare numerically when both are numbers, else natural-string.
function useSort(initialKey = null, initialDir = "asc") {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const onSort = (key, dir) => setSort(s => dir ? { key, dir } : (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const apply = (rows, accessors) => {
    const get = accessors && accessors[sort.key];
    if (!sort.key || !get) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let va = get(a), vb = get(b);
      const na = va == null || va === "", nb = vb == null || vb === "";
      if (na && nb) return 0;
      if (na) return 1;      // blanks sink to the bottom regardless of direction
      if (nb) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  };
  return { sort, onSort, apply };
}
// Sortable <th>. Pass the shared sort state + onSort. align="right" mirrors the caret.
function SortTh({ label, sortKey, sort, onSort, className, align, style }) {
  const active = sort.key === sortKey;
  return (
    <th className={(className || "") + " sort-th" + (active ? " sort-active" : "")}
      data-align={align || undefined} style={style} onClick={() => onSort(sortKey)}>
      <span className="sort-th-inner">{label}<span className="sort-caret">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span></span>
    </th>
  );
}
// Dropdown alternative to header clicks. columns: [{key,label}]. Shows both
// directions per column so the user can pick sort + order in one place.
function SortMenu({ columns, sort, onSort, label }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fn = () => setOpen(false);
    window.addEventListener("click", fn); return () => window.removeEventListener("click", fn);
  }, [open]);
  const cur = columns.find(c => c.key === sort.key);
  return (
    <div className="sort-menu" onClick={e => e.stopPropagation()}>
      <button className={"btn btn-ghost btn-sm" + (cur ? " btn-filter-active" : "")} onClick={() => setOpen(o => !o)}>
        <Icon d='<path d="M3 6h11M3 12h7M3 18h5M17 5v14m0 0l-3-3m3 3l3-3"/>' size={14} />
        {cur ? `${cur.label} ${sort.dir === "asc" ? "↑" : "↓"}` : (label || t("sort_by"))}
      </button>
      {open && (
        <div className="sort-menu-pop">
          <div className="sort-menu-head">{label || t("sort_by")}</div>
          {columns.map(c => ["asc", "desc"].map(dir => (
            <button key={c.key + dir} className={"sort-menu-opt" + (sort.key === c.key && sort.dir === dir ? " on" : "")}
              onClick={() => { onSort(c.key, dir); setOpen(false); }}>
              {c.label}<span className="sort-menu-dir">{dir === "asc" ? "↑ A–Z / ↑" : "↓ Z–A / ↓"}</span>
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

function ProfileModal({ onClose }) {
  const { t, user, updateUser, roleOf } = useApp();
  const [f, setF] = useState({ name: user.name, phone: user.phone || "", email: user.email || "", photo: user.photo || "", members: user.members || [] });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const save = () => { updateUser(user.id, f); onClose(); };
  const canDelegate = user.salesCode && roleOf(user).scope !== "all";
  return (
    <Modal title={t("pf_title")} onClose={onClose} width={420}>
      <div className="pf-photo-row">
        <Avatar name={f.name} size={72} src={f.photo} color={roleOf(user).scope === "all" ? "var(--navy)" : undefined} />
        <div className="pf-photo-btns">
          <label className="btn btn-ghost btn-sm">
            <Icon d={ICONS.upload} size={13} /> {t("ad_upload_photo")}
            <input type="file" accept="image/*" hidden onChange={e => {
              const file = e.target.files[0];
              if (file) readPhoto(file, url => set("photo", url));
            }} />
          </label>
          {f.photo && <button className="btn btn-ghost btn-sm" onClick={() => set("photo", "")}>{t("ad_remove_photo")}</button>}
        </div>
      </div>
      <div className="form-grid form-grid-1">
        <Field label={t("ad_user")}>
          <input className="input" value={f.name} onChange={e => set("name", e.target.value)} />
        </Field>
        <Field label={t("phone")}>
          <input className="input" value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="+84 / +66 …" />
        </Field>
        <Field label={t("email")}>
          <input className="input" value={f.email} onChange={e => set("email", e.target.value)} placeholder="name@todaytec.com" />
        </Field>
      </div>
      {canDelegate && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field-label">{t("ad_members")}</label>
          <MembersAllowedControl userObj={{ id: user.id, members: f.members }} onChange={m => set("members", m)} />
          <small className="status-hint">{t("ad_members_note")}</small>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" onClick={save}>{t("save")}</button>
      </div>
    </Modal>
  );
}

/* ---------- Shell (sidebar + topbar) ---------- */
function Shell({ page, setPage, children }) {
  const { t, user, logout, canSee, users, login, roleOf } = useApp();
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const role = roleOf(user);
  useEffect(() => {
    if (!menu) return;
    const fn = () => setMenu(false);
    window.addEventListener("click", fn); return () => window.removeEventListener("click", fn);
  }, [menu]);
  const navItems = [
    { id: "overview", icon: ICONS.overview, label: t("nav_overview") },
    { id: "customers", icon: ICONS.customers, label: t("nav_customers") },
    { id: "projects", icon: ICONS.projects, label: t("nav_projects") },
    { id: "pipelines", icon: ICONS.pipelines, label: t("nav_pipelines"), sub: true },
    { id: "samples", icon: ICONS.sample, label: t("nav_samples"), sub: true },
    { id: "quotations", icon: ICONS.quote, label: t("nav_quotations"), sub: true },
    { id: "polist", icon: ICONS.po, label: t("nav_polist") },
    { id: "retention", icon: ICONS.refresh, label: t("nav_retention"), sub: true },
    { id: "target", icon: ICONS.target, label: t("nav_target"), sub: true },
    { id: "forecast", icon: ICONS.forecast, label: t("nav_forecast") },
    { id: "products", icon: ICONS.box, label: t("nav_products") },
    { id: "admin", icon: ICONS.admin, label: t("nav_admin") },
  ].filter(n => canSee(n.id));
  return (
    <div className={"shell" + (collapsed ? " sidebar-collapsed" : "") + (drawer ? " drawer-open" : "")}>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)}></div>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={LOGO_MINI} alt="" className="brand-mark" />
          <span className="brand-name">Todaytec<small>CRM</small></span>
          <button className="sidebar-collapse-btn" onClick={() => { setCollapsed(true); setDrawer(false); }} aria-label="hide menu" title="Hide menu">
            <Icon d='<path d="M15 18l-6-6 6-6"/>' size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(n => (
            <button key={n.id} className={"nav-item" + (page === n.id ? " active" : "") + (n.sub ? " nav-sub" : "")} onClick={() => { setPage(n.id); setDrawer(false); }}>
              <Icon d={n.icon} /> <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button className="menu-toggle menu-toggle-mobile" onClick={e => { e.stopPropagation(); setDrawer(d => !d); }} aria-label="Menu" title="Menu">
            <Icon d='<path d="M3 6h18M3 12h18M3 18h18"/>' size={20} />
          </button>
          {collapsed && (
            <button className="menu-toggle menu-toggle-desktop" onClick={() => setCollapsed(false)} aria-label="show menu" title="Show menu">
              <Icon d='<path d="M9 18l6-6-6-6"/>' size={18} />
            </button>
          )}
          <div className="topbar-left">
            <GlobalDateFilter />
          </div>
          <img src={LOGO_MINI} alt="" className="topbar-logo" />
          <div className="topbar-right">
            <CountryDropdown />
            <LangDropdown />
            <div className="dropdown" onClick={e => e.stopPropagation()}>
              <button className="top-pill top-user" onClick={() => setMenu(m => !m)}>
                <Avatar name={user.name} size={26} src={user.photo} color={role.scope === "all" ? "var(--navy)" : undefined} />
                <span className="top-user-name">{user.name}</span>
                <span className="user-caret">▾</span>
              </button>
              {menu && (
                <div className="dropdown-menu dropdown-wide">
                  <div className="dd-user-head">
                    <Avatar name={user.name} size={36} src={user.photo} color={role.scope === "all" ? "var(--navy)" : undefined} />
                    <div>
                      <strong>{user.name}</strong>
                      <small>{role.name}{user.salesCode ? ` · ${user.salesCode}` : ""}</small>
                    </div>
                  </div>
                  <button className="dropdown-item" onClick={() => { setProfile(true); setMenu(false); }}>
                    <Icon d={ICONS.customers} size={14} /> {t("pf_view")}
                  </button>
                  <button className="dropdown-item logout" onClick={() => { setMenu(false); logout(); }}>⎋ {t("logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      {profile && <ProfileModal onClose={() => setProfile(false)} />}
    </div>
  );
}

// ---- Reusable customer grouping (collapsible groups for repeated companies) ----
// Returns groups in first-appearance order. Singletons keep their natural position.
function groupByCustomer(list, getCustId) {
  const map = new Map();
  list.forEach(item => {
    const k = getCustId(item) || "__none";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return [...map.entries()].map(([cid, items]) => ({ cid, items }));
}
// Group by PARENT company (Name Code) so multiple customer records of the same
// company merge into one group. Returns a representative customerId per group.
function groupByCompany(list, getCustId, customers) {
  const byId = {};
  (customers || []).forEach(c => byId[c.id] = c);
  const codeOf = (cid) => {
    const c = byId[cid];
    return (c ? (C.nameCodeKey(C.nameCodeOf(c)) || cid) : cid) || "__none";
  };
  const map = new Map();
  list.forEach(item => {
    const k = codeOf(getCustId(item));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return [...map.entries()].map(([key, items]) => {
    const ids = [...new Set(items.map(getCustId))];
    return { key, repCustomerId: getCustId(items[0]), companyCount: ids.length, items };
  });
}
function useGroupToggle() {
  // collapsed-by-default: a cid in `open` means expanded
  const [open, setOpen] = useState(() => new Set());
  const isOpen = (cid) => open.has(cid);
  const toggle = (cid) => setOpen(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  return { isOpen, toggle };
}
// Read-only line-items table for detail pages (samples, projects, quotations).
// Columns match the quotation detail; footer always shows the mandatory total value.
function LineItemsView({ items, t, cur = "VND", title, vnd }) {
  const C = window.CRM;
  const list = (items || []).filter(it => it && (it.structureCode || it.sku || it.productCode || parseFloat(it.qty) > 0));
  if (!list.length) return null;
  const totals = lineItemTotals(list);
  // `vnd`: the amounts are canonical VND (PO records) — convert them into the currency the
  // user is viewing in instead of printing the line's stored currency code.
  const _rate = vnd ? ((C.CURRENCIES[cur] || {}).rate || 1) : 1;
  const _cv = (x) => Math.round((x / _rate) * 100) / 100;
  return (
    <section className="card" style={{ gridColumn: "1/-1" }}>
      <h2>{title || t("qt_items")}</h2>
      <table className="table table-plain qt-items-table">
        <thead><tr>
          <th>{t("qt_product_code")}</th>
          <th className="num">{t("qt_width")}</th>
          <th className="num">{t("qt_length")}</th>
          <th className="num">{t("qt_qty")}</th>
          <th className="num">{t("li_price")}</th>
          <th className="num">{t("pd_roll_price")}</th>
          <th className="num">{t("li_line_total")}</th>
        </tr></thead>
        <tbody>
          {list.map((it, i) => {
            const code = it.structureCode || it.sku || it.productCode || "\u2014";
            const c = vnd ? cur : (it.currency || cur);
            // Value-first: when a line carries a stored amount, roll and unit price are
            // solved back from it so legacy rows never show a stale 0.
            const q = parseFloat(it.qty) || 0, area = lineAreaPerRoll(it);
            const amt = (it.amountVnd != null && +it.amountVnd) ? +it.amountVnd : lineValueEff(it);
            const roll = (amt && q > 0) ? amt / q : lineRollPrice(it);
            const unit = area > 0 ? roll / area : lineUnitPrice(it);
            return (
              <tr key={i}>
                <td>{code}{(it.grade || it.productType) ? <small className="cell-sub">{[it.grade, it.productType].filter(Boolean).join(" \u00b7 ")}</small> : null}</td>
                <td className="num">{it.width}</td>
                <td className="num">{it.length}</td>
                <td className="num">{C.fmtNum(it.qty)}</td>
                <td className="num">{unit ? C.fmtNum(_cv(unit)) + " " + c : "\u2014"}</td>
                <td className="num">{roll ? C.fmtNum(_cv(roll)) + " " + c : "\u2014"}</td>
                <td className="num">{C.fmtNum(_cv(amt))} {c}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="po-calc">
        <span>{t("li_total_qty")}: <strong>{C.fmtNum(totals.qty)}</strong></span>
        <span>{t("li_volume_sqm")}: <strong>{C.fmtNum(totals.sqm)}</strong></span>
        <span>{t("li_total")}: <strong>{C.fmtMoneyFull(totals.value, cur)}</strong></span>
      </div>
    </section>
  );
}
function GroupChevron({ open }) {
  return <span className={"grp-chevron" + (open ? " open" : "")} aria-hidden="true">▸</span>;
}

Object.assign(window, { catalogueFor, AppProvider, useApp, StageBadge, ProjStageBadge, GroupBadge, Avatar, OwnerChip, Modal, Field, FilterSelect, MoreMenu, ProjectLinkField, Icon, ICONS, LoginScreen, ResetPasswordScreen, Shell, readPhoto, useRowSelection, SelectAllCheck, RowCheck, BulkBar, ImportDrop, ImportSheetPicker, GenericImportModal, ProductLineItems, LineItemsView, SkuInput, CodeCombo, StructCombo, lineItemTotals, lineTierQty, lineEffUnitPrice, lineValueEff, lineRollPrice, lineAreaPerRoll, lineUnitPrice, groupByCustomer, groupByCompany, useGroupToggle, GroupChevron, MembersAllowedControl, useSort, SortTh, SortMenu });
