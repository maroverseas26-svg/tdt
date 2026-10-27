// Todaytec CRM — Quotations module (MODULE B: Quotation negotiation tracking)
const QT = window.CRM;

// Limit a PIC list to reps assigned to the record's country (falls back to the full
// list when none match / country unknown); always keeps the current value.
function picScope(list, country, _rc, current) {
  const arr = list || [];
  const keep = arr.filter(o => o.global || !country || !o.country || o.country === country);
  const codes = [...new Set((keep.length ? keep : arr).map(o => o.code))];
  return (current && !codes.includes(current)) ? [current, ...codes] : codes;
}

function QuoteStatusBadge({ status, t }) {
  const color = QT.QUOTE_STATUS_COLORS[status] || "#94A3B8";
  return (
    <span className="badge" style={{ color, background: color + "1A", borderColor: color + "40" }}>
      <span className="badge-dot" style={{ background: color }}></span>
      {t("qt_status_" + status) || status}
    </span>
  );
}

function quoteTotal(q) {
  return (q.items || []).reduce((s, it) => s + lineValueEff(it), 0);
}
// Quote lines are STORED in the currency they were priced in and never converted on save,
// so any list that shows one column for many quotes has to normalise them first — otherwise
// a THB quote's raw figure is printed under a VND heading. fmtMoney / fmtMoneyFull take
// canonical VND and do the display conversion themselves, so quoteTotalVnd is what they
// want; quoteTotalIn is only for an export column that names its own unit.
function qtConv(v, from, to) {
  const R = QT.CURRENCIES || {};
  if (!v || !from || !to || from === to) return v || 0;
  const rf = (R[from] && R[from].rate) || 1, rt = (R[to] && R[to].rate) || 1;
  return v * rf / rt;
}
function quoteTotalVnd(q) {
  return (q.items || []).reduce((s, it) => s + qtConv(lineValueEff(it), it.currency || "VND", "VND"), 0);
}
function quoteTotalIn(q, cur) {
  return (q.items || []).reduce((s, it) => s + qtConv(lineValueEff(it), it.currency || cur, cur), 0);
}

function QuotationsPage({ openCustomer, openProject, openPOFromQuote, selected, setSelected }) {
  const { t, quotations, customers, scopeCustomers, projects, users, money, currency, setCurrency, canExport, canEdit, canDelete: canDeletePerm, lvlOr, deleteQuotations, addQuotationsBulk, picFilterCodes } = useApp();
  const [q, setQ] = useState("");
  const sel = useRowSelection();
  const grp = useGroupToggle();
  const canDelete = !!(canDeletePerm && canDeletePerm("quotations"));
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const qtCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setQtCountries = () => {};
  // One market on the topbar → that market's own currency (every market, not just VN/TH).
  // "All" / several markets have no single unit, so figures are shown in USD.
  useEffect(() => {
    const one = qtCountries.length === 1 ? qtCountries[0] : "";
    const ccy = (one && QT.ccyOfCountry ? QT.ccyOfCountry(one) : "") || "USD";
    if (ccy && ccy !== currency) setCurrency(ccy);
  }, [qtCountries]);
  const [creating, setCreating] = useState(false);
  const [localDetail, setLocalDetail] = useState(null);
  // Driven by the app shell when given (deep link from a customer profile), else local.
  const detail = setSelected ? selected : localDetail;
  const setDetail = setSelected || setLocalDetail;
  const [picF, setPicF] = useState("");

  if (creating) return <QuotationFormModal asPage onClose={() => setCreating(false)} />;
  if (detail) return <QuotationDetailPage id={detail} onBack={() => setDetail(null)} openCustomer={openCustomer} openProject={openProject} openPOFromQuote={openPOFromQuote} />;

  const qtCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const allCountries = [...new Set(scopeCustomers.map(c => window.CRM.normCountry(c.country)))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => qtCountryRank(a) - qtCountryRank(b));
  const allowC = (cn) => qtCountries.length === 0 || qtCountries.includes(cn);
  const countryOfCust = (id) => { const c = customers.find(x => x.id === id); return c ? window.CRM.normCountry(c.country) : ""; };
  const scopeCustIds = new Set(scopeCustomers.map(c => c.id));
  const scoped = quotations.filter(x => scopeCustIds.has(x.customerId) && allowC(countryOfCust(x.customerId)));
  const pics = [...new Set([...(picFilterCodes || []), ...scoped.map(x => (x.pic || "").trim().toUpperCase())].filter(Boolean))].sort();

  const custName = (id) => {
    const c = customers.find(x => x.id === id);
    return c ? (c.shortName || c.name) : "—";
  };
  const projName = (id) => {
    const p = projects.find(x => x.id === id);
    return p ? p.name : "";
  };

  const list = scoped.filter(x => {
    if (status && x.status !== status) return false;
    if (picF && (x.pic || "").trim().toUpperCase() !== picF) return false;
    const qq = q.trim().toLowerCase();
    if (qq) {
      const hay = (x.id + " " + custName(x.customerId)).toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  }).sort((a, b) => (b.quoteDate || "").localeCompare(a.quoteDate || ""));

  const statusCounts = {};
  QT.QUOTE_STATUSES.forEach(s => statusCounts[s] = scoped.filter(x => x.status === s).length);
  const openValue = scoped.filter(x => x.status !== "Won" && x.status !== "Lost").reduce((s, x) => s + quoteTotalVnd(x), 0);

  return (
    <div className="page">
      <header className="page-head list-head">
        <div>
          <h1>{t("qt_title")}</h1>
          <p className="page-sub">{list.length} {t("qt_count")} · {money(openValue)}</p>
        </div>
        <div className="head-actions">
          {canExport && canExport("quotations") && <ExportMenu name="quotations"
            all={scoped} filtered={list}
            map={q => {
              const c = customers.find(x => x.id === q.customerId) || {};
              const p = projName(q.projectId);
              const items = q.items || [];
              const cur = (items[0] && items[0].currency) || currency;
              const lineItems = items.map(it =>
                `${it.structureCode || it.productCode} (qty ${it.qty} @ roll ${QT.fmtNum(Math.round(lineEffUnitPrice(it)))} = ${lineValueEff(it)} ${it.currency || cur})`
              ).join(" | ");
              const codes = items.map(it => it.structureCode || it.productCode).filter(Boolean);
              return {
                quotation_id: q.id,
                customer: c.name,
                customer_short: c.shortName,
                country: c.country,
                linked_project: p,
                quote_date: q.quoteDate,
                valid_until: q.validUntil,
                revision: "#" + (q.revisionNo || 1),
                status: q.status,
                payment_terms: q.paymentTerms,
                approved_by: q.approvedBy,
                currency: cur,
                structure_codes: codes.join(" | "),
                total_value: quoteTotal(q),
                total_value_in: Math.round(quoteTotalIn(q, currency)),
                total_value_in_currency: currency,
                item_count: items.length,
                line_items: lineItems,
              };
            }} />}
          {lvlOr("quotations", "admin", true) && <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("pol_import_excel")}</button>}
          {lvlOr("quotations", "edit", true) && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon d={ICONS.plus} size={15} /> {t("qt_new")}</button>}
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("cu_company") + " / " + t("qt_no") + "…"} />
        </div>
        <FilterSelect value={picF} onChange={setPicF} options={pics} allLabel={t("pol_pic") + ": " + t("all")} />
        <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t("qt_status")}: {t("all")}</option>
          {QT.QUOTE_STATUSES.map(s => <option key={s} value={s}>{t("qt_status_" + s)}</option>)}
        </select>
        <select className="select list-ccy" value={currency} onChange={e => setCurrency(e.target.value)}>
          {Object.keys(QT.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="kpi-row kpi-row-5">
        {QT.QUOTE_STATUSES.map(s => (
          <div className="kpi" key={s}>
            <span className="kpi-label">{t("qt_status_" + s)}</span>
            <span className="kpi-value" style={{ color: QT.QUOTE_STATUS_COLORS[s] }}>{statusCounts[s]}</span>
          </div>
        ))}
      </div>

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={list.map(x => x.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <th>{t("qt_customer")}</th>
              <th>{t("qt_no")}</th>
              <th className="hide-sm">{t("qt_date")}</th>
              <th className="hide-sm">{t("qt_valid_until")}</th>
              <th>{t("qt_status")}</th>
              <th className="cell-money pr-value-col">{t("qt_total")} ({currency})</th>
              <th className="hide-sm">{t("qt_revision")}</th>
              <th className="hide-sm">{t("pol_pic")}</th>
            </tr>
          </thead>
          <tbody>
            {groupByCompany(list, x => x.customerId, customers).map(({ key, repCustomerId, companyCount, items }) => {
              const renderRow = (x, child) => (
                <tr key={x.id} className={(child ? "grp-child " : "") + "row-click" + (sel.isSel(x.id) ? " row-selected" : "")} onClick={() => setDetail(x.id)}>
                  {canDelete && <td className="col-check"><RowCheck id={x.id} selected={sel.selected} toggle={sel.toggle} /></td>}
                  <td><button className="link-btn pr-cust-link" onClick={e => { e.stopPropagation(); setDetail(x.id); }}>{custName(x.customerId)}</button></td>
                  <td><strong className="cell-main">{x.id}</strong>
                    {x.projectId && <small className="cell-sub">{projName(x.projectId)}</small>}</td>
                  <td className="hide-sm">{QT.fmtDate(x.quoteDate)}</td>
                  <td className="hide-sm">{QT.fmtDate(x.validUntil)}</td>
                  <td><QuoteStatusBadge status={x.status} t={t} /></td>
                  <td className="cell-money pr-value-col">{QT.fmtMoneyFull(quoteTotalVnd(x), currency)}</td>
                  <td className="hide-sm">#{x.revisionNo || 1}</td>
                  <td className="hide-sm">{x.pic ? <OwnerChip code={x.pic} t={t} /> : <span className="dim">—</span>}</td>
                </tr>
              );
              if (items.length === 1) return renderRow(items[0], false);
              const open = grp.isOpen(key);
              const groupTotal = items.reduce((s, x) => s + (quoteTotalVnd(x) || 0), 0);
              const gCust = customers.find(c => c.id === repCustomerId);
              const grpCode = companyCount === 1 && gCust && gCust.bizId ? gCust.bizId : "";
              const grpDate = items.reduce((mx, x) => (x.quoteDate && x.quoteDate > mx ? x.quoteDate : mx), "");
              return (
                <React.Fragment key={"g-" + key}>
                  <tr className={"grp-row row-click" + (open ? " open" : "")} onClick={() => grp.toggle(key)}>
                    {canDelete && <td className="col-check"><SelectAllCheck ids={items.map(x => x.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></td>}
                    <td>
                      <div className="ret-cust-cell">
                        <button className={"ret-exp-btn" + (open ? " open" : "")} aria-label="expand" onClick={e => { e.stopPropagation(); grp.toggle(key); }}>
                          <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                        </button>
                        <div>
                          <strong className="cell-main">{custName(repCustomerId)}{companyCount > 1 && <span className="nc-chip" style={{ marginLeft: 6 }}>{companyCount} {t("nc_companies")}</span>}</strong>
                          <div className="ret-cust-tags"><span className="ret-cust-meta">{items.length} {t("nav_quotations").toLowerCase()}{grpDate ? " · " + QT.fmtDate(grpDate) : ""}{grpCode ? " · " + grpCode : ""}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="dim"></td>
                    <td className="hide-sm"></td>
                    <td className="hide-sm"></td>
                    <td></td>
                    <td className="cell-money pr-value-col">{QT.fmtMoneyFull(groupTotal, currency)}</td>
                    <td className="hide-sm"></td>
                    <td className="hide-sm"></td>
                  </tr>
                  {open && items.map(x => renderRow(x, true))}
                </React.Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={canDelete ? 9 : 8} className="empty">{t("qt_no_quotes")}</td></tr>}
          </tbody>
        </table>
      </div>

      {canDelete && <BulkBar count={sel.count} noun={t("nav_quotations")} allIds={list.map(x => x.id)} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={() => crmConfirm(t("bulk_confirm"), () => { deleteQuotations([...sel.selected]); sel.clear(); })} onClear={sel.clear} />}

      {creating && false && <QuotationFormModal onClose={() => setCreating(false)} />}
      {importing && <GenericImportModal titleKey="qt_import_title" hintKey="qt_import_hint" templateName="quotations" fields={QUOTE_IMPORT_FIELDS} storeAsEntered
        onClose={() => setImporting(false)}
        onImport={(items, { cur }) => {
          const num = (v) => parseFloat(String(v || "").replace(/[^\d.-]/g, "")) || 0;
          const issues = [];
          const parsed = items.map(it => {
            if (!it.customer || !it.productCode || !(num(it.qty) > 0) || !(num(it.unitPrice) > 0)) {
              const reason = !it.customer ? t("im_iss_missing").replace("{f}", t("qt_customer"))
                : !it.productCode ? t("im_iss_missing").replace("{f}", t("qt_product_code"))
                : t("im_iss_badnum");
              issues.push({ row: it._row, reason }); return null;
            }
            return {
              customerName: it.customer, country: it.country, pic: it.pic, quoteNo: it.quoteNo,
              productCode: it.productCode, structureCode: it.structureCode || "", width: num(it.width), length: num(it.length),
              qty: num(it.qty), unitPrice: num(it.unitPrice), currency: cur,
              status: it.status, paymentTerms: it.paymentTerms,
              quoteDate: QT.toISO(it.quoteDate) || "", validUntil: QT.toISO(it.validUntil) || "",
            };
          }).filter(Boolean);
          const res = addQuotationsBulk(parsed);
          return { imported: res.imported, created: res.created, skipped: issues.length, issues };
        }} />}
    </div>
  );
}

const QUOTE_IMPORT_FIELDS = [
  { key: "customer", labelKey: "qt_customer", required: true, re: /customer|company|kh\u00e1ch|t\u00ean kh/i, ex: ["ABC Label Co.", "XYZ Printing"] },
  { key: "quoteNo", labelKey: "qt_no", re: /quote\s*(no|number|#)|s\u1ed1\s*b\u00e1o\s*gi\u00e1|qt-/i, ex: ["", ""] },
  { key: "productCode", labelKey: "qt_product_code", required: true, re: /product\s*code|product|m\u00e3\s*(h\u00e0ng|sp)/i, ex: ["TT-WR300", "TT-RES080"] },
  { key: "structureCode", labelKey: "pol_structure", re: /structure|ecc|struct|c\u1ea5u/i, ex: ["TDM206.110x300_50", ""] },
  { key: "qty", labelKey: "qt_qty", required: true, re: /qty|quantity|s\u1ed1\s*l\u01b0\u1ee3ng|sl\b/i, ex: ["500", "200"] },
  { key: "unitPrice", labelKey: "li_price", money: true, required: true, re: /unit\s*price|\u0111\u01a1n\s*gi\u00e1|price/i, ex: ["4284", "5100"] },
  { key: "width", labelKey: "qt_width", re: /width|kh\u1ed5|r\u1ed9ng/i, ex: ["110", "60"] },
  { key: "length", labelKey: "qt_length", re: /length|d\u00e0i/i, ex: ["300", "300"] },
  { key: "status", labelKey: "qt_status", re: /status|tr\u1ea1ng\s*th\u00e1i/i, ex: ["Draft", "Sent"] },
  { key: "paymentTerms", labelKey: "qt_payment_terms", re: /payment|thanh\s*to\u00e1n|terms/i, ex: ["T/T 30 days", "COD"] },
  { key: "quoteDate", labelKey: "qt_date", re: /quote\s*date|^date|ng\u00e0y\s*b\u00e1o|ng\u00e0y$/i, ex: ["2026-06-01", "2026-06-03"] },
  { key: "validUntil", labelKey: "qt_valid_until", re: /valid|hi\u1ec7u\s*l\u1ef1c|\u0111\u1ebfn\s*ng\u00e0y/i, ex: ["2026-07-01", "2026-07-03"] },
  { key: "pic", labelKey: "pol_pic", re: /pic|sale|rep|ph\u1ee5\s*tr\u00e1ch/i, ex: ["NOOM", "ICE"] },
];

function QuoteItemRow({ item, onChange, onRemove, t, products: allProducts, country }) {
  // Same rule as everywhere else: a quote prices from ONE market's list.
  const { productCountry } = useApp();
  const products = React.useMemo(() => catalogueFor(allProducts, country || productCountry), [allProducts, country, productCountry]);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const width = parseFloat(item.width) || 0;
  const length = parseFloat(item.length) || 0;
  const qty = parseFloat(item.qty) || 0;
  const unitPrice = parseFloat(item.unitPrice) || 0;
  const sqmPerUnit = (width / 1000) * length;
  const totalSqm = sqmPerUnit * qty;
  const effUnit = lineEffUnitPrice(item);   // roll price = unit price × area per roll
  const tierQty = lineTierQty(item);
  const unitPricePerSqm = sqmPerUnit > 0 ? effUnit / sqmPerUnit : 0;
  const totalValue = lineValueEff(item);
  return (
    <div className="qt-item-block">
      <div className="qt-item-row">
        <CodeCombo products={products} value={item.productCode || (item.productId ? pcOf(products.find(p => p.id === item.productId) || {}) : "")}
          placeholder={t("qt_product_code")}
          onPick={(code, vs) => {
            const grades = [...new Set(vs.map(v => v.grade).filter(Boolean))];
            const types = [...new Set(vs.map(v => v.productType).filter(Boolean))];
            let next = { ...item, productCode: code, grade: grades[0] || "", productType: types[0] || "FR", structureCode: "", productId: "", edpCode: "", width: "", length: "" };
            if (vs.length === 1) { const sf = structFields(vs[0]); next = { ...next, ...sf, unitPrice: sf.price !== "" ? sf.price : item.unitPrice }; }
            onChange(next);
          }} />
        <div className="li-ro">{item.grade || <span className="dim">—</span>}</div>
        <div className="li-ro">{item.productType || <span className="dim">—</span>}</div>
        <StructCombo products={products} value={item.productId || ""}
          code={item.productCode || (item.productId ? pcOf(products.find(p => p.id === item.productId) || {}) : "")}
          onPick={p => {
            if (!p) { onChange({ ...item, productId: "", structureCode: "", edpCode: "", width: "", length: "" }); return; }
            const sf = structFields(p);
            const pc = pcOf(p);
            onChange({ ...item, ...(pc ? { productCode: pc } : {}), ...sf, unitPrice: sf.price !== "" ? sf.price : item.unitPrice });
          }} />
        <div className="li-ro">{item.edpCode || <span className="dim">—</span>}</div>
        <div className="li-ro">{(item.width !== "" && item.width != null) ? item.width : <span className="dim">—</span>}</div>
        <div className="li-ro">{(item.length !== "" && item.length != null) ? item.length : <span className="dim">—</span>}</div>
        <input className="input" type="number" value={item.qty} onChange={e => set("qty", e.target.value)} placeholder={t("qt_qty")} />
        <input className="input" type="number" value={item.unitPrice} onChange={e => set("unitPrice", e.target.value)} placeholder={t("qt_unit_price")} />
        <select className="select" value={item.currency} onChange={e => set("currency", e.target.value)}>
          {Object.keys(QT.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="icon-btn" onClick={onRemove} aria-label="remove">✕</button>
      </div>
      {(unitPrice > 0 || qty > 0) && (
        <div className="qt-item-calc">
          {effUnit > 0 && <span>{t("pd_roll_price")}: <strong>{QT.fmtNum(Math.round(effUnit))} {item.currency}</strong>{tierQty > 0 ? <small className="dim"> · MOQ {QT.fmtNum(tierQty)}</small> : null}</span>}
          <span>{t("qt_unit_price_sqm")}: <strong>{unitPricePerSqm > 0 ? QT.fmtNum(Math.round(unitPricePerSqm)) + " " + item.currency : "—"}</strong></span>
          <span>{t("qt_total_value")}: <strong>{totalValue > 0 ? QT.fmtNum(Math.round(totalValue)) + " " + item.currency : "—"}</strong></span>
        </div>
      )}
    </div>
  );
}

function QuotationFormModal({ onClose, presetCustomerId, presetProjectId, asPage, existing }) {
  const { t, isBoss, assignablePics, repCountry, scopeCustomers, scopeProjects, addQuotation, updateQuotation, nextQuoteNo, freshQuoteNo, currency, findOrCreateCustomer, user, products } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const validUntilDefault = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  // A new customer created from this form belongs to the market being worked in.
  const _defCtry = useApp().productCountry || QT.MARKETS[0];
  const [f, setF] = useState(existing ? {
    customerId: existing.customerId || "", newCustName: "", newCustCountry: _defCtry, projectId: existing.projectId || "",
    quoteDate: existing.quoteDate || today, validUntil: existing.validUntil || validUntilDefault,
    items: (existing.items && existing.items.length ? existing.items : [{ productId: "", productCode: "", structureCode: "", sku: "", grade: "", productType: "FR", edpCode: "", width: "", length: "", sqmPerRoll: "", qty: "", price: "" }]).map(it => ({ ...it, price: (it.price != null && it.price !== "") ? it.price : (it.unitPrice != null ? it.unitPrice : "") })),
    paymentTerms: existing.paymentTerms || "T/T 30 days", status: existing.status || "Draft", approvedBy: existing.approvedBy || "", currency: existing.currency || (existing.items && existing.items[0] && existing.items[0].currency) || "VND", pic: existing.pic || "",
  } : {
    customerId: presetCustomerId || "", newCustName: "", newCustCountry: _defCtry, projectId: presetProjectId || "",
    quoteDate: today, validUntil: validUntilDefault,
    items: [{ productId: "", productCode: "", structureCode: "", sku: "", grade: "", productType: "FR", edpCode: "", width: "", length: "", sqmPerRoll: "", qty: "", price: "" }],
    paymentTerms: "T/T 30 days", status: "Draft", approvedBy: "", currency: "VND", pic: user.salesCode || "",
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Quote currency follows the selected product's currency (line prices are stored in
  // that currency and NOT converted), so it can't drift to a mismatched app-global unit.
  useEffect(() => {
    const it = (f.items || []).find(x => x.productId);
    if (it) { const p = products.find(x => x.id === it.productId); if (p && p.currency && p.currency !== f.currency) set("currency", p.currency); }
  }, [f.items]);

  // Ink type(s) auto-derive from the selected SKUs' grade (same as the Projects tab).
  const inkTypes = useMemo(() => [...new Set((f.items || []).map(it => it.grade).filter(Boolean))], [f.items]);

  const custProjects = scopeProjects.filter(p => p.customerId === f.customerId);
  const sorted = [...scopeCustomers].sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  // Seed from MARKETS so every market we operate in is selectable (Indonesia included),
  // then union the countries already present on customers.
  const countryOpts = [...new Set([...(window.CRM.MARKETS || []), ...scopeCustomers.map(c => window.CRM.normCountry(c.country))])].filter(Boolean);
  const valid = ((f.customerId && f.customerId !== "__new__") || (f.customerId === "__new__" && f.newCustName.trim())) && f.items.some(it => (it.productId || it.productCode) && parseFloat(it.qty) > 0 && parseFloat(it.price) > 0);
  const total = f.items.reduce((s, it) => s + lineValueEff(it), 0);

  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!valid || saving) return;
    // A new quotation takes the next number that is free on the server, not only in this browser.
    let quoteNo = null;
    if (!existing) {
      setSaving(true);
      quoteNo = await freshQuoteNo().catch(() => null);
      setSaving(false);
    }
    let customerId = f.customerId;
    if (customerId === "__new__") {
      customerId = findOrCreateCustomer({ name: f.newCustName, country: f.newCustCountry, owner: user.salesCode || "" }, "quotation");
      if (!customerId) return;
    }
    const { newCustName, newCustCountry, ...rest } = f;
    const payloadItems = f.items.filter(it => (it.productId || it.productCode) && parseFloat(it.qty) > 0).map(it => ({ productId: it.productId || "", productCode: it.productCode || "", structureCode: it.structureCode || "", sku: it.sku || "", grade: it.grade || "", productType: it.productType || "FR", edpCode: it.edpCode || "", width: parseFloat(it.width) || 0, length: parseFloat(it.length) || 0, sqmPerRoll: parseFloat(it.sqmPerRoll) || "", qty: parseFloat(it.qty) || 0, price: parseFloat(it.price) || 0, unitPrice: parseFloat(it.price) || 0, currency: f.currency }));
    if (existing) {
      updateQuotation(existing.id, { customerId, projectId: f.projectId, quoteDate: f.quoteDate, validUntil: f.validUntil, paymentTerms: f.paymentTerms, status: f.status, approvedBy: f.approvedBy, currency: f.currency, pic: f.pic, items: payloadItems });
    } else {
      addQuotation({ ...rest, ...(quoteNo ? { id: quoteNo } : {}), customerId, items: payloadItems });
    }
    onClose();
  };

  return (
    <QuoteFormShell asPage={asPage} t={t} onClose={onClose} title={existing ? t("pd_edit") : t("qt_new")}>
      <div className="form-grid">
        <Field label={t("qt_customer")} required>
          <select className="select" value={f.customerId} onChange={e => set("customerId", e.target.value)}>
            <option value="">—</option>
            {sorted.map(c => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            <option value="__new__">➕ {t("pr_new_customer")}</option>
          </select>
        </Field>
        {f.customerId === "__new__" && (
          <>
            <Field label={t("pr_new_cust_name")} required>
              <input className="input" value={f.newCustName} onChange={e => set("newCustName", e.target.value)} placeholder={t("pr_new_cust_ph")} autoFocus />
            </Field>
            <Field label={t("country")}>
              <select className="select" value={countryOpts.includes(f.newCustCountry) ? f.newCustCountry : (countryOpts[0] || "")} onChange={e => set("newCustCountry", e.target.value)}>
                {countryOpts.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </>
        )}
        <ProjectLinkField t={t} customerId={f.customerId} projects={scopeProjects}
          value={f.projectId} onChange={(v) => set("projectId", v)} kind="quote" />
        <Field label={t("qt_date")}>
          <input className="input" type="date" value={f.quoteDate} onChange={e => set("quoteDate", e.target.value)} />
        </Field>
        <Field label={t("qt_valid_until")}>
          <input className="input" type="date" value={f.validUntil} onChange={e => set("validUntil", e.target.value)} />
        </Field>
        <Field label={t("qt_payment_terms")}>
          <input className="input" value={f.paymentTerms} onChange={e => set("paymentTerms", e.target.value)} placeholder="T/T 30 days, COD…" />
        </Field>
        <Field label={t("qt_status")}>
          <select className="select" value={f.status} onChange={e => set("status", e.target.value)}>
            {QT.QUOTE_STATUSES.map(s => <option key={s} value={s}>{t("qt_status_" + s)}</option>)}
          </select>
        </Field>
        <Field label={t("qt_approved_by")}>
          <input className="input" value={f.approvedBy} onChange={e => set("approvedBy", e.target.value)} placeholder={t("qt_approved_ph")} />
        </Field>
        <Field label={t("pol_pic")}>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.pic} onChange={e => set("pic", e.target.value)}>
              {isBoss && <option value="">—</option>}
              {picScope(assignablePics, (f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country), repCountry, f.pic).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input className="input" value={f.pic} disabled />}
        </Field>
        <Field label={t("tg_currency")}>
          <select className="select" value={f.currency} onChange={e => set("currency", e.target.value)}>
            {Object.keys(QT.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("qt_items")}>
        <ProductLineItems items={f.items} onChange={v => set("items", v)} products={products} t={t} cur={f.currency} country={(f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country)} />
      </Field>
      <Field label={t("pr_ink")}>
        <div className="input ink-derived">
          {inkTypes.length
            ? inkTypes.map(g => <span key={g} className="ink-chip">{g}</span>)
            : <span className="dim">{t("pr_ink_none")}</span>}
        </div>
        <small className="status-hint">{t("pr_ink_auto")}</small>
      </Field>
      <div className="po-calc">
        <span>{t("qt_total")}: <strong>{QT.fmtNum(total)} {f.currency}</strong></span>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid || saving} onClick={submit}>{saving ? "…" : existing ? t("save") : t("qt_new")}</button>
      </div>
    </QuoteFormShell>
  );
}

// Renders the quotation-create form either inline as a full page or inside a modal.
function QuoteFormShell({ asPage, t, onClose, children, title }) {
  const ttl = title || t("qt_new");
  if (asPage) {
    return (
      <div className="page page-wide">
        <button className="back-btn" onClick={onClose}><Icon d={ICONS.back} size={16} /> {t("qt_title")}</button>
        <header className="page-head"><div><h1>{ttl}</h1></div></header>
        <section className="card">{children}</section>
      </div>
    );
  }
  return <Modal title={ttl} onClose={onClose} width={760}>{children}</Modal>;
}

function QuotationDetailPage({ id, onBack, openCustomer, openProject, openPOFromQuote }) {
  const { t, quotations, customers, projects, scopeProjects, updateQuotation, money, currency, isBoss, assignablePics, repCountry, deleteQuotation, canEdit, canDelete, lvlOr, products } = useApp();
  const q = quotations.find(x => x.id === id);
  // All hooks first — an early return above them changes the hook count and crashes React.
  const [fullEdit, setFullEdit] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkProj, setLinkProj] = useState((q && q.projectId) || "");
  if (!q) return (<div className="page"><button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("qt_detail_back")}</button></div>);
  if (fullEdit) return <QuotationFormModal existing={q} asPage onClose={() => setFullEdit(false)} />;
  const cust = customers.find(c => c.id === q.customerId);
  if (sending) return <QuoteSendPage q={q} cust={cust} onClose={() => setSending(false)} />;
  const proj = projects.find(p => p.id === q.projectId);

  const total = quoteTotalVnd(q);
  const setStatus = (status) => updateQuotation(q.id, { status });

  const saveLink = () => {
    updateQuotation(q.id, { projectId: linkProj });
  };

  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("qt_detail_back")}</button>
      {canDelete && canDelete("quotations") && <button className="btn btn-danger btn-sm" style={{ float: "right" }} onClick={() => crmConfirm(t("del_confirm"), () => { deleteQuotation(q.id); onBack(); })}>{t("pd_delete")}</button>}
      <header className="profile-head card">
        <div className="profile-id">
          <div>
            <h1>{t("qt_detail")} · {q.id}</h1>
            <div className="profile-tags">
              <QuoteStatusBadge status={q.status} t={t} />
              <select className="select" value={q.status} disabled={!lvlOr("quotations", "edit", true)} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 170 }}>
                {QT.QUOTE_STATUSES.map(s => <option key={s} value={s}>{t("qt_status_" + s)}</option>)}
              </select>
              {cust && <button className="link-btn" onClick={() => openCustomer(q.customerId)}>{cust.shortName || cust.name} →</button>}
              {proj && openProject && <button className="link-btn" onClick={() => openProject(q.projectId)}>{proj.name} →</button>}
              {lvlOr("quotations", "edit", true) && <button className="btn btn-primary btn-sm" onClick={() => setSending(true)}>{t("qx_send")}</button>}
            </div>
          </div>
        </div>
      </header>

      {q.status === "Won" && (
        <div className="card" style={{ borderColor: "#16A34A", background: "#16A34A0D", marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            {t("qt_create_po")}
            {openPOFromQuote && lvlOr("polist", "edit", true) && <button className="btn btn-primary btn-sm" style={{ marginLeft: 10 }}
              onClick={() => { onBack(); openPOFromQuote(q); }}>
              <Icon d={ICONS.plus} size={13} /> {t("pol_new")}
            </button>}
          </p>
        </div>
      )}

      <div className="profile-grid">
        <section className="card">
          <h2>{t("qt_detail")}</h2>
          <dl className="detail-grid">
            <div className="detail-item"><dt>{t("qt_customer")}</dt><dd>{cust ? (cust.shortName || cust.name) : "—"}</dd></div>
            <div className="detail-item"><dt>{t("qt_date")}</dt><dd>{QT.fmtDate(q.quoteDate)}</dd></div>
            <div className="detail-item"><dt>{t("qt_valid_until")}</dt><dd>{QT.fmtDate(q.validUntil)}</dd></div>
            <div className="detail-item"><dt>{t("qt_revision")}</dt><dd>#{q.revisionNo || 1}</dd></div>
            <div className="detail-item"><dt>{t("qt_total")}</dt><dd>{money(total)}</dd></div>
          </dl>
        </section>
        <section className="card">
          <h2>{t("link_project")}</h2>
          <fieldset className="form-grid ro-fieldset" disabled={!lvlOr("quotations", "edit", true)}>
            <ProjectLinkField t={t} customerId={q.customerId} projects={scopeProjects}
              value={linkProj} onChange={setLinkProj} kind="quote" />
          </fieldset>
          {lvlOr("quotations", "edit", true) && <div className="modal-actions">
            <button className="btn btn-primary" onClick={saveLink}>{t("smp_link_save")}</button>
          </div>}
        </section>
      </div>

      <section className="card">
        <h2>{t("qt_items")}
          {((canEdit && canEdit("quotations")) || isBoss) && <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setFullEdit(true)}>{t("pd_edit")}</button>}
        </h2>
        <table className="table table-plain qt-items-table">
          <thead><tr>
            <th>{t("qt_product_code")}</th><th className="num">{t("qt_width")}</th><th className="num">{t("qt_length")}</th>
            <th className="num">{t("qt_qty")}</th><th className="num">{t("li_price")}</th><th className="num">{t("pd_roll_price")}</th><th className="num">{t("li_line_total")}</th>
          </tr></thead>
          <tbody>
            {(q.items || []).map((it, i) => (
              <tr key={i}>
                <td>{it.structureCode || it.productCode}{it.structureCode && it.productCode ? <small className="cell-sub">{it.productCode}</small> : null}</td>
                <td className="num">{it.width}</td><td className="num">{it.length}</td>
                <td className="num">{QT.fmtNum(it.qty)}</td>
                <td className="num">{lineUnitPrice(it) ? QT.fmtNum(lineUnitPrice(it)) + " " + it.currency : "\u2014"}</td>
                <td className="num">{QT.fmtNum(Math.round(lineEffUnitPrice(it)))} {it.currency}</td>
                <td className="num">{QT.fmtNum(lineValueEff(it))} {it.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="po-calc">
          <span>{t("li_total_qty")}: <strong>{QT.fmtNum(lineItemTotals(q.items || []).qty)}</strong></span>
          <span>{t("li_volume_sqm")}: <strong>{QT.fmtNum(lineItemTotals(q.items || []).sqm)}</strong></span>
          <span>{t("li_total")}: <strong>{QT.fmtMoneyFull(total, currency)}</strong></span>
        </div>
        <p className="status-hint" style={{ marginTop: 8 }}>{t("qt_payment_terms")}: {q.paymentTerms}{q.approvedBy ? " · " + t("qt_approved_by") + ": " + q.approvedBy : ""}</p>
      </section>
    </div>
  );
}

Object.assign(window, { QuotationsPage, QuotationFormModal, QuotationDetailPage, QuoteStatusBadge, quoteTotal, quoteTotalVnd, quoteTotalIn });
