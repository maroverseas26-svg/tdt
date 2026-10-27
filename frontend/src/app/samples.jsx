// Todaytec CRM — Samples module (MODULE A: Sample tracking)
const SM = window.CRM;

// Limit a PIC list to reps assigned to the record's country (falls back to the full
// list when none match / country unknown); always keeps the current value.
function picScope(list, country, _rc, current) {
  const arr = list || [];
  const keep = arr.filter(o => o.global || !country || !o.country || o.country === country);
  const codes = [...new Set((keep.length ? keep : arr).map(o => o.code))];
  return (current && !codes.includes(current)) ? [current, ...codes] : codes;
}

function SampleStatusBadge({ status, t }) {
  const color = SM.SAMPLE_STATUS_COLORS[status] || "#94A3B8";
  const key = "smp_status_" + (status || "Chưa phản hồi").replace(/\s+/g, "_");
  return (
    <span className="badge" style={{ color, background: color + "1A", borderColor: color + "40" }}>
      <span className="badge-dot" style={{ background: color }}></span>
      {t(key) || status}
    </span>
  );
}

function SamplesPage({ openCustomer, openProject }) {
  const { t, isBoss, samples, customers, scopeCustomers, scopeProjects, projects, users, canExport, canEdit, canDelete: canDeletePerm, deleteSamples, addSamplesBulk, picFilterCodes } = useApp();
  const [q, setQ] = useState("");
  const sel = useRowSelection();
  const grp = useGroupToggle();
  const canDelete = !!(canDeletePerm && canDeletePerm("samples"));
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pic, setPic] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  // Sent date follows the ONE topbar date filter; test date stays a local extra filter.
  const drSentR = useApp().dateRangeR;
  const [drTest, setDrTest, drTestR] = useDateRange("samples_test", { preset: "all" });
  const sentFrom = drSentR.from, sentTo = drSentR.to, testFrom = drTestR.from, testTo = drTestR.to;
  const clearRanges = () => { setDrTest({ preset: "all", from: "", to: "", cmp: "none" }); };
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const smpCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setSmpCountries = () => {};

  if (detail) return <SampleDetailPage id={detail} onBack={() => setDetail(null)} openCustomer={openCustomer} openProject={openProject} />;
  if (creating) return <SampleFormModal asPage onClose={() => setCreating(false)} />;

  // scope: samples belonging to scoped customers
  const smpCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const allCountries = [...new Set(scopeCustomers.map(c => window.CRM.normCountry(c.country)))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => smpCountryRank(a) - smpCountryRank(b));
  const allowC = (cn) => smpCountries.length === 0 || smpCountries.includes(cn);
  const countryOfCust = (id) => { const c = customers.find(x => x.id === id); return c ? window.CRM.normCountry(c.country) : ""; };
  const scopeCustIds = new Set(scopeCustomers.map(c => c.id));
  const scoped = samples.filter(s => scopeCustIds.has(s.customerId) && allowC(countryOfCust(s.customerId)));

  const custName = (id) => {
    const c = customers.find(x => x.id === id);
    return c ? (c.shortName || c.name) : "—";
  };
  const projName = (id) => {
    const p = projects.find(x => x.id === id);
    return p ? p.name : "";
  };
  const custOwner = (id) => {
    const c = customers.find(x => x.id === id);
    return c ? c.owner : "";
  };
  // result filter pending/passed/rework/failed -> underlying testStatus values
  const RESULT_MAP = {
    pending: "Chưa phản hồi", passed: "Đạt", rework: "Đang test", failed: "Không đạt",
  };
  const pics = [...new Set([...(picFilterCodes || []), ...scoped.map(s => (s.pic || "").trim().toUpperCase())].filter(Boolean))].sort();

  const todayStr = new Date().toISOString().slice(0, 10);
  // follow-up tasks: testStatus is still "Đang test" and followUpDate <= today
  const followUps = scoped.filter(s => s.testStatus === "Đang test" && s.followUpDate && s.followUpDate <= todayStr);

  const list = scoped.filter(s => {
    if (status && s.testStatus !== status) return false;
    if (pic && (s.pic || "").trim().toUpperCase() !== pic) return false;
    if (resultFilter && s.testStatus !== RESULT_MAP[resultFilter]) return false;
    if (sentFrom && (!s.sentDate || s.sentDate < sentFrom)) return false;
    if (sentTo && (!s.sentDate || s.sentDate > sentTo)) return false;
    if (testFrom && (!s.feedbackDate || s.feedbackDate < testFrom)) return false;
    if (testTo && (!s.feedbackDate || s.feedbackDate > testTo)) return false;
    const qq = q.trim().toLowerCase();
    if (qq) {
      const hay = (s.productCode + " " + s.comparedAgainst + " " + s.id + " " + custName(s.customerId)).toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  }).sort((a, b) => (b.sentDate || "").localeCompare(a.sentDate || ""));

  const statusCounts = {};
  SM.SAMPLE_STATUSES.forEach(s => statusCounts[s] = scoped.filter(x => x.testStatus === s).length);
  const advancedActive = pic || resultFilter || sentFrom || sentTo || testFrom || testTo;
  const clearAdvanced = () => { setPic(""); setResultFilter(""); clearRanges(); };

  return (
    <div className="page">
      <header className="page-head list-head">
        <div>
          <h1>{t("smp_title")}</h1>
          <p className="page-sub">{list.length} {t("smp_count")}</p>
        </div>
        <div className="head-actions">
          {canExport && canExport("samples") && <ExportMenu name="samples"
            all={scoped} filtered={list}
            map={s => {
              const c = customers.find(x => x.id === s.customerId) || {};
              const p = projects.find(x => x.id === s.projectId);
              return {
                sample_id: s.id,
                customer: c.name,
                customer_short: c.shortName,
                country: c.country,
                linked_project: p ? p.name : "",
                product_code: s.productCode,
                ink_type: s.ink,
                width_mm: s.width,
                length_m: s.length,
                qty_sent_rolls: s.qtySent,
                sent_date: s.sentDate,
                courier: s.courier,
                tracking_no: s.trackingNo,
                compared_against: s.comparedAgainst,
                test_status: s.testStatus,
                feedback_date: s.feedbackDate,
                feedback_note: s.feedbackNote,
                follow_up_date: s.followUpDate,
                pic: s.pic || "",
              };
            }} />}
          <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("pol_import_excel")}</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon d={ICONS.plus} size={15} /> {t("smp_new")}</button>
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("cu_company") + " / " + t("smp_product_code") + "…"} />
        </div>
        <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t("smp_test_status")}: {t("all")}</option>
          {SM.SAMPLE_STATUSES.map(s => <option key={s} value={s}>{t("smp_status_" + s.replace(/\s+/g, "_")) || s}</option>)}
        </select>
        <button className={"btn btn-ghost" + (advancedActive ? " btn-filter-active" : "")} onClick={() => setShowAdvanced(v => !v)}>
          <Icon d={ICONS.pipelines} size={14} /> {t("smp_advanced_filter")}
        </button>
      </div>

      {showAdvanced && (
        <div className="card adv-filter-panel">
          <div className="adv-filter-grid">
            <Field label={t("smp_filter_pic")}>
              <FilterSelect value={pic} onChange={setPic} options={pics} allLabel={t("all")} />
            </Field>
            <Field label={t("smp_filter_result")}>
              <select className="select" value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
                <option value="">{t("all")}</option>
                <option value="pending">{t("smp_result_pending")}</option>
                <option value="passed">{t("smp_result_passed")}</option>
                <option value="rework">{t("smp_result_rework")}</option>
                <option value="failed">{t("smp_result_failed")}</option>
              </select>
            </Field>
            <Field label={t("smp_filter_test_date")}>
              <div className="adv-filter-range">
                <DateRangeFilter value={drTest} onChange={setDrTest} compare={false} />
              </div>
            </Field>
          </div>
          {advancedActive && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={clearAdvanced}>✕ {t("all")}</button>}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="card" style={{ borderColor: "#F59E0B", background: "#F59E0B0D", marginBottom: 14 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon d={ICONS.alert} size={16} /> {t("smp_task_title")} <span className="count-pill">{followUps.length}</span>
          </h2>
          <div className="mini-rows">
            {followUps.map(s => (
              <div className="mini-row row-click" key={s.id} onClick={() => setDetail(s.id)}>
                <span className="mini-name">{custName(s.customerId)} · {s.productCode}</span>
                <small className="dim">{s.followUpDate <= todayStr ? t("smp_followup_overdue") : t("smp_followup_today")} · {SM.fmtDate(s.followUpDate)}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="kpi-row kpi-row-4">
        {SM.SAMPLE_STATUSES.map(s => (
          <div className="kpi" key={s}>
            <span className="kpi-label">{t("smp_status_" + s.replace(/\s+/g, "_")) || s}</span>
            <span className="kpi-value" style={{ color: SM.SAMPLE_STATUS_COLORS[s] }}>{statusCounts[s]}</span>
          </div>
        ))}
      </div>

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={list.map(s => s.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <th>{t("smp_customer")}</th>
              <th className="hide-sm">{t("smp_product_code")}</th>
              <th className="hide-sm">{t("smp_sent_date")}</th>
              <th className="num">{t("li_total")}</th>
              <th>{t("smp_test_status")}</th>
              <th className="hide-sm">{t("smp_followup_date")}</th>
              <th className="hide-sm">{t("smp_compared_against")}</th>
              <th className="hide-sm">{t("pol_pic")}</th>
            </tr>
          </thead>
          <tbody>
            {groupByCompany(list, s => s.customerId, customers).map(({ key, repCustomerId, companyCount, items }) => {
              const renderRow = (s, child) => (
                <tr key={s.id} className={(child ? "grp-child " : "") + "row-click" + (sel.isSel(s.id) ? " row-selected" : "")} onClick={() => setDetail(s.id)}>
                  {canDelete && <td className="col-check"><RowCheck id={s.id} selected={sel.selected} toggle={sel.toggle} /></td>}
                  <td>
                    <button className="link-btn" onClick={e => { e.stopPropagation(); openCustomer(s.customerId); }}>{custName(s.customerId)}</button>
                    {s.projectId && <small className="cell-sub">{projName(s.projectId)}</small>}
                  </td>
                  <td className="hide-sm">{(() => { const codes = (s.items && s.items.length) ? s.items.map(it => it.structureCode || it.sku || it.productCode).filter(Boolean) : String(s.productCode || "").split(",").map(x => x.trim()).filter(Boolean); return codes.length ? codes.map((c, ci) => <div key={ci}>{c}</div>) : <span className="dim">—</span>; })()}<small className="cell-sub">{s.ink} · {s.width}×{s.length}</small></td>
                  <td className="hide-sm">{SM.fmtDate(s.sentDate)}</td>
                  <td className="num">{(s.items && s.items.length) ? SM.fmtMoneyFull(lineItemTotals(s.items).value, (s.items[0] && s.items[0].currency) || "VND") : <span className="dim">—</span>}</td>
                  <td><SampleStatusBadge status={s.testStatus} t={t} /></td>
                  <td className="hide-sm">{SM.fmtDate(s.followUpDate)}</td>
                  <td className="hide-sm">{s.comparedAgainst || "—"}</td>
                  <td className="hide-sm">{s.pic ? <OwnerChip code={s.pic} t={t} /> : <span className="dim">—</span>}</td>
                </tr>
              );
              if (items.length === 1) return renderRow(items[0], false);
              const open = grp.isOpen(key);
              const gCust = customers.find(c => c.id === repCustomerId);
              const grpCode = companyCount === 1 && gCust && gCust.bizId ? gCust.bizId : "";
              const grpDate = items.reduce((mx, s) => (s.sentDate && s.sentDate > mx ? s.sentDate : mx), "");
              return (
                <React.Fragment key={"g-" + key}>
                  <tr className={"grp-row row-click" + (open ? " open" : "")} onClick={() => grp.toggle(key)}>
                    {canDelete && <td className="col-check"><SelectAllCheck ids={items.map(s => s.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></td>}
                    <td>
                      <div className="ret-cust-cell">
                        <button className={"ret-exp-btn" + (open ? " open" : "")} aria-label="expand" onClick={e => { e.stopPropagation(); grp.toggle(key); }}>
                          <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                        </button>
                        <div>
                          <strong className="cell-main">{custName(repCustomerId)}{companyCount > 1 && <span className="nc-chip" style={{ marginLeft: 6 }}>{companyCount} {t("nc_companies")}</span>}</strong>
                          <div className="ret-cust-tags"><span className="ret-cust-meta">{items.length} {t("nav_samples").toLowerCase()}{grpDate ? " · " + SM.fmtDate(grpDate) : ""}{grpCode ? " · " + grpCode : ""}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm dim"></td>
                    <td className="num">{(() => { const gv = items.reduce((sum, s) => sum + ((s.items && s.items.length) ? lineItemTotals(s.items).value : 0), 0); return gv ? <strong>{SM.fmtMoneyFull(gv, "VND")}</strong> : <span className="dim"></span>; })()}</td>
                    <td></td>
                    <td className="hide-sm"></td>
                    <td className="hide-sm"></td>
                    <td className="hide-sm"></td>
                  </tr>
                  {open && items.map(s => renderRow(s, true))}
                </React.Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={canDelete ? 9 : 8} className="empty">{t("smp_no_samples")}</td></tr>}
          </tbody>
        </table>
      </div>

      {canDelete && <BulkBar count={sel.count} noun={t("nav_samples")} allIds={list.map(s => s.id)} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={() => crmConfirm(t("bulk_confirm"), () => { deleteSamples([...sel.selected]); sel.clear(); })} onClear={sel.clear} />}

      {importing && <GenericImportModal titleKey="smp_new" hintKey="smp_import_hint" templateName="samples" fields={SAMPLE_IMPORT_FIELDS}
        onClose={() => setImporting(false)}
        onImport={(items) => {
          const num = (v) => parseFloat(String(v || "").replace(/[^\d.-]/g, "")) || 0;
          const issues = [];
          const parsed = items.map(it => {
            if (!it.customer || !it.productCode) { issues.push({ row: it._row, reason: t("im_iss_missing").replace("{f}", !it.customer ? t("smp_customer") : t("smp_product_code")) }); return null; }
            return {
              customerName: it.customer, country: it.country, pic: it.pic,
              productCode: it.productCode, ink: it.ink || "Wax",
              width: num(it.width), length: num(it.length), qtySent: num(it.qtySent) || 1,
              sentDate: SM.toISO(it.sentDate) || "", courier: it.courier, trackingNo: it.trackingNo,
              comparedAgainst: it.comparedAgainst, followUpDate: SM.toISO(it.followUpDate) || "",
              testStatus: it.testStatus || undefined, feedbackNote: it.feedbackNote,
            };
          }).filter(Boolean);
          const res = addSamplesBulk(parsed);
          return { imported: res.imported, created: res.created, skipped: issues.length, issues };
        }} />}
    </div>
  );
}

const SAMPLE_IMPORT_FIELDS = [
  { key: "customer", labelKey: "smp_customer", required: true, re: /customer|company|kh\u00e1ch|t\u00ean kh/i, ex: ["ABC Label Co.", "XYZ Printing"] },
  { key: "productCode", labelKey: "smp_product_code", required: true, re: /product\s*code|product|m\u00e3\s*(h\u00e0ng|sp)|material/i, ex: ["TT-WR300", "TT-RES080"] },
  { key: "ink", labelKey: "smp_ink", re: /ink|m\u1ef1c/i, ex: ["Wax", "Resin"] },
  { key: "width", labelKey: "smp_width", re: /width|kh\u1ed5|r\u1ed9ng/i, ex: ["110", "60"] },
  { key: "length", labelKey: "smp_length", re: /length|d\u00e0i/i, ex: ["300", "300"] },
  { key: "qtySent", labelKey: "smp_qty_sent", re: /qty|quantity|s\u1ed1\s*l\u01b0\u1ee3ng|sl\b/i, ex: ["2", "1"] },
  { key: "sentDate", labelKey: "smp_sent_date", re: /sent\s*date|ng\u00e0y\s*g\u1eedi|^date|ng\u00e0y$/i, ex: ["2026-06-01", "2026-06-05"] },
  { key: "courier", labelKey: "smp_courier", re: /courier|v\u1eadn\s*chuy\u1ec3n|ship/i, ex: ["Kerry", "Flash"] },
  { key: "trackingNo", labelKey: "smp_tracking", re: /tracking|m\u00e3\s*v\u1eadn|track/i, ex: ["KE123456", ""] },
  { key: "comparedAgainst", labelKey: "smp_compared_against", re: /compared|so\s*s\u00e1nh|\u0111\u1ed1i\s*th\u1ee7|competitor/i, ex: ["Armor AR-01", "Ricoh B110A"] },
  { key: "followUpDate", labelKey: "smp_followup_date", re: /follow.?up|theo\s*d\u00f5i/i, ex: ["2026-06-15", ""] },
  { key: "testStatus", labelKey: "smp_test_status", re: /status|tr\u1ea1ng\s*th\u00e1i|k\u1ebft\s*qu\u1ea3/i, ex: ["\u0110ang test", "\u0110\u1ea1t"] },
  { key: "feedbackNote", labelKey: "smp_feedback_note", re: /feedback|note|ghi\s*ch\u00fa|nh\u1eadn\s*x\u00e9t/i, ex: ["", ""] },
  { key: "pic", labelKey: "pol_pic", re: /pic|sale|rep|ph\u1ee5\s*tr\u00e1ch/i, ex: ["NOOM", "ICE"] },
];

function SampleFormModal({ onClose, presetCustomerId, presetProjectId, asPage, existing }) {
  const { t, isBoss, assignablePics, repCountry, scopeCustomers, scopeProjects, addSample, updateSample, findOrCreateCustomer, user, products } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const reconItems = (its) => (its && its.length ? its : []).map(it => {
    const prod = it.productId ? products.find(p => p.id === it.productId) : null;
    return { productId: it.productId || "", productCode: it.productCode || (prod ? (prod.code || prod.name) : ""), structureCode: it.structureCode || (prod ? (prod.eccshoaxx || prod.name) : (it.sku || "")), sku: it.sku || (prod ? (prod.eccshoaxx || prod.name) : ""), grade: it.grade || (prod && prod.grade) || "", productType: it.productType || (prod && prod.productType) || "FR", width: it.width ?? "", length: it.length ?? "", sqmPerRoll: it.sqmPerRoll ?? (prod ? prod.sqmPerRoll : "") ?? "", qty: it.qty ?? "", price: it.price ?? "", edpCode: it.edpCode || (prod && prod.itmref) || "" };
  });
  // A new customer created from this form belongs to the market being worked in.
  const _defCtry = useApp().productCountry || SM.MARKETS[0];
  const [f, setF] = useState(existing ? {
    customerId: existing.customerId || "", newCustName: "", newCustCountry: _defCtry, projectId: existing.projectId || "", pic: existing.pic || "",
    items: (reconItems(existing.items).length ? reconItems(existing.items) : [{ productId: "", sku: "", grade: "", productType: "FR", width: "", length: "", sqmPerRoll: "", qty: "", price: "", edpCode: "" }]),
    ink: existing.ink || "",
    sentDate: existing.sentDate || today, courier: existing.courier || "", trackingNo: existing.trackingNo || "",
    testStatus: existing.testStatus || "Đang test", feedbackDate: existing.feedbackDate || "", feedbackNote: existing.feedbackNote || "",
    comparedAgainst: existing.comparedAgainst || "", followUpDate: existing.followUpDate || "",
  } : {
    customerId: presetCustomerId || "", newCustName: "", newCustCountry: _defCtry, projectId: presetProjectId || "", pic: user.salesCode || "",
    items: [{ productId: "", sku: "", grade: "", productType: "FR", width: "", length: "", sqmPerRoll: "", qty: "", price: "", edpCode: "" }],
    ink: "",
    sentDate: today, courier: "", trackingNo: "",
    testStatus: "Đang test", feedbackDate: "", feedbackNote: "",
    comparedAgainst: "", followUpDate: "",
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Ink type(s) auto-derive from the selected SKUs' grade — a sample can carry
  // several ink types when it spans multiple product categories.
  const inkTypes = useMemo(() => [...new Set((f.items || []).map(it => it.grade).filter(Boolean))], [f.items]);
  useEffect(() => { set("ink", inkTypes.join(", ")); }, [inkTypes.join("|")]);

  // auto-suggest follow-up date = sentDate + 14 days
  useEffect(() => {
    if (!f.followUpDate && f.sentDate) {
      const d = new Date(f.sentDate);
      d.setDate(d.getDate() + 14);
      set("followUpDate", d.toISOString().slice(0, 10));
    }
  }, [f.sentDate]);

  const custProjects = scopeProjects.filter(p => p.customerId === f.customerId);
  const sorted = [...scopeCustomers].sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  // Seed from MARKETS so every market we operate in is selectable (Indonesia included),
  // then union the countries already present on customers.
  const countryOpts = [...new Set([...(window.CRM.MARKETS || []), ...scopeCustomers.map(c => window.CRM.normCountry(c.country))])].filter(Boolean);
  const hasItem = (f.items || []).some(it => it.productId || (it.sku || "").trim());
  const valid = ((f.customerId && f.customerId !== "__new__") || (f.customerId === "__new__" && f.newCustName.trim())) && hasItem && f.sentDate;

  const submit = () => {
    if (!valid) return;
    let customerId = f.customerId;
    if (customerId === "__new__") {
      customerId = findOrCreateCustomer({ name: f.newCustName, country: f.newCustCountry, owner: user.salesCode || "" }, "sample");
      if (!customerId) return;
    }
    const { newCustName, newCustCountry, ...rest } = f;
    const items = (f.items || []).filter(it => it.productId || (it.sku || "").trim());
    const first = items[0] || {};
    const totalQty = items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
    const payload = {
      ...rest, customerId,
      items: items.map(it => ({ sku: it.sku, productId: it.productId, productCode: it.productCode || "", structureCode: it.structureCode || "", edpCode: it.edpCode || "", grade: it.grade, productType: it.productType || "FR", width: +it.width || 0, length: +it.length || 0, qty: +it.qty || 0, price: +it.price || 0 })),
      productCode: items.map(it => it.sku).filter(Boolean).join(", ") || first.sku || "",
      ink: inkTypes.join(", "),
      width: parseFloat(first.width) || 0, length: parseFloat(first.length) || 0,
      qtySent: totalQty || 0,
    };
    if (existing) updateSample(existing.id, payload); else addSample(payload);
    onClose();
  };

  return (
    <SampleFormShell asPage={asPage} t={t} onClose={onClose} title={existing ? (t("smp_detail") + " · " + t("pd_edit")) : t("smp_new")}>
      <div className="form-grid">
        <Field label={t("smp_customer")} required>
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
          value={f.projectId} onChange={(v) => set("projectId", v)} kind="sample" />
        <Field label={t("pol_pic")}>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.pic} onChange={e => set("pic", e.target.value)}>
              {isBoss && <option value="">—</option>}
              {picScope(assignablePics, (f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country), repCountry, f.pic).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input className="input" value={f.pic} disabled />}
        </Field>
        <div className="field" style={{ gridColumn: "1/-1" }}>
          <span className="field-label">{t("smp_product_code")} <span className="dim" style={{ fontWeight: 500 }}>· SKU</span></span>
          <ProductLineItems items={f.items} onChange={v => set("items", v)} products={products} t={t} country={(f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country)} />
        </div>
        <Field label={t("smp_ink")}>
          <div className="input ink-derived">
            {inkTypes.length
              ? inkTypes.map(g => <span key={g} className="ink-chip">{g}</span>)
              : <span className="dim">{t("pr_ink_none")}</span>}
          </div>
          <small className="status-hint">{t("pr_ink_auto")}</small>
        </Field>
        <Field label={t("smp_sent_date")}>
          <input className="input" type="date" value={f.sentDate} onChange={e => set("sentDate", e.target.value)} />
        </Field>
        <Field label={t("smp_courier")}>
          <input className="input" value={f.courier} onChange={e => set("courier", e.target.value)} placeholder="Kerry / Flash / GHTK…" />
        </Field>
        <Field label={t("smp_tracking")}>
          <input className="input" value={f.trackingNo} onChange={e => set("trackingNo", e.target.value)} />
        </Field>
        <Field label={t("smp_compared_against")}>
          <input className="input" value={f.comparedAgainst} onChange={e => set("comparedAgainst", e.target.value)} placeholder="Armor AR-01, Ricoh B110A…" />
        </Field>
        <Field label={t("smp_followup_date")}>
          <input className="input" type="date" value={f.followUpDate} onChange={e => set("followUpDate", e.target.value)} />
        </Field>
        <Field label={t("smp_test_status")}>
          <select className="select" value={f.testStatus} onChange={e => set("testStatus", e.target.value)}>
            {SM.SAMPLE_STATUSES.map(s => <option key={s} value={s}>{t("smp_status_" + s.replace(/\s+/g, "_")) || s}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("smp_feedback_note")}>
        <textarea className="input" rows="2" value={f.feedbackNote} onChange={e => set("feedbackNote", e.target.value)} placeholder="VD: Mực bị xước khi in trên decal bóng…"></textarea>
      </Field>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{existing ? t("save") : t("smp_new")}</button>
      </div>
    </SampleFormShell>
  );
}

// Renders the sample-create form either inline as a full page or inside a modal.
function SampleFormShell({ asPage, t, onClose, children, title }) {
  const ttl = title || t("smp_new");
  if (asPage) {
    return (
      <div className="page page-wide">
        <button className="back-btn" onClick={onClose}><Icon d={ICONS.back} size={16} /> {t("smp_title")}</button>
        <header className="page-head"><div><h1>{ttl}</h1></div></header>
        <section className="card">{children}</section>
      </div>
    );
  }
  return <Modal title={ttl} onClose={onClose} width={640}>{children}</Modal>;
}

function SampleDetailPage({ id, onBack, openCustomer, openProject }) {
  const { t, samples, customers, projects, scopeProjects, updateSample, deleteSample, canEdit, canDelete } = useApp();
  const s = samples.find(x => x.id === id);
  // All hooks first — an early return above them changes the hook count and crashes React.
  const [f, setF] = useState({
    testStatus: s ? s.testStatus : "", feedbackDate: (s && s.feedbackDate) || "", feedbackNote: (s && s.feedbackNote) || "", projectId: (s && s.projectId) || "",
  });
  const [fullEdit, setFullEdit] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  if (!s) return (<div className="page"><button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("smp_detail_back")}</button></div>);
  if (fullEdit) return <SampleFormModal existing={s} asPage onClose={() => setFullEdit(false)} />;
  const cust = customers.find(c => c.id === s.customerId);
  const proj = projects.find(p => p.id === s.projectId);

  const rows = [
    [t("smp_customer"), cust ? (cust.shortName || cust.name) : "—"],
    [t("smp_product_code"), (s.items && s.items.length) ? "" : (() => {
      const codes = String(s.productCode || "").split(",").map(x => x.trim()).filter(Boolean);
      return codes.length ? codes.map((c, i) => <div key={i}>{c}</div>) : "";
    })()], [t("smp_ink"), s.ink],
    [t("smp_width"), s.width], [t("smp_length"), s.length], [t("smp_qty_sent"), s.qtySent],
    [t("smp_sent_date"), SM.fmtDate(s.sentDate)],
    [t("smp_courier"), s.courier], [t("smp_tracking"), s.trackingNo],
    [t("smp_compared_against"), s.comparedAgainst],
    [t("smp_followup_date"), SM.fmtDate(s.followUpDate)],
  ];

  const linkValid = true;
  const save = () => {
    updateSample(s.id, {
      testStatus: f.testStatus,
      feedbackDate: f.feedbackDate || (f.testStatus !== "Đang test" && f.testStatus !== "Chưa phản hồi" ? new Date().toISOString().slice(0, 10) : s.feedbackDate),
      feedbackNote: f.feedbackNote, projectId: f.projectId,
    });
    onBack();
  };

  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("smp_detail_back")}</button>
      {canDelete && canDelete("samples") && <button className="btn btn-danger btn-sm" style={{ float: "right" }} onClick={() => crmConfirm(t("del_confirm"), () => { deleteSample(s.id); onBack(); })}>{t("pd_delete")}</button>}
      {canEdit && canEdit("samples") && <button className="btn btn-primary btn-sm" style={{ float: "right", marginRight: 8 }} onClick={() => setFullEdit(true)}>{t("pd_edit")}</button>}
      <header className="profile-head card">
        <div className="profile-id">
          <div>
            <h1>{t("smp_detail")} · {s.id}</h1>
            <div className="profile-tags">
              <SampleStatusBadge status={s.testStatus} t={t} />
              {cust && <button className="link-btn" onClick={() => openCustomer(s.customerId)}>{cust.shortName || cust.name} →</button>}
              {proj && openProject && <button className="link-btn" onClick={() => openProject(s.projectId)}>{t("smp_linked_project")}: {proj.name} →</button>}
            </div>
          </div>
        </div>
      </header>

      <div className="profile-grid">
        <section className="card">
          <h2>{t("smp_detail")}</h2>
          <dl className="detail-grid">
            {rows.filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => (
              <div className="detail-item" key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
        <section className="card">
          <h2>{t("smp_test_status")}</h2>
          <div className="form-grid">
            <Field label={t("smp_test_status")}>
              <select className="select" value={f.testStatus} onChange={e => set("testStatus", e.target.value)}>
                {SM.SAMPLE_STATUSES.map(x => <option key={x} value={x}>{t("smp_status_" + x.replace(/\s+/g, "_")) || x}</option>)}
              </select>
            </Field>
            <Field label={t("smp_feedback_date")}>
              <input className="input" type="date" value={f.feedbackDate} onChange={e => set("feedbackDate", e.target.value)} />
            </Field>
          </div>
          <Field label={t("smp_feedback_note")}>
            <textarea className="input" rows="3" value={f.feedbackNote} onChange={e => set("feedbackNote", e.target.value)}></textarea>
          </Field>
          <div className="form-grid">
            <ProjectLinkField t={t} customerId={s.customerId} projects={scopeProjects}
              value={f.projectId} onChange={(v) => set("projectId", v)} kind="sample" />
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={!linkValid} onClick={save}>{t("smp_link_save")}</button>
          </div>
        </section>
        <LineItemsView items={s.items} t={t} cur={(s.items && s.items[0] && s.items[0].currency) || "VND"} />
      </div>
    </div>
  );
}

Object.assign(window, { SamplesPage, SampleFormModal, SampleDetailPage, SampleStatusBadge });
