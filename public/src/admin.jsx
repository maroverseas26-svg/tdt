// Todaytec CRM — Accounts & Permissions (custom roles, photo, rename)
const AD = window.CRM;

function AdminPage() {
  const { t, user, isBoss, users, setUsers, customers, roles, setRoles, roleOf } = useApp();
  const [adding, setAdding] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [selUserId, setSelUserId] = useState(null);
  const grp = useGroupToggle();
  const sort = useSort("name", "asc");
  const memberAccessors = { name: u => u.name || "", code: u => u.salesCode || "", email: u => u.email || "", active: u => u.active ? 0 : 1 };
  const memberSortCols = [
    { key: "name", label: t("ad_user") },
    { key: "code", label: t("ad_sales_code") },
    { key: "email", label: t("login_email") },
    { key: "active", label: t("ad_active") },
  ];
  if (!isBoss) return <div className="page"><div className="card empty-card">{t("ad_only_bod")}</div></div>;

  // Country options are limited to the markets the company operates in.
  const countries = [...AD.MARKETS].sort();
  const patch = (id, p) => setUsers(users.map(u => u.id === id ? { ...u, ...p } : u));
  const toggleModule = (u, m) => {
    const has = (u.modules || []).includes(m);
    let mods = has ? u.modules.filter(x => x !== m) : [...u.modules, m];
    patch(u.id, { modules: mods });
  };
  const toggleEditModule = (u, m) => {
    const cur = u.editModules || u.modules || [];
    patch(u.id, { editModules: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m] });
  };
  const toggleDeleteModule = (u, m) => {
    const cur = u.deleteModules || u.editModules || u.modules || [];
    patch(u.id, { deleteModules: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m] });
  };
  const toggleExportModule = (u, m) => {
    const cur = u.exportModules || u.modules || [];
    patch(u.id, { exportModules: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m] });
  };
  const toggleCountry = (u, c) => {
    let cs = u.countries || [];
    if (c === "*") { cs = cs.includes("*") ? [] : ["*"]; }
    else {
      cs = cs.filter(x => x !== "*");
      cs = cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c];
    }
    patch(u.id, { countries: cs });
  };
  const remove = (id) => {
    if (id === user.id) return;
    // soft-delete (tombstone) so the seed merge can't resurrect the account and the
    // deletion persists to Supabase — a deleted account can no longer sign in.
    setUsers(users.map(u => u.id === id ? { ...u, _deleted: true, active: false } : u));
    if (selUserId === id) setSelUserId(null);
  };

  // Full editable account card — shown when a member is opened from a role group.
  const renderAccountCard = (u) => {
    const role = roleOf(u);
    return (
      <div className={"card admin-row" + (u.active ? "" : " inactive")} key={u.id}>
        <div className="admin-id">
          <label className="admin-photo" title={t("ad_upload_photo")}>
            <Avatar name={u.name} size={44} src={u.photo} color={role.scope === "all" ? "var(--navy)" : undefined} />
            <span className="admin-photo-edit"><Icon d={ICONS.upload} size={11} /></span>
            <input type="file" accept="image/*" hidden onChange={e => {
              const file = e.target.files[0];
              if (file) readPhoto(file, url => patch(u.id, { photo: url }));
            }} />
          </label>
          <div>
            <input className="input input-name" value={u.name} onChange={e => patch(u.id, { name: e.target.value })} placeholder={t("ad_name_ph")} />
            <small>{u.salesCode || (role.scope === "all" ? role.name : "—")}{u.id === user.id ? " · you" : ""}</small>
            {u.email && <small className="admin-email">{u.email}</small>}
          </div>
        </div>
        <div className="admin-controls">
          <div className="admin-ctl">
            <label>{t("ad_role")}</label>
            <select className="select" value={u.role} onChange={e => {
              const roleId = e.target.value;
              const r = roles.find(x => x.id === roleId);
              const wasAdmin = roleOf(u).scope === "all";
              const willAdmin = r && r.scope === "all";
              if (wasAdmin && !willAdmin) {
                const admins = users.filter(x => x.active && roleOf(x).scope === "all").length;
                if (admins <= 1) { window.alert(t("ad_need_admin")); return; }
              }
              const p = { role: roleId };
              if (r && r.scope === "all") { p.countries = ["*"]; p.modules = [...AD.MODULES]; }
              else { p.countries = (u.countries || []).includes("*") ? ["Thailand"] : u.countries; p.modules = (u.modules || []).filter(m => m !== "admin"); }
              patch(u.id, p);
            }}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="admin-ctl">
            <label>{t("ad_sales_code")} {role.scope !== "all" && <em style={{ color: "#DC2626", fontStyle: "normal" }}>*</em>}</label>
            <input className="input input-sm" value={u.salesCode || ""} onChange={e => patch(u.id, { salesCode: e.target.value.toUpperCase() })} placeholder={(u.name || "").toUpperCase() || t("ad_code_ph")} style={role.scope !== "all" && !String(u.salesCode || "").trim() ? { borderColor: "#DC2626" } : undefined} />
            {role.scope !== "all" && !String(u.salesCode || "").trim() && <small style={{ color: "#DC2626", fontSize: 11, fontWeight: 600, marginTop: 3, display: "block" }}>{t("ad_code_req")}</small>}
          </div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_countries")}</label>
            <div className="chip-row">
              {countries.map(c => (
                <button key={c} className={"chip" + ((u.countries || []).includes(c) || (u.countries || []).includes("*") ? " on" : "")}
                  disabled={role.scope === "all"}
                  onClick={() => toggleCountry(u, c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="admin-section-head">{t("ad_sec_ops")}</div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_modules")} · <span style={{textTransform:"none",fontWeight:400}}>{t("ad_view_perms")}</span></label>
            <div className="chip-row">
              {AD.MODULES.map(m => (
                <button key={m} className={"chip" + ((u.modules || []).includes(m) ? " on" : "")}
                  disabled={m === "admin" && role.scope !== "all"}
                  onClick={() => toggleModule(u, m)}>{t("nav_" + m)}</button>
              ))}
            </div>
          </div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_edit_perms")}</label>
            <div className="chip-row">
              {AD.MODULES.filter(m => m !== "admin").map(m => {
                const editable = (u.editModules || u.modules || []).includes(m);
                return (
                  <button key={m} className={"chip" + (editable ? " on" : "")}
                    disabled={role.scope === "all" || !(u.modules || []).includes(m)}
                    onClick={() => toggleEditModule(u, m)}>{t("nav_" + m)}</button>
                );
              })}
            </div>
          </div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_delete_perms")}</label>
            <div className="chip-row">
              {AD.MODULES.filter(m => m !== "admin").map(m => {
                const deletable = (u.deleteModules || u.editModules || u.modules || []).includes(m);
                return (
                  <button key={m} className={"chip" + (deletable ? " on" : "")}
                    disabled={role.scope === "all" || !(u.modules || []).includes(m)}
                    onClick={() => toggleDeleteModule(u, m)}>{t("nav_" + m)}</button>
                );
              })}
            </div>
          </div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_export_perms")}</label>
            <div className="chip-row">
              {AD.MODULES.filter(m => m !== "admin").map(m => {
                const exportable = (u.exportModules || u.modules || []).includes(m);
                return (
                  <button key={m} className={"chip" + (exportable ? " on" : "")}
                    disabled={role.scope === "all" || !(u.modules || []).includes(m)}
                    onClick={() => toggleExportModule(u, m)}>{t("nav_" + m)}</button>
                );
              })}
            </div>
          </div>
          <React.Fragment>
              <div className="admin-section-head">{t("ad_sec_kpi")}</div>
              <div className="admin-ctl admin-ctl-wide">
                <label>{t("ad_kpi_country")}</label>
                <div className="chip-row">
                  {AD.MARKETS.map(c => {
                    const kpiC = AD.kpiCountryOf(u);
                    return (
                      <button key={c} className={"chip" + (kpiC === c ? " on" : "")}
                        onClick={() => patch(u.id, { targetCountry: (kpiC === c ? AD.KPI_NONE : c) })}>{c}</button>
                    );
                  })}
                </div>
                <small className="status-hint">{t("ad_kpi_country_note")}</small>
              </div>
            </React.Fragment>
          {role.scope !== "all" && (
            <React.Fragment>
              <div className="admin-section-head">{t("ad_sec_members")}</div>
              <div className="admin-ctl admin-ctl-wide">
                <label>{t("ad_members")}</label>
                <MembersAllowedControl userObj={u} onChange={m => patch(u.id, { members: m })} />
                <small className="status-hint">{t("ad_members_note")}</small>
              </div>
            </React.Fragment>
          )}
          <div className="admin-ctl admin-ctl-end">
            <label>{t("ad_active")}</label>
            <button className={"toggle" + (u.active ? " on" : "")} onClick={() => patch(u.id, { active: !u.active })}>
              <span className="toggle-knob"></span>
            </button>
          </div>
          {u.id !== user.id && (
            <button className="btn btn-danger btn-sm" onClick={() => remove(u.id)}>{t("ad_remove")}</button>
          )}
        </div>
      </div>
    );
  };

  // ---- Member detail view (opened from a role group) ----
  if (selUserId) {
    const u = users.find(x => x.id === selUserId);
    if (!u) { setSelUserId(null); return null; }
    return (
      <div className="page">
        <button className="back-btn" onClick={() => setSelUserId(null)}><Icon d={ICONS.back} size={16} /> {t("ad_title")}</button>
        {renderAccountCard(u)}
        {adding && <AddUserModal onClose={() => setAdding(false)} countries={countries} />}
      </div>
    );
  }

  // group accounts by role; orphan roles fall into a trailing "—" bucket
  const roleGroups = roles.map(r => ({ role: r, members: users.filter(u => u.role === r.id && !u._deleted) }))
    .filter(g => g.members.length > 0);
  const known = new Set(roles.map(r => r.id));
  const orphans = users.filter(u => !known.has(u.role) && !u._deleted);
  if (orphans.length) roleGroups.push({ role: { id: "__none", name: "—", scope: "own" }, members: orphans });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("ad_title")}</h1>
          <p className="page-sub">{t("ad_sub")}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => setAddingRole(true)}><Icon d={ICONS.admin} size={15} /> {t("ad_add_role")}</button>
          <SortMenu columns={memberSortCols} sort={sort.sort} onSort={sort.onSort} />
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon d={ICONS.plus} size={15} /> {t("ad_add")}</button>
        </div>
      </header>
      <div className="card note-card">{t("ad_scope_note")}</div>

      <div className="card roles-card">
        <h2>{t("ad_roles_title")}
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setAddingRole(true)}>
            <Icon d={ICONS.plus} size={13} /> {t("ad_add_role")}
          </button>
        </h2>
        <div className="chip-row">
          {roles.map(r => (
            <span key={r.id} className="role-pill">
              <input className="input input-name" value={r.name} onChange={e => setRoles(roles.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))} />
              {r.fixed ? <small>{r.scope === "all" ? t("scope_all") : t("scope_own")}</small> : (
                <select className="select" value={r.scope} onChange={e => setRoles(roles.map(x => x.id === r.id ? { ...x, scope: e.target.value } : x))}>
                  <option value="own">{t("scope_own")}</option>
                  <option value="country">{t("scope_country")}</option>
                  <option value="all">{t("scope_all")}</option>
                </select>
              )}
              {!r.fixed && (
                <button className="role-x" title={t("ad_remove")} onClick={() => {
                  if (users.some(u => u.role === r.id)) return;
                  setRoles(roles.filter(x => x.id !== r.id));
                }}>✕</button>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="role-acc-list">
        {roleGroups.map(({ role: r, members }) => {
          const open = grp.isOpen(r.id);
          const scopeLabel = r.scope === "all" ? t("scope_all") : r.scope === "country" ? t("scope_country") : t("scope_own");
          return (
            <div className="card role-acc-group" key={r.id}>
              <button className={"role-acc-head" + (open ? " open" : "")} onClick={() => grp.toggle(r.id)}>
                <GroupChevron open={open} />
                <span className="role-acc-name">{r.name}</span>
                <span className="grp-count">{members.length}</span>
                <small className="role-acc-scope">{scopeLabel}</small>
              </button>
              {open && (
                <div className="role-acc-members">
                  {sort.apply(members, memberAccessors).map(u => {
                    const role = roleOf(u);
                    return (
                      <button className={"acct-member" + (u.active ? "" : " inactive")} key={u.id} onClick={() => setSelUserId(u.id)}>
                        <Avatar name={u.name} size={34} src={u.photo} color={role.scope === "all" ? "var(--navy)" : undefined} />
                        <div className="acct-member-id">
                          <strong>{u.name}{u.id === user.id ? " · you" : ""}</strong>
                          <small>{u.email || "—"}{u.salesCode ? " · " + u.salesCode : ""}</small>
                        </div>
                        {!u.active && <span className="acct-member-off">{t("ad_active")}: ✕</span>}
                        <Icon d='<path d="M9 18l6-6-6-6"/>' size={16} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding && <AddUserModal onClose={() => setAdding(false)} countries={countries} />}
      {addingRole && <AddRoleModal onClose={() => setAddingRole(false)} />}
    </div>
  );
}

function AddRoleModal({ onClose }) {
  const { t, roles, setRoles } = useApp();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("own");
  const valid = name.trim().length >= 2 && !roles.some(r => r.name.toLowerCase() === name.trim().toLowerCase());
  const submit = () => {
    if (!valid) return;
    setRoles([...roles, { id: "R" + Date.now().toString(36), name: name.trim(), scope }]);
    onClose();
  };
  return (
    <Modal title={t("ad_add_role")} onClose={onClose} width={420}>
      <div className="form-grid form-grid-1">
        <Field label={t("ad_role_name")} required>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Country Manager…" autoFocus />
        </Field>
        <Field label={t("ad_scope")}>
          <select className="select" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="own">{t("scope_own")}</option>
            <option value="country">{t("scope_country")}</option>
            <option value="all">{t("scope_all")}</option>
          </select>
        </Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t("ad_add_role")}</button>
      </div>
    </Modal>
  );
}

function AddUserModal({ onClose, countries }) {
  const { t, users, setUsers, roles } = useApp();
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("SALE");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [emailNew, setEmailNew] = useState("");
  const [country, setCountry] = useState(countries[0] || "Thailand");
  const role = roles.find(r => r.id === roleId) || { scope: "own" };
  // Every non-admin account is tied to a country and must carry a Sales Code — it is the
  // PIC key used across PO List / Targets / Forecast. Only Admin (scope "all") may omit it
  // (Admins are resolved by name and cover both countries).
  const needsCode = role.scope !== "all";
  const valid = name.trim() && emailNew.trim() && (!needsCode || code.trim());
  const submit = () => {
    if (!valid) return;
    const em = emailNew.trim().toLowerCase();
    const u = {
      id: "u-" + Date.now(), name: name.trim(), role: roleId, email: emailNew.trim(), password: "todaytec",
      salesCode: (code.trim() || name.trim()).toUpperCase(),
      countries: role.scope === "all" ? ["*"] : [country],
      modules: role.scope === "all" ? [...AD.MODULES]
        : ["overview", "customers", "pipelines", "projects", "samples", "quotations", "polist", "products", "target", "forecast", "retention"],
      active: true, loginCard: true,
    };
    // Latest-wins: an email uniquely identifies one account. Drop every existing record
    // with the same email (active OR soft-deleted tombstone) before adding, so deleting
    // an address and re-adding it replaces the old account instead of piling up
    // duplicate logins that the sign-in screen would then match ambiguously.
    const deduped = users.filter(x => (x.email || "").trim().toLowerCase() !== em);
    setUsers([...deduped, u]);
    onClose();
  };
  return (
    <Modal title={t("ad_add")} onClose={onClose} width={460}>
      <div className="form-grid form-grid-1">
        <Field label={t("ad_user")} required>
          <input className="input" value={name} onChange={e => { const v = e.target.value; setName(v); if (!codeTouched) { const w = v.trim().split(/\s+/); setCode((w[w.length - 1] || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()); } }} placeholder={t("ad_name_ph")} autoFocus />
        </Field>
        <Field label={t("ad_role")}>
          <select className="select" value={roleId} onChange={e => setRoleId(e.target.value)}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={t("login_email")} required>
          <input className="input" type="email" value={emailNew} onChange={e => setEmailNew(e.target.value)} placeholder="name@todaytec.vn" />
        </Field>
        {role.scope !== "all" && <>
          <Field label={t("ad_sales_code") + (needsCode ? "" : " ")} required={needsCode}>
            <input className="input" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }} placeholder={t("ad_code_ph")} />
          </Field>
          <Field label={t("country")}>
            <select className="select" value={country} onChange={e => setCountry(e.target.value)}>
              {countries.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t("ad_add")}</button>
      </div>
    </Modal>
  );
}

window.AdminPage = AdminPage;
