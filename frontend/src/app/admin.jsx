// Todaytec CRM — Accounts & Permissions (custom roles, photo, rename)
const AD = window.CRM;

// Modules are granted per ROLE: a role's `modules` list is the source of truth. Each
// account still carries its own `modules` copy (the nav gates and the Worker's isAdmin read
// it), so every role edit is written through to that role's accounts.
const AD_TEAM_MODULES = AD.MODULES.filter(m => m !== "admin");
const adNormMods = (mods) => AD.MODULES.filter(m => (mods || []).includes(m));
const adSameMods = (a, b) => adNormMods(a).join(",") === adNormMods(b).join(",");
// An all-data role is full access by definition (the app treats it as Admin), so it gets
// every module; any other role can never hold "admin".
const adRoleMods = (r) => !r ? [] : r.scope === "all" ? [...AD.MODULES]
  : adNormMods(r.modules || AD_TEAM_MODULES).filter(m => m !== "admin");
const adRoleLocked = (r) => r.id === "BOD" || r.scope === "all";

// First run of the role-based model: give every role that has no module list yet the set
// its accounts already use (the most common one when they differ). Accounts are not touched.
function adDeriveRoleModules(roles, users) {
  let changed = false;
  const next = roles.map(r => {
    if (Array.isArray(r.modules)) return r;
    changed = true;
    if (r.scope === "all") return { ...r, modules: [...AD.MODULES] };
    const members = users.filter(u => u.role === r.id && !u._deleted);
    if (!members.length) return { ...r, modules: [...AD_TEAM_MODULES] };
    const counts = new Map();
    members.forEach(u => { const k = adNormMods(u.modules).filter(m => m !== "admin").join(","); counts.set(k, (counts.get(k) || 0) + 1); });
    // most common set; a tie keeps the larger set so nobody's access is narrowed by default
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].split(",").length - a[0].split(",").length)[0];
    return { ...r, modules: best ? best.split(",") : [], ...(counts.size > 1 ? { modulesMixed: true } : {}) };
  });
  return changed ? next : null;
}

function AdminPage() {
  const { t, user, isBoss, users, setUsers, usersSynced, customers, roles, setRoles, rolesRemote, rolesLocalOnly, rolesSave, roleOf } = useApp();
  const [adding, setAdding] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [selUserId, setSelUserId] = useState(null);
  const [pwUser, setPwUser] = useState(null);
  const [save, setSave] = useState(null); // { state: "saving"|"saved"|"error", failed: [names] }
  const [roleMsg, setRoleMsg] = useState("");
  const grp = useGroupToggle();
  const sort = useSort("name", "asc");
  const memberAccessors = { name: u => u.name || "", code: u => u.salesCode || "", email: u => u.email || "", active: u => u.active ? 0 : 1 };
  const memberSortCols = [
    { key: "name", label: t("ad_user") },
    { key: "code", label: t("ad_sales_code") },
    { key: "email", label: t("login_email") },
    { key: "active", label: t("ad_active") },
  ];

  // One-time migration — waits for the Worker's account list and the stored role list, so it
  // never derives from a stale local copy. When nothing is stored yet, the first admin to open
  // this page seeds settings/roles (roles only; accounts are not written). Roles that only this
  // browser knew and that accounts still use are added to the stored list.
  useEffect(() => {
    if (!isBoss || !usersSynced || rolesRemote === "loading" || rolesRemote === "error") return;
    const live = users.filter(u => !u._deleted);
    const extras = rolesRemote === "loaded" ? rolesLocalOnly.filter(r => live.some(u => u.role === r.id)) : [];
    const base = extras.length ? [...roles, ...extras] : roles;
    const next = adDeriveRoleModules(base, users) || base;
    if (rolesRemote === "missing") setRoles(next, { all: true });
    else if (next !== roles) setRoles(next);
  }, [isBoss, usersSynced, rolesRemote]);

  if (!isBoss) return <div className="page"><div className="card empty-card">{t("ad_only_bod")}</div></div>;

  // Country options are limited to the markets the company operates in.
  const countries = [...AD.MARKETS].sort();
  const live = users.filter(u => !u._deleted);
  const membersOf = (rid) => live.filter(u => u.role === rid);

  // Writes the accounts and reports how the Worker answered.
  const commitUsers = (next) => {
    setSave({ state: "saving" });
    return Promise.resolve(setUsers(next)).then(res => {
      const failed = (res || []).filter(r => !r.ok).map(r => (users.find(u => u.id === r.id) || { name: r.id }).name);
      setSave(failed.length ? { state: "error", failed } : { state: "saved" });
    });
  };
  const patch = (id, p) => commitUsers(users.map(u => u.id === id ? { ...u, ...p } : u));

  const updateRole = (rid, p) => setRoles(roles.map(r => r.id === rid ? { ...r, ...p } : r));
  const allScopeAdmins = (exceptRoleId) => live.filter(u => u.active && u.role !== exceptRoleId && roleOf(u).scope === "all").length;

  // Toggling a module adds/removes just that module on every account of the role, so an
  // account that still differs (see the notice) keeps its other differences until confirmed.
  const toggleRoleModule = (r, m) => {
    if (adRoleLocked(r) || m === "admin") return;
    const cur = adRoleMods(r);
    const on = !cur.includes(m);
    const mods = on ? adNormMods([...cur, m]) : cur.filter(x => x !== m);
    const { modulesMixed, ...rest } = r;
    setRoles(roles.map(x => x.id === r.id ? { ...rest, modules: mods } : x));
    const next = users.map(u => {
      if (u.role !== r.id || u._deleted) return u;
      const has = (u.modules || []).includes(m);
      if (has === on) return u;
      return { ...u, modules: on ? adNormMods([...(u.modules || []), m]) : (u.modules || []).filter(x => x !== m) };
    });
    commitUsers(next);
  };
  const changeRoleScope = (r, scope) => {
    if (r.id === "BOD" || scope === r.scope) return;
    const members = membersOf(r.id);
    if (r.scope === "all" && scope !== "all" && members.some(u => u.active) && allScopeAdmins(r.id) < 1) { window.alert(t("ad_need_admin")); return; }
    if (scope === "all" && members.length && !window.confirm(t("ad_scope_all_confirm").replace("{n}", members.length))) return;
    const nr = { ...r, scope, modules: scope === "all" ? [...AD.MODULES] : adRoleMods(r).filter(m => m !== "admin") };
    setRoles(roles.map(x => x.id === r.id ? nr : x));
    const mods = adRoleMods(nr);
    const next = users.map(u => {
      if (u.role !== r.id || u._deleted) return u;
      // all-data roles must see every country; leaving it falls back to one market
      const cs = scope === "all" ? ["*"] : (u.countries || []).includes("*") ? ["Thailand"] : u.countries;
      return { ...u, modules: mods, countries: cs };
    });
    commitUsers(next);
  };
  const renameRole = (r, name) => updateRole(r.id, { name });
  const deleteRole = (r) => {
    const n = membersOf(r.id).length;
    if (n) { setRoleMsg(t("ad_role_in_use").replace("{role}", r.name).replace("{n}", n)); return; }
    if (!window.confirm(t("ad_role_delete_confirm").replace("{role}", r.name))) return;
    setRoleMsg("");
    setRoles(roles.filter(x => x.id !== r.id));
  };

  // Moving an account to another role gives it that role's modules.
  const changeUserRole = (u, roleId) => {
    const r = roles.find(x => x.id === roleId);
    if (!r) return;
    const wasAdmin = roleOf(u).scope === "all";
    if (wasAdmin && r.scope !== "all" && u.active && allScopeAdmins(null) <= 1) { window.alert(t("ad_need_admin")); return; }
    const p = { role: roleId, modules: adRoleMods(r) };
    p.countries = r.scope === "all" ? ["*"] : (u.countries || []).includes("*") ? ["Thailand"] : u.countries;
    patch(u.id, p);
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
    const u = users.find(x => x.id === id);
    if (u && !window.confirm(t("ad_remove_confirm").replace("{name}", u.name || u.email || id))) return;
    // soft-delete (tombstone) so the seed merge can't resurrect the account and the
    // deletion persists to Supabase — a deleted account can no longer sign in.
    commitUsers(users.map(u => u.id === id ? { ...u, _deleted: true, active: false } : u));
    if (selUserId === id) setSelUserId(null);
  };

  // Accounts whose own module list differs from their role's (legacy per-account grants).
  const drift = roles.filter(r => Array.isArray(r.modules) || r.scope === "all").flatMap(r => membersOf(r.id)
    .filter(u => !adSameMods(u.modules, adRoleMods(r)))
    .map(u => {
      const want = adRoleMods(r), have = adNormMods(u.modules);
      return { u, r, add: want.filter(m => !have.includes(m)), drop: have.filter(m => !want.includes(m)) };
    }));
  const applyDrift = () => {
    const fix = new Map(drift.map(d => [d.u.id, adRoleMods(d.r)]));
    setRoles(roles.map(r => { const { modulesMixed, ...rest } = r; return rest; }));
    commitUsers(users.map(u => fix.has(u.id) ? { ...u, modules: fix.get(u.id) } : u));
  };

  const scopeShort = (s) => s === "all" ? t("scope_all_s") : s === "country" ? t("scope_country_s") : t("scope_own_s");
  const rolesBadge = rolesSave === "error" ? <span className="perm-save perm-save-error" role="status">{t("ad_roles_save_failed")}</span>
    : rolesRemote === "error" ? <span className="perm-save perm-save-error" role="status">{t("ad_roles_load_failed")}</span>
    : rolesSave === "saving" ? <span className="perm-save" role="status">{t("ad_saving")}</span> : null;
  const saveBadge = save && (
    <span className={"perm-save perm-save-" + save.state} role="status">
      {save.state === "saving" ? t("ad_saving") : save.state === "saved" ? t("ad_saved")
        : t("ad_save_failed").replace("{names}", save.failed.join(", "))}
    </span>
  );

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
            <select className="select" value={u.role} onChange={e => changeUserRole(u, e.target.value)}>
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
                <span key={m} className={"chip chip-static" + ((u.modules || []).includes(m) ? " on" : "")}>{t("nav_" + m)}</span>
              ))}
            </div>
            <small className="status-hint">{t("ad_modules_from_role").replace("{role}", role.name)}</small>
          </div>
          <div className="admin-ctl admin-ctl-wide">
            <label>{t("ad_edit_perms")}</label>
            <div className="chip-row">
              {AD_TEAM_MODULES.map(m => {
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
              {AD_TEAM_MODULES.map(m => {
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
              {AD_TEAM_MODULES.map(m => {
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
          <button className="btn btn-ghost btn-sm" onClick={() => setPwUser(u)}>{t("ad_set_password")}</button>
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
        <div className="perm-back-row">
          <button className="back-btn" onClick={() => setSelUserId(null)}><Icon d={ICONS.back} size={16} /> {t("ad_title")}</button>
          {saveBadge}
        </div>
        {renderAccountCard(u)}
        {adding && <AddUserModal onClose={() => setAdding(false)} countries={countries} />}
        {pwUser && <SetPasswordModal target={pwUser} onClose={() => setPwUser(null)} />}
      </div>
    );
  }

  // group accounts by role; orphan roles fall into a trailing "—" bucket
  const roleGroups = roles.map(r => ({ role: r, members: membersOf(r.id) }))
    .filter(g => g.members.length > 0);
  const known = new Set(roles.map(r => r.id));
  const orphans = live.filter(u => !known.has(u.role));
  if (orphans.length) roleGroups.push({ role: { id: "__none", name: "—", scope: "own" }, members: orphans });
  const countriesText = (u) => (u.countries || []).includes("*") ? t("ad_all_countries") : (u.countries || []).join(", ") || "—";

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

      {drift.length > 0 && (
        <div className="card perm-drift" role="note">
          <div className="perm-drift-head">
            <strong>{t("ad_drift_title").replace("{n}", drift.length)}</strong>
            <button className="btn btn-primary btn-sm" disabled={save && save.state === "saving"} onClick={applyDrift}>{t("ad_drift_apply")}</button>
          </div>
          <p>{t("ad_drift_hint")}</p>
          <ul>
            {drift.map(({ u, r, add, drop }) => (
              <li key={u.id}>
                <strong>{u.name}</strong> <span className="perm-drift-role">{r.name}</span>
                {add.length > 0 && <span className="perm-drift-add">+ {add.map(m => t("nav_" + m)).join(", ")}</span>}
                {drop.length > 0 && <span className="perm-drift-drop">− {drop.map(m => t("nav_" + m)).join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card perm-card">
        <div className="perm-card-head">
          <h2>{t("ad_perm_matrix")}</h2>
          {saveBadge}
          {rolesBadge}
        </div>
        {roleMsg && <div className="perm-msg" role="alert">{roleMsg}<button className="role-x" onClick={() => setRoleMsg("")}>✕</button></div>}
        <div className="perm-scroll">
          <table className="perm-matrix">
            <thead>
              <tr>
                <th className="perm-corner">{t("ad_perm_module")}</th>
                {roles.map(r => {
                  const n = membersOf(r.id).length;
                  return (
                    <th key={r.id} className={"perm-role" + (r.id === "BOD" ? " perm-role-fixed" : "")}>
                      <div className="perm-role-name">
                        <input className="input" value={r.name} title={r.name} size={Math.max(10, r.name.length + 2)} aria-label={t("ad_role_name")}
                          onChange={e => renameRole(r, e.target.value)}
                          onBlur={e => { if (!e.target.value.trim()) renameRole(r, r.id); }} />
                        {!r.fixed && <button className="role-x" title={n ? t("ad_role_in_use").replace("{role}", r.name).replace("{n}", n) : t("ad_remove")} onClick={() => deleteRole(r)}>✕</button>}
                      </div>
                      <small>{t("ad_role_accounts").replace("{n}", n)}{r.modulesMixed ? " · " + t("ad_role_mixed") : ""}</small>
                    </th>
                  );
                })}
                <th className="perm-add">
                  <button className="btn btn-ghost btn-sm" onClick={() => setAddingRole(true)}><Icon d={ICONS.plus} size={13} /> {t("ad_add_role")}</button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="perm-scope-row">
                <th>{t("ad_scope")}</th>
                {roles.map(r => (
                  <td key={r.id}>
                    <select className="select" value={r.scope} disabled={!!r.fixed} onChange={e => changeRoleScope(r, e.target.value)}>
                      <option value="all">{t("scope_all_s")}</option>
                      <option value="country">{t("scope_country_s")}</option>
                      <option value="own">{t("scope_own_s")}</option>
                    </select>
                  </td>
                ))}
                <td />
              </tr>
              {AD.MODULES.map(m => (
                <tr key={m}>
                  <th>{t("nav_" + m)}</th>
                  {roles.map(r => {
                    const locked = adRoleLocked(r) || m === "admin";
                    const on = adRoleMods(r).includes(m);
                    return (
                      <td key={r.id} className={locked ? "perm-locked" : ""}>
                        <input type="checkbox" checked={on} disabled={locked || (save && save.state === "saving")}
                          aria-label={r.name + " · " + t("nav_" + m)}
                          title={locked ? (m === "admin" && !adRoleLocked(r) ? t("ad_admin_mod_hint") : t("ad_locked_hint")) : undefined}
                          onChange={() => toggleRoleModule(r, m)} />
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small className="status-hint">{t("ad_perm_hint")}</small>
      </div>

      <div className="role-acc-list">
        {roleGroups.map(({ role: r, members }) => {
          const open = grp.isOpen(r.id);
          return (
            <div className="card role-acc-group" key={r.id}>
              <button className={"role-acc-head" + (open ? " open" : "")} onClick={() => grp.toggle(r.id)}>
                <GroupChevron open={open} />
                <span className="role-acc-name">{r.name}</span>
                <span className="grp-count">{members.length}</span>
                <small className="role-acc-scope">{scopeShort(r.scope)}</small>
              </button>
              {open && (
                <div className="role-acc-members">
                  {sort.apply(members, memberAccessors).map(u => {
                    const role = roleOf(u);
                    const kpiC = AD.kpiCountryOf(u);
                    return (
                      <div className={"acct-row" + (u.active ? "" : " inactive")} key={u.id}>
                        <button className="acct-row-id" onClick={() => setSelUserId(u.id)}>
                          <Avatar name={u.name} size={34} src={u.photo} color={role.scope === "all" ? "var(--navy)" : undefined} />
                          <div className="acct-member-id">
                            <strong>{u.name}{u.id === user.id ? " · you" : ""}</strong>
                            <small>{u.email || "—"}{u.salesCode ? " · " + u.salesCode : ""}</small>
                          </div>
                        </button>
                        <label className="acct-row-ctl">
                          <span>{t("ad_role")}</span>
                          <select className="select" value={u.role} onChange={e => changeUserRole(u, e.target.value)}>
                            {!known.has(u.role) && <option value={u.role}>{u.role || "—"}</option>}
                            {roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                        <div className="acct-row-ctl"><span>{t("ad_countries")}</span><em>{countriesText(u)}</em></div>
                        <div className="acct-row-ctl"><span>{t("ad_kpi_country")}</span><em>{kpiC || "—"}</em></div>
                        <div className="acct-row-ctl acct-row-active">
                          <span>{t("ad_active")}</span>
                          <button className={"toggle" + (u.active ? " on" : "")} aria-label={t("ad_active")} disabled={u.id === user.id} onClick={() => patch(u.id, { active: !u.active })}>
                            <span className="toggle-knob"></span>
                          </button>
                        </div>
                        <div className="acct-row-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => setSelUserId(u.id)}>{t("ad_edit_acc")}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setPwUser(u)}>{t("ad_set_password")}</button>
                          {u.id !== user.id && <button className="btn btn-ghost btn-sm acct-row-del" title={t("ad_remove")} onClick={() => remove(u.id)}>✕</button>}
                        </div>
                      </div>
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
      {pwUser && <SetPasswordModal target={pwUser} onClose={() => setPwUser(null)} />}
    </div>
  );
}

function SetPasswordModal({ target, onClose }) {
  const { t } = useApp();
  const [pw, setPw] = useState("");
  const [state, setState] = useState(null);
  const valid = pw.length >= 4;
  const submit = async () => {
    if (!valid) return;
    setState("saving");
    const r = await AD.API.setPassword(target.id, pw);
    setState(r.ok ? "saved" : "error");
    if (r.ok) setPw("");
  };
  return (
    <Modal title={t("ad_set_password") + " · " + (target.name || target.email)} onClose={onClose} width={420}>
      <div className="form-grid form-grid-1">
        <Field label={t("ad_new_password")} required>
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        </Field>
        <small className="status-hint">{t("ad_password_note")}</small>
        {state === "saved" && <small className="perm-save perm-save-saved">{t("ad_password_saved")}</small>}
        {state === "error" && <small className="perm-save perm-save-error">{t("ad_password_failed")}</small>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={!valid || state === "saving"} onClick={submit}>{t("ad_set_password")}</button>
      </div>
    </Modal>
  );
}

function AddRoleModal({ onClose }) {
  const { t, roles, setRoles } = useApp();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("own");
  const valid = name.trim().length >= 2 && !roles.some(r => r.name.toLowerCase() === name.trim().toLowerCase());
  const submit = () => {
    if (!valid) return;
    setRoles([...roles, { id: "R" + Date.now().toString(36), name: name.trim(), scope, modules: scope === "all" ? [...AD.MODULES] : [...AD_TEAM_MODULES] }]);
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
  const role = roles.find(r => r.id === roleId) || { scope: "own", modules: AD_TEAM_MODULES };
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
      // a new account gets its role's modules
      modules: adRoleMods(role),
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
