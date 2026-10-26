// Todaytec CRM — Projects module
const PR = window.CRM;

// Limit a PIC list to reps assigned to the record's country (falls back to the full
// list when none match / country unknown); always keeps the current value.
function picScope(list, country, _rc, current) {
  const arr = list || [];
  const keep = arr.filter(o => o.global || !country || !o.country || o.country === country);
  const codes = [...new Set((keep.length ? keep : arr).map(o => o.code))];
  return (current && !codes.includes(current)) ? [current, ...codes] : codes;
}

function ProjMom({ cur, prev }) {
  if (!prev && !cur) return <span className="mom-badge mom-flat">MoM —</span>;
  if (!prev) return <span className="mom-badge mom-up">MoM ▲ new</span>;
  const d = Math.round((cur - prev) / prev * 100);
  return <span className={"mom-badge " + (d >= 0 ? "mom-up" : "mom-down")}>MoM {d >= 0 ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

function ProjectsPage({ openCustomer, newProjectFor, clearNewProjectFor, selected, setSelected }) {
  const { t, isBoss, scopeProjects: scopeProjectsAll, scopeCustomers, customers, currency, setCurrency, money, canExport, canEdit, canDelete: canDeletePerm, deleteProjects, addProjectsBulk, users, picFilterCodes } = useApp();
  const money_full = (v) => PR.fmtMoneyFull(v, currency);
  const sel = useRowSelection();
  const grp = useGroupToggle();
  const canDelete = !!(canDeletePerm && canDeletePerm("projects"));
  const [importing, setImporting] = useState(false);
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const { dateRange: dr, setDateRange: setDr, dateRangeR: drR } = useApp();
  const fromMonth = drR.from, toMonth = drR.to;
  const [creating, setCreating] = useState(!!newProjectFor);
  const [detail, setDetail] = useState(null);
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const prCountries = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? [c] : []; }, [_topCountry]);
  const setPrCountries = () => {};
  useEffect(() => {
    if (prCountries.length === 1 && prCountries[0] === "Thailand") setCurrency("THB");
    else if (prCountries.length === 1 && prCountries[0] === "Vietnam") setCurrency("VND");
    else if (prCountries.length >= 2) setCurrency("VND");
  }, [prCountries]);

  useEffect(() => { if (newProjectFor) setCreating(true); }, [newProjectFor]);

  // NOTE: all hooks must run before any early return, otherwise React throws
  // "Rendered fewer hooks than expected" when we bail out to the profile/form views.
  const projSort = useSort(null, "asc");

  if (selected) return <ProjectProfile id={selected} onBack={() => setSelected(null)} openCustomer={openCustomer} />;
  if (creating) return <ProjectFormModal asPage presetCustomerId={newProjectFor} onClose={() => { setCreating(false); clearNewProjectFor && clearNewProjectFor(); }} />;

  const prCountryRank = (c) => c === "Vietnam" ? 0 : c === "Thailand" ? 1 : 2;
  const allCountries = [...new Set(scopeCustomers.map(c => window.CRM.normCountry(c.country)))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort((a, b) => prCountryRank(a) - prCountryRank(b));
  const allowC = (cn) => prCountries.length === 0 || prCountries.includes(cn);
  const countryOfCust = (id) => { const c = customers.find(x => x.id === id); return c ? window.CRM.normCountry(c.country) : ""; };
  const scopeProjects = scopeProjectsAll.filter(p => allowC(countryOfCust(p.customerId)));

  const owners = [...new Set([...(picFilterCodes || []), ...scopeProjects.map(p => (p.following || "").trim().toUpperCase())].filter(Boolean))].sort();
  const passNonDate = (p) => {
    if (stage && p.stage !== stage) return false;
    if (owner && p.following !== owner) return false;
    const qq = q.trim().toLowerCase();
    if (qq) {
      const c = customers.find(x => x.id === p.customerId);
      const hay = (p.name + " " + p.id + " " + (c ? c.name + " " + c.shortName + " " + c.bizId : "")).toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  };
  const inWin = (d, a, b) => (!a && !b) ? true : (!!d && (!a || d >= a) && (!b || d <= b));
  // The topbar range filters on WHEN the project entered the pipeline (createdAt), not on its
  // expected close month: closing dates are mostly in the future, so a "year to date" range
  // used to hide almost every open project (and every project with no close month at all).
  const projDate = (p) => p.createdAt || p.closeMonth || "";
  const list = scopeProjects.filter(p => passNonDate(p) && inWin(projDate(p), fromMonth, toMonth));
  // Same filters over the comparison window.
  // Plain computation, NOT a hook: this code sits below the early returns above, so a
  // useMemo here would change the hook count between the list and profile views.
  const cmpPrev = (() => {
    if (!drR.hasCmp) return { n: 0, amt: 0 };
    const arr = scopeProjects.filter(p => passNonDate(p) && inWin(projDate(p), drR.cmpFrom, drR.cmpTo));
    return { n: arr.length, amt: arr.reduce((s, p) => s + (p.value || 0), 0) };
  })();
  // KPI cards read the SAME filtered list as the table — they used to count every project in
  // scope, so the cards said 31 while the table showed 3.
  const totalValue = list.filter(p => p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
  const activeList = list.filter(p => p.stage !== "Won" && p.stage !== "Lost");
  const wonValue = list.filter(p => p.stage === "Won").reduce((s, p) => s + (p.value || 0), 0);
  const openValue = activeList.reduce((s, p) => s + (p.value || 0), 0);
  const weightedValue = activeList.reduce((s, p) => s + (p.value || 0) * ((p.probability !== undefined ? p.probability : 0) / 100), 0);
  // MoM (projects created this month vs last)
  const _now = new Date();
  const _cy = String(_now.getFullYear()), _cm = _now.getMonth();
  const _pm = _cm === 0 ? 11 : _cm - 1, _py = _cm === 0 ? String(_now.getFullYear() - 1) : _cy;
  const _inM = (d, y, m) => !!d && d.slice(0, 7) === y + "-" + String(m + 1).padStart(2, "0");
  const projCur = scopeProjects.filter(p => _inM(p.createdAt, _cy, _cm)).length;
  const projPrev = scopeProjects.filter(p => _inM(p.createdAt, _py, _pm)).length;
  const activeCur = scopeProjects.filter(p => _inM(p.createdAt, _cy, _cm) && p.stage !== "Won" && p.stage !== "Lost").length;
  const activePrev = scopeProjects.filter(p => _inM(p.createdAt, _py, _pm) && p.stage !== "Won" && p.stage !== "Lost").length;
  const openCur = scopeProjects.filter(p => _inM(p.createdAt, _cy, _cm) && p.stage !== "Won" && p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
  const openPrev = scopeProjects.filter(p => _inM(p.createdAt, _py, _pm) && p.stage !== "Won" && p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
  const wonCur = scopeProjects.filter(p => _inM(p.createdAt, _cy, _cm) && p.stage === "Won").reduce((s, p) => s + (p.value || 0), 0);
  const wonPrev = scopeProjects.filter(p => _inM(p.createdAt, _py, _pm) && p.stage === "Won").reduce((s, p) => s + (p.value || 0), 0);
  const stageCounts = {};
  PR.PROJECT_STAGES.forEach(s => stageCounts[s] = list.filter(p => p.stage === s).length);
  const maxStage = Math.max(1, ...Object.values(stageCounts));
  // projects per sales rep
  const byRep = {};
  list.forEach(p => { if (p.following) byRep[p.following] = (byRep[p.following] || 0) + 1; });
  const repRows = Object.entries(byRep).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxRep = Math.max(1, ...repRows.map(r => r[1]));

  const custName = (id) => {
    const c = customers.find(x => x.id === id);
    return c ? (c.shortName || c.name) : "—";
  };

  const projGrpAcc = {
    customer: g => custName(g.repCustomerId) || "",
    name: g => g.items[0] ? g.items[0].name || "" : "",
    stage: g => Math.max(-1, ...g.items.map(p => (PR.PROJECT_STAGES || []).indexOf(p.stage))),
    value: g => g.items.filter(p => p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0),
    following: g => g.items[0] ? g.items[0].following || "" : "",
  };
  const projSortCols = [
    { key: "customer", label: t("pr_customer") },
    { key: "name", label: t("pr_name") },
    { key: "stage", label: t("pr_stage") },
    { key: "value", label: t("pr_value") },
    { key: "following", label: t("pr_following") },
  ];

  return (
    <div className="page">
      {drR.hasCmp && <DrCompareBar range={drR} metrics={[
        { label: t("pr_title"), cur: list.length, prev: cmpPrev.n, fmt: v => PR.fmtNum(v) },
        { label: t("pr_value"), cur: list.reduce((s, p) => s + (p.value || 0), 0), prev: cmpPrev.amt, fmt: v => money(v) },
      ]} />}
      <header className="page-head">
        <div>
          <h1>{t("pr_title")}</h1>
          <p className="page-sub">{list.length} {t("pr_title").toLowerCase()} · {money(totalValue)}</p>
        </div>
        <div className="head-actions">
          <div className="search-box search-box-sm">
            <Icon d={ICONS.search} size={15} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("cu_company") + " / Business ID…"} />
          </div>
          {isBoss && <FilterSelect value={owner} onChange={setOwner} options={owners} allLabel={t("owner") + ": " + t("all")} />}
          <select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>
            {Object.keys(PR.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" value={stage} onChange={e => setStage(e.target.value)}>
            <option value="">{t("pr_stage")}: {t("all")}</option>
            {PR.PROJECT_STAGES.map(s => <option key={s} value={s}>{t("st_" + s)}</option>)}
          </select>
          {canExport && canExport("projects") && <ExportMenu name="projects"
            all={scopeProjects} filtered={list}
            map={p => {
              const c = customers.find(x => x.id === p.customerId) || {};
              const yn = (v) => v ? t("yes") : t("no");
              return {
                project_id: p.id,
                name: p.name,
                customer: c.name,
                customer_short: c.shortName,
                country: c.country,
                stage: p.stage,
                project_type: p.classification,
                product: p.product,
                ink_type: p.ink,
                width_mm: p.width,
                length_m: p.length,
                qty_rolls: p.qtyRolls,
                qty_sqm: p.qtySqm,
                price_per_sqm: p.pricePerSqm,
                value: p.value,
                probability_pct: p.probability,
                weighted_value: (p.probability !== undefined && p.value) ? Math.round(p.value * (p.probability || 0) / 100) : "",
                close_month: p.closeMonth,
                expected_close_date: p.expectedCloseDate,
                sample_sent: yn(p.sampleSent),
                quotation_sent: yn(p.quoteSent),
                po_received: yn(p.poReceived),
                potential: p.potential,
                end_customer: p.endCustomer,
                industry: p.industry,
                application: p.application,
                supplier: p.supplier,
                competitor: p.competitor,
                loss_competitor_price: p.lossCompetitorPrice,
                decision_criteria: p.decisionCriteria,
                linked_sample: p.linkedSampleId,
                fail_reason: p.failReason,
                note: p.note,
                following: p.following,
                created_by: p.createdBy,
                created_at: p.createdAt,
              };
            }} />}
          <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("pol_import_excel")}</button>
          <SortMenu columns={projSortCols} sort={projSort.sort} onSort={projSort.onSort} />
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon d={ICONS.plus} size={15} /> {t("pr_new")}</button>
        </div>
      </header>

      <div className="kpi-row kpi-row-projects">
        <div className="kpi">
          <span className="kpi-label">{t("po_total")}</span>
          <span className="kpi-value">{list.length}</span>
          <span className="kpi-foot">{stageCounts.Won} {t("st_Won")} · {stageCounts.Lost} {t("st_Lost")}</span>
          <ProjMom cur={projCur} prev={projPrev} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("po_active")}</span>
          <span className="kpi-value" style={{ color: "var(--teal-dark)" }}>{activeList.length}</span>
          <span className="kpi-foot">{t("ov_running")}</span>
          <ProjMom cur={activeCur} prev={activePrev} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("po_open")}</span>
          <span className="kpi-value kpi-money">{money(openValue)}</span>
          <span className="kpi-foot">{t("pr_weighted_value")}<br /><strong>{money(weightedValue)}</strong></span>
          <ProjMom cur={openCur} prev={openPrev} />
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("po_won")}</span>
          <span className="kpi-value kpi-money" style={{ color: "#16A34A" }}>{money(wonValue)}</span>
          <span className="kpi-foot">{stageCounts.Won} {t("st_Won").toLowerCase()}</span>
          <ProjMom cur={wonCur} prev={wonPrev} />
        </div>
        <div className="kpi kpi-stages">
          <span className="kpi-label">{t("ov_by_sales")}</span>
          <div className="rep-rows">
            {repRows.length === 0 ? <span className="dim" style={{ fontSize: 12 }}>—</span> : repRows.map(([k, n]) => (
              <div key={k} className="rep-row" title={k + ": " + n}>
                <span className="rep-name">{k}</span>
                <div className="rep-track"><div style={{ width: n / maxRep * 100 + "%" }}></div></div>
                <small>{n}</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={list.map(p => p.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <SortTh label={t("pr_customer")} sortKey="customer" sort={projSort.sort} onSort={projSort.onSort} className="pr-name-col" />
              <SortTh label={t("pr_name")} sortKey="name" sort={projSort.sort} onSort={projSort.onSort} />
              <th className="hide-sm">{t("pr_product")}</th>
              <SortTh label={t("pr_stage")} sortKey="stage" sort={projSort.sort} onSort={projSort.onSort} />
              <SortTh label={t("pr_value") + " (" + currency + ")"} sortKey="value" sort={projSort.sort} onSort={projSort.onSort} className="cell-money pr-value-col" align="right" />
              <SortTh label={t("pr_following")} sortKey="following" sort={projSort.sort} onSort={projSort.onSort} className="hide-sm" />
            </tr>
          </thead>
          <tbody>
            {(() => { const _g = groupByCompany(list, p => p.customerId, customers); return projSort.sort.key ? projSort.apply(_g, projGrpAcc) : _g; })().map(({ key, repCustomerId, companyCount, items }) => {
              const renderRow = (p, child) => (
                <tr key={p.id} className={(child ? "grp-child " : "") + "row-click" + (sel.isSel(p.id) ? " row-selected" : "")} onClick={() => setSelected ? setSelected(p.id) : setDetail(p.id)}>
                  {canDelete && <td className="col-check"><RowCheck id={p.id} selected={sel.selected} toggle={sel.toggle} /></td>}
                  <td className="pr-name-col"><button className="link-btn pr-cust-link" onClick={e => { e.stopPropagation(); openCustomer(p.customerId); }}>{custName(p.customerId)}</button></td>
                  <td><strong className="cell-main">{p.name}</strong>
                    <small className="cell-sub">{p.id} · {PR.fmtDate(p.closeMonth)}</small></td>
                  <td className="hide-sm">{(() => { const codes = (p.items && p.items.length) ? p.items.map(it => it.structureCode || it.sku || it.productCode).filter(Boolean) : String(p.product || "").split(",").map(x => x.trim()).filter(Boolean); return codes.length ? codes.map((c, ci) => <div key={ci}>{c}</div>) : <span className="dim">—</span>; })()}<small className="cell-sub">{p.width}mm × {p.length}m · {p.ink}</small></td>
                  <td><ProjStageBadge stage={p.stage} t={t} /></td>
                  <td className="cell-money pr-value-col">{money_full(p.value)}</td>
                  <td className="hide-sm"><OwnerChip code={p.following} t={t} /></td>
                </tr>
              );
              if (items.length === 1) return renderRow(items[0], false);
              const open = grp.isOpen(key);
              const groupTotal = items.filter(p => p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
              const gCust = customers.find(x => x.id === repCustomerId);
              const grpCode = companyCount === 1 && gCust && gCust.bizId ? gCust.bizId : "";
              const grpDate = items.reduce((mx, p) => (p.createdAt && p.createdAt > mx ? p.createdAt : mx), "");
              return (
                <React.Fragment key={"g-" + key}>
                  <tr className={"grp-row row-click" + (open ? " open" : "")} onClick={() => grp.toggle(key)}>
                    {canDelete && <td className="col-check"><SelectAllCheck ids={items.map(p => p.id)} selected={sel.selected} toggleAll={sel.toggleAll} /></td>}
                    <td className="pr-name-col">
                      <div className="ret-cust-cell">
                        <button className={"ret-exp-btn" + (open ? " open" : "")} aria-label="expand" onClick={e => { e.stopPropagation(); grp.toggle(key); }}>
                          <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                        </button>
                        <div>
                          <strong className="cell-main">{custName(repCustomerId)}{companyCount > 1 && <span className="nc-chip" style={{ marginLeft: 6 }}>{companyCount} {t("nc_companies")}</span>}</strong>
                          <div className="ret-cust-tags"><span className="ret-cust-meta">{items.length} {t("nav_projects").toLowerCase()}{grpDate ? " · " + PR.fmtDate(grpDate) : ""}{grpCode ? " · " + grpCode : ""}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="dim"></td>
                    <td className="hide-sm"></td>
                    <td></td>
                    <td className="cell-money pr-value-col">{money_full(groupTotal)}</td>
                    <td className="hide-sm"></td>
                  </tr>
                  {open && items.map(p => renderRow(p, true))}
                </React.Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={canDelete ? 7 : 6} className="empty">{t("pr_no_projects")}</td></tr>}
          </tbody>
        </table>
      </div>

      {canDelete && <BulkBar count={sel.count} noun={t("nav_projects")} allIds={list.map(p => p.id)} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={() => crmConfirm(t("bulk_confirm"), () => { deleteProjects([...sel.selected]); sel.clear(); })} onClear={sel.clear} />}

      {creating && false && <ProjectFormModal
        presetCustomerId={newProjectFor}
        onClose={() => { setCreating(false); clearNewProjectFor && clearNewProjectFor(); }} />}
      {detail && <ProjectDetailModal id={detail} onClose={() => setDetail(null)} openCustomer={openCustomer} />}
      {importing && <GenericImportModal titleKey="pr_new" hintKey="pr_import_hint" templateName="projects" fields={PROJECT_IMPORT_FIELDS}
        onClose={() => setImporting(false)}
        onImport={(items, { cur }) => {
          const rate = (PR.CURRENCIES[cur] ? PR.CURRENCIES[cur].rate : 1);
          const num = (v) => parseFloat(String(v || "").replace(/[^\d.-]/g, "")) || 0;
          const issues = [];
          const parsed = items.map(it => {
            if (!it.customer || !it.name) { issues.push({ row: it._row, reason: t("im_iss_missing").replace("{f}", !it.customer ? t("pr_customer") : t("pr_name")) }); return null; }
            return {
              customerName: it.customer, country: it.country, name: it.name,
              classification: it.classification, stage: it.stage, product: it.product,
              value: Math.round(num(it.value) * rate), pricePerSqm: Math.round(num(it.pricePerSqm) * rate),
              srcValue: num(it.value), srcCurrency: cur,
              qtyRolls: num(it.qtyRolls), qtySqm: num(it.qtySqm), closeMonth: PR.toISO(it.closeMonth) || it.closeMonth || "",
              probability: num(it.probability), following: it.following,
              endCustomer: it.endCustomer, industry: it.industry, competitor: it.competitor, note: it.note,
            };
          }).filter(Boolean);
          const res = addProjectsBulk(parsed);
          return { imported: res.imported, created: res.created, skipped: issues.length, issues };
        }} />}
    </div>
  );
}

const PROJECT_IMPORT_FIELDS = [
  { key: "customer", labelKey: "pr_customer", required: true, re: /customer|company|kh\u00e1ch|t\u00ean kh/i, ex: ["ABC Label Co.", "XYZ Printing"] },
  { key: "name", labelKey: "pr_name", required: true, re: /project\s*name|t\u00ean\s*d\u1ef1\s*\u00e1n|project|^name$|t\u00ean/i, ex: ["Wax/Resin annual supply", "Resin conversion Q3"] },
  { key: "stage", labelKey: "pr_stage", re: /stage|giai\s*\u0111o\u1ea1n|status/i, ex: ["Proposal", "Quotation"] },
  { key: "classification", labelKey: "pr_classification", re: /classification|ph\u00e2n\s*lo\u1ea1i|type/i, ex: ["New project", "Conversion"] },
  { key: "product", labelKey: "pr_product", re: /product|s\u1ea3n\s*ph\u1ea9m/i, ex: ["TTR Wax 110mm", "TTR Resin 60mm"] },
  { key: "value", labelKey: "pr_value", money: true, re: /value|gi\u00e1\s*tr\u1ecb|amount|doanh/i, ex: ["120000000", "45000000"] },
  { key: "pricePerSqm", labelKey: "pr_price", money: true, re: /price|\u0111\u01a1n\s*gi\u00e1|sqm.*price/i, ex: ["1200", "1800"] },
  { key: "qtyRolls", labelKey: "pr_qty_rolls", re: /rolls|cu\u1ed9n/i, ex: ["500", "200"] },
  { key: "qtySqm", labelKey: "pr_qty_sqm", re: /sqm|m2|m\u00b2/i, ex: ["100000", "25000"] },
  { key: "closeMonth", labelKey: "pr_close_month", re: /close|\u0111\u00f3ng|th\u00e1ng|date/i, ex: ["2026-09-30", "2026-08-15"] },
  { key: "probability", labelKey: "pr_probability", re: /probability|x\u00e1c\s*su\u1ea5t|%/i, ex: ["40", "60"] },
  { key: "following", labelKey: "pr_following", re: /following|pic|sale|rep|ph\u1ee5\s*tr\u00e1ch/i, ex: ["NOOM", "ICE"] },
  { key: "endCustomer", labelKey: "pr_end_customer", re: /end\s*customer|kh\u00e1ch\s*cu\u1ed1i/i, ex: ["", ""] },
  { key: "industry", labelKey: "pr_industry", re: /industry|ng\u00e0nh/i, ex: ["Logistics", "FMCG"] },
  { key: "competitor", labelKey: "pr_competitor", re: /competitor|\u0111\u1ed1i\s*th\u1ee7/i, ex: ["Armor", "Ricoh"] },
  { key: "note", labelKey: "note", re: /note|ghi\s*ch\u00fa|remark/i, ex: ["", ""] },
];

function ProjectProfile({ id, onBack, openCustomer }) {
  const { t, projects, updateProject, customers, addLog, money, currency, deleteProject, canEdit, canDelete } = useApp();
  const [editing, setEditing] = useState(false);
  const p = projects.find(x => x.id === id);
  if (!p) return null;
  if (editing) return <ProjectFormModal asPage existing={p} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />;
  const cust = customers.find(x => x.id === p.customerId);
  const rows = [
    [t("pr_classification"), p.classification],
    [t("pr_product"), (p.items && p.items.length) ? "" : (() => { const codes = String(p.product || "").split(",").map(x => x.trim()).filter(Boolean); return codes.length ? codes.map((c, ci) => <div key={ci}>{c}</div>) : (p.product || ""); })()], [t("pr_ink"), p.ink],
    [t("pr_width"), p.width], [t("pr_length"), p.length],
    [t("pr_qty_rolls"), PR.fmtNum(p.qtyRolls)], [t("pr_qty_sqm"), PR.fmtNum(p.qtySqm)],
    [t("pr_price"), PR.fmtVND(p.pricePerSqm)],
    [t("pr_close_month"), PR.fmtDate(p.closeMonth)],
    [t("pr_probability"), p.probability !== undefined && p.probability !== "" ? p.probability + "%" : ""],
    [t("pr_weighted_value"), (p.probability !== undefined && p.value) ? PR.fmtVND(Math.round(p.value * (p.probability || 0) / 100)) : ""],
    [t("pr_sample"), p.sampleSent ? t("yes") : t("no")],
    [t("pr_quote"), p.quoteSent ? t("yes") : t("no")],
    [t("pr_po"), p.poReceived ? t("yes") : t("no")],
    [t("pr_potential"), p.potential ? t("pot_" + p.potential) : "—"],
    [t("pr_end_customer"), p.endCustomer], [t("pr_industry"), p.industry],
    [t("pr_application"), p.application], [t("pr_supplier"), p.supplier],
    [t("pr_competitor"), p.competitor],
    [t("pr_loss_competitor_price"), p.lossCompetitorPrice ? PR.fmtVND(p.lossCompetitorPrice) : ""],
    [t("pr_decision_criteria"), p.decisionCriteria ? (t("dc_" + p.decisionCriteria) || p.decisionCriteria) : ""],
    [t("pr_linked_sample"), p.linkedSampleId || ""],
    [t("pr_fail_reason"), p.failReason],
    [t("pr_created_by"), p.createdBy],
  ];
  const setStage = (stage) => {
    const patch = { stage };
    if (stage === "Won") patch.result = "Won";
    if (stage === "Lost") patch.result = "Lost";
    if (stage === "Sample") patch.sampleSent = true;
    if (stage === "Quotation") patch.quoteSent = true;
    if (stage === "PO") patch.poReceived = true;
    updateProject(p.id, patch);
    addLog({ customerId: p.id, type: "status", text: t("st_" + stage) });
  };
  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("pr_title")}</button>
      <header className="profile-head card">
        <div className="profile-id">
          <Avatar name={p.name} size={52} />
          <div>
            <h1>{p.name}</h1>
            <p className="profile-full">{p.id} · {p.createdAt}</p>
            <div className="profile-tags">
              <ProjStageBadge stage={p.stage} t={t} />
              {p.classification && <span className="tag">{p.classification}</span>}
              {cust && (
                <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => openCustomer(p.customerId)}>
                  {cust.shortName || cust.name} →
                </button>
              )}
              <OwnerChip code={p.following} t={t} />
            </div>
          </div>
        </div>
        <div className="profile-status">
          <label className="field-label">{t("pr_stage")}</label>
          <select className="select" value={p.stage} onChange={e => setStage(e.target.value)}>
            {PR.PROJECT_STAGES.map(s => <option key={s} value={s}>{t("st_" + s)}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
            {canEdit && canEdit("projects") && <button className="btn btn-ghost btn-sm" style={{ padding: "3px 14px" }} onClick={() => setEditing(true)}><Icon d={ICONS.edit} size={14} /> {t("pr_edit")}</button>}
            {canDelete && canDelete("projects") && <button className="btn btn-danger btn-sm" style={{ padding: "3px 12px" }} onClick={() => crmConfirm(t("del_confirm"), () => { deleteProject(p.id); onBack(); })}>{t("pd_delete")}</button>}
          </div>
        </div>
      </header>
      <div className="profile-grid">
        <section className="card" style={{ gridColumn: "1/-1" }}>
          <h2>{t("pol_detail").replace("PO", "")}</h2>
          <dl className="detail-grid">
            {rows.filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => (
              <div className="detail-item" key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {p.note && <p className="note-text">{p.note}</p>}
        </section>
        <LineItemsView items={p.items} t={t} cur={currency} />
        <Timeline customerId={p.id} />
      </div>
    </div>
  );
}

function ProjectDetailModal({ id, onClose, openCustomer }) {
  const { t, projects, updateProject, customers } = useApp();
  const p = projects.find(x => x.id === id);
  if (!p) return null;
  const cust = customers.find(x => x.id === p.customerId);
  const rows = [
    [t("pr_customer"), cust ? (cust.shortName || cust.name) : "—"],
    [t("pr_classification"), p.classification],
    [t("pr_product"), (p.items && p.items.length) ? "" : (() => { const codes = String(p.product || "").split(",").map(x => x.trim()).filter(Boolean); return codes.length ? codes.map((c, ci) => <div key={ci}>{c}</div>) : (p.product || ""); })()], [t("pr_ink"), p.ink],
    [t("pr_width"), p.width], [t("pr_length"), p.length],
    [t("pr_qty_rolls"), PR.fmtNum(p.qtyRolls)], [t("pr_qty_sqm"), PR.fmtNum(p.qtySqm)],
    [t("pr_price"), PR.fmtVND(p.pricePerSqm)], [t("pr_value"), PR.fmtVND(p.value)],
    [t("pd_as_entered"), (p.srcCurrency && p.srcCurrency !== "VND" && +p.srcValue) ? PR.fmtNum(p.srcValue) + " " + p.srcCurrency : ""],
    [t("pr_close_month"), p.closeMonth],
    [t("pr_probability"), p.probability !== undefined && p.probability !== "" ? p.probability + "%" : ""],
    [t("pr_weighted_value"), (p.probability !== undefined && p.value) ? PR.fmtVND(Math.round(p.value * (p.probability || 0) / 100)) : ""],
    [t("pr_sample"), p.sampleSent ? t("yes") : t("no")],
    [t("pr_quote"), p.quoteSent ? t("yes") : t("no")],
    [t("pr_po"), p.poReceived ? t("yes") : t("no")],
    [t("pr_potential"), p.potential ? t("pot_" + p.potential) : "—"],
    [t("pr_end_customer"), p.endCustomer], [t("pr_industry"), p.industry],
    [t("pr_application"), p.application], [t("pr_supplier"), p.supplier],
    [t("pr_competitor"), p.competitor],
    [t("pr_loss_competitor_price"), p.lossCompetitorPrice ? PR.fmtVND(p.lossCompetitorPrice) : ""],
    [t("pr_decision_criteria"), p.decisionCriteria ? (t("dc_" + p.decisionCriteria) || p.decisionCriteria) : ""],
    [t("pr_linked_sample"), p.linkedSampleId || ""],
    [t("pr_fail_reason"), p.failReason],
    [t("pr_created_by"), p.createdBy], [t("pr_following"), p.following],
  ];
  return (
    <Modal title={p.name} onClose={onClose} width={640}>
      <div className="detail-top">
        <ProjStageBadge stage={p.stage} t={t} />
        <select className="select" value={p.stage} onChange={e => {
          const stage = e.target.value;
          const patch = { stage };
          if (stage === "Won") patch.result = "Won";
          if (stage === "Lost") patch.result = "Lost";
          if (stage === "Sample") patch.sampleSent = true;
          if (stage === "Quotation") patch.quoteSent = true;
          if (stage === "PO") patch.poReceived = true;
          updateProject(p.id, patch);
        }}>
          {PR.PROJECT_STAGES.map(s => <option key={s} value={s}>{t("st_" + s)}</option>)}
        </select>
        {cust && <button className="link-btn" onClick={() => { onClose(); openCustomer(p.customerId); }}>{t("cu_profile")} →</button>}
      </div>
      <dl className="detail-grid">
        {rows.filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => (
          <div className="detail-item" key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {p.items && p.items.length ? <div style={{ marginTop: 12 }}><LineItemsView items={p.items} t={t} cur={(p.items[0] && p.items[0].currency) || "VND"} /></div> : null}
      {p.note && <p className="note-text">{p.note}</p>}
    </Modal>
  );
}

function ProjectFormModal({ presetCustomerId, onClose, presetStage, presetName, onCreated, asPage, existing }) {
  const { t, user, isBoss, assignablePics, repCountry, scopeCustomers, addProject, updateProject, samples, findOrCreateCustomer, products } = useApp();
  const blankItem = { productId: "", productCode: "", structureCode: "", sku: "", grade: "", productType: "FR", width: "", length: "", sqmPerRoll: "", qty: "", price: "", edpCode: "" };
  // Rebuild editable line items from a stored project (which only keeps a compact
  // item shape) — backfill productCode / structureCode / EDP from the catalogue.
  const reconItems = (its) => (its && its.length ? its : []).map(it => {
    const prod = it.productId ? products.find(p => p.id === it.productId) : null;
    return {
      productId: it.productId || "",
      productCode: it.productCode || (prod ? (prod.code || prod.name) : ""),
      structureCode: it.structureCode || (prod ? (prod.eccshoaxx || prod.name) : (it.sku || "")),
      sku: it.sku || (prod ? (prod.eccshoaxx || prod.name) : ""),
      grade: it.grade || (prod && prod.grade) || "",
      productType: it.productType || (prod && prod.productType) || "FR",
      width: it.width ?? "", length: it.length ?? "",
      sqmPerRoll: it.sqmPerRoll ?? (prod ? prod.sqmPerRoll : "") ?? "",
      qty: it.qty ?? "", price: it.price ?? "",
      edpCode: it.edpCode || (prod && prod.itmref) || "",
    };
  });
  // A new customer created from this form belongs to the market being worked in.
  const _defCtry = useApp().productCountry || PR.MARKETS[0];
  const [f, setF] = useState(existing ? {
    customerId: existing.customerId || "", newCustName: "", newCustCountry: _defCtry,
    name: existing.name || "", classification: existing.classification || "New project", pic: existing.pic || existing.following || "",
    items: (reconItems(existing.items).length ? reconItems(existing.items) : [{ ...blankItem }]),
    ink: existing.ink || "Wax", closeMonth: existing.closeMonth || "",
    sampleSent: !!existing.sampleSent, quoteSent: !!existing.quoteSent, poReceived: !!existing.poReceived,
    potential: existing.potential || "Medium", stage: existing.stage || "Proposal", result: existing.result || "",
    endCustomer: existing.endCustomer || "", industry: existing.industry || "", application: existing.application || "",
    supplier: existing.supplier || "", competitor: existing.competitor || "", failReason: existing.failReason || "", note: existing.note || "",
    probability: existing.probability ?? 20, expectedCloseDate: existing.expectedCloseDate || "",
    lossCompetitorPrice: existing.lossCompetitorPrice || "", decisionCriteria: existing.decisionCriteria || "",
    linkedSampleId: existing.linkedSampleId || "", actualCloseDate: existing.actualCloseDate || "",
  } : {
    customerId: presetCustomerId || "", newCustName: "", newCustCountry: _defCtry, name: presetName || "", classification: "New project", pic: user.salesCode || "",
    items: [{ ...blankItem }],
    ink: "Wax", closeMonth: "",
    sampleSent: presetStage === "Sample", quoteSent: presetStage === "Quotation", poReceived: false,
    potential: "Medium", stage: presetStage || "Proposal", result: "", endCustomer: "",
    industry: "", application: "", supplier: "", competitor: "", failReason: "", note: "",
    probability: 20, expectedCloseDate: "", lossCompetitorPrice: "", decisionCriteria: "", linkedSampleId: "", actualCloseDate: "",
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Ink type(s) auto-derive from the selected SKUs' grade — a project can carry
  // several ink types when its proposed products span multiple categories.
  const inkTypes = useMemo(() => [...new Set((f.items || []).map(it => it.grade).filter(Boolean))], [f.items]);
  useEffect(() => { set("ink", inkTypes.join(", ")); }, [inkTypes.join("|")]);

  const valid = (f.customerId && f.customerId !== "__new__" && f.name.trim()) ||
    (f.customerId === "__new__" && f.newCustName.trim() && f.name.trim());
  const submit = () => {
    if (!valid) return;
    let customerId = f.customerId;
    if (customerId === "__new__") {
      customerId = findOrCreateCustomer({ name: f.newCustName, country: f.newCustCountry, owner: user.salesCode || "" }, "project");
      if (!customerId) return;
    }
    const { newCustName, newCustCountry, ...rest } = f;
    const items = (f.items || []).filter(it => it.productId && parseFloat(it.qty) > 0);
    const first = items[0] || {};
    const tt = lineItemTotals(items);
    const payload = {
      ...rest, customerId, nameCode: PR.nameCodeOf(scopeCustomers.find(c => c.id === customerId) || {}),
      following: f.pic || (existing ? (existing.following || "") : (user.salesCode || user.name)),
      product: items.map(it => it.sku).join(", "), productName: first.sku || "",
      width: parseFloat(first.width) || 0, length: parseFloat(first.length) || 0,
      qtyRolls: tt.qty, qtySqm: tt.sqm, value: tt.value,
      pricePerSqm: tt.sqm ? Math.round(tt.value / tt.sqm) : 0,
      items: items.map(it => ({ sku: it.sku, productId: it.productId, productCode: it.productCode || "", structureCode: it.structureCode || "", edpCode: it.edpCode || "", grade: it.grade, productType: it.productType || "FR", width: +it.width || 0, length: +it.length || 0, qty: +it.qty || 0, price: +it.price || 0, sqm: lineItemTotals([it]).sqm, value: lineValueEff(it) })),
      probability: parseFloat(f.probability) || 0, lossCompetitorPrice: parseFloat(f.lossCompetitorPrice) || 0,
    };
    if (existing) {
      updateProject(existing.id, payload);
      if (onCreated) onCreated({ ...existing, ...payload });
    } else {
      const p = addProject({
        ...payload,
        createdBy: user.salesCode || user.name, following: f.pic || user.salesCode || user.name,
      });
      if (onCreated) onCreated(p);
    }
    onClose();
  };
  const custSamples = samples.filter(s => s.customerId === f.customerId);
  const sorted = [...scopeCustomers].sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  const custGroups = useMemo(() => {
    const m = {};
    sorted.forEach(c => { const code = PR.nameCodeOf(c); (m[code] = m[code] || []).push(c); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [scopeCustomers]);
  const repOfGroup = (list) => list.find(c => /head\s*office/i.test(c.name || "")) || list[0];
  // Seed from MARKETS so every market we operate in is selectable (Indonesia included),
  // then union the countries already present on customers.
  const countryOpts = [...new Set([...(window.CRM.MARKETS || []), ...scopeCustomers.map(c => window.CRM.normCountry(c.country))])].filter(Boolean);
  const content = (
    <>
      <div className="form-grid">
        <Field label={t("pr_customer")} required>
          <select className="select" value={f.customerId} onChange={e => set("customerId", e.target.value)}>
            <option value="">—</option>
            {custGroups.map(([code, list]) => {
              const rep = repOfGroup(list);
              return <option key={code} value={rep.id}>{code}{list.length > 1 ? " · " + list.length + " " + t("nc_companies") : " · " + (rep.name || rep.shortName)}</option>;
            })}
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
        <Field label={t("pr_name")} required>
          <input className="input" value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Wax/Resin annual supply" />
        </Field>
        <Field label={t("pr_classification")}>
          <select className="select" value={f.classification} onChange={e => set("classification", e.target.value)}>
            {["New project", "Resupply", "Conversion"].map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label={t("pol_pic")}>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.pic} onChange={e => set("pic", e.target.value)}>
              {isBoss && <option value="">—</option>}
              {picScope(assignablePics, (f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country), repCountry, f.pic).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input className="input" value={f.pic} disabled />}
        </Field>
        <div className="field" style={{ gridColumn: "1/-1" }}>
          <span className="field-label">{t("pr_product")} <span className="dim" style={{ fontWeight: 500 }}>· SKU</span></span>
          <ProductLineItems items={f.items} onChange={v => set("items", v)} products={products} t={t} country={(f.customerId === "__new__" ? f.newCustCountry : (scopeCustomers.find(c => c.id === f.customerId) || {}).country)} />
        </div>
        <Field label={t("pr_ink")}>
          <div className="input ink-derived">
            {inkTypes.length
              ? inkTypes.map(g => <span key={g} className="ink-chip">{g}</span>)
              : <span className="dim">{t("pr_ink_none")}</span>}
          </div>
          <small className="status-hint">{t("pr_ink_auto")}</small>
        </Field>
        <Field label={t("pr_close_month")}>
          <input className="input" type="date" value={f.closeMonth} onChange={e => set("closeMonth", e.target.value)} />
        </Field>
        <Field label={t("pr_potential")}>
          <select className="select" value={f.potential} onChange={e => set("potential", e.target.value)}>
            {["High", "Medium", "Low"].map(x => <option key={x} value={x}>{t("pot_" + x)}</option>)}
          </select>
        </Field>
        <Field label={t("pr_supplier")}>
          <input className="input" value={f.supplier} onChange={e => set("supplier", e.target.value)} placeholder="Ricoh / Armor…" />
        </Field>
        <Field label={t("pr_end_customer")}>
          <input className="input" value={f.endCustomer} onChange={e => set("endCustomer", e.target.value)} />
        </Field>
        <Field label={t("pr_industry")}>
          <input className="input" value={f.industry} onChange={e => set("industry", e.target.value)} />
        </Field>
        <Field label={t("pr_application")}>
          <input className="input" value={f.application} onChange={e => set("application", e.target.value)} />
        </Field>
        <Field label={t("pr_competitor")}>
          <input className="input" value={f.competitor} onChange={e => set("competitor", e.target.value)} />
        </Field>
        <Field label={t("pr_probability")}>
          <input className="input" type="number" min="0" max="100" value={f.probability} onChange={e => set("probability", e.target.value)} />
        </Field>
        <Field label={t("pr_loss_competitor_price")}>
          <input className="input" type="number" value={f.lossCompetitorPrice} onChange={e => set("lossCompetitorPrice", e.target.value)} placeholder="VND/sqm" />
        </Field>
        <Field label={t("pr_decision_criteria")}>
          <select className="select" value={f.decisionCriteria} onChange={e => set("decisionCriteria", e.target.value)}>
            <option value="">—</option>
            {PR.DECISION_CRITERIA.map(x => <option key={x} value={x}>{t("dc_" + x)}</option>)}
          </select>
        </Field>
        {custSamples.length > 0 && (
          <Field label={t("pr_linked_sample")}>
            <select className="select" value={f.linkedSampleId} onChange={e => set("linkedSampleId", e.target.value)}>
              <option value="">—</option>
              {custSamples.map(s => <option key={s.id} value={s.id}>{s.id} · {s.productCode}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="check-row">
        <label><input type="checkbox" checked={f.sampleSent} onChange={e => set("sampleSent", e.target.checked)} /> {t("pr_sample")}</label>
        <label><input type="checkbox" checked={f.quoteSent} onChange={e => set("quoteSent", e.target.checked)} /> {t("pr_quote")}</label>
        <label><input type="checkbox" checked={f.poReceived} onChange={e => set("poReceived", e.target.checked)} /> {t("pr_po")}</label>
      </div>
      <div className="result-block">
        <div className="result-head">
          <strong>{t("pr_result_section")}</strong>
          <small>{t("pr_result_hint")}</small>
        </div>
        <div className="form-grid">
          <Field label={t("pr_actual_close")}>
            <input className="input" type="date" value={f.actualCloseDate} onChange={e => set("actualCloseDate", e.target.value)} />
          </Field>
          <Field label={t("pr_fail_reason")}>
            <input className="input" value={f.failReason} onChange={e => set("failReason", e.target.value)} placeholder={t("pr_fail_reason_ph")} />
          </Field>
        </div>
      </div>
      <Field label={t("note")}>
        <textarea className="input" rows="2" value={f.note} onChange={e => set("note", e.target.value)}></textarea>
      </Field>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{existing ? t("save") : t("pr_create")}</button>
      </div>
    </>
  );
  if (asPage) {
    return (
      <div className="page page-wide">
        <button className="back-btn" onClick={onClose}><Icon d={ICONS.back} size={16} /> {t("nav_projects")}</button>
        <header className="page-head"><div><h1>{existing ? t("pr_edit") : t("pr_new")}</h1></div></header>
        <section className="card">{content}</section>
      </div>
    );
  }
  return <Modal title={existing ? t("pr_edit") : t("pr_new")} onClose={onClose} width={680}>{content}</Modal>;
}

Object.assign(window, { ProjectsPage, ProjectFormModal, ProjectDetailModal, ProjectProfile });
