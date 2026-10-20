// Todaytec CRM — Overview pivot tables (Customer / Salesman / Material)
// Same column layout as the BI report the team reads, but every figure is computed from
// the SERVER aggregates the app already loads:
//   • Customer + Salesman  → po_agg (Overview's scopePOs: selected year AND the year before)
//   • Material             → po_agg_material (RPC; falls back to the POs held in RAM when
//                            the migration deploy/supabase/migrations/po_agg_material.sql
//                            has not been run yet — the table then says so).
// Nothing here is seeded or hard-coded.

const OVP_TOP = 15;

function ovpNum(v) { return v ? new Intl.NumberFormat("en-US").format(Math.round(v)) : ""; }
// The column band already names the currency, so the per-cell symbol is dropped.
function ovpStripCur(s) { return String(s == null ? "" : s).replace(/\s*[\u20ab$\u0e3f]\s*$/, ""); }

function OvpDelta({ cur, base }) {
  if (!base) return <span className="ovp-flat">0.00%</span>;
  const g = cur / base - 1;
  const v = Math.abs(g) * 100;
  const txt = v >= 1000 ? new Intl.NumberFormat("en-US").format(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0);
  return <span className={g >= 0 ? "ovp-up" : "ovp-down"}>{(g < 0 ? "-" : "") + txt}% {g >= 0 ? "▲" : "▼"}</span>;
}

function OvpBarCell({ v, max, tone, text, cls }) {
  const w = max > 0 && v > 0 ? Math.max(2, Math.min(100, v / max * 100)) : 0;
  return (
    <td className={"ovp-num" + (cls ? " " + cls : "")}>
      {w > 0 && <span className={"ovp-bar ovp-bar-" + tone} style={{ width: w + "%" }}></span>}
      <span className="ovp-v">{text}</span>
    </td>
  );
}

function OvpDot({ pct }) {
  if (pct == null) return <span className="ovp-flat">—</span>;
  const tone = pct >= 0.9 ? "ok" : pct >= 0.7 ? "warn" : "bad";
  return <span className={"ovp-kpi " + tone}><span>{Math.round(pct * 100)}%</span><i className="ovp-dot"></i></span>;
}

/* ---- section shell: title + search box ---- */
function OvpHead({ title, q, setQ, ph }) {
  return (
    <div className="ovp-head">
      <h3 className="ovp-h3">{title}</h3>
      <input className="input ovp-search" value={q} placeholder={ph} onChange={e => setQ(e.target.value)} />
    </div>
  );
}

/* ---- Customer / Material table: SQM + PO value, MoM and YoY ---- */
function OvpValueTable({ t, rows: allRows, cur, head, empty, title, showTarget }) {
  const CC = window.CRM;
  const [sort, setSort] = React.useState({ k: "sqm", d: -1 });
  const [all, setAll] = React.useState(false);
  const [q, setQ] = React.useState("");
  const money = (v) => (v ? ovpStripCur(CC.fmtMoney(v, cur)) : "");
  const qq = q.trim().toLowerCase();
  const rows = qq ? allRows.filter(r => String(r.label).toLowerCase().includes(qq)) : allRows;
  const tot = rows.reduce((s, r) => ({
    sqm: s.sqm + r.sqm, sqmLM: s.sqmLM + r.sqmLM, sqmYTD: s.sqmYTD + r.sqmYTD, sqmLY: s.sqmLY + r.sqmLY,
    po: s.po + r.po, poLM: s.poLM + r.poLM, poYTD: s.poYTD + r.poYTD, poLY: s.poLY + r.poLY,
    tgSqm: s.tgSqm + (r.tgSqm || 0), tgVal: s.tgVal + (r.tgVal || 0),
  }), { sqm: 0, sqmLM: 0, sqmYTD: 0, sqmLY: 0, po: 0, poLM: 0, poYTD: 0, poLY: 0, tgSqm: 0, tgVal: 0 });
  const pct = (a, b) => (b ? <span className={a / b >= 0.9 ? "ovp-up" : a / b >= 0.7 ? "ovp-flat" : "ovp-down"}>{Math.round(a / b * 100)}%</span> : <span className="ovp-flat">—</span>);
  const mx = (k) => Math.max(1, ...rows.map(r => r[k] || 0));
  const sorted = rows.slice().sort((a, b) => sort.k === "label"
    ? String(a.label).localeCompare(String(b.label)) * sort.d
    : ((a[sort.k] || 0) - (b[sort.k] || 0)) * sort.d);
  const shown = all ? sorted : sorted.slice(0, OVP_TOP);
  const th = (k, label, cls) => (
    <th className={(cls || "") + (sort.k === k ? " ovp-sorted" : "")}
      onClick={() => setSort(s => ({ k, d: s.k === k ? -s.d : -1 }))}>{label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}</th>
  );
  if (!allRows.length) return <><OvpHead title={title} q={q} setQ={setQ} ph={t("search")} /><p className="empty">{empty}</p></>;
  return (
    <>
      <OvpHead title={title} q={q} setQ={setQ} ph={t("search")} />
      {!rows.length && <p className="empty">{t("cu_no_results")}</p>}
      <div className="ovp-scroll">
        <table className="table ovp-table">
          <thead>
            <tr className="ovp-grouphead">
              <th className="ovp-name ovp-gh-empty"></th>
              <th colSpan="6" className="ovp-gh ovp-b-l ovp-b-r">SQM</th>
              <th colSpan="6" className="ovp-gh ovp-b-l ovp-b-r">PO VALUE · {cur}</th>
              {showTarget && <th colSpan="4" className="ovp-gh ovp-b-l ovp-b-r">{t("tg_target")} YTD</th>}
            </tr>
            <tr>
              {th("label", head, "ovp-name")}
              {th("sqm", "MTD", "ovp-b-l")}
              {th("sqmLM", "LM")}
              <th>%MoM</th>
              {th("sqmYTD", "YTD")}
              {th("sqmLY", "LY")}
              <th className="ovp-b-r">%YoY</th>
              {th("po", "MTD", "ovp-b-l")}
              {th("poLM", "LM")}
              <th>%MoM</th>
              {th("poYTD", "YTD")}
              {th("poLY", "LY")}
              <th className="ovp-b-r">%YoY</th>
              {showTarget && <>
                {th("tgSqm", "SQM", "ovp-b-l")}
                <th>%</th>
                {th("tgVal", cur)}
                <th className="ovp-b-r">%</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.key}>
                <td className="ovp-name" title={r.label}>{r.label}</td>
                <OvpBarCell v={r.sqm} max={mx("sqm")} tone="a" text={ovpNum(r.sqm)} cls="ovp-b-l" />
                <OvpBarCell v={r.sqmLM} max={mx("sqmLM")} tone="g" text={ovpNum(r.sqmLM)} />
                <td className="ovp-num"><OvpDelta cur={r.sqm} base={r.sqmLM} /></td>
                <OvpBarCell v={r.sqmYTD} max={mx("sqmYTD")} tone="a" text={ovpNum(r.sqmYTD)} />
                <td className="ovp-num ovp-plain">{ovpNum(r.sqmLY)}</td>
                <td className="ovp-num ovp-b-r"><OvpDelta cur={r.sqmYTD} base={r.sqmLY} /></td>
                <OvpBarCell v={r.po} max={mx("po")} tone="b" text={money(r.po)} cls="ovp-b-l" />
                <OvpBarCell v={r.poLM} max={mx("poLM")} tone="g" text={money(r.poLM)} />
                <td className="ovp-num"><OvpDelta cur={r.po} base={r.poLM} /></td>
                <OvpBarCell v={r.poYTD} max={mx("poYTD")} tone="b" text={money(r.poYTD)} />
                <OvpBarCell v={r.poLY} max={mx("poLY")} tone="g" text={money(r.poLY)} />
                <td className="ovp-num ovp-b-r"><OvpDelta cur={r.poYTD} base={r.poLY} /></td>
                {showTarget && <>
                  <td className="ovp-num ovp-plain ovp-b-l">{ovpNum(r.tgSqm)}</td>
                  <td className="ovp-num">{pct(r.sqmYTD, r.tgSqm)}</td>
                  <td className="ovp-num ovp-plain">{money(r.tgVal)}</td>
                  <td className="ovp-num ovp-b-r">{pct(r.poYTD, r.tgVal)}</td>
                </>}
              </tr>
            ))}
            <tr className="ovp-total">
              <td className="ovp-name">{t("tg_total")}</td>
              <td className="ovp-num ovp-b-l">{ovpNum(tot.sqm)}</td>
              <td className="ovp-num">{ovpNum(tot.sqmLM)}</td>
              <td className="ovp-num"><OvpDelta cur={tot.sqm} base={tot.sqmLM} /></td>
              <td className="ovp-num">{ovpNum(tot.sqmYTD)}</td>
              <td className="ovp-num">{ovpNum(tot.sqmLY)}</td>
              <td className="ovp-num ovp-b-r"><OvpDelta cur={tot.sqmYTD} base={tot.sqmLY} /></td>
              <td className="ovp-num ovp-b-l">{money(tot.po)}</td>
              <td className="ovp-num">{money(tot.poLM)}</td>
              <td className="ovp-num"><OvpDelta cur={tot.po} base={tot.poLM} /></td>
              <td className="ovp-num">{money(tot.poYTD)}</td>
              <td className="ovp-num">{money(tot.poLY)}</td>
              <td className="ovp-num ovp-b-r"><OvpDelta cur={tot.poYTD} base={tot.poLY} /></td>
              {showTarget && <>
                <td className="ovp-num ovp-b-l">{ovpNum(tot.tgSqm)}</td>
                <td className="ovp-num">{pct(tot.sqmYTD, tot.tgSqm)}</td>
                <td className="ovp-num">{money(tot.tgVal)}</td>
                <td className="ovp-num ovp-b-r">{pct(tot.poYTD, tot.tgVal)}</td>
              </>}
            </tr>
          </tbody>
        </table>
      </div>
      {rows.length > OVP_TOP && (
        <button className="link-btn ovp-more" onClick={() => setAll(a => !a)}>
          {all ? t("cu_show_less") : t("nc_view_all").replace("{n}", rows.length)}
        </button>
      )}
    </>
  );
}

/* ---- Salesman / Customer-type table: plan vs actual, year / quarter / month ---- */
function OvpKpiTable({ t, rows: allRows, cur, head, kind, title, unit }) {
  const CC = window.CRM;
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(() => new Set());
  const toggle = (k) => setOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const money = (v) => (v ? (unit === "sqm" ? ovpNum(v) : ovpStripCur(CC.fmtMoney(v, cur))) : "—");
  const unitLabel = unit === "sqm" ? "SQM" : cur;
  const Chip = window.OwnerChip;
  const Badge = window.GroupBadge;
  const qq = q.trim().toLowerCase();
  const rows = qq ? allRows.filter(r => (String(r.label) + " " + String(r.key)).toLowerCase().includes(qq)) : allRows;
  const tot = rows.reduce((s, r) => {
    ["planY", "actY", "planQ", "actQ", "planM", "actM", "actPM"].forEach(k => s[k] += r[k] || 0);
    return s;
  }, { planY: 0, actY: 0, planQ: 0, actQ: 0, planM: 0, actM: 0, actPM: 0 });
  const cells = (r) => (
    <>
      <td className="ovp-num ovp-plan ovp-b-l">{money(r.planY)}</td>
      <td className="ovp-num ovp-act">{money(r.actY)}</td>
      <td className="ovp-num ovp-b-r"><OvpDot pct={r.planY ? r.actY / r.planY : null} /></td>
      <td className="ovp-num ovp-plan ovp-b-l">{money(r.planQ)}</td>
      <td className="ovp-num ovp-act">{money(r.actQ)}</td>
      <td className="ovp-num ovp-b-r"><OvpDot pct={r.planQ ? r.actQ / r.planQ : null} /></td>
      <td className="ovp-num ovp-plan ovp-b-l">{money(r.planM)}</td>
      <td className="ovp-num ovp-act">{money(r.actM)}</td>
      <td className="ovp-num ovp-b-r"><OvpDot pct={r.planM ? r.actM / r.planM : null} /></td>
      <td className="ovp-num ovp-prev">{money(r.actPM)}</td>
      <td className="ovp-num"><OvpDelta cur={r.actM} base={r.actPM} /></td>
    </>
  );
  return (
    <>
      <OvpHead title={title} q={q} setQ={setQ} ph={t("search")} />
      <div className="ovp-scroll">
      <table className="table ovp-table ovp-kpi-table">
        <thead>
          <tr className="ovp-grouphead">
            <th className="ovp-name ovp-gh-empty"></th>
            <th colSpan="3" className="ovp-gh ovp-b-l ovp-b-r">YTD · {unitLabel}</th>
            <th colSpan="3" className="ovp-gh ovp-b-l ovp-b-r">QTD · {unitLabel}</th>
            <th colSpan="3" className="ovp-gh ovp-b-l ovp-b-r">MTD · {unitLabel}</th>
            <th colSpan="2" className="ovp-gh-empty"></th>
          </tr>
          <tr>
            <th className="ovp-name">{head}</th>
            <th className="ovp-b-l">Plan YTD</th>
            <th>Actual YTD</th>
            <th className="ovp-b-r">% KPI Year</th>
            <th className="ovp-b-l">Plan QTD</th>
            <th>Actual QTD</th>
            <th className="ovp-b-r">% KPI QTD</th>
            <th className="ovp-b-l">Plan MTD</th>
            <th>Actual MTD</th>
            <th className="ovp-b-r">% KPI Month</th>
            <th>Actual PM</th>
            <th>MoM %</th>
          </tr>
        </thead>
        <tbody>
          <tr className="ovp-total">
            <td className="ovp-name">{t("tg_total")}</td>
            {cells(tot)}
          </tr>
          {rows.map(r => {
            const kids = r.subRows || [];
            const isOpen = open.has(r.key);
            return (
              <React.Fragment key={r.key}>
                <tr className={kids.length ? "ovp-row-parent" : ""}>
                  <td className="ovp-name">
                    {kids.length ? <button className="ovp-caret" onClick={() => toggle(r.key)} aria-expanded={isOpen}>{isOpen ? "▾" : "▸"}</button> : null}
                    {kind === "group" && Badge && !r.unassigned ? <Badge group={r.key} /> : (Chip && kind !== "group" && !r.unassigned ? <Chip code={r.key} t={t} /> : r.label)}
                    {kids.length ? <span className="ovp-kidcount">{kids.length}</span> : null}
                  </td>
                  {cells(r)}
                </tr>
                {isOpen && kids.map(k => (
                  <tr key={k.key} className="ovp-row-child">
                    <td className="ovp-name ovp-name-sub" title={k.label}>{k.label}</td>
                    {cells(k)}
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

/* ---- container: builds every row set from the aggregates ---- */
function OvPivotTables({ t, pos, ramPos, custById, products, users, targets, targetGroups, reps, repCountry, allowCountry, picOK, rowOK, resolveRep, planOf, year, month, cur, isBoss }) {
  const CC = window.CRM;
  const Y = Number(year) || new Date().getFullYear();
  const M = Number(month) || 0;
  const LM = M > 0 ? { y: Y, m: M - 1 } : { y: Y - 1, m: 11 };
  const baseCode = CC.baseCode || ((s) => String(s || "").split(/[.\s·|/]/)[0].trim().toUpperCase());

  // one bucket per key: MTD, last month, YTD (Jan→selected month) and the same YTD window
  // of last year — the MTD/LM/MoM and YTD/LY/YoY pair the team reads together.
  const bucket = (list, keyOf, labelOf) => {
    const map = {};
    list.forEach(p => {
      const k = keyOf(p); if (!k) return;
      const y = Number(p.year) || 0, mi = (Number(p.month) || 0) - 1;
      if (mi < 0 || mi > 11) return;
      const isCur = y === Y && mi === M, isLM = y === LM.y && mi === LM.m;
      const isYTD = y === Y && mi <= M, isLY = y === Y - 1 && mi <= M;
      if (!isCur && !isLM && !isYTD && !isLY) return;
      const r = map[k] = map[k] || { key: k, label: labelOf(k, p), sqm: 0, sqmLM: 0, sqmYTD: 0, sqmLY: 0, po: 0, poLM: 0, poYTD: 0, poLY: 0 };
      const sqm = Number(p.sqm) || 0, amt = Number(p.amountVnd) || 0;
      if (isCur) { r.sqm += sqm; r.po += amt; }
      if (isLM) { r.sqmLM += sqm; r.poLM += amt; }
      if (isYTD) { r.sqmYTD += sqm; r.poYTD += amt; }
      if (isLY) { r.sqmLY += sqm; r.poLY += amt; }
    });
    return Object.values(map).filter(r => r.sqmYTD || r.sqmLM || r.sqmLY || r.poYTD || r.poLM || r.poLY);
  };

  const custRows = React.useMemo(() => bucket(pos, p => p.customerId, (id) => {
    const c = custById[id];
    return (c && (c.shortName || c.nameCode || c.name)) || id;
  }), [pos, Y, M, custById]);
  // Target by customer (Targets → By customer): YTD plan per company, Jan → selected month.
  // Stored per item as SQM plus a value in the budget file's own currency, so the value is
  // normalised to VND here — the unit every figure on this page is summed in.
  const { targetCust } = useApp();
  const custTargets = React.useMemo(() => {
    const y = (targetCust && targetCust[String(Y)]) || {};
    const rate = (c) => (((CC.CURRENCIES || {})[c || "USD"] || { rate: 1 }).rate || 1);
    const out = {};
    Object.keys(y).forEach(cid => {
      let sqm = 0, val = 0;
      Object.values(y[cid] || {}).forEach(it => {
        const a = it.sqm || [], v = it.usd || [];
        const r = rate(it.cur);
        for (let m = 0; m <= M && m < 12; m++) {
          sqm += +a[m] || 0;
          val += ((+v[m] || 0) || ((+a[m] || 0) * (+it.price || 0))) * r;
        }
      });
      if (sqm || val) out[cid] = { sqm, val };
    });
    return out;
  }, [targetCust, Y, M]);
  const custRowsT = React.useMemo(() => custRows.map(r => {
    const tg = custTargets[r.key];
    return tg ? { ...r, tgSqm: tg.sqm, tgVal: tg.val } : r;
  }), [custRows, custTargets]);
  const hasCustTarget = React.useMemo(() => custRowsT.some(r => r.tgSqm || r.tgVal), [custRowsT]);

  // ---- material: server aggregate (both years to date), RAM fallback ----
  const [matRows, setMatRows] = React.useState(undefined);   // undefined = loading, null = unavailable
  React.useEffect(() => {
    let on = true;
    (async () => {
      // YTD and LY both need Jan→now of their year, so two full-year windows cover every
      // column (MTD / LM / YTD / LY) in two calls.
      const wins = [Y - 1, Y];
      try {
        const parts = await Promise.all(wins.map(y =>
          CC.SB.aggMaterialRange(y + "-01-01", y + "-12-31")));
        if (!on) return;
        setMatRows(parts.every(p => Array.isArray(p)) ? [].concat.apply([], parts) : null);
      } catch (e) { if (on) setMatRows(null); }
    })();
    return () => { on = false; };
  }, [Y, M]);
  const matFallback = matRows === null;
  const matSource = React.useMemo(() => {
    if (Array.isArray(matRows)) {
      return matRows.filter(r => rowOK(r.cust, r.pic)).map(r => ({
        year: Number(r.yr) || 0, month: Number(r.mo) || 0, code: r.code || "—",
        sqm: Number(r.sqm) || 0, amountVnd: Number(r.amount) || 0,
      }));
    }
    if (matRows === null) {
      return (ramPos || []).filter(p => !p._deleted && rowOK(p.customerId, p.pic)).map(p => ({
        year: Number(p.year) || 0, month: Number(p.month) || 0,
        code: baseCode((p.items && p.items[0] && (p.items[0].structureCode || p.items[0].sku)) || p.structureCode || p.productCode || p.commercial || "") || "—",
        sqm: Number(p.sqm) || 0, amountVnd: Number(p.amountVnd) || 0,
      }));
    }
    return [];
  }, [matRows, ramPos, rowOK]);
  // Product code exactly as registered in the Products tab: the aggregate gives whatever
  // the PO carried (structure code / sku / commercial name), which is matched against the
  // catalogue so one SKU never shows up under two spellings.
  const prodIdx = React.useMemo(() => {
    const ix = {};
    (products || []).forEach(p => {
      const code = String(p.code || p.name || "").trim();
      if (!code) return;
      [p.code, p.name, p.itmref, p.eccshoaxx].forEach(v => {
        const k = String(v || "").trim().toUpperCase(); if (k) ix[k] = code;
        const b = baseCode(v); if (b) ix[b] = ix[b] || code;
      });
    });
    return ix;
  }, [products]);
  const catalogueCode = (raw) => {
    const k = String(raw || "").trim().toUpperCase();
    if (!k) return "—";
    return prodIdx[k] || prodIdx[baseCode(k)] || k;
  };
  const materialRows = React.useMemo(() => bucket(matSource, p => catalogueCode(p.code), (k) => k), [matSource, Y, M, prodIdx]);
  // ---- product type (JR / FR): same aggregate, keyed by the catalogue's Type field ----
  const typeIdx = React.useMemo(() => {
    const ix = {};
    (products || []).forEach(p => {
      const ty = String(p.productType || "").trim().toUpperCase();
      if (!ty) return;
      [p.code, p.name, p.itmref, p.eccshoaxx].forEach(v => {
        const k = String(v || "").trim().toUpperCase(); if (k && !ix[k]) ix[k] = ty;
        const b = baseCode(v); if (b && !ix[b]) ix[b] = ty;
      });
    });
    return ix;
  }, [products]);
  const typeOfCode = (raw) => {
    const k = String(raw || "").trim().toUpperCase();
    const ty = k ? (typeIdx[k] || typeIdx[baseCode(k)] || "") : "";
    // "OTHERS" in the catalogue and "not in the catalogue" are the same row to a reader.
    return (!ty || /^OTHER/.test(ty)) ? t("ovp_type_other") : ty;
  };
  const typeRows = React.useMemo(() => {
    const rows = bucket(matSource, p => typeOfCode(p.code), (k) => k);
    const ord = (k) => k === "JR" ? 0 : k === "FR" ? 1 : 2;
    return rows.sort((a, b) => ord(a.key) - ord(b.key) || b.poYTD - a.poYTD);
  }, [matSource, Y, M, typeIdx]);
  // ---- product type KPI: plan from Targets → By customer (per item), actual from POs ----
  const typeKpiRows = React.useMemo(() => {
    const ycv = (targetCust && targetCust[String(Y)]) || {};
    const rateOfT = (c) => (((CC.CURRENCIES || {})[c || "USD"] || { rate: 1 }).rate || 1);
    const qStart = Math.floor(M / 3) * 3;
    const blank = () => ({ plan: Array(12).fill(0), act: Array(12).fill(0), prevDec: 0 });
    const acc = {};
    const at = (k) => (acc[k] = acc[k] || blank());
    Object.keys(ycv).forEach(cid => {
      Object.values(ycv[cid] || {}).forEach(it => {
        const a = at(typeOfCode(it.code));
        const s = it.sqm || [], v = it.usd || [], r = rateOfT(it.cur);
        for (let m = 0; m < 12; m++) a.plan[m] += ((+v[m] || 0) || ((+s[m] || 0) * (+it.price || 0))) * r;
      });
    });
    matSource.forEach(p => {
      const mi = (Number(p.month) || 0) - 1; if (mi < 0 || mi > 11) return;
      const a = at(typeOfCode(p.code)), amt = Number(p.amountVnd) || 0;
      if (Number(p.year) === Y) a.act[mi] += amt;
      else if (Number(p.year) === Y - 1 && mi === 11) a.prevDec += amt;
    });
    const sum = (arr, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += arr[i] || 0; return s; };
    const ord = (k) => k === "JR" ? 0 : k === "FR" ? 1 : 2;
    return Object.keys(acc).map(k => {
      const a = acc[k];
      return {
        key: k, label: k, unassigned: true,   // plain text label — JR/FR are not sales codes
        planY: sum(a.plan, 0, 11), actY: sum(a.act, 0, M),
        planQ: sum(a.plan, qStart, M), actQ: sum(a.act, qStart, M),
        planM: a.plan[M] || 0, actM: a.act[M] || 0,
        actPM: M > 0 ? (a.act[M - 1] || 0) : a.prevDec,
      };
    }).filter(r => r.planY || r.actY || r.actPM).sort((x, y2) => ord(x.key) - ord(y2.key) || y2.actY - x.actY);
  }, [matSource, targetCust, Y, M, typeIdx]);

  // ---- salesman: plan (Targets) vs actual (PO List) ----
  // Rows are the accounts that hold a KPI country in Permissions — the same list the
  // Targets grid uses, so codes with no account (old imports) never appear. A PO's rep is
  // resolved like the PO vs Target card does it (sales code → account name → the customer's
  // PIC/owner); anything left over rolls into one Unassigned row so the Total reconciles
  // with the PO List.
  const kpiRows = React.useMemo(() => {
    const yTg = (targets && targets[String(Y)]) || {};
    const NA = "__NA__";
    const qStart = Math.floor(M / 3) * 3;
    const list = (reps || []).filter(r => r.key);
    const known = new Set(list.map(r => r.key));
    const blank = () => ({ act: Array(12).fill(0), prevDec: 0 });
    const acc = {};
    list.forEach(r => { acc[r.key] = blank(); });
    pos.forEach(p => {
      const mi = (Number(p.month) || 0) - 1; if (mi < 0 || mi > 11) return;
      const raw = String((resolveRep ? resolveRep(p) : p.pic) || "").toUpperCase();
      const code = known.has(raw) ? raw : NA;
      const a = acc[code] = acc[code] || blank();
      if (Number(p.year) === Y) a.act[mi] += Number(p.amountVnd) || 0;
      else if (Number(p.year) === Y - 1 && mi === 11) a.prevDec += Number(p.amountVnd) || 0;
    });
    const sum = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += a[i] || 0; return s; };
    const build = (code, label) => {
      const hit = Object.keys(yTg).find(k => String(k).toUpperCase() === code);
      const planArr = (planOf && code !== NA && planOf(code)) || ((hit && Array.isArray(yTg[hit])) ? yTg[hit] : []);
      const a = acc[code] || blank();
      return {
        key: code, label, unassigned: code === NA,
        planY: sum(planArr, 0, 11), actY: sum(a.act, 0, M),
        planQ: sum(planArr, qStart, M), actQ: sum(a.act, qStart, M),
        planM: planArr[M] || 0, actM: a.act[M] || 0,
        actPM: M > 0 ? (a.act[M - 1] || 0) : a.prevDec,
      };
    };
    const rows = list.map(r => build(r.key, r.label)).filter(r => r.planY || r.actY || r.actPM);
    rows.sort((a, b) => b.actY - a.actY || b.planY - a.planY);
    if (acc[NA]) { const na = build(NA, t("unassigned")); if (na.actY || na.actPM) rows.push(na); }
    return rows;
  }, [pos, targets, reps, Y, M, resolveRep, planOf]);

  // ---- customer type (A–G): plan from the KPI grid, actual from the PO group ----
  const groupRows = React.useMemo(() => {
    const ids = (CC.GROUPS || []).map(g => g.id);
    const yG = (targetGroups && targetGroups[String(Y)]) || {};
    const qStart = Math.floor(M / 3) * 3;
    const known = new Set((reps || []).map(r => r.key));
    const plan = {}, act = {}, prevDec = {}, cAct = {}, cPlan = {};
    ids.forEach(g => { plan[g] = Array(12).fill(0); act[g] = Array(12).fill(0); prevDec[g] = 0; cAct[g] = {}; cPlan[g] = {}; });
    Object.keys(yG).forEach(pic => {
      if (known.size && !known.has(String(pic).toUpperCase())) return;
      const pg = yG[pic] || {};
      ids.forEach(g => { const a = pg[g] || []; for (let m = 0; m < 12; m++) plan[g][m] += a[m] || 0; });
    });
    // Per-COMPANY value plan comes from Targets → By customer — the only grid that plans a
    // single company: value as stated in the budget file, else SQM × price, in VND.
    const ycv = (targetCust && targetCust[String(Y)]) || {};
    const grpOfC = (raw) => { const s = String(raw || "").toUpperCase(); return /^DE/.test(s) ? "DE" : s.slice(0, 1); };
    const rateOfC = (c) => (((CC.CURRENCIES || {})[c || "USD"] || { rate: 1 }).rate || 1);
    Object.keys(ycv).forEach(cid => {
      const g = grpOfC((custById[cid] || {}).group);
      if (!cPlan[g]) return;
      const cp = cPlan[g][cid] = cPlan[g][cid] || Array(12).fill(0);
      Object.values(ycv[cid] || {}).forEach(it => {
        const a = it.sqm || [], v = it.usd || [], r = rateOfC(it.cur);
        for (let m = 0; m < 12; m++) cp[m] += ((+v[m] || 0) || ((+a[m] || 0) * (+it.price || 0))) * r;
      });
    });
    pos.forEach(p => {
      const mi = (Number(p.month) || 0) - 1; if (mi < 0 || mi > 11) return;
      const raw = String(p.group || "").toUpperCase();
      const g = /^DE/.test(raw) ? "DE" : raw.slice(0, 1);
      if (!act[g]) return;
      const amt = Number(p.amountVnd) || 0;
      const cid = p.customerId || "";
      const c = cid ? (cAct[g][cid] = cAct[g][cid] || { act: Array(12).fill(0), prevDec: 0 }) : null;
      if (Number(p.year) === Y) { act[g][mi] += amt; if (c) c.act[mi] += amt; }
      else if (Number(p.year) === Y - 1 && mi === 11) { prevDec[g] += amt; if (c) c.prevDec += amt; }
    });
    const sum = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += a[i] || 0; return s; };
    return ids.map(g => {
      const meta = (CC.GROUPS || []).find(x => x.id === g) || {};
      // Layer 2: the companies that make up this customer type, with the per-company plan
      // from Targets → By customer.
      const cm = cAct[g] || {}, pm = cPlan[g] || {};
      const cids = [...new Set([...Object.keys(cm), ...Object.keys(pm)])];
      const subRows = cids.map(cid => {
        const cRec = custById[cid] || {};
        const a = cm[cid] || { act: Array(12).fill(0), prevDec: 0 };
        const pl = pm[cid] || Array(12).fill(0);
        return {
          key: g + "|" + cid, label: (cRec.shortName || cRec.nameCode || cRec.name) || cid,
          planY: sum(pl, 0, 11), actY: sum(a.act, 0, M),
          planQ: sum(pl, qStart, M), actQ: sum(a.act, qStart, M),
          planM: pl[M] || 0, actM: a.act[M] || 0,
          actPM: M > 0 ? (a.act[M - 1] || 0) : a.prevDec,
        };
      }).filter(r => r.planY || r.actY || r.actPM).sort((x, y) => y.actY - x.actY);
      return {
        key: g, label: meta.label || g, subRows,
        planY: sum(plan[g], 0, 11), actY: sum(act[g], 0, M),
        planQ: sum(plan[g], qStart, M), actQ: sum(act[g], qStart, M),
        planM: plan[g][M] || 0, actM: act[g][M] || 0,
        actPM: M > 0 ? (act[g][M - 1] || 0) : prevDec[g],
      };
    }).filter(r => r.planY || r.actY || r.actPM);
  }, [pos, targetGroups, reps, Y, M, custById, targetCust]);

  // ---- customer type in SQM: plan from Targets → By customer (SQM is what it budgets),
  // actual from the PO lines' own area. Same layout as the value table above it.
  const groupSqmRows = React.useMemo(() => {
    const ids = (CC.GROUPS || []).map(g => g.id);
    const yc = (targetCust && targetCust[String(Y)]) || {};
    const qStart = Math.floor(M / 3) * 3;
    const grpOf = (raw) => { const s = String(raw || "").toUpperCase(); return /^DE/.test(s) ? "DE" : s.slice(0, 1); };
    const plan = {}, act = {}, prevDec = {}, cAct = {}, cPlan = {};
    ids.forEach(g => { plan[g] = Array(12).fill(0); act[g] = Array(12).fill(0); prevDec[g] = 0; cAct[g] = {}; cPlan[g] = {}; });
    Object.keys(yc).forEach(cid => {
      const g = grpOf((custById[cid] || {}).group);
      if (!plan[g]) return;
      Object.values(yc[cid] || {}).forEach(it => {
        const a = it.sqm || [];
        const cp = cPlan[g][cid] = cPlan[g][cid] || Array(12).fill(0);
        for (let m = 0; m < 12; m++) { const v = +a[m] || 0; plan[g][m] += v; cp[m] += v; }
      });
    });
    pos.forEach(p => {
      const mi = (Number(p.month) || 0) - 1; if (mi < 0 || mi > 11) return;
      const g = grpOf(p.group);
      if (!act[g]) return;
      const sqm = Number(p.sqm) || 0;
      const cid = p.customerId || "";
      const c = cid ? (cAct[g][cid] = cAct[g][cid] || { act: Array(12).fill(0), prevDec: 0 }) : null;
      if (Number(p.year) === Y) { act[g][mi] += sqm; if (c) c.act[mi] += sqm; }
      else if (Number(p.year) === Y - 1 && mi === 11) { prevDec[g] += sqm; if (c) c.prevDec += sqm; }
    });
    const sum = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += a[i] || 0; return s; };
    return ids.map(g => {
      const meta = (CC.GROUPS || []).find(x => x.id === g) || {};
      const cm = cAct[g] || {}, pm = cPlan[g] || {};
      const cids = [...new Set([...Object.keys(cm), ...Object.keys(pm)])];
      const subRows = cids.map(cid => {
        const cRec = custById[cid] || {};
        const a = (cm[cid] || { act: Array(12).fill(0), prevDec: 0 });
        const pl = pm[cid] || Array(12).fill(0);
        return {
          key: g + "|sqm|" + cid, label: (cRec.shortName || cRec.nameCode || cRec.name) || cid,
          planY: sum(pl, 0, 11), actY: sum(a.act, 0, M),
          planQ: sum(pl, qStart, M), actQ: sum(a.act, qStart, M),
          planM: pl[M] || 0, actM: a.act[M] || 0,
          actPM: M > 0 ? (a.act[M - 1] || 0) : a.prevDec,
        };
      }).filter(r => r.planY || r.actY || r.actPM).sort((x, y) => y.actY - x.actY);
      return {
        key: g, label: meta.label || g, subRows,
        planY: sum(plan[g], 0, 11), actY: sum(act[g], 0, M),
        planQ: sum(plan[g], qStart, M), actQ: sum(act[g], qStart, M),
        planM: plan[g][M] || 0, actM: act[g][M] || 0,
        actPM: M > 0 ? (act[g][M - 1] || 0) : prevDec[g],
      };
    }).filter(r => r.planY || r.actY || r.actPM);
  }, [pos, targetCust, Y, M, custById]);

  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][M];  return (
    <section className="card" style={{ gridColumn: "1/-1" }}>
      <h2>{t("ovp_title")} <span className="card-hint">{monthName} {Y} · {t("ovp_vs_lm_ly")}</span></h2>
      <div className="ovp-block">
        <OvpValueTable t={t} title={t("cu_company")} rows={custRowsT} cur={cur} head={t("cu_company")} empty={t("pol_no_pos")} showTarget={hasCustTarget} />
      </div>
      <div className="ovp-block">
        {kpiRows.length
          ? <OvpKpiTable t={t} title={t("tg_rep")} head={t("tg_pic")} rows={kpiRows} cur={cur} />
          : <><h3 className="ovp-h3">{t("tg_rep")}</h3><p className="empty">{t("pol_no_pos")}</p></>}
      </div>
      <div className="ovp-block">
        {matRows === undefined
          ? <><h3 className="ovp-h3">{t("pd_title")}</h3><p className="empty">{t("loading")}</p></>
          : <>
            {matFallback && <p className="ovp-warn">{t("ovp_mat_partial")}</p>}
            <OvpValueTable t={t} title={t("pd_title")} rows={materialRows} cur={cur} head={t("pol_structure")} empty={t("pol_no_pos")} />
          </>}
      </div>
      <div className="ovp-block">
        {matRows === undefined
          ? <><h3 className="ovp-h3">{t("pd_title")} · Type</h3><p className="empty">{t("loading")}</p></>
          : <OvpValueTable t={t} title={t("pd_title") + " · Type"} rows={typeRows} cur={cur} head="Type" empty={t("pol_no_pos")} />}
      </div>
      <div className="ovp-block">
        {typeKpiRows.length
          ? <OvpKpiTable t={t} title={t("pd_title") + " · Type · KPI"} head="Type" rows={typeKpiRows} cur={cur} />
          : <><h3 className="ovp-h3">{t("pd_title")} · Type · KPI</h3><p className="empty">{t("pol_no_pos")}</p></>}
      </div>
      <div className="ovp-block">
        {groupRows.length
          ? <OvpKpiTable t={t} title={t("tg_group")} head={t("tg_group")} kind="group" rows={groupRows} cur={cur} />
          : <><h3 className="ovp-h3">{t("tg_group")}</h3><p className="empty">{t("pol_no_pos")}</p></>}
      </div>
      <div className="ovp-block">
        {groupSqmRows.length
          ? <OvpKpiTable t={t} title={t("tg_group") + " · SQM"} head={t("tg_group")} kind="group" rows={groupSqmRows} cur={cur} unit="sqm" />
          : <><h3 className="ovp-h3">{t("tg_group")} · SQM</h3><p className="empty">{t("pol_no_pos")}</p></>}
      </div>
    </section>
  );
}

window.OvPivotTables = OvPivotTables;
