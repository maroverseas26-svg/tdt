// Todaytec CRM — Pipelines (PROJECT pipeline: kanban board by project stage + list toggle)
const PL = window.CRM;

function PipelinesPage({ openCustomer, openProject }) {
  const { t, isBoss, scopeProjects, scopeCustomers, customers, updateProject, addLog, money, currency, setCurrency, users, samples, quotations, lvlOr } = useApp();
  // Moving a card changes the project's stage: needs edit on Pipelines.
  const canMove = lvlOr("pipelines", "edit", true);
  const [view, setView] = useState("board");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  // Country follows the ONE topbar filter; no page-level country dropdown any more.
  const _topCountry = useApp().countryFilter;
  const country = React.useMemo(() => { const c = window.CRM.normCountry(_topCountry || ""); return (c && c !== "All") ? c : ""; }, [_topCountry]);
  const setCountry = () => {};
  const { dateRange: dr, setDateRange: setDr, dateRangeR: drR } = useApp();
  const fromMonth = drR.from, toMonth = drR.to;
  const [dragOver, setDragOver] = useState(null);

  const custOf = (id) => customers.find(c => c.id === id);
  const custName = (id) => { const c = custOf(id); return c ? (c.shortName || c.name) : "—"; };
  const custNC = (id) => { const c = custOf(id); return c ? PL.nameCodeOf(c) : ""; };
  const countryOfCust = (id) => { const c = custOf(id); return c ? window.CRM.normCountry(c.country) : ""; };

  const _regOwners = new Set((users || []).filter(u => !u._deleted).map(u => (u.salesCode || u.name || "").trim().toUpperCase()).filter(Boolean));
  // Secondary filters depend on the topbar country: only reps who actually appear on
  // records in that market are offered.
  const _inCountry = (cid) => !country || countryOfCust(cid) === country;
  const _pipeFollowers = [
    ...scopeProjects.filter(p => _inCountry(p.customerId)).map(p => p.following),
    ...(samples || []).filter(s => _inCountry(s.customerId)).map(s => s.pic || s.createdBy),
    ...(quotations || []).filter(qq => _inCountry(qq.customerId)).map(qq => qq.pic || qq.createdBy || (custOf(qq.customerId) || {}).owner),
  ];
  const owners = [...new Set(_pipeFollowers.map(f => (f || "").trim().toUpperCase()).filter(f => f && _regOwners.has(f)))].sort();
  const countries = [...new Set(scopeProjects.map(p => countryOfCust(p.customerId)).filter(Boolean))].filter(c => (window.CRM.MARKETS || ["Vietnam", "Thailand"]).includes(c)).sort();

  const list = scopeProjects.filter(p => {
    if (owner && (p.following || "").trim().toUpperCase() !== owner) return false;
    if (country && countryOfCust(p.customerId) !== country) return false;
    const pMonth = (p.closeMonth || p.createdAt || "");
    if (fromMonth && (!pMonth || pMonth < fromMonth)) return false;
    if (toMonth && (!pMonth || pMonth > toMonth)) return false;
    const qq = q.trim().toLowerCase();
    if (qq) {
      const c = custOf(p.customerId);
      const hay = (p.name + " " + p.id + " " + (c ? c.name + " " + c.shortName + " " + c.bizId : "")).toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  });

  const byStage = {};
  PL.PROJECT_STAGES.forEach(s => byStage[s] = []);
  list.forEach(p => (byStage[p.stage] || (byStage[p.stage] = [])).push(p));

  // Surface Samples and Quotations on the board too: a sent sample is a live deal in the
  // "Sample" stage, a quote a deal in the "Quotation" stage. Skip ones already tied to a
  // project (project.linkedSampleId / quotation.projectId) so the same deal isn't shown
  // twice. Everything is scoped to the customers this user can see and obeys the filters.
  const visCustIds = new Set(scopeCustomers.map(c => c.id));
  const shownProjIds = new Set(list.map(p => p.id));
  const linkedSampleIds = new Set(scopeProjects.map(p => p.linkedSampleId).filter(Boolean));
  const passFilters = (customerId, following) => {
    if (owner && (following || "").trim().toUpperCase() !== owner) return false;
    if (country && countryOfCust(customerId) !== country) return false;
    const qq = q.trim().toLowerCase();
    if (qq) { const c = custOf(customerId); const hay = (c ? (c.name + " " + c.shortName + " " + c.bizId) : "").toLowerCase(); if (!hay.includes(qq)) return false; }
    return true;
  };
  (samples || []).forEach(s => {
    if (!visCustIds.has(s.customerId) || linkedSampleIds.has(s.id)) return;
    const sFollowing = s.pic || s.createdBy;
    if (!passFilters(s.customerId, sFollowing)) return;
    byStage["Sample"].push({ _type: "sample", id: s.id, name: s.productCode || t("nav_samples"), customerId: s.customerId, following: sFollowing, sub: s.testStatus || "" });
  });
  const rateOf = (cur) => (PL.CURRENCIES[cur || "VND"] ? PL.CURRENCIES[cur || "VND"].rate : 1);
  const quoteTotal = (qq) => (qq.items || []).reduce((sum, it) => sum + lineValueEff(it) * rateOf(it.currency), 0);
  (quotations || []).forEach(qq => {
    if (!visCustIds.has(qq.customerId)) return;
    if (qq.projectId && shownProjIds.has(qq.projectId)) return;
    const following = qq.pic || qq.createdBy || (custOf(qq.customerId) || {}).owner;
    if (!passFilters(qq.customerId, following)) return;
    byStage["Quotation"].push({ _type: "quote", id: qq.id, name: qq.id, customerId: qq.customerId, following, value: quoteTotal(qq) });
  });

  // move a project to a new stage (sets the matching milestone flags, never downgrades flags)
  const moveProject = (id, stage) => {
    const p = scopeProjects.find(x => x.id === id);
    if (!canMove || !p || p.stage === stage) return;
    const patch = { stage };
    if (stage === "Won") patch.result = "Won";
    if (stage === "Lost") patch.result = "Lost";
    if (stage === "Sample") patch.sampleSent = true;
    if (stage === "Quotation") patch.quoteSent = true;
    if (stage === "PO") patch.poReceived = true;
    updateProject(id, patch);
    addLog({ customerId: id, type: "status", text: t("st_" + stage) });
  };

  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/project-id");
    if (id) moveProject(id, stage);
    setDragOver(null);
  };

  return (
    <div className="page page-wide">
      <header className="page-head list-head">
        <div>
          <h1>{t("pl_title")}</h1>
          <p className="page-sub">{view === "board" ? t("pl_drag") : list.length + " " + t("pr_title").toLowerCase()}</p>
        </div>
      </header>
      <div className="list-toolbar">
        <div className="search-box">
          <Icon d={ICONS.search} size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("pr_name") + " / " + t("cu_company") + "…"} />
        </div>
        {isBoss && <FilterSelect value={owner} onChange={setOwner} options={owners} allLabel={t("pr_following") + ": " + t("all")} />}
        <select className="select list-ccy" value={currency} onChange={e => setCurrency(e.target.value)}>
          {Object.keys(PL.CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="seg">
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}><Icon d={ICONS.board} size={15} /> {t("pl_kanban")}</button>
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}><Icon d={ICONS.list} size={15} /> {t("pl_list")}</button>
        </div>
      </div>

      {view === "board" ? (
        <div className="kanban">
          {PL.PROJECT_STAGES.map(stage => {
            const colVal = byStage[stage].reduce((s, p) => s + (p.value || 0), 0);
            return (
            <div key={stage}
              className={"kcol" + (dragOver === stage ? " drag-over" : "")}
              onDragOver={e => { e.preventDefault(); setDragOver(stage); }}
              onDragLeave={() => setDragOver(d => d === stage ? null : d)}
              onDrop={e => onDrop(e, stage)}>
              <div className="kcol-head" style={{ borderTopColor: PL.PROJECT_STAGE_COLORS[stage] }}>
                <span className="kcol-title">{t("st_" + stage)}</span>
                <span className="kcol-count">{byStage[stage].length}</span>
              </div>
              <div className="kcol-body">
                {byStage[stage].length === 0 && <div className="kcol-empty">{t("pl_empty")}</div>}
                {byStage[stage].map(p => (
                  <div key={(p._type || "proj") + "-" + p.id} className={"kcard" + (p._type ? " kcard-" + p._type : "")} draggable={!p._type && canMove}
                    onDragStart={p._type || !canMove ? undefined : e => e.dataTransfer.setData("text/project-id", p.id)}
                    onClick={() => p._type ? openCustomer(p.customerId) : (openProject ? openProject(p.id) : openCustomer(p.customerId))}>
                    <strong>{p.name}{p._type === "sample" ? <span className="kcard-tag">{t("nav_samples")}</span> : p._type === "quote" ? <span className="kcard-tag">{t("nav_quotations") || "Quote"}</span> : null}</strong>
                    <small className="kcard-status">{custName(p.customerId)}{p._type === "sample" && p.sub ? " · " + p.sub : ""}</small>
                    <div className="kcard-foot">
                      <span className="kcard-meta">{p._type === "sample" ? "—" : (PL.fmtMoneyFull ? PL.fmtMoneyFull(p.value || 0, currency) : money(p.value || 0))}</span>
                      {p.following && <OwnerChip code={p.following} t={t} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="plist">
          {PL.PROJECT_STAGES.map(stage => byStage[stage].length > 0 && (
            <div className="card plist-group" key={stage}>
              <div className="plist-head">
                <ProjStageBadge stage={stage} t={t} />
                <span className="kcol-count">{byStage[stage].length}</span>
              </div>
              <table className="table">
                <tbody>
                  {byStage[stage].map(p => (
                    <tr key={(p._type || "proj") + "-" + p.id} className="row-click" onClick={() => p._type ? openCustomer(p.customerId) : (openProject ? openProject(p.id) : openCustomer(p.customerId))}>
                      <td><strong className="cell-main">{p.name}</strong>
                        <small className="cell-sub">{p.id} · {custNC(p.customerId) ? custNC(p.customerId) + " · " : ""}{custName(p.customerId)}</small></td>
                      <td className="hide-sm">{p._type === "sample" ? t("nav_samples") : p._type === "quote" ? (t("nav_quotations") || "Quote") : (p.classification || "—")}</td>
                      <td className="cell-money">{p._type === "sample" ? "—" : (PL.fmtMoneyFull ? PL.fmtMoneyFull(p.value || 0, currency) : money(p.value || 0))}</td>
                      <td className="hide-sm" style={{ textAlign: "right" }}><OwnerChip code={p.following} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
window.PipelinesPage = PipelinesPage;
