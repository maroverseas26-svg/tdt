// Todaytec CRM — Sales Forecast module (Forecast vs Actual tracking)
const FC = window.CRM;
const FC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fcRatioCls(actual, fc) {
  if (!fc) return actual > 0 ? " tg-ok" : "";
  const r = actual / fc;
  return r >= 1 ? " tg-ok" : r >= 0.7 ? " tg-mid" : " tg-low";
}
function fcPct(actual, fcVal) {
  if (!fcVal) return actual > 0 ? Infinity : 0;
  return (actual / fcVal) * 100;
}
function fcFmtPct(p) {
  if (p === Infinity) return "∞";
  if (!isFinite(p)) return "—";
  return Math.round(p) + "%";
}
function FcMom({ cur, prev }) {
  if (!prev && !cur) return <span className="mom-badge mom-flat">MoM —</span>;
  if (!prev) return <span className="mom-badge mom-up">MoM ▲ new</span>;
  const d = Math.round((cur - prev) / prev * 100);
  return <span className={"mom-badge " + (d >= 0 ? "mom-up" : "mom-down")}>MoM {d >= 0 ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

function SalesForecastPage() {
  const { t, isBoss, isCountryMgr, assignableCodes, repCountry, user, users, scopeCustomers, customers, pos, money, currency, setCurrency, canExport, skuForecast, saveSkuCell, saveSkuMeta, deleteSkuRow, products, picFilterCodes, canonCode } = useApp();
  const FCC = window.CRM;
  const FC_SUGGEST_RATIO = 0.35; // suggested future FC = latest actual × 35% (editable)
  const today = new Date();
  // Anchor month/year follow the ONE topbar date filter (the month its range ends in).
  const _gRange = useApp().dateRangeR;
  const _fcAnchor = React.useMemo(() => {
    const s = _gRange && _gRange.to;
    const d = s ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, 1) : new Date();
    return { y: String(d.getFullYear()), m: d.getMonth() + 1 };
  }, [_gRange && _gRange.to]);
  const year = _fcAnchor.y, month = _fcAnchor.m;
  const [rep, setRep] = useState((isBoss || isCountryMgr) ? "" : (user.salesCode || ""));
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const fcCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setFcCountries = () => {};
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [collapsed, setCollapsed] = useState({}); // customerId -> true when collapsed
  // Hand-added forecast rows: a customer may be pulled in before it has any PO, and a code
  // may be added either from what the customer bought before or from the price list.
  const [addCust, setAddCust] = useState(false);
  const [addCodeFor, setAddCodeFor] = useState(null);
  const [extraKeys, setExtraKeys] = useState(() => new Set());
  // Currency follows the market actually on screen: the topbar country filter first, and
  // when that is "All", the KPI country of the sales PIC picked in the rep filter — a
  // Thailand rep's forecast reads in ฿ without touching the currency dropdown.
  const viewCountry = React.useMemo(() => {
    if (fcCountries.length === 1) return fcCountries[0];
    if (!fcCountries.length && rep) { const c = window.CRM.normCountry(repCountry(rep) || ""); if (c && c !== "All") return c; }
    return "";
  }, [fcCountries, rep, repCountry]);
  useEffect(() => { if (viewCountry) setCurrency(window.CRM.ccyOfCountry(viewCountry)); }, [viewCountry]);

  // Forecast defaults to the CURRENT month/year (state above); the user can change it.

  const fcCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const allCountries = [...new Set(scopeCustomers.map(c => window.CRM.normCountry(c.country)))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => fcCountryRank(a) - fcCountryRank(b));
  const allowC = (cn) => fcCountries.length === 0 || fcCountries.includes(cn);
  const custById = {}; customers.forEach(c => custById[c.id] = c);
  const countryOfCust = (id) => { const c = custById[id]; return c ? window.CRM.normCountry(c.country) : ""; };
  const custName = (id) => { const c = custById[id]; return c ? (c.shortName || c.name) : "—"; };
  const custNC = (id) => { const c = custById[id]; return c ? FCC.nameCodeOf(c) : ""; };

  const years = [...new Set(["2025", "2026", String(today.getFullYear()), ...(pos || []).map(p => String(p.year)).filter(Boolean)])].sort();
  // Sales-rep filter: only accounts registered in Permissions (with a sales code, not
  // deleted), scoped to what this account may see (own set / country / all) and to the
  // active country filter.
  const reps = [...(picFilterCodes || [])].filter(code => (isBoss || isCountryMgr) ? true : assignableCodes.includes(code)).sort();

  // ---- month window: 3 past (actual) + current (FC + actual) + 2 future (FC) ----
  const ymKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  const addM = (y, m, d) => { const dt = new Date(y, m - 1 + d, 1); return { y: dt.getFullYear(), m: dt.getMonth() + 1 }; };
  const fmtMon = (y, m) => new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const anchor = { y: Number(year), m: Number(month) };
  const pastCols = [-3, -2, -1].map(d => addM(anchor.y, anchor.m, d));
  const curCol = anchor;
  const futCols = [1, 2].map(d => addM(anchor.y, anchor.m, d));
  const actualKeys = [...pastCols, curCol].map(c => ymKey(c.y, c.m));
  const curKey = ymKey(curCol.y, curCol.m);

  // currency conversion for FC value inputs (stored canonical in VND).
  // Non-VND currencies need decimals (1.5 ฿), so the display keeps 2 decimal places and the
  // canonical value is NOT rounded to whole VND — otherwise 1.5 ฿ round-trips back as 2 ฿.
  const rate = (FCC.CURRENCIES[currency] && FCC.CURRENCIES[currency].rate) || 1;
  const parseNum = (v) => parseFloat(String(v).replace(/[^\d.-]/g, "")) || 0;
  // amount input: accepts "12,037", "1.5" and "1,5" (comma as decimal when 1–2 digits follow)
  const parseAmt = (v) => {
    let s = String(v).trim().replace(/[^\d.,-]/g, "");
    if (!s.includes(".") && /,\d{1,2}$/.test(s)) s = s.replace(/,(\d{1,2})$/, ".$1");
    return parseFloat(s.replace(/,/g, "")) || 0;
  };
  const round2 = (n) => Math.round(n * 100) / 100;
  const toDisp = (vnd) => vnd ? FCC.fmtNum(rate === 1 ? Math.round(vnd) : round2(vnd / rate)) : "";
  const toVnd = (v) => rate === 1 ? Math.round(parseAmt(v)) : round2(parseAmt(v) * rate);
  // raw keystrokes for the focused amount cell, so a half-typed "1." survives re-render
  const [amtEdit, setAmtEdit] = React.useState(null);

  const visibleIds = new Set(scopeCustomers.map(c => c.id));
  const repOf = (p) => { const k = canonCode(p.pic).toUpperCase(); return (k && !k.includes("#") && k !== "N/A") ? k : ""; };
  const skuOf = (p) => (p.commercial || p.materialName || "—");
  // group members of the same company (same Name Code) into one company key
  const companyKeyOf = (cid) => { const c = custById[cid]; const nc = c ? FCC.nameCodeOf(c) : ""; return nc ? FCC.nameCodeKey(nc) : cid; };
  // Every company in scope, with or without PO history — so a customer that has never
  // ordered can still be added to the forecast by hand.
  const compIndex = {};
  scopeCustomers.forEach(c => { const k = companyKeyOf(c.id); const e = compIndex[k] = compIndex[k] || { key: k, rep: c.id, members: new Set() }; e.members.add(c.id); });
  const allCols = [...pastCols, curCol, ...futCols];
  // ---- Server-fetched actuals window (Phase 3b): pull ONLY the 4-month actuals window
  // (3 past + current) for the visible customers, instead of scanning the whole `pos`
  // table in RAM. compMap below is built from this bounded set. Falls back to RAM `pos`.
  const [fcPOs, setFcPOs] = React.useState(null);
  const _fcScopeIds = React.useMemo(() => scopeCustomers.map(c => c.id), [scopeCustomers]);
  const _fcScopeKey = _fcScopeIds.join(",");
  const _fcPosLen = pos ? pos.length : 0;
  const _winFrom = ymKey(pastCols[0].y, pastCols[0].m) + "-01";
  const _winTo = ymKey(curCol.y, curCol.m) + "-31";
  React.useEffect(() => {
    let on = true; const SB = window.CRM.SB;
    (async () => {
      try {
        const base = { from: _winFrom, to: _winTo };
        let rows;
        if (isBoss) { rows = (await SB.queryAll(base)).rows; }
        else if (!_fcScopeIds.length) { rows = []; }
        else { rows = (await SB.queryAll(Object.assign({}, base, { customerIds: _fcScopeIds }))).rows; }
        if (on) setFcPOs(Array.isArray(rows) ? rows : null);
      } catch (e) { if (on) setFcPOs(null); }
    })();
    return () => { on = false; };
  }, [_winFrom, _winTo, _fcScopeKey, isBoss, _fcPosLen]);
  // Server rows come RAW — overlay the customer's Owner as Sales PIC (same rule as the
  // RAM array), otherwise the rep filter sees a blank PIC on every server-fetched PO.
  const fcSrc = React.useMemo(() => {
    const raw = fcPOs || pos || [];
    if (!fcPOs) return raw;
    return raw.map(p => { const c = custById[p.customerId]; const own = c && canonCode(c.owner); return own && own !== String(p.pic || "").trim() ? { ...p, pic: own } : p; });
  }, [fcPOs, pos, customers, canonCode]);

  // ---- build company → SKU → {actuals per month} from PO history ----
  const compMap = {};
  fcSrc.forEach(p => {
    const cid = p.customerId;
    if (!visibleIds.has(cid) || !allowC(countryOfCust(cid))) return;
    if (rep && repOf(p) !== rep) return;
    const yk = ymKey(p.year, p.month);
    if (!actualKeys.includes(yk)) return;
    const key = companyKeyOf(cid);
    const sku = skuOf(p);
    const cm = compMap[key] = compMap[key] || { key, rep: cid, members: new Set(), skus: {} };
    cm.members.add(cid);
    const sm = cm.skus[sku] = cm.skus[sku] || { actuals: {}, cn: countryOfCust(cid) || window.CRM.normCountry(p.country || ""), type: p.productType || "FR", grade: p.grade || "", width: p.width, length: p.length, unit: p.unit || (p.productType === "JR" ? "Kg" : "Cuộn") };
    if (!sm.itm) sm.itm = p.itm || p.edpCode || "";
    const a = sm.actuals[yk] = sm.actuals[yk] || { qty: 0, value: 0 };
    a.qty += p.qty || 0; a.value += p.amountVnd || 0;
  });
  // A company with no PO in the window still belongs in the grid once it has a stored
  // forecast row (or was just added by hand) — build it from the customer list instead.
  const ensureComp = (key) => {
    if (compMap[key]) return compMap[key];
    const idx = compIndex[key]; if (!idx) return null;
    if (!allowC(countryOfCust(idx.rep))) return null;
    if (rep && canonCode((custById[idx.rep] || {}).owner || "").toUpperCase() !== rep) return null;
    return (compMap[key] = { key, rep: idx.rep, members: new Set(idx.members), skus: {} });
  };
  // include SKUs that exist only in stored forecast (keyed by company). Hand-added rows
  // carry their own product attributes, so they render without any PO behind them.
  Object.entries(skuForecast || {}).forEach(([key, skus]) => {
    const rows = Object.entries(skus || {}).filter(([, m]) => !(m && m._deleted));
    // Only hand-added companies join the grid on their own; legacy stored rows stay tied
    // to companies that actually have POs in the window (as before).
    const cm = compMap[key] || ((extraKeys.has(key) || rows.some(([, m]) => m && m.manual)) ? ensureComp(key) : null);
    if (!cm) return;
    rows.forEach(([sku, meta]) => {
      if (cm.skus[sku]) return;
      const m = meta || {};
      cm.skus[sku] = { actuals: {}, cn: m.cn || countryOfCust(cm.rep), type: m.type || "FR", grade: m.grade || "", width: m.width, length: m.length, itm: m.itm || "", unit: m.unit || (m.type === "JR" ? "Kg" : "Cuộn"), manual: true };
    });
  });
  extraKeys.forEach(k => ensureComp(k));
  const addFcRow = (key, sku, meta, cells) => {
    saveSkuMeta(key, sku, Object.assign({ manual: true }, meta));
    Object.entries(cells || {}).forEach(([yk, v]) => saveSkuCell(key, sku, yk, v));
    setCollapsed(s => ({ ...s, [key]: false }));
  };
  const compName = (cm) => custName(cm.rep);
  const compNC = (cm) => custNC(cm.rep);

  const getFC = (key, sku, yk) => ((((skuForecast || {})[key] || {})[sku] || {}).cells || {})[yk] || {};
  const getMeta = (key, sku) => (((skuForecast || {})[key] || {})[sku] || {});

  const q = search.trim().toLowerCase();
  const compList = Object.values(compMap).map(cm => {
    // Status filter narrows the SKU ROWS, not just the customers — a customer stays in the
    // list only while at least one of its SKUs still matches.
    if (!statusF) return cm;
    const skus = {};
    Object.entries(cm.skus).forEach(([sku, sm]) => { if ((getMeta(cm.key, sku).status || "Draft") === statusF) skus[sku] = sm; });
    return { ...cm, skus };
  }).filter(cm => {
    if (!Object.keys(cm.skus).length && !extraKeys.has(cm.key)) return false;
    if (!q) return true;
    if (compName(cm).toLowerCase().includes(q)) return true;
    return Object.keys(cm.skus).some(sku => sku.toLowerCase().includes(q));
  }).sort((a, b) => compName(a).localeCompare(compName(b)));

  // ---- VLOOKUP list price from the Products tab ----
  // A product is identified by its ITM code (itmref) + structure code (eccshoaxx);
  // the FC price comes from that product's price column (converted to VND).
  // The book is keyed BY MARKET: the same ITM carries a different price in Vietnam and in
  // Thailand, so a Thai customer must read the Thai price list — never the Vietnamese row
  // that happened to load first (that is what showed "13,495 VND" under a ฿ header).
  const priceBooks = useMemo(() => {
    const books = { "": {} };
    (products || []).forEach(p => {
      const raw = parseFloat(p.price);
      if (!raw) return;
      const rate = (FCC.CURRENCIES[p.currency] || { rate: 1 }).rate;
      const ecc = String(p.eccshoaxx || "").trim();
      // Unit price is per sqm; roll price = unit price × area/roll (area = sqmPerRoll,
      // else width/1000 × length). FC value = qty(rolls) × roll price.
      const tm = ecc.match(/_(\d+)\s*$/);
      const tier = tm ? parseInt(tm[1], 10) : (parseFloat(p.moq) || 0);
      const spr = parseFloat(p.sqmPerRoll) || 0;
      const area = spr > 0 ? spr : ((parseFloat(p.width) || 0) / 1000) * (parseFloat(p.length) || 0);
      const rollRaw = raw * area;
      const cn = FCC.normCountry(p.country || "");
      const rec = { vnd: raw * rate, raw, cur: p.currency || FCC.ccyOfCountry(cn), cn, itm: String(p.itmref || "").trim(), ecc, tier: tier > 0 ? tier : 0, area, rollRaw, rollVnd: rollRaw * rate, effVnd: rollRaw * rate };
      [cn, ""].forEach(bk => {
        const m = books[bk] = books[bk] || {};
        if (rec.itm) { const k = "ITM:" + rec.itm + (rec.ecc ? "|" + rec.ecc : ""); if (!m[k]) m[k] = rec; if (!m["ITM:" + rec.itm]) m["ITM:" + rec.itm] = rec; }
        [p.name, p.code].forEach(k => { k = String(k || "").trim().toUpperCase(); if (k && !m[k]) m[k] = rec; });
      });
    });
    return books;
  }, [products]);
  const EMPTY_BOOK = {};
  // A market never borrows another market's price list: no Thai price for that code means
  // no list price shown, rather than a Vietnamese number relabelled ฿.
  const bookFor = (cn) => {
    const c = FCC.normCountry(cn || "") || FCC.normCountry(viewCountry || "");
    return c ? (priceBooks[c] || EMPTY_BOOK) : (priceBooks[""] || EMPTY_BOOK);
  };
  const listPriceOf = (sku, sm) => {
    const m = bookFor(sm && sm.cn);
    const itm = sm && sm.itm ? String(sm.itm).trim() : "";
    return (itm && (m["ITM:" + itm] || null)) || m[String(sku || "").trim().toUpperCase()] || null;
  };
  const suggestQty = (sm) => { for (let i = actualKeys.length - 1; i >= 0; i--) { const a = sm.actuals[actualKeys[i]]; if (a && a.qty) return Math.round(a.qty * FC_SUGGEST_RATIO); } return 0; };
  const suggestVal = (sm, sku) => {
    const lp = listPriceOf(sku, sm);
    if (lp) { const q = suggestQty(sm); if (q) return Math.round(q * (lp.effVnd != null ? lp.effVnd : lp.vnd)); }
    for (let i = actualKeys.length - 1; i >= 0; i--) { const a = sm.actuals[actualKeys[i]]; if (a && a.value) return Math.round(a.value * FC_SUGGEST_RATIO); }
    return 0;
  };

  // A forecast counts toward totals once it is Submitted (or Locked).
  const fcCommitted = (st) => st === "Submitted" || st === "Locked";
  // Committing adopts the suggestion: a rep who submits/locks without touching a cell has
  // signed off on the greyed suggested number. The decision is PER CELL — once the rep has
  // entered either side, the other is derived from what they typed (never from the
  // suggestion), so an explicit qty 0 commits 0 đ and a typed qty prices at that qty.
  const effFC = (key, sku, sm, yk) => {
    const c = getFC(key, sku, yk);
    if (!fcCommitted(getMeta(key, sku).status)) return c;
    const set = (v) => v != null && v !== "";
    const hasQ = set(c.fcQty), hasV = set(c.fcValue);
    if (hasQ && hasV) return c;
    const sq = suggestQty(sm), sv = suggestVal(sm, sku);
    if (hasQ || hasV) {
      const lp = listPriceOf(sku, sm);
      const priced = lp ? (lp.effVnd != null ? lp.effVnd : lp.vnd) : 0;
      // SKUs missing from the price book still have to price SOMETHING, or a rep's qty
      // commits 0 đ — fall back to the unit price the suggestion itself implies.
      const unit = priced > 0 ? priced : (sq > 0 ? sv / sq : 0);
      if (hasQ) return { ...c, fcValue: unit > 0 ? Math.round(c.fcQty * unit) : 0 };
      return { ...c, fcQty: unit > 0 ? Math.max(c.fcValue > 0 ? 1 : 0, Math.round(c.fcValue / unit)) : 0 };
    }
    return { ...c, fcQty: sq, fcValue: sv };
  };

  // ---- KPIs (selected month) ----
  // Submitted + Locked forecasts are committed: their qty & amount count toward the
  // selected month's forecast total (in its own month column), and achievement
  // (%actual/FC) is measured against them. Draft rows stay tentative.
  let kpiFcVal = 0, kpiActVal = 0, kpiFcQty = 0, skuCount = 0;
  compList.forEach(cm => Object.entries(cm.skus).forEach(([sku, sm]) => {
    skuCount++;
    if (fcCommitted(getMeta(cm.key, sku).status)) { const fcc = effFC(cm.key, sku, sm, curKey); kpiFcVal += fcc.fcValue || 0; kpiFcQty += fcc.fcQty || 0; }
    kpiActVal += (sm.actuals[curKey] || {}).value || 0;
  }));
  const achievement = fcPct(kpiActVal, kpiFcVal);

  const fcSort = useSort(null, "asc");
  const fcAcc = {
    customer: cm => compName(cm) || "",
    fc: cm => Object.entries(cm.skus).reduce((s, [sku, sm]) => s + (effFC(cm.key, sku, sm, curKey).fcValue || 0), 0),
    skus: cm => Object.keys(cm.skus).length,
  };
  const fcSortCols = [
    { key: "customer", label: t("fc_col_customer") },
    { key: "fc", label: t("fc_col_fc_value") },
    { key: "skus", label: "SKU" },
  ];
  const sortedComp = fcSort.sort.key ? fcSort.apply(compList, fcAcc) : compList;

  const exportForecast = () => {
    const out = [];
    compList.forEach(cm => Object.entries(cm.skus).forEach(([sku, sm]) => {
      const lpx = listPriceOf(sku, sm);
      const row = { customer: compName(cm), sku, itm: (lpx && lpx.itm) || sm.itm || "", grade: sm.grade || "", size: sm.width ? sm.width + "×" + sm.length : "", type: sm.type, status: getMeta(cm.key, sku).status || "Draft", note: getMeta(cm.key, sku).note || "" };
      allCols.forEach(c => {
        const yk = ymKey(c.y, c.m); const lbl = fmtMon(c.y, c.m);
        const act = sm.actuals[yk] || {}; const fc = effFC(cm.key, sku, sm, yk);
        row[lbl + " ActQty"] = act.qty || 0; row[lbl + " ActVND"] = act.value || 0;
        row[lbl + " FcQty"] = fc.fcQty || 0; row[lbl + " FcVND"] = fc.fcValue || 0;
      });
      out.push(row);
    }));
    window.exportCSV("forecast", out);
  };

  const num = (v) => v === "" || v == null ? "" : String(v);
  // With many companies on screen the grid would mount ~12 inputs per SKU row at once and
  // choke the tab, so a long list starts collapsed and opens per company on click.
  const bulkCollapse = compList.length > 12;
  const TOTAL_COLS = 2 + allCols.length + 2; // product + kind + months + notes + status

  return (
    <div className="page page-wide">
      <style>{`
        .sf-scroll{overflow:auto;max-height:calc(100vh - 240px);border-radius:12px}
        .sf-table{border-collapse:separate;border-spacing:0;min-width:1180px;width:100%;font-size:12.5px}
        .sf-table th{position:sticky;top:0;z-index:3;background:#f8fafc;color:#64748b;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;padding:8px 10px;text-align:center;border-bottom:1px solid #e5e7eb;white-space:nowrap}
        .sf-table th.sf-l{text-align:left}
        .sf-table th.sf-cur{background:#eaf3ff;color:#1d4ed8}
        .sf-table th.sf-fut{background:#eafaf1;color:#0f766e}
        .sf-sub{display:block;font-weight:400;text-transform:none;letter-spacing:0;font-size:9.5px;color:#94a3b8;margin-top:1px}
        .sf-cust-row td{background:#eef5f4;border-top:1px solid #d7e6e3;cursor:pointer;padding:9px 12px}
        .sf-cust-name{font-weight:700;color:#0f766e;font-size:13px}
        .sf-cust-meta{color:#64748b;font-weight:500;font-size:11px;margin-left:8px}
        .sf-prod-row td{border-bottom:1px solid #f1f5f9;padding:6px 10px;text-align:center;vertical-align:middle}
        .sf-prod-row td.sf-l{text-align:left}
        .sf-prod-row td.sf-cur{background:#f5f9ff}
        .sf-prod-row td.sf-fut{background:#f6fdf9}
        .sf-code{font-family:ui-monospace,monospace;font-weight:600;color:#0f766e;font-size:12px}
        .sf-size{color:#94a3b8;font-size:10.5px}
        .sf-badge{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 6px;border-radius:5px;background:#ede9fe;color:#5b21b6}
        .sf-actq{font-weight:600;color:#334155}
        .sf-actv{display:block;font-size:10px;color:#94a3b8}
        .sf-in{width:64px;border:1px solid #d1d5db;border-radius:6px;padding:3px 5px;font-size:12px;text-align:right;outline:none;color:#0f172a;display:block;margin:0 auto}
        .sf-in:focus{border-color:#13988D;box-shadow:0 0 0 2px rgba(19,152,141,.15);background:#fff}
        .sf-in-v{width:74px;font-size:10.5px;color:#475569;display:block;margin:2px auto 0}
        .sf-in:disabled{background:#f1f5f9;color:#94a3b8}
        .sf-note-in{width:150px;border:1px solid #e2e8f0;border-radius:6px;padding:4px 6px;font-size:11.5px;resize:vertical;min-height:30px;outline:none;font-family:inherit}
        .sf-note-in:focus{border-color:#13988D}
        .sf-price{color:#0f766e}
        .sf-cell-lbl{font-size:9px;color:#94a3b8;margin-right:3px}
        .sf-empty{text-align:center;color:#94a3b8;padding:34px 0}
        .sf-kind{font-size:10px;font-weight:700;color:#8a94a6;text-transform:uppercase;letter-spacing:.04em;text-align:left;white-space:nowrap;padding-left:10px}
        .sf-fc-row td{border-bottom:none}
        .sf-act-row td{border-bottom:1px solid #eef1f4}
        .sf-act-row .sf-kind{color:#0f766e}
        .sf-add-btn{float:right;margin-left:8px}
        .sf-del-row{border:none;background:none;color:#cbd5e1;cursor:pointer;font-size:13px;line-height:1;padding:0 2px}
        .sf-del-row:hover{color:#dc2626}
        .fc-tabs{display:flex;gap:6px;margin:0 0 10px}
        .fc-tab{border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;color:#64748b;cursor:pointer}
        .fc-tab.on{background:#0f766e;border-color:#0f766e;color:#fff}
        .fc-pick-list{max-height:min(280px,34vh);overflow:auto;border:1px solid #eef1f4;border-radius:10px}
        .fc-pick-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:none;border-bottom:1px solid #f1f5f9;padding:8px 10px;cursor:pointer;font:inherit}
        .fc-pick-item:hover{background:#f6fbfa}
        .fc-pick-item.on{background:#eaf5f4}
        .fc-pick-item:disabled{opacity:.5;cursor:not-allowed}
        .fc-pick-main{font-weight:600;color:#0f172a;font-size:12.5px}
        .fc-pick-sub{display:block;color:#94a3b8;font-size:10.5px;font-weight:500}
        .fc-pick-num{text-align:right;font-size:11.5px;color:#475569;white-space:nowrap}
        .fc-pick-bar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #eef1f4}
      `}</style>
      <header className="page-head">
        <div>
          <h1>{t("fc_title")}</h1>
          <p className="page-sub">{t("fc_subtitle")}</p>
        </div>
        <div className="head-actions">
          <select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>
            {Object.keys(FCC.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {(isBoss || reps.length > 1) && (
            <select className="select" value={rep} onChange={e => setRep(e.target.value)}>
              <option value="">{t("fc_all_reps")}</option>
              {reps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <select className="select" value={statusF} onChange={e => setStatusF(e.target.value)}>
            <option value="">{t("fc_status")}: {t("all")}</option>
            {FCC.FORECAST_STATUSES.map(s => <option key={s} value={s}>{t("fc_status_" + s)}</option>)}
          </select>
          <SortMenu columns={fcSortCols} sort={fcSort.sort} onSort={fcSort.onSort} />
          {canExport && canExport("forecast") && <button className="btn btn-ghost" onClick={exportForecast}><Icon d={ICONS.upload} size={15} /> Export CSV</button>}
          <button className="btn btn-primary" onClick={() => setAddCust(true)}>+ {t("fc_add_cust")}</button>
        </div>
      </header>

      <div className="kpi-row kpi-row-4">
        <div className="kpi">
          <span className="kpi-label">{t("fc_kpi_total_fc")}</span>
          <span className="kpi-value kpi-money">{FCC.fmtMoneyFull(kpiFcVal, currency)}</span>
          <span className="kpi-foot">{fmtMon(curCol.y, curCol.m)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("fc_kpi_total_actual")}</span>
          <span className="kpi-value kpi-money">{FCC.fmtMoneyFull(kpiActVal, currency)}</span>
          <span className="kpi-foot">{fmtMon(curCol.y, curCol.m)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("fc_kpi_achievement")}</span>
          <span className={"kpi-value" + fcRatioCls(kpiActVal, kpiFcVal).replace(" tg-", " fc-")}>{fcFmtPct(achievement)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("fc_kpi_skus")}</span>
          <span className="kpi-value">{skuCount}</span>
          <span className="kpi-foot">{compList.length} {t("fc_col_customer").toLowerCase()}</span>
        </div>
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 0 12px" }}>
        <div className="search-box search-box-sm" style={{ flex: "0 1 320px" }}>
          <Icon d={ICONS.search} size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("fc_search_ph")} />
        </div>
        {(search || fcCountries.length || rep) ? <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(""); setFcCountries([]); if (isBoss || isCountryMgr || reps.length > 1) setRep(""); }}>{t("fc_reset")}</button> : null}
        <span className="dim" style={{ fontSize: 12 }}>{skuCount} SKU · {compList.length} {t("fc_col_customer").toLowerCase()}</span>
      </div>

      <div className="card table-card" style={{ padding: 0 }}>
        <div className="sf-scroll">
          <table className="sf-table">
            <thead>
              <tr>
                <SortTh label={t("fc_product")} sortKey="customer" sort={fcSort.sort} onSort={fcSort.onSort} className="sf-l" style={{ minWidth: 200 }} />
                <th></th>
                {pastCols.map(c => <th key={ymKey(c.y, c.m)}>{fmtMon(c.y, c.m)}</th>)}
                <th className="sf-cur">{fmtMon(curCol.y, curCol.m)}</th>
                {futCols.map(c => <th key={ymKey(c.y, c.m)} className="sf-fut">{fmtMon(c.y, c.m)}</th>)}
                <th className="sf-l">{t("fc_note")}</th>
                <th>{t("fc_status")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedComp.map(cm => {
                const skus = Object.entries(cm.skus).sort((a, b) => a[0].localeCompare(b[0]));
                const isOpen = collapsed[cm.key] == null ? !bulkCollapse : !collapsed[cm.key];
                const custActCur = skus.reduce((s, [, sm]) => s + ((sm.actuals[curKey] || {}).value || 0), 0);
                const custFcCur = skus.reduce((s, [sku, sm]) => s + (fcCommitted(getMeta(cm.key, sku).status) ? (effFC(cm.key, sku, sm, curKey).fcValue || 0) : 0), 0);
                return (
                  <React.Fragment key={cm.key}>
                    <tr className="sf-cust-row" onClick={() => setCollapsed(s => ({ ...s, [cm.key]: isOpen }))}>
                      <td colSpan={TOTAL_COLS}>
                        <button className="btn btn-ghost btn-sm sf-add-btn" onClick={e => { e.stopPropagation(); setAddCodeFor({ key: cm.key, members: [...cm.members], label: compName(cm), cn: countryOfCust(cm.rep), skus: Object.keys(cm.skus) }); }}>+ {t("fc_add_code")}</button>
                        <span style={{ color: "#0f766e", marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                        <span className="sf-cust-name">{compName(cm)}</span>
                        {compNC(cm) && <span className="nc-chip" style={{ marginLeft: 6 }}>{compNC(cm)}</span>}
                        {cm.members.size > 1 && <span className="sf-badge" style={{ marginLeft: 6, background: "#e0f2f1", color: "#0f766e" }}>{cm.members.size} {t("fc_companies")}</span>}
                        <span className="sf-cust-meta">· {skus.length} SKU · {fmtMon(curCol.y, curCol.m)}: FC {FCC.fmtMoneyFull(custFcCur, currency)} / Act {FCC.fmtMoneyFull(custActCur, currency)}</span>
                      </td>
                    </tr>
                    {isOpen && skus.map(([sku, sm]) => {
                      const meta = getMeta(cm.key, sku);
                      const locked = meta.status === "Locked";
                      // FC value auto-computes from qty(rolls) × roll price
                      // (roll price = unit price × area per roll).
                      const lp = listPriceOf(sku, sm);
                      const rowEff = lp ? (lp.effVnd != null ? lp.effVnd : lp.vnd) : 0;
                      return (
                        <React.Fragment key={cm.key + "|" + sku}>
                          <tr className="sf-prod-row sf-fc-row">
                            <td className="sf-l" rowSpan={2}>
                              <span className="sf-code">{sku}</span> <span className="sf-badge">{sm.type}</span>
                              {sm.manual && !actualKeys.some(k => (sm.actuals[k] || {}).qty) ? <button className="sf-del-row" title={t("fc_del_row")} onClick={() => crmConfirm(t("fc_del_row"), () => deleteSkuRow(cm.key, sku))}>✕</button> : null}
                              <span className="sf-size" style={{ display: "block" }}>{sm.grade}{sm.width ? ` · ${sm.width}×${sm.length}` : ""}</span>
                              {lp ? (
                                <span className="sf-size sf-price" style={{ display: "block" }}>
                                  {t("fc_list_price")}: <strong>{FCC.fmtMoneyFull(lp.vnd, currency)}</strong>{lp.rollVnd ? <span> · {t("pd_roll_price")} {FCC.fmtMoneyFull(lp.rollVnd, currency)}</span> : null}{lp.itm ? <span> · ITM {lp.itm}</span> : null}
                                </span>
                              ) : null}
                            </td>
                            <td className="sf-kind">FC</td>
                            {allCols.map((c, i) => {
                              const yk = ymKey(c.y, c.m); const fc = effFC(cm.key, sku, sm, yk);
                              const cls = i === 3 ? "sf-cur" : i > 3 ? "sf-fut" : "";
                              return (
                                <td key={yk} className={cls}>
                                  <input className="sf-in" type="text" inputMode="numeric" disabled={locked}
                                    value={fc.fcQty ? FCC.fmtNum(fc.fcQty) : ""} placeholder={FCC.fmtNum(suggestQty(sm) || 0)}
                                    onChange={e => { const q = parseNum(e.target.value); saveSkuCell(cm.key, sku, yk, rowEff > 0 ? { fcQty: q, fcValue: Math.round(q * rowEff) } : { fcQty: q }); }} />
                                  <input className="sf-in sf-in-v" type="text" inputMode="decimal" disabled={locked}
                                    value={amtEdit && amtEdit.id === (cm.key + "|" + sku + "|" + yk) ? amtEdit.raw : toDisp(fc.fcValue)} placeholder={toDisp(suggestVal(sm, sku)) || "0"}
                                    onChange={e => { setAmtEdit({ id: cm.key + "|" + sku + "|" + yk, raw: e.target.value }); saveSkuCell(cm.key, sku, yk, "fcValue", toVnd(e.target.value)); }}
                                    onBlur={() => setAmtEdit(null)} />
                                </td>
                              );
                            })}
                            <td className="sf-l" rowSpan={2}>
                              <textarea className="sf-note-in" rows={2} placeholder={t("fc_note")}
                                defaultValue={meta.note || ""}
                                onBlur={e => saveSkuMeta(cm.key, sku, "note", e.target.value)} />
                            </td>
                            <td rowSpan={2}>
                              <select className="select" style={{ fontSize: 11, padding: "3px 6px" }}
                                value={meta.status || "Draft"} onChange={e => saveSkuMeta(cm.key, sku, "status", e.target.value)}>
                                {FCC.FORECAST_STATUSES.map(s => <option key={s} value={s}>{t("fc_status_" + s)}</option>)}
                              </select>
                            </td>
                          </tr>
                          <tr className="sf-prod-row sf-act-row">
                            <td className="sf-kind">{t("fc_actual")}</td>
                            {allCols.map((c, i) => {
                              const yk = ymKey(c.y, c.m); const a = sm.actuals[yk] || {};
                              const future = i > 3;
                              const cls = i === 3 ? "sf-cur" : future ? "sf-fut" : "";
                              return (
                                <td key={yk} className={cls}>
                                  {future ? <span className="sf-actv">—</span> : <React.Fragment>
                                    <span className="sf-actq">{a.qty ? FCC.fmtNum(a.qty) : "—"}</span>
                                    <span className="sf-actv">{a.value ? FCC.fmtMoneyFull(a.value, currency) : ""}</span>
                                  </React.Fragment>}
                                </td>
                              );
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {compList.length === 0 && <tr><td colSpan={TOTAL_COLS} className="sf-empty">{t("fc_no_data")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tg-legend" style={{ marginTop: 12 }}>
        <span className="dim">{t("fc_suggest_hint")}</span>
      </div>
      {addCust && <FcAddCustomerModal exclude={new Set(compList.map(c => c.key))} onClose={() => setAddCust(false)}
        onPick={c => {
          const k = companyKeyOf(c.id);
          setExtraKeys(s => new Set([...s, k]));
          setAddCust(false);
          setAddCodeFor({ key: k, members: compIndex[k] ? [...compIndex[k].members] : [c.id], label: c.shortName || c.name, cn: FCC.normCountry(c.country || ""), skus: Object.keys((skuForecast || {})[k] || {}) });
        }} />}
      {addCodeFor && <FcAddCodeModal ctx={addCodeFor} curKey={curKey} monthLabel={fmtMon(curCol.y, curCol.m)} currency={currency}
        onClose={() => setAddCodeFor(null)}
        onAdd={(sku, meta, cells) => { addFcRow(addCodeFor.key, sku, meta, cells); setAddCodeFor(null); }} />}
    </div>
  );
}

// ---- Add a customer to the forecast (customers not in the grid yet) ----
function FcAddCustomerModal({ exclude, onClose, onPick }) {
  const { t, scopeCustomers, countryFilter } = useApp();
  const C = window.CRM;
  const [q, setQ] = useState("");
  const cn = C.normCountry(countryFilter || "");
  const keyOf = (c) => C.nameCodeKey(C.nameCodeOf(c)) || c.id;
  const s = q.trim().toLowerCase();
  const list = scopeCustomers
    .filter(c => !exclude.has(keyOf(c)))
    .filter(c => !cn || cn === "All" || C.normCountry(c.country) === cn)
    .filter(c => !s || ((c.shortName || "") + " " + (c.name || "") + " " + (c.businessId || "")).toLowerCase().includes(s))
    .sort((a, b) => (a.shortName || a.name || "").localeCompare(b.shortName || b.name || ""))
    .slice(0, 60);
  return (
    <Modal title={t("fc_add_cust")} onClose={onClose} width={520}>
      <p className="status-hint" style={{ margin: "0 0 10px" }}>{t("fc_pick_cust")}</p>
      <div className="search-box search-box-sm" style={{ marginBottom: 10 }}>
        <Icon d={ICONS.search} size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("fc_cust_search")} autoFocus />
      </div>
      <div className="fc-pick-list">
        {list.map(c => (
          <button type="button" key={c.id} className="fc-pick-item" onClick={() => onPick(c)}>
            <span>
              <span className="fc-pick-main">{c.shortName || c.name}</span>
              <span className="fc-pick-sub">{C.normCountry(c.country || "")}{c.owner ? " · " + c.owner : ""}</span>
            </span>
            <span className="fc-pick-num">{c.group || ""}</span>
          </button>
        ))}
        {!list.length && <p className="sf-empty" style={{ margin: 0 }}>{t("fc_none_found")}</p>}
      </div>
    </Modal>
  );
}

// ---- Add a code to one company's forecast: either something it already bought (FC
// suggested from that code's latest month of POs) or a code from the price list. ----
function FcAddCodeModal({ ctx, curKey, monthLabel, currency, onClose, onAdd }) {
  const { t, products } = useApp();
  const C = window.CRM;
  const [tab, setTab] = useState("bought");
  const [hist, setHist] = useState(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const memberKey = (ctx.members || []).join(",");
  useEffect(() => {
    let on = true;
    C.SB.posForCustomers(ctx.members || []).then(ps => {
      if (!on) return;
      const m = {};
      (ps || []).forEach(p => {
        const sku = p.commercial || p.materialName; if (!sku) return;
        const ym = `${p.year}-${String(p.month).padStart(2, "0")}`;
        const r = m[sku] = m[sku] || { sku, itm: p.itm || p.edpCode || "", type: p.productType || "FR", grade: p.grade || "", width: p.width, length: p.length, unit: p.unit || "", cn: C.normCountry(p.country || ctx.cn || ""), months: {}, last: "", lastDate: "" };
        const cell = r.months[ym] = r.months[ym] || { qty: 0, value: 0 };
        cell.qty += p.qty || 0; cell.value += p.amountVnd || 0;
        if (ym > r.last) r.last = ym;
        if (String(p.date || "") > r.lastDate) r.lastDate = String(p.date || "");
      });
      setHist(Object.values(m).sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || "")));
    }).catch(() => { if (on) setHist([]); });
    return () => { on = false; };
  }, [memberKey]);

  const have = new Set(ctx.skus || []);
  const s = q.trim().toLowerCase();
  const histList = (hist || []).filter(r => !s || (r.sku + " " + r.itm).toLowerCase().includes(s));
  const areaOf = (p) => (parseFloat(p.sqmPerRoll) || 0) > 0 ? parseFloat(p.sqmPerRoll) : ((parseFloat(p.width) || 0) / 1000) * (parseFloat(p.length) || 0);
  const rollVndOf = (p) => (parseFloat(p.price) || 0) * areaOf(p) * ((C.CURRENCIES[p.currency] || { rate: 1 }).rate);
  const prodList = (products || [])
    .filter(p => !ctx.cn || !C.normCountry(p.country || "") || C.normCountry(p.country) === ctx.cn)
    .filter(p => !s || ((p.name || "") + " " + (p.code || "") + " " + (p.itmref || "") + " " + (p.eccshoaxx || "") + " " + (p.grade || "")).toLowerCase().includes(s))
    .slice(0, 60);

  const monthLbl = (ym) => ym ? new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : "—";
  const chooseHist = (r) => {
    const last = r.months[r.last] || { qty: 0, value: 0 };
    const unitVnd = last.qty ? last.value / last.qty : 0;
    setPick({
      sku: r.sku, ref: monthLbl(r.last), unitVnd,
      qty: Math.round(last.qty || 0), value: Math.round(last.value || 0),
      meta: { itm: r.itm, type: r.type, grade: r.grade, width: r.width, length: r.length, unit: r.unit, cn: r.cn },
    });
  };
  const chooseProd = (p) => {
    const unitVnd = rollVndOf(p);
    setPick({
      sku: (p.name || p.code || "").trim(), ref: "", unitVnd, qty: 0, value: 0,
      meta: { itm: String(p.itmref || "").trim(), ecc: String(p.eccshoaxx || "").trim(), type: p.productType || "FR", grade: p.grade || "", width: p.width, length: p.length, unit: p.productType === "JR" ? "Kg" : "Cuộn", cn: C.normCountry(p.country || "") },
    });
  };
  const setQty = (v) => setPick(p => {
    const qty = Math.max(0, Math.round(parseFloat(String(v).replace(/[^\d.-]/g, "")) || 0));
    return { ...p, qty, value: p.unitVnd > 0 ? Math.round(qty * p.unitVnd) : p.value };
  });

  // Row model is built in plain JS so the JSX below stays a single flat map.
  const rows = tab === "bought"
    ? histList.map(r => {
      const last = r.months[r.last] || {};
      return {
        key: r.sku, sku: r.sku, badge: r.type, used: have.has(r.sku), pickIt: () => chooseHist(r),
        sub: [r.grade, r.width ? r.width + "×" + r.length : "", r.itm ? "ITM " + r.itm : ""].filter(Boolean).join(" · "),
        num: C.fmtNum(Math.round(last.qty || 0)) + " · " + monthLbl(r.last),
        num2: C.fmtMoneyFull(last.value || 0, currency),
      };
    })
    : prodList.map(p => {
      const nm = (p.name || p.code || "").trim();
      return {
        key: p.id, sku: nm, badge: p.productType || "", used: have.has(nm), pickIt: () => chooseProd(p),
        sub: [p.eccshoaxx || "", p.itmref ? "ITM " + p.itmref : "", p.width ? p.width + "×" + p.length : ""].filter(Boolean).join(" · "),
        num: rollVndOf(p) ? C.fmtMoneyFull(rollVndOf(p), currency) : "—",
        num2: C.normCountry(p.country || "") || "",
      };
    });
  const emptyMsg = tab === "bought"
    ? (hist === null ? "…" : (hist.length ? t("fc_none_found") : t("fc_no_po_history")))
    : t("fc_none_found");

  return (
    <Modal title={t("fc_add_code") + " · " + ctx.label} onClose={onClose} width={640}>
      <div className="fc-tabs">
        <button type="button" className={"fc-tab" + (tab === "bought" ? " on" : "")} onClick={() => { setTab("bought"); setPick(null); }}>{t("fc_tab_bought")}{hist ? " (" + hist.length + ")" : ""}</button>
        <button type="button" className={"fc-tab" + (tab === "new" ? " on" : "")} onClick={() => { setTab("new"); setPick(null); }}>{t("fc_tab_new")}</button>
      </div>
      <p className="status-hint" style={{ margin: "0 0 10px" }}>{tab === "bought" ? t("fc_bought_hint") : t("fc_new_hint")}</p>
      <div className="search-box search-box-sm" style={{ marginBottom: 10 }}>
        <Icon d={ICONS.search} size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("fc_search_code")} autoFocus />
      </div>
      <div className="fc-pick-list">
        {rows.map(r => (
          <button type="button" key={r.key} disabled={r.used} className={"fc-pick-item" + (pick && pick.sku === r.sku ? " on" : "")} onClick={r.pickIt}>
            <span>
              <span className="fc-pick-main">{r.sku}{r.badge ? <span className="sf-badge" style={{ marginLeft: 6 }}>{r.badge}</span> : null}</span>
              <span className="fc-pick-sub">{r.sub}{r.used ? " · " + t("fc_already_in") : ""}</span>
            </span>
            <span className="fc-pick-num">{r.num}<span className="fc-pick-sub">{r.num2}</span></span>
          </button>
        ))}
        {rows.length ? null : <p className="sf-empty" style={{ margin: 0 }}>{emptyMsg}</p>}
      </div>
      {pick && (
        <div className="fc-pick-bar">
          <Field label={t("fc_product")}>
            <input className="input" value={pick.sku} disabled />
          </Field>
          <Field label={t("fc_col_fc_qty") + " · " + monthLabel} required>
            <input className="input" type="text" inputMode="numeric" autoFocus value={pick.qty ? C.fmtNum(pick.qty) : ""} onChange={e => setQty(e.target.value)} />
          </Field>
          <Field label={t("fc_col_fc_value")}>
            <input className="input" value={C.fmtMoneyFull(pick.value || 0, currency)} disabled />
          </Field>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!pick || !(pick.qty > 0)}
          onClick={() => onAdd(pick.sku, pick.meta, { [curKey]: { fcQty: pick.qty, fcValue: pick.value } })}>{t("fc_add_row")}</button>
      </div>
    </Modal>
  );
}

function ForecastDetailPage({ year, month, customerId, salesId, existing, onBack }) {
  const { t, isBoss, assignableCodes, user, users, scopeCustomers, customers, upsertForecast, pos, money, deleteForecast, canEdit, canDelete } = useApp();
  const [f, setF] = useState(existing ? { ...existing } : {
    customerId: customerId || "", salesId: salesId || (user.salesCode || ""),
    targetYear: Number(year), targetMonth: month,
    fcQtyJumboSqm: 0, fcValueJumbo: 0, fcQtyFinishedRolls: 0, fcValueFinished: 0, status: "Draft",
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const sorted = [...scopeCustomers].sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  const cust = customers.find(c => c.id === f.customerId);
  const locked = existing && existing.status === "Locked" && !isBoss;
  const repList = assignableCodes;

  // customer typeahead
  const [custQuery, setCustQuery] = useState(cust ? (cust.shortName || cust.name) : "");
  const [custOpen, setCustOpen] = useState(false);
  const custMatches = custQuery.trim()
    ? sorted.filter(c => (c.shortName || c.name || "").toLowerCase().includes(custQuery.trim().toLowerCase()) || (c.name || "").toLowerCase().includes(custQuery.trim().toLowerCase())).slice(0, 8)
    : sorted.slice(0, 8);
  const pickCust = (c) => { set("customerId", c.id); setCustQuery(c.shortName || c.name); setCustOpen(false); };

  const totalValue = (parseFloat(f.fcValueJumbo) || 0) + (parseFloat(f.fcValueFinished) || 0);
  const valid = f.customerId && f.salesId && f.targetYear && f.targetMonth;

  // PO history for the chosen customer
  const [custPOsSrv, setCustPOsSrv] = useState(null);
  useEffect(() => { let on = true; if (f.customerId) { window.CRM.SB.posForCustomers([f.customerId]).then(r => { if (on) setCustPOsSrv(r); }).catch(() => {}); } return () => { on = false; }; }, [f.customerId]);
  const custPOs = (custPOsSrv || pos.filter(p => p.customerId === f.customerId)).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  function suggestPrice(productType) {
    const matches = custPOs.filter(p => (p.productType || "FR") === productType).slice(0, 5);
    if (!matches.length) return null;
    if (productType === "JR") {
      const totalSqm = matches.reduce((s, p) => s + (p.sqm || 0), 0);
      const totalAmt = matches.reduce((s, p) => s + (p.amountVnd || 0), 0);
      if (!totalSqm) return null;
      return { perUnit: Math.round(totalAmt / totalSqm), unit: "VND/sqm", n: matches.length };
    }
    const totalQty = matches.reduce((s, p) => s + (p.qty || 0), 0);
    const totalAmt = matches.reduce((s, p) => s + (p.amountVnd || 0), 0);
    if (!totalQty) return null;
    return { perUnit: Math.round(totalAmt / totalQty), unit: t("pol_vnd_roll"), n: matches.length };
  }
  const jrSuggestion = f.customerId ? suggestPrice("JR") : null;
  const frSuggestion = f.customerId ? suggestPrice("FR") : null;

  const submit = () => {
    if (!valid || locked) return;
    upsertForecast({
      ...f,
      fcQtyJumboSqm: parseFloat(f.fcQtyJumboSqm) || 0, fcValueJumbo: parseFloat(f.fcValueJumbo) || 0,
      fcQtyFinishedRolls: parseFloat(f.fcQtyFinishedRolls) || 0, fcValueFinished: parseFloat(f.fcValueFinished) || 0,
      targetYear: Number(f.targetYear), targetMonth: Number(f.targetMonth),
    });
    onBack();
  };

  return (
    <div className="page page-wide">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("fc_back")}</button>
      {existing && canDelete && canDelete("forecast") && <button className="btn btn-danger btn-sm" style={{ float: "right" }} onClick={() => crmConfirm(t("del_confirm"), () => { deleteForecast(existing.forecastId); onBack(); })}>{t("pd_delete")}</button>}
      <header className="profile-head card">
        <div className="profile-id">
          <div>
            <h1>{existing ? t("fc_edit") : t("fc_new")}{cust ? " · " + (cust.shortName || cust.name) : ""}</h1>
            <div className="profile-tags">
              <span className="tag">{FC_MONTHS[Number(f.targetMonth) - 1]} {f.targetYear}</span>
              {f.salesId && <OwnerChip code={f.salesId} t={t} />}
              {f.status && <span className="tag">{t("fc_status_" + f.status)}</span>}
            </div>
          </div>
        </div>
      </header>
      {locked && <p className="status-hint" style={{ color: "#D97706" }}>{t("fc_locked_hint")}</p>}

      <div className="profile-grid">
        <section className="card">
          <h2>{t("fc_new")}</h2>
          <div className="form-grid">
            <Field label={t("fc_customer")} required>
              {existing ? (
                <input className="input" value={cust ? (cust.shortName || cust.name) : ""} disabled />
              ) : (
                <div className="fc-typeahead">
                  <input className="input" value={custQuery} placeholder={t("fc_cust_search")}
                    onChange={e => { setCustQuery(e.target.value); setCustOpen(true); set("customerId", ""); }}
                    onFocus={() => setCustOpen(true)}
                    onBlur={() => setTimeout(() => setCustOpen(false), 150)} />
                  {custOpen && custMatches.length > 0 && (
                    <div className="fc-typeahead-list">
                      {custMatches.map(c => (
                        <button type="button" key={c.id} className="fc-typeahead-item" onMouseDown={() => pickCust(c)}>
                          <strong>{c.shortName || c.name}</strong>
                          <small>{c.country}{c.businessId ? " · " + c.businessId : ""}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
            <Field label={t("fc_sales_rep")} required>
              <select className="select" value={f.salesId} onChange={e => set("salesId", e.target.value)} disabled={!isBoss && !!existing}>
                <option value="">—</option>
                {repList.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label={t("fc_year")}>
              <input className="input" type="number" value={f.targetYear} onChange={e => set("targetYear", e.target.value)} disabled={!!existing} />
            </Field>
            <Field label={t("fc_month")}>
              <select className="select" value={f.targetMonth} onChange={e => set("targetMonth", Number(e.target.value))} disabled={!!existing}>
                {FC_MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </Field>
          </div>

          <h2 style={{ marginTop: 16 }}>{t("fc_jr")}</h2>
          <div className="note-card card" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>{t("fc_price_referral_title")}</strong>
            {f.customerId ? (
              <p style={{ margin: "6px 0 0" }}>
                {jrSuggestion
                  ? <span>{t("fc_price_referral_suggestion")} ({t("fc_jr")}): <strong>{FC.fmtNum(jrSuggestion.perUnit)} {jrSuggestion.unit}</strong> ({jrSuggestion.n} PO)</span>
                  : <span className="dim">{t("fc_jr")}: {t("fc_price_referral_none")}</span>}
                <br />
                {frSuggestion
                  ? <span>{t("fc_price_referral_suggestion")} ({t("fc_fr")}): <strong>{FC.fmtNum(frSuggestion.perUnit)} {frSuggestion.unit}</strong> ({frSuggestion.n} PO)</span>
                  : <span className="dim">{t("fc_fr")}: {t("fc_price_referral_none")}</span>}
              </p>
            ) : <p style={{ margin: "6px 0 0" }} className="dim">{t("fc_price_referral_body")}</p>}
          </div>
          <div className="form-grid">
            <Field label={t("fc_qty_jumbo_sqm")}>
              <input className="input" type="number" value={f.fcQtyJumboSqm} onChange={e => set("fcQtyJumboSqm", e.target.value)} disabled={locked} />
            </Field>
            <Field label={t("fc_value_jumbo")}>
              <input className="input" type="number" value={f.fcValueJumbo} onChange={e => set("fcValueJumbo", e.target.value)} disabled={locked} />
            </Field>
          </div>

          <h2 style={{ marginTop: 16 }}>{t("fc_fr")}</h2>
          <div className="form-grid">
            <Field label={t("fc_qty_finished_rolls")}>
              <input className="input" type="number" value={f.fcQtyFinishedRolls} onChange={e => set("fcQtyFinishedRolls", e.target.value)} disabled={locked} />
            </Field>
            <Field label={t("fc_value_finished")}>
              <input className="input" type="number" value={f.fcValueFinished} onChange={e => set("fcValueFinished", e.target.value)} disabled={locked} />
            </Field>
          </div>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label={t("fc_total_value")}>
              <input className="input" value={FC.fmtVND(totalValue)} disabled />
            </Field>
            <Field label={t("fc_status")}>
              <select className="select" value={f.status} onChange={e => set("status", e.target.value)} disabled={locked}>
                {FC.FORECAST_STATUSES.map(s => <option key={s} value={s}>{t("fc_status_" + s)}</option>)}
              </select>
            </Field>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onBack}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={!valid || locked} onClick={submit}>{t("fc_save")}</button>
          </div>
        </section>

        <section className="card">
          <h2>{t("fc_po_history")} {f.customerId && <span className="count-pill">{custPOs.length}</span>}</h2>
          {!f.customerId ? (
            <p className="empty">{t("fc_cust_search")}</p>
          ) : custPOs.length === 0 ? (
            <p className="empty">{t("fc_no_po_history")}</p>
          ) : (
            <table className="table table-plain">
              <thead><tr>
                <th>{t("pol_sales_date")}</th><th>{t("pol_product")}</th>
                <th className="cell-money">{t("pol_qty")}</th><th className="cell-money">{t("pol_amount")}</th>
              </tr></thead>
              <tbody>
                {custPOs.slice(0, 20).map((p, i) => (
                  <tr key={i}>
                    <td>{FC.fmtDate(p.date)}<small className="cell-sub"><span className="tag">{p.productType || "FR"}</span></small></td>
                    <td>{p.commercial || p.materialName || "—"}</td>
                    <td className="cell-money">{FC.fmtNum(p.qty)} {FC.unitLabel(p.unit, t)}</td>
                    <td className="cell-money">{money(p.amountVnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { SalesForecastPage, ForecastDetailPage });
