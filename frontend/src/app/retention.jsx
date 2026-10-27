// Todaytec CRM — Customer Retention Dashboard (auto health scoring from PO history + targets)
const RT = window.CRM;
const RET_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function RetentionHealthBadge({ health, t }) {
  const map = {
    green: { dot: "🟢", label: t("ret_health_good"), color: "#16A34A" },
    yellow: { dot: "🟡", label: t("ret_health_watch"), color: "#D97706" },
    red: { dot: "🔴", label: t("ret_health_risk"), color: "var(--danger)" },
  };
  const m = map[health] || map.green;
  return (
    <span className="badge" style={{ color: m.color, background: m.color + "1A", borderColor: m.color + "40" }}>
      {m.dot} {m.label}
    </span>
  );
}

function RetentionProgressBar({ pct }) {
  if (pct === null || pct === undefined) return <span className="dim">—</span>;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pct >= 100 ? "#16A34A" : pct >= 70 ? "#D97706" : "var(--danger)";
  return (
    <div className="ret-bar-wrap">
      <div className="ret-bar-track"><div className="ret-bar-fill" style={{ width: clamped + "%", background: color }}></div></div>
      <span className="ret-bar-pct" style={{ color }}>{Math.round(pct)}%</span>
    </div>
  );
}

// compact progress bar used inside the product sub-table
function ProdMiniBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pct >= 90 ? "#16A34A" : pct >= 60 ? "#D97706" : "var(--danger)";
  return (
    <div className="ret-prodbar-wrap">
      <div className="ret-prodbar-track"><div className="ret-prodbar-fill" style={{ width: clamped + "%", background: color }}></div></div>
      <span style={{ color, fontWeight: 700, fontSize: 11.5 }}>{Math.round(pct)}%</span>
    </div>
  );
}

function ProdRiskPill({ risk, t }) {
  const map = {
    green: { dot: "🟢", label: t("ret_health_good"), color: "#16A34A" },
    yellow: { dot: "🟡", label: t("ret_health_watch"), color: "#D97706" },
    red: { dot: "🔴", label: t("ret_health_risk"), color: "var(--danger)" },
  };
  const m = map[risk] || map.green;
  return <span className="ret-risk-pill" style={{ color: m.color, background: m.color + "1A" }}>{m.dot} {m.label}</span>;
}

// — KPI card: clickable filter + MTD / YTD / MoM / YoY sub-metrics —
function RetentionKpi({ label, value, color, active, onClick, sub, money }) {
  const delta = (cur, base) => {
    if (base == null || base === 0) return { txt: "—", cls: "ret-delta-flat" };
    const pct = ((cur - base) / base) * 100;
    const r = Math.round(pct);
    return {
      txt: (r > 0 ? "+" : "") + r + "%",
      cls: r > 0 ? "ret-delta-up" : r < 0 ? "ret-delta-down" : "ret-delta-flat",
    };
  };
  const mom = delta(sub.mtd, sub.lastM);
  const yoy = delta(sub.mtd, sub.lastYM);
  return (
    <button type="button" className={"kpi ret-kpi" + (active ? " ret-kpi-on" : "")} onClick={onClick} aria-pressed={active}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={color ? { color } : null}>{value}</span>
      <div className="ret-kpi-sub">
        <div><span className="ret-kpi-sub-l">MTD</span><span className="ret-kpi-sub-v">{money(sub.mtd)}</span></div>
        <div><span className="ret-kpi-sub-l">YTD</span><span className="ret-kpi-sub-v">{money(sub.ytd)}</span></div>
        <div><span className="ret-kpi-sub-l">MoM</span><span className={"ret-kpi-sub-v " + mom.cls}>{mom.txt}</span></div>
        <div><span className="ret-kpi-sub-l">YoY</span><span className={"ret-kpi-sub-v " + yoy.cls}>{yoy.txt}</span></div>
      </div>
    </button>
  );
}

// per-customer sales notes per product code, persisted locally (key = customerId|code)
const RET_NOTES_LS = "ttcrm_ret_prodnotes_v1";
function useProductNotes() {
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RET_NOTES_LS)) || {}; } catch (e) { return {}; }
  });
  const addNote = (key, text) => {
    setNotes(prev => {
      const next = { ...prev, [key]: [...(prev[key] || []), { text, ts: new Date().toISOString().slice(0, 10) }] };
      try { localStorage.setItem(RET_NOTES_LS, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };
  return [notes, addNote];
}

// expandable per-product breakdown for one customer row
function RetentionProductRows({ r, custPOs, curMonthIdx, money, t, notes, addNote, addLog, customerId }) {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const monthsAgoOf = (dateStr) => {
    if (!dateStr) return 99;
    const d = new Date(dateStr);
    return (curY - d.getFullYear()) * 12 + (curM - (d.getMonth() + 1));
  };

  // group POs by structure code (Mã cấu trúc); fall back to commercial name / grade
  // for older imported POs that predate structure-code capture.
  const byCode = {};
  custPOs.forEach(p => {
    const code = p.structureCode || p.commercial || p.materialName || p.grade || "—";
    (byCode[code] = byCode[code] || []).push(p);
  });

  const custMtdTarget = (r.targetArr && r.targetArr[curMonthIdx]) || 0;
  const codes = Object.keys(byCode).map(code => {
    const rows = byCode[code];
    const thisYearAmt = rows.filter(p => +p.year === curY).reduce((s, p) => s + (p.amountVnd || 0), 0);
    const allTimeAmt = rows.reduce((s, p) => s + (p.amountVnd || 0), 0);
    const mtdActual = rows.filter(p => +p.year === curY && +p.month === curM).reduce((s, p) => s + (p.amountVnd || 0), 0);
    const lastDate = rows.map(p => p.date || "").sort().slice(-1)[0] || "";
    return { code, thisYearAmt, allTimeAmt, mtdActual, lastDate, qty: rows.reduce((s, p) => s + (p.qty || 0), 0) };
  });
  const yearTotal = codes.reduce((s, c) => s + c.thisYearAmt, 0);
  const allTimeTotal = codes.reduce((s, c) => s + c.allTimeAmt, 0) || 1;

  const enriched = codes.map(c => {
    const share = yearTotal > 0 ? c.thisYearAmt / yearTotal : c.allTimeAmt / allTimeTotal;
    const mtdTarget = Math.round(custMtdTarget * share);
    const completion = mtdTarget > 0 ? (c.mtdActual / mtdTarget) * 100 : (c.mtdActual > 0 ? 100 : 0);
    const ago = monthsAgoOf(c.lastDate);
    const risk = ago > 3 ? "red" : (ago >= 2 || completion < 75) ? "yellow" : "green";
    return { ...c, mtdTarget, completion, ago, risk };
  }).sort((a, b) => {
    const rank = { red: 0, yellow: 1, green: 2 };
    if (rank[a.risk] !== rank[b.risk]) return rank[a.risk] - rank[b.risk];
    return b.thisYearAmt - a.thisYearAmt;
  });

  const lastOrderTxt = (c) => {
    if (!c.lastDate) return "—";
    const d = new Date(c.lastDate);
    const lbl = String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
    return c.ago <= 0 ? lbl + " · " + t("ret_this_month") : lbl + " · " + c.ago + " " + t("ret_mo_ago");
  };

  if (!enriched.length) return <p className="empty">{t("ret_no_products")}</p>;

  return (
    <table className="ret-sub-table">
      <thead>
        <tr>
          <th>{t("ret_product_breakdown")}</th>
          <th className="num">{t("trk_mtd_tgt")}</th>
          <th className="num">{t("trk_mtd_act")}</th>
          <th className="num">{t("ret_completion")}</th>
          <th>{t("ret_last_order")}</th>
          <th>{t("ret_health")}</th>
          <th>{t("ret_sales_notes")}</th>
        </tr>
      </thead>
      <tbody>
        {enriched.map(c => {
          const key = customerId + "|" + c.code;
          const list = notes[key] || [];
          return (
            <tr key={c.code}>
              <td>
                <span className="ret-prod-code">{c.code}</span>
                <span className="ret-sub-micro">{RT.fmtNum(c.qty)} {t("fc_unit_rolls") || "rolls"}</span>
              </td>
              <td className="num">{money(c.mtdTarget)}</td>
              <td className="num">{money(c.mtdActual)}</td>
              <td className="num"><ProdMiniBar pct={c.completion} /></td>
              <td>{lastOrderTxt(c)}</td>
              <td><ProdRiskPill risk={c.risk} t={t} /></td>
              <td style={{ minWidth: 200 }}>
                <NoteCell list={list} onAdd={(text) => {
                  addNote(key, text);
                  if (addLog) addLog({ customerId, type: "note", text: c.code + ": " + text });
                }} t={t} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function NoteCell({ list, onAdd, t }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const save = () => { const v = val.trim(); if (v) onAdd(v); setVal(""); setEditing(false); };
  return (
    <div>
      {list.length > 0 && (
        <div className="ret-note-list">
          {list.map((n, i) => <div className="ret-note-line" key={i}>{typeof n === "string" ? n : n.text}</div>)}
        </div>
      )}
      {editing ? (
        <div className="ret-note-add">
          <input className="input" autoFocus value={val} placeholder={t("ret_add_note")}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setVal(""); } }} />
          <button className="btn btn-primary btn-sm" onClick={save}>{t("save")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setVal(""); }}>✕</button>
        </div>
      ) : (
        <button className="ret-detail-link" onClick={() => setEditing(true)}>+ {t("ret_add_note")}</button>
      )}
    </div>
  );
}

function RetentionPage({ openCustomer }) {
  const { t, lang, retentionRows, retMonthAgg, customers, scopeCustomers, currency, setCurrency, money, pos, addLog, users, picFilterCodes, canonCode } = useApp();
  const rcls = (a, b) => !b ? "" : a / b >= 1 ? "tg-ok" : a / b >= 0.7 ? "tg-mid" : "tg-low";
  const rpct = (r) => r == null ? "—" : Math.round(r * 100) + "%";
  const [q, setQ] = useState("");
  const [health, setHealth] = useState("");
  const [picF, setPicF] = useState("");
  const { dateRange: dr, setDateRange: setDr, dateRangeR: drR } = useApp();
  const dateFrom = drR.from, dateTo = drR.to;
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const retCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setRetCountries = () => {};
  const [expanded, setExpanded] = useState(() => new Set());
  const [notes, addNote] = useProductNotes();
  const curMonthIdx = new Date().getMonth();

  useEffect(() => {
    if (retCountries.length === 1 && retCountries[0] === "Thailand") setCurrency("THB");
    else if (retCountries.length === 1 && retCountries[0] === "Vietnam") setCurrency("VND");
    else if (retCountries.length >= 2) setCurrency("VND");
  }, [retCountries]);
  const retCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const allCountries = [...new Set(scopeCustomers.map(c => window.CRM.normCountry(c.country)))].filter(c => (RT.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => retCountryRank(a) - retCountryRank(b));
  const allowC = (cn) => retCountries.length === 0 || retCountries.includes(cn);
  const countryOfCust = (id) => { const c = customers.find(x => x.id === id); return c ? window.CRM.normCountry(c.country) : ""; };

  const scopeIds = new Set(scopeCustomers.map(c => c.id));
  const scoped = retentionRows.filter(r => (r.memberCustomerIds || [r.customerId]).some(id => scopeIds.has(id)) && allowC(countryOfCust(r.customerId)));

  const custName = (id) => {
    const c = customers.find(x => x.id === id);
    return c ? (c.shortName || c.name) : "—";
  };

  const posByCust = useMemo(() => {
    const m = {};
    (pos || []).forEach(p => { if (p.customerId) (m[p.customerId] = m[p.customerId] || []).push(p); });
    return m;
  }, [pos]);
  // On-expand drill-down: fetch just THIS customer's POs from the server (bounded, fast)
  // for the structure-code breakdown — instead of holding every PO in RAM. Falls back to
  // the RAM posByCust map when the fetch is pending / offline.
  const [drillPOs, setDrillPOs] = useState({});
  useEffect(() => {
    const SB = RT.SB;
    [...expanded].forEach(async (cid) => {
      if (drillPOs[cid]) return;
      const r = scoped.find(x => x.customerId === cid);
      const ids = r ? (r.memberCustomerIds || [cid]) : [cid];
      try { const res = await SB.queryAll({ customerIds: ids }); setDrillPOs(m => m[cid] ? m : Object.assign({}, m, { [cid]: res.rows })); } catch (e) {}
    });
  }, [expanded]);

  // Sales PIC options come from the KPI roster (Permissions → KPI country ticked), so a
  // rep shows up even before they have retention rows; PICs present in scope are unioned in.
  const allPics = [...new Set([...(picFilterCodes || []), ...scoped.map(r => canonCode(r.pic))].filter(Boolean))].sort();

  const passNonDate = (r) => {
    if (health && r.health !== health) return false;
    if (picF && canonCode(r.pic).toUpperCase() !== canonCode(picF).toUpperCase()) return false;
    const qq = q.trim().toLowerCase();
    if (qq && !(custName(r.customerId).toLowerCase().includes(qq) || (r.nameCode || "").toLowerCase().includes(qq))) return false;
    return true;
  };
  // The global range means "active in this window": a customer stays visible when its order
  // history OVERLAPS the range, so long-standing accounts don't vanish under a YTD filter.
  const inWin = (r, a, b) => (!a && !b) ? true : ((!b || (r.firstOrderDate || "") <= b) && (!a || (r.lastOrderDate || r.firstOrderDate || "") >= a));
  const list = scoped.filter(r => passNonDate(r) && inWin(r, dateFrom, dateTo));
  // Same filters over the comparison window — new customers acquired then vs now.
  const cmpStats = useMemo(() => {
    if (!drR.hasCmp) return null;
    const prev = scoped.filter(r => passNonDate(r) && inWin(r, drR.cmpFrom, drR.cmpTo));
    const sum = (arr) => arr.reduce((s, r) => s + (r.totalPoAmount || 0), 0);
    return { cur: { n: list.length, amt: sum(list) }, prev: { n: prev.length, amt: sum(prev) } };
  }, [scoped, list, drR.hasCmp, drR.cmpFrom, drR.cmpTo, health, picF, q]);

  // latest sales note across all product codes of this customer (roll-up aware)
  const latestNoteOf = (r) => {
    const ids = (r.memberCustomerIds || [r.customerId]).map(String);
    let best = null;
    Object.entries(notes).forEach(([k, arr]) => {
      if (!arr || !arr.length) return;
      const id = ids.find(x => k.indexOf(x + "|") === 0);
      if (!id) return;
      const code = k.slice(id.length + 1);
      const n = arr[arr.length - 1];
      const text = typeof n === "string" ? n : n.text;
      const ts = typeof n === "string" ? "" : (n.ts || "");
      if (!best || ts >= best.ts) best = { text: (code ? code + ": " : "") + text, ts };
    });
    return best ? best.text : "";
  };

  const toggleRow = (id) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const resetAll = () => { setQ(""); setHealth(""); setPicF(""); };

  const counts = { green: 0, yellow: 0, red: 0 };
  scoped.forEach(r => { counts[r.health] = (counts[r.health] || 0) + 1; });

  // MTD / YTD / MoM / YoY revenue roll-up per health segment (from PO history)
  const periodAgg = useMemo(() => {
    const today = new Date();
    const cy = today.getFullYear(), cm = today.getMonth() + 1; // 1-based
    const pm = cm === 1 ? 12 : cm - 1;
    const pmY = cm === 1 ? cy - 1 : cy;
    // health keyed by EVERY member company id (so multi-company parents count correctly)
    const healthById = {};
    scoped.forEach(r => { (r.memberCustomerIds || [r.customerId]).forEach(id => { healthById[id] = r.health; }); });
    const blank = () => ({ mtd: 0, ytd: 0, lastM: 0, lastYM: 0 });
    const acc = { all: blank(), green: blank(), yellow: blank(), red: blank() };
    const bump = (cust, y, m, amt) => {
      const h = healthById[cust]; if (!h) return;
      const add = (b) => {
        if (y === cy && m === cm) b.mtd += amt;
        if (y === cy && m <= cm) b.ytd += amt;
        if (y === pmY && m === pm) b.lastM += amt;
        if (y === cy - 1 && m === cm) b.lastYM += amt;
      };
      add(acc.all); add(acc[h]);
    };
    if (retMonthAgg) { retMonthAgg.forEach(rw => bump(rw.cust, parseInt(rw.yr, 10), parseInt(rw.mo, 10), Number(rw.amount) || 0)); }
    else { (pos || []).forEach(p => bump(p.customerId, +p.year, +p.month, p.amountVnd || 0)); }
    return acc;
  }, [retMonthAgg, pos, scoped]);

  const colSpan = 4;
  const retSort = useSort(null, "asc");
  const retAcc = {
    customer: r => r.nameCode || custName(r.customerId) || "",
    pic: r => r.pic || "",
    health: r => ({ green: 0, yellow: 1, red: 2 }[r.health] ?? 3),
    days: r => r.daysSinceLastPO || 0,
    orders: r => r.orderCount || 0,
    total: r => r.totalPoAmount || 0,
    since: r => r.firstOrderDate || "",
  };
  const retSortCols = [
    { key: "customer", label: t("ret_customer") },
    { key: "pic", label: t("tg_pic") },
    { key: "health", label: t("ret_health") },
    { key: "days", label: t("ret_days_unit") },
    { key: "orders", label: "PO" },
    { key: "total", label: t("ret_total_po") },
    { key: "since", label: t("ret_since") },
  ];
  const sortedList = retSort.sort.key ? retSort.apply(list, retAcc) : list;
  const riskOpts = [
    { k: "", l: t("all") },
    { k: "green", l: "\uD83D\uDFE2 " + t("ret_health_good") },
    { k: "yellow", l: "\uD83D\uDFE1 " + t("ret_health_watch") },
    { k: "red", l: "\uD83D\uDD34 " + t("ret_health_risk") },
  ];

  return (
    <div className="page page-wide" data-screen-label="Retention">
      <header className="page-head list-head">
        <div>
          <h1>{t("ret_title")}</h1>
          <p className="page-sub">{t("ret_subtitle")}</p>
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("ret_search_placeholder")} />
        </div>
        <select className="select" value={picF} onChange={e => setPicF(e.target.value)} title={t("tg_pic")}>
          <option value="">{t("fc_all_reps")}</option>
          {allPics.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="seg">
          {riskOpts.map(o => (
            <button key={o.k} className={health === o.k ? "on" : ""} onClick={() => setHealth(o.k)}>{o.l}</button>
          ))}
        </div>
        <select className="select list-ccy" value={currency} onChange={e => setCurrency(e.target.value)}>
          {Object.keys(RT.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <SortMenu columns={retSortCols} sort={retSort.sort} onSort={retSort.onSort} />
        <button className="link-btn" onClick={resetAll}>{t("ret_reset_all")}</button>
      </div>

      <div className="kpi-row kpi-row-4">
        <RetentionKpi label={t("ret_kpi_total")} value={scoped.length} active={health === ""}
          onClick={() => setHealth("")} sub={periodAgg.all} money={money} />
        <RetentionKpi label={"\uD83D\uDFE2 " + t("ret_kpi_good")} value={counts.green} color="#16A34A" active={health === "green"}
          onClick={() => setHealth(health === "green" ? "" : "green")} sub={periodAgg.green} money={money} />
        <RetentionKpi label={"\uD83D\uDFE1 " + t("ret_kpi_watch")} value={counts.yellow} color="#D97706" active={health === "yellow"}
          onClick={() => setHealth(health === "yellow" ? "" : "yellow")} sub={periodAgg.yellow} money={money} />
        <RetentionKpi label={"\uD83D\uDD34 " + t("ret_kpi_risk")} value={counts.red} color="var(--danger)" active={health === "red"}
          onClick={() => setHealth(health === "red" ? "" : "red")} sub={periodAgg.red} money={money} />
      </div>

      {cmpStats && <DrCompareBar range={drR} metrics={[
        { label: t("ret_kpi_total"), cur: cmpStats.cur.n, prev: cmpStats.prev.n, fmt: v => RT.fmtNum(v) },
        { label: t("ret_total_po"), cur: cmpStats.cur.amt, prev: cmpStats.prev.amt, fmt: v => RT.fmtMoneyFull(v, currency) },
      ]} />}

      <div className="card table-card ret-acc-card">
        <table className="table ret-acc-table">
          <thead>
            <tr>
              <SortTh label={t("ret_customer")} sortKey="customer" sort={retSort.sort} onSort={retSort.onSort} />
              <SortTh label={t("tg_pic")} sortKey="pic" sort={retSort.sort} onSort={retSort.onSort} />
              <SortTh label={t("ret_health")} sortKey="health" sort={retSort.sort} onSort={retSort.onSort} />
              <th className="hide-sm">{t("ret_latest_note")}</th>
            </tr>
          </thead>
          <tbody>
            {sortedList.map(r => {
              const mk = RT.tgMetric(r.targetArr, r.actualArr);
              const isOpen = expanded.has(r.customerId);
              const custPOs = drillPOs[r.customerId] || (r.memberCustomerIds || [r.customerId]).flatMap(id => posByCust[id] || []);
              const lastNote = latestNoteOf(r);
              return (
              <React.Fragment key={r.customerId}>
                <tr className={"ret-acc-row" + (isOpen ? " open" : "") + " row-click"} onClick={() => toggleRow(r.customerId)}>
                  <td>
                    <div className="ret-cust-cell">
                      <button className={"ret-exp-btn" + (isOpen ? " open" : "")} aria-label="expand"
                        onClick={e => { e.stopPropagation(); toggleRow(r.customerId); }}>
                        <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                      </button>
                      <div>
                        <strong className="cell-main">{r.nameCode || custName(r.customerId)}{r.companyCount > 1 && <span className="nc-chip" style={{ marginLeft: 6 }}>{r.companyCount} {t("nc_companies")}</span>}</strong>
                        <div className="ret-cust-tags">
                          <GroupBadge group={r.group} />
                          <span className="ret-cust-meta">
                            {t("ret_since")} {RT.fmtDate(r.firstOrderDate)} · {r.orderCount} PO · <span className={r.health === "red" ? "ret-days-bad" : r.health === "yellow" ? "ret-days-warn" : ""} style={{ fontWeight: 700 }}>{r.daysSinceLastPO}</span> {t("ret_days_unit")}
                          </span>
                          {r.newProductCode && <span className="ret-newprod">✦ {t("ret_new_product")}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{r.pic ? <OwnerChip code={r.pic} t={t} /> : <span className="dim">—</span>}</td>
                  <td><RetentionHealthBadge health={r.health} t={t} /></td>
                  <td className="hide-sm"><span className="ret-note-cell">{lastNote || <span className="dim" style={{ fontStyle: "normal" }}>—</span>}</span></td>
                </tr>
                <tr>
                  <td className="ret-sub-cell" colSpan={colSpan}>
                    <div className={"ret-sub-wrap" + (isOpen ? " open" : "")}>
                      <div className="ret-sub-inner">
                        <div className="ret-sub-bar">
                          <span className="ret-sub-title">{t("ret_product_breakdown")} · {r.nameCode || custName(r.customerId)}</span>
                          <div className="ret-sub-rollup">
                            <span>{t("ret_total_po")}: <strong>{money(r.totalPoAmount)}</strong></span>
                            <span>{t("trk_annual_tgt")}: <strong>{money(mk.annualTarget)}</strong></span>
                            <span>{t("trk_ytd_act")}: <strong>{money(mk.ytdActual)}</strong></span>
                            <span className={rcls(mk.ytdActual, mk.ytdTarget)}>{t("trk_pct_ytd")}: <strong>{rpct(mk.pctYTD)}</strong></span>
                            <button className="ret-detail-link" onClick={e => { e.stopPropagation(); openCustomer && openCustomer(r.customerId); }}>
                              {t("ret_view_detail")} →
                            </button>
                          </div>
                        </div>
                        {isOpen && (
                          <RetentionProductRows r={r} custPOs={custPOs} curMonthIdx={curMonthIdx}
                            money={money} t={t} notes={notes} addNote={addNote} addLog={addLog} customerId={r.customerId} />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={colSpan} className="empty">{scoped.length ? t("ret_no_results") : t("ret_no_data")}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="tg-legend">
        <span className="dim">{t("ret_legend")}</span>
      </div>
    </div>
  );
}

window.RetentionPage = RetentionPage;
