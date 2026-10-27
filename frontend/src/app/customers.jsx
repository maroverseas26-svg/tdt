// Todaytec CRM — Customer list + add + import + 360 profile with interaction timeline
const CU = window.CRM;

// Limit an owner/PIC list to reps assigned to the customer's country (falls back to the
// full list when none match / country unknown); always keeps the current value.
// Lead source is a fixed choice list (not free text) so the filter and any report can
// group on it. Legacy free-text values already stored stay selectable per record.
const CU_LEAD_SOURCES = ["Search / AI Search", "Referral", "Data", "Social / Mess", "Zalo / Line", "Website", "Hotline / Call"];
function leadSourceOpts(current) {
  return (!current || CU_LEAD_SOURCES.includes(current)) ? CU_LEAD_SOURCES : [current, ...CU_LEAD_SOURCES];
}
// Free-text lead sources typed in before the field became a choice list. The guess is a
// starting point only — the cleanup modal shows every value and its count before writing.
function guessLeadSource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (/(google|search|sản phẩm|tìm kiếm|seo|\bai\b|chatgpt|bing)/.test(s)) return "Search / AI Search";
  if (/(refer|giới thiệu|gt|word of mouth)/.test(s)) return "Referral";
  if (/(zalo|line|\boa\b)/.test(s)) return "Zalo / Line";
  if (/(facebook|\bfb\b|meta|messenger|mess|social|tiktok|insta|linkedin)/.test(s)) return "Social / Mess";
  if (/(hotline|call|điện thoại|phone|inbound|tổng đài)/.test(s)) return "Hotline / Call";
  if (/(web|site|form|landing)/.test(s)) return "Website";
  if (/(data|danh sách|list|import)/.test(s)) return "Data";
  // Values that are a STATUS or a customer type, not a source — default to clearing them.
  if (/(black\s*list|current customer|loss customer|inactive|new$|^[a-g]\s*[–-])/.test(s)) return "—";
  return "";   // "" = keep as is, let the user choose
}
function picScope(list, country, _rc, current) {
  const arr = list || [];
  const keep = arr.filter(o => o.global || !country || !o.country || o.country === country);
  const codes = [...new Set((keep.length ? keep : arr).map(o => o.code))];
  return (current && !codes.includes(current)) ? [current, ...codes] : codes;
}

// Country is a controlled field: only the markets we operate in are selectable, so
// dirty imported values ("VN", "TH", "China"…) never pollute the picker. normCountry
// maps common variants onto the canonical market name.
const CUST_MARKETS = (CU.MARKETS || ["Vietnam", "Thailand"]);
function normCustCountry(c) { return CU.normCountry(c); }
// Customer group is stored as a single-letter id ("A".."G"); imports may store a full
// label. Normalise to the leading A–G letter so the picker preselects correctly.
function custGroupId(g) { return CU.normGroup(g); }

function CustomersPage({ selected, setSelected, openNewProject, openProject, openPO, openQuote }) {
  const { t } = useApp();
  if (selected) return <CustomerProfile id={selected} onBack={() => setSelected(null)} openCompany={setSelected} openNewProject={openNewProject} openProject={openProject} openPO={openPO} openQuote={openQuote} />;
  return <CustomerList onOpen={setSelected} />;
}

/* ================= List ================= */
function CustomerList({ onOpen }) {
  const { t, isBoss, scopeCustomers, scopeProjects, scopePOs, canExport, canEdit, canDelete: canDeletePerm, deleteCustomers, users } = useApp();
  const [q, setQ] = useState("");
  const sel = useRowSelection();
  const [bulkEdit, setBulkEdit] = useState(false);
  const canEditPerm = !!(canEdit && canEdit("customers"));
  const canDelete = !!(canDeletePerm && canDeletePerm("customers"));
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const country = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? c : ""; }, [_topCountry]);
  const setCountry = () => {};
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");
  const [leadSrc, setLeadSrc] = useState("");
  const [funnel, setFunnel] = useState("");
  const [has, setHas] = useState("");
  const [page, setPage] = useState(0);
  const [groupNC, setGroupNC] = useState(true);
  const [ncExpanded, setNcExpanded] = useState(() => new Set());
  const toggleNC = (k) => setNcExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [adding, setAdding] = useState(false);
  const [fixLead, setFixLead] = useState(false);
  const [importing, setImporting] = useState(false);
  const PER = 30;

  const countries = [...new Set(scopeCustomers.map(c => normCustCountry(c.country)))].filter(c => CUST_MARKETS.includes(c)).sort();
  // Owner filter lists every non-deleted account by its EFFECTIVE owner code
  // (salesCode, or the account name for BOD/admin accounts that have no sales code —
  // e.g. THUY). Deriving it live from `users` means a newly-added account shows up in
  // the filter automatically.
  // Owner filter follows the topbar country: the owners actually present on customers in
  // that market, unioned with accounts whose KPI country matches (so a newly-added rep
  // with no customers yet still shows up).
  const owners = useMemo(() => {
    const onCust = new Set(scopeCustomers.filter(c => !country || normCustCountry(c.country) === country).map(c => (c.owner || "").toUpperCase()).filter(Boolean));
    const live = (users || []).filter(u => !u._deleted);
    const eff = (u) => (u.salesCode || u.name || "").toUpperCase();
    const byKpi = live.filter(u => !country || CU.normCountry(CU.kpiCountryOf ? CU.kpiCountryOf(u) : "") === country).map(eff);
    const reg = new Set(live.map(eff).filter(Boolean));
    return [...new Set([...onCust, ...byKpi].filter(o => o && reg.has(o)))].sort();
  }, [users, scopeCustomers, country]);
  const types = [...new Set(scopeCustomers.map(c => c.type).filter(Boolean))].sort();
  // The six standard sources, plus whatever legacy free-text values are still on records
  // (so nothing becomes unfilterable before it has been cleaned up).
  const leadSources = useMemo(() => {
    const extra = [...new Set(scopeCustomers.map(c => (c.leadSource || "").trim()).filter(s => s && !CU_LEAD_SOURCES.includes(s)))].sort();
    return [...CU_LEAD_SOURCES, ...extra];
  }, [scopeCustomers]);
  // Free-text values still on records, with how many customers hold each one.
  const legacyLead = useMemo(() => {
    const m = {};
    scopeCustomers.forEach(c => { const s = (c.leadSource || "").trim(); if (s && !CU_LEAD_SOURCES.includes(s)) m[s] = (m[s] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b)).map(v => ({ value: v, count: m[v] }));
  }, [scopeCustomers]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const projIds = new Set(scopeProjects.map(p => p.customerId));
    const poIds = new Set(scopePOs.map(p => p.customerId));
    const poNums = {};
    scopePOs.forEach(p => { poNums[p.customerId] = (poNums[p.customerId] || "") + " " + (p.poNumber || "") + " " + p.id; });
    return scopeCustomers.filter(c => {
      if (country && normCustCountry(c.country) !== country) return false;
      if (owner && (c.owner || "").toUpperCase() !== owner.toUpperCase()) return false;
      if (type && c.type !== type) return false;
      if (leadSrc && (c.leadSource || "").trim() !== leadSrc) return false;
      if (funnel && c.funnel !== funnel) return false;
      if (has === "projects" && !projIds.has(c.id)) return false;
      if (has === "po" && !poIds.has(c.id)) return false;
      if (qq) {
        const hay = (c.name + " " + c.shortName + " " + c.phone + " " + c.email + " " + c.city + " " + c.bizId + (poNums[c.id] || "")).toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [scopeCustomers, scopeProjects, scopePOs, q, country, owner, type, leadSrc, funnel, has]);

  useEffect(() => { setPage(0); sel.clear(); }, [q, country, owner, type, leadSrc, funnel, has]);
  const ncGroups = useMemo(() => {
    const m = {};
    filtered.forEach(c => { const code = CU.nameCodeOf(c); const k = CU.nameCodeKey(code); (m[k] = m[k] || { code, key: k, companies: [] }).companies.push(c); });
    return Object.values(m).sort((a, b) => b.companies.length - a.companies.length || a.code.localeCompare(b.code));
  }, [filtered]);
  const units = groupNC ? ncGroups : filtered;
  const sort = useSort(null, "asc");
  const flatAcc = {
    company: c => (c.shortName || c.name || ""),
    country: c => normCustCountry(c.country) || "",
    type: c => c.type || "",
    status: c => c.status || "",
    funnel: c => CU.STAGES.indexOf(c.funnel),
    owner: c => c.owner || "",
  };
  const groupAcc = {
    company: g => g.code || "",
    country: g => [...new Set(g.companies.map(c => normCustCountry(c.country)).filter(Boolean))].sort().join(","),
    type: g => g.companies.length,
    status: g => 0,
    funnel: g => Math.max(-1, ...g.companies.map(c => CU.STAGES.indexOf(c.funnel))),
    owner: g => [...new Set(g.companies.map(c => c.owner).filter(Boolean))].sort().join(","),
  };
  const sortCols = [
    { key: "company", label: t("cu_company") },
    { key: "country", label: t("country") },
    { key: "type", label: t("type") },
    { key: "status", label: t("status") },
    { key: "funnel", label: t("funnel") },
    ...[{ key: "owner", label: t("owner") }],
  ];
  const sortedFiltered = sort.sort.key ? sort.apply(filtered, flatAcc) : filtered;
  const sortedGroups = sort.sort.key ? sort.apply(ncGroups, groupAcc) : ncGroups;
  const pages = Math.ceil(units.length / PER);
  const rows = groupNC ? [] : sortedFiltered.slice(page * PER, page * PER + PER);
  const grows = groupNC ? sortedGroups.slice(page * PER, page * PER + PER) : [];
  const filteredIds = filtered.map(c => c.id);
  const colCount = (canDelete ? 1 : 0) + 6;
  const bulkDelete = () => crmConfirm(t("bulk_confirm"), () => { deleteCustomers([...sel.selected]); sel.clear(); });
  const deleteAll = () => crmConfirm(t("cu_delete_all_confirm").replace("{n}", String(filtered.length)), () => { deleteCustomers(filteredIds); sel.clear(); });
  // toggle every company of one Name-Code group without touching other selections
  const toggleGroupSel = (ids) => sel.setSelected(prev => {
    const n = new Set(prev);
    const allOn = ids.length > 0 && ids.every(id => n.has(id));
    ids.forEach(id => { if (allOn) n.delete(id); else n.add(id); });
    return n;
  });

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>{t("cu_title")}</h1>
          <p className="page-sub">{filtered.length} {t("customers")}</p>
        </div>
        <div className="head-actions">
          {canExport && canExport("customers") && <ExportMenu name="customers"
            all={scopeCustomers} filtered={filtered} page={rows}
            map={c => ({
              name: c.name,
              short_name: c.shortName,
              business_id: c.bizId,
              customer_type: c.type,
              status: c.status,
              group: c.group || "",
              pipeline: c.funnel,
              country: c.country,
              city: c.city,
              district: c.district,
              address: c.address || [c.district, c.city].filter(Boolean).join(", "),
              contact_name: c.pic,
              contact_title: c.title,
              contact_dept: c.dept,
              phone: [c.phone, c.phone2, c.phone3].filter(Boolean).join(" / "),
              email: c.email,
              website: c.website,
              lead_source: c.leadSource,
              lead_created: c.created,
              last_updated: c._updated,
              updated_by: c._updatedBy,
              owner: c.owner,
              note: c.note,
            })} />}
          <button className="btn btn-ghost" onClick={() => setImporting(true)}><Icon d={ICONS.upload} size={15} /> {t("im_btn")}</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon d={ICONS.plus} size={15} /> {t("cu_add")}</button>
        </div>
      </header>
      <div className="toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={16} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("cu_search")} />
        </div>
        {owners.length > 1 && <FilterSelect value={owner} onChange={setOwner} options={owners} allLabel={t("owner") + ": " + t("all")} />}
        <FilterSelect value={type} onChange={setType} options={types} allLabel={t("type") + ": " + t("all")} />
        <FilterSelect value={leadSrc} onChange={setLeadSrc} options={leadSources} allLabel={t("cu_lead_source") + ": " + t("all")} />
        {legacyLead.length > 0 && canEdit && canEdit("customers") && (
          <button className="btn btn-ghost" onClick={() => setFixLead(true)} title={t("cu_lead_fix_hint")}>
            <Icon d={ICONS.refresh} size={14} /> {t("cu_lead_fix")} ({legacyLead.length})
          </button>
        )}
        <FilterSelect value={funnel} onChange={setFunnel} options={CU.STAGES} allLabel={t("funnel") + ": " + t("all")} />
        <select className="select" value={has} onChange={e => setHas(e.target.value)}>
          <option value="">{t("cu_has")}: {t("all")}</option>
          <option value="projects">{t("cu_has_projects")}</option>
          <option value="po">{t("cu_has_po")}</option>
        </select>
        <button className={"btn btn-ghost" + (groupNC ? " btn-filter-active" : "")} onClick={() => { setGroupNC(v => !v); setPage(0); }}>
          <Icon d={ICONS.board} size={14} /> {t("nc_group_by")}
        </button>
        <SortMenu columns={sortCols} sort={sort.sort} onSort={sort.onSort} />
        {canDelete && filtered.length > 0 && (
          <button className="btn btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={deleteAll}>
            {t("cu_delete_all")} ({filtered.length})
          </button>
        )}
      </div>
      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {canDelete && <th className="col-check"><SelectAllCheck ids={filteredIds} selected={sel.selected} toggleAll={sel.toggleAll} /></th>}
              <SortTh label={t("cu_company")} sortKey="company" sort={sort.sort} onSort={sort.onSort} />
              <SortTh label={t("country")} sortKey="country" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              <SortTh label={t("type")} sortKey="type" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
              <SortTh label={t("status")} sortKey="status" sort={sort.sort} onSort={sort.onSort} />
              <SortTh label={t("funnel")} sortKey="funnel" sort={sort.sort} onSort={sort.onSort} />
              <SortTh label={t("owner")} sortKey="owner" sort={sort.sort} onSort={sort.onSort} className="hide-sm" />
            </tr>
          </thead>
          <tbody>
            {groupNC ? (<>
              {grows.map(g => {
                const best = g.companies.reduce((acc, c) => { const i = CU.STAGES.indexOf(c.funnel); return i > acc.i ? { i, f: c.funnel } : acc; }, { i: -1, f: "" });
                const countries = [...new Set(g.companies.map(c => normCustCountry(c.country)).filter(Boolean))];
                const owners = [...new Set(g.companies.map(c => c.owner).filter(Boolean))];
                const isOpen = ncExpanded.has(g.key);
                return (
                  <React.Fragment key={g.key}>
                  <tr className={"row-click ret-acc-row" + (isOpen ? " open" : "")} onClick={() => toggleNC(g.key)}>
                    {canDelete && <td className="col-check"><GroupRowCheck ids={g.companies.map(c => c.id)} selected={sel.selected} onToggle={toggleGroupSel} /></td>}
                    <td>
                      <div className="ret-cust-cell">
                        <button className={"ret-exp-btn" + (isOpen ? " open" : "")} aria-label="expand" onClick={e => { e.stopPropagation(); toggleNC(g.key); }}>
                          <span className="ret-exp-caret"><Icon d='<path d="M6 9l6 6 6-6"/>' size={15} /></span>
                        </button>
                        <div>
                          <strong className="cell-main"><span className="nc-chip nc-chip-navy">{g.code}</span></strong>
                          <button className="ret-detail-link" style={{ marginTop: 3 }} onClick={e => { e.stopPropagation(); onOpen(g.companies[0].id); }}>{t("ret_view_detail")} →</button>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm">{countries.join(", ") || "—"}</td>
                    <td className="hide-sm"><span className="count-pill">{g.companies.length} {t("nc_companies")}</span></td>
                    <td className="cell-status"><span className="dim">—</span></td>
                    <td><StageBadge stage={best.f || "New"} t={t} /></td>
                    <td className="hide-sm">{owners.length ? owners.map(o => <span key={o} style={{ marginRight: 4 }}><OwnerChip code={o} t={t} /></span>) : "—"}</td>
                  </tr>
                  {isOpen && g.companies.map(c => (
                    <tr key={c.id} className={"row-click nc-sub-row" + (sel.isSel(c.id) ? " row-selected" : "")} onClick={() => onOpen(c.id)}>
                      {canDelete && <td className="col-check"><RowCheck id={c.id} selected={sel.selected} toggle={sel.toggle} /></td>}
                      <td className="nc-sub-cell">
                        <strong className="cell-main">{c.name || c.shortName}</strong>
                        <small className="cell-sub">{c.bizId ? t("cu_biz_id") + ": " + c.bizId : (c.city || c.email || "")}</small>
                      </td>
                      <td className="hide-sm">{normCustCountry(c.country)}<small className="cell-sub">{c.city}</small></td>
                      <td className="hide-sm">{c.type || "—"}</td>
                      <td className="cell-status">{c.status || <span className="dim">—</span>}</td>
                      <td><StageBadge stage={c.funnel} t={t} /></td>
                      <td className="hide-sm"><OwnerChip code={c.owner} t={t} /></td>
                    </tr>
                  ))}
                  </React.Fragment>
                );
              })}
              {grows.length === 0 && <tr><td colSpan={colCount} className="empty">{t("cu_no_results")}</td></tr>}
            </>) : (<>
              {rows.map(c => {
              const isLead = c.funnel === "Warm Lead" || c.funnel === "Hot Lead";
              return (
              <tr key={c.id} className={"row-click" + (isLead ? " row-lead" : "") + (sel.isSel(c.id) ? " row-selected" : "")} onClick={() => onOpen(c.id)}>
                {canDelete && <td className="col-check"><RowCheck id={c.id} selected={sel.selected} toggle={sel.toggle} /></td>}
                <td>
                  <strong className="cell-main">{c.shortName || c.name} <span className="nc-chip">{CU.nameCodeOf(c)}</span></strong>
                  <small className="cell-sub">{c.name !== (c.shortName || c.name) ? c.name : (c.city || c.email || "")}</small>
                </td>
                <td className="hide-sm">{normCustCountry(c.country)}<small className="cell-sub">{c.city}</small></td>
                <td className="hide-sm">{c.type || "—"}</td>
                <td className="cell-status">{c.status || <span className="dim">—</span>}</td>
                <td><StageBadge stage={c.funnel} t={t} /></td>
                <td className="hide-sm"><OwnerChip code={c.owner} t={t} /></td>
              </tr>
              );
            })}
              {rows.length === 0 && <tr><td colSpan={colCount} className="empty">{t("cu_no_results")}</td></tr>}
            </>)}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="pager">
            <span>{t("cu_showing")} {page * PER + 1}–{Math.min((page + 1) * PER, units.length)} {t("cu_of")} {units.length}</span>
            <div className="pager-btns">
              <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
              <span className="pager-n">{page + 1}/{pages}</span>
              <button className="btn btn-ghost" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          </div>
        )}
      </div>
      {canDelete && <BulkBar count={sel.count} noun={t("customers")} allIds={filteredIds} onSelectAll={ids => sel.setSelected(new Set(ids))} onDelete={bulkDelete} onClear={sel.clear} onEdit={canEditPerm ? () => setBulkEdit(true) : null} />}
      {bulkEdit && <BulkEditCustomersModal ids={[...sel.selected]} onClose={() => setBulkEdit(false)} onDone={sel.clear} />}
      {adding && <AddCustomerModal onClose={() => setAdding(false)} onCreated={onOpen} />}
      {importing && <ImportCSVModal onClose={() => setImporting(false)} />}
      {fixLead && <LeadSourceFixModal values={legacyLead} onClose={() => setFixLead(false)} />}
    </div>
  );
}

/* ---- normalise hand-typed lead sources onto the choice list ---- */
function LeadSourceFixModal({ values, onClose }) {
  const { t, customers, updateCustomer } = useApp();
  const [map, setMap] = useState(() => { const m = {}; (values || []).forEach(v => { m[v.value] = guessLeadSource(v.value); }); return m; });
  const [done, setDone] = useState(null);
  const set = (k, v) => setMap(prev => ({ ...prev, [k]: v }));
  const planned = (values || []).filter(v => map[v.value]);
  const rowCount = planned.reduce((s, v) => s + v.count, 0);
  const apply = () => {
    if (!planned.length) return;
    const want = {};
    planned.forEach(v => { want[v.value] = map[v.value] === "—" ? "" : map[v.value]; });
    let n = 0;
    (customers || []).forEach(c => {
      const s = (c.leadSource || "").trim();
      if (!Object.prototype.hasOwnProperty.call(want, s) || want[s] === s) return;
      updateCustomer(c.id, { leadSource: want[s] }, "lead source");
      n++;
    });
    setDone(n);
  };
  if (done != null) return (
    <Modal title={t("cu_lead_fix")} onClose={onClose} width={460}>
      <div className="import-report">
        <div className="import-report-icon">✓</div>
        <h3>{t("im_done")}</h3>
        <p>{t("cu_lead_fix_done").replace("{n}", String(done))}</p>
        <div className="modal-actions" style={{ justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
    </Modal>
  );
  return (
    <Modal title={t("cu_lead_fix")} onClose={onClose} width={560}>
      <p className="import-note">{t("cu_lead_fix_hint")}</p>
      <div className="lead-fix-grid">
        <div className="lead-fix-head">{t("cu_lead_source")}</div>
        <div className="lead-fix-head num">{t("customers")}</div>
        <div className="lead-fix-head">→</div>
        {(values || []).map(v => (
          <React.Fragment key={v.value}>
            <div className="lead-fix-old">{v.value}</div>
            <div className="lead-fix-n">{v.count}</div>
            <select className="select" value={map[v.value] || ""} onChange={e => set(v.value, e.target.value)}>
              <option value="">{t("cu_lead_keep")}</option>
              {CU_LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="—">{t("cu_lead_clear")}</option>
            </select>
          </React.Fragment>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!planned.length} onClick={apply}>
          {t("cu_lead_fix_apply").replace("{n}", String(rowCount))}
        </button>
      </div>
    </Modal>
  );
}

/* Group-row checkbox: toggles all member companies of one Name-Code group
   without wiping selections made in other groups. */
function GroupRowCheck({ ids, selected, onToggle }) {
  const ref = React.useRef(null);
  const allOn = ids.length > 0 && ids.every(id => selected.has(id));
  const some = ids.some(id => selected.has(id));
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = some && !allOn; }, [some, allOn]);
  return <input ref={ref} type="checkbox" className="row-check" checked={allOn} onChange={() => onToggle(ids)} onClick={e => e.stopPropagation()} aria-label="select group" />;
}

/* ================= Bulk edit ================= */
// One patch, many customers. A field is written only when its checkbox is ticked, so an
// empty control never blanks out data the user did not mean to touch.
function BulkEditCustomersModal({ ids, onClose, onDone }) {
  const { t, isBoss, assignablePics, repCountry, updateCustomers } = useApp();
  const FIELDS = [
    ["owner", t("owner")], ["pic", t("cu_pic")], ["group", t("pol_group")],
    ["status", t("status")], ["type", t("type")], ["leadSource", t("cu_lead_source")],
    ["country", t("country")], ["city", t("city")],
  ];
  const [on, setOn] = useState({});
  const [v, setV] = useState({ owner: "", pic: "", group: "", status: "", type: "", leadSource: "", country: CUST_MARKETS[0], city: "" });
  const set = (k, val) => setV(p => ({ ...p, [k]: val }));
  const active = FIELDS.filter(([k]) => on[k]);
  const apply = () => {
    const patch = {};
    active.forEach(([k]) => { patch[k] = v[k]; });
    if (!Object.keys(patch).length) return;
    if (patch.status) patch.funnel = CU.STATUS_TO_FUNNEL[patch.status] || "New";
    updateCustomers(ids, patch, "Bulk edit · " + active.map(([, l]) => l).join(", "));
    onDone && onDone();
    onClose();
  };
  const ctrl = (k) => {
    const d = !on[k];
    if (k === "owner") return (
      <select className="select" disabled={d} value={v.owner} onChange={e => set("owner", e.target.value)}>
        <option value="">{t("unassigned")}</option>
        {picScope(assignablePics, v.country, repCountry, v.owner).map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
    if (k === "group") return (
      <select className="select" disabled={d} value={v.group} onChange={e => set("group", e.target.value)}>
        <option value="">{t("none")}</option>
        {CU.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
    );
    if (k === "status") return (
      <select className="select" disabled={d} value={v.status} onChange={e => set("status", e.target.value)}>
        <option value="">{t("stage_New")}</option>
        {CU.ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
    if (k === "type") return (
      <select className="select" disabled={d} value={v.type} onChange={e => set("type", e.target.value)}>
        <option value="">{t("none")}</option>
        {["Dealer", "End-User", "Slitter", "System Integrator", "Printing Service"].map(x => <option key={x}>{x}</option>)}
      </select>
    );
    if (k === "leadSource") return (
      <select className="select" disabled={d} value={v.leadSource} onChange={e => set("leadSource", e.target.value)}>
        <option value="">—</option>
        {leadSourceOpts(v.leadSource).map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
    if (k === "country") return (
      <select className="select" disabled={d} value={v.country} onChange={e => set("country", e.target.value)}>
        {CUST_MARKETS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
    return <input className="input" disabled={d} value={v[k]} onChange={e => set(k, e.target.value)} />;
  };
  return (
    <Modal title={t("cu_bulk_edit_title").replace("{n}", String(ids.length))} onClose={onClose} width={600}>
      <p className="import-note">{t("cu_bulk_edit_note")}</p>
      <div className="bulk-edit-grid">
        {FIELDS.map(([k, label]) => (
          <label className={"bulk-edit-row" + (on[k] ? " on" : "")} key={k}>
            <input type="checkbox" checked={!!on[k]} onChange={() => setOn(p => ({ ...p, [k]: !p[k] }))} />
            <span className="bulk-edit-label">{label}</span>
            {ctrl(k)}
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!active.length} onClick={apply}>
          {t("cu_bulk_edit_apply").replace("{n}", String(ids.length))}
        </button>
      </div>
    </Modal>
  );
}

/* ================= Duplicates panel ================= */
function DupPanel({ dups, hasExact, onOpen }) {
  const { t } = useApp();
  if (dups.length === 0) return null;
  return (
    <div className={"dup-panel" + (hasExact ? " dup-block" : "")}>
      <strong className="dup-title">⚠ {t("cu_dup_title")}</strong>
      <p className="dup-msg">{hasExact ? t("cu_dup_block") : t("cu_dup_warn")}</p>
      <div className="dup-list">
        {dups.map(d => (
          <div className="dup-row" key={d.customer.id}>
            <div className="dup-info">
              <strong>{d.customer.shortName || d.customer.name}
                {CU.nameCodeOf(d.customer) && <span className="nc-chip" style={{ marginLeft: 6 }}>{CU.nameCodeOf(d.customer)}</span>}
              </strong>
              <small>{[d.customer.country, d.customer.owner || t("unassigned")].join(" · ")}</small>
            </div>
            <span className="dup-reasons">{d.reasons.map(r => t("dup_" + r)).join(", ")}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => onOpen(d.customer.id)}>{t("cu_dup_open")} →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Name Code (parent) typeahead =================
   Sale types the parent Name Code. Existing codes show in a dropdown (pick to
   join that parent); a brand-new value creates a new parent. The company name
   drives an auto-suggested acronym. */
function NameCodeField({ value, onChange, companyName, customers, autoFocus, invalid }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => CU.nameCodeGroups(customers), [customers]);
  const suggestion = useMemo(() => CU.suggestNameCode(companyName), [companyName]);
  const key = CU.nameCodeKey(value);
  const exact = groups[key];
  const matches = useMemo(() => {
    const arr = Object.values(groups);
    const filtered = key ? arr.filter(g => g.key.includes(key)) : arr;
    return filtered.sort((a, b) => b.companies.length - a.companies.length).slice(0, 8);
  }, [groups, key]);
  const pick = (code) => { onChange(code); setOpen(false); };
  return (
    <div className="fc-typeahead">
      <input className={"input" + (invalid ? " invalid" : "")} value={value} autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder={suggestion ? suggestion : "e.g. TDT"} autoComplete="off" />
      {value && (
        <small className={"nc-state " + (exact ? "nc-join" : "nc-new")}>
          {exact ? t("nc_joins").replace("{n}", exact.companies.length) : t("nc_creates")}
        </small>
      )}
      {open && (matches.length > 0 || (suggestion && !value)) && (
        <div className="fc-typeahead-list">
          {suggestion && !value && (
            <button type="button" className="fc-typeahead-item" onMouseDown={e => e.preventDefault()} onClick={() => pick(suggestion)}>
              <strong>{suggestion} <span className="nc-chip nc-chip-suggest">{t("nc_suggested")}</span></strong>
              <small>{t("nc_from_name")}</small>
            </button>
          )}
          {matches.map(g => (
            <button type="button" key={g.key} className="fc-typeahead-item" onMouseDown={e => e.preventDefault()} onClick={() => pick(g.code)}>
              <strong>{g.code}</strong>
              <small>{g.companies.length} {g.companies.length === 1 ? t("nc_company_one") : t("nc_company_many")} · {g.companies.slice(0, 3).map(c => c.shortName || c.name).join(", ")}{g.companies.length > 3 ? "…" : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Add customer ================= */
const RE_PHONE = /^\+?[\d\s\-().]{7,20}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_WEB = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}([\/?#]\S*)?$/i;
function validPhone(v) { return RE_PHONE.test(v.trim()) && (v.match(/\d/g) || []).length >= 7; }

function AddCustomerModal({ onClose, onCreated }) {
  const { t, user, isBoss, assignablePics, repCountry, users, customers, addCustomer, productCountry } = useApp();
  const [f, setF] = useState({
    name: "", nameCode: "", shortName: "", bizId: "", country: (CUST_MARKETS.includes(CU.normCountry(productCountry || "")) ? CU.normCountry(productCountry) : CUST_MARKETS[0]), city: "", district: "", type: "",
    phone: "", email: "", website: "", pic: "", leadSource: "", status: "", note: "", group: "",
    owner: isBoss ? "" : (user.salesCode || ""),
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  // auto-suggest a Name Code from the company name until the user types one
  useEffect(() => {
    if (f.name.trim() && !f.nameCode) {
      const s = CU.suggestNameCode(f.name);
      if (s) setF(prev => prev.nameCode ? prev : { ...prev, nameCode: s });
    }
  }, [f.name]);
  const [tried, setTried] = useState(false);
  const countries = [...new Set(customers.map(c => c.country))].sort();
  const salesCodes = [...new Set(users.filter(u => u.salesCode).map(u => u.salesCode))];

  const errors = {};
  if (!f.name.trim() || f.name.trim().length < 2) errors.name = t("err_required");
  if (!f.nameCode.trim()) errors.nameCode = t("err_required");
  if (!f.country.trim()) errors.country = t("err_required");
  if (!f.type) errors.type = t("err_required");
  if (!f.phone.trim()) errors.phone = t("err_required");
  else if (!validPhone(f.phone)) errors.phone = t("err_phone");
  if (f.email.trim() && !RE_EMAIL.test(f.email.trim())) errors.email = t("err_email");
  if (f.website.trim() && !RE_WEB.test(f.website.trim())) errors.website = t("err_website");
  const bizLen = CU.bizIdIssue(f.bizId, f.country);
  if (bizLen) errors.bizId = t("err_biz_id").replace("{n}", bizLen);

  const err = (k) => (tried || f[k]) && errors[k] ? errors[k] : null;
  const cls = (k) => "input" + (err(k) ? " invalid" : "");

  const dups = useMemo(() => CU.findDuplicates(f, customers), [f.name, f.shortName, f.bizId, f.phone, f.email, customers]);
  const hasExact = dups.some(d => d.exact);
  const valid = Object.keys(errors).length === 0 && !hasExact;

  const submit = () => {
    setTried(true);
    if (!valid) return;
    const c = addCustomer({ ...f, name: f.name.trim(), nameCode: f.nameCode.trim(), bizId: CU.formatBizId(f.bizId, f.country), owner: f.owner || "" });
    onClose();
    onCreated && onCreated(c.id);
  };
  return (
    <Modal title={t("cu_add")} onClose={onClose} width={640}>
      <div className="form-grid">
        <Field label={t("cu_company")} required>
          <input className={cls("name")} value={f.name} onChange={e => set("name", e.target.value)} placeholder="Company Co., Ltd." autoFocus />
          {err("name") && <small className="field-err">{err("name")}</small>}
        </Field>
        <Field label={t("nc_label")} required>
          <NameCodeField value={f.nameCode} onChange={v => set("nameCode", v)} companyName={f.name} customers={customers} invalid={!!err("nameCode")} />
          {err("nameCode") && <small className="field-err">{err("nameCode")}</small>}
        </Field>
        <Field label={t("cu_biz_id")}>
          <input className={cls("bizId")} value={f.bizId} onChange={e => set("bizId", e.target.value)}
            onBlur={e => set("bizId", CU.formatBizId(e.target.value, f.country))} placeholder="0105xxxxxx" />
          {err("bizId") ? <small className="field-err">{err("bizId")}</small> : <small className="field-hint">{t("cu_biz_id_hint")}</small>}
        </Field>
        <Field label={t("country")} required>
          <select className={cls("country")} value={normCustCountry(f.country)} onChange={e => set("country", e.target.value)}>
            {CUST_MARKETS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {err("country") && <small className="field-err">{err("country")}</small>}
        </Field>
        <Field label={t("city")}>
          <input className="input" value={f.city} onChange={e => set("city", e.target.value)} />
        </Field>
        <Field label={t("district")}>
          <input className="input" value={f.district} onChange={e => set("district", e.target.value)} />
        </Field>
        <Field label={t("type")} required>
          <select className={"select" + (err("type") ? " invalid" : "")} value={f.type} onChange={e => set("type", e.target.value)}>
            <option value="">{t("none")}</option>
            {["Dealer", "End-User", "Slitter", "System Integrator", "Printing Service"].map(x => <option key={x}>{x}</option>)}
          </select>
          {err("type") && <small className="field-err">{err("type")}</small>}
        </Field>
        <Field label={t("cu_lead_source")}>
          <select className="select" value={f.leadSource} onChange={e => set("leadSource", e.target.value)}>
            <option value="">—</option>
            {leadSourceOpts(f.leadSource).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("phone")} required>
          <input className={cls("phone")} value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="+84 / +66 …" />
          {err("phone") && <small className="field-err">{err("phone")}</small>}
        </Field>
        <Field label={t("email")}>
          <input className={cls("email")} value={f.email} onChange={e => set("email", e.target.value)} placeholder="sales@…" />
          {err("email") && <small className="field-err">{err("email")}</small>}
        </Field>
        <Field label={t("website")}>
          <input className={cls("website")} value={f.website} onChange={e => set("website", e.target.value)} />
          {err("website") && <small className="field-err">{err("website")}</small>}
        </Field>
        <Field label={t("cu_pic")}>
          <input className="input" value={f.pic} onChange={e => set("pic", e.target.value)} />
        </Field>
        <Field label={t("status")}>
          <select className="select" value={f.status} onChange={e => set("status", e.target.value)}>
            <option value="">{t("stage_New")}</option>
            {CU.ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("pol_group")}>
          <select className="select" value={f.group} onChange={e => set("group", e.target.value)}>
            <option value="">{t("none")}</option>
            {CU.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
        <Field label={t("owner")}>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.owner} onChange={e => set("owner", e.target.value)}>
              {isBoss && <option value="">{t("unassigned")}</option>}
              {picScope(assignablePics, f.country, repCountry, f.owner).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input className="input" value={f.owner} disabled />
          )}
        </Field>
      </div>
      <Field label={t("note")}>
        <textarea className="input" rows="2" value={f.note} onChange={e => set("note", e.target.value)}></textarea>
      </Field>
      <DupPanel dups={dups} hasExact={hasExact} onOpen={(id) => { onClose(); onCreated && onCreated(id); }} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={hasExact || (tried && !valid)} onClick={submit}>{t("cu_create")}</button>
      </div>
    </Modal>
  );
}

/* ================= Edit customer ================= */
function EditCustomerModal({ customer, onClose }) {
  const { t, isBoss, assignablePics, repCountry, users, customers, updateCustomer } = useApp();
  const [f, setF] = useState({
    name: customer.name || "", nameCode: customer.nameCode || "", shortName: customer.shortName || "", bizId: customer.bizId || "",
    country: normCustCountry(customer.country) || CUST_MARKETS[0], city: customer.city || "", district: customer.district || "",
    type: customer.type || "", leadSource: customer.leadSource || "",
    phone: customer.phone || "", phone2: customer.phone2 || "", phone3: customer.phone3 || "",
    email: customer.email || "", website: customer.website || "",
    pic: customer.pic || "", title: customer.title || "", dept: customer.dept || "",
    owner: customer.owner || "", note: customer.note || "", group: custGroupId(customer.group),
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const [tried, setTried] = useState(false);
  const countries = [...new Set([...customers.map(c => CU.normCountry(c.country)), ...CU.MARKETS].filter(Boolean))].sort();
  const salesCodes = [...new Set(users.filter(u => u.salesCode).map(u => u.salesCode))];

  const errors = {};
  if (!f.name.trim() || f.name.trim().length < 2) errors.name = t("err_required");
  if (f.email.trim() && !RE_EMAIL.test(f.email.trim())) errors.email = t("err_email");
  if (f.website.trim() && !RE_WEB.test(f.website.trim())) errors.website = t("err_website");
  const bizLen = CU.bizIdIssue(f.bizId, f.country);
  if (bizLen) errors.bizId = t("err_biz_id").replace("{n}", bizLen);
  const err = (k) => (tried || f[k]) && errors[k] ? errors[k] : null;
  const cls = (k) => "input" + (err(k) ? " invalid" : "");
  const valid = Object.keys(errors).length === 0;

  const submit = () => {
    setTried(true);
    if (!valid) return;
    updateCustomer(customer.id, {
      ...f, name: f.name.trim(), nameCode: f.nameCode.trim(), shortName: f.shortName.trim(),
      bizId: CU.formatBizId(f.bizId, f.country),
    }, "Edited profile");
    onClose();
  };
  return (
    <Modal title={t("cu_edit")} onClose={onClose} width={640}>
      <div className="form-grid">
        <Field label={t("cu_company")} required>
          <input className={cls("name")} value={f.name} onChange={e => set("name", e.target.value)} autoFocus />
          {err("name") && <small className="field-err">{err("name")}</small>}
        </Field>
        <Field label={t("nc_label")}>
          <NameCodeField value={f.nameCode} onChange={v => set("nameCode", v)} companyName={f.name} customers={customers} />
        </Field>
        <Field label={t("cu_short_name")}>
          <input className="input" value={f.shortName} onChange={e => set("shortName", e.target.value)} />
        </Field>
        <Field label={t("cu_biz_id")}>
          <input className={cls("bizId")} value={f.bizId} onChange={e => set("bizId", e.target.value)}
            onBlur={e => set("bizId", CU.formatBizId(e.target.value, f.country))} />
          {err("bizId") ? <small className="field-err">{err("bizId")}</small> : <small className="field-hint">{t("cu_biz_id_hint")}</small>}
        </Field>
        <Field label={t("country")}>
          <select className="select" value={normCustCountry(f.country)} onChange={e => set("country", e.target.value)}>
            {CUST_MARKETS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t("city")}>
          <input className="input" value={f.city} onChange={e => set("city", e.target.value)} />
        </Field>
        <Field label={t("district")}>
          <input className="input" value={f.district} onChange={e => set("district", e.target.value)} />
        </Field>
        <Field label={t("type")}>
          <select className="select" value={f.type} onChange={e => set("type", e.target.value)}>
            <option value="">{t("none")}</option>
            {["Dealer", "End-User", "Slitter", "System Integrator", "Printing Service"].map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label={t("cu_lead_source")}>
          <select className="select" value={f.leadSource} onChange={e => set("leadSource", e.target.value)}>
            <option value="">—</option>
            {leadSourceOpts(f.leadSource).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("pol_group")}>
          <select className="select" value={f.group} onChange={e => set("group", e.target.value)}>
            <option value="">{t("none")}</option>
            {CU.GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
        <Field label={t("phone")}>
          <input className="input" value={f.phone} onChange={e => set("phone", e.target.value)} />
        </Field>
        <Field label={t("phone") + " 2"}>
          <input className="input" value={f.phone2} onChange={e => set("phone2", e.target.value)} />
        </Field>
        <Field label={t("phone") + " 3"}>
          <input className="input" value={f.phone3} onChange={e => set("phone3", e.target.value)} />
        </Field>
        <Field label={t("email")}>
          <input className={cls("email")} value={f.email} onChange={e => set("email", e.target.value)} />
          {err("email") && <small className="field-err">{err("email")}</small>}
        </Field>
        <Field label={t("website")}>
          <input className={cls("website")} value={f.website} onChange={e => set("website", e.target.value)} />
          {err("website") && <small className="field-err">{err("website")}</small>}
        </Field>
        <Field label={t("cu_pic")}>
          <input className="input" value={f.pic} onChange={e => set("pic", e.target.value)} />
        </Field>
        <Field label={t("cu_title_role")}>
          <input className="input" value={f.title} onChange={e => set("title", e.target.value)} />
        </Field>
        <Field label={t("cu_dept")}>
          <input className="input" value={f.dept} onChange={e => set("dept", e.target.value)} />
        </Field>
        <Field label={t("owner")}>
          {(isBoss || assignablePics.length > 1) ? (
            <select className="select" value={f.owner} onChange={e => set("owner", e.target.value)}>
              {isBoss && <option value="">{t("unassigned")}</option>}
              {picScope(assignablePics, f.country, repCountry, f.owner).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input className="input" value={f.owner} disabled />
          )}
        </Field>
      </div>
      <Field label={t("note")}>
        <textarea className="input" rows="2" value={f.note} onChange={e => set("note", e.target.value)}></textarea>
      </Field>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={tried && !valid} onClick={submit}>{t("save")}</button>
      </div>
    </Modal>
  );
}

/* ================= Import CSV ================= */
const IMPORT_FIELDS = [
  ["name", "cu_company", true],
  ["nameCode", "nc_label"],
  ["bizId", "cu_biz_id"],
  ["group", "pol_group"],
  ["status", "status"],
  ["funnel", "funnel"],
  ["country", "country"],
  ["city", "city"],
  ["district", "district"],
  ["address", "address"],
  ["type", "type"],
  ["leadSource", "cu_lead_source"],
  ["pic", "cu_pic"],
  ["title", "cu_imp_title"],
  ["dept", "cu_imp_dept"],
  ["phone", "phone"],
  ["phone2", "cu_imp_phone2"],
  ["phone3", "cu_imp_phone3"],
  ["email", "email"],
  ["website", "website"],
  ["created", "cu_created"],
  ["owner", "owner"],
  ["note", "note"],
];
const IMPORT_GUESS = {
  name: /company|name|công ty|บริษัท/i, nameCode: /name\s*code|parent|mã nhóm|mã cha|nhóm cha|short\s*code/i, shortName: /short|tên rút|tên tắt|ชื่อย่อ/i, bizId: /biz|tax|business id|mã số|ทะเบียน/i,
  group: /group|nhóm|กลุ่ม/i, funnel: /funnel|pipeline|phễu|stage|ไปป์ไลน์/i,
  country: /country|quốc gia|ประเทศ/i, city: /city|thành phố|เมือง/i, district: /district|quận|huyện|เขต/i,
  address: /address|location|địa chỉ|ที่อยู่/i, type: /type|loại|ประเภท/i, leadSource: /source|nguồn|แหล่ง/i,
  pic: /pic|contact name|người liên|ผู้ติดต่อ/i, title: /title|role|position|chức danh|chức vụ|ตำแหน่ง/i,
  dept: /dept|department|phòng ban|phòng|แผนก/i,
  phone: /phone|tel|sđt|โทร/i, phone2: /phone\s*2|tel\s*2|sđt\s*2|โทร.*2/i, phone3: /phone\s*3|tel\s*3|sđt\s*3|โทร.*3/i,
  email: /mail/i, website: /web|url/i,
  created: /lead\s*created|created|ngày tạo|วันที่สร้าง/i,
  status: /status|trạng thái|สถานะ/i, owner: /owner|employee|sale|phụ trách/i, note: /note|ghi chú/i,
};

function ImportCSVModal({ onClose }) {
  const { t, user, isBoss, customers, addCustomersBulk } = useApp();
  const [book, setBook] = useState(null); // { sheets:[{name,rows}] } when an Excel file has >1 sheet
  const [rows, setRows] = useState(null); // [headers, ...data]
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState({});
  const _defCtry = useApp().productCountry || CU.MARKETS[0];
  const [country, setCountry] = useState(_defCtry); // market of this file, for rows without a country
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const importCountries = [...new Set([...CU.MARKETS, ...customers.map(c => CU.normCountry(c.country))].filter(Boolean))].sort();

  const applySheet = (sheetRows) => {
    if (!sheetRows || !sheetRows.length) { setError(t("im_excel_err")); return; }
    setRows(sheetRows);
    const headers = sheetRows[0];
    const m = {};
    IMPORT_FIELDS.forEach(([field]) => {
      const idx = headers.findIndex(h => IMPORT_GUESS[field] && IMPORT_GUESS[field].test(h));
      if (idx >= 0 && !Object.values(m).includes(idx)) m[field] = idx;
    });
    setMap(m);
    setReport(null);
  };

  const onFile = (file) => {
    setError("");
    setFileName(file.name);
    CU.readImportFile(file).then(({ sheets }) => {
      if (!sheets.length) { setError(t("im_excel_err")); return; }
      if (sheets.length > 1) { setBook({ sheets }); setRows(null); }
      else applySheet(sheets[0].rows);
    }).catch(() => setError(t("im_excel_err")));
  };

  const reset = () => { setBook(null); setRows(null); setMap({}); setError(""); };

  const headers = rows ? rows[0] : [];
  const dataRows = rows ? rows.slice(1) : [];
  const canImport = map.name !== undefined && dataRows.length > 0;

  // Hand the failing source rows back to the user: their own columns, verbatim, plus a
  // Reason column — fix in Excel, re-import, done.
  const downloadIssues = (issues) => {
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const head = [t("pol_iss_col_row"), ...headers.map(h => String(h || "")), t("pol_iss_col_reason")];
    const body = issues.map(is => { const src = dataRows[is.row - 2] || []; return [is.row, ...headers.map((_, i) => src[i] == null ? "" : src[i]), is.reason || ""]; });
    const csv = [head, ...body].map(r => r.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "customers-errors-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const runImport = () => {
    if (!canImport) return;
    const issues = [];
    const list = dataRows.map((r, ri) => {
      const o = { _row: ri + 2 };
      IMPORT_FIELDS.forEach(([field]) => {
        if (map[field] !== undefined && r[map[field]] !== undefined) o[field] = String(r[map[field]]).trim();
      });
      // Country is stored CANONICAL ("VN" → "Vietnam"), whatever the file says, so the
      // customer list, filters and price lists never split one market into two values.
      o.country = CU.normCountry(o.country) || country;
      // Name Code and Short name are the same thing — mirror so downstream
      // code that reads shortName keeps working after we dropped that column.
      if (o.nameCode && !o.shortName) o.shortName = o.nameCode;
      if (!isBoss) o.owner = user.salesCode || "";
      return o;
    }).filter(o => {
      if (o.name && o.name.length >= 2) return true;
      issues.push({ row: o._row, reason: t("im_iss_missing").replace("{f}", t("cu_company")) });
      return false;
    });
    const res = addCustomersBulk(list);
    const bulkIssues = (res.issues || []).map(is => ({ row: is.row, reason: is.reason || t("im_iss_dup") }));
    setReport({ ...res, issues: [...issues, ...bulkIssues].sort((a, b) => a.row - b.row), skipped: issues.length + (res.skipped || 0) });
  };

  return (
    <Modal title={t("im_title")} onClose={onClose} width={680}>
      {error ? (
        <div>
          <p className="import-warn">{error}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" onClick={reset}>{t("im_replace")}</button>
          </div>
        </div>
      ) : !rows && book ? (
        <ImportSheetPicker t={t} fileName={fileName} sheets={book.sheets}
          onPick={i => applySheet(book.sheets[i].rows)} onReplace={reset} />
      ) : !rows ? (
        <div>
          <ImportDrop t={t} onFile={onFile} />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="link-btn" style={{ marginLeft: 0 }} onClick={() => {
              const ex = { name: ["ABC Label Co., Ltd.", "XYZ Printing"], shortName: ["ABC", "XYZ"], bizId: ["0312345678", "0398765432"], group: ["A", "B"], status: ["", ""], funnel: ["New", "Contacted"], country: ["Vietnam", "Thailand"], city: ["HCMC", "Bangkok"], type: ["Converter", "Printer"], leadSource: ["Referral", "Website"], pic: ["NOOM", "ICE"], phone: ["+84 28 1234 5678", "+66 2 123 4567"], email: ["sales@abc.vn", "info@xyz.co.th"], website: ["abc.vn", "xyz.co.th"] };
              window.downloadCSVTemplate("customers", IMPORT_FIELDS.map(([f, l, req]) => t(l) + (req ? " *" : "")), [0, 1].map(i => IMPORT_FIELDS.map(([f]) => (ex[f] || [])[i] || "")));
            }}>
              <Icon d={ICONS.download} size={13} /> {t("im_template")}
            </button>
          </div>
        </div>
      ) : report ? (
        <div className={"import-report" + (report.skipped > 0 ? " import-report-warn" : "")}>
          <div className="import-report-icon">{report.skipped > 0 ? "!" : "\u2713"}</div>
          <h3>{report.skipped > 0 ? t("im_done_partial") : t("im_done")}</h3>
          <p><strong>{report.imported}</strong> {t("im_imported")} · <strong>{report.updated || 0}</strong> {t("im_updated")} · <strong>{report.skipped}</strong> {t("im_skipped")}</p>
          {report.matchedByName > 0 && <p className="dim">{t("im_matched_name").replace("{n}", String(report.matchedByName))}</p>}
          <div className="modal-actions" style={{ justifyContent: "center" }}>
            {report.issues && report.issues.length > 0 && (
              <button className="btn btn-ghost" onClick={() => downloadIssues(report.issues)}>
                <Icon d={ICONS.download} size={14} /> {t("pol_iss_dl").replace("{n}", String(report.issues.length))}
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="import-fileline">
            <Icon d={ICONS.file} size={15} /> <strong>{fileName}</strong>
            <span className="dim">· {dataRows.length} {t("im_rows")}</span>
            {book && book.sheets.length > 1 && <button className="link-btn" onClick={() => setRows(null)}>{t("im_pick_sheet")}</button>}
            <button className="link-btn" onClick={reset}>{t("im_replace")}</button>
          </div>
          <p className="import-note">{t("im_dup_note")}</p>
          <div className="import-currency">
            <div className="import-currency-main">
              <span className="import-currency-label">{t("country")}</span>
              <select className="select" value={country} onChange={e => setCountry(e.target.value)}>
                {importCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <small className="import-currency-hint" style={{ marginLeft: 10 }}>{t("im_country_note")}</small>
            </div>
          </div>
          <div className="map-grid">
            <div className="map-head">{t("im_map")}</div>
            {IMPORT_FIELDS.filter(([field]) => !(field === "owner" && !isBoss)).map(([field, labelKey, req]) => (
              <div className="map-row" key={field}>
                <span className="map-field">
                  {t(labelKey)}{req ? <em> *</em> : null}
                </span>
                <select className="select" value={map[field] !== undefined ? map[field] : ""}
                  onChange={e => setMap(prev => ({ ...prev, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">{t("im_skip")}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{(h ? String(h).slice(0, 60) : "(col " + (i + 1) + ")")}</option>)}
                </select>
                <span className="map-sample dim">{map[field] !== undefined && dataRows[0] ? (dataRows[0][map[field]] || "").slice(0, 36) : ""}</span>
              </div>
            ))}
          </div>
          {!canImport && <p className="import-warn">{t("im_need_name")}</p>}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={!canImport} onClick={runImport}>{t("im_run")} ({dataRows.length})</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ================= Profile ================= */
function InfoRow({ icon, label, value, href, extra }) {
  if (!value) return null;
  return (
    <div className="info-row">
      <span className="info-icon"><Icon d={icon} size={15} /></span>
      <div className="info-rest">
        <small>{label}</small>
        {href ? <a href={href} target="_blank" rel="noopener">{value}</a> : <span>{value}</span>}
        {extra}
      </div>
    </div>
  );
}

const LOG_ICONS = { note: "note", call: "phone", file: "file", meeting: "calendar", status: "pipelines" };

/* ================= Lead Nurturing (contact history + decision maker + next action) ================= */
function LeadNurturingCard({ customerId }) {
  const { t, customers, updateCustomer, addContactLog } = useApp();
  const c = customers.find(x => x.id === customerId);
  // All hooks first — an early return above them changes the hook count and crashes React.
  const [channel, setChannel] = useState("Call");
  const [summary, setSummary] = useState("");
  const [naDate, setNaDate] = useState((c && c.nextActionDate) || "");
  const [naNote, setNaNote] = useState((c && c.nextActionNote) || "");
  if (!c) return null;

  const logContact = () => {
    if (!summary.trim()) return;
    addContactLog(customerId, { channel, summary: summary.trim() });
    setSummary("");
  };
  const saveNextAction = () => {
    updateCustomer(customerId, { nextActionDate: naDate, nextActionNote: naNote }, "Updated next action");
  };
  const toggleDecisionMaker = () => {
    updateCustomer(customerId, { decisionMaker: !c.decisionMaker }, c.decisionMaker ? "Marked PIC as non-decision-maker" : "Marked PIC as decision maker");
  };
  const saveCompanySize = (v) => {
    updateCustomer(customerId, { companySizeEstimate: v });
  };

  const history = c.contactHistory || [];

  return (
    <section className="card profile-nurturing" style={{ gridColumn: "1/-1" }}>
      <h2>{t("cu_contact_history")} <span className="count-pill">{history.length}</span></h2>

      <div className="form-grid">
        <Field label={t("cu_decision_maker")}>
          <label className="check-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={!!c.decisionMaker} onChange={toggleDecisionMaker} />
            {c.decisionMaker ? t("cu_yes") : t("cu_no_label")}
          </label>
        </Field>
        <Field label={t("cu_company_size")}>
          <input className="input" value={c.companySizeEstimate || ""} placeholder={t("cu_company_size_ph")}
            onChange={e => saveCompanySize(e.target.value)} onBlur={e => saveCompanySize(e.target.value)} />
        </Field>
        <Field label={t("cu_next_action_date")}>
          <input className="input" type="date" value={naDate} onChange={e => setNaDate(e.target.value)} onBlur={saveNextAction} />
        </Field>
        <Field label={t("cu_next_action_note")}>
          <input className="input" value={naNote} placeholder={t("cu_next_action_ph")}
            onChange={e => setNaNote(e.target.value)} onBlur={saveNextAction} />
        </Field>
      </div>

      <div className="composer">
        <div className="composer-tabs">
          {["Call", "Line", "Email", "Visit"].map(ch => (
            <button key={ch} className={"composer-tab" + (channel === ch ? " on" : "")} onClick={() => setChannel(ch)}>
              <Icon d={ICONS.phone} size={14} /> {t("cu_channel_" + ch)}
            </button>
          ))}
        </div>
        <div className="composer-body">
          <textarea className="input composer-text" rows="2" value={summary} onChange={e => setSummary(e.target.value)}
            placeholder={t("cu_contact_summary") + "…"}></textarea>
          <button className="btn btn-primary" disabled={!summary.trim()} onClick={logContact}>{t("cu_log_contact")}</button>
        </div>
      </div>

      {history.length === 0 ? <p className="empty">{t("cu_no_contact_history")}</p> : (
        <div className="contact-list">
          {history.map((h, i) => (
            <div className="contact-row" key={i}>
              <span className="contact-chan">{t("cu_channel_" + h.channel) || h.channel}</span>
              <div className="contact-body">
                <div>{h.summary}</div>
                <div className="contact-date">{h.date} · <OwnerChip code={h.by} t={t} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Timeline({ customerId, memberIds }) {
  const { t, logs, logsFor, addLog, customers, updateCustomer } = useApp();
  const cust = customers.find(c => c.id === customerId);
  const ids = memberIds && memberIds.length ? memberIds : [customerId];
  const grouped = ids.length > 1;
  const tlCustName = (cid) => { const x = customers.find(y => y.id === cid); return x ? (x.shortName || x.name) : ""; };
  const [tab, setTab] = useState("note");
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState("Connected");
  const [when, setWhen] = useState("");
  const [file, setFile] = useState(null);
  const [naDate, setNaDate] = useState(cust ? (cust.nextActionDate || "") : "");
  const [naNote, setNaNote] = useState(cust ? (cust.nextActionNote || "") : "");

  const entries = logsFor(customerId);
  // imported sales note from CSV shown as oldest entry; aggregate across Name Code members
  const allEntries = useMemo(() => {
    const idSet = new Set(ids);
    const list = logs.filter(l => idSet.has(l.customerId)).slice();
    ids.forEach(cid => {
      const cc = customers.find(x => x.id === cid);
      if (cc && cc.note) list.push({ id: "seednote-" + cid, customerId: cid, type: "note", text: cc.note, user: cc.owner || "CRM", ts: cc.created || "", imported: true });
    });
    return list.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  }, [logs, customers, ids.join(",")]);

  const canAdd = tab === "file" ? !!file : (tab === "meeting" ? (text.trim() && when) : text.trim());

  const submit = () => {
    if (!canAdd) return;
    if (tab === "note") addLog({ customerId, type: "note", text: text.trim() });
    if (tab === "call") addLog({ customerId, type: "call", text: text.trim(), outcome });
    if (tab === "meeting") addLog({ customerId, type: "meeting", text: text.trim(), when });
    if (tab === "file") {
      const meta = { customerId, type: "file", fileName: file.name, fileSize: file.size, fileType: file.type, text: text.trim() };
      if (file.size < 300 * 1024) {
        const reader = new FileReader();
        reader.onload = () => addLog({ ...meta, dataUrl: reader.result });
        reader.readAsDataURL(file);
      } else addLog(meta);
    }
    setText(""); setFile(null); setWhen("");
  };

  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB";
  const saveNextAction = () => updateCustomer(customerId, { nextActionDate: naDate, nextActionNote: naNote }, "Updated next action");
  const toggleDecisionMaker = () => updateCustomer(customerId, { decisionMaker: !cust.decisionMaker }, cust.decisionMaker ? "Marked PIC as non-decision-maker" : "Marked PIC as decision maker");
  const saveCompanySize = (v) => updateCustomer(customerId, { companySizeEstimate: v });

  return (
    <section className="card profile-timeline">
      <h2>{t("lg_title")} <span className="count-pill">{allEntries.length}</span></h2>
      {cust && (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <Field label={t("cu_decision_maker")}>
            <label className="check-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={!!cust.decisionMaker} onChange={toggleDecisionMaker} />
              {cust.decisionMaker ? t("cu_yes") : t("cu_no_label")}
            </label>
          </Field>
          <Field label={t("cu_company_size")}>
            <input className="input" defaultValue={cust.companySizeEstimate || ""} placeholder={t("cu_company_size_ph")} onBlur={e => saveCompanySize(e.target.value)} />
          </Field>
          <Field label={t("cu_next_action_date")}>
            <input className="input" type="date" value={naDate} onChange={e => setNaDate(e.target.value)} onBlur={saveNextAction} />
          </Field>
          <Field label={t("cu_next_action_note")}>
            <input className="input" value={naNote} onChange={e => setNaNote(e.target.value)} onBlur={saveNextAction} placeholder={t("cu_next_action_ph")} />
          </Field>
        </div>
      )}
      <div className="composer">
        <div className="composer-tabs">
          {[["note", "lg_note"], ["call", "lg_call"], ["meeting", "lg_meeting"], ["file", "lg_file"]].map(([k, lk]) => (
            <button key={k} className={"composer-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
              <Icon d={ICONS[LOG_ICONS[k]]} size={14} /> {t(lk)}
            </button>
          ))}
        </div>
        <div className="composer-body">
          {tab === "call" && (
            <select className="select" value={outcome} onChange={e => setOutcome(e.target.value)}>
              {["Connected", "NoAnswer", "Busy", "Wrong"].map(o => <option key={o} value={o}>{t("oc_" + o)}</option>)}
            </select>
          )}
          {tab === "meeting" && (
            <input type="datetime-local" className="input" value={when} onChange={e => setWhen(e.target.value)} />
          )}
          {tab === "file" && (
            <label className="btn btn-ghost btn-sm">
              <Icon d={ICONS.upload} size={13} /> {file ? file.name : t("lg_upload")}
              <input type="file" hidden onChange={e => setFile(e.target.files[0] || null)} />
            </label>
          )}
          <textarea className="input composer-text" rows="2" value={text} onChange={e => setText(e.target.value)}
            placeholder={tab === "call" ? t("lg_call_ph") : tab === "meeting" ? t("lg_meeting_ph") : t("lg_note_ph")}></textarea>
          <button className="btn btn-primary" disabled={!canAdd} onClick={submit}>{t("lg_add")}</button>
        </div>
      </div>
      {allEntries.length === 0 ? <p className="empty">{t("lg_empty")}</p> : (
        <div className="timeline">
          {allEntries.map(e => (
            <div className="tl-row" key={e.id}>
              <span className={"tl-dot tl-" + e.type}><Icon d={ICONS[LOG_ICONS[e.type] || "note"]} size={13} /></span>
              <div className="tl-card">
                <div className="tl-head">
                  <OwnerChip code={e.user} t={t} />
                  {grouped && e.customerId && <span className="nc-chip" style={{ fontSize: 9.5 }}>{tlCustName(e.customerId)}</span>}
                  <span className="tl-type">
                    {e.type === "status" ? t("lg_status") + " “" + e.text + "”"
                      : e.type === "call" ? t("lg_call") + " · " + t("oc_" + (e.outcome || "Connected"))
                      : e.type === "meeting" ? t("lg_meeting") + " · " + (e.when || "").replace("T", " ")
                      : e.type === "file" ? t("lg_file")
                      : t("lg_note") + (e.imported ? " · CSV" : "")}
                  </span>
                  <time className="tl-time"><Icon d={ICONS.clock} size={11} /> {e.ts}</time>
                </div>
                {e.type !== "status" && e.text && <p className="tl-text">{CU.logText ? CU.logText(e.text, t) : e.text}</p>}
                {e.type === "file" && (
                  <div className="tl-attach">
                    <Icon d={ICONS.file} size={14} />
                    <span>{e.fileName} <small className="dim">({fmtSize(e.fileSize || 0)})</small></span>
                    {e.dataUrl && <a className="link-btn" href={e.dataUrl} download={e.fileName}>{t("lg_download")}</a>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CustomerProfile({ id, onBack, openCompany, openNewProject, openProject, openPO, openQuote }) {
  const { t, customers, scopeProjects, scopePOs, updateStatus, updateCustomer, addContactLog, samplesFor, quotationsFor, retentionRows, money: moneyGlobal, currency: curGlobal, deleteCustomer, canEdit, canDelete } = useApp();
  const [poCreating, setPoCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  // Full PO history for this customer fetched on demand (not held in RAM) — scales.
  const [custPOsSrv, setCustPOsSrv] = useState(null);
  useEffect(() => {
    let on = true;
    const cc = customers.find(x => x.id === id);
    if (cc) { const nk = CU.nameCodeKey(CU.nameCodeOf(cc)); const mids = customers.filter(x => CU.nameCodeKey(CU.nameCodeOf(x)) === nk).map(x => x.id); CU.SB.posForCustomers(mids).then(r => { if (on) setCustPOsSrv(r); }).catch(() => {}); }
    return () => { on = false; };
  }, [id, customers]);
  const [poDetail, setPoDetail] = useState(null);
  const [projDetail, setProjDetail] = useState(null);
  const [poExpanded, setPoExpanded] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const c = customers.find(x => x.id === id);
  if (!c) return null;
  // A profile is read in ITS OWN market's currency (Thailand → THB, Vietnam → VND), so a
  // Thai customer never shows raw VND just because the global toggle sits on VND.
  const currency = CU.ccyOfCountry(c.country) || curGlobal;
  const money = (v) => CU.fmtMoney(v, currency);
  // ---- Name Code (parent) rollup: aggregate sibling companies ----
  const ncKey = CU.nameCodeKey(CU.nameCodeOf(c));
  const members = customers.filter(x => CU.nameCodeKey(CU.nameCodeOf(x)) === ncKey);
  const memberIds = new Set(members.map(x => x.id));
  const isGroup = members.length > 1;
  // Projects & POs follow the PARENT — creating from here attaches to the parent
  // representative company (head office if present, else first member).
  const repId = (members.find(m => /head\s*office/i.test(m.name || "")) || members[0] || c).id;
  const projs = scopeProjects.filter(p => memberIds.has(p.customerId));
  const projTotal = projs.filter(p => p.stage !== "Lost").reduce((s, p) => s + (p.value || 0), 0);
  const custPOs = (custPOsSrv || scopePOs.filter(p => memberIds.has(p.customerId))).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const poTotal = custPOs.reduce((s, p) => s + (p.amountVnd || 0), 0);
  // One row per PO NUMBER (same grouping as the PO List / PO detail), so a PO split across
  // several product lines reads one merged amount here instead of a per-line slice.
  const custPOGroups = (() => {
    const m = new Map();
    custPOs.forEach(p => { const k = (p.poNumber || "").trim() ? "PN:" + (p.poNumber || "").trim() : "ID:" + p.id; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    return [...m.values()].map(recs => {
      const f = recs[0];
      const codes = [...new Set(recs.flatMap(r => (r.items && r.items.length)
        ? r.items.map(it => it.structureCode || it.sku || it.productCode)
        : [r.structureCode || r.commercial]).filter(Boolean))];
      return {
        rep: f, recs, codes,
        qty: recs.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0),
        amount: recs.reduce((s, x) => s + (x.amountVnd || 0), 0),
      };
    });
  })();
  // quotation lines are priced in their OWN currency — lift them to canonical VND before
  // formatting, so a THB quote reads 6,350 ฿ instead of 6,350 ₫
  const quoteTotalVnd = (q) => (q.items || []).reduce((s, it) => s + lineValueEff(it) * ((CU.CURRENCIES[it.currency || "VND"] || { rate: 1 }).rate), 0);
  const custName = (cid) => { const x = customers.find(y => y.id === cid); return x ? (x.shortName || x.name) : ""; };
  // customer group: explicit on record, else from latest PO (mapping with PO List)
  const effGroup = c.group || (custPOs[0] && custPOs[0].group) || "";
  const statuses = CU.ALL_STATUSES;
  const webHref = c.website ? (c.website.startsWith("http") ? c.website : "https://" + c.website.replace(/^\/+/, "")) : null;
  const mapsQuery = encodeURIComponent([c.name, c.address, c.city, c.country].filter(Boolean).join(", "));
  const custSamples = samplesFor ? samplesFor(id) : [];
  const custQuotes = quotationsFor ? quotationsFor(id) : [];

  // ALERT 1: forgotten lead — lastContactDate older than LEAD_STALE_DAYS, no recent contactHistory
  const daysSinceContact = CU.daysSince(c.lastContactDate);
  const isStale = c.funnel !== "Hot Lead" && (daysSinceContact === null || daysSinceContact > CU.LEAD_STALE_DAYS);


  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}><Icon d={ICONS.back} size={16} /> {t("cu_title")}</button>
      {(canEdit && canEdit("customers")) || (canDelete && canDelete("customers")) ? (
        <div style={{ float: "right", display: "flex", gap: "8px" }}>
          {canEdit && canEdit("customers") && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>{t("pd_edit")}</button>}
          {canDelete && canDelete("customers") && <button className="btn btn-danger btn-sm" onClick={() => crmConfirm(t("del_confirm"), () => { deleteCustomer(c.id); onBack(); })}>{t("pd_delete")}</button>}
        </div>
      ) : null}
      <header className="profile-head card">
        <div className="profile-id">
          <Avatar name={CU.nameCodeOf(c)} size={52} />
          <div>
            <h1>{CU.nameCodeOf(c)}</h1>
            <p className="profile-full">{c.name}{isGroup ? " · " + members.length + " " + t("nc_companies") : ""}</p>
            <div className="profile-tags">
              <span className="nc-chip nc-chip-navy">{t("nc_parent_company")}</span>
              <StageBadge stage={c.funnel} t={t} />
              {effGroup && <GroupBadge group={effGroup} />}
              {c.type && <span className="tag">{c.type}</span>}
              <span className="tag"><Icon d={ICONS.globe} size={12} /> {c.country}{c.city ? ` · ${c.city}` : ""}</span>
              <OwnerChip code={c.owner} t={t} />
              {isStale && <span className="stale-flag"><Icon d={ICONS.alert} size={11} /> {t("cu_stale_lead")}</span>}
            </div>
          </div>
        </div>
        <div className="profile-status">
          <label className="field-label">{t("cu_change_status")}</label>
          <select className="select" value={c.status} onChange={e => updateStatus(c.id, e.target.value)}>
            <option value="">{t("none")}</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <small className="status-hint">{t("cu_auto_move")}</small>
        </div>
      </header>

      <div className="profile-grid">
        {members.length > 0 && (
          <section className="card profile-projects">
            <h2><span className="nc-chip nc-chip-navy">{CU.nameCodeOf(c)}</span> {t("nc_companies_under")} <span className="count-pill">{members.length}</span></h2>
            <div className="nc-parent-companies">
              {(() => {
                // Keep the current company first, then cap at 3 unless "View all" is on.
                const ordered = [c, ...members.filter(m => m.id !== id)];
                const shownMembers = (members.length > 3 && !showAllMembers) ? ordered.slice(0, 3) : ordered;
                return shownMembers.map(m => {
                const mPo = custPOs.filter(p => p.customerId === m.id);
                const mTotal = mPo.reduce((s, p) => s + (p.amountVnd || 0), 0);
                return (
                  <div key={m.id} className={"nc-company-row" + (m.id === id ? " cur" : "")}>
                    <div className="nc-co-info">
                      <strong>{m.name || m.shortName}{m.id === id && <span className="dim"> · {t("nc_viewing")}</span>}</strong>
                      <small>{[m.bizId, m.country, m.city].filter(Boolean).join(" · ") || "—"}</small>
                    </div>
                    <span className="nc-co-metric">{mPo.length} PO · <strong>{CU.fmtMoneyFull(mTotal, currency)}</strong></span>
                    {m.id !== id && <button className="btn btn-ghost btn-sm" onClick={() => openCompany(m.id)}>{t("nc_jump")} →</button>}
                  </div>
                );
                });
              })()}
            </div>
            {members.length > 3 && (
              <button className="link-btn nc-viewall" onClick={() => setShowAllMembers(v => !v)}>
                {showAllMembers ? t("nc_show_less") : t("nc_view_all").replace("{n}", String(members.length))}
              </button>
            )}
          </section>
        )}
        <section className="card">
          <h2>{t("cu_contact")}</h2>
          <InfoRow icon={ICONS.customers} label={t("cu_pic")} value={[c.pic, c.title, c.dept].filter(Boolean).join(" · ")} />
          <InfoRow icon={ICONS.phone} label={t("phone")} value={[c.phone, c.phone2, c.phone3].filter(Boolean).join("  /  ")} />
          <InfoRow icon={ICONS.mail} label={t("email")} value={c.email} href={c.email ? "mailto:" + c.email.split(/[ ,]/)[0] : null} />
          <InfoRow icon={ICONS.link} label={t("website")} value={c.website} href={webHref} />
          <InfoRow icon={ICONS.pin} label={t("address")} value={c.address || (c.city ? [c.district, c.city].filter(Boolean).join(", ") : "")}
            extra={
              <a className="maps-btn" href={"https://www.google.com/maps/search/?api=1&query=" + mapsQuery} target="_blank" rel="noopener">
                <Icon d={ICONS.pin} size={12} /> {t("cu_maps")}
              </a>
            } />
        </section>
        <section className="card">
          <h2>{t("cu_company_info")}</h2>
          <InfoRow icon={ICONS.projects} label={t("cu_biz_id")} value={c.bizId} />
          <InfoRow icon={ICONS.globe} label={t("country")} value={[c.country, c.city].filter(Boolean).join(" · ")} />
          <InfoRow icon={ICONS.pin} label={t("district")} value={c.district} />
          <InfoRow icon={ICONS.search} label={t("cu_lead_source")} value={c.leadSource} />
          <InfoRow icon={ICONS.board} label={t("cu_created")} value={c.created} />
          <InfoRow icon={ICONS.clock} label={t("cu_updated")}
            value={c._updated ? c._updated + (c._updatedBy ? " · " + t("cu_by") + " " + c._updatedBy : "") : null} />
        </section>
        <section className="card profile-projects">
          <h2>{t("cu_projects")} <span className="count-pill">{projs.length}</span>
            {projTotal > 0 && <span className="card-hint" style={{ marginLeft: 8 }}>{CU.fmtMoneyFull(projTotal, currency)} {currency}</span>}
            <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => openNewProject(repId)}>
              <Icon d={ICONS.plus} size={14} /> {t("cu_new_project")}
            </button>
          </h2>
          {projs.length === 0 ? <p className="empty">{t("cu_no_projects")}</p> : (
            <table className="table table-plain">
              <tbody>
                {projs.map(p => (
                  <tr key={p.id} className="row-click" onClick={() => openProject ? openProject(p.id) : setProjDetail(p.id)}>
                    <td><strong className="cell-main">{p.name}</strong>
                      <small className="cell-sub">{isGroup ? custName(p.customerId) + " · " : ""}{p.id} · {t("pr_close_month")}: {CU.fmtDate(p.closeMonth)}</small></td>
                    <td className="hide-sm">{p.product}<small className="cell-sub">{p.width}×{p.length} · {CU.fmtNum(p.qtyRolls)} rolls</small></td>
                    <td><ProjStageBadge stage={p.stage} t={t} /></td>
                    <td className="hide-sm"><OwnerChip code={p.following} t={t} /></td>
                    <td className="cell-money">{CU.fmtMoneyFull(p.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card profile-projects">
          <h2>{t("pol_title")} <span className="count-pill">{custPOGroups.length}</span>
            {poTotal > 0 && <span className="card-hint" style={{ marginLeft: 8 }}>{CU.fmtMoneyFull(poTotal, currency)} {currency}</span>}
            <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setPoCreating(true)}>
              <Icon d={ICONS.plus} size={14} /> {t("pol_new")}
            </button>
          </h2>
          {custPOGroups.length === 0 ? <p className="empty">{t("pol_no_pos")}</p> : (
            <table className="table table-plain">
              <tbody>
                {(poExpanded ? custPOGroups : custPOGroups.slice(0, 5)).map(g => { const p = g.rep; return (
                  <tr key={p.id} className="row-click" onClick={() => openPO ? openPO(p.id) : setPoDetail(p.id)}>
                    <td style={{ width: 200, minWidth: 200, whiteSpace: "nowrap" }}><strong className="cell-main">{p.poNumber || p.id}</strong>
                      <small className="cell-sub">{isGroup ? custName(p.customerId) + " · " : ""}{p.date}{p.invNo ? " · INV " + p.invNo : ""}</small></td>
                    <td className="hide-sm">{g.codes.join(", ") || p.commercial}<small className="cell-sub">{g.recs.length > 1 ? g.recs.length + " " + t("pol_structure") + " · " : (p.width + "×" + p.length + " · ")}{CU.fmtNum(g.qty)} {CU.unitLabel(p.unit, t)}</small></td>
                    <td><GroupBadge group={p.group} /></td>
                    <td className="hide-sm" style={{ whiteSpace: "nowrap" }}><span className={"nr-pill" + (p.newRepeat === "New" ? " nr-new" : "")}>{p.newRepeat}</span></td>
                    <td className="cell-money" style={{ whiteSpace: "nowrap" }}>{CU.fmtMoneyFull(g.amount, currency)}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
          {custPOGroups.length > 5 && (
            <button className="view-all-btn" onClick={() => setPoExpanded(v => !v)}>
              {poExpanded ? t("cu_show_less") : `${t("view_all")} (${custPOGroups.length})`}
              <span className={"view-all-caret" + (poExpanded ? " up" : "")}>↓</span>
            </button>
          )}
        </section>
        <section className="card profile-projects">
          <h2>{t("smp_title")} <span className="count-pill">{custSamples.length}</span></h2>
          {custSamples.length === 0 ? <p className="empty">—</p> : (
            <table className="table table-plain">
              <tbody>
                {custSamples.map(s => (
                  <tr key={s.id}>
                    <td><strong className="cell-main">{s.productCode}</strong><small className="cell-sub">{t("smp_sent_date")}: {CU.fmtDate(s.sentDate)}</small></td>
                    <td><SampleStatusBadge status={s.testStatus} t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card profile-projects">
          <h2>{t("qt_title")} <span className="count-pill">{custQuotes.length}</span></h2>
          {custQuotes.length === 0 ? <p className="empty">—</p> : (
            <table className="table table-plain">
              <tbody>
                {custQuotes.map(q => (
                  <tr key={q.id} className={openQuote ? "row-click" : undefined} onClick={openQuote ? () => openQuote(q.id) : undefined}>
                    <td><strong className="cell-main">{q.id}</strong><small className="cell-sub">{CU.fmtDate(q.quoteDate)}</small></td>
                    <td><QuoteStatusBadge status={q.status} t={t} /></td>
                    <td className="cell-money">{CU.fmtMoneyFull(quoteTotalVnd(q), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {(() => {
          const rr = (retentionRows || []).find(r => CU.nameCodeKey(r.nameCode) === ncKey || (r.memberCustomerIds || []).includes(id) || r.customerId === id);
          if (!rr) return null;
          const mk = CU.tgMetric(rr.targetArr, rr.actualArr);
          const hmap = { green: { dot: "🟢", label: t("ret_health_good"), color: "#16A34A" }, yellow: { dot: "🟡", label: t("ret_health_watch"), color: "#D97706" }, red: { dot: "🔴", label: t("ret_health_risk"), color: "var(--danger)" } };
          const hm = hmap[rr.health] || hmap.green;
          const rpct = (r) => r == null ? "—" : Math.round(r * 100) + "%";
          return (
            <section className="card profile-projects">
              <h2>{t("ret_title")}
                <span className="badge" style={{ marginLeft: 8, color: hm.color, background: hm.color + "1A", borderColor: hm.color + "40" }}>{hm.dot} {hm.label}</span>
              </h2>
              <div className="ret-profile-grid">
                <div className="ret-stat"><span className="ret-stat-lbl">{t("ret_days_since_last_po")}</span><strong>{rr.daysSinceLastPO} <small className="dim">{t("ret_days_unit")}</small></strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("ret_avg_frequency")}</span><strong>{rr.avgFrequencyDays !== null ? rr.avgFrequencyDays + " " + t("ret_days_unit") : "—"}</strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("ret_total_po")}</span><strong>{money(rr.totalPoAmount)}</strong></div>
                <div className="ret-stat ret-stat-full"><span className="ret-stat-lbl">{t("ret_products")} <span className="count-pill">{(rr.productList || []).length}</span></span>
                  {(rr.productList || []).length === 0 ? <strong>—</strong> : (
                    <div className="ret-prod-lines">
                      {(showAllProducts ? rr.productList : rr.productList.slice(0, 5)).map((pn, i) => (
                        <div className="ret-prod-line" key={i}>{pn}</div>
                      ))}
                      {rr.productList.length > 5 && (
                        <button className="link-btn" onClick={() => setShowAllProducts(v => !v)}>
                          {showAllProducts ? t("nc_show_less") : t("nc_view_all").replace("{n}", String(rr.productList.length))}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_annual_tgt")}</span><strong>{money(mk.annualTarget)}</strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_pct_annual")}</span><strong>{rpct(mk.pctAnnual)}</strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_mtd_tgt")}</span><strong>{money(mk.mtdTarget)}</strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_mtd_act")}</span><strong>{money(mk.mtdActual)} <small className="dim">({rpct(mk.pctMTD)})</small></strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_ytd_tgt")}</span><strong>{money(mk.ytdTarget)}</strong></div>
                <div className="ret-stat"><span className="ret-stat-lbl">{t("trk_ytd_act")}</span><strong>{money(mk.ytdActual)} <small className="dim">({rpct(mk.pctYTD)})</small></strong></div>
              </div>
            </section>
          );
        })()}
        <Timeline customerId={id} memberIds={isGroup ? [...memberIds] : null} />
      </div>
      {poCreating && <POFormModal presetCustomerId={repId} onClose={() => setPoCreating(false)} />}
      {editing && <EditCustomerModal customer={c} onClose={() => setEditing(false)} />}
      {poDetail && <PODetailModal id={poDetail} onClose={() => setPoDetail(null)} openCustomer={() => setPoDetail(null)} />}
      {projDetail && <ProjectDetailModal id={projDetail} onClose={() => setProjDetail(null)} openCustomer={() => setProjDetail(null)} />}
    </div>
  );
}
Object.assign(window, { CustomersPage, Timeline, AddCustomerModal });
