// Todaytec CRM — PO List tab
const PO = window.CRM;

// Limit a PIC/owner code list to reps assigned to the record's country (falls back
// to the full list when none match / country unknown); always keeps the current value.
function picScope(list, country, _rc, current) {
  const arr = list || [];
  const keep = arr.filter(o => o.global || !country || !o.country || o.country === country);
  const codes = [...new Set((keep.length ? keep : arr).map(o => o.code))];
  return (current && !codes.includes(current)) ? [current, ...codes] : codes;
}

// Customer group is stored on the customer as either a single-letter id ("A".."G")
// OR, from Excel imports, a full label ("A - Big & Regular", "D– Repeat Order",
// "F – Inactive", "DE"…). The group badge/picker matches on the id, so normalise any
// value down to its leading A–G letter before display — otherwise a labelled group
// shows the empty "+ Customer group" placeholder even though it IS set.
const normGrpId = (g) => PO.normGroup(g);

// Inline customer-group tag: shows the colored badge; clicking it opens a native
// picker to (re)assign the customer group right from the PO list.
function GroupTagSelect({ group, onChange, t }) {
  const g = PO.GROUPS.find(x => x.id === group);
  return (
    <span className="grp-tag-edit" onClick={e => e.stopPropagation()}>
      {g ? (
        <span className="badge" style={{ color: g.color, background: g.color + "14", borderColor: g.color + "40" }}>
          <span className="badge-dot" style={{ background: g.color }}></span>{g.label}
        </span>
      ) : (
        <span className="badge grp-tag-empty">+ {t("pol_group")}</span>
      )}
      <select value={group || ""} onChange={e => onChange(e.target.value)} aria-label={t("pol_group")}>
        <option value="">—</option>
        {PO.GROUPS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </span>
  );
}

// A "PO" is one PO NUMBER, not one product line — the same key the grouped tables use, so
// counts on the KPI cards, the header and the customer rows all agree.
function poKeyOf(p) { const n = (p.poNumber || "").trim(); return n ? "PN:" + n : "ID:" + p.id; }
function uniqPoCount(list) { const s = new Set(); (list || []).forEach(p => s.add(poKeyOf(p))); return s.size; }
function groupPosByNumber(list) {
  const m = new Map();
  (list || []).forEach(p => { const k = poKeyOf(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
  return [...m.values()];
}
function computePoSeq(allPos) {
  const byCust = {};
  (allPos || []).forEach(p => { if (p.customerId) (byCust[p.customerId] = byCust[p.customerId] || []).push(p); });
  const map = {};
  Object.values(byCust).forEach(arr => {
    arr.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)))
      .forEach((p, i) => { map[p.id] = { orderCount: i + 1, newRepeat: i === 0 ? "New" : "Repeat" }; });
  });
  return map;
}

function _poDelta(cur, base) {
  if (!base) return { txt: "—", cls: "ov-sub-flat" };
  const d = Math.round((cur - base) / base * 100);
  return { txt: (d >= 0 ? "+" : "") + d + "%", cls: d > 0 ? "ov-sub-up" : d < 0 ? "ov-sub-down" : "ov-sub-flat" };
}
function _poPeriodStats(cur, prev, mi) {
  const _sum = (a, s, e) => { let tot = 0; for (let i = s; i <= e; i++) tot += a[i] || 0; return tot; };
  const mtd = cur[mi] || 0;
  const momBase = mi > 0 ? cur[mi - 1] : (prev[11] || 0);
  const qStart = Math.floor(mi / 3) * 3, qLen = mi - qStart + 1;
  const qtd = _sum(cur, qStart, mi);
  let pqArr = cur, pqStart = qStart - 3;
  if (pqStart < 0) { pqStart = 9; pqArr = prev; }
  const qoqBase = _sum(pqArr, pqStart, pqStart + qLen - 1);
  const ytd = _sum(cur, 0, mi), ytdPrev = _sum(prev, 0, mi);
  return { mtd, qtd, ytd, mom: _poDelta(mtd, momBase), qoq: _poDelta(qtd, qoqBase), yoy: _poDelta(ytd, ytdPrev) };
}
function PoKpiSub({ st, fmt }) {
  return (
    <div className="ov-kpi-sub">
      <div><span className="ov-sub-l">MTD</span><span className="ov-sub-v">{fmt(st.mtd)}</span></div>
      <div><span className="ov-sub-l">MoM</span><span className={"ov-sub-v " + st.mom.cls}>{st.mom.txt}</span></div>
      <div><span className="ov-sub-l">QTD</span><span className="ov-sub-v">{fmt(st.qtd)}</span></div>
      <div><span className="ov-sub-l">QoQ</span><span className={"ov-sub-v " + st.qoq.cls}>{st.qoq.txt}</span></div>
      <div><span className="ov-sub-l">YTD</span><span className="ov-sub-v">{fmt(st.ytd)}</span></div>
      <div><span className="ov-sub-l">YoY</span><span className={"ov-sub-v " + st.yoy.cls}>{st.yoy.txt}</span></div>
    </div>
  );
}

function POListPage({ openCustomer, selected, setSelected, presetFromQuote, clearPresetFromQuote, presetDates, clearPresetDates }) {
  const { t, isBoss, isCountryMgr, scopePOs: scopePOsRaw, scopeCustomers, visibleCountries, countryFilter, picFilterCodes, backfillPOPrices, cleanupPODuplicates, posLoad, teamCodes, user, customers, users, currency, setCurrency, money, pos, canExport, canEdit, canDelete: canDeletePerm, deletePOs, deletePORecords, updateCustomer, canonCode, lvlOr } = useApp();
  const moneyFull = (v) => PO.fmtMoneyFull(v, currency);
  // per-m² / per-roll prices are tiny in THB or USD — rounding them to whole VND first
  // printed "0.00", so they format straight from the raw value with adaptive decimals
  const moneyFine = (v) => {
    const cc = PO.CURRENCIES[currency] || PO.CURRENCIES.VND;
    const x = (v || 0) / cc.rate;
    if (!x) return "—";
    const ax = Math.abs(x);
    const d = ax < 1 ? 4 : ax < 100 ? 2 : 0;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(x);
  };
  const sel = useRowSelection();
  const canDelete = !!(canDeletePerm && canDeletePerm("polist"));
  const [q, setQ] = useState("");
  const [pic, setPic] = useState("");
  const [fixing, setFixing] = useState("");
  const [group, setGroup] = useState("");
  // Country comes from ONE place: the topbar filter. The page used to carry its own Country
  // dropdown, which could disagree with the topbar and list Vietnamese POs while the topbar
  // said Thailand.
  const poCountries = React.useMemo(() => {
    const c = PO.normCountry(countryFilter || "");
    return (c && c !== "All") ? [c] : [];
  }, [countryFilter]);
  // Display currency: see the srcCur block below the list — it follows the currency the POs
  // were ENTERED in before falling back to the market default.
  const curTouched = React.useRef(false);
  // Sales-date filter: Looker-style range control (presets + calendar + comparison range),
  // persisted per browser. Defaults to year-to-date.
  const { dateRange: dr, setDateRange: setDr, dateRangeR: drR } = useApp();
  const salesDateFrom = drR.from, salesDateTo = drR.to;
  const setRange = (from, to) => setDr(Object.assign({}, dr, { preset: (from || to) ? "custom" : "all", from, to }));
  // The server fetch must span the comparison window too, or the "vs" figures read 0.
  const fetchFrom = (drR.hasCmp && drR.cmpFrom && (!salesDateFrom || drR.cmpFrom < salesDateFrom)) ? drR.cmpFrom : salesDateFrom;
  const fetchTo = (drR.hasCmp && drR.cmpTo && (!salesDateTo || drR.cmpTo > salesDateTo)) ? drR.cmpTo : salesDateTo;
  // If the data has no PO in the current year yet (e.g. only imported history),
  // snap the default range to the latest year that DOES have POs so the list
  // isn't mysteriously empty on first open. Runs once, and never fights the user.
  const dateInit = React.useRef(false);
  useEffect(() => {
    if (dateInit.current || presetDates) return;
    if (!pos || !pos.length) return;
    if ((dr.preset || "") !== "ytd") { dateInit.current = true; return; }
    const thisYear = new Date().getFullYear();
    const hasThisYear = pos.some(p => +p.year === thisYear);
    if (!hasThisYear) {
      const maxYear = pos.reduce((m, p) => Math.max(m, +p.year || 0), 0);
      if (maxYear) setRange(maxYear + "-01-01", maxYear + "-12-31");
    }
    dateInit.current = true;
  }, [pos, presetDates]);
  const [creating, setCreating] = useState(!!presetFromQuote);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(false);
  const [shown, setShown] = useState(60); // paginate: render this many customer groups, "load more" extends
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleGroup = (id) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // ---- Server-backed working set (Phase 2): fetch ONLY the permission+date-scoped
  // slice from Supabase instead of holding the whole table in RAM. All the existing
  // in-RAM filtering / grouping / KPIs below then run on this bounded set unchanged.
  // Falls back to the RAM `pos` array when Supabase is unreachable (offline / preview).
  const [ws, setWs] = useState(null);            // working-set rows, or null => use RAM fallback
  const [wsTotal, setWsTotal] = useState(0);     // exact match count on the server
  const [wsCapped, setWsCapped] = useState(false);
  const [wsLoading, setWsLoading] = useState(true);
  const [wsProg, setWsProg] = useState({ n: 0, total: 0 });   // rows streamed / expected
  const [aggRows, setAggRows] = useState(null);  // po_agg rows (prev+cur year) for period KPIs
  const [reloadTick, setReloadTick] = useState(0);
  const scopeCustIds = React.useMemo(() => (scopeCustomers || []).map(c => c.id), [scopeCustomers]);
  const scopeCustKey = scopeCustIds.join(",");
  const teamKey = (teamCodes || []).join(",");
  React.useEffect(() => {
    let on = true; const SB = PO.SB;
    (async () => {
      setWsLoading(true); setWsProg({ n: 0, total: 0 });
      // Page-by-page progress so a large history shows a real bar instead of an empty table.
      const seenBy = [0, 0], totBy = [0, 0];
      const prog = (slot) => (n, total) => { if (!on) return; seenBy[slot] = n; totBy[slot] = total; setWsProg({ n: seenBy[0] + seenBy[1], total: totBy[0] + totBy[1] }); };
      try {
        const base = searchingAll
          ? { search: undefined, order: "date", dir: "desc" }   // a search is a LOOKUP: no date bound
          : { from: fetchFrom || undefined, to: fetchTo || undefined, order: "date", dir: "desc" };
        let rows, total, capped = false;
        if (isBoss) {
          const r = await SB.queryAll(base, 0, prog(0)); rows = r.rows; total = r.total; capped = r.capped;
        } else if (isCountryMgr) {
          if (!scopeCustIds.length) { rows = []; total = 0; }
          else { const r = await SB.queryAll(Object.assign({}, base, { customerIds: scopeCustIds }), 0, prog(0)); rows = r.rows; total = r.total; capped = r.capped; }
        } else {
          // rep: union of own-customers and team-PIC POs (two scoped fetches, merged by id)
          const jobs = [];
          if (scopeCustIds.length) jobs.push(SB.queryAll(Object.assign({}, base, { customerIds: scopeCustIds }), 0, prog(0)));
          if ((teamCodes || []).length) jobs.push(SB.queryAll(Object.assign({}, base, { pics: teamCodes }), 0, prog(1)));
          if (!jobs.length) { rows = []; total = 0; }
          else { const res = await Promise.all(jobs); const m = new Map(); res.forEach(r => r.rows.forEach(x => { if (x && x.id != null) m.set(x.id, x); })); rows = [...m.values()]; total = rows.length; capped = res.some(r => r.capped); }
        }
        if (!on) return;
        if (rows == null) throw new Error("no server rows");
        setWs(rows); setWsTotal(total); setWsCapped(!!capped);
      } catch (e) { if (on) { setWs(null); } }
      finally { if (on) setWsLoading(false); }
    })();
    return () => { on = false; };
  }, [isBoss, isCountryMgr, scopeCustKey, teamKey, fetchFrom, fetchTo, reloadTick, searchingAll]);
  // Period-KPI aggregate (previous + current year), summed server-side. Filtered by
  // permission + country in RAM (see poPeriods) — scales because it returns grouped
  // rows, never raw POs.
  React.useEffect(() => {
    let on = true; const cy = new Date().getFullYear();
    (async () => { try { const r = await PO.SB.aggRange((cy - 1) + "-01-01", cy + "-12-31"); if (on) setAggRows(Array.isArray(r) ? r : null); } catch (e) { if (on) setAggRows(null); } })();
    return () => { on = false; };
  }, [reloadTick]);
  // Refetch after returning from create / import / edit (server already updated per-row).
  const _busyRef = React.useRef(false);
  React.useEffect(() => {
    const busy = creating || importing || !!selected;
    if (_busyRef.current && !busy) setReloadTick(x => x + 1);
    _busyRef.current = busy;
  }, [creating, importing, selected]);

  useEffect(() => { if (presetFromQuote) setCreating(true); }, [presetFromQuote]);
  // jump-from-Overview: apply a preset sales-date range (MTD/QTD/YTD drill-down)
  useEffect(() => {
    if (presetDates) {
      setRange(presetDates.from || "", presetDates.to || "");
      clearPresetDates && clearPresetDates();
    }
  }, [presetDates]);

  // PIC filter lists accounts that exist in Permissions only (not raw pic strings from imports).
  // PIC filter: every non-deleted account by effective code (salesCode, or name for
  // BOD/admin accounts with no sales code, e.g. THUY). Live from `users` so new
  // accounts appear automatically.
  const pics = picFilterCodes || [];
  // O(1) customer lookup map instead of customers.find() per row (critical with thousands of POs)
  const custMap = React.useMemo(() => { const m = {}; customers.forEach(c => m[c.id] = c); return m; }, [customers]);
  const custOf = (id) => custMap[id];
  const picName = (code) => { if (!code) return "—"; const cc = canonCode(code).toUpperCase(); const u = (users || []).find(x => !x._deleted && ((x.salesCode || "").toUpperCase() === cc || (x.name || "").toUpperCase() === cc)); return u ? (u.shortName || u.name || code) : code; };

  const poCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const countryOfCust = (id) => { const c = custMap[id]; return c ? window.CRM.normCountry(c.country) : ""; };
  const allCountries = React.useMemo(() => (visibleCountries && visibleCountries.length ? visibleCountries : (PO.MARKETS || ["Vietnam", "Thailand"])).slice().sort((a, b) => poCountryRank(a) - poCountryRank(b)), [visibleCountries]);
  const allowC = (cn) => poCountries.length === 0 || poCountries.includes(cn);
  // Data source: server working set when loaded, else the RAM array (fallback / first paint).
  // Server rows arrive RAW, so they need the same customer-derived overlay the RAM array
  // already has (owner → Sales PIC, customer group → group); otherwise a PO whose own
  // `pic` was never filled by the import shows "—" even though its customer has an Owner.
  const srcPOs = React.useMemo(() => {
    const raw = (ws != null) ? ws : scopePOsRaw;
    if (ws == null) return raw;
    return raw.map(p => {
      const c = custMap[p.customerId];
      if (!c) { const ng = normGrpId(p.group); return ng && ng !== p.group ? { ...p, group: ng } : p; }
      const pic = canonCode(c.owner || p.pic || "");
      const group = normGrpId(c.group) || normGrpId(p.group) || "";
      return (pic === String(p.pic || "").trim() && group === (p.group || "")) ? p : { ...p, pic, group };
    });
  }, [ws, scopePOsRaw, custMap, canonCode]);
  const scopePOs = React.useMemo(() => srcPOs.filter(p => allowC(countryOfCust(p.customerId))), [srcPOs, poCountries, custMap]);
  // New/Repeat sequence: prefer the full RAM history when present; else the working set.
  const poSeqSrc = (pos && pos.length) ? pos : (ws || []);
  const poSeq = React.useMemo(() => computePoSeq(poSeqSrc), [poSeqSrc]);
  const poNR = (p) => poSeq[p.id] || { orderCount: 1, newRepeat: "New" };

  // Non-date filters, shared by the visible list and by the comparison window so both
  // sides of a "vs previous period" read the same slice of data.
  const passNonDate = React.useCallback((p) => {
    if (pic && canonCode(p.pic).toUpperCase() !== canonCode(pic).toUpperCase()) return false;
    if (group) { const c = custMap[p.customerId]; const eff = normGrpId((c && c.group) || p.group || ""); if (eff !== group) return false; }
    const qq = q.trim().toLowerCase();
    if (qq) {
      const c = custMap[p.customerId];
      const hay = (p.poNumber + " " + p.commercial + " " + (c ? c.name + " " + c.shortName + " " + c.bizId : "")).toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  }, [pic, group, q, custMap, canonCode]);
  const inWin = (d, a, b) => (!a && !b) ? true : (!!d && (!a || d >= a) && (!b || d <= b));
  // A typed search is a LOOKUP across all history: the server fetch drops its date bound and
  // the RAM filter below skips the window, so a 2025 PO is findable under a 2026 range.
  const [qDeb, setQDeb] = useState("");
  useEffect(() => { const h = setTimeout(() => setQDeb(q.trim()), 400); return () => clearTimeout(h); }, [q]);
  const searchingAll = qDeb.length >= 2;
  // While searching, the date range is ignored so a PO can always be found by number or
  // company — otherwise a 2025 PO is invisible under a 2026 range.
  const list = React.useMemo(() => scopePOs
    .filter(p => passNonDate(p) && (searchingAll || inWin(p.date, salesDateFrom, salesDateTo)))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")), [scopePOs, passNonDate, salesDateFrom, salesDateTo, searchingAll]);
  const poCount = React.useMemo(() => uniqPoCount(list), [list]);
  // A Thai order sheet imported in USD must read back in USD, not silently converted to baht.
  // So the display currency follows the DATA: when the POs in view overwhelmingly share one
  // source currency (srcCurrency, kept at import), that one wins; only a mixed or unlabelled
  // set falls back to the market default. Touching the dropdown pins the choice for good.
  const srcCur = React.useMemo(() => {
    const by = {}; let tot = 0;
    scopePOs.forEach(p => {
      const c = p.srcCurrency; if (!c || !PO.CURRENCIES[c]) return;
      const a = Math.abs(p.amountVnd || 0); if (!a) return;
      by[c] = (by[c] || 0) + a; tot += a;
    });
    const top = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
    return (top && tot > 0 && by[top] / tot >= 0.8) ? top : "";
  }, [scopePOs]);
  useEffect(() => {
    if (curTouched.current) return;
    if (srcCur) { setCurrency(srcCur); return; }
    if (poCountries.length === 1 && poCountries[0] === "Thailand") setCurrency("THB");
    else setCurrency("VND");
  }, [poCountries, srcCur]);
  // Current window vs comparison window (same filters, different dates).
  const cmpStats = React.useMemo(() => {
    if (!drR.hasCmp) return null;
    const cur = { n: 0, amt: 0, sqm: 0 }, prev = { n: 0, amt: 0, sqm: 0 };
    list.forEach(p => { cur.amt += p.amountVnd || 0; cur.sqm += p.sqm || 0; });
    cur.n = uniqPoCount(list);
    const prevRows = scopePOs.filter(p => passNonDate(p) && inWin(p.date, drR.cmpFrom, drR.cmpTo));
    prevRows.forEach(p => { prev.amt += p.amountVnd || 0; prev.sqm += p.sqm || 0; });
    prev.n = uniqPoCount(prevRows);
    return { cur, prev };
  }, [list, scopePOs, passNonDate, drR.hasCmp, drR.cmpFrom, drR.cmpTo]);

  React.useEffect(() => { setShown(60); sel.clear(); }, [pic, group, salesDateFrom, salesDateTo, q, poCountries]);
  // group filtered POs by PARENT company (Name Code) + customer group, newest first.
  // Multiple customer records sharing the same Name Code AND the same customer
  // group merge into one expandable row (companyCount badge shows the count).
  const groups = React.useMemo(() => {
    const m = {};
    list.forEach(p => {
      const c = custMap[p.customerId];
      const code = PO.nameCodeKey(PO.nameCodeOf(c || {})) || p.customerId;
      // One row per Name Code: its companies may sit in different customer groups, the row
      // shows the representative company's group (the badge edits every member).
      const key = code;
      (m[key] = m[key] || []).push(p);
    });
    return Object.entries(m).map(([key, arr]) => {
      const memberCustomerIds = [...new Set(arr.map(p => p.customerId))];
      const byCust = {};
      arr.forEach(p => { byCust[p.customerId] = (byCust[p.customerId] || 0) + 1; });
      const headId = memberCustomerIds.find(id => /head\s*office/i.test((custMap[id] || {}).name || ""));
      const customerId = headId || memberCustomerIds.slice().sort((a, b) => (byCust[b] || 0) - (byCust[a] || 0))[0];
      const repC = custMap[customerId];
      return {
        key, customerId, memberCustomerIds, companyCount: memberCustomerIds.length,
        nameCode: PO.nameCodeOf(repC || {}),
        pos: arr,
        poCount: uniqPoCount(arr),
        total: arr.reduce((s, p) => s + (p.amountVnd || 0), 0),
        lastDate: arr.map(p => p.date || "").sort().slice(-1)[0] || "",
        pics: [...new Set(arr.map(p => String(p.pic || "").trim()).filter(Boolean))],
        group: normGrpId((repC && repC.group) || arr[0].group),
      };
    }).sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
  }, [list, custMap]);
  const sort = useSort(null, "asc");
  const poGroupAcc = {
    customer: g => g.nameCode || (custOf(g.customerId) ? (custOf(g.customerId).shortName || custOf(g.customerId).name) : ""),
    group: g => g.group || "",
    total: g => g.total,
    count: g => g.poCount,
    pic: g => g.pics.join(","),
    date: g => g.lastDate || "",
  };
  const poSortCols = [
    { key: "customer", label: t("pol_customer") },
    { key: "group", label: t("pol_group") },
    { key: "total", label: t("pol_total_amount") },
    { key: "count", label: t("pol_count") },
    ...(isBoss ? [{ key: "pic", label: t("pol_pic") }] : []),
    { key: "date", label: t("pol_sales_date") },
  ];
  const sortedGroups = sort.sort.key ? sort.apply(groups, poGroupAcc) : groups;
  const visibleGroups = sortedGroups.slice(0, shown);
  const visible = React.useMemo(() => visibleGroups.flatMap(g => g.pos), [visibleGroups]);
  const poColSpan = 5 + (isBoss ? 1 : 0) + (canDelete ? 1 : 0);

  const totalAmount = React.useMemo(() => list.reduce((s, p) => s + (p.amountVnd || 0), 0), [list]);
  const now = new Date().toISOString().slice(0, 7);
  // "This month" reflects the current calendar month WITHIN the active filter.
  const thisMonth = React.useMemo(() => list.filter(p => (p.date || "").slice(0, 7) === now), [list, now]);
  const thisMonthAmt = React.useMemo(() => thisMonth.reduce((s, p) => s + (p.amountVnd || 0), 0), [thisMonth]);
  const totalSqm = React.useMemo(() => list.reduce((s, p) => s + (p.sqm || 0), 0), [list]);

  // Period sub-metrics (MTD/MoM/QTD/QoQ/YTD/YoY) for the KPI cards
  const poPeriods = React.useMemo(() => {
    const _now = new Date();
    const cy = String(_now.getFullYear()), cm = _now.getMonth(), yPrev = String(_now.getFullYear() - 1);
    const mk = () => Array(12).fill(0);
    const cntC = mk(), cntP = mk(), amtC = mk(), amtP = mk(), sqmC = mk(), sqmP = mk();
    if (aggRows) {
      // Server aggregate path (scales to millions). Respect permission + country only —
      // same scope the RAM path (scopePOs) used, so the numbers match.
      const scopeSet = new Set(scopeCustIds);
      const teamU = new Set((teamCodes || []).map(x => String(x).toUpperCase()));
      aggRows.forEach(r => {
        let ok = isBoss || scopeSet.has(r.cust);
        if (!ok && !isBoss && !isCountryMgr) ok = teamU.has(String(r.pic || "").toUpperCase());
        if (!ok) return;
        if (!allowC(countryOfCust(r.cust))) return;
        const mi = (parseInt(r.mo, 10) || 0) - 1; if (mi < 0 || mi > 11) return;
        const amount = Number(r.amount || 0), sqm = Number(r.sqm || 0), cnt = Number(r.cnt || 0);
        if (r.yr === cy) { cntC[mi] += cnt; amtC[mi] += amount; sqmC[mi] += sqm; }
        else if (r.yr === yPrev) { cntP[mi] += cnt; amtP[mi] += amount; sqmP[mi] += sqm; }
      });
    } else {
      scopePOs.forEach(p => {
        const mi = (p.month || 0) - 1; if (mi < 0 || mi > 11) return;
        const y = String(p.year);
        if (y === cy) { cntC[mi]++; amtC[mi] += p.amountVnd || 0; sqmC[mi] += p.sqm || 0; }
        else if (y === yPrev) { cntP[mi]++; amtP[mi] += p.amountVnd || 0; sqmP[mi] += p.sqm || 0; }
      });
    }
    return {
      count: _poPeriodStats(cntC, cntP, cm),
      amount: _poPeriodStats(amtC, amtP, cm),
      sqm: _poPeriodStats(sqmC, sqmP, cm),
    };
  }, [aggRows, scopePOs, isBoss, isCountryMgr, scopeCustKey, teamKey, poCountries, custMap]);

  if (selected) return <POProfile id={selected} onBack={() => setSelected(null)} openCustomer={openCustomer} />;
  if (creating) return <POFormModal asPage presetFromQuote={presetFromQuote} onClose={() => { setCreating(false); clearPresetFromQuote && clearPresetFromQuote(); }} />;

  return (
    <div className="page">
      {cmpStats && <DrCompareBar range={drR} metrics={[
        { label: t("pol_count"), cur: cmpStats.cur.n, prev: cmpStats.prev.n, fmt: v => PO.fmtNum(v) },
        { label: t("pol_total_amount"), cur: cmpStats.cur.amt, prev: cmpStats.prev.amt, fmt: v => moneyFull(v) },
        { label: t("pol_sqm"), cur: cmpStats.cur.sqm, prev: cmpStats.prev.sqm, fmt: v => PO.fmtNum(Math.round(v)) },
      ]} />}
      <header className="page-head list-head">
        <div>
          <h1>{t("pol_title")}</h1>
          <p className="page-sub">{wsCapped ? (PO.fmtNum(poCount) + " / " + PO.fmtNum(wsTotal)) : PO.fmtNum(poCount)} {t("pol_count")} · {PO.fmtNum(list.length)} {t("pol_lines")} · {money(totalAmount)}{searchingAll ? <span className="dim"> · {t("pol_search_all_time")}</span> : null}{wsLoading ? <span className="dim"> · {t("loading") || "…"}</span> : null}</p>
        </div>
        <div className="head-actions">
          {canExport && canExport("polist") && <ExportMenu name="po_list"
            all={scopePOs} filtered={list} page={visible}
            map={p => {
              const c = customers.find(x => x.id === p.customerId) || {};
              const nr = poNR(p);
              const _codes = (p.items && p.items.length) ? p.items.map(it => it.structureCode || it.sku).filter(Boolean) : [];
              const _area = (p.sqm && p.qty) ? p.sqm / p.qty : ((p.width || 0) / 1000) * (p.length || 0);
              const _unit = (_area && p.qty && p.amountVnd) ? Math.round(p.amountVnd / (_area * p.qty)) : "";
              return {
                po_number: p.poNumber || p.id,
                customer: c.name,
                customer_short: c.shortName,
                business_id: c.bizId,
                country: c.country,
                pic: p.pic,
                group: p.group,
                sales_date: p.date,
                po_date: p.poDate,
                product: p.commercial,
                structure_code: _codes.length ? _codes.join(" | ") : (p.structureCode || ""),
                grade: p.grade,
                width_mm: p.width,
                length_m: p.length,
                qty: p.qty,
                unit: p.unit,
                unit_price_sqm: _unit,
                roll_price: (_unit && _area) ? Math.round(_unit * _area) : "",
                amount_vnd: p.amountVnd,
                vnd_per_roll: p.qty ? Math.round(p.amountVnd / p.qty) : "",
                vnd_per_sqm: p.sqm ? Math.round(p.amountVnd / p.sqm) : "",
                sqm: p.sqm,
                usd: p.amountVnd ? Math.round(p.amountVnd / PO.USD_RATE * 100) / 100 : "",
                inv_no: p.invNo,
                edp_code: p.edpCode,
                new_repeat: nr.newRepeat,
                order_count: nr.orderCount,
                order_type: p.orderType,
                quote_ref: p.quoteRef,
                warning: p.warning,
              };
            }} />}
          {lvlOr("polist", "admin", true) && <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("pol_import_excel")}</button>}
          {lvlOr("polist", "edit", true) && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon d={ICONS.plus} size={15} /> {t("pol_new")}</button>}
          {lvlOr("polist", "admin", isBoss) && <MoreMenu busy={fixing} items={[
            { key: "fix", label: t("pol_fix_prices"), title: t("pol_fix_prices_hint"), icon: ICONS.refresh, disabled: !!fixing,
              onClick: async () => {
                if (fixing) return;
                if (!window.confirm(t("pol_fix_prices_confirm"))) return;
                setFixing(t("loading"));
                try {
                  const r = await backfillPOPrices(p => setFixing(p.phase === "read" ? PO.fmtNum(p.n) + "…" : PO.fmtNum(p.n) + "/" + PO.fmtNum(p.total)));
                  window.alert(t("pol_fix_prices_done").replace("{n}", PO.fmtNum(r.patched)).replace("{tot}", PO.fmtNum(r.scanned)));
                } catch (e) { window.alert(String(e && e.message || e)); }
                setFixing("");
              } },
            { key: "dedupe", label: t("pol_dedupe"), title: t("pol_dedupe_hint"), icon: ICONS.refresh, disabled: !!fixing,
              onClick: async () => {
                if (fixing) return;
                setFixing(t("loading"));
                try {
                  // Dry run first: nothing is written until the exact counts are confirmed.
                  const dry = await cleanupPODuplicates(pg => setFixing(pg.phase === "read" ? PO.fmtNum(pg.n) + "…" : PO.fmtNum(pg.n) + "/" + PO.fmtNum(pg.total)), { dryRun: true });
                  setFixing("");
                  if (!dry.removed && !dry.fixed) { window.alert(t("pol_dedupe_none").replace("{tot}", PO.fmtNum(dry.scanned))); return; }
                  const msg = t("pol_dedupe_confirm").replace("{n}", PO.fmtNum(dry.removed)).replace("{f}", PO.fmtNum(dry.fixed)).replace("{tot}", PO.fmtNum(dry.scanned));
                  if (!window.confirm(msg)) return;
                  setFixing(t("loading"));
                  const r = await cleanupPODuplicates(pg => setFixing(pg.phase === "read" ? PO.fmtNum(pg.n) + "…" : PO.fmtNum(pg.n) + "/" + PO.fmtNum(pg.total)));
                  window.alert(t("pol_dedupe_done").replace("{n}", PO.fmtNum(r.removed)).replace("{f}", PO.fmtNum(r.fixed)).replace("{tot}", PO.fmtNum(r.scanned)));
                } catch (e) { window.alert(String(e && e.message || e)); }
                setFixing("");
              } },
          ]} />}
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("cu_company") + " / PO / Business ID…"} />
        </div>
        {(isBoss || isCountryMgr) && <FilterSelect value={pic} onChange={setPic} options={pics} allLabel={t("pol_pic") + ": " + t("all")} />}
        <select className="select" value={group} onChange={e => setGroup(e.target.value)}>
          <option value="">{t("pol_group")}: {t("all")}</option>
          {PO.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <select className="select list-ccy" value={currency} onChange={e => { curTouched.current = true; setCurrency(e.target.value); }}>
          {Object.keys(PO.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <SortMenu columns={poSortCols} sort={sort.sort} onSort={sort.onSort} />
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-label">{t("pol_count")}</span>
          <span className="kpi-value">{PO.fmtNum(poCount)}</span>
          <span className="kpi-foot">{PO.fmtNum(list.length)} {t("pol_lines")}</span>
          <PoKpiSub st={poPeriods.count} fmt={PO.fmtNum} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("pol_total_amount")}</span>
          <span className="kpi-value kpi-money">{money(totalAmount)}</span>
          <PoKpiSub st={poPeriods.amount} fmt={money} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("pol_this_month")}</span>
          <span className="kpi-value kpi-money" style={{ color: "var(--teal-dark)" }}>{money(thisMonthAmt)}</span>
          <PoKpiSub st={poPeriods.amount} fmt={money} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("pol_sqm")}</span>
          <span className="kpi-value">{PO.fmtNum(totalSqm)}</span>
          <PoKpiSub st={poPeriods.sqm} fmt={PO.fmtNum} />
        </div>
      </div>

      {(wsLoading || (posLoad && posLoad.loading)) && (() => {
        const n = wsProg.total ? wsProg.n : (posLoad ? posLoad.n : 0);
        const tot = wsProg.total || (posLoad ? posLoad.total : 0);
        const pct = tot > 0 ? Math.min(100, Math.round(n / tot * 100)) : 0;
        return (
          <div className="load-overlay">
            <div className="load-box">
              <strong>{t("pol_loading_title")}</strong>
              <div className={"load-bar" + (tot > 0 ? "" : " indet")}>{tot > 0 ? <i style={{ width: pct + "%" }} /> : <i />}</div>
              <div className="load-num">{tot > 0 ? PO.fmtNum(n) + " / " + PO.fmtNum(tot) + " " + t("pol_count") : t("loading")}</div>
            </div>
          </div>
        );
      })()}
      {wsCapped && <div className="import-warn" style={{ margin: "0 0 12px" }}>{(t("pol_capped") || "Showing the latest {n} of {tot} — narrow the date range to see the rest.").replace("{n}", PO.fmtNum(list.length)).replace("{tot}", PO.fmtNum(wsTotal))}</div>}
      <div className="card table-card ret-acc-card">
        <table className="table ret-acc-table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={list.map(p => p.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <SortTh label={t("pol_customer")} sortKey="customer" sort={sort.sort} onSort={sort.onSort} />
              <SortTh label={t("pol_group")} sortKey="group" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              <SortTh label={t("pol_total_amount") + " (" + currency + ")"} sortKey="total" sort={sort.sort} onSort={sort.onSort} className="cell-money" align="right" />
              <SortTh label={t("pol_count")} sortKey="count" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              {isBoss && <SortTh label={t("pol_pic")} sortKey="pic" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />}
              <th style={{ textAlign: "center" }}>{t("ret_detail_col")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map(g => {
              const c = custOf(g.customerId);
              const isOpen = expanded.has(g.key);
              const groupIds = g.pos.map(p => p.id);
              return (
                <React.Fragment key={g.key}>
                  <tr className={"ret-acc-row row-click" + (isOpen ? " open" : "")} onClick={() => toggleGroup(g.key)}>
                    {canDelete && <td className="col-check" onClick={e => e.stopPropagation()}><SelectAllCheck ids={groupIds} selected={sel.selected} toggleAll={sel.toggleAll} /></td>}
                    <td>
                      <div className="ret-cust-cell">
                        <button className={"ret-exp-btn" + (isOpen ? " open" : "")} aria-label="expand"
                          onClick={e => { e.stopPropagation(); toggleGroup(g.key); }}>
                          <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                        </button>
                        <div>
                          <strong className="cell-main">{g.nameCode || (c ? (c.shortName || c.name) : "—")}{g.companyCount > 1 && <span className="nc-chip" style={{ marginLeft: 6 }}>{g.companyCount} {t("nc_companies")}</span>}</strong>
                          <div className="ret-cust-tags">
                            <span className="ret-cust-meta">{g.poCount} {t("pol_count")} · {PO.fmtDate(g.lastDate)}{g.companyCount === 1 && c && c.bizId ? " · " + c.bizId : ""}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* the editable badge stops its own clicks; the rest of the cell expands the row */}
                    <td className="hide-sm">
                      {(canEdit && (canEdit("customers") || canEdit("polist")))
                        ? <GroupTagSelect group={g.group} t={t} onChange={(val) => g.memberCustomerIds.forEach(id => updateCustomer(id, { group: val }, "Customer group → " + (val || "—")))} />
                        : <GroupBadge group={g.group} />}
                    </td>
                    <td className="cell-money">{moneyFull(g.total)}</td>
                    <td className="hide-sm">{g.poCount}</td>
                    {isBoss && <td className="hide-sm"><span className="owner-chip">{g.pics.map(picName).join(", ") || "—"}</span></td>}
                    <td style={{ textAlign: "center" }}>
                      <button className="ret-detail-link" onClick={e => { e.stopPropagation(); openCustomer && openCustomer(g.customerId); }}>
                        {t("cu_profile")} →
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="ret-sub-cell" colSpan={poColSpan}>
                      <div className={"ret-sub-wrap" + (isOpen ? " open" : "")}>
                        <div className="ret-sub-inner">
                          {isOpen && (
                            <table className="ret-sub-table">
                              <thead>
                                <tr>
                                  {canDelete && <th style={{ width: 30 }}></th>}
                                  <th>{t("pol_sales_date")}</th>
                                  <th>{t("pol_po_no")}</th>
                                  <th>{t("pol_structure")}</th>
                                  <th className="num">{t("pol_qty")}</th>
                                  <th className="num">{t("li_price")}</th>
                                  <th className="num">{t("pd_roll_price")}</th>
                                  <th className="num">{t("pol_amount")}</th>
                                  <th>{t("pol_new_repeat")}</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupPosByNumber(g.pos).map(recs => {
                                  const rp = recs[0];
                                  const gIds = recs.map(x => x.id);
                                  const gQty = recs.reduce((s, x) => s + (x.qty || 0), 0);
                                  const gAmt = recs.reduce((s, x) => s + (x.amountVnd || 0), 0);
                                  const nr = poNR(rp);
                                  const skuLines = recs.flatMap(rec => {
                                    const flatArea = (parseFloat(rec.sqmPerRoll) || 0) > 0 ? parseFloat(rec.sqmPerRoll) : ((parseFloat(rec.width) || 0) / 1000) * (parseFloat(rec.length) || 0);
                                    // The PO VALUE is the trusted figure, so roll price and unit price are
                                    // solved back from it: roll = value / qty, unit = roll / area per roll.
                                    if (rec.items && rec.items.length) return rec.items.map(it => {
                                      const q = parseFloat(it.qty) || 0, area = lineAreaPerRoll(it) || flatArea;
                                      let amt = (it.amountVnd != null && +it.amountVnd) ? +it.amountVnd : 0;
                                      if (!amt) amt = Math.round(lineRollPrice(it) * q);
                                      const roll = (amt && q > 0) ? amt / q : lineRollPrice(it);
                                      const unit = area > 0 ? roll / area : lineUnitPrice(it);
                                      return { code: it.structureCode || it.sku || it.productCode || PO.cleanCode(rec.commercial) || rec.materialName || "—", qty: q, unit, roll, amt, w: it.width, l: it.length, grade: it.grade };
                                    });
                                    const q = parseFloat(rec.qty) || 0, amt = rec.amountVnd || 0;
                                    const roll = q > 0 ? amt / q : 0;
                                    const unit = flatArea > 0 ? roll / flatArea : 0;
                                    return [{ code: rec.structureCode || rec.commercial, qty: q, unit, roll, amt, w: rec.width, l: rec.length, grade: rec.grade }];
                                  });
                                  return (
                                  <React.Fragment key={rp.id}>
                                    {skuLines.map((ln, li) => (
                                    <tr key={rp.id + "-" + li} className={gIds.some(id => sel.isSel(id)) ? "row-selected" : ""}>
                                      {canDelete && <td onClick={e => e.stopPropagation()}>{li === 0 ? <input type="checkbox" className="row-check" checked={gIds.every(id => sel.isSel(id))} ref={el => { if (el) el.indeterminate = gIds.some(id => sel.isSel(id)) && !gIds.every(id => sel.isSel(id)); }} onChange={() => { const allOn = gIds.every(id => sel.isSel(id)); gIds.forEach(id => { const on = sel.isSel(id); if (allOn && on) sel.toggle(id); else if (!allOn && !on) sel.toggle(id); }); }} aria-label="select" /> : null}</td>}
                                      <td>{li === 0 ? PO.fmtDate(rp.date) : ""}</td>
                                      <td>{li === 0 ? (rp.poNumber || "—") : ""}</td>
                                      <td><span className="ret-prod-code">{ln.code}</span>{(ln.w || ln.l || ln.grade) ? <span className="ret-sub-micro">{ln.w}×{ln.l}{ln.grade ? " · " + ln.grade : ""}</span> : null}</td>
                                      <td className="num">{PO.fmtNum(ln.qty)} <small className="dim">{PO.unitLabel(rp.unit, t)}</small></td>
                                      <td className="num">{ln.unit ? moneyFine(ln.unit) : "—"}</td>
                                      <td className="num">{ln.roll ? moneyFine(ln.roll) : "—"}</td>
                                      <td className="num">{moneyFull(ln.amt)}</td>
                                      <td>{li === 0 ? <span><span className={"nr-pill" + (nr.newRepeat === "New" ? " nr-new" : "")}>{nr.newRepeat}</span> <small className="dim">#{nr.orderCount}</small></span> : null}</td>
                                      <td>{li === 0 ? <button className="ret-detail-link" onClick={() => setSelected ? setSelected(rp.id) : setDetail(rp.id)}>{t("ret_view_detail")} →</button> : null}</td>
                                    </tr>
                                    ))}
                                    {skuLines.length > 1 && (
                                    <tr className="ret-po-subtotal">
                                      {canDelete && <td></td>}
                                      <td></td>
                                      <td colSpan={2} style={{ textAlign: "right", fontWeight: 700, color: "var(--navy)" }}>Σ {rp.poNumber}</td>
                                      <td className="num" style={{ fontWeight: 700 }}>{PO.fmtNum(gQty)}</td>
                                      <td></td>
                                      <td></td>
                                      <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>{moneyFull(gAmt)}</td>
                                      <td></td>
                                      <td></td>
                                    </tr>
                                    )}
                                  </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
            {groups.length === 0 && <tr><td colSpan={poColSpan} className="empty">
              {t("pol_no_pos")}
              {(salesDateFrom || salesDateTo || pic || group || q) ?
                <div style={{ marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => { setRange("", ""); setPic(""); setGroup(""); setQ(""); }}>{t("ret_reset_all")}</button></div>
                : null}
            </td></tr>}
          </tbody>
        </table>
        {visibleGroups.length < groups.length && (
          <div className="load-more-bar">
            <button className="btn btn-ghost" onClick={() => setShown(s => s + 60)}>
              {t("pol_load_more")} ({visibleGroups.length}/{groups.length})
            </button>
          </div>
        )}
      </div>

      {canDelete && <BulkBar count={sel.count} noun={t("pol_count")} allIds={list.map(p => p.id)} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={() => crmConfirm(t("bulk_confirm"), () => {
        const idset = sel.selected;
        const recs = []; const seen = new Set();
        (visible || []).concat(ws || []).forEach(p => { if (p && idset.has(p.id) && !seen.has(p.id)) { seen.add(p.id); recs.push(p); } });
        deletePORecords(recs);
        setWs(cur => Array.isArray(cur) ? cur.filter(r => !idset.has(r.id)) : cur);
        setWsTotal(x => Math.max(0, x - recs.length));
        sel.clear(); setReloadTick(x => x + 1);
      })} onClear={sel.clear} />}
      {detail && <PODetailModal id={detail} onClose={() => setDetail(null)} openCustomer={openCustomer} />}
      {importing && <POImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

/* ---- Input history: every stored record behind one PO number, tombstones included ----
   Answers the question a merged PO always raises — "are these two lines one line entered
   twice, or two real lines?" — by showing what is actually stored: which record holds
   which code, when it was written, and which ones were already removed. */
function POInputHistory({ po, t }) {
  const [rows, setRows] = useState(null);
  const key = (po && po.poNumber) || "";
  useEffect(() => {
    let on = true; setRows(null);
    PO.SB.poHistory(key, po && po.customerId, po && po.date).then(r => { if (on) setRows(r || []); });
    return () => { on = false; };
  }, [key, po && po.customerId]);
  const codeOf = (r) => PO.cleanCode(r.structureCode) || PO.cleanCode(r.commercial) || PO.cleanCode(r.materialName) || "—";
  const list = (rows || []).slice().sort((a, b) => String(a._updated || "").localeCompare(String(b._updated || "")));
  const live = list.filter(r => !r._deleted);
  // Two live records of one PO carrying the same size, qty and value are the same physical
  // line stored twice — the qty and the amount of this PO are then both doubled.
  const sig = (r) => [r.width || 0, r.length || 0, r.qty || 0, r.amountVnd || 0].join("/");
  const twin = live.length > 1 && live.some((r, i) => live.some((x, j) => j > i && sig(x) === sig(r) && codeOf(x) !== codeOf(r)));
  return (
    <section className="card" style={{ gridColumn: "1/-1" }}>
      <h2>{t("pol_history")}</h2>
      <p className="status-hint" style={{ marginTop: -4 }}>{t("pol_history_hint")}</p>
      {rows === null ? <p className="status-hint">{t("loading")}</p> : !list.length ? <p className="status-hint">{t("pol_hist_none")}</p> : (
        <>
          {twin && <p className="import-warn" style={{ textAlign: "left" }}>{t("pol_hist_twin")}</p>}
          <table className="table table-plain qt-items-table">
            <thead><tr>
              <th>{t("pol_structure")}</th>
              <th className="num">{t("pol_qty")}</th>
              <th className="num">{t("pol_amount")}</th>
              <th>{t("pol_hist_when")}</th>
              <th>{t("pol_hist_by")}</th>
              <th>{t("pol_hist_state")}</th>
            </tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} style={r._deleted ? { opacity: 0.55 } : null}>
                  <td><strong>{codeOf(r)}</strong>
                    <small className="cell-sub">{r.id}{r.materialName && PO.cleanCode(r.materialName) !== codeOf(r) ? " · " + t("pol_hist_mapped") + " " + r.materialName : ""}</small></td>
                  <td className="num">{PO.fmtNum(r.qty || 0)}
                    <small className="cell-sub">{(r.width || 0) + "×" + (r.length || 0)}</small></td>
                  <td className="num">{PO.fmtNum(r.amountVnd || 0)}</td>
                  <td><small className="dim">{String(r._updated || "").replace("T", " ").slice(0, 16) || "—"}</small></td>
                  <td>{r._updatedBy ? <OwnerChip code={String(r._updatedBy).split(" · ")[0]} t={t} /> : <span className="dim">—</span>}
                    {String(r._updatedBy || "").indexOf(" · ") > 0 && <small className="cell-sub">{String(r._updatedBy).split(" · ").slice(1).join(" · ")}</small>}</td>
                  <td>{r._deleted ? <span className="tag">{t("pol_hist_deleted")}</span> : <span className="nr-pill">{t("pol_hist_live")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/* ---- PO full page (editable) ---- */
function POProfile({ id, onBack, openCustomer }) {
  const { t, user, isBoss, assignablePics, teamCodes, pos, updatePO, updateCustomer, customers, products, users, money, currency, repCountry } = useApp();
  const { deletePO, deletePORecords, lvlOr } = useApp();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(null);
  const [fetchedPO, setFetchedPO] = useState(null);
  const [sibRows, setSibRows] = useState(null);
  useEffect(() => {
    let on = true;
    (async () => {
      let base = pos.find(x => x.id === id);
      if (!base) { base = await PO.SB.poById(id); if (on && base) setFetchedPO(base); }
      const cid = base && base.customerId;
      if (cid) { try { const rows = await PO.SB.posForCustomers([cid]); if (on) setSibRows(rows); } catch (e) {} }
    })();
    return () => { on = false; };
  }, [id]);
  const p = pos.find(x => x.id === id) || fetchedPO;
  if (!p) return null;
  const c = customers.find(x => x.id === p.customerId);
  const inf = { orderCount: p.orderCount || 1, newRepeat: p.newRepeat || ((p.orderCount || 1) > 1 ? "Repeat" : "New") };
  // Own team's PO only (as before), and the account's level on PO List: edit / admin (delete).
  const ownPO = isBoss || (user.salesCode && teamCodes.includes(p.pic));
  const canEdit = ownPO && lvlOr("polist", "edit", true);
  const canDel = ownPO && lvlOr("polist", "admin", true);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const salesCodes = [...new Set(users.filter(u => u.salesCode).map(u => u.salesCode))];

  // A PO number can span several records (one per SKU, e.g. from import). Treat all
  // records sharing this PO number (+ customer) as ONE order — merge their line items.
  const poKey = (p.poNumber || "").trim();
  const siblings = poKey ? (sibRows || pos).filter(x => x.customerId === p.customerId && (x.poNumber || "").trim() === poKey) : [p];
  const mergedAmount = siblings.reduce((s, x) => s + (x.amountVnd || 0), 0);
  const mergedQty = siblings.reduce((s, x) => s + (x.qty || 0), 0);
  const mergedSqm = siblings.reduce((s, x) => s + (x.sqm || 0), 0);
  const _areaOfIt = (it) => { const spr = parseFloat(it.sqmPerRoll) || 0; if (spr > 0) return spr; return ((parseFloat(it.width) || 0) / 1000) * (parseFloat(it.length) || 0); };
  const _recPrice = (it, amt, q) => { const a = _areaOfIt(it); if (a > 0 && q > 0 && +amt > 0) return Math.round(amt / (a * q)); if (+it.price > 0) return it.price; if (+it.unitPrice > 0) return it.unitPrice; return ""; };
  const _buildItems = (rec) => (rec.items && rec.items.length)
    ? rec.items.map(it => ({ productId: it.productId || "", productCode: it.productCode || "", structureCode: it.structureCode || "", sku: it.sku || "", grade: it.grade || "", productType: it.productType || "FR", width: it.width ?? "", length: it.length ?? "", sqmPerRoll: it.sqmPerRoll ?? "", qty: it.qty ?? "", price: _recPrice(it, it.amountVnd, +it.qty), rollPrice: it.rollPrice ?? "", edpCode: it.edpCode || "", tierQty: 0, currency: "VND" }))
    : [{ productId: (catalogueFor(products, (customers.find(c => c.id === rec.customerId) || {}).country).find(x => x.name === rec.commercial) || {}).id || "", productCode: rec.productCode || "", structureCode: rec.structureCode || "", sku: PO.cleanCode(rec.commercial) || rec.structureCode || "", grade: rec.grade || "", productType: rec.productType || "FR", width: rec.width ?? "", length: rec.length ?? "", sqmPerRoll: rec.sqmPerRoll ?? "", qty: rec.qty ?? "", price: _recPrice(rec, rec.amountVnd, +rec.qty), rollPrice: rec.rollPrice ?? "", edpCode: rec.edpCode || "", tierQty: 0, currency: "VND" }];
  const mergedItems = siblings.flatMap(_buildItems);
  const mergedCodes = [...new Set(mergedItems.map(it => it.structureCode || it.sku).filter(Boolean))];
  // Delete matches Save: the PO is every record of this PO number for this customer, so a
  // delete removes all of them (Save already merges them into one).

  const startEdit = () => {
    setF({
      group: p.group, pic: p.pic, items: mergedItems, date: p.date, poDate: p.poDate, poNumber: p.poNumber || "",
      invNo: p.invNo || "", warning: p.warning || "",
    });
    setEdit(true);
  };
  const save = async () => {
    const dup = await PO.SB.poByInvoice(f.invNo, p.id);
    if (f.invNo && f.invNo.trim() && dup) { alert(t("inv_dup").replace("{n}", f.invNo.trim()).replace("{po}", dup.poNumber || dup.id)); return; }
    const items = (f.items || []).filter(it => (parseFloat(it.qty) || 0) > 0 && (it.sku || it.productId));
    const tt = lineItemTotals(items);
    const first = items[0] || {};
    updatePO(p.id, {
      group: f.group, pic: f.pic, date: f.date, poDate: f.poDate, poNumber: f.poNumber, invNo: f.invNo, warning: f.warning,
      commercial: items.map(it => it.sku).filter(Boolean).join(", ") || p.commercial,
      grade: first.grade || "", materialName: first.sku || "", productType: first.productType || "FR",
      unit: (first.productType === "JR" ? "Kg" : "Cuộn"),
      width: parseFloat(first.width) || 0, length: parseFloat(first.length) || 0,
      qty: tt.qty, amountVnd: tt.value, sqm: tt.sqm,
      items: items.map(it => ({ sku: it.sku, productId: it.productId, productCode: it.productCode || "", structureCode: it.structureCode || "", grade: it.grade, productType: it.productType || "FR", width: +it.width || 0, length: +it.length || 0, sqmPerRoll: it.sqmPerRoll ?? "", qty: +it.qty || 0, price: +it.price || 0, unitPrice: +it.price || 0, rollPrice: Math.round(lineRollPrice(it)) || 0, sqm: lineItemTotals([it]).sqm, amountVnd: lineValueEff(it) })),
      edpCode: first.edpCode || "",
      year: +(f.date || "").slice(0, 4) || p.year, month: +(f.date || "").slice(5, 7) || p.month,
    });
    deletePORecords(siblings.filter(x => x.id !== p.id));
    if (f.group !== p.group && p.customerId) updateCustomer(p.customerId, { group: f.group }, "PO " + (f.poNumber || p.id) + " · Group " + f.group);
    setEdit(false);
  };

  const usd = mergedAmount ? Math.round(mergedAmount / PO.USD_RATE * 100) / 100 : 0;
  const viewRows = [
    [t("pol_customer"), c ? (c.shortName || c.name) : "—"],
    [t("cu_biz_id"), c ? c.bizId : ""],
    [t("pol_pic"), p.pic],
    [t("pol_sales_date"), PO.fmtDate(p.date)],
    [t("pol_product"), mergedCodes.length ? mergedCodes.map((cc, ci) => <div key={ci}>{cc}</div>) : p.commercial], [t("pd_grade"), p.grade],
    [t("pol_width"), p.width], [t("pol_length"), p.length],
    [t("pol_qty"), PO.fmtNum(mergedQty) + " " + PO.unitLabel(p.unit, t)],
    [t("pol_amount"), PO.fmtMoneyFull(mergedAmount, currency)],
    [t("pd_as_entered"), (p.srcCurrency && p.srcCurrency !== currency && +p.srcAmount) ? PO.fmtNum(p.srcAmount) + " " + p.srcCurrency : ""],
    [t("pol_vnd_roll").replace("VND", currency), mergedQty ? PO.fmtMoneyFull(Math.round(mergedAmount / mergedQty), currency) : "—"],
    [t("pol_vnd_m2").replace("VND", currency), mergedSqm ? PO.fmtMoneyFull(Math.round(mergedAmount / mergedSqm), currency) : "—"],
    [t("pol_sqm"), PO.fmtNum(mergedSqm)],
    [t("pol_usd"), PO.fmtNum(usd)],
    [t("pol_po_no"), p.poNumber], [t("pol_po_date"), PO.fmtDate(p.poDate)],
    ["INV NO", p.invNo], ["EDP CODE", p.edpCode],
    [t("pol_new_repeat"), inf.newRepeat + " · #" + inf.orderCount],
    [t("pol_order_type"), p.orderType || ""],
    [t("pol_quote_ref"), p.quoteRef || ""],
    [t("pol_warning"), p.warning],
  ];

  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("pol_title")}</button>
      <header className="profile-head card">
        <div className="profile-id">
          <Avatar name={p.poNumber || p.id} size={52} />
          <div>
            <h1>{p.poNumber || p.id}</h1>
            <p className="profile-full">{PO.fmtDate(p.date)} · {mergedCodes.join(", ") || p.commercial}</p>
            <div className="profile-tags">
              <GroupBadge group={p.group} />
              <span className={"nr-pill" + (inf.newRepeat === "New" ? " nr-new" : "")}>{inf.newRepeat} · #{inf.orderCount}</span>
              {c && <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => openCustomer(p.customerId)}>{c.shortName || c.name} →</button>}
              <OwnerChip code={p.pic} t={t} />
            </div>
          </div>
        </div>
        <div className="profile-status">
          <strong className="cell-money" style={{ fontSize: 20 }}>{PO.fmtMoneyFull(mergedAmount, currency)}</strong>
          {canEdit && !edit && <button className="btn btn-primary btn-sm" onClick={startEdit}>{t("pd_edit")}</button>}
          {canDel && !edit && <button className="btn btn-danger btn-sm" onClick={() => crmConfirm(t("pol_del_po_confirm").replace("{po}", poKey || p.id).replace("{n}", String(mergedItems.length)), () => { deletePORecords(siblings); onBack(); })}>{t("pd_delete")}</button>}
        </div>
      </header>

      {!edit ? (
        <>
        <section className="card">
          <dl className="detail-grid">
            {viewRows.filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => (
              <div className="detail-item" key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {p.attachments && p.attachments.length > 0 && (
            <div className="attach-list" style={{ marginTop: 12 }}>
              <strong style={{ display: "block", marginBottom: 6 }}>{t("pol_attachments")}</strong>
              {p.attachments.map((a, i) => (
                <div className="attach-item" key={i}>
                  <Icon d={ICONS.file} size={14} />
                  <span>{a.name}</span>
                  <a className="link-btn" href={a.dataUrl} download={a.name}>{t("pol_attach_view")}</a>
                </div>
              ))}
            </div>
          )}
        </section>
        <LineItemsView items={mergedItems} t={t} cur={currency} vnd />
        <POInputHistory po={p} t={t} />
        </>
      ) : (
        <section className="card">
          <div className="form-grid">
            <Field label={t("pol_group")}>
              <select className="select" value={f.group} onChange={e => set("group", e.target.value)}>
                {PO.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <small className="status-hint">{t("pol_group_note")}</small>
            </Field>
            <Field label={t("pol_pic")}>
              {(isBoss || assignablePics.length > 1) ? (
                <select className="select" value={f.pic} onChange={e => set("pic", e.target.value)}>
                  {picScope(assignablePics, c && c.country, repCountry, f.pic).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : <input className="input" value={f.pic} disabled />}
            </Field>
            <Field label={t("pol_po_no")}>
              <input className="input" value={f.poNumber} onChange={e => set("poNumber", e.target.value)} />
            </Field>
            <div className="field" style={{ gridColumn: "1/-1" }}>
              <span className="field-label">{t("pol_product")} <em style={{ color: "var(--danger)", fontStyle: "normal" }}>*</em></span>
              <ProductLineItems items={f.items} onChange={v => set("items", v)} products={products} t={t} country={c && c.country} />
            </div>
            <Field label={t("pol_sales_date")}>
              <input className="input" type="date" value={f.date} onChange={e => set("date", e.target.value)} />
            </Field>
            <Field label={t("pol_po_date")}>
              <input className="input" type="date" value={f.poDate} onChange={e => set("poDate", e.target.value)} />
            </Field>
            <Field label={t("inv_label")} required>
              <input className={"input" + (PO.invInUse(f.invNo, pos, p.id) ? " invalid" : "")} type="number" value={f.invNo} onChange={e => set("invNo", e.target.value)} placeholder={t("inv_ph")} />
              {PO.invInUse(f.invNo, pos, p.id) && <div className="inv-warn"><Icon d={ICONS.alert} size={13} /> {t("inv_dup").replace("{n}", (f.invNo || "").trim()).replace("{po}", (PO.invInUse(f.invNo, pos, p.id).poNumber) || PO.invInUse(f.invNo, pos, p.id).id)}</div>}
            </Field>
            <Field label={t("pol_warning")}>
              <input className="input" value={f.warning} onChange={e => set("warning", e.target.value)} />
            </Field>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setEdit(false)}>{t("cancel")}</button>
            <button className="btn btn-primary" onClick={save}>{t("save")}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function PODetailModal({ id, onClose, openCustomer }) {
  const { t, pos, customers } = useApp();
  const [fetched, setFetched] = useState(null);
  useEffect(() => { let on = true; if (!pos.find(x => x.id === id)) { PO.SB.poById(id).then(d => { if (on) setFetched(d || null); }); } return () => { on = false; }; }, [id]);
  const p = pos.find(x => x.id === id) || fetched;
  if (!p) return null;
  const c = customers.find(x => x.id === p.customerId);
  const usd = p.amountVnd ? Math.round(p.amountVnd / PO.USD_RATE * 100) / 100 : 0;
  const rows = [
    [t("pol_customer"), c ? (c.shortName || c.name) : "—"],
    [t("cu_biz_id"), c ? c.bizId : ""],
    [t("pol_group"), (PO.GROUPS.find(g => g.id === p.group) || {}).label],
    [t("pol_pic"), p.pic],
    [t("pol_sales_date"), p.date],
    [t("pol_product"), p.commercial], [t("pd_grade"), p.grade],
    [t("pol_width"), p.width], [t("pol_length"), p.length],
    [t("pol_qty"), PO.fmtNum(p.qty) + " " + PO.unitLabel(p.unit, t)],
    [t("pol_amount"), PO.fmtVND(p.amountVnd)],
    [t("pol_vnd_roll"), p.qty ? PO.fmtVND(Math.round(p.amountVnd / p.qty)) : "—"],
    [t("pol_vnd_m2"), p.sqm ? PO.fmtVND(Math.round(p.amountVnd / p.sqm)) : "—"],
    [t("pol_sqm"), PO.fmtNum(p.sqm)],
    [t("pol_usd"), PO.fmtNum(usd)],
    [t("pol_po_no"), p.poNumber], [t("pol_po_date"), p.poDate],
    ["INV NO", p.invNo], ["EDP CODE", p.edpCode],
    [t("pol_new_repeat"), p.newRepeat + " · #" + p.orderCount],
    [t("pol_order_type"), p.orderType || ""],
    [t("pol_quote_ref"), p.quoteRef || ""],
    [t("pol_warning"), p.warning],
  ];
  return (
    <Modal title={t("pol_detail") + " · " + (p.poNumber || p.id)} onClose={onClose} width={620}>
      <div className="detail-top">
        <GroupBadge group={p.group} />
        {c && <button className="link-btn" onClick={() => { onClose(); openCustomer(p.customerId); }}>{t("cu_profile")} →</button>}
      </div>
      <dl className="detail-grid">
        {rows.filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => (
          <div className="detail-item" key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}

function POFormModal({ onClose, presetCustomerId, presetFromQuote, asPage }) {
  const { t, user, isBoss, assignablePics, users, scopeCustomers, products, addPO, quotations, pos, repCountry, productCountry } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const quoteItems = (presetFromQuote && presetFromQuote.items) || [];
  const quoteItem = quoteItems[0];
  // Every quotation line becomes a PO line. Lines are matched against the price list of the
  // CUSTOMER's market (the list the line editor shows), structure code first, then the code.
  const quoteCust = presetFromQuote ? scopeCustomers.find(c => c.id === presetFromQuote.customerId) : null;
  const quoteCat = presetFromQuote ? catalogueFor(products, (quoteCust && quoteCust.country) || productCountry) : [];
  const lineFromQuote = (qi) => {
    const sc = String(qi.structureCode || "").trim();
    const byStruct = sc ? quoteCat.find(p => structLabel(p) === sc) : null;
    const prod = byStruct || (!sc ? quoteCat.find(p => p.id === qi.productId) : null)
      || (variantsForCode(quoteCat, qi.productCode).length === 1 ? variantsForCode(quoteCat, qi.productCode)[0] : null);
    const code = prod ? pcOf(prod) : (qi.productCode || "");
    return {
      productId: prod ? prod.id : "", productCode: code, structureCode: prod ? structLabel(prod) : sc,
      sku: prod ? structLabel(prod) : (sc || code), grade: (prod && prod.grade) || qi.grade || "", productType: (prod && prod.productType) || qi.productType || "FR",
      width: qi.width || (prod && prod.width) || "", length: qi.length || (prod && prod.length) || "",
      sqmPerRoll: qi.sqmPerRoll || (prod && prod.sqmPerRoll) || "", qty: qi.qty || "",
      price: qi.price != null && qi.price !== "" ? qi.price : (qi.unitPrice || ""), rollPrice: qi.rollPrice || "",
      edpCode: (prod && prod.itmref) || qi.edpCode || "", currency: qi.currency || "",
    };
  };
  const blankItem = { productId: "", productCode: "", structureCode: "", sku: "", grade: "", productType: "FR", width: "", length: "", sqmPerRoll: "", qty: "", price: "", edpCode: "" };
  const [f, setF] = useState({
    customerId: presetFromQuote ? presetFromQuote.customerId : (presetCustomerId || ""),
    group: "E", pic: isBoss ? "" : (user.salesCode || ""),
    items: quoteItems.length ? quoteItems.map(lineFromQuote) : [blankItem],
    poNumber: "", poDate: today, date: today, invNo: "",
    orderType: "", quoteRef: presetFromQuote ? presetFromQuote.id : "", attachments: [],
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const [cur, setCur] = useState(quoteItem ? (quoteItem.currency || "VND") : (PO.ccyOfCountry(productCountry) || "VND"));
  // Currency follows the customer's market price list (Vietnam → VND, Thailand → THB,
  // Indonesia → IDR), falling back to the account's own market before one is picked.
  // A PO started from a quotation keeps the quotation's currency.
  React.useEffect(() => {
    if (quoteItem) return;
    const c = scopeCustomers.find(x => x.id === f.customerId);
    const ctry = (c && c.country) || productCountry;
    if (ctry) setCur(PO.ccyOfCountry(ctry));
  }, [f.customerId, productCountry]);
  const [addCust, setAddCust] = useState(false);
  const salesCodes = [...new Set(users.filter(u => u.salesCode).map(u => u.salesCode))];

  // auto-select current group of customer
  useEffect(() => {
    const c = scopeCustomers.find(x => x.id === f.customerId);
    if (c && c.group) set("group", c.group);
  }, [f.customerId]);


  const [priorCount, setPriorCount] = useState(0);
  useEffect(() => { let on = true; if (f.customerId) { PO.SB.poCountForCustomer(f.customerId).then(n => { if (on) setPriorCount(n); }); } else setPriorCount(0); return () => { on = false; }; }, [f.customerId]);
  const suggestedOrderType = priorCount === 0 ? "New" : "Repeat";
  const effectiveOrderType = f.orderType || suggestedOrderType;

  // Won quotations for this customer, for quoteRef dropdown
  const wonQuotes = quotations.filter(qq => qq.customerId === f.customerId && qq.status === "Won");

  const onAttach = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      set("attachments", [...f.attachments, { name: file.name, type: file.type, size: file.size, dataUrl: reader.result }]);
    };
    reader.readAsDataURL(file);
  };
  const removeAttachment = (i) => set("attachments", f.attachments.filter((_, idx) => idx !== i));

  const sqm = lineItemTotals(f.items).sqm;
  const rollQty = lineItemTotals(f.items).qty;
  const amount = Math.round(lineItemTotals(f.items).value * PO.CURRENCIES[cur].rate);
  const sorted = [...scopeCustomers].sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  // Ink type(s) auto-derive from the selected SKUs' grade (same as the Projects tab).
  const inkTypes = useMemo(() => [...new Set((f.items || []).map(it => it.grade).filter(Boolean))], [f.items]);
  // group the customer picker by Name Code (parent) — PO links to the PARENT,
  // one option per Name Code (not per company / Business ID).
  const custGroups = useMemo(() => {
    const m = {};
    sorted.forEach(c => { const code = PO.nameCodeOf(c); (m[code] = m[code] || []).push(c); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [scopeCustomers]);
  const repOfGroup = (list) => list.find(c => /head\s*office/i.test(c.name || "")) || list[0];
  const [invDupSrv, setInvDupSrv] = useState(null);
  useEffect(() => { let on = true; const n = (f.invNo || "").trim(); if (n) { PO.SB.poByInvoice(n).then(d => { if (on) setInvDupSrv(d || null); }); } else setInvDupSrv(null); return () => { on = false; }; }, [f.invNo]);
  const invDup = invDupSrv || PO.invInUse(f.invNo, pos);
  // A return / credit note is a PO with NEGATIVE quantity (and therefore a negative value),
  // so the form accepts any non-zero figure rather than requiring a positive one.
  const hasItem = (f.items || []).some(it => it.productId && (parseFloat(it.qty) || 0) !== 0 && (parseFloat(it.price) || 0) !== 0);
  const valid = f.customerId && hasItem && amount !== 0 && f.pic && (f.poNumber || "").trim() && !invDup;

  const submit = () => {
    if (!valid) return;
    const items = (f.items || []).filter(it => it.productId && (parseFloat(it.qty) || 0) !== 0);
    const first = items[0] || {};
    const tt = lineItemTotals(items);
    const rate = PO.CURRENCIES[cur].rate;
    addPO({
      customerId: f.customerId, nameCode: PO.nameCodeOf(scopeCustomers.find(c => c.id === f.customerId) || {}), group: f.group, pic: f.pic,
      year: +(f.date || today).slice(0, 4), month: +(f.date || today).slice(5, 7),
      date: f.date, commercial: items.map(it => it.sku).join(", "), grade: first.grade || "", materialName: first.sku || "",
      productType: first.productType || "FR", unit: (first.productType === "JR" ? "Kg" : "Cuộn"),
      width: parseFloat(first.width) || 0, length: parseFloat(first.length) || 0,
      qty: tt.qty, amountVnd: Math.round(tt.value * rate), sqm: tt.sqm,
      srcAmount: tt.value, srcCurrency: cur,
      items: items.map(it => ({ sku: it.sku, productId: it.productId, productCode: it.productCode || "", structureCode: it.structureCode || "", grade: it.grade, productType: it.productType || "FR", width: +it.width || 0, length: +it.length || 0, sqmPerRoll: it.sqmPerRoll ?? "", qty: +it.qty || 0, price: +it.price || 0, unitPrice: +it.price || 0, rollPrice: Math.round(lineRollPrice(it) * rate) || 0, sqm: lineItemTotals([it]).sqm, amountVnd: Math.round(lineValueEff(it) * rate) })),
      poNumber: (f.poNumber || f.invNo).trim(), poDate: f.poDate, invNo: f.invNo.trim(),
      orderType: effectiveOrderType, quoteRef: f.quoteRef, attachments: f.attachments,
      edpCode: first.edpCode || "",
    });
    onClose();
  };

  const content = (
    <>
      <div className="form-grid">
        <Field label={t("pol_customer")} required>
          <select className="select" value={f.customerId} onChange={e => { if (e.target.value === "__new__") { setAddCust(true); } else { set("customerId", e.target.value); } }}>
            <option value="">—</option>
            {custGroups.map(([code, list]) => {
              const rep = repOfGroup(list);
              return <option key={code} value={rep.id}>{code}{list.length > 1 ? " · " + list.length + " " + t("nc_companies") : " · " + (rep.name || rep.shortName)}</option>;
            })}
            <option value="__new__">➕ {t("cu_add")}</option>
          </select>
          {!f.customerId && <small className="status-hint">{t("pol_customer_missing")}</small>}
        </Field>
        <Field label={t("pol_group")} required>
          <select className="select" value={f.group} onChange={e => set("group", e.target.value)}>
            {PO.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <small className="status-hint">{t("pol_group_note")}</small>
        </Field>
        <Field label={t("pol_pic")} required>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.pic} onChange={e => set("pic", e.target.value)}>
              {isBoss && <option value="">—</option>}
              {picScope(assignablePics, (scopeCustomers.find(cc => cc.id === f.customerId) || {}).country, repCountry, f.pic).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input className="input" value={f.pic} disabled />}
        </Field>
        <div className="field" style={{ gridColumn: "1/-1" }}>
          <span className="field-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {t("pol_product")} <em style={{ color: "var(--danger)", fontStyle: "normal" }}>*</em>
            <select className="select" style={{ width: "auto", padding: "3px 8px", marginLeft: "auto" }} value={cur} onChange={e => setCur(e.target.value)}>
              {Object.keys(PO.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
          <ProductLineItems items={f.items} onChange={v => set("items", v)} products={products} t={t} cur={cur} country={(scopeCustomers.find(cc => cc.id === f.customerId) || {}).country} />
          {cur !== "VND" && amount > 0 && <small className="status-hint">= {PO.fmtVND(amount)} VND</small>}
        </div>
        <Field label={t("pr_ink")}>
          <div className="input ink-derived">
            {inkTypes.length
              ? inkTypes.map(g => <span key={g} className="ink-chip">{g}</span>)
              : <span className="dim">{t("pr_ink_none")}</span>}
          </div>
          <small className="status-hint">{t("pr_ink_auto")}</small>
        </Field>
        <Field label={t("pol_sales_date")}>
          <input className="input" type="date" value={f.date} onChange={e => set("date", e.target.value)} />
        </Field>
        <Field label={t("pol_po_date")}>
          <input className="input" type="date" value={f.poDate} onChange={e => set("poDate", e.target.value)} />
        </Field>
        <Field label={t("pol_po_no")} required>
          <input className="input" value={f.poNumber} onChange={e => set("poNumber", e.target.value)} placeholder="PO-2026-001" />
        </Field>
        <Field label={t("inv_label")}>
          <input className={"input" + (invDup ? " invalid" : "")} type="number" value={f.invNo}
            onChange={e => set("invNo", e.target.value)} placeholder={t("inv_ph")} />
          {invDup && <div className="inv-warn"><Icon d={ICONS.alert} size={13} /> {t("inv_dup").replace("{n}", f.invNo.trim()).replace("{po}", invDup.poNumber || invDup.id)}</div>}
        </Field>
        <Field label={t("pol_order_type")}>
          <select className="select" value={effectiveOrderType} onChange={e => set("orderType", e.target.value)}>
            {PO.ORDER_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          {!f.orderType && <small className="status-hint">{priorCount === 0 ? "New" : "Repeat"} (auto)</small>}
        </Field>
        <Field label={t("pol_quote_ref")}>
          {wonQuotes.length > 0 ? (
            <select className="select" value={f.quoteRef} onChange={e => set("quoteRef", e.target.value)}>
              <option value="">—</option>
              {wonQuotes.map(qq => <option key={qq.id} value={qq.id}>{qq.id}</option>)}
            </select>
          ) : (
            <input className="input" value={f.quoteRef} onChange={e => set("quoteRef", e.target.value)} placeholder="QT-2026-…" />
          )}
        </Field>
      </div>
      <Field label={t("pol_attachments")}>
        <div className="attach-list">
          {f.attachments.map((a, i) => (
            <div className="attach-item" key={i}>
              <Icon d={ICONS.file} size={14} />
              <span>{a.name}</span>
              <a className="link-btn" href={a.dataUrl} download={a.name}>{t("pol_attach_view")}</a>
              <button className="icon-btn" onClick={() => removeAttachment(i)} aria-label="remove">✕</button>
            </div>
          ))}
          <label className="btn btn-ghost btn-sm">
            <Icon d={ICONS.upload} size={13} /> {t("pol_attach_upload")}
            <input type="file" accept="image/*,.pdf" hidden onChange={e => onAttach(e.target.files[0])} />
          </label>
        </div>
      </Field>
      <div className="po-calc">
        <span>{t("pol_sqm")}: <strong>{PO.fmtNum(Math.round(sqm))}</strong></span>
        <span>{t("pol_vnd_roll")}: <strong>{rollQty !== 0 && amount ? PO.fmtVND(Math.round(amount / rollQty)) : "—"}</strong></span>
        <span>{t("pol_vnd_m2")}: <strong>{sqm > 0 && amount ? PO.fmtVND(Math.round(amount / sqm)) : "—"}</strong></span>
        <span>{t("pol_usd")}: <strong>{amount ? PO.fmtMoneyFull(amount, "USD") : "—"}</strong></span>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t("pol_new")}</button>
      </div>
      {addCust && window.AddCustomerModal && <AddCustomerModal onClose={() => setAddCust(false)} onCreated={(id) => { set("customerId", id); setAddCust(false); }} />}
    </>
  );
  if (asPage) {
    return (
      <div className="page page-wide">
        <button className="back-btn" onClick={onClose}><Icon d={ICONS.back} size={16} /> {t("pol_title")}</button>
        <header className="page-head"><div><h1>{t("pol_new")}</h1></div></header>
        <section className="card">{content}</section>
      </div>
    );
  }
  return <Modal title={t("pol_new")} onClose={onClose} width={640}>{content}</Modal>;
}

function POImportModal({ onClose }) {
  const { t, customers, products, addPOsBulk, countNewPOCustomers, users, productCountry } = useApp();
  const [book, setBook] = useState(null);   // { sheets } when picking among >1 sheet
  const [rows, setRows] = useState(null);   // [headers, ...data] of the chosen sheet
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState("");  // currency of the amounts in the file ("" = follow the market)
  const [poCountry, setPoCountry] = useState(productCountry || PO.MARKETS[0]); // market of this file: price list + country for auto-created customers
  // The market (and with it the currency) follows the topbar country filter until the user
  // picks one here — opening the import on Thailand must not default to the Vietnam price list.
  const ctryTouched = React.useRef(false);
  React.useEffect(() => { if (!ctryTouched.current && productCountry) setPoCountry(productCountry); }, [productCountry]);
  // Currency left blank follows the market, so choosing the country is enough. Picking one by
  // hand applies to the whole file (a Thai order sheet quoted in USD stays USD).
  const curEff = cur || PO.ccyOfCountry(poCountry) || "VND";
  const [confirm, setConfirm] = useState(null); // { items, skipped, missing } pending new-customer confirmation
  const importCountries = [...new Set([...PO.MARKETS, ...customers.map(c => PO.normCountry(c.country))].filter(Boolean))].sort();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  // The file is the record for the PO numbers it contains: stored lines of those POs that
  // the file no longer has are removed. Turn it off to ADD lines to existing POs.
  const [replaceMode, setReplaceMode] = useState(true);

  // [field key, label key, required, header-guess regex]
  // [field, label, required, loose regex, preferred patterns]. Auto-map runs the preferred
  // patterns in PRIORITY ORDER across all fields first (level 0 for every field, then
  // level 1, …), then the loose patterns for anything still unmapped. Level 0 is the exact
  // header of the standard sales export, so a normal file needs no manual mapping at all.
  // Every dropdown stays editable either way.
  const PO_FIELDS = [
    ["customer", "pol_customer", true, /customer|company|short\s*name|khách|tên kh|name\s*code/i, [/^short\s*name$/i, /^customer(\s*name)?$/i, /short\s*name/i]],
    ["poNumber", "pol_po_no", true, /po\s*(no|number|#)|document\s*no|số\s*po|mã\s*po/i, [/^po\s*(no|number)\.?$/i, /document\s*no/i, /单据号/i]],
    ["structureCode", "pol_product_name", false, /product\s*name|structure|mã\s*structure|cấu\s*trúc|ecc|struct/i, [/^product\s*name$/i, /(^|\s)product\s*name\s*$/i, /产品名称/i]],
    // ITM / EDP code (Sage itmref). When present it is the STRONGEST product key: one ITM =
    // one exact variant (country + structure + size), so it wins over a name/structure match.
    ["itm", "pd_itmref", false, /\bitm\b|itmref|edp|mã\s*edp|item\s*code|物料编码|货号/i, [/^itmref$/i, /^itm$/i, /^edp(\s*code)?$/i]],
    // The value column, in PRIORITY order. A sales export carries the same figure several
    // times — original currency, USD, RMB, incl. tax. "销售额(USD) Sales Amount (USD)" is the
    // one to take: a single, explicit unit for every row (the app converts it with the USD
    // rate), whereas 原销售额 mixes currencies row by row. The neutral variants follow it.
    ["amount", "pol_amount", false, /po\s*amount|amount|value|giá trị|amountvnd|thành tiền|doanh số/i,
      [/销售额\s*[(（]\s*usd|sales\s*amount\s*[(（]\s*usd/i, /^po\s*amount$/i, /原销售额|original\s*sales\s*amount/i, /^销售额\s+sales\s*amount$/i, /sales\s*amount/i]],
    ["invNo", "inv_label", false, /inv|invoice|hóa đơn|ใบแจ้งหนี้/i, [/^invoice\s*(no|number)/i, /invoice\s*reference/i, /发票参考/i]],
    ["product", "pd_product_type", false, /product\s*type|production\s*method|生产方式|commercial|sản phẩm|mã sp|material/i, [/^product\s*type$/i, /(^|\s)product\s*type\s*$/i, /production\s*method/i]],
    ["grade", "pol_grade", false, /grade|ink|loại mực|phân loại/i, [/^grade$/i]],
    ["qty", "pol_qty", false, /qty|quantity|số lượng|sl\b/i, [/^qty\s*\(?\s*roll/i, /^qty$/i]],
    ["width", "pol_width", false, /width|khổ|rộng|mm\b/i, [/(^|\s)width\s*$/i, /宽度/i]],
    ["length", "pol_length", false, /length|chiều dài|dài|độ dài|mét/i, [/(^|\s)length\s*$/i, /长度/i]],
    ["date", "pol_sales_date", false, /sales date|year\s*-?\s*month|ngày bán|^date$|ngày$/i, [/^sales\s*date$/i, /year\s*-?\s*month/i, /年月/i]],
    ["poDate", "pol_po_date", false, /po date|date received|ngày nhận|ngày po/i, [/po\s*date\s*received/i, /date\s*received/i]],
    ["pic", "pol_pic", false, /\bpic\b|sales\s*rep|phụ trách|nhân viên/i, [/^pic$/i]],
    ["group", "pol_group", false, /group|nhóm/i, [/^customer\s*group(\s*type)?$/i, /customer\s*group/i]],
  ];

  const applySheet = (sheetRows) => {
    if (!sheetRows || sheetRows.length < 2) { setError(t("im_excel_err")); return; }
    setRows(sheetRows);
    const headers = sheetRows[0].map(h => String(h || "").trim());
    const m = {}, taken = new Set();
    const claim = (field, re) => {
      if (m[field] !== undefined || !re) return;
      const idx = headers.findIndex((h, i) => !taken.has(i) && re.test(h));
      if (idx >= 0) { m[field] = idx; taken.add(idx); }
    };
    const depth = Math.max(...PO_FIELDS.map(f => (f[4] || []).length));
    for (let lvl = 0; lvl < depth; lvl++) PO_FIELDS.forEach(([field, , , , pref]) => claim(field, (pref || [])[lvl]));
    PO_FIELDS.forEach(([field, , , loose]) => claim(field, loose));
    setMap(m);
    setReport(null);
  };

  const onFile = (file) => {
    setError("");
    setFileName(file.name);
    PO.readImportFile(file).then(({ sheets }) => {
      if (!sheets.length) { setError(t("im_excel_err")); return; }
      if (sheets.length > 1) { setBook({ sheets }); setRows(null); }
      else applySheet(sheets[0].rows);
    }).catch(() => setError(t("im_excel_err")));
  };

  const reset = () => { setBook(null); setRows(null); setMap({}); setCur(""); setError(""); setReport(null); };

  const headers = rows ? rows[0] : [];
  const dataRows = rows ? rows.slice(1) : [];
  const canImport = map.customer !== undefined && map.poNumber !== undefined && dataRows.length > 0;
  // Currency named by the CHOSEN amount column itself — "销售额(USD) Sales Amount (USD)",
  // "原销售额(越南盾)", "Amount (THB)". A sales export repeats the same figure in several
  // currencies while the row's 币种 column keeps naming the ORIGINAL one, so picking the
  // USD column used to import USD figures as VND. The picked column's own currency wins.
  const amountCur = React.useMemo(() => {
    if (map.amount === undefined) return "";
    const h = String(headers[map.amount] || "");
    let hit = "", g; const paren = /[(（]\s*([^)）]+?)\s*[)）]/g;
    while ((g = paren.exec(h))) { const c = PO.currencyOf(g[1], ""); if (c) hit = c; }
    if (!hit) hit = PO.currencyOf(h.replace(/原|销售额|sales|amount|value|total/gi, " ").trim(), "");
    return hit;
  }, [map.amount, headers]);

  // Strict validation: every PO row must reference an EXISTING customer,
  // an EXISTING PIC (Permissions user) and an EXISTING product SKU. Rows that
  // fail any check are not imported and are reported with detailed reasons.
  const validPics = React.useMemo(() => new Set((users || []).filter(u => u.salesCode).map(u => String(u.salesCode).trim().toUpperCase())), [users]);
  // Resolve a PIC token (code OR full/short name) to a Permissions salesCode.
  const picResolve = React.useMemo(() => {
    const m = {};
    (users || []).forEach(u => {
      if (u._deleted) return;
      // Effective PIC code: the Sales Code, or the account NAME for BOD/admin accounts
      // that have no Sales Code (e.g. THUY) — mirrors how the PO List / Overview key
      // reps, so a PO whose PIC is such a name links instead of being dropped as unknown.
      const code = String(u.salesCode || u.name || "").trim();
      if (!code) return;
      m[code.toUpperCase()] = code;
      [u.name, u.shortName].forEach(nm => { const k = PO.normName(nm); if (k) m[k] = code; });
    });
    return (raw) => { const s = String(raw || "").trim(); if (!s) return ""; return m[s.toUpperCase()] || m[PO.normName(s)] || ""; };
  }, [users]);
  const prodKeys = React.useMemo(() => { const s = new Set(); (products || []).forEach(p => { [p.name, p.code].forEach(k => { const v = String(k || "").trim().toLowerCase(); if (v) s.add(v); }); }); return s; }, [products]);
  const custFind = React.useMemo(() => {
    const byKey = {};
    (customers || []).forEach(c => {
      [c.name, c.shortName, PO.nameCodeOf(c)].forEach(k => { const v = PO.normName(k); if (v) byKey[v] = c; });
    });
    return (name) => {
      const key = PO.normName(name);
      if (byKey[key]) return byKey[key];
      const low = String(name || "").toLowerCase();
      if (!low) return null;
      return (customers || []).find(c => (c.name || "").toLowerCase().includes(low) || (c.shortName || "").toLowerCase() === low) || null;
    };
  }, [customers]);
  const custMatch = (name) => !!custFind(name);

  const runImport = async () => {
    if (!canImport || busy) return;
    setBusy(true);
    const val = (r, field) => (map[field] !== undefined ? String(r[map[field]] ?? "").trim() : "");
    const items = [];
    let skippedBad = 0;
    const badCust = new Set(), badPic = new Set(), badProd = new Set();
    // Product lookups are confined to the row's OWN market: the customer's country when the
    // customer is already registered, else the market picked above. A Thai order must never
    // resolve to a Vietnamese record (that is how Thai POs picked up VND prices) — and a Thai
    // customer must not be told its code is missing from the Vietnam price list.
    const _cats = {};
    const catalogueOf = (cn) => _cats[cn] || (_cats[cn] = catalogueFor(products, cn));
    let noInv = 0;
    // Per-row issue log — every problematic source row (skipped OR imported-with-warning)
    // is recorded so the user can download it and fix the source file / master data.
    const issues = [];
    const logIssue = (rowNo, custName, invNo, poNo, rawPic, productName, reason) =>
      issues.push([String(rowNo), custName || "", invNo || "", poNo || "", rawPic || "", productName || "", reason]);
    dataRows.forEach((r, ri) => {
      const rowNo = ri + 2; // 1-based, +1 for the header row — matches the Excel row number
      const custName = val(r, "customer");
      const custRec = custFind(custName);
      // Market of THIS row = the customer's registered country, falling back to the file's.
      const rowCountry = (custRec && PO.normCountry(custRec.country)) || PO.normCountry(poCountry) || poCountry;
      const ctryCatalogue = catalogueOf(rowCountry);
      // Credit notes / returns come through as "-1,234.56" or "(1,234.56)" — the digit-only
      // strip below would silently turn them into POSITIVE sales, so keep the sign.
      const rawAmt = val(r, "amount");
      const amtNeg = /^\s*-/.test(rawAmt) || /^\s*\(.*\)\s*$/.test(rawAmt);
      const amount = (parseFloat(rawAmt.replace(/[^\d.]/g, "")) || 0) * (amtNeg ? -1 : 1);
      // Currency: the unit named by the CHOSEN amount column wins (see amountCur), otherwise
      // the Currency dropdown above the mapping. The file's own 币种 column is deliberately
      // NOT consulted — it names the ORIGINAL currency of the row, which is wrong for every
      // converted-amount column the export also carries.
      const rowCur = amountCur || curEff;
      const rawPic = val(r, "pic");
      const productName = val(r, "product");
      const invNo = val(r, "invNo");
      const poNo = val(r, "poNumber");
      if (!custName) { skippedBad++; logIssue(rowNo, "", invNo, poNo, rawPic, productName, t("pol_iss_nocustname")); return; }
      // This column is the product TYPE (FR / JR / Others), not a catalogue product.
      // We still try a catalogue match so older files that mapped a real product name
      // here keep working; anything that doesn't match is simply stored as the type —
      // that is the expected content, so it is never reported as a problem.
      // Product identity comes ONLY from the product-code column ("Product Name" in the
      // Sage export, e.g. TDM240.110×300). "Product Type" holds FR / JR and "Grade" holds
      // Wax / Resin — attributes, never the product name.
      const typeRaw = productName;                                   // Product Type column
      const code = PO.cleanCode(val(r, "structureCode")) || PO.cleanCode(typeRaw);
      const findProd = (v) => { const s = String(v || "").trim().toLowerCase(); return s ? ctryCatalogue.find(p => String(p.name).toLowerCase() === s || String(p.code).toLowerCase() === s || String(p.eccshoaxx || "").toLowerCase() === s) : null; };
      // ITM is only a FALLBACK reference: the structure code (auto-mapped to the variant whose
      // Width × Length match the row) is the real key. ITM is consulted only when the row has
      // no W/L to map with.
      const itmRaw = String(val(r, "itm") || "").trim();
      const findItm = (v) => { const s = String(v || "").trim().toLowerCase(); return s ? ctryCatalogue.find(p => String(p.itmref || "").trim().toLowerCase() === s) : null; };
      const numOr = (field, fallback) => { const n = parseFloat(val(r, field).replace(/[^\d.]/g, "")); return isNaN(n) ? fallback : n; };
      const rowW = numOr("width", 0), rowL = numOr("length", 0);
      // Exact structure match first. A BASE-code match (TDR330 for "TDR330.110×300") can land on
      // any width variant, so prefer the variant whose width/length match this row — and never let
      // a base match rename the product: that is how a 110mm order ended up labelled TDR330.40×300.
      const prodExact = findProd(code);
      const _base = PO.baseCode(code);
      const _variants = prodExact ? [] : ctryCatalogue.filter(p => PO.baseCode(String(p.code || p.name || "")) === _base || String(p.code || "").trim().toLowerCase() === String(_base).toLowerCase());
      const _byDim = prodExact ? null : ((rowW || rowL) ? _variants.find(p => (!rowW || Math.round(parseFloat(p.width) || 0) === Math.round(rowW)) && (!rowL || Math.round(parseFloat(p.length) || 0) === Math.round(rowL))) : null) || null;
      const prodItm = (!prodExact && !_byDim && !rowW && !rowL && itmRaw) ? findItm(itmRaw) : null;
      const prodDim = prodExact || _byDim || prodItm || null;
      // Attribute donor: the dimension match when there is one, else any variant of the base code
      // (grade / product type / base code are shared across variants; sizes and names are not).
      const prod = prodDim || _variants[0] || null;
      const typeToken = PO.cleanCode(typeRaw) ? "" : String(typeRaw || "").trim().toUpperCase();
      // Row-gating references (must exist): customer + PO number. The PO number is the
      // dedup key, so a row without one cannot be matched against an existing PO.
      if (!custRec) { badCust.add(custName); logIssue(rowNo, custName, invNo, poNo, rawPic, productName, t("pol_iss_custnf")); return; }
      if (!poNo) { noInv++; logIssue(rowNo, custName, invNo, poNo, rawPic, productName, t("pol_iss_noinv")); return; }
      // Soft fields: if PIC / product don't match, DROP that value (don't import it)
      // and warn — but still import the row (per "không import giá trị đó").
      const pic = picResolve(rawPic);
      const softReasons = [];
      if (rawPic && !pic) { badPic.add(rawPic); softReasons.push(t("pol_iss_picnf")); }
      if (code && !prod) { badProd.add(code); softReasons.push(t("pol_iss_prodnf").replace("{c}", rowCountry)); }
      if (itmRaw && !rowW && !rowL && !prodExact && !prodItm) { badProd.add(itmRaw); softReasons.push(t("pol_iss_prodnf").replace("{c}", rowCountry)); }

      if (softReasons.length) logIssue(rowNo, custName, invNo, poNo, rawPic, productName, softReasons.join("; "));
      const date = PO.toISO(val(r, "date")) || new Date().toISOString().slice(0, 10);
      const poDate = PO.toISO(val(r, "poDate")) || date;
      const structureCode = code;
      const dim = /\.\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/.exec(code) || [];
      items.push({
        customerName: custName,
        country: rowCountry,
        _row: rowNo,
        _unmapped: !!code && !prodDim,
        invNo,
        poNumber: poNo,
        structureCode,
        itm: (prodItm && prodItm.itmref) || itmRaw || "",
        edpCode: (prodItm && prodItm.itmref) || itmRaw || "",
        group: val(r, "group") || "A",
        pic,
        date, poDate,
        commercial: code || (prodDim ? (prodDim.name || prodDim.code) : ""),
        productType: typeToken || (prod ? (prod.productType || "") : ""),
        grade: val(r, "grade") || (prod ? prod.grade : ""),
        materialName: PO.baseCode(code) || (prod ? (prod.code || "") : ""),
        width: numOr("width", prodDim ? prodDim.width : (+dim[1] || 0)),
        length: numOr("length", prodDim ? prodDim.length : (+dim[2] || 0)),
        sqmPerRoll: prodDim ? (parseFloat(prodDim.sqmPerRoll) || 0) : 0,
        qty: parseFloat(val(r, "qty")) || 0,
        // Kept exactly as the file states it, next to the canonical VND figure below.
        srcAmount: amount, srcCurrency: rowCur,
        // Precedence: currency named by the chosen amount column > Currency dropdown.
        amountVnd: Math.round(amount * (PO.CURRENCIES[rowCur] ? PO.CURRENCIES[rowCur].rate : 1)),
      });
    });
    // Two rows of one PO with the SAME qty and value but different codes, where at least one
    // code isn't in the price list, are almost always one physical line written twice (the
    // unmapped code once, the real one once). We import both — the file is the record — but
    // flag them, because that pair is what silently doubles a PO's qty and value.
    const dupG = {};
    items.forEach(it => { const k = [it.poNumber, it.qty, it.amountVnd].join("|"); (dupG[k] = dupG[k] || []).push(it); });
    Object.keys(dupG).forEach(k => {
      const a = dupG[k];
      if (a.length < 2 || !(+a[0].qty > 0)) return;
      const codes = [...new Set(a.map(x => String(x.structureCode || "").toUpperCase()).filter(Boolean))];
      if (codes.length < 2 || !a.some(x => x._unmapped)) return;
      a.forEach(x => logIssue(x._row, x.customerName, x.invNo, x.poNumber, x.pic, x.structureCode, t("pol_iss_dupline").replace("{c}", codes.join(" / "))));
    });
    // never auto-create customers here — they must already exist.
    // Pre-fetch the stored lines of every PO number in this file so a re-import OVERWRITES
    // them instead of piling up duplicates (RAM only holds the loaded date window).
    let existing = [];
    try { existing = await PO.SB.posByPoNumbers(items.map(it => it.poNumber)); } catch (e) { existing = []; }
    const res = addPOsBulk(items, { createMissing: false, existing, replacePOs: replaceMode });
    const cut = (set) => [...set].slice(0, 15).join(", ") + (set.size > 15 ? "…" : "");
    const parts = [];
    if (noInv) parts.push(t("pol_err_invno").replace("{n}", String(noInv)));
    if (badCust.size) parts.push(t("pol_err_cust").replace("{n}", String(badCust.size)).replace("{list}", cut(badCust)));
    if (badPic.size) parts.push(t("pol_err_pic").replace("{n}", String(badPic.size)).replace("{list}", cut(badPic)));
    if (badProd.size) parts.push(t("pol_err_prod").replace("{n}", String(badProd.size)).replace("{list}", cut(badProd)));
    const skipped = dataRows.length - res.imported;
    setReport({ count: res.imported, created: 0, skipped, overwritten: res.overwritten || 0, dupRemoved: res.dupRemoved || 0, staleRemoved: res.staleRemoved || 0, warn: parts.join("\n"), issues });
    setBusy(false);
  };

  // Export every problematic source row (skipped or imported-with-warning) as CSV
  // so the user can fix the master data / source file and re-import.
  const downloadIssues = (rows) => {
    const headers = [t("pol_iss_col_row"), t("pol_iss_col_company"), t("pol_iss_col_inv"), t("pol_iss_col_po"), t("pol_iss_col_pic"), t("pol_iss_col_product"), t("pol_iss_col_reason")];
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [headers, ...rows].map(r => r.map(esc).join(","));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "po-import-errors-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal title={t("pol_import_excel")} onClose={onClose} width={680}>
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
          <p><strong>{report.count}</strong> {t("tg_imported")}{report.skipped > 0 ? <> · <strong>{report.skipped}</strong> {t("pol_import_skipped")}</> : null}</p>
          {report.created > 0 && <p className="import-note">+ {report.created} {t("pol_import_created")}</p>}
          {report.overwritten > 0 && <p className="import-note">↺ {report.overwritten} {t("pol_import_overwritten")}</p>}
          {report.dupRemoved > 0 && <p className="import-note">− {report.dupRemoved} {t("pol_import_dupremoved")}</p>}
          {report.staleRemoved > 0 && <p className="import-note">− {report.staleRemoved} {t("pol_import_stale")}</p>}
          {report.warn && <p className="import-warn" style={{ textAlign: "left", whiteSpace: "pre-line" }}>{report.warn}</p>}
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
          <p className="import-note">{t("pol_import_hint")}</p>
          <ImportDrop t={t} onFile={onFile} />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => {
              const ex = { customer: ["ABC Label Co.", "XYZ Printing"], poNumber: ["PO-2026-001", "PO-2026-002"], structureCode: ["TDM240.110×300", "TDR330.60×300"], itm: ["212000012", "212000132"], amount: ["12500000", "8400000"], invNo: ["INV-2026-001", "INV-2026-002"], product: ["JR", "FR"], grade: ["Wax", "Resin"], qty: ["500", "200"], width: ["110", "60"], length: ["300", "300"], date: ["2026-06-01", "2026-06-03"], poDate: ["2026-05-28", "2026-06-01"], pic: ["NOOM", "ICE"], group: ["A", "B"] };
              window.downloadCSVTemplate("po-list", PO_FIELDS.map(([f, l, req]) => t(l) + (req ? " *" : "")), [0, 1].map(i => PO_FIELDS.map(([f]) => (ex[f] || [])[i] || "")));
            }}>
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
          <div className="import-currency">
            <div className="import-currency-main">
              <span className="import-currency-label">{t("pol_import_currency")}</span>
              <select className="select" value={cur} onChange={e => setCur(e.target.value)}>
                <option value="">{t("im_cur_auto")}</option>
                {Object.keys(PO.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="import-currency-label" style={{ marginLeft: 14 }}>{t("country")}</span>
              <select className="select" value={poCountry} onChange={e => { ctryTouched.current = true; setPoCountry(e.target.value); }}>
                {importCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <small className="import-currency-hint">
              {!cur ? t("im_cur_auto_note").replace("{cur}", curEff).replace("{c}", poCountry) + " " : ""}
              {curEff === "VND" ? t("pol_import_currency_vnd")
                : t("pol_import_currency_note").replace("{cur}", curEff).replace("{rate}", PO.fmtNum((PO.CURRENCIES[curEff] || { rate: 1 }).rate)) + " " + t("im_cur_src_note").replaceAll("{cur}", curEff)}
            </small>
            {amountCur ? <small className="import-currency-hint" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
              {t("pol_amount")}: {String(headers[map.amount] || "").slice(0, 44)} → {amountCur}{amountCur === "VND" ? "" : " × " + PO.fmtNum(PO.CURRENCIES[amountCur].rate)}
            </small> : null}
          </div>
          <div className="map-grid">
            <div className="map-head">{t("im_map")}</div>
            {PO_FIELDS.map(([field, labelKey, req]) => (
              <div className="map-row" key={field}>
                <span className="map-field">{t(labelKey)}{req ? <em> *</em> : null}</span>
                <select className="select" value={map[field] !== undefined ? map[field] : ""}
                  onChange={e => setMap(prev => ({ ...prev, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">{t("im_skip")}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{(h ? String(h).slice(0, 60) : "(col " + (i + 1) + ")")}</option>)}
                </select>
                <span className="map-sample dim">{map[field] !== undefined && dataRows[0] ? String(dataRows[0][map[field]] ?? "").slice(0, 36) : ""}</span>
              </div>
            ))}
          </div>
          {!canImport && <p className="import-warn">{t("pol_import_need")}</p>}
          <label className="import-replace">
            <input type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} />
            <span><strong>{t("pol_import_replace")}</strong><br /><small className="dim">{t("pol_import_replace_hint")}</small></span>
          </label>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={!canImport || busy} onClick={runImport}>{busy ? "…" : t("im_run")} ({dataRows.length})</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

Object.assign(window, { POListPage, POFormModal, PODetailModal, POProfile });
