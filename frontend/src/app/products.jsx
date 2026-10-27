// Todaytec CRM — Products tab
const PD = window.CRM;

function ProductsPage() {
  const { t, isBoss, products, addProduct, updateProductItem, deleteProduct, deleteProducts, replaceProducts, canEdit, canExport, canDelete: canDeletePerm, lvlOr, pos, currency, setCurrency, productCountry } = useApp();
  const [q, setQ] = useState("");
  // Country comes from ONE place: the topbar filter (productCountry). No second dropdown
  // here that could disagree with it.
  const ctryF = productCountry || "";
  // The currency the price columns are shown in. Default = the market's own currency, but a
  // manual pick STICKS (remembered per market) instead of snapping back on every remount —
  // that snap-back is why the Thai list kept flipping THB ↔ USD under the user's hands.
  const CUR_KEY = "ttcrm_pd_currency";
  const curMap = () => { try { return JSON.parse(localStorage.getItem(CUR_KEY) || "{}") || {}; } catch (e) { return {}; } };
  useEffect(() => {
    if (!ctryF) return;
    const saved = curMap()[ctryF];
    setCurrency(saved && PD.CURRENCIES[saved] ? saved : PD.ccyOfCountry(ctryF));
  }, [ctryF]);
  const pickCurrency = (v) => {
    setCurrency(v);
    if (!ctryF) return;
    const m = curMap(); m[ctryF] = v;
    try { localStorage.setItem(CUR_KEY, JSON.stringify(m)); } catch (e) {}
  };
  const [shown, setShown] = useState(200);
  const sel = useRowSelection();
  const canDelete = !!(canDeletePerm && canDeletePerm("products"));
  const [editing, setEditing] = useState(null); // product id or "new"
  const [confirmDel, setConfirmDel] = useState(null);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleCode = (code) => setExpanded(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  // Currency conversion for the price columns: each product stores its own currency;
  // convert every price into the currency chosen in the toolbar (via VND as the pivot).
  const dispRate = (PD.CURRENCIES[currency] && PD.CURRENCIES[currency].rate) || 1;
  const toDisp = (val, from) => (parseFloat(val) || 0) * ((PD.CURRENCIES[from || "VND"] || { rate: 1 }).rate) / dispRate;
  // Small unit prices (a JR jumbo roll is quoted in cents/m²) need more than 2 decimals, or
  // the whole column reads 0.00 once it is converted into a stronger currency.
  const fmtN = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency === "VND" ? 0 : 2, maximumFractionDigits: currency === "VND" ? 0 : (Math.abs(n) < 1 ? 4 : 2) }).format(n);
  const fmtPrice = (val, from) => { const n = toDisp(val, from); if (!n) return null; return fmtN(n); };
  // The price AS ENTERED, in its own currency — shown next to the converted figure whenever
  // the two differ, so a row stored in the wrong unit is visible instead of silent.
  const fmtAsEntered = (val) => { const n = parseFloat(val) || 0; return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 }).format(n); };

  const grades = [...new Set(products.map(p => p.grade).filter(Boolean))];
  // Country is a price-list dimension, not a tag: the same code appears once per market.
  const list = products.filter(p => {
    if (ctryF && PD.normCountry(p.country || "") !== ctryF) return false;
    const qq = q.trim().toLowerCase();
    if (!qq) return true;
    return (p.name + " " + p.code + " " + (p.itmref || "") + " " + (p.eccshoaxx || "") + " " + p.grade).toLowerCase().includes(qq);
  });
  const visible = list.slice(0, shown);
  useEffect(() => { setShown(200); }, [q, ctryF]);
  // Codes referenced by POs (deleting those is blocked). A PO carries its OWN price; the
  // price list only suggests one, so a price edit never touches PO values — but a code that
  // POs point at must stay in the list. Match on structure code first, then the commercial
  // name / product code.
  const usedNames = useMemo(() => {
    const s = new Set();
    const add = (v) => { const k = String(v == null ? "" : v).trim().toUpperCase(); if (k) s.add(k); };
    (pos || []).forEach(p => {
      add(p.commercial); add(p.structureCode); add(p.materialName);
      (p.items || []).forEach(it => { add(it.structureCode); add(it.sku); add(it.productCode); });
    });
    return s;
  }, [pos]);
  const codesOf = (p) => [p && p.eccshoaxx, p && p.name, p && p.code].map(v => String(v == null ? "" : v).trim().toUpperCase()).filter(Boolean);
  const usedCount = (p) => codesOf(p).some(c => usedNames.has(c)) ? 1 : 0;
  // The RAM window can miss older POs, so the delete dialog asks the server as well.
  const [delUse, setDelUse] = useState(null);
  useEffect(() => {
    if (!confirmDel) { setDelUse(null); return; }
    let on = true; setDelUse(null);
    const ram = usedCount(confirmDel);
    const codes = codesOf(confirmDel);
    Promise.all(codes.map(c => PD.SB.poCountForCode(c)))
      .then(ns => { if (!on) return; const known = ns.filter(n => n >= 0); setDelUse(known.length ? Math.max(ram, ...known) : ram); })
      .catch(() => { if (on) setDelUse(ram); });
    return () => { on = false; };
  }, [confirmDel]);
  // Parent reference = Product Code (Mã SP); children = commercial-name / structure variants.
  const groups = useMemo(() => {
    const m = {};
    list.forEach(p => { const code = (p.code || p.name || "—"); (m[code] = m[code] || []).push(p); });
    return Object.entries(m);
  }, [list]);
  const sort = useSort("code", "asc");
  const groupAccessors = {
    code: g => g[0],
    variants: g => g[1].length,
    grade: g => { const gr = [...new Set(g[1].map(p => p.grade).filter(Boolean))].sort(); return gr[0] || ""; },
    price: g => { const pr = g[1].map(p => p.price).filter(v => v); return pr.length ? Math.min(...pr) : null; },
  };
  const sortColumns = [
    { key: "code", label: t("pd_code") },
    { key: "variants", label: t("pd_variants") },
    { key: "grade", label: t("pd_grade") },
    { key: "price", label: t("li_price") },
  ];
  const visibleGroups = sort.apply(groups, groupAccessors).slice(0, shown);
  const colCount = (canDelete ? 1 : 0) + 9;

  return (
    <div className="page">
      <header className="page-head list-head">
        <div>
          <h1>{t("pd_title")}</h1>
          <p className="page-sub">{list.length} {t("pd_count")}</p>
        </div>
        <div className="head-actions">
          {canExport && canExport("products") && <ExportMenu name="products"
            all={products} filtered={list}
            map={p => {
              const area = (parseFloat(p.sqmPerRoll) || 0) > 0 ? parseFloat(p.sqmPerRoll) : ((parseFloat(p.width) || 0) / 1000) * (parseFloat(p.length) || 0);
              const rp = (parseFloat(p.price) || 0) * area;
              return {
                product_name: p.name,
                product_code: p.code,
                structure_code: p.eccshoaxx,
                itm_edp: p.itmref,
                grade: p.grade,
                product_type: p.productType,
                width_mm: p.width,
                length_m: p.length,
                sqm_per_roll: p.sqmPerRoll,
                moq: p.moq,
                country: p.country,
                unit_price_sqm: p.price,
                roll_price: rp ? Math.round(rp) : "",
                currency: p.currency || "VND",
              };
            }} />}
          {lvlOr("products", "admin", true) && <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("pd_import_excel")}</button>}
          {lvlOr("products", "edit", true) && <button className="btn btn-primary" onClick={() => setEditing("new")}><Icon d={ICONS.plus} size={15} /> {t("pd_new")}</button>}
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("pd_search")} />
        </div>
        <select className="select list-ccy" value={currency} onChange={e => pickCurrency(e.target.value)} title={t("qt_currency")}>
          {Object.keys(PD.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <SortMenu columns={sortColumns} sort={sort.sort} onSort={sort.onSort} />
      </div>

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={visibleGroups.flatMap(([, items]) => items.filter(p => usedCount(p) === 0).map(p => p.id))} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <SortTh label={t("pd_code")} sortKey="code" sort={sort.sort} onSort={sort.onSort} />
              <SortTh label={t("pd_variants")} sortKey="variants" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              <SortTh label={t("pd_grade")} sortKey="grade" sort={sort.sort} onSort={sort.onSort} />
              <th className="hide-sm">{t("pd_itmref")}</th>
              <th className="hide-sm">{t("pd_eccshoaxx")}</th>
              <SortTh label={t("li_price")} sortKey="price" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              <th className="hide-sm">{t("pd_roll_price")}</th>
              <th className="hide-sm">{t("pd_size")}</th>
              <th style={{ textAlign: "right" }}>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map(([code, items]) => {
              const isOpen = expanded.has(code);
              const grades = [...new Set(items.map(p => p.grade).filter(Boolean))];
              const itmrefs = [...new Set(items.map(p => p.itmref).filter(Boolean))];
              const dprices = items.map(p => toDisp(p.price, p.currency)).filter(v => v);
              const priceLabel = dprices.length ? (Math.min(...dprices) === Math.max(...dprices) ? fmtN(dprices[0]) : fmtN(Math.min(...dprices)) + "–" + fmtN(Math.max(...dprices))) : "";
              const delIds = items.filter(p => usedCount(p) === 0).map(p => p.id);
              return (
              <React.Fragment key={code}>
                <tr className={"ret-acc-row row-click" + (isOpen ? " open" : "")} onClick={() => toggleCode(code)}>
                  {canDelete && <td className="col-check" onClick={e => e.stopPropagation()}>{delIds.length ? <SelectAllCheck ids={delIds} selected={sel.selected} toggleAll={sel.toggleAll} /> : null}</td>}
                  <td>
                    <div className="ret-cust-cell">
                      <button className={"ret-exp-btn" + (isOpen ? " open" : "")} aria-label="expand" onClick={e => { e.stopPropagation(); toggleCode(code); }}>
                        <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                      </button>
                      <div>
                        <strong className="cell-main">{code}</strong>
                        <small className="cell-sub">{items.length} {t("pd_variants")}</small>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm"><span className="count-pill">{items.length}</span></td>
                  <td>{grades.length ? grades.map(g => <span key={g} className="tag" style={{ marginRight: 4 }}>{g}</span>) : "—"}</td>
                  <td className="hide-sm">{itmrefs.length === 1 ? itmrefs[0] : (itmrefs.length ? itmrefs.length + " " + t("pd_variants") : <span className="dim">—</span>)}</td>
                  <td className="hide-sm"><span className="dim">—</span></td>
                  <td className="hide-sm">{priceLabel ? <span>{priceLabel} <small className="dim">{currency}</small></span> : <span className="dim">—</span>}</td>
                  <td className="hide-sm"><span className="dim">—</span></td>
                  <td className="hide-sm"><span className="dim">—</span></td>
                  <td style={{ textAlign: "right" }}></td>
                </tr>
                {isOpen && items.map(p => (
                  <tr key={p.id} className={"nc-sub-row" + (sel.isSel(p.id) ? " row-selected" : "")}>
                    {canDelete && <td className="col-check">{usedCount(p) > 0 ? <input type="checkbox" className="row-check" disabled title={t("pd_in_use")} /> : <RowCheck id={p.id} selected={sel.selected} toggle={sel.toggle} />}</td>}
                    <td className="nc-sub-cell"><strong className="cell-main">{p.name}</strong>
                      <small className="cell-sub">{PD.normCountry(p.country || "") || "—"}{p.currency ? " · " + p.currency : ""}</small></td>
                    <td className="hide-sm"><span className="dim">{p.code || "—"}</span></td>
                    <td>{p.grade ? <span className="tag">{p.grade}</span> : "—"}
                      {p.productType && <small className="cell-sub">{p.productType}</small>}</td>
                    <td className="hide-sm">{p.itmref || <span className="dim">—</span>}</td>
                    <td className="hide-sm">{p.eccshoaxx || <span className="dim">—</span>}</td>
                    <td className="hide-sm">{p.price ? <span>{fmtPrice(p.price, p.currency)} <small className="dim">{currency}</small>
                      {(p.currency || "VND") !== currency && <small className="cell-sub">{t("pd_as_entered")}: {fmtAsEntered(p.price)} {p.currency || "VND"}</small>}</span> : <span className="dim">—</span>}</td>
                    <td className="hide-sm">{(() => { const a = (parseFloat(p.sqmPerRoll) || 0) > 0 ? parseFloat(p.sqmPerRoll) : ((parseFloat(p.width) || 0) / 1000) * (parseFloat(p.length) || 0); const rp = (parseFloat(p.price) || 0) * a; return rp > 0 ? <span>{fmtPrice(rp, p.currency)} <small className="dim">{currency}</small></span> : <span className="dim">—</span>; })()}</td>
                    <td className="hide-sm">{p.width && p.length ? `${p.width}×${p.length}` : <span className="dim">—</span>}
                      {p.sqmPerRoll !== "" && p.sqmPerRoll !== undefined && <small className="cell-sub">{p.sqmPerRoll} sqm{p.moq ? " · MOQ " + PD.fmtNum(p.moq) : ""}</small>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {lvlOr("products", "edit", true) && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p.id)}>{t("pd_edit")}</button>}{" "}
                      {lvlOr("products", "admin", true) && <button className="btn btn-danger btn-sm" disabled={usedCount(p) > 0} title={usedCount(p) > 0 ? t("pd_in_use") : ""}
                        onClick={() => setConfirmDel(p)}>{t("pd_delete")}</button>}
                      {usedCount(p) > 0 && <small className="pd-locked">{t("pd_in_use")}</small>}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
              );
            })}
            {groups.length === 0 && <tr><td colSpan={colCount} className="empty">—</td></tr>}
          </tbody>
        </table>
        {groups.length > shown && (
          <div className="pager">
            <span>{visibleGroups.length} / {groups.length}</span>
            <div className="pager-btns">
              <button className="btn btn-ghost" onClick={() => setShown(s => s + 400)}>…</button>
            </div>
          </div>
        )}
      </div>

      {canDelete && <BulkBar count={sel.count} noun={t("pd_count")} allIds={list.filter(p => usedCount(p) === 0).map(p => p.id)} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={() => crmConfirm(t("bulk_confirm"), () => { deleteProducts([...sel.selected]); sel.clear(); })} onClear={sel.clear} />}

      {editing && <ProductFormModal id={editing === "new" ? null : editing} grades={grades} onClose={() => setEditing(null)} />}
      {importing && <GenericImportModal titleKey="pd_import_excel" hintKey="pd_import_hint" templateName="products" defaultCountry={productCountry || undefined} createdKey="pd_import_newadded" storeAsEntered
        fields={[
          { key: "name", labelKey: "pd_name", required: true, re: /product\s*name|commercial|t\u00ean sp|t\u00ean s\u1ea3n|^name|^t\u00ean/i, ex: ["TDW108", "TDR380"] },
          { key: "code", labelKey: "pd_code", re: /product\s*code|m\u00e3 sp|^m\u00e3 s|^code$|^m\u00e3$|item/i, ex: ["TDW108", "TDR380"] },
          { key: "itmref", labelKey: "pd_itmref", re: /itm|edp|itmref/i, ex: ["80900025", ""] },
          { key: "eccshoaxx", labelKey: "pd_eccshoaxx", re: /ecc|structure|config\s*name|c\u1ea5u tr\u00fac|m\u00e3 c\u1ea5u/i, ex: ["", ""] },
          { key: "grade", labelKey: "pd_grade", re: /grade|ink|lo\u1ea1i m\u1ef1c|^lo\u1ea1i/i, ex: ["Wax", "Resin"] },
          { key: "productType", labelKey: "pd_product_type", re: /product\s*type|^fr$|^jr$|lo\u1ea1i sp/i, ex: ["FR", "JR"] },
          { key: "width", labelKey: "pd_width", re: /width|kh\u1ed5|r\u1ed9ng/i, ex: ["110", "90"] },
          { key: "length", labelKey: "pd_length", re: /length|d\u00e0i|\u0111\u1ed9 d\u00e0i/i, ex: ["300", "300"] },
          { key: "moq", labelKey: "pd_moq", re: /moq|s\u1ed1 l\u01b0\u1ee3ng|min.*(qty|order)|^roll/i, ex: ["", ""] },
          { key: "country", labelKey: "country", re: /country|qu\u1ed1c gia|\u0e1b\u0e23\u0e30\u0e40\u0e17\u0e28/i, ex: ["Vietnam", "Thailand"] },
          { key: "price", labelKey: "li_price", money: true, re: /unit\s*price|price|gi\u00e1|\u0111\u01a1n gi\u00e1/i, ex: ["", ""] },
        ]}
        onClose={() => setImporting(false)}
        onImport={(items, { cur, country }) => {
          // Build the full next list in ONE pass, then commit once. (Calling
          // addProduct/updateProductItem in a loop reads a stale `products` each
          // time, so only the last write survives \u2014 that's the "only 4 imported" bug.)
          const norm = (s) => String(s == null ? "" : s).trim();
          const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isNaN(n) ? "" : n; };
          // Country is REQUIRED: a row without one falls back to the country chosen in this
          // dialog, never to "All" — an "All" code would sell at one price in both markets.
          const fixCountry = (c) => { const n = PD.normCountry(c); return PD.MARKETS.includes(n) ? n : (PD.normCountry(country) || PD.MARKETS[0]); };
          // identity = country + ITM code + structure code + MOQ, so the SAME code imported for
          // Vietnam and for Thailand becomes two records with two prices instead of overwriting.
          // The structure code is NORMALISED first: successive exports of the same list write it
          // as "TDR345.910", then "TDR345.910_1" (the MOQ tier glued on), and the code column as
          // "TDR345" then "TDR345.910". Keying on the raw text made every re-import a brand-new
          // row — that is how one Thai JR tier came to be stored four times, each copy carrying a
          // different currency label over the very same number.
          const normEcc = (v) => String(v == null ? "" : v).trim().toUpperCase().replace(/[_-]\d+(\.\d+)?$/, "");
          const keyOf = (itm, ecc, code, name, moq, ctry) => (ctry || "").toUpperCase() + "|" + String(itm || PD.baseCode(code || name) || "").toUpperCase() + "|" + normEcc(ecc || code || name) + "|" + (moq === "" || moq == null ? "" : moq);
          // Rows that land on the same key are one price row stored twice. Keep the richest copy
          // (has a size, then has a price, then newest) and TOMBSTONE the others — dropping them
          // silently would only let the server hand them back on the next sync.
          const rank = (p) => ((parseFloat(p.sqmPerRoll) || 0) > 0 ? 4 : 0) + ((parseFloat(p.price) || 0) > 0 ? 2 : 0) + (p._updated ? 1 : 0);
          const map = new Map(); const dropped = [];
          products.forEach(p => {
            const k = keyOf(norm(p.itmref), norm(p.eccshoaxx), norm(p.code), norm(p.name), p.moq == null ? "" : p.moq, fixCountry(p.country));
            const prev = map.get(k);
            if (!prev) { map.set(k, p); return; }
            const keep = (rank(p) > rank(prev) || (rank(p) === rank(prev) && String(p._updated || "") >= String(prev._updated || ""))) ? p : prev;
            map.set(k, keep); dropped.push(keep === p ? prev : p);
          });
          let added = 0, updated = 0; const issues = [];
          items.forEach((it, i) => {
            const name = norm(it.name), code = norm(it.code || it.name);
            const itm = norm(it.itmref), ecc = norm(it.eccshoaxx);
            if (!name && !code && !itm) { issues.push({ row: it._row, reason: t("im_iss_nokey") }); return; }
            const width = it.width === "" ? "" : (num(it.width) || 0);
            const length = it.length === "" ? "" : (num(it.length) || 0);
            const moq = num(it.moq);
            const data = {
              name: name || code, code: code || name, grade: norm(it.grade),
              productType: norm(it.productType), country: fixCountry(it.country),
              itmref: itm, eccshoaxx: ecc, moq,
              width, length, sqmPerRoll: (width && length) ? Math.round((width / 1000 * length) * 100) / 100 : "",
            };
            // The currency is the one named in the import dialog for EVERY row of the file. It
            // used to be overridden by the row's country, which stamped THB on a price list
            // quoted in USD and left the number untouched — a relabel, not a conversion.
            if (it.price !== "" && it.price != null) { data.price = num(it.price) || 0; data.currency = cur || PD.ccyOfCountry(data.country); }
            const k = keyOf(itm, ecc, code, name, moq, data.country);
            const existing = map.get(k);
            if (existing) { map.set(k, { ...existing, ...data }); updated++; }
            else { map.set(k, { id: "PRD" + Date.now().toString(36).toUpperCase() + i.toString(36), ...data }); added++; }
          });
          const now = new Date().toISOString();
          replaceProducts([...map.values(), ...dropped.map(p => ({ ...p, _deleted: true, _updated: now }))]);
          return { imported: added + updated, created: added, skipped: issues.length, issues, warn: dropped.length ? t("pd_import_collapsed").replace("{n}", PD.fmtNum(dropped.length)) : "" };
        }} />}
      {confirmDel && (
        <Modal title={t("pd_delete")} onClose={() => setConfirmDel(null)} width={400}>
          <p style={{ margin: "4px 0 0" }}>{t("pd_delete_confirm")}</p>
          <p className="status-hint"><strong>{confirmDel.name}</strong>{confirmDel.eccshoaxx ? " · " + confirmDel.eccshoaxx : ""}</p>
          {delUse === null ? <p className="status-hint">{t("pd_del_checking")}</p> : null}
          {delUse > 0 ? <p className="import-warn">{t("pd_del_blocked").replace("{n}", PD.fmtNum(delUse))}</p> : null}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>{t("cancel")}</button>
            <button className="btn btn-danger" disabled={delUse === null || delUse > 0} onClick={() => { deleteProduct(confirmDel.id); setConfirmDel(null); }}>{t("pd_delete")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProductFormModal({ id, grades, onClose }) {
  const { t, products, addProduct, updateProductItem, productCountry } = useApp();
  const existing = id ? products.find(p => p.id === id) : null;
  const MK = PD.MARKETS;
  const defCountry = (MK.includes(PD.normCountry(productCountry || "")) ? PD.normCountry(productCountry) : MK[0]);
  const [f, setF] = useState(existing ? {
    country: defCountry, itmref: "", eccshoaxx: "", productType: "FR", width: "", length: "", sqmPerRoll: "", price: "", currency: PD.ccyOfCountry(defCountry), ...existing,
    country: MK.includes(PD.normCountry(existing.country || "")) ? PD.normCountry(existing.country) : defCountry,
  } : {
    name: "", code: "", grade: "Wax", country: defCountry,
    itmref: "", eccshoaxx: "", productType: "FR", width: "", length: "", sqmPerRoll: "", price: "", currency: PD.ccyOfCountry(defCountry),
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  // Switching market switches the price list, so the currency follows the country.
  const setCountry = (v) => setF(prev => ({ ...prev, country: v, currency: PD.ccyOfCountry(v) }));
  // A commercial name is shared across structure/price-tier variants (and the data
  // even has exact name+structure repeats), so only WARN on create; never block
  // editing an existing record — otherwise its unit price can't be saved.
  const dup = !existing && products.some(p => p.id !== id
    && PD.normCountry(p.country || "") === PD.normCountry(f.country || "")
    && p.name.trim().toLowerCase() === f.name.trim().toLowerCase()
    && String(p.eccshoaxx || "").trim().toLowerCase() === String(f.eccshoaxx || "").trim().toLowerCase());
  const valid = f.name.trim().length >= 2 && !dup;
  const rpArea = (parseFloat(f.sqmPerRoll) || 0) > 0 ? parseFloat(f.sqmPerRoll) : ((parseFloat(f.width) || 0) / 1000) * (parseFloat(f.length) || 0);
  const rollPrice = ((parseFloat(f.price) || 0) > 0 && rpArea > 0) ? Math.round((parseFloat(f.price) || 0) * rpArea) : 0;

  // auto-compute sqm/roll from width × length (mm × m -> sqm/roll, consistent with PO sqm formula)
  useEffect(() => {
    const w = parseFloat(f.width), l = parseFloat(f.length);
    if (w > 0 && l > 0) set("sqmPerRoll", Math.round((w / 1000 * l) * 100) / 100);
  }, [f.width, f.length]);

  const submit = () => {
    if (!valid) return;
    const data = {
      name: f.name.trim(), code: f.code.trim(), grade: f.grade.trim(), country: f.country || defCountry,
      itmref: (f.itmref || "").toString().trim(), eccshoaxx: (f.eccshoaxx || "").trim(),
      productType: f.productType || "", width: f.width === "" ? "" : parseFloat(f.width) || 0,
      length: f.length === "" ? "" : parseFloat(f.length) || 0,
      sqmPerRoll: f.sqmPerRoll === "" ? "" : parseFloat(f.sqmPerRoll) || 0,
      price: (f.price === "" || f.price == null) ? "" : parseFloat(f.price) || 0,
      currency: f.currency || PD.ccyOfCountry(f.country),
    };
    if (existing) updateProductItem(id, data); else addProduct(data);
    onClose();
  };
  return (
    <Modal title={existing ? t("pd_edit") + " · " + existing.name : t("pd_new")} onClose={onClose} width={560}>
      <div className="form-grid">
        <Field label={t("pd_name")} required>
          <input className={"input" + (dup ? " invalid" : "")} value={f.name} onChange={e => set("name", e.target.value)} placeholder="TDW121" autoFocus />
          {dup && <small className="field-err">{t("pd_exists")}</small>}
        </Field>
        <Field label={t("pd_code")}>
          <input className="input" value={f.code} onChange={e => set("code", e.target.value)} placeholder="TDW121" />
        </Field>
        <Field label={t("pd_grade")}>
          <input className="input" list="dl-grades" value={f.grade} onChange={e => set("grade", e.target.value)} />
          <datalist id="dl-grades">{grades.map(g => <option key={g} value={g}></option>)}</datalist>
        </Field>
        <Field label={t("country")} required>
          <select className="select" value={f.country} onChange={e => setCountry(e.target.value)}>
            {MK.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <small className="status-hint">{t("pd_country_note")}</small>
        </Field>
        <Field label={t("pd_itmref")}>
          <input className="input" value={f.itmref} onChange={e => set("itmref", e.target.value)} placeholder="80900025" />
          <small className="status-hint">{t("pd_itmref_note")}</small>
        </Field>
        <Field label={t("pd_product_type")}>
          <select className="select" value={f.productType} onChange={e => set("productType", e.target.value)}>
            <option value="">—</option>
            <option value="FR">FR</option>
            <option value="JR">JR</option>
          </select>
        </Field>
        <Field label={t("pd_eccshoaxx")}>
          <input className="input" value={f.eccshoaxx} onChange={e => set("eccshoaxx", e.target.value)} placeholder="110.DBOK1Z1.0303.8.T24" />
        </Field>
        <Field label={t("pd_width")}>
          <input className="input" type="number" value={f.width} onChange={e => set("width", e.target.value)} placeholder="110" />
        </Field>
        <Field label={t("pd_length")}>
          <input className="input" type="number" value={f.length} onChange={e => set("length", e.target.value)} placeholder="300" />
        </Field>
        <Field label={t("pd_sqm_roll")}>
          <input className="input" type="number" value={f.sqmPerRoll} onChange={e => set("sqmPerRoll", e.target.value)} />
          <small className="status-hint">{t("pd_sqm_auto")}</small>
        </Field>
        <Field label={t("li_price")}>
          <input className="input" type="number" value={f.price ?? ""} onChange={e => set("price", e.target.value)} placeholder="4284" />
          <small className="status-hint">{t("pd_price_note")}</small>
          <small className="status-hint">{t("pd_price_ref")}</small>
        </Field>
        <Field label={t("qt_currency")}>
          <select className="select" value={f.currency || "VND"} onChange={e => set("currency", e.target.value)}>
            {["VND", "THB", "USD"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t("pd_roll_price")}>
          <input className="input" type="number" value={rollPrice || ""} readOnly tabIndex={-1} style={{ background: "var(--surface-2, #f4f6f8)" }} />
          <small className="status-hint">{t("pd_roll_price_note")}</small>
        </Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t("save")}</button>
      </div>
    </Modal>
  );
}

function ProductImportModal({ onClose }) {
  const { t, products, addProduct, updateProductItem } = useApp();
  const [report, setReport] = useState(null);
  const [book, setBook] = useState(null);
  const [fileName, setFileName] = useState("");

  const processRows = (rows) => {
      if (rows.length < 2) { setReport({ count: 0, error: true }); return; }
      const headers = rows[0].map(h => h.trim().toLowerCase());
      const iCode = headers.findIndex(h => /code|mã sp|mã\s*sản phẩm/.test(h));
      const iName = headers.findIndex(h => /name|tên|commercial/.test(h));
      const iGrade = headers.findIndex(h => /grade/.test(h));
      const iType = headers.findIndex(h => /type|loại/.test(h));
      const iWidth = headers.findIndex(h => /width|khổ/.test(h));
      const iLength = headers.findIndex(h => /length|dài/.test(h));
      const iCountry = headers.findIndex(h => /country|quốc gia/.test(h));
      if (iCode < 0 && iName < 0) { setReport({ count: 0, error: true }); return; }
      let added = 0, updated = 0;
      rows.slice(1).forEach(r => {
        const code = iCode >= 0 ? (r[iCode] || "").trim() : "";
        const name = iName >= 0 ? (r[iName] || "").trim() : code;
        if (!code && !name) return;
        const width = iWidth >= 0 ? parseFloat(r[iWidth]) || "" : "";
        const length = iLength >= 0 ? parseFloat(r[iLength]) || "" : "";
        const data = {
          name: name || code, code: code || name,
          grade: iGrade >= 0 ? (r[iGrade] || "").trim() : "",
          productType: iType >= 0 ? (r[iType] || "").trim() : "",
          country: PD.MARKETS.includes(PD.normCountry(iCountry >= 0 ? r[iCountry] : "")) ? PD.normCountry(r[iCountry]) : PD.MARKETS[0],
          width, length,
          sqmPerRoll: (width && length) ? Math.round((width / 1000 * length) * 100) / 100 : "",
        };
        // upsert by Product Code WITHIN the same market (the same code in another market is
        // a different price list, so it must never be overwritten by this one)
        const existing = products.find(p => p.code && code && p.code.toLowerCase() === code.toLowerCase() && PD.normCountry(p.country || "") === data.country);
        if (existing) { updateProductItem(existing.id, data); updated++; }
        else { addProduct(data); added++; }
      });
      setReport({ added, updated });
  };

  const onFile = (file) => {
    setFileName(file.name);
    PD.readImportFile(file).then(({ sheets }) => {
      if (!sheets.length) { setReport({ count: 0, error: true }); return; }
      if (sheets.length > 1) setBook({ sheets });
      else processRows(sheets[0].rows);
    }).catch(() => setReport({ count: 0, error: true }));
  };

  return (
    <Modal title={t("pd_import_excel")} onClose={onClose} width={480}>
      {report ? (
        <div className="import-report">
          <div className="import-report-icon">{report.error ? "!" : "✓"}</div>
          <h3>{report.error ? t("im_need_name") : t("im_done")}</h3>
          {!report.error && (
            <p>
              <strong>{report.added}</strong> {t("pd_import_added")} · <strong>{report.updated}</strong> {t("pd_import_upserted")}
            </p>
          )}
          <div className="modal-actions" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      ) : book ? (
        <ImportSheetPicker t={t} fileName={fileName} sheets={book.sheets}
          onPick={i => { setBook(null); processRows(book.sheets[i].rows); }} onReplace={() => { setBook(null); setFileName(""); }} />
      ) : (
        <div>
          <p className="import-note">{t("pd_import_hint")}</p>
          <label className="import-drop">
            <Icon d={ICONS.upload} size={26} />
            <strong>{t("im_pick")}</strong>
            <small>{t("im_header_note")}</small>
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" hidden onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      )}
    </Modal>
  );
}

window.ProductsPage = ProductsPage;
