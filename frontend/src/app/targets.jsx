// Todaytec CRM — Sales Targets (KPI) tab: by sales / by customer type / by country
const TG = window.CRM;
const TG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tgFmtM(n) { return !n ? "—" : (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : Math.round(n / 1e6) + "M"); }
function tgRatioCls(a, tg) { return !tg ? "" : a / tg >= 1 ? " tg-ok" : a / tg >= 0.7 ? " tg-mid" : " tg-low"; }

function tgFull(n) { if (n === 0 || n == null) return "—"; const neg = n < 0; const s = Math.round(Math.abs(n)).toLocaleString("en-US"); return neg ? "(" + s + ")" : s; }
function tgCompact(vnd, cur) {
  if (vnd === 0 || vnd == null) return "—";
  const c = (TG.CURRENCIES && TG.CURRENCIES[cur]) || (TG.CURRENCIES && TG.CURRENCIES.VND) || { rate: 1, symbol: "₫" };
  const v = vnd / c.rate, sym = c.symbol, neg = v < 0 ? "-" : "", a = Math.abs(v);
  const f = (n, d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (cur === "VND" || !cur) {
    if (a >= 1e9) return neg + f(a / 1e9, 2) + " tỷ";
    if (a >= 1e6) return neg + f(a / 1e6, 1) + " tr";
    if (a >= 1e3) return neg + f(a / 1e3, 0) + "k";
    return neg + f(a, 0);
  }
  if (cur === "USD") return neg + f(a, 2);  // USD: full x.xx, no symbol, no K/M abbrev (matches PO detail)
  if (a >= 1e6) return neg + f(a / 1e6, 2) + "M";
  if (a >= 1e3) return neg + f(a / 1e3, 1) + "K";
  return neg + f(a, a < 100 ? 2 : 0);
}
function tgPct(r) { return r == null ? "—" : Math.round(r * 100) + "%"; }

function TargetPage() {
  const { t, isBoss, isCountryMgr, canEdit, assignableCodes, user, users, targets, setTarget, setTargets, targetGroups, setTargetGroup, setTargetGroups, repCountry, pos, currency, setCurrency, updateUser, scopeCustomers, customers } = useApp();
  const tcCustById = React.useMemo(() => { const m = {}; [...(customers || []), ...(scopeCustomers || [])].forEach(c => { if (c && c.id) m[c.id] = c; }); return m; }, [customers, scopeCustomers]);
  // KPI input is allowed for BOD/Admin (isBoss) OR anyone explicitly granted edit
  // rights on the Target module in Permissions — so a titled "Admin" like Thuy who
  // isn't scope=all can still be given KPI-entry rights.
  const canEditKPI = isBoss || !!(canEdit && canEdit("target"));
  const [year, setYear] = useState("2026");
  const [mode, setMode] = useState("input");
  const [breakdown, setBreakdown] = useState("sales");
  const _now = new Date();
  const [selMonth, setSelMonth] = useState(String(_now.getFullYear()) === "2026" ? _now.getMonth() : 5);
  const [importing, setImporting] = useState(false);
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const tgCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setTgCountries = () => {};
  const [tgPic, setTgPic] = useState("");
  const [tgGroup, setTgGroup] = useState("");
  const [hiddenReps, setHiddenReps] = useState(() => new Set(TG.loadJSON("ttcrm_tg_hidden_v1", [])));
  const removeRep = (pic) => setHiddenReps(prev => { const n = new Set(prev); n.add(pic); TG.saveJSON("ttcrm_tg_hidden_v1", [...n]); return n; });
  const restoreReps = () => { setHiddenReps(new Set()); TG.saveJSON("ttcrm_tg_hidden_v1", []); };
  const [filtOpen, setFiltOpen] = useState(false);
  useEffect(() => {
    if (tgCountries.length === 1 && tgCountries[0] === "Thailand") setCurrency("THB");
    else if (tgCountries.length === 1 && tgCountries[0] === "Vietnam") setCurrency("VND");
    else if (tgCountries.length >= 2) setCurrency("VND");
  }, [tgCountries]);
  // Default currency from the user's ASSIGNED countries (once, on mount):
  // one country → its currency; two or more → VND.
  const tgDidInitCur = React.useRef(false);
  useEffect(() => {
    if (tgDidInitCur.current) return;
    const ac = ((user && user.countries) || []).filter(c => c && c !== "*");
    const tc = user && user.targetCountry;
    if (tc) setCurrency(tc === "Thailand" ? "THB" : "VND");
    else if (ac.length === 1) setCurrency(ac[0] === "Thailand" ? "THB" : "VND");
    else setCurrency("VND");
    tgDidInitCur.current = true;
  }, [user]);
  const tgRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  // A rep's KPI key: their sales code, or — for code-less accounts such as an Admin who
  // still owns a KPI (e.g. Thuy) — their account name.
  const kpiPic = (u) => u.salesCode || (u.name || "").trim();
  // An account appears in Targets (and so can have a target entered) ONLY when it has a
  // KPI country ticked in Permissions — the explicit `targetCountry`, or its single
  // assigned scope country (which the Permissions chip already shows as ticked). Users
  // with no KPI country ticked are excluded from the grid and cannot receive targets.
  const kpiCountryOf = (u) => TG.kpiCountryOf(u);
  const kpiUsers = (users || []).filter(u => !u._deleted && u.active !== false && kpiCountryOf(u));
  const allCountries = [...new Set(kpiUsers.map(u => repCountry(kpiPic(u))))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => tgRank(a) - tgRank(b));
  const allowCountry = (cn) => tgCountries.length === 0 || tgCountries.includes(cn);

  const years = [...new Set([...Object.keys(targets), "2025", "2026"])].sort();
  const yearTargets = targets[year] || {};
  const yearGroups = targetGroups[year] || {};
  // Only PICs that exist as accounts in Permissions appear in Targets. Reps that
  // were removed (or only exist in old target/PO data) drop out of the grid.
  const registeredCodes = new Set(kpiUsers.map(kpiPic).filter(Boolean));
  // Who sees a whole COUNTRY's reps in Targets (applies to BOTH the Input and the
  // Tracking tab, since they share this list): BOD/Admin see everyone; a country
  // manager or anyone granted edit rights on the Target module sees every rep in the
  // KPI country(ies) tied to their account — so a Vietnam-permitted user manages and
  // tracks Vietnam. Plain sales reps keep just their own assignable set.
  const myKpiCountries = user ? (TG.kpiCountryOf(user) ? [TG.kpiCountryOf(user)] : []) : [];
  const kpiCountryScope = !isBoss && (isCountryMgr || !!(canEdit && canEdit("target")));
  const baseReps = isBoss
    ? [...registeredCodes].sort()
    : (kpiCountryScope
        ? [...registeredCodes].filter(pic => !myKpiCountries.length || myKpiCountries.includes(repCountry(pic)))
        : assignableCodes);
  const reps = baseReps.filter(pic => registeredCodes.has(pic) && allowCountry(repCountry(pic)) && (!tgPic || pic === tgPic) && !hiddenReps.has(pic));
  // Moving a rep between country groups here writes the SAME field the Permissions
  // KPI-country control uses (targetCountry), so the two stay in sync.
  const moveRepCountry = (pic, country) => { const u = users.find(x => x.salesCode === pic) || users.find(x => !x.salesCode && (x.name || "").trim() === pic); if (u && country && country !== "—") updateUser(u.id, { targetCountry: country }); };
  const tgSort = useSort(null, "asc");
  const repAnnual = (pic) => { const pg = yearGroups[pic] || {}; let s = 0; Object.values(pg).forEach(a => (a || []).forEach(v => s += v || 0)); return s; };
  const tgAcc = { pic: p => p, annual: p => repAnnual(p) };
  const tgSortCols = [
    { key: "pic", label: t("tg_pic") },
    { key: "annual", label: t("tg_target") },
  ];
  const sortedReps = tgSort.sort.key ? tgSort.apply(reps, tgAcc) : reps;

  // Actuals per PIC and PIC+group for the selected year — from the SERVER aggregate
  // (po_agg), so they are complete at any scale even though RAM holds only recent POs.
  // agg pic is upper-cased and grp is the group's leading letter (A–G), which matches
  // the grid's rep codes + group ids better than raw PO fields. Falls back to RAM pos.
  const [tgAggRows, setTgAggRows] = useState(null);
  useEffect(() => { let on = true; window.CRM.SB.aggRange(year + "-01-01", year + "-12-31").then(r => { if (on) setTgAggRows(Array.isArray(r) ? r : null); }).catch(() => { if (on) setTgAggRows(null); }); return () => { on = false; }; }, [year]);
  const actual = {}, actualGroup = {};
  if (tgAggRows) {
    tgAggRows.forEach(r => {
      if (String(r.yr) !== year) return;
      const m = (parseInt(r.mo, 10) || 0) - 1; if (m < 0 || m > 11) return;
      const pic = String(r.pic || ""); const amt = Number(r.amount) || 0;
      (actual[pic] = actual[pic] || Array(12).fill(0))[m] += amt;
      const key = pic + "|" + (r.grp || "?");
      (actualGroup[key] = actualGroup[key] || Array(12).fill(0))[m] += amt;
    });
  } else {
    pos.forEach(p => {
      if (String(p.year) !== year) return;
      const m = (p.month || 0) - 1; if (m < 0 || m > 11) return;
      (actual[p.pic] = actual[p.pic] || Array(12).fill(0))[m] += p.amountVnd || 0;
      const key = p.pic + "|" + (p.group || "?");
      (actualGroup[key] = actualGroup[key] || Array(12).fill(0))[m] += p.amountVnd || 0;
    });
  }

  // Export the target grid (PIC × customer-type group): annual + monthly targets,
  // plus actuals & achievement for the selected year.
  const exportTargets = () => {
    const rows = [];
    reps.forEach(pic => {
      const rg = yearGroups[pic] || {};
      TG.GROUPS.forEach(g => {
        const arr = rg[g.id];
        if (!arr || !arr.some(v => v)) return;
        const ac = actualGroup[pic + "|" + g.id] || [];
        const annualT = arr.reduce((s, v) => s + (v || 0), 0);
        const annualA = ac.reduce((s, v) => s + (v || 0), 0);
        const row = { pic, customer_type_group: g.label, year, annual_target: Math.round(annualT), annual_actual: Math.round(annualA), achievement: annualT ? Math.round(annualA / annualT * 100) + "%" : "" };
        TG_MONTHS.forEach((mn, i) => { row[mn.toLowerCase() + "_target"] = Math.round(arr[i] || 0); });
        rows.push(row);
      });
    });
    if (!rows.length) { alert("No targets to export"); return; }
    window.exportCSV("targets-" + year, rows);
  };

  return (
    <div className="page page-wide">
      <header className="page-head list-head">
        <div>
          <h1>{t("tg_title")}</h1>
          <div className="seg list-head-seg">
            <button className={mode === "input" ? "on" : ""} onClick={() => setMode("input")}>{t("tg_mode_input")}</button>
            <button className={mode === "bycust" ? "on" : ""} onClick={() => setMode("bycust")}>{t("tg_mode_bycust")}</button>
            <button className={mode === "tracking" ? "on" : ""} onClick={() => setMode("tracking")}>{t("tg_mode_track")}</button>
          </div>
        </div>
        <div className="head-actions">
          {isBoss && <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("tg_import")}</button>}
          <button className="btn btn-ghost" onClick={exportTargets}><Icon d={ICONS.download} size={15} /> {t("tg_export")}</button>
          {isBoss && <MoreMenu items={[
            (yearTargets && Object.keys(yearTargets).length > 0 || (yearGroups && Object.keys(yearGroups).length > 0)) && {
              key: "del", label: t("tg_delete"), icon: ICONS.alert, danger: true,
              onClick: () => crmConfirm(t("tg_delete_confirm").replaceAll("{y}", year), () => {
                const nt = { ...targets }; delete nt[year]; setTargets(nt);
                const ng = { ...targetGroups }; delete ng[year]; setTargetGroups(ng);
              }) },
          ]} />}
        </div>
      </header>
      <div className="list-toolbar">
        <select className="select" value={year} onChange={e => setYear(e.target.value)}>
          {years.map(y => <option key={y} value={y}>{t("tg_year")}: {y}</option>)}
        </select>
        {mode === "tracking" && (
          <select className="select" value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
            {TG_MONTHS.map((m, i) => <option key={i} value={i}>{m} {year}</option>)}
          </select>
        )}
        <select className="select list-ccy" value={currency} onChange={e => setCurrency(e.target.value)} title={t("tg_currency")}>
          {Object.keys(TG.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="export-menu">
          <button className={"btn btn-ghost" + ((tgPic || tgGroup) ? " btn-filter-active" : "")} onClick={() => setFiltOpen(v => !v)}>
            {t("tg_filters")} <span className="export-caret">▾</span>
          </button>
          {filtOpen && (
            <div className="export-pop tg-filter-pop" onMouseLeave={() => setFiltOpen(false)}>
              {(isBoss || kpiCountryScope) && (
                <label className="tg-filt-row"><span>{t("tg_pic")}</span>
                  <select className="select" value={tgPic} onChange={e => setTgPic(e.target.value)}>
                    <option value="">{t("all")}</option>
                    {[...new Set(kpiUsers.filter(u => allowCountry(repCountry(kpiPic(u)))).map(kpiPic))].sort().map(p => <option key={p} value={p}>{p}</option>)}
                  </select></label>
              )}
              <label className="tg-filt-row"><span>{t("tg_cust_type_group")}</span>
                <select className="select" value={tgGroup} onChange={e => setTgGroup(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {TG.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select></label>
              <label className="tg-filt-row"><span>{t("tg_currency")}</span>
                <select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>
                  {Object.keys(TG.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select></label>
            </div>
          )}
        </div>
        <SortMenu columns={tgSortCols} sort={tgSort.sort} onSort={tgSort.onSort} />
        {isBoss && hiddenReps.size > 0 && <button className="btn btn-ghost" onClick={restoreReps}>↺ {t("tg_show_hidden").replace("{n}", hiddenReps.size)}</button>}
      </div>

      {mode === "input" && <TgInputGrouped t={t} year={year} reps={sortedReps} yearGroups={yearGroups} setTargetGroup={setTargetGroup} isBoss={isBoss} canEdit={canEditKPI} repCountry={repCountry} groupFilter={tgGroup} cur={currency} onRemoveRep={removeRep} onMoveRep={moveRepCountry} />}
      {mode === "bycust" && <TgByCustomer t={t} year={year} canEdit={canEditKPI} reps={sortedReps} custById={tcCustById} picFilter={tgPic} importing={importing} setImporting={setImporting} />}
      {mode === "tracking" && <TgTracking t={t} year={year} selMonth={selMonth} reps={sortedReps} yearGroups={yearGroups} actualGroup={actualGroup} aggOK={!!tgAggRows} pos={pos} repCountry={repCountry} groupFilter={tgGroup} cur={currency} isBoss={isBoss} onMoveRep={moveRepCountry} />}

      {mode === "input" && (
        <div className="note-card card">
          <strong>{t("tg_currency_notice_title")}</strong>
          <p style={{ margin: "4px 0 0" }}>{t("tg_currency_notice_body")}</p>
        </div>
      )}

      {mode === "input" && (
        <div className="tg-legend">
          <span><i className="tg-dot tg-ok"></i> ≥100%</span>
          <span><i className="tg-dot tg-mid"></i> 70–99%</span>
          <span><i className="tg-dot tg-low"></i> &lt;70%</span>
          <span className="dim">{t("tg_target")} / {t("tg_actual")} · M = 10⁶ VND</span>
        </div>
      )}

      {importing && mode !== "bycust" && <TargetImportModal year={year} onClose={() => setImporting(false)} />}
    </div>
  );
}

/* ---- editable cell ---- */
function TgCell({ tg, ac, canEdit, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  if (editing) {
    return (
      <td className="tg-cell">
        <input className="input tg-input" autoFocus value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => { onCommit(parseFloat(val) || 0); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === "Enter") { onCommit(parseFloat(val) || 0); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }} />
      </td>
    );
  }
  return (
    <td className={"tg-cell" + tgRatioCls(ac, tg)}>
      <button className="tg-btn" disabled={!canEdit} onClick={() => { if (canEdit) { setVal(String(tg || "")); setEditing(true); } }} title={TG.fmtVND(tg)}>
        <span className="tg-t">{tgFmtM(tg)}</span>
        <span className="tg-a">{tgFmtM(ac)}</span>
      </button>
    </td>
  );
}
function TgTotalCell({ tg, ac, t }) {
  return (
    <td className={"tg-cell tg-total-col" + tgRatioCls(ac, tg)}>
      <span className="tg-t">{tgFmtM(tg)}</span>
      <span className="tg-a">{tgFmtM(ac)}</span>
      <small className="tg-ratio">{tg ? Math.round(ac / tg * 100) + "%" : "—"}</small>
    </td>
  );
}
function TgHead({ t, firstLabel }) {
  return (
    <thead>
      <tr>
        <th>{firstLabel}</th>
        {TG_MONTHS.map(m => <th key={m} className="tg-mcol">{m}</th>)}
        <th className="tg-mcol tg-total-col">{t("tg_total")}</th>
      </tr>
    </thead>
  );
}
function TgTotalRow({ t, label, rowsT, rowsA }) {
  const colT = Array(12).fill(0), colA = Array(12).fill(0);
  rowsT.forEach(arr => (arr || []).forEach((v, m) => colT[m] += v || 0));
  rowsA.forEach(arr => (arr || []).forEach((v, m) => colA[m] += v || 0));
  const sumT = colT.reduce((a, b) => a + b, 0), sumA = colA.reduce((a, b) => a + b, 0);
  return (
    <tr className="tg-total-row">
      <td><strong>{label}</strong><small className="cell-sub">{t("tg_target")} / {t("tg_actual")}</small></td>
      {colT.map((v, m) => (
        <td key={m} className={"tg-cell" + tgRatioCls(colA[m], v)}>
          <span className="tg-t">{tgFmtM(v)}</span>
          <span className="tg-a">{tgFmtM(colA[m])}</span>
        </td>
      ))}
      <TgTotalCell tg={sumT} ac={sumA} t={t} />
    </tr>
  );
}

/* ---- view: by sales (one table per country) ---- */
function TgSalesTable({ t, isBoss, reps, year, yearTargets, actual, setTarget, repCountry }) {
  const byCountry = {};
  reps.forEach(pic => {
    const c = repCountry(pic);
    (byCountry[c] = byCountry[c] || []).push(pic);
  });
  const countries = Object.keys(byCountry).sort();
  return (
    <>
      {countries.map(country => {
        const cReps = byCountry[country];
        return (
          <div key={country} className="tg-country-block">
            <h2 className="tg-country-title"><Icon d={ICONS.globe} size={14} /> {country} <span className="card-hint">{cReps.join(", ")}</span></h2>
            <div className="card table-card tg-card">
              <table className="table tg-table">
                <TgHead t={t} firstLabel={t("tg_rep")} />
                <tbody>
                  {cReps.map(pic => {
                    const tgArr = yearTargets[pic] || Array(12).fill(0);
                    const acArr = actual[pic] || Array(12).fill(0);
                    return (
                      <tr key={pic}>
                        <td><OwnerChip code={pic} t={t} /><small className="cell-sub">{t("tg_target")} / {t("tg_actual")}</small></td>
                        {Array.from({ length: 12 }, (_, m) => (
                          <TgCell key={m} tg={tgArr[m] || 0} ac={acArr[m] || 0} canEdit={isBoss}
                            onCommit={v => setTarget(year, pic, m, v)} />
                        ))}
                        <TgTotalCell tg={tgArr.reduce((a, b) => a + b, 0)} ac={acArr.reduce((a, b) => a + b, 0)} t={t} />
                      </tr>
                    );
                  })}
                  {cReps.length > 1 && <TgTotalRow t={t} label={t("tg_total") + " – " + country}
                    rowsT={cReps.map(p => yearTargets[p])} rowsA={cReps.map(p => actual[p])} />}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ---- view: by customer type group ---- */
function TgGroupTable({ t, isBoss, reps, year, yearGroups, actualGroup, setTargetGroup }) {
  const groupIds = TG.GROUPS.map(g => g.id);
  return (
    <div className="card table-card tg-card">
      <table className="table tg-table">
        <TgHead t={t} firstLabel={t("tg_rep") + " · " + t("tg_group")} />
        <tbody>
          {reps.map(pic => {
            const repGroups = yearGroups[pic] || {};
            const usedGroups = groupIds.filter(g => repGroups[g] || actualGroup[pic + "|" + g]);
            const shown = usedGroups.length ? usedGroups : ["A", "B", "C", "D", "E"];
            return (
              <React.Fragment key={pic}>
                {shown.map(g => {
                  const tgArr = repGroups[g] || Array(12).fill(0);
                  const acArr = actualGroup[pic + "|" + g] || Array(12).fill(0);
                  const meta = TG.GROUPS.find(x => x.id === g);
                  return (
                    <tr key={pic + g}>
                      <td>
                        <span className="tg-group-name">
                          <OwnerChip code={pic} t={t} />
                          <small style={{ color: meta ? meta.color : undefined }}>{meta ? meta.label : g}</small>
                        </span>
                      </td>
                      {Array.from({ length: 12 }, (_, m) => (
                        <TgCell key={m} tg={tgArr[m] || 0} ac={acArr[m] || 0} canEdit={isBoss}
                          onCommit={v => setTargetGroup(year, pic, g, m, v)} />
                      ))}
                      <TgTotalCell tg={tgArr.reduce((a, b) => a + b, 0)} ac={acArr.reduce((a, b) => a + b, 0)} t={t} />
                    </tr>
                  );
                })}
                <TgTotalRow t={t} label={t("tg_subtotal") + " – " + pic}
                  rowsT={shown.map(g => repGroups[g])}
                  rowsA={shown.map(g => actualGroup[pic + "|" + g])} />
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- view: by country ---- */
function TgCountryTable({ t, reps, yearTargets, actual, repCountry }) {
  const byCountry = {};
  reps.forEach(pic => {
    const c = repCountry(pic);
    (byCountry[c] = byCountry[c] || []).push(pic);
  });
  const countries = Object.keys(byCountry).sort();
  return (
    <div className="card table-card tg-card">
      <table className="table tg-table">
        <TgHead t={t} firstLabel={t("country")} />
        <tbody>
          {countries.map(c => {
            const colT = Array(12).fill(0), colA = Array(12).fill(0);
            byCountry[c].forEach(pic => {
              (yearTargets[pic] || []).forEach((v, m) => colT[m] += v || 0);
              (actual[pic] || []).forEach((v, m) => colA[m] += v || 0);
            });
            return (
              <tr key={c}>
                <td><strong className="cell-main"><Icon d={ICONS.globe} size={13} /> {c}</strong>
                  <small className="cell-sub">{byCountry[c].join(", ")}</small></td>
                {colT.map((v, m) => (
                  <td key={m} className={"tg-cell" + tgRatioCls(colA[m], v)}>
                    <span className="tg-t">{tgFmtM(v)}</span>
                    <span className="tg-a">{tgFmtM(colA[m])}</span>
                  </td>
                ))}
                <TgTotalCell tg={colT.reduce((a, b) => a + b, 0)} ac={colA.reduce((a, b) => a + b, 0)} t={t} />
              </tr>
            );
          })}
          {countries.length > 1 && <TgTotalRow t={t} label={t("tg_total")}
            rowsT={reps.map(p => yearTargets[p])} rowsA={reps.map(p => actual[p])} />}
        </tbody>
      </table>
    </div>
  );
}

// Target import with the same column-mapping UI as the other tabs (GenericImportModal).
// Accepts BOTH layouts: long (PIC, Group, Year, Month, Target) and wide (PIC, Group,
// Year, one column per month — headers like 1 / 1.00 / T1 / Thg 1 / Jan).
// Group text such as "C – Small but active" is reduced to its id (incl. two-letter "DE");
// rows whose group can't be recognized (e.g. "Cover Lacking") are counted as skipped.
// Rep-level totals (used by Retention) are recomputed as the sum of group rows.
function TargetImportModal({ year, onClose }) {
  const { t, targets, setTargets, targetGroups, setTargetGroups, users } = useApp();
  // Resolve a PIC value from the CSV to the SAME key the KPI grid stores under: an
  // account's sales code, OR (for a code-less Admin/BOD who still carries a KPI, e.g.
  // Thuy) its name. A row is accepted only if its PIC maps to such an account, and the
  // target is written under that canonical key so it lands on the rep's own grid row.
  const kpiKeyOf = (u) => u.salesCode || (u.name || "").trim();
  const picResolve = {};
  (users || []).filter(u => !u._deleted && (u.targetCountry || (u.countries || []).filter(x => x && x !== "*")[0])).forEach(u => {
    const key = kpiKeyOf(u); if (!key) return;
    if (u.salesCode) picResolve[String(u.salesCode).trim().toUpperCase()] = key;
    if (u.name) picResolve[String(u.name).trim().toUpperCase()] = key;
  });
  const MN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthRe = (i) => new RegExp("^(?:t|m|thg|thang|th\u00e1ng)?\\s*\\.?\\s*0?" + i + "(?:\\.0+)?$|^" + MN[i - 1], "i");
  const fields = [
    { key: "pic", labelKey: "tg_pic", required: true, re: /pic|sale|rep|nhân viên|เซลส์/i, ex: ["THUY", "KHUONG"] },
    { key: "group", labelKey: "tg_cust_type_group", re: /group|nhóm|loại kh|customer type|กลุ่ม/i, ex: ["A - Big & Regular", "C – Small but active"] },
    { key: "year", labelKey: "tg_year", re: /^year\b|^năm\b|^ปี\b/i, ex: ["2026", "2026"] },
    { key: "month", labelKey: "fc_month", re: /^(month|tháng|เดือน)$/i, ex: ["", ""] },
    { key: "target", labelKey: "tg_target", re: /^target\b|chỉ tiêu|kpi|เป้า/i, ex: ["", ""] },
    ...Array.from({ length: 12 }, (_, i) => ({
      key: "m" + (i + 1), label: t("tg_month") + (i + 1), re: monthRe(i + 1),
      ex: i === 0 ? ["30,201,000", "52,176,995"] : ["", ""],
    })),
  ];
  const parseNum = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isNaN(n) ? null : n; };
  const parseGroup = (s) => {
    s = String(s || "").trim();
    if (!s) return "A"; // no group column → default bucket
    return TG.normGroup(s) || null; // null = unrecognized → row skipped
  };
  return (
    <GenericImportModal titleKey="tg_import" hintKey="tg_import_note" templateName="targets" noCountry fields={fields}
      onClose={onClose}
      onImport={(items) => {
        const nextT = JSON.parse(JSON.stringify(targets));
        const nextG = JSON.parse(JSON.stringify(targetGroups));
        const touched = new Set();
        const badPics = new Set();
        let count = 0; const issues = [];
        const put = (y, pic, g, m, v) => {
          if (m == null || isNaN(m) || m < 0 || m > 11 || v == null) return;
          nextG[y] = nextG[y] || {}; nextG[y][pic] = nextG[y][pic] || {};
          const arr = (nextG[y][pic][g] || Array(12).fill(0)).slice();
          arr[m] = v; nextG[y][pic][g] = arr;
          touched.add(y + "|" + pic);
          count++;
        };
        items.forEach(it => {
          const raw = (it.pic || "").trim().toUpperCase();
          if (!raw) { issues.push({ row: it._row, reason: t("im_iss_missing").replace("{f}", t("tg_pic")) }); return; }
          // PIC must map to an account in Permissions (by sales code or, for code-less
          // Admins like Thuy, by name) — otherwise reject the row.
          const pic = picResolve[raw];
          if (!pic) { badPics.add(raw); issues.push({ row: it._row, reason: t("im_iss_picnf") }); return; }
          let y = (it.year || "").replace(/\D/g, "");
          if (y.length !== 4) y = String(year);
          const g = parseGroup(it.group);
          if (!g) { issues.push({ row: it._row, reason: t("im_iss_nogroup") }); return; }
          let wrote = false;
          for (let i = 1; i <= 12; i++) {
            const v = parseNum(it["m" + i]);
            if (v != null) { put(y, pic, g, i - 1, v); wrote = true; }
          }
          if (!wrote && (it.month || it.target)) {
            const m = parseInt(it.month) - 1;
            const v = parseNum(it.target);
            if (v != null) put(y, pic, g, m, v);
          }
        });
        // rep-level target = sum of the group rows (keeps Retention consistent)
        touched.forEach(k => {
          const [y, pic] = k.split("|");
          const sums = Array(12).fill(0);
          Object.values(nextG[y][pic]).forEach(arr => (arr || []).forEach((v, m) => { sums[m] += v || 0; }));
          nextT[y] = nextT[y] || {};
          nextT[y][pic] = sums;
        });
        if (count) { setTargets(nextT); setTargetGroups(nextG); }
        const warn = badPics.size ? t("tg_import_badpic").replace("{list}", [...badPics].join(", ")) : "";
        return { imported: count, created: 0, skipped: issues.length, issues, warn };
      }} />
  );
}

/* ---- view: tracking (MTD / YTD vs target, like the planning spreadsheet) ---- */
function TgTracking({ t, year, selMonth, reps, yearGroups, actualGroup, aggOK, pos, repCountry, groupFilter, cur, isBoss, onMoveRep }) {
  const fmt = (n) => tgCompact(n, cur);
  const groupIds = TG.GROUPS.map(g => g.id).filter(g => !groupFilter || g === groupFilter);
  // daily actuals: pic|group|month -> sum on the latest PO date in that month
  const daily = {};
  pos.forEach(p => {
    if (String(p.year) !== year) return;
    const m = (p.month || 0) - 1; if (m < 0 || m > 11) return;
    const key = p.pic + "|" + (p.group || "?") + "|" + m;
    const pd = p.poDate || p.date || "";
    const d = daily[key] = daily[key] || { maxDate: "", sum: 0 };
    if (pd > d.maxDate) { d.maxDate = pd; d.sum = p.amountVnd || 0; }
    else if (pd === d.maxDate) { d.sum += p.amountVnd || 0; }
  });
  const dailyOf = (pic, g, m) => (daily[pic + "|" + g + "|" + m] || {}).sum || 0;

  const ZERO = { annualTarget: 0, ytdTarget: 0, ytdActual: 0, mtdTarget: 0, mtdActual: 0, prevActual: 0, lackMTD: 0, lackYTD: 0, actDaily: 0 };
  const addInto = (acc, m) => {
    ["annualTarget", "ytdTarget", "ytdActual", "mtdTarget", "mtdActual", "prevActual", "lackMTD", "lackYTD", "actDaily"].forEach(k => acc[k] += (m[k] || 0));
  };
  const finishRatios = (acc) => {
    acc.pctAnnual = acc.annualTarget ? acc.ytdActual / acc.annualTarget : null;
    acc.pctYTD = acc.ytdTarget ? acc.ytdActual / acc.ytdTarget : null;
    acc.pctMTD = acc.mtdTarget ? acc.mtdActual / acc.mtdTarget : null;
    return acc;
  };

  const blocks = reps.map(pic => {
    const rg = yearGroups[pic] || {};
    const used = groupIds.filter(g => (rg[g] && rg[g].some(v => v)) || (actualGroup[pic + "|" + g] && actualGroup[pic + "|" + g].some(v => v)));
    const rows = used.map(g => {
      const m = TG.tgMetric(rg[g] || [], actualGroup[pic + "|" + g] || [], selMonth);
      return { g, ...m, actDaily: dailyOf(pic, g, selMonth) };
    });
    const tot = { ...ZERO }; rows.forEach(r => addInto(tot, r)); finishRatios(tot);
    return { pic, country: repCountry(pic), rows, tot };
  }).filter(b => b.rows.length);

  const grand = { ...ZERO }; blocks.forEach(b => addInto(grand, b.tot)); finishRatios(grand);
  const _rank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const _byC = {}; blocks.forEach(b => { const c = b.country || "—"; (_byC[c] = _byC[c] || []).push(b); });
  const countryGroups = Object.entries(_byC).sort((a, b) => _rank(a[0]) - _rank(b[0]));
  const mName = TG_MONTHS[selMonth];
  const pName = selMonth > 0 ? TG_MONTHS[selMonth - 1] : "—";

  const selT = useRowSelection();
  const sel = selT;
  const { deleteTargetGroupRows } = useApp();
  const allKeys = blocks.flatMap(b => b.rows.map(r => b.pic + "|" + r.g));
  const delSel = () => crmConfirm(t("tg_del_rows_confirm").replace("{n}", String(sel.count)), () => {
    deleteTargetGroupRows(year, [...sel.selected].map(k => { const i = k.indexOf("|"); return { pic: k.slice(0, i), group: k.slice(i + 1) }; }));
    sel.clear();
  });

  const cells = (m, opts = {}) => (
    <>
      <td className="cell-money tg-c-target">{fmt(m.annualTarget)}</td>
      <td className="cell-money tg-c-target">{fmt(m.mtdTarget)}</td>
      <td className="cell-money tg-c-mtd">{fmt(m.mtdActual)}</td>
      <td className="cell-money tg-c-mtd">{opts.noDaily ? "" : fmt(m.actDaily)}</td>
      <td className="cell-money tg-c-mtd">{fmt(m.lackMTD)}</td>
      <td className={"cell-money tg-c-mtd" + tgRatioCls(m.mtdActual, m.mtdTarget)}>{tgPct(m.pctMTD)}</td>
      <td className="cell-money tg-c-prev">{fmt(m.prevActual)}</td>
      <td className={"cell-money tg-c-prev" + (m.prevActual && m.mtdActual >= m.prevActual ? " tg-ok" : m.prevActual ? " tg-low" : "")}>{m.prevActual ? (m.mtdActual >= m.prevActual ? "▲ " : "▼ ") + Math.round((m.mtdActual - m.prevActual) / m.prevActual * 100) + "%" : "—"}</td>
      <td className="cell-money tg-c-ytd">{fmt(m.ytdTarget)}</td>
      <td className="cell-money tg-c-ytd">{fmt(m.ytdActual)}</td>
      <td className="cell-money tg-c-ytd">{fmt((m.ytdTarget || 0) - (m.ytdActual || 0))}</td>
      <td className={"cell-money tg-c-ytd" + tgRatioCls(m.ytdActual, m.ytdTarget)}>{tgPct(m.pctYTD)}</td>
      <td className={"cell-money tg-c-ytd" + tgRatioCls(m.ytdActual, m.annualTarget)}>{tgPct(m.pctAnnual)}</td>
    </>
  );

  return (
    <div className="card table-card tg-track-card">
      {aggOK === false && <p className="tg-ytd-warn">{t("tg_ytd_partial")}</p>}
      <table className="table tg-track-table" style={{ minWidth: 1308 }}>
        <colgroup>
          {isBoss && <col style={{ width: 34 }} />}
          <col style={{ width: 84 }} />
          <col style={{ width: 150 }} />
          {Array.from({ length: 13 }, (_, i) => <col key={i} style={{ width: 80 }} />)}
        </colgroup>
        <thead>
          <tr className="tg-track-h1">
            {isBoss && <th rowSpan="2" className="col-check tg-frz"><SelectAllCheck ids={allKeys} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
            <th rowSpan="2" className="tg-track-pic tg-frz">{t("tg_pic")}</th>
            <th rowSpan="2" className="tg-col-group tg-frz">{t("tg_cust_type_group")}</th>
            <th colSpan="2" className="tg-c-target">{t("tg_target")}</th>
            <th colSpan="4" className="tg-c-mtd">{t("tg_mtd_track")}</th>
            <th colSpan="2" className="tg-c-prev">{t("tg_prev_month")}</th>
            <th colSpan="5" className="tg-c-ytd">{t("tg_ytd_track")} <span className="dim" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>({TG_MONTHS[0]}–{mName})</span></th>
          </tr>
          <tr className="tg-track-h2">
            <th className="tg-c-target">{year}</th>
            <th className="tg-c-target">{mName}</th>
            <th className="tg-c-mtd">{t("tg_act_mtd")}</th>
            <th className="tg-c-mtd">{t("tg_act_daily")}</th>
            <th className="tg-c-mtd">{t("tg_lacking")}</th>
            <th className="tg-c-mtd">{t("tg_ratio")}</th>
            <th className="tg-c-prev">{pName}</th>
            <th className="tg-c-prev">% MoM</th>
            <th className="tg-c-ytd">{t("tg_target_ytd")}</th>
            <th className="tg-c-ytd">{t("tg_act_ytd")}</th>
            <th className="tg-c-ytd">{t("tg_lacking")}</th>
            <th className="tg-c-ytd">{t("tg_ratio")}</th>
            <th className="tg-c-ytd">{t("tg_pct_year")}</th>
          </tr>
        </thead>
        <tbody>
          {countryGroups.map(([country, cblocks]) => {
            const cGrand = { ...ZERO }; cblocks.forEach(b => addInto(cGrand, b.tot)); finishRatios(cGrand);
            return (
            <React.Fragment key={country}>
              <tr className="tg-country-hdr" onDragOver={e => { if (isBoss && onMoveRep) e.preventDefault(); }} onDrop={e => { const p = e.dataTransfer.getData("text/pic"); if (p && onMoveRep) onMoveRep(p, country); }}><td colSpan="20" className="tg-frz tg-col-grandhead">{country} <span className="dim">· {cblocks.length} {t("tg_pic")}</span>{isBoss && onMoveRep && <span className="dim" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}> · {t("tg_drop_here")}</span>}</td></tr>
              {cblocks.map(b => (
                <React.Fragment key={b.pic}>
                  {b.rows.map((r, i) => (
                    <tr key={r.g} className={sel.isSel(b.pic + "|" + r.g) ? "row-selected" : ""}>
                      {isBoss && <td className="col-check tg-frz"><RowCheck id={b.pic + "|" + r.g} selected={sel.selected} toggle={sel.toggle} /></td>}
                      {i === 0 && <td rowSpan={b.rows.length} className="tg-track-pic tg-frz" draggable={isBoss && !!onMoveRep} onDragStart={e => e.dataTransfer.setData("text/pic", b.pic)} title={isBoss && onMoveRep ? t("tg_drag_hint") : ""} style={isBoss && onMoveRep ? { cursor: "grab" } : null}><OwnerChip code={b.pic} t={t} /></td>}
                      <td className="tg-col-group tg-frz"><GroupBadge group={r.g} /></td>
                      {cells(r)}
                    </tr>
                  ))}
                  <tr className="tg-track-total">
                    {isBoss && <td className="col-check tg-frz"></td>}
                    <td className="tg-track-pic tg-frz"></td>
                    <td className="tg-col-group tg-frz"><strong>{b.pic} {t("tg_total")}</strong></td>
                    {cells(b.tot)}
                  </tr>
                </React.Fragment>
              ))}
              {countryGroups.length > 1 && (
              <tr className="tg-track-total">
                <td colSpan={isBoss ? 3 : 2} className="tg-frz tg-col-grandhead"><strong>{country} {t("tg_total")}</strong></td>
                {cells(cGrand)}
              </tr>
              )}
            </React.Fragment>
            );
          })}
          <tr className="tg-track-grand">
            <td colSpan={isBoss ? 3 : 2} className="tg-col-grandhead tg-frz"><strong>{countryGroups.length === 1 ? countryGroups[0][0] + " " + t("tg_total") : t("tg_total")}</strong></td>
            {cells(grand)}
          </tr>
        </tbody>
      </table>
      {isBoss && <BulkBar count={sel.count} noun={t("tg_target")} allIds={allKeys} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={delSel} onClear={sel.clear} />}
    </div>
  );
}

/* ---- input: grouped by PIC + customer type, editable T1–T12 (same template as tracking, target only) ---- */
function TgGInputCell({ val, canEdit, onCommit, cur }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  if (editing) {
    return (
      <td className="tg-c-target">
        <input className="input tg-input" autoFocus value={v}
          onChange={e => setV(e.target.value)}
          onBlur={() => { onCommit(parseFloat(v) || 0); setEditing(false); }}
          onKeyDown={e => { if (e.key === "Enter") { onCommit(parseFloat(v) || 0); setEditing(false); } if (e.key === "Escape") setEditing(false); }} />
      </td>
    );
  }
  return (
    <td className="cell-money tg-c-target tg-ginput" onClick={() => { if (canEdit) { setV(String(val || "")); setEditing(true); } }} title={canEdit ? "Click to edit" : ""}>
      {tgCompact(val, cur)}
    </td>
  );
}

function TgInputGrouped({ t, year, reps, yearGroups, setTargetGroup, isBoss, canEdit, repCountry, groupFilter, cur, onRemoveRep, onMoveRep }) {
  const canEditCell = canEdit !== undefined ? canEdit : isBoss;
  const groupIds = TG.GROUPS.map(g => g.id).filter(g => !groupFilter || g === groupFilter);
  const sumArr = (arrs) => { const a = Array(12).fill(0); arrs.forEach(x => (x || []).forEach((v, m) => a[m] += v || 0)); return a; };
  const annual = (arr) => (arr || []).reduce((s, v) => s + (v || 0), 0);

  const blocks = reps.map(pic => {
    const rg = yearGroups[pic] || {};
    const used = groupIds.filter(g => (rg[g] && rg[g].some(v => v)));
    const shown = used.length ? used : (groupFilter ? [groupFilter] : ["A", "B", "C", "D", "E"]);
    const rows = shown.map(g => ({ g, arr: rg[g] || Array(12).fill(0) }));
    const totArr = sumArr(rows.map(r => r.arr));
    return { pic, rows, totArr };
  }).filter(b => b.rows.length);
  const grandArr = sumArr(blocks.map(b => b.totArr));
  const _rank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const _byC = {};
  blocks.forEach(b => { const c = repCountry(b.pic) || "—"; (_byC[c] = _byC[c] || []).push(b); });
  const countryGroups = Object.entries(_byC).sort((a, b) => _rank(a[0]) - _rank(b[0]));
  // Row-level delete: tick the PIC × customer-type rows to clear, instead of wiping a year.
  const sel = useRowSelection();
  const { deleteTargetGroupRows } = useApp();
  const allKeys = blocks.flatMap(b => b.rows.map(r => b.pic + "|" + r.g));
  const delSel = () => crmConfirm(t("tg_del_rows_confirm").replace("{n}", String(sel.count)), () => {
    deleteTargetGroupRows(year, [...sel.selected].map(k => { const i = k.indexOf("|"); return { pic: k.slice(0, i), group: k.slice(i + 1) }; }));
    sel.clear();
  });

  return (
    <div className="card table-card tg-track-card">
      <table className="table tg-track-table" style={{ minWidth: 1052 }}>
        <colgroup>
          {canEditCell && <col style={{ width: 34 }} />}
          <col style={{ width: 84 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 86 }} />
          {TG_MONTHS.map(m => <col key={m} style={{ width: 58 }} />)}
        </colgroup>
        <thead>
          <tr className="tg-track-h1">
            {canEditCell && <th rowSpan="2" className="col-check tg-frz"><SelectAllCheck ids={allKeys} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
            <th rowSpan="2" className="tg-track-pic tg-frz">{t("tg_pic")}</th>
            <th rowSpan="2" className="tg-col-group tg-frz">{t("tg_cust_type_group")}</th>
            <th className="tg-c-target tg-col-annual tg-frz">{t("tg_annual") || year}</th>
            <th colSpan="12" className="tg-c-target">{t("tg_mode_input")}</th>
          </tr>
          <tr className="tg-track-h2">
            <th className="tg-c-target tg-col-annual tg-frz">{year}</th>
            {TG_MONTHS.map(m => <th key={m} className="tg-c-target">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {countryGroups.map(([country, cblocks]) => {
            const cGrand = sumArr(cblocks.map(b => b.totArr));
            return (
            <React.Fragment key={country}>
              <tr className="tg-country-hdr" onDragOver={e => { if (isBoss && onMoveRep) e.preventDefault(); }} onDrop={e => { const p = e.dataTransfer.getData("text/pic"); if (p && onMoveRep) onMoveRep(p, country); }}><td colSpan="20" className="tg-frz tg-col-grandhead">{country} <span className="dim">· {cblocks.length} {t("tg_pic")}</span>{isBoss && onMoveRep && <span className="dim" style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}> · {t("tg_drop_here")}</span>}</td></tr>
              {cblocks.map(b => (
                <React.Fragment key={b.pic}>
                  {b.rows.map((r, i) => (
                    <tr key={r.g} className={sel.isSel(b.pic + "|" + r.g) ? "row-selected" : ""}>
                      {canEditCell && <td className="col-check tg-frz"><RowCheck id={b.pic + "|" + r.g} selected={sel.selected} toggle={sel.toggle} /></td>}
                      {i === 0 && <td rowSpan={b.rows.length} className="tg-track-pic tg-frz" draggable={isBoss && !!onMoveRep} onDragStart={e => e.dataTransfer.setData("text/pic", b.pic)} title={isBoss && onMoveRep ? t("tg_drag_hint") : ""} style={isBoss && onMoveRep ? { cursor: "grab" } : null}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <OwnerChip code={b.pic} t={t} />
                          {isBoss && onRemoveRep && <button className="icon-btn" title={t("tg_remove_member")} style={{ padding: 2 }} onClick={() => crmConfirm(t("tg_remove_confirm").replace("{n}", b.pic), () => onRemoveRep(b.pic))}>✕</button>}
                        </div>
                      </td>}
                      <td className="tg-col-group tg-frz"><GroupBadge group={r.g} /></td>
                      <td className="cell-money tg-c-target tg-col-annual tg-frz"><strong>{tgCompact(annual(r.arr), cur)}</strong></td>
                      {Array.from({ length: 12 }, (_, m) => (
                        <TgGInputCell key={m} val={r.arr[m] || 0} canEdit={canEditCell} cur={cur} onCommit={v => setTargetGroup(year, b.pic, r.g, m, v)} />
                      ))}
                    </tr>
                  ))}
                  <tr className="tg-track-total">
                    {canEditCell && <td className="col-check tg-frz"></td>}
                    <td className="tg-track-pic tg-frz"></td>
                    <td className="tg-col-group tg-frz"><strong>{b.pic} {t("tg_total")}</strong></td>
                    <td className="cell-money tg-c-target tg-col-annual tg-frz"><strong>{tgCompact(annual(b.totArr), cur)}</strong></td>
                    {b.totArr.map((v, m) => <td key={m} className="cell-money tg-c-target">{tgCompact(v, cur)}</td>)}
                  </tr>
                </React.Fragment>
              ))}
              <tr className="tg-track-total">
                <td colSpan={canEditCell ? 3 : 2} className="tg-frz tg-col-grandhead"><strong>{country} {t("tg_total")}</strong></td>
                <td className="cell-money tg-c-target tg-col-annual tg-frz"><strong>{tgCompact(annual(cGrand), cur)}</strong></td>
                {cGrand.map((v, m) => <td key={m} className="cell-money tg-c-target">{tgCompact(v, cur)}</td>)}
              </tr>
            </React.Fragment>
            );
          })}
          <tr className="tg-track-grand">
            <td colSpan={canEditCell ? 3 : 2} className="tg-col-grandhead tg-frz"><strong>{t("tg_local")}</strong></td>
            <td className="cell-money tg-col-annual tg-frz"><strong>{tgCompact(annual(grandArr), cur)}</strong></td>
            {grandArr.map((v, m) => <td key={m} className="cell-money">{tgCompact(v, cur)}</td>)}
          </tr>
        </tbody>
      </table>
      {canEditCell && <BulkBar count={sel.count} noun={t("tg_target")} allIds={allKeys} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={delSel} onClear={sel.clear} />}
    </div>
  );
}

window.TargetPage = TargetPage;
