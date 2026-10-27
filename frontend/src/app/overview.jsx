// Todaytec CRM — Overview dashboard

function ReorderRow({ r, t, customers, goCustomer, setReorderAction }) {
  const RG = window.CRM;
  const cust = customers.find(c => c.id === r.customerId);
  const [channel, setChannel] = useState(r.reminderChannel || "Call");
  const [action, setAction] = useState(r.salesAction || "");
  const [note, setNote] = useState(r.note || "");

  const save = () => {
    setReorderAction(r.key, {
      reminderChannel: channel, reminderSentDate: new Date().toISOString().slice(0, 10),
      salesAction: action, note,
    });
  };

  const dotColor = RG.REORDER_STATUS_COLORS[r.reorderStatus] || "#94A3B8";

  return (
    <div className="ro-row">
      <div className="ro-cust">
        <strong className="row-click" onClick={() => goCustomer(r.customerId)}>{cust ? (cust.shortName || cust.name) : "—"}</strong>
        <small>{r.productCode} · {r.width}×{r.length} · <OwnerChip code={r.pic} t={t} /></small>
      </div>
      <div className="ro-stat">
        <span>{t("ro_cycle")}</span>
        <strong>{r.avgOrderCycleDays} {t("ro_days")}</strong>
      </div>
      <div className="ro-stat">
        <span>{t("ro_avg_qty")}</span>
        <strong>{RG.fmtNum(r.avgQtyPerOrder)}</strong>
      </div>
      <div className="ro-stat">
        <span>{t("ro_predicted")}</span>
        <strong>{RG.fmtDate(r.predictedReorderDate)}</strong>
        <span className="ro-days" style={{ color: dotColor }}>
          {r.daysUntil >= 0 ? r.daysUntil + " " + t("ro_days") : Math.abs(r.daysUntil) + " " + t("ro_days") + " ⌛"}
        </span>
      </div>
      <div className="ro-stat">
        <span>{t("ro_status")}</span>
        <strong style={{ color: dotColor }}>{t("ro_status_" + r.reorderStatus.replace(/\s+/g, "_")) || r.reorderStatus}</strong>
        {r.reminderSentDate && <small>{t("ro_channel")}: {t("ro_channel_" + r.reminderChannel) || r.reminderChannel} · {RG.fmtDate(r.reminderSentDate)}</small>}
      </div>
      <div className="ro-actions">
        <select className="select" value={channel} onChange={e => setChannel(e.target.value)}>
          {["Call", "Line", "Email"].map(c => <option key={c} value={c}>{t("ro_channel_" + c)}</option>)}
        </select>
        <select className="select" value={action} onChange={e => setAction(e.target.value)}>
          <option value="">{t("ro_action")}…</option>
          <option value="Đã gọi nhắc - Khách hẹn tuần sau">{t("ro_sales_action_called")}</option>
          <option value="Đang chờ phản hồi">{t("ro_sales_action_waiting")}</option>
          <option value="Đã chốt được PO mới">{t("ro_sales_action_done")}</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={save}>{t("ro_save")}</button>
      </div>
    </div>
  );
}

function OverviewPage({ goCustomer, goProjects, goReorder, goProject, goPOPeriod }) {
  const { t, user, isBoss, isCountryMgr, teamCodes, scopeCustomers: scopeCustomersAll, scopeProjects: scopeProjectsAll, activity, customers, logs, calendarConnected, toggleCalendar, pos, scopePOs: scopePOsRAM, targets, targetGroups, scopeForecast: scopeForecastAll, skuForecast, repCountry, users, reorderRows, setReorderAction, currency, setCurrency, money, samples, quotations, products } = useApp();
  const CC = window.CRM;
  const countryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const [pvtOpen, setPvtOpen] = useState({});
  // Month anchor follows the ONE topbar date filter: the month the selected range ends in.
  const _gRange = useApp().dateRangeR;
  const _ovAnchor = React.useMemo(() => {
    const s = _gRange && _gRange.to;
    const d = s ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, 1) : new Date();
    return { y: String(d.getFullYear()), m: d.getMonth() };
  }, [_gRange && _gRange.to]);
  const ovYear = _ovAnchor.y, ovMonth = _ovAnchor.m;
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const ovCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setOvCountries = () => {};
  const [ovBreakCountry, setOvBreakCountry] = useState("");
  const [showAllCust, setShowAllCust] = useState(false);
  // Normalise dirty country values ("VN"→Vietnam, "TH"→Thailand) and keep only the
  // markets we operate in, so stray codes never spawn a phantom country column.
  const _MK = CC.MARKETS || ["Vietnam", "Thailand"];
  const normCountry = (c) => {
    const s = String(c || "").trim();
    if (/^(vn|viet\s*nam|vietnam|việt\s*nam)$/i.test(s)) return "Vietnam";
    if (/^(th|thai|thailand)$/i.test(s)) return "Thailand";
    return s;
  };
  const repCountryN = (pic) => normCountry(repCountry(pic));
  const allCountries = [...new Set(scopeCustomersAll.map(c => normCountry(c.country)))].filter(c => _MK.includes(c)).sort((a, b) => countryRank(a) - countryRank(b));
  const allowCountry = (c) => ovCountries.length === 0 || ovCountries.includes(c);
  const _custById = {}; customers.forEach(c => { _custById[c.id] = c; });
  const custCountryOf = (id) => { const c = _custById[id]; return c ? normCountry(c.country) : ""; };
  // Customer's CURRENT group (A–G), matching the PO-list "Customer group" column.
  // Fall back to the PO's own group only when the customer has none set.
  const custGroupOf = (id) => { const c = _custById[id]; return (c && c.group) || ""; };
  // ---- PO totals from the SERVER aggregate (Phase 3) — scales to millions ----
  // Fetch po_agg for (selected year − 1 .. selected year), then SYNTHESISE a lightweight
  // PO array (one entry per year/month/PIC/customer/group) so ALL the per-PO reduce/filter
  // logic below runs unchanged. Permission-scoped in RAM (boss=all, countryMgr=own custs,
  // rep=team PIC ∪ own custs). Falls back to the RAM `scopePOsRAM` array when offline.
  const [ovAggRows, setOvAggRows] = React.useState(null);
  const ovPosLen = pos ? pos.length : 0;
  React.useEffect(() => {
    let on = true;
    (async () => {
      try { const r = await CC.SB.aggRange((Number(ovYear) - 1) + "-01-01", ovYear + "-12-31"); if (on) setOvAggRows(Array.isArray(r) && r.length ? r : (r ? [] : null)); }
      catch (e) { if (on) setOvAggRows(null); }
    })();
    return () => { on = false; };
  }, [ovYear, ovPosLen]);
  const scopePOsAll = React.useMemo(() => {
    if (!ovAggRows) return scopePOsRAM;  // fallback: RAM array
    const custSet = new Set(scopeCustomersAll.map(c => c.id));
    const teamU = new Set((teamCodes || []).map(x => String(x).toUpperCase()));
    const out = [];
    ovAggRows.forEach(r => {
      let ok = isBoss || custSet.has(r.cust);
      if (!ok && !isBoss && !isCountryMgr) ok = teamU.has(String(r.pic || "").toUpperCase());
      if (!ok) return;
      const mo = parseInt(r.mo, 10) || 0;
      out.push({ year: parseInt(r.yr, 10) || 0, month: mo, pic: r.pic || "", customerId: r.cust, group: r.grp || "", amountVnd: Number(r.amount) || 0, sqm: Number(r.sqm) || 0, date: r.yr + "-" + String(mo).padStart(2, "0") + "-01", _cnt: Number(r.cnt) || 0 });
    });
    return out;
  }, [ovAggRows, scopeCustomersAll, teamCodes, isBoss, isCountryMgr]);
  const scopeCustomers = scopeCustomersAll.filter(c => allowCountry(normCountry(c.country)));
  const scopeProjects = scopeProjectsAll.filter(p => allowCountry(custCountryOf(p.customerId)));
  const scopePOs = scopePOsAll.filter(p => allowCountry(custCountryOf(p.customerId) || repCountryN(p.pic)));
  const scopeForecast = scopeForecastAll.filter(f => allowCountry(custCountryOf(f.customerId) || repCountryN(f.salesId)));
  const custs = scopeCustomers;
  const projs = scopeProjects;
  // auto-pick currency from the country filter: Thailand→THB, Vietnam→VND, both→USD
  useEffect(() => {
    if (ovCountries.length === 1 && ovCountries[0] === "Thailand") setCurrency("THB");
    else if (ovCountries.length === 1 && ovCountries[0] === "Vietnam") setCurrency("VND");
    else if (ovCountries.length >= 2) setCurrency("VND");
  }, [ovCountries]);

  const stages = ["New", "Check", "Attempted Contact", "Cold Lead", "Warm Lead", "Hot Lead"];
  const counts = {};
  stages.forEach(s => counts[s] = 0);
  custs.forEach(c => { if (counts[c.funnel] === undefined) counts[c.funnel] = 0; counts[c.funnel]++; });
  const total = custs.length || 1;
  const hot = counts["Hot Lead"] || 0;
  // cumulative funnel: each stage includes all later stages; Check is out of funnel
  const cum = {};
  cum["Hot Lead"] = counts["Hot Lead"];
  cum["Warm Lead"] = counts["Warm Lead"] + cum["Hot Lead"];
  cum["Cold Lead"] = counts["Cold Lead"] + cum["Warm Lead"];
  cum["Attempted Contact"] = counts["Attempted Contact"] + cum["Cold Lead"];
  cum["New"] = counts["New"] + counts["Check"] + cum["Attempted Contact"];

  const active = projs.filter(p => p.stage !== "Won" && p.stage !== "Lost");
  const pipelineValue = active.reduce((s, p) => s + (p.value || 0), 0);
  // all non-lost project value (includes Won) — matches the Projects tab header total
  const projNonLostValue = projs.filter(p => p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
  // current-month forecast value from the per-SKU forecast store (matches the Forecast tab).
  // Counts ONLY customers inside the current scope + country filter — otherwise a Thailand
  // view would show Vietnam's forecast (and vice versa).
  const _fcCurKey = ovYear + "-" + String(ovMonth + 1).padStart(2, "0");
  // NOTE: skuForecast is keyed by COMPANY key (name code), falling back to customer id —
  // the same key forecast.jsx writes with. Allow both forms.
  const _fcCustOK = React.useMemo(() => {
    const s = new Set();
    scopeCustomers.forEach(c => {
      s.add(c.id);
      const nc = CC.nameCodeOf ? CC.nameCodeOf(c) : "";
      const k = nc && CC.nameCodeKey ? CC.nameCodeKey(nc) : "";
      if (k) s.add(k);
    });
    return s;
  }, [scopeCustomers]);
  // Committed forecast (Submitted / Locked rows) from the per-SKU store — the same rule and
  // the same stored figures as the Sales Forecast page's "Total forecast (month)": the page
  // writes the adopted numbers into the cells when a row is submitted or locked.
  const fcAgg = React.useMemo(() => {
    const repOfKey = {};
    scopeCustomers.forEach(c => {
      repOfKey[c.id] = repOfKey[c.id] || c;
      const nc = CC.nameCodeOf ? CC.nameCodeOf(c) : "";
      const k = nc && CC.nameCodeKey ? CC.nameCodeKey(nc) : "";
      if (k && (!repOfKey[k] || /head\s*office/i.test(c.name || ""))) repOfKey[k] = c;
    });
    const byYm = {}, byCust = {}, byRep = {};
    Object.entries(skuForecast || {}).forEach(([key, skus]) => {
      if (!skus || !_fcCustOK.has(key)) return;
      const rc = repOfKey[key];
      Object.values(skus).forEach(sm => {
        if (!sm || sm._deleted || !(sm.status === "Submitted" || sm.status === "Locked")) return;
        Object.entries(sm.cells || {}).forEach(([yk, c]) => {
          const v = (c && +c.fcValue) || 0; if (!v) return;
          byYm[yk] = (byYm[yk] || 0) + v;
          if (rc) {
            byCust[rc.id] = (byCust[rc.id] || 0) + v;
            if (rc.owner) byRep[rc.owner] = (byRep[rc.owner] || 0) + v;
          }
        });
      });
    });
    return { byYm, byCust, byRep };
  }, [skuForecast, _fcCustOK, scopeCustomers]);
  const fcSkuCur = fcAgg.byYm[_fcCurKey] || 0;

  // hot leads with at least 1 project
  const hotIds = new Set(custs.filter(c => c.funnel === "Hot Lead").map(c => c.id));
  const projCustIds = new Set(projs.map(p => p.customerId));
  const hotWithProj = new Set(projs.map(p => p.customerId).filter(id => hotIds.has(id))).size;
  // single source of truth for CVR: share of Hot Leads that converted to a project
  const cvr = hot ? Math.round(hotWithProj / hot * 100) : 0;

  // by country — counts per market (country values normalised upstream in custCountryOf)
  const byCountry = {};
  custs.forEach(c => { const k = normCountry(c.country); if (_MK.includes(k)) byCountry[k] = (byCountry[k] || 0) + 1; });
  const countryRows = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);

  // by sales rep, grouped per country. A rep appears here ONLY if they (a) exist as an
  // account in Permissions AND (b) are allocated a country KPI for the selected year —
  // reps with no KPI for the year are hidden. Grouped by the rep's assigned country.
  // Rep key = sales code, or the account NAME for code-less accounts (e.g. an Admin like
  // Thuy who still carries a country KPI) — same convention the Targets grid uses.
  const repKeyOf = (u) => u.salesCode || (u.name || "").trim();
  const activeRepSet = new Set((users || []).filter(u => u.salesCode).map(u => u.salesCode));
  const custCountByOwner = {};
  custs.forEach(c => { if (c.owner && activeRepSet.has(c.owner)) custCountByOwner[c.owner] = (custCountByOwner[c.owner] || 0) + 1; });
  const salesByCountry = {};
  // Every active account allocated a country in Permissions (its KPI country targetCountry,
  // else a single assigned country) appears here — including code-less admins like Thuy —
  // even with no KPI/PO yet. Grouped by that country.
  (users || []).forEach(u => {
    if (u._deleted) return;
    const pic = repKeyOf(u); if (!pic) return;
    const k = CC.kpiCountryOf(u); if (!_MK.includes(k) || !allowCountry(k)) return;
    (salesByCountry[k] = salesByCountry[k] || {})[pic] = custCountByOwner[pic] || 0;
  });
  const salesCountryRows = Object.entries(salesByCountry).map(([country, m]) => ({
    country, reps: Object.entries(m).sort((a, b) => b[1] - a[1]),
  })).sort((a, b) => (byCountry[b.country] || 0) - (byCountry[a.country] || 0));
  const maxRep = Math.max(1, ...salesCountryRows.flatMap(g => g.reps.map(r => r[1])));

  // upcoming meetings (from interaction logs)
  const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
  const meetings = logs
    .filter(l => l.type === "meeting" && l.when && l.when.replace("T", " ") >= nowStr)
    .filter(l => isBoss || l.user === user.salesCode)
    .sort((a, b) => a.when.localeCompare(b.when))
    .slice(0, 5);

  const acts = isBoss ? activity : activity.filter(a => a.user === user.salesCode);

  // ---- value KPIs + per-rep / per-customer value (PO + Project + Forecast) ----
  const fcVal = (f) => (f.fcValueJumbo || 0) + (f.fcValueFinished || 0);
  const poValueTotal = scopePOs.reduce((s, p) => s + (p.amountVnd || 0), 0);
  // PO value shown on Overview = year-to-date (Jan 1 → today), matching the PO List tab's default total
  const _poYtdFrom = (new Date().getFullYear()) + "-01-01";
  const _poYtdTo = new Date().toISOString().slice(0, 10);
  const poYTD = scopePOs.filter(p => (p.date || "") >= _poYtdFrom && (p.date || "") <= _poYtdTo).reduce((s, p) => s + (p.amountVnd || 0), 0);
  const forecastValueTotal = Object.entries(fcAgg.byYm).reduce((s, [yk, v]) => s + (yk.slice(0, 4) === String(ovYear) ? v : 0), 0);
  const grandTotalValue = poValueTotal + pipelineValue + forecastValueTotal;
  const fcByRep = fcAgg.byRep;
  const poByRep = {}; scopePOs.forEach(p => { poByRep[p.pic] = (poByRep[p.pic] || 0) + (p.amountVnd || 0); });
  const projByRep = {}; scopeProjects.forEach(p => { if (p.stage !== "Lost" && p.stage !== "Won") projByRep[p.following] = (projByRep[p.following] || 0) + (p.value || 0); });
  // by customer (top 8 by total value)
  const custValRows = (() => {
    const map = {};
    const get = id => (map[id] = map[id] || { customerId: id, po: 0, poCount: 0, fc: 0, proj: 0, _pns: null });
    // PO count = distinct PO NUMBERS (one order can span several line records). The
    // server aggregate already counts distinct; the RAM fallback de-dupes here.
    scopePOs.forEach(p => {
      if (!p.customerId) return;
      const g = get(p.customerId); g.po += p.amountVnd || 0;
      if (p._cnt != null) { g.poCount += p._cnt; return; }
      const pn = String(p.poNumber || "").trim() || ("ID:" + p.id);
      (g._pns = g._pns || new Set()).add(pn);
    });
    Object.values(map).forEach(g => { if (g._pns) { g.poCount += g._pns.size; g._pns = null; } });
    Object.entries(fcAgg.byCust).forEach(([cid, v]) => { get(cid).fc += v; });
    scopeProjects.forEach(p => { if (p.stage !== "Lost" && p.stage !== "Won" && p.customerId) get(p.customerId).proj += p.value || 0; });
    return Object.values(map).map(r => ({ ...r, total: r.po + r.fc + r.proj })).sort((a, b) => b.total - a.total);
  })();
  // top-20 by total value shown by default; "view all" expands to the full list
  const custValFiltered = custValRows.filter(r => !ovBreakCountry || custCountryOf(r.customerId) === ovBreakCountry);
  const custValShown = showAllCust ? custValFiltered : custValFiltered.slice(0, 20);

  // PO vs Target by country + MoM
  const nowD = new Date();
  const curYear = ovYear;
  const curMonth = ovMonth; // 0-based, from header filter
  const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear = curMonth === 0 ? String(Number(curYear) - 1) : curYear;
  const ytdSum = (arr) => (arr || []).slice(0, curMonth + 1).reduce((s, v) => s + (v || 0), 0);
  // ---- MoM aggregates for the KPI cards (selected month vs previous) ----
  const inMonth = (d, yStr, mIdx) => !!d && d.slice(0, 7) === yStr + "-" + String(mIdx + 1).padStart(2, "0");
  const custCur = custs.filter(c => inMonth(c.created, curYear, curMonth)).length;
  const custPrev = custs.filter(c => inMonth(c.created, prevYear, prevMonth)).length;
  const hotCur = custs.filter(c => c.funnel === "Hot Lead" && inMonth(c.created, curYear, curMonth)).length;
  const hotPrev = custs.filter(c => c.funnel === "Hot Lead" && inMonth(c.created, prevYear, prevMonth)).length;
  const projCur = projs.filter(p => inMonth(p.createdAt, curYear, curMonth)).length;
  const projPrev = projs.filter(p => inMonth(p.createdAt, prevYear, prevMonth)).length;
  const projValCur = projs.filter(p => inMonth(p.createdAt, curYear, curMonth)).reduce((s, p) => s + (p.value || 0), 0);
  const projValPrev = projs.filter(p => inMonth(p.createdAt, prevYear, prevMonth)).reduce((s, p) => s + (p.value || 0), 0);
  const poCur = scopePOs.filter(p => String(p.year) === curYear && p.month - 1 === curMonth).reduce((s, p) => s + (p.amountVnd || 0), 0);
  const poPrev = scopePOs.filter(p => String(p.year) === prevYear && p.month - 1 === prevMonth).reduce((s, p) => s + (p.amountVnd || 0), 0);
  const fcYm = (y, mIdx) => fcAgg.byYm[y + "-" + String(mIdx + 1).padStart(2, "0")] || 0;
  const fcCur = fcYm(curYear, curMonth);
  const fcPrev = fcYm(prevYear, prevMonth);
  const totalCur = poCur + fcCur + projValCur;
  const totalPrev = poPrev + fcPrev + projValPrev;

  // ---- Period sub-metrics (MTD / MoM / QTD / QoQ / YTD / YoY) for the value cards ----
  const _yPrev = String(Number(curYear) - 1);
  const _mArr = () => Array(12).fill(0);
  const poCurArr = _mArr(), poPrevArr = _mArr(), fcCurArr = _mArr(), fcPrevArr = _mArr(), prCurArr = _mArr(), prPrevArr = _mArr();
  scopePOs.forEach(p => { const mi = (p.month || 0) - 1; if (mi < 0 || mi > 11) return; if (String(p.year) === curYear) poCurArr[mi] += p.amountVnd || 0; else if (String(p.year) === _yPrev) poPrevArr[mi] += p.amountVnd || 0; });
  for (let mi = 0; mi < 12; mi++) { fcCurArr[mi] = fcYm(curYear, mi); fcPrevArr[mi] = fcYm(_yPrev, mi); }
  projs.forEach(p => { if (!p.createdAt) return; const y = p.createdAt.slice(0, 4); const mi = +p.createdAt.slice(5, 7) - 1; if (mi < 0 || mi > 11) return; if (y === curYear) prCurArr[mi] += p.value || 0; else if (y === _yPrev) prPrevArr[mi] += p.value || 0; });
  const totCurArr = _mArr(), totPrevArr = _mArr();
  for (let i = 0; i < 12; i++) { totCurArr[i] = poCurArr[i] + fcCurArr[i] + prCurArr[i]; totPrevArr[i] = poPrevArr[i] + fcPrevArr[i] + prPrevArr[i]; }
  const _sum = (a, s, e) => { let tot = 0; for (let i = s; i <= e; i++) tot += a[i] || 0; return tot; };
  const _delta = (cur, base) => { if (!base) return { txt: "—", cls: "ov-sub-flat" }; const d = Math.round((cur - base) / base * 100); return { txt: (d >= 0 ? "+" : "") + d + "%", cls: d > 0 ? "ov-sub-up" : d < 0 ? "ov-sub-down" : "ov-sub-flat" }; };
  const periodStats = (cur, prev, mi) => {
    const mtd = cur[mi] || 0;
    const momBase = mi > 0 ? cur[mi - 1] : (prev[11] || 0);
    const qStart = Math.floor(mi / 3) * 3, qLen = mi - qStart + 1;
    const qtd = _sum(cur, qStart, mi);
    let pqArr = cur, pqStart = qStart - 3;
    if (pqStart < 0) { pqStart = 9; pqArr = prev; }
    const qoqBase = _sum(pqArr, pqStart, pqStart + qLen - 1);
    const ytd = _sum(cur, 0, mi), ytdPrev = _sum(prev, 0, mi);
    return { mtd, qtd, ytd, mom: _delta(mtd, momBase), qoq: _delta(qtd, qoqBase), yoy: _delta(ytd, ytdPrev) };
  };
  const stTotal = periodStats(totCurArr, totPrevArr, curMonth);
  const stPO = periodStats(poCurArr, poPrevArr, curMonth);
  const stProj = periodStats(prCurArr, prPrevArr, curMonth);
  const stFc = periodStats(fcCurArr, fcPrevArr, curMonth);
  const hotWithProjCur = custs.filter(c => c.funnel === "Hot Lead" && inMonth(c.created, curYear, curMonth) && projCustIds.has(c.id)).length;
  const hotWithProjPrev = custs.filter(c => c.funnel === "Hot Lead" && inMonth(c.created, prevYear, prevMonth) && projCustIds.has(c.id)).length;
  const cvrCur = hotCur ? hotWithProjCur / hotCur * 100 : 0;
  const cvrPrev = hotPrev ? hotWithProjPrev / hotPrev * 100 : 0;
  // Samples & Quotations counts (scoped to filtered customers) + MoM
  const scopeCustIdSet = new Set(custs.map(c => c.id));
  const smpScoped = (samples || []).filter(s => scopeCustIdSet.has(s.customerId));
  const quScoped = (quotations || []).filter(x => scopeCustIdSet.has(x.customerId));
  const sampleCount = smpScoped.length;
  const quoteCount = quScoped.length;
  const smpCur = smpScoped.filter(s => inMonth(s.sentDate, curYear, curMonth)).length;
  const smpPrev = smpScoped.filter(s => inMonth(s.sentDate, prevYear, prevMonth)).length;
  const qtCur = quScoped.filter(x => inMonth(x.quoteDate, curYear, curMonth)).length;
  const qtPrev = quScoped.filter(x => inMonth(x.quoteDate, prevYear, prevMonth)).length;
  // reps to chart = sales accounts that exist in Permissions only (no synthesising
  // from target/PO data — a rep must be added as an account to appear anywhere).
  const repTgtArr = (pic) => {
    const pg = ((targetGroups[curYear] || {})[pic]) || {};
    const a = Array(12).fill(0);
    Object.keys(pg).forEach(g => { const ga = pg[g] || []; for (let m = 0; m < 12; m++) a[m] += ga[m] || 0; });
    return a;
  };
  const repsAll = (isBoss ? [...new Set(users.filter(u => u.salesCode).map(u => u.salesCode))] : [user.salesCode].filter(Boolean)).filter(pic => allowCountry(repCountry(pic)));
  // Overview pivot scope: which sales codes this account may see in the breakdown tables.
  // Country filter first (a rep with no KPI country stays visible), then permission scope.
  const ovpTeam = new Set([...(teamCodes || []), user && user.salesCode].filter(Boolean).map(x => String(x).toUpperCase()));
  const picOK = React.useCallback((pic) => {
    const P = String(pic || "").toUpperCase();
    if (!P) return false;
    const rc = repCountryN(P);
    if (rc && !allowCountry(rc)) return false;
    return isBoss || isCountryMgr || ovpTeam.has(P);
  }, [ovCountries.join(","), isBoss, isCountryMgr, (teamCodes || []).join(","), user && user.salesCode]);
  const pvtRows = (() => {
    const map = {};
    const ensure = (country) => (map[country] = map[country] || { country, target: 0, act: 0, prev: 0, tgArr: Array(12).fill(0), acArr: Array(12).fill(0) });
    // always show the markets we operate in as baseline rows (within country scope)
    (CC.MARKETS || []).filter(c => allowCountry(c)).forEach(ensure);
    repsAll.forEach(pic => {
      const country = repCountryN(pic);
      if (!_MK.includes(country)) return;
      const row = ensure(country);
      const ta = repTgtArr(pic);
      for (let m = 0; m < 12; m++) row.tgArr[m] += ta[m] || 0;
      row.target += ta[curMonth] || 0;
    });
    scopePOs.forEach(p => {
      const country = custCountryOf(p.customerId) || repCountryN(p.pic);
      if (!country || !allowCountry(country) || !_MK.includes(country)) return;
      const row = ensure(country);
      if (String(p.year) === curYear) { const mi = p.month - 1; if (mi >= 0 && mi < 12) row.acArr[mi] += p.amountVnd || 0; }
      if (String(p.year) === curYear && p.month - 1 === curMonth) row.act += p.amountVnd || 0;
      if (String(p.year) === prevYear && p.month - 1 === prevMonth) row.prev += p.amountVnd || 0;
    });
    return Object.values(map).sort((a, b) => countryRank(a.country) - countryRank(b.country) || b.act - a.act);
  })();
  const sumArr = (rows, key) => { const a = Array(12).fill(0); rows.forEach(r => (r[key] || []).forEach((v, m) => a[m] += v || 0)); return a; };
  const pvtTotal = { ...pvtRows.reduce((s, r) => ({ target: s.target + r.target, act: s.act + r.act, prev: s.prev + r.prev }), { target: 0, act: 0, prev: 0 }), tgArr: sumArr(pvtRows, "tgArr"), acArr: sumArr(pvtRows, "acArr") };
  // PO vs Target by sales rep (same month window)
  // resolve a PO's rep to a registered salesCode: PO.pic may be a code OR name OR a broken
  // Excel value (#NAME?, #N/A); fall back to the customer's pic/owner, else "Unassigned".
  const _repIndex = (() => {
    // Effective rep key: salesCode if set, else the account NAME — so an account
    // tagged as PIC on POs but WITHOUT a sales code (e.g. an admin who also carries
    // orders, like a BOD who sells) still resolves to itself and rolls up as a rep.
    const byCode = {}, byName = {};
    (users || []).forEach(u => {
      const eff = u.salesCode || u.name || "";
      if (!eff) return;
      if (u.salesCode) byCode[u.salesCode.toUpperCase()] = eff;
      if (u.name) byName[u.name.toUpperCase()] = eff;
      if (u.shortName) byName[u.shortName.toUpperCase()] = eff;
    });
    return { byCode, byName };
  })();
  // Resolve a rep key (salesCode or name) to its account + KPI country.
  const _userByRepKey = {};
  (users || []).forEach(u => { const k = u.salesCode || u.name || ""; if (k) _userByRepKey[k.toUpperCase()] = u; });
  const _repCountryK = (key) => {
    const u = _userByRepKey[String(key || "").toUpperCase()];
    if (u) { const kc = CC.kpiCountryOf(u); if (kc) return kc; if (u.targetCountry === CC.KPI_NONE) return ""; }
    return repCountryN(key);
  };
  const resolveRep = (p) => {
    const tryV = (v) => { if (!v) return null; const k = String(v).trim().toUpperCase(); if (!k || k.includes("#") || k === "N/A") return null; return _repIndex.byCode[k] || _repIndex.byName[k] || null; };
    const cust = _custById[p.customerId];
    return tryV(p.pic) || (cust && (tryV(cust.pic) || tryV(cust.owner))) || null;
  };
  // Same permission + country test scopePOsAll applies to po_agg rows, reused for the
  // material aggregate (which is fetched separately and so is not pre-scoped).
  const ovpRowOK = React.useCallback((custId, pic) => {
    const P = String(pic || "").toUpperCase();
    if (!allowCountry(custCountryOf(custId) || repCountryN(P))) return false;
    if (isBoss) return true;
    if (_custById[custId] && scopeCustomersAll.some(c => c.id === custId)) return true;
    return !isCountryMgr && ovpTeam.has(P);
  }, [ovCountries.join(","), isBoss, isCountryMgr, scopeCustomersAll.length, customers.length]);
  // Sales-rep rows for the breakdown table: the accounts that carry a KPI country in
  // Permissions (same list the Targets grid uses), so codes with no account never show up.
  const ovpReps = React.useMemo(() => (users || [])
    .filter(u => !u._deleted)
    .map(u => ({ key: String(u.salesCode || u.name || "").toUpperCase(), label: u.salesCode || u.name || "", country: CC.kpiCountryOf(u) }))
    .filter(r => r.key && _MK.includes(r.country) && allowCountry(r.country) && picOK(r.key)),
    [users, ovCountries.join(","), picOK]);
  const pvtRepRows = (() => {
    const map = {};
    const unassigned = {};
    repsAll.forEach(pic => {
      const ta = repTgtArr(pic);
      const tgArr = Array(12).fill(0); for (let m = 0; m < 12; m++) tgArr[m] = ta[m] || 0;
      map[pic] = { pic, country: repCountryN(pic), target: ta[curMonth] || 0, act: 0, prev: 0, tgArr, acArr: Array(12).fill(0) };
    });
    const bump = (row, p) => {
      if (String(p.year) === curYear) { const mi = p.month - 1; if (mi >= 0 && mi < 12) row.acArr[mi] += p.amountVnd || 0; }
      if (String(p.year) === curYear && p.month - 1 === curMonth) row.act += p.amountVnd || 0;
      if (String(p.year) === prevYear && p.month - 1 === prevMonth) row.prev += p.amountVnd || 0;
    };
    scopePOs.forEach(p => {
      const rep = resolveRep(p);
      if (rep) {
        // A PO whose PIC matches a real account with no sales code (e.g. THUY, a BOD
        // who carries orders) is added as its own rep row instead of "Unassigned".
        if (!map[rep] && _userByRepKey[rep.toUpperCase()]) {
          const cn = _repCountryK(rep);
          if (allowCountry(cn)) {
            const ta = repTgtArr(rep);
            const tgArr = Array(12).fill(0); for (let m = 0; m < 12; m++) tgArr[m] = ta[m] || 0;
            map[rep] = { pic: rep, country: cn, target: ta[curMonth] || 0, act: 0, prev: 0, tgArr, acArr: Array(12).fill(0) };
          }
        }
        if (map[rep]) { bump(map[rep], p); return; }
      }
      // unattributed PO → bucket under its country so per-person totals reconcile with the country total
      const country = custCountryOf(p.customerId) || repCountryN(p.pic);
      if (!country || !allowCountry(country) || !_MK.includes(country)) return;
      const u = unassigned[country] = unassigned[country] || { pic: null, unassigned: true, country, target: 0, act: 0, prev: 0, tgArr: Array(12).fill(0), acArr: Array(12).fill(0) };
      bump(u, p);
    });
    const rows = Object.values(map);
    Object.values(unassigned).forEach(u => { if (u.act || u.prev || u.acArr.some(v => v)) rows.push(u); });
    return rows.sort((a, b) => (a.country === b.country ? b.act - a.act : a.country.localeCompare(b.country)));
  })();
  const pvtMaxAct = Math.max(1, ...pvtRows.map(r => r.act), ...pvtRepRows.map(r => r.act));
  const fmtShort = (vnd) => {
    if (!vnd) return "—";
    const v = vnd / (CC.CURRENCIES[currency] ? CC.CURRENCIES[currency].rate : 1);
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return Math.round(v / 1e6) + "M";
    if (v >= 1e3) return Math.round(v / 1e3) + "K";
    return Math.round(v).toString();
  };
  // PO vs Target by customer type (A–G groups, current month) — split per country
  const pvtTypeByCountry = (() => {
    const groupIds = CC.GROUPS.map(g => g.id);
    const countries = (CC.MARKETS || ["Vietnam", "Thailand"]).filter(c => allowCountry(c)).sort((a, b) => countryRank(a) - countryRank(b));
    const result = {};
    countries.forEach(country => {
      const reps = repsAll.filter(pic => repCountryN(pic) === country);
      const repsSet = new Set(reps);
      const map = {};
      groupIds.forEach(g => { map[g] = { type: g, target: 0, act: 0, prev: 0, tgArr: Array(12).fill(0), acArr: Array(12).fill(0) }; });
      reps.forEach(pic => {
        const pg = ((targetGroups[curYear] || {})[pic]) || {};
        groupIds.forEach(g => { const ga = pg[g] || []; for (let m = 0; m < 12; m++) map[g].tgArr[m] += ga[m] || 0; map[g].target += ga[curMonth] || 0; });
      });
      scopePOs.forEach(p => {
        const poCountry = custCountryOf(p.customerId) || repCountryN(p.pic);
        if (poCountry !== country) return;
        const graw = custGroupOf(p.customerId) || p.group; const g = CC.normGroup(graw); if (!g || !map[g]) return;
        if (String(p.year) === curYear) { const mi = p.month - 1; if (mi >= 0 && mi < 12) map[g].acArr[mi] += p.amountVnd || 0; }
        if (String(p.year) === curYear && p.month - 1 === curMonth) map[g].act += p.amountVnd || 0;
        if (String(p.year) === prevYear && p.month - 1 === prevMonth) map[g].prev += p.amountVnd || 0;
      });
      result[country] = groupIds.map(g => map[g]);
    });
    return result;
  })();
  const MomBadge = ({ cur, prev }) => {
    if (!prev) return <span className="mom-badge mom-flat">{t("ov_mom")} —</span>;
    const d = Math.round((cur - prev) / prev * 100);
    return <span className={"mom-badge " + (d >= 0 ? "mom-up" : "mom-down")}>{t("ov_mom")} {d >= 0 ? "▲" : "▼"} {Math.abs(d)}%</span>;
  };
  const fmtShortMoney = (v) => CC.fmtMoney(v, currency);
  const pad2 = (n) => String(n).padStart(2, "0");
  // date range for a period type, based on the selected year/month
  const periodRange = (kind) => {
    const lastDay = new Date(Number(curYear), curMonth + 1, 0).getDate();
    const to = `${curYear}-${pad2(curMonth + 1)}-${pad2(lastDay)}`;
    let fromMonth = curMonth;
    if (kind === "qtd") fromMonth = Math.floor(curMonth / 3) * 3;
    else if (kind === "ytd") fromMonth = 0;
    return { from: `${curYear}-${pad2(fromMonth + 1)}-01`, to };
  };
  const ValueSub = ({ st, drill }) => {
    const jump = drill && goPOPeriod ? (kind) => goPOPeriod(periodRange(kind)) : null;
    const cell = (kind, label, val) => (
      <div className={jump ? "ov-sub-jump" : ""} onClick={jump ? () => jump(kind) : undefined} title={jump ? t("ov_drill_po") : undefined}>
        <span className="ov-sub-l">{label}</span><span className="ov-sub-v">{val}</span>
      </div>
    );
    return (
      <div className="ov-kpi-sub">
        {cell("mtd", "MTD", fmtShortMoney(st.mtd))}
        <div><span className="ov-sub-l">MoM</span><span className={"ov-sub-v " + st.mom.cls}>{st.mom.txt}</span></div>
        {cell("qtd", "QTD", fmtShortMoney(st.qtd))}
        <div><span className="ov-sub-l">QoQ</span><span className={"ov-sub-v " + st.qoq.cls}>{st.qoq.txt}</span></div>
        {cell("ytd", "YTD", fmtShortMoney(st.ytd))}
        <div><span className="ov-sub-l">YoY</span><span className={"ov-sub-v " + st.yoy.cls}>{st.yoy.txt}</span></div>
      </div>
    );
  };
  const PvtRow = ({ r, strong, labelNode, expandable, expanded, onToggle, sub, maxAct }) => {
    // Bar, value & % track the SELECTED MONTH only (MTD) — not YTD or full year; the MoM
    // badge compares the selected month vs the previous month.
    const act = r.act || 0;
    const target = r.target || 0;
    // With a target, the bar shows attainment (act/target). Without a target set,
    // fall back to showing value proportional to the biggest sibling row so a row
    // that HAS PO value still renders a bar instead of an empty track.
    const barPct = target ? Math.min(act / target * 100, 100) : (maxAct && act ? Math.min(act / maxAct * 100, 100) : 0);
    return (
    <div className={"pvt-row" + (strong ? " pvt-total" : "") + (sub ? " pvt-sub" : "")}>
      <span className="pvt-country">
        {expandable && <button className="pvt-toggle" onClick={onToggle} aria-label="toggle">{expanded ? "−" : "+"}</button>}
        {labelNode ? labelNode : (strong ? <strong>{t("tg_total")}</strong> : <><Icon d={ICONS.globe} size={13} /> {r.country}</>)}
      </span>
      <div className="pvt-bar">
        <div className={"pvt-bar-act" + (target ? "" : " pvt-bar-notgt")} style={{ width: barPct + "%" }}></div>
      </div>
      <span className="pvt-nums"><strong>{fmtShort(act)}</strong> / {fmtShort(target)} <small className="dim">{t("ov_vs_target")}</small></span>
      <span className={"pvt-pct" + (target && act / target >= 1 ? " ok" : "")}>{target ? Math.round(act / target * 100) + "%" : "—"}</span>
      <MomBadge cur={r.act} prev={r.prev} />
    </div>
    );
  };
  const FUNNEL_ORDER = ["New", "Attempted Contact", "Cold Lead", "Warm Lead", "Hot Lead"];
  const maxCount = Math.max(cum["New"], 1);

  // ---- Sales pipeline funnel + KPIs: Customer → Projects → Sample → Quotations → PO ----
  // counts = distinct scoped customers that have reached each stage
  const _distinctCust = (arr) => new Set(arr.map(x => x.customerId).filter(id => scopeCustIdSet.has(id))).size;
  const inPipelineCount = _distinctCust(active);
  const poCustCount = _distinctCust(scopePOs);
  const poConvPct = custs.length ? Math.round(poCustCount / custs.length * 100) : 0;
  const pipeStages = [
    { key: "customer", label: t("pf_customer"), n: custs.length, color: "#64748B" },
    { key: "projects", label: t("pf_projects"), n: _distinctCust(projs), color: "#3B82F6" },
    { key: "sample", label: t("pf_sample"), n: _distinctCust(smpScoped), color: "#8B5CF6" },
    { key: "quotation", label: t("pf_quotation"), n: _distinctCust(quScoped), color: "#F59E0B" },
    { key: "po", label: t("pf_po"), n: poCustCount, color: "#13988D" },
  ];
  const pipeMax = Math.max(pipeStages[0].n, 1);

  // ---- Reorder engine widget data ----
  const custIdSet = new Set(custs.map(c => c.id));
  const scopedReorder = (reorderRows || []).filter(r => custIdSet.has(r.customerId));
  const reorderDueSoon = scopedReorder.filter(r => r.reorderStatus === "Sắp đến hạn").sort((a, b) => a.daysUntil - b.daysUntil);
  const reorderOverdue = scopedReorder.filter(r => r.reorderStatus === "Quá hạn chưa đặt").sort((a, b) => a.daysUntil - b.daysUntil);

  return (
    <div className="page">
      <header className="page-head page-head-sticky">
        <div>
          <h1>{t("ov_title")}</h1>
          <p className="page-sub">{t("ov_hello")}, <strong>{user.name}</strong> · {isBoss ? t("all_countries") : (user.countries || []).join(", ")}</p>
        </div>
        <div className="head-actions">
          <div className="ov-filter-row">
            <select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {Object.keys(CC.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </header>

      <div className="kpi-row kpi-row-6">
        <div className="kpi">
          <span className="kpi-label">{t("ov_total_customers")}</span>
          <span className="kpi-value">{custs.length}</span>
          <span className="kpi-foot"><MomBadge cur={custCur} prev={custPrev} /></span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("ov_in_pipeline")}</span>
          <span className="kpi-value" style={{ color: "#3B82F6" }}>{inPipelineCount}</span>
          <span className="kpi-foot">/ {custs.length} {t("ov_total_customers").toLowerCase()}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("ov_active_projects")}</span>
          <span className="kpi-value" style={{ color: "var(--teal-dark)" }}>{active.length}</span>
          <span className="kpi-foot"><MomBadge cur={projCur} prev={projPrev} /></span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("nav_samples")}</span>
          <span className="kpi-value" style={{ color: "#8B5CF6" }}>{sampleCount}</span>
          <span className="kpi-foot"><MomBadge cur={smpCur} prev={smpPrev} /></span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("nav_quotations")}</span>
          <span className="kpi-value" style={{ color: "#F59E0B" }}>{quoteCount}</span>
          <span className="kpi-foot"><MomBadge cur={qtCur} prev={qtPrev} /></span>
        </div>
        <div className="kpi">
          <span className="kpi-label cvr-label">{t("ov_po_conv")}</span>
          <span className="kpi-value" style={{ color: "var(--teal-dark)" }}>{poConvPct}%</span>
          <span className="kpi-foot">{poCustCount} / {custs.length}</span>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi kpi-accent">
          <span className="kpi-label">{t("ov_total_value")}</span>
          <span className="kpi-value kpi-money">{CC.fmtMoneyFull(poYTD + pipelineValue + fcSkuCur, currency)}</span>
          <span className="kpi-foot" style={{ marginTop: 0 }}>{t("ov_total_value_foot")}</span>
          <ValueSub st={stTotal} drill />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("ov_po_value")}</span>
          <span className="kpi-value kpi-money">{CC.fmtMoneyFull(poYTD, currency)}</span>
          <ValueSub st={stPO} drill />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("ov_pipeline_value")}</span>
          <span className="kpi-value kpi-money">{CC.fmtMoneyFull(pipelineValue, currency)}</span>
          <ValueSub st={stProj} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("ov_forecast_value")}</span>
          <span className="kpi-value kpi-money">{CC.fmtMoneyFull(fcSkuCur, currency)}</span>
          <ValueSub st={stFc} />
        </div>
      </div>

      <div className="ov-grid">
        <OvPivotTables t={t} pos={scopePOs} ramPos={pos} custById={_custById} users={users} targets={targets}
          repCountry={repCountry} allowCountry={allowCountry} picOK={picOK} rowOK={ovpRowOK} resolveRep={resolveRep} reps={ovpReps}
          products={products} targetGroups={targetGroups} planOf={repTgtArr}
          year={ovYear} month={ovMonth} cur={currency} isBoss={isBoss} />
        {(reorderDueSoon.length > 0 || reorderOverdue.length > 0) && (
          <section className="card" style={{ gridColumn: "1/-1" }}>
            <h2><Icon d={ICONS.refresh} size={16} /> {t("ro_title")} <button className="link-btn" onClick={goReorder}>{t("view_all")} →</button></h2>
            <div className="ov-reorder-summary">
              {reorderOverdue.length > 0 && (
                <button className="ov-ro-pill ov-ro-overdue" onClick={goReorder}>
                  <Icon d={ICONS.alert} size={14} />
                  <span className="ov-ro-num">{reorderOverdue.length}</span>
                  <span className="ov-ro-lbl">{t("ro_overdue")}</span>
                </button>
              )}
              {reorderDueSoon.length > 0 && (
                <button className="ov-ro-pill ov-ro-soon" onClick={goReorder}>
                  <Icon d={ICONS.clock} size={14} />
                  <span className="ov-ro-num">{reorderDueSoon.length}</span>
                  <span className="ov-ro-lbl">{t("ro_due_soon")}</span>
                </button>
              )}
            </div>
          </section>
        )}
        <section className="card ov-projects">
          <h2>{t("ov_running")} <button className="link-btn" onClick={goProjects}>{t("view_all")} →</button></h2>
          {active.length === 0 ? <p className="empty">{t("pr_no_projects")}</p> :
            <table className="table table-plain">
              <tbody>
                {active.slice(0, 6).map(p => {
                  const cust = customers.find(c => c.id === p.customerId);
                  return (
                    <tr key={p.id} className="row-click" onClick={() => goProject ? goProject(p.id) : goProjects()}>
                      <td>
                        <strong className="cell-main">{p.name}</strong>
                        <small className="cell-sub">{cust ? (cust.shortName || cust.name) : "—"} · {p.following}</small>
                      </td>
                      <td><ProjStageBadge stage={p.stage} t={t} /></td>
                      <td className="cell-money">{window.CRM.fmtVND(p.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
        </section>

        <section className="card ov-funnel">
          <h2>{t("ov_funnel")} <span className="card-hint">{t("ov_conversion")}</span></h2>
          <p className="funnel-cum-note">{t("ov_pipeline_note")}</p>
          <div className="funnel-bars">
            {pipeStages.map((s, i) => {
              const prev = i > 0 ? pipeStages[i - 1].n : 0;
              const conv = i > 0 && prev > 0 ? Math.round(s.n / prev * 100) : null;
              return (
                <div className="funnel-row" key={s.key}>
                  <span className="funnel-name">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, background: s.color + "18", color: s.color }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.color }}></span>{s.label}
                    </span>
                  </span>
                  <div className="funnel-track">
                    <div className="funnel-fill" style={{ width: Math.max(s.n / pipeMax * 100, s.n ? 4 : 0) + "%", background: s.color }}></div>
                  </div>
                  <span className="funnel-n">{s.n}</span>
                  <span className="funnel-conv">{conv !== null ? `${conv}% ${t("ov_conv_rate")}` : ""}</span>
                </div>
              );
            })}
          </div>
          <div className="funnel-proj">
            <span className="funnel-proj-label">{t("ov_cust_to_po")}</span>
            <div className="funnel-proj-bar">
              <div style={{ width: poConvPct + "%" }}></div>
            </div>
            <strong>{poCustCount}/{custs.length} · {poConvPct}% {t("pf_po")}</strong>
          </div>
        </section>

        <section className="card">
          <h2>{t("ov_by_country")}</h2>
          <div className="mini-rows">
            {countryRows.map(([k, n]) => (
              <div className={"mini-row row-click" + (ovBreakCountry === k ? " mini-row-on" : "")} key={k} onClick={() => setOvBreakCountry(c => c === k ? "" : k)} style={ovBreakCountry === k ? { background: "var(--teal-soft)", borderRadius: 6 } : undefined}>
                <span className="mini-name"><Icon d={ICONS.globe} size={14} /> {k}</span>
                <div className="mini-track"><div style={{ width: n / total * 100 + "%" }}></div></div>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          {isBoss && salesCountryRows.length > 0 && <>
            <h2 style={{ marginTop: 20 }}>{t("ov_by_sales")}</h2>
            <table className="table table-plain ov-rep-table">
              <thead>
                <tr>
                  <th>{t("tg_rep")}</th>
                  <th style={{ textAlign: "right" }}>{t("customers")}</th>
                  <th style={{ textAlign: "right" }}>PO</th>
                  <th style={{ textAlign: "right" }}>{t("nav_forecast")}</th>
                  <th style={{ textAlign: "right" }}>{t("nav_projects")}</th>
                  <th style={{ textAlign: "right" }} className="ov-total-col">{t("tg_total")}</th>
                </tr>
              </thead>
              <tbody>
                {salesCountryRows.filter(g => !ovBreakCountry || g.country === ovBreakCountry).map(g => (
                  <React.Fragment key={g.country}>
                    <tr className="ov-rep-country"><td colSpan="6"><Icon d={ICONS.globe} size={11} /> {g.country}</td></tr>
                    {g.reps.map(([k, n]) => {
                      const poSum = scopePOs.filter(p => p.pic === k).reduce((s, p) => s + (p.amountVnd || 0), 0);
                      const prSum = scopeProjects.filter(p => p.following === k && p.stage !== "Lost" && p.stage !== "Won").reduce((s, p) => s + (p.value || 0), 0);
                      const repTotal = poSum + (fcByRep[k] || 0) + prSum;
                      return (
                        <tr key={k}>
                          <td><OwnerChip code={k} t={t} /></td>
                          <td style={{ textAlign: "right" }}>{n}</td>
                          <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(poSum)}</td>
                          <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(fcByRep[k] || 0)}</td>
                          <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(prSum)}</td>
                          <td style={{ textAlign: "right" }} className="cell-money ov-total-col"><strong>{fmtShort(repTotal)}</strong></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </>}
          <h2 style={{ marginTop: 20 }}>{t("ov_by_customer")}</h2>
          <table className="table table-plain ov-rep-table">
            <thead><tr>
              <th>{t("smp_customer")}</th>
              <th style={{ textAlign: "right" }}>{t("ov_po_count")}</th>
              <th style={{ textAlign: "right" }}>PO</th>
              <th style={{ textAlign: "right" }}>{t("nav_forecast")}</th>
              <th style={{ textAlign: "right" }}>{t("nav_projects")}</th>
              <th style={{ textAlign: "right" }} className="ov-total-col">{t("tg_total")}</th>
            </tr></thead>
            <tbody>
              {custValShown.map(r => {
                const c = customers.find(x => x.id === r.customerId);
                return (
                  <tr key={r.customerId}>
                    <td><strong className="cell-main">{c ? (c.shortName || c.name) : "—"}</strong></td>
                    <td style={{ textAlign: "right" }}>{r.poCount || "—"}</td>
                    <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(r.po)}</td>
                    <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(r.fc)}</td>
                    <td style={{ textAlign: "right" }} className="cell-money">{fmtShort(r.proj)}</td>
                    <td style={{ textAlign: "right" }} className="cell-money ov-total-col"><strong>{fmtShort(r.total)}</strong></td>
                  </tr>
                );
              })}
              {custValFiltered.length === 0 && <tr><td colSpan="6" className="empty">—</td></tr>}
            </tbody>
          </table>
          {custValFiltered.length > 20 && (
            <button className="view-all-btn" onClick={() => setShowAllCust(s => !s)}>
              {showAllCust ? t("nc_show_less") : t("view_all") + " (" + custValFiltered.length + ")"}
              <span className={"view-all-caret" + (showAllCust ? " up" : "")}>▾</span>
            </button>
          )}
        </section>

        <section className="card ov-activity">
          <h2>{t("ov_meetings")}
            <button className={"cal-btn" + (calendarConnected ? " on" : "")} onClick={toggleCalendar}>
              <Icon d={ICONS.calendar} size={13} /> {calendarConnected ? "✓ " + t("cal_connected") : t("cal_connect")}
            </button>
          </h2>
          {calendarConnected && <p className="cal-note">{t("cal_note")}</p>}
          {meetings.length === 0 ? <p className="empty">{t("ov_no_meetings")}</p> : (
            <div className="meet-list">
              {meetings.map(m => {
                const cust = customers.find(c => c.id === m.customerId);
                return (
                  <div className="meet-row row-click" key={m.id} onClick={() => cust && goCustomer(cust.id)}>
                    <span className="meet-when"><Icon d={ICONS.calendar} size={13} /> {(m.when || "").replace("T", " ")}</span>
                    <div className="meet-info">
                      <strong>{cust ? (cust.shortName || cust.name) : "—"}</strong>
                      <small>{m.text} · {m.user}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <h2 style={{ marginTop: 18 }}>{t("ov_recent")}</h2>
          <div className="act-list">
            {acts.slice(0, 8).map((a, i) => (
              <div className="act-row" key={i}>
                <Avatar name={a.user} size={26} />
                <div className="act-info">
                  <span><strong>{a.user}</strong> · {a.target}</span>
                  <small>{a.detail} · {a.ts}</small>
                </div>
              </div>
            ))}
            {acts.length === 0 && <p className="empty">—</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
window.OverviewPage = OverviewPage;
