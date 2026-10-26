// Todaytec CRM — Targets: BY CUSTOMER BY ITEM
// One row per customer × product code, budgeted in SQM per month. Value = SQM × the
// reference selling price (the "2025 average price" column of the budget file), so a
// price correction re-values the whole plan without re-entering a single month.
const TC = window.CRM;
const TC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tcNum = (v) => (v ? new Intl.NumberFormat("en-US").format(Math.round(v)) : "");
const tcMoney = (v) => (v ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(v)) : "");
const tcSum = (a) => (a || []).reduce((s, v) => s + (+v || 0), 0);

/* ---- one editable number cell ---- */
function TcCell({ val, canEdit, onCommit, decimals }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  if (editing) {
    return (
      <td className="tc-cell tc-editing">
        <input className="tc-input" autoFocus type="number" step="any" value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { const n = parseFloat(draft); onCommit(isNaN(n) ? 0 : n); setEditing(false); }}
          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditing(false); }} />
      </td>
    );
  }
  return (
    <td className={"tc-cell" + (canEdit ? " tc-can-edit" : "")}
      onClick={canEdit ? () => { setDraft(val ? String(val) : ""); setEditing(true); } : undefined}>
      {decimals ? (val ? (+val).toFixed(decimals) : "") : tcNum(val)}
    </td>
  );
}

/* ---- the grid ---- */
function TgByCustomer({ t, year, canEdit, reps, custById, picFilter, importing, setImporting }) {
  const { targetCust, setTargetCustMonth, setTargetCustField, deleteTargetCustRows, normalizeTargetCustPics, currency } = useApp();
  const [q, setQ] = React.useState("");
  const sel = useRowSelection();
  // Heal rows imported before the PIC resolver folded diacritics — one push per year, once.
  const fixedYears = React.useRef({});
  React.useEffect(() => {
    const yk = String(year);
    if (fixedYears.current[yk] || !normalizeTargetCustPics) return;
    fixedYears.current[yk] = 1;
    normalizeTargetCustPics(yk);
  }, [year, targetCust && Object.keys(targetCust).length]);
  const [measure, setMeasure] = React.useState("sqm");   // which figure the 12 month cells show
  const [open, setOpen] = React.useState(() => new Set());
  const toggle = (k) => setOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Value is stored per row in the currency the budget file used, so a mixed-currency
  // plan still totals correctly: normalise to VND, then let fmtMoney show the page unit.
  const rateOf = (c) => ((TC.CURRENCIES[c] || TC.CURRENCIES.VND).rate || 1);
  // Value as ENTERED when the file carried a value column, else derived from area × price.
  const rowVal = (it) => (tcSum(it.usd) || tcSum(it.sqm) * (+it.price || 0));
  const rowVnd = (it) => rowVal(it) * rateOf(it.cur || "USD");
  const showVal = (vnd) => (vnd ? TC.fmtMoney(vnd, currency) : "");

  const yearData = (targetCust && targetCust[String(year)]) || {};
  const groups = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    const out = [];
    Object.keys(yearData).forEach(cid => {
      const c = custById[cid] || {};
      const label = c.shortName || c.nameCode || c.name || cid;
      const items = Object.keys(yearData[cid] || {}).map(code => ({ code, ...(yearData[cid][code] || {}) }));
      // Only the EXPLICIT PIC filter narrows the grid. A row whose PIC does not resolve to a
      // registered rep is still a real target, so it is shown rather than silently dropped.
      const kept = items.filter(it => !picFilter || String(it.pic || "").toUpperCase() === picFilter.toUpperCase());
      if (!kept.length) return;
      if (qq && !(String(label) + " " + (c.name || "") + " " + kept.map(x => x.code).join(" ")).toLowerCase().includes(qq)) return;
      const sqm = Array(12).fill(0);
      const mon = Array(12).fill(0);
      let val = 0;
      kept.forEach(it => {
        (it.sqm || []).forEach((v, m) => { sqm[m] += +v || 0; });
        const vals = (tcSum(it.usd) ? it.usd : (it.sqm || []).map(v => (+v || 0) * (+it.price || 0)));
        (vals || []).forEach((v, m) => { mon[m] += (+v || 0) * rateOf(it.cur || "USD"); });
        val += rowVnd(it);
      });
      out.push({ cid, label, full: c.name || "", items: kept.sort((a, b) => a.code.localeCompare(b.code)), sqm, mon, val, totalSqm: tcSum(sqm) });
    });
    return out.sort((a, b) => b.totalSqm - a.totalSqm || a.label.localeCompare(b.label));
  }, [yearData, custById, q, picFilter]);

  const tot = React.useMemo(() => {
    const sqm = Array(12).fill(0), mon = Array(12).fill(0); let val = 0;
    groups.forEach(g => { g.sqm.forEach((v, m) => { sqm[m] += v; }); g.mon.forEach((v, m) => { mon[m] += v; }); val += g.val; });
    return { sqm, mon, val, totalSqm: tcSum(sqm) };
  }, [groups]);
  const isSqm = measure === "sqm";
  const cellOf = (row, m) => (isSqm ? tcNum(row.sqm[m]) : showVal(row.mon[m]));
  // Row-level delete: one customer×item per tick, so a mis-imported line can be removed
  // without clearing the year.
  const allKeys = groups.flatMap(g => g.items.map(it => g.cid + "|" + it.code));
  const delSel = () => crmConfirm(t("tg_del_rows_confirm").replace("{n}", String(sel.count)), () => {
    deleteTargetCustRows(String(year), [...sel.selected].map(k => { const i = k.indexOf("|"); return { customerId: k.slice(0, i), code: k.slice(i + 1) }; }));
    sel.clear();
  });

  return (
    <>
      <div className="tc-bar">
        <div className="seg">
          <button className={isSqm ? "on" : ""} onClick={() => setMeasure("sqm")}>{t("tgc_measure_sqm")}</button>
          <button className={!isSqm ? "on" : ""} onClick={() => setMeasure("val")}>{t("tgc_measure_val")}</button>
        </div>
        <input className="input tc-search" value={q} placeholder={t("search")} onChange={e => setQ(e.target.value)} />
        <span className="dim tc-note">{t("tgc_unit_note")}</span>
      </div>
      <div className="card table-card tc-card">
        <table className="table tc-table">
          <colgroup>
            {canEdit && <col style={{ width: 34 }} />}
            <col style={{ width: 200 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 74 }} />
            {TC_MONTHS.map(m => <col key={m} style={{ width: 64 }} />)}
            <col style={{ width: 96 }} />
            <col style={{ width: 124 }} />
          </colgroup>
          <thead>
            <tr className="tc-h1">
              {canEdit && <th rowSpan="2" className="col-check tc-frz"><SelectAllCheck ids={allKeys} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <th rowSpan="2" className="tc-col-cust tc-frz">{t("cu_company")}</th>
              <th rowSpan="2" className="tc-col-item">{t("tgc_item")}</th>
              <th rowSpan="2" className="tc-col-price">{t("tgc_price")}</th>
              <th colSpan="12" className="tc-band-a">{isSqm ? t("tgc_sqm_by_month") : t("tgc_val_by_month") + " · " + currency}</th>
              <th colSpan="2" className="tc-band-b">{year}</th>
            </tr>
            <tr className="tc-h2">
              {TC_MONTHS.map(m => <th key={m} className="tc-band-a">{m}</th>)}
              <th className="tc-band-b">{t("tgc_total_sqm")}</th>
              <th className="tc-band-b">{t("tgc_total_val")} · {currency}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="tc-grand">
              {canEdit && <td className="col-check tc-frz"></td>}
              <td className="tc-col-cust tc-frz"><strong>{t("tg_total")}</strong></td>
              <td className="tc-col-item dim">{groups.length}</td>
              <td className="tc-col-price"></td>
              {tot.sqm.map((v, m) => <td key={m} className="tc-cell">{cellOf(tot, m)}</td>)}
              <td className="tc-cell"><strong>{tcNum(tot.totalSqm)}</strong></td>
              <td className="tc-cell"><strong>{showVal(tot.val)}</strong></td>
            </tr>
            {groups.map(g => {
              const isOpen = open.has(g.cid);
              return (
                <React.Fragment key={g.cid}>
                  <tr className="tc-row-parent">
                    {canEdit && <td className="col-check tc-frz"></td>}
                    <td className="tc-col-cust tc-frz" title={g.full}>
                      <button className="ovp-caret" onClick={() => toggle(g.cid)} aria-expanded={isOpen}>{isOpen ? "▾" : "▸"}</button>
                      {g.label}
                    </td>
                    <td className="tc-col-item dim">{g.items.length}</td>
                    <td className="tc-col-price"></td>
                    {g.sqm.map((v, m) => <td key={m} className="tc-cell">{cellOf(g, m)}</td>)}
                    <td className="tc-cell"><strong>{tcNum(g.totalSqm)}</strong></td>
                    <td className="tc-cell"><strong>{showVal(g.val)}</strong></td>
                  </tr>
                  {isOpen && g.items.map(it => (
                    <tr key={it.code} className={"tc-row-child" + (sel.isSel(g.cid + "|" + it.code) ? " row-selected" : "")}>
                      {canEdit && <td className="col-check tc-frz"><RowCheck id={g.cid + "|" + it.code} selected={sel.selected} toggle={sel.toggle} /></td>}
                      <td className="tc-col-cust tc-frz tc-sub">{it.pic ? <OwnerChip code={it.pic} t={t} /> : <span className="dim">—</span>}</td>
                      <td className="tc-col-item"><strong>{it.code}</strong><small className="cell-sub">{[it.grade, it.cur || "USD"].filter(Boolean).join(" · ")}</small></td>
                      <TcCell val={it.price} canEdit={canEdit} decimals={4}
                        onCommit={v => setTargetCustField(String(year), g.cid, it.code, "price", v)} />                      {Array.from({ length: 12 }, (_, m) => (
                        <TcCell key={m} val={isSqm ? (it.sqm || [])[m] : (it.usd || [])[m]} canEdit={canEdit}
                          decimals={isSqm ? 0 : 2}
                          onCommit={v => setTargetCustMonth(String(year), g.cid, it.code, isSqm ? "sqm" : "usd", m, v)} />
                      ))}
                      <td className="tc-cell">{tcNum(tcSum(it.sqm))}</td>
                      <td className="tc-cell">{showVal(rowVnd(it))}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
            {!groups.length && <tr><td colSpan={canEdit ? 18 : 17} className="empty tc-empty">{t("tgc_no_rows")}</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && <BulkBar count={sel.count} noun={t("tgc_item")} allIds={allKeys} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={delSel} onClear={sel.clear} />}
      {importing && <TgCustImportModal t={t} year={year} onClose={() => setImporting(false)} />}
    </>
  );
}

/* ---- import: the budget file's own layout (one row per customer × item, Jan…Dec SQM) ---- */
const TGC_FIELDS = [
  ["pic", "pol_pic"], ["custCode", "tgc_cust_code"], ["custName", "cu_company"], ["shortName", "tgc_short_name"],
  ["code", "tgc_item"], ["grade", "pol_grade"], ["roll", "tgc_roll"], ["price", "tgc_price"],
];
const TGC_RE = {
  pic: /业务员|salesman|sales\s*rep|\bpic\b|nh\u00e2n vi\u00ean|ph\u1ee5 tr\u00e1ch/i,
  custCode: /客户编码|customer\s*code|m\u00e3\s*kh|m\u00e3\s*kh\u00e1ch/i,
  custName: /客户名称|customer\s*name|t\u00ean\s*kh|company/i,
  shortName: /short\s*name/i,
  code: /预算型号|型号|budget|item|model|structure|product\s*code|m\u00e3\s*sp/i,
  grade: /grade|ink|等级|\u0111\u1ecb\u006eh/i,
  roll: /小卷|大卷|roll\s*type/i,
  price: /均价|avg|average|unit\s*price|price/i,
};
function TgCustImportModal({ t, year, onClose }) {
  const { customers, setTargetCustBulk, productCountry, users } = useApp();
  const [rows, setRows] = React.useState(null);
  const [book, setBook] = React.useState(null);
  const [fileName, setFileName] = React.useState("");
  const [error, setError] = React.useState("");
  const [report, setReport] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  // The budget file is priced in ONE currency for ONE market. Country scopes the customer
  // match (so a Thai file never lands on the Vietnamese company of the same name); currency
  // names the unit of the price column — the sample file is USD/m², so that is the default.
  const markets = React.useMemo(() => [...new Set([...(TC.MARKETS || []), ...(customers || []).map(c => TC.normCountry(c.country))].filter(Boolean))].sort(), [customers]);
  const [country, setCountry] = React.useState(TC.normCountry(productCountry || "") || (TC.MARKETS || ["Vietnam"])[0]);
  const [cur, setCur] = React.useState("USD");

  const custFind = React.useMemo(() => {
    const byKey = {};
    (customers || []).filter(c => !country || TC.normCountry(c.country) === country).forEach(c => {
      [c.nameCode, c.bizId, c.shortName, c.name].forEach(k => { const v = TC.normName(k); if (v && !byKey[v]) byKey[v] = c; });
    });
    return (...keys) => { for (const k of keys) { const v = TC.normName(k); if (v && byKey[v]) return byKey[v]; } return null; };
  }, [customers, country]);

  // The file names its salesman in full ("Hoàng Lê Khương"); the app keys reps by sales code
  // ("KHUONG"). Resolve one to the other or the imported rows never line up with a rep.
  // CRM.normName strips non-ASCII letters rather than folding them ("Khương" → "kh ng"), so
  // the match is done on a diacritic-FOLDED key, and on the last name token as well — that
  // is the part Vietnamese sales codes are built from.
  const fold = (v) => String(v == null ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D").trim().toUpperCase();
  const lastTok = (v) => { const p = fold(v).split(/\s+/).filter(Boolean); return p.length ? p[p.length - 1] : ""; };
  const picResolve = React.useMemo(() => {
    const m = {};
    const put = (k, code) => { if (k && !m[k]) m[k] = code; };
    (users || []).forEach(u => {
      if (u._deleted) return;
      const code = String(u.salesCode || u.name || "").trim();
      if (!code) return;
      put(code.toUpperCase(), code);
      put(fold(code), code);
      [u.name, u.shortName].forEach(nm => { put(fold(nm), code); put(lastTok(nm), code); const k = TC.normName(nm); if (k) put(k, code); });
    });
    return (raw) => {
      const s = String(raw || "").trim();
      if (!s) return "";
      return m[s.toUpperCase()] || m[fold(s)] || m[lastTok(s)] || m[TC.normName(s)] || s;
    };
  }, [users]);

  const onFile = (file) => {
    setError(""); setFileName(file.name);
    TC.readImportFile(file).then(({ sheets }) => {
      if (!sheets.length) { setError(t("im_excel_err")); return; }
      if (sheets.length > 1) { setBook({ sheets }); setRows(null); }
      else setRows(sheets[0].rows);
    }).catch(() => setError(t("im_excel_err")));
  };

  // Auto-detected column map, then EDITABLE: the guess is a starting point, every field and
  // every month column can be re-pointed by hand ("Jan 2026 SQM" (area) and "Jan 2026 USD"
  // (value) are two separate sections, so a plan that states both is stored as both).
  const plan = React.useMemo(() => {
    if (!rows || rows.length < 2) return null;
    const headers = rows[0].map(h => String(h == null ? "" : h).trim());
    const m = {}, taken = new Set();
    Object.keys(TGC_RE).forEach(f => {
      const i = headers.findIndex((h, ix) => !taken.has(ix) && TGC_RE[f].test(h));
      if (i >= 0) { m[f] = i; taken.add(i); }
    });
    const months = Array(12).fill(-1), vals = Array(12).fill(-1);
    let yr = 0, valCur = "";
    headers.forEach((h, i) => {
      const mi = TC_MONTHS.findIndex(mn => new RegExp("(^|[^a-z])" + mn, "i").test(h));
      if (mi < 0) return;
      const isSqm = /sqm|m2|m²|面积/i.test(h);
      const cm = /(usd|thb|vnd|idr)/i.exec(h);
      const isVal = !isSqm && (!!cm || /value|amount|金额|销售额/i.test(h));
      if (isSqm && months[mi] < 0) months[mi] = i;
      else if (isVal && vals[mi] < 0) { vals[mi] = i; if (cm && !valCur) valCur = cm[1].toUpperCase(); }
      else return;
      const y = /(20\d{2})/.exec(h); if (y && !yr) yr = +y[1];
    });
    return { headers, m, months, vals, valCur, year: yr || +year };
  }, [rows, year]);
  const [map, setMap] = React.useState({});
  const [mSqm, setMSqm] = React.useState(Array(12).fill(-1));
  const [mVal, setMVal] = React.useState(Array(12).fill(-1));
  const [impYear, setImpYear] = React.useState(String(year));
  React.useEffect(() => {
    if (!plan) return;
    setMap(plan.m); setMSqm(plan.months); setMVal(plan.vals); setImpYear(String(plan.year));
    if (plan.valCur && TC.CURRENCIES[plan.valCur]) setCur(plan.valCur);
  }, [plan]);
  const headers = plan ? plan.headers : [];
  const colOpts = (cur) => (
    <>
      <option value="-1">{t("im_skip")}</option>
      {headers.map((h, i) => <option key={i} value={i}>{h ? String(h).slice(0, 54) : "(col " + (i + 1) + ")"}</option>)}
    </>
  );
  const setMonth = (which, mi, ix) => (which === "sqm" ? setMSqm : setMVal)(prev => { const n = prev.slice(); n[mi] = ix; return n; });
  const nSqm = mSqm.filter(i => i >= 0).length, nVal = mVal.filter(i => i >= 0).length;

  const run = () => {
    if (!plan || busy) return;
    setBusy(true);
    const val = (r, f) => (map[f] !== undefined && map[f] >= 0 ? String(r[map[f]] == null ? "" : r[map[f]]).trim() : "");
    const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; };
    const out = [], missing = new Set();
    let noCode = 0;
    rows.slice(1).forEach(r => {
      const code = TC.cleanCode(val(r, "code"));
      if (!code) { noCode++; return; }
      const cust = custFind(val(r, "custCode"), val(r, "shortName"), val(r, "custName"));
      if (!cust) { missing.add(val(r, "custName") || val(r, "custCode") || val(r, "shortName")); return; }
      const sqm = mSqm.map(ix => (ix >= 0 ? num(r[ix]) : 0));
      const usd = mVal.map(ix => (ix >= 0 ? num(r[ix]) : 0));
      if (!sqm.some(v => v) && !usd.some(v => v)) return;
      out.push({
        year: String(impYear), customerId: cust.id, code,
        pic: picResolve(val(r, "pic")), grade: val(r, "grade"), roll: val(r, "roll"),
        price: num(val(r, "price")), cur, country, sqm, usd,
      });
    });
    // Several file rows can share one customer×item (different roll types) — merge them.
    const merged = {};
    out.forEach(r => {
      const k = r.year + "|" + r.customerId + "|" + r.code;
      const ex = merged[k];
      if (!ex) { merged[k] = r; return; }
      ex.sqm = ex.sqm.map((v, i) => v + r.sqm[i]);
      ex.usd = ex.usd.map((v, i) => v + r.usd[i]);
      if (!ex.price) ex.price = r.price;
    });
    const list = Object.values(merged);
    const res = setTargetCustBulk(list);
    setReport({ count: list.length, skipped: rows.length - 1 - list.length, noCode, missing: [...missing].filter(Boolean), year: impYear, years: res.years });
    setBusy(false);
  };

  const dlTemplate = () => {
    const head = [t("pol_pic"), "Customer code", t("cu_company"), "Short Name", t("tgc_item"), t("pol_grade"), t("tgc_price")];
    TC_MONTHS.forEach(m => head.push(m + " " + year + " SQM"));
    TC_MONTHS.forEach(m => head.push(m + " " + year + " " + cur));
    const ex = ["NOOM", "VNN000039", "ABC Label Co., Ltd.", "ABC", "TDW132", "Wax", "0.045"]
      .concat(TC_MONTHS.map((_, i) => i < 3 ? "4482" : "0"))
      .concat(TC_MONTHS.map((_, i) => i < 3 ? "201.69" : "0"));
    window.downloadCSVTemplate("target-by-customer", head, [ex]);
  };

  return (
    <Modal title={t("tgc_import_title")} onClose={onClose} width={640}>
      {error ? (
        <div>
          <p className="import-warn">{error}</p>
          <div className="modal-actions"><button className="btn btn-primary" onClick={() => { setError(""); setRows(null); setBook(null); }}>{t("im_replace")}</button></div>
        </div>
      ) : report ? (
        <div className={"import-report" + (report.missing.length ? " import-report-warn" : "")}>
          <div className="import-report-icon">{report.missing.length ? "!" : "\u2713"}</div>
          <h3>{report.missing.length ? t("im_done_partial") : t("im_done")}</h3>
          <p><strong>{report.count}</strong> {t("tgc_rows_imported").replace("{y}", String(report.year))}</p>
          {report.missing.length > 0 && <p className="import-warn" style={{ textAlign: "left" }}>
            {t("tgc_unmatched").replace("{n}", String(report.missing.length))} {report.missing.slice(0, 12).join(", ")}{report.missing.length > 12 ? "…" : ""}
          </p>}
          <div className="modal-actions" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      ) : !rows && book ? (
        <ImportSheetPicker t={t} fileName={fileName} sheets={book.sheets}
          onPick={i => setRows(book.sheets[i].rows)} onReplace={() => { setBook(null); setRows(null); }} />
      ) : !rows ? (
        <div>
          <p className="import-note">{t("tgc_import_hint")}</p>
          <ImportDrop t={t} onFile={onFile} />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="link-btn" style={{ marginLeft: 0 }} onClick={dlTemplate}>
              <Icon d={ICONS.download} size={13} /> {t("im_template")}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="import-fileline">
            <Icon d={ICONS.file} size={15} /> <strong>{fileName}</strong>
            <span className="dim">· {rows.length - 1} {t("im_rows")}</span>
            <button className="link-btn" onClick={() => { setRows(null); setBook(null); }}>{t("im_replace")}</button>
          </div>
          <div className="import-currency">
            <div className="import-currency-main">
              <span className="import-currency-label">{t("country")}</span>
              <select className="select" value={country} onChange={e => setCountry(e.target.value)}>
                {markets.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="import-currency-label" style={{ marginLeft: 14 }}>{t("pol_currency")}</span>
              <select className="select" value={cur} onChange={e => setCur(e.target.value)}>
                {Object.keys(TC.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <small className="import-currency-hint">{t("tgc_cur_note").replace("{cur}", cur).replace("{c}", country)}</small>
          </div>
          <div className="tc-map">
            <div className="tc-map-head">{t("tgc_sec_fields")}</div>
            {TGC_FIELDS.map(([f, labelKey]) => (
              <div key={f} className="tc-map-row">
                <span className="map-field">{t(labelKey)}</span>
                <select className="select" value={map[f] === undefined ? "-1" : String(map[f])}
                  onChange={e => { const v = Number(e.target.value); setMap(prev => ({ ...prev, [f]: v })); }}>
                  {colOpts()}
                </select>
              </div>
            ))}
            <div className="tc-map-head">{t("tgc_sec_sqm")} <span className="dim">{nSqm} / 12</span></div>
            {TC_MONTHS.map((mn, mi) => (
              <div key={"s" + mn} className="tc-map-row">
                <span className="map-field">{mn}</span>
                <select className="select" value={String(mSqm[mi])} onChange={e => setMonth("sqm", mi, Number(e.target.value))}>{colOpts()}</select>
              </div>
            ))}
            <div className="tc-map-head">{t("tgc_sec_val")} <span className="dim">{nVal ? nVal + " / 12" : t("tgc_val_derived")}</span></div>
            {TC_MONTHS.map((mn, mi) => (
              <div key={"v" + mn} className="tc-map-row">
                <span className="map-field">{mn}</span>
                <select className="select" value={String(mVal[mi])} onChange={e => setMonth("val", mi, Number(e.target.value))}>{colOpts()}</select>
              </div>
            ))}
            <div className="tc-map-head">{t("tg_year")}</div>
            <div className="tc-map-row">
              <span className="map-field">{t("tg_year")}</span>
              <input className="input" type="number" value={impYear} onChange={e => setImpYear(e.target.value)} />
            </div>
          </div>
          <p className="import-note">{t("tgc_replace_note")}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={busy || !plan || (!nSqm && !nVal)} onClick={run}>
              {busy ? "…" : t("im_run")} ({rows.length - 1})
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

Object.assign(window, { TgByCustomer, TgCustImportModal });
