// Todaytec CRM — Accounts & Permissions (custom roles, photo, rename)
const AD = window.CRM;

// Access is granted per ROLE: role.perms = { module: "view" | "edit" | "admin" } is the
// source of truth (a missing key = no access). Each account still carries a copy — `modules`
// (modules at view or above; the nav gates and the Worker's isAdmin read it) and `perms` — so
// every role edit is written through to that role's accounts.
const AD_TEAM_MODULES = AD.MODULES.filter(m => m !== "admin");
const AD_LEVELS = AD.PERM_LEVELS; // ["none", "view", "edit", "admin"]
const adNormMods = (mods) => AD.MODULES.filter(m => (mods || []).includes(m));
const adSameMods = (a, b) => adNormMods(a).join(",") === adNormMods(b).join(",");
const adFullPerms = () => Object.fromEntries(AD.MODULES.map(m => [m, "admin"]));
const adPermsKey = (p) => AD.MODULES.map(m => (p && p[m]) || "none").join(",");
// An all-data role is full access by definition (the app treats it as Admin); any other role
// can never hold the Permissions module.
function adRolePerms(r) {
  if (!r) return {};
  if (r.scope === "all") return adFullPerms();
  const src = r.perms && typeof r.perms === "object" ? r.perms
    : Object.fromEntries(adNormMods(r.modules || AD_TEAM_MODULES).map(m => [m, "edit"]));
  const out = {};
  AD_TEAM_MODULES.forEach(m => { if (src[m] && src[m] !== "none" && AD_LEVELS.includes(src[m])) out[m] = src[m]; });
  return out;
}
const adRoleMods = (r) => { const p = adRolePerms(r); return AD.MODULES.filter(m => p[m]); };
const adRoleLocked = (r) => r.id === "BOD" || r.scope === "all";
const adHasPerms = (r) => !!(r && r.perms && typeof r.perms === "object");
// An account's current levels: its perms copy, or (written before levels existed) its old flags.
function adUserPerms(u) {
  const out = {};
  AD.MODULES.forEach(m => { const l = AD.permOf(u, m, false); if (l !== "none") out[m] = l; });
  return out;
}
// Most common value; a tie keeps the one listed later in `order` (wider access), so nobody's
// access is narrowed by default.
function adMostCommon(values, order) {
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || order(b[0]) - order(a[0]))[0];
  return { value: best ? best[0] : null, mixed: counts.size > 1 };
}

// Migration to role levels: a role with no `perms` yet takes, per module it grants, the level
// its accounts have today (all can delete -> admin, can edit -> edit, else view; the most
// common one when they differ, flagged). Roles with no module list take their accounts'
// module set first. Accounts are not touched.
function adDeriveRoles(roles, users) {
  let changed = false;
  const next = roles.map(r => {
    if (adHasPerms(r)) return r;
    changed = true;
    if (r.scope === "all") return { ...r, modules: [...AD.MODULES], perms: adFullPerms() };
    const members = users.filter(u => u.role === r.id && !u._deleted);
    let mods = Array.isArray(r.modules) ? adNormMods(r.modules).filter(m => m !== "admin") : null;
    let modulesMixed = !!r.modulesMixed;
    if (!mods) {
      if (!members.length) mods = [...AD_TEAM_MODULES];
      else {
        const pick = adMostCommon(members.map(u => adNormMods(u.modules).filter(m => m !== "admin").join(",")), k => k.split(",").length);
        mods = pick.value ? pick.value.split(",") : [];
        modulesMixed = modulesMixed || pick.mixed;
      }
    }
    const perms = {}, permsMixed = [];
    mods.forEach(m => {
      const levels = members.filter(u => (u.modules || []).includes(m)).map(u => AD.permOf(u, m, false));
      if (!levels.length) { perms[m] = "edit"; return; }
      const pick = adMostCommon(levels, AD.permRank);
      perms[m] = pick.value;
      if (pick.mixed) permsMixed.push(m);
    });
    const { modulesMixed: _mm, permsMixed: _pm, ...rest } = r;
    return { ...rest, modules: mods, perms, ...(modulesMixed ? { modulesMixed: true } : {}), ...(permsMixed.length ? { permsMixed } : {}) };
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
    const next = adDeriveRoles(base, users) || base;
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

  // Writes a role's new levels through to its accounts. Only the `touched` modules change
  // on each account, so an account that still differs elsewhere (see the notice) keeps that
  // until confirmed — but it now carries `perms`, i.e. it is on role levels from here on.
  const applyRolePerms = (r, perms, touched) => {
    const { modulesMixed, permsMixed, ...rest } = r;
    const pm = (permsMixed || []).filter(m => !touched.includes(m));
    const nr = { ...rest, perms, modules: AD.MODULES.filter(m => perms[m]), ...(modulesMixed ? { modulesMixed } : {}), ...(pm.length ? { permsMixed: pm } : {}) };
    setRoles(roles.map(x => x.id === r.id ? nr : x));
    commitUsers(users.map(u => {
      if (u.role !== r.id || u._deleted) return u;
      const up = adUserPerms(u);
      touched.forEach(m => { if (perms[m]) up[m] = perms[m]; else delete up[m]; });
      const mods = AD.MODULES.filter(m => up[m]);
      if (u.perms && adPermsKey(u.perms) === adPermsKey(up) && adSameMods(u.modules, mods)) return u;
      return { ...u, perms: up, modules: mods };
    }));
  };
  const setRoleLevel = (r, m, level) => {
    if (adRoleLocked(r) || m === "admin") return;
    const perms = { ...adRolePerms(r) };
    if (level === "none") delete perms[m]; else perms[m] = level;
    applyRolePerms(r, perms, [m]);
  };
  const setRoleAll = (r, level) => {
    if (adRoleLocked(r) || !level) return;
    const perms = level === "none" ? {} : Object.fromEntries(AD_TEAM_MODULES.map(m => [m, level]));
    applyRolePerms(r, perms, AD_TEAM_MODULES);
  };
  const changeRoleScope = (r, scope) => {
    if (r.id === "BOD" || scope === r.scope) return;
    const members = membersOf(r.id);
    if (r.scope === "all" && scope !== "all" && members.some(u => u.active) && allScopeAdmins(r.id) < 1) { window.alert(t("ad_need_admin")); return; }
    if (scope === "all" && members.length && !window.confirm(t("ad_scope_all_confirm").replace("{n}", members.length))) return;
    const base = adRolePerms(r);
    const nr = { ...r, scope };
    nr.perms = scope === "all" ? adFullPerms() : Object.fromEntries(Object.entries(base).filter(([m]) => m !== "admin"));
    nr.modules = AD.MODULES.filter(m => nr.perms[m]);
    setRoles(roles.map(x => x.id === r.id ? nr : x));
    const perms = adRolePerms(nr), mods = adRoleMods(nr);
    commitUsers(users.map(u => {
      if (u.role !== r.id || u._deleted) return u;
      // all-data roles must see every country; leaving it falls back to one market
      const cs = scope === "all" ? ["*"] : (u.countries || []).includes("*") ? ["Thailand"] : u.countries;
      return { ...u, modules: mods, perms, countries: cs };
    }));
  };
  const renameRole = (r, name) => updateRole(r.id, { name });
  const deleteRole = (r) => {
    const n = membersOf(r.id).length;
    if (n) { setRoleMsg(t("ad_role_in_use").replace("{role}", r.name).replace("{n}", n)); return; }
    if (!window.confirm(t("ad_role_delete_confirm").replace("{role}", r.name))) return;
    setRoleMsg("");
    setRoles(roles.filter(x => x.id !== r.id));
  };

  // Moving an account to another role gives it that role's levels.
  const changeUserRole = (u, roleId) => {
    const r = roles.find(x => x.id === roleId);
    if (!r) return;
    const wasAdmin = roleOf(u).scope === "all";
    if (wasAdmin && r.scope !== "all" && u.active && allScopeAdmins(null) <= 1) { window.alert(t("ad_need_admin")); return; }
    const p = { role: roleId, modules: adRoleMods(r), perms: adRolePerms(r) };
    p.countries = r.scope === "all" ? ["*"] : (u.countries || []).includes("*") ? ["Thailand"] : u.countries;
    patch(u.id, p);
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

  // Accounts not yet on their role's levels: a different module list or level, or no `perms`
  // copy yet (still on the old per-account flags). `changes` is what Apply would change.
  const drift = roles.filter(r => adHasPerms(r) || r.scope === "all").flatMap(r => membersOf(r.id).map(u => {
    const want = adRolePerms(r), have = adUserPerms(u);
    const changes = AD.MODULES.filter(m => (want[m] || "none") !== (have[m] || "none")).map(m => ({ m, from: have[m] || "none", to: want[m] || "none" }));
    if (!changes.length && (r.scope === "all" || (u.perms && adPermsKey(u.perms) === adPermsKey(want))) && adSameMods(u.modules, adRoleMods(r))) return null;
    return { u, r, changes };
  }).filter(Boolean));
  const driftChanged = drift.filter(d => d.changes.length);
  const driftQuiet = drift.length - driftChanged.length;
  const applyDrift = () => {
    const fix = new Map(drift.map(d => [d.u.id, d.r]));
    setRoles(roles.map(r => { const { modulesMixed, permsMixed, ...rest } = r; return rest; }));
    commitUsers(users.map(u => fix.has(u.id) ? { ...u, modules: adRoleMods(fix.get(u.id)), perms: adRolePerms(fix.get(u.id)) } : u));
  };
  const lvLabel = (l) => t("lv_" + (l || "none"));

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
            <label>{t("ad_levels")}</label>
            <div className="chip-row">
              {AD.MODULES.map(m => {
                const lv = AD.permOf(u, m, role.scope === "all");
                return <span key={m} className={"chip chip-static perm-chip perm-lv-" + lv}>{t("nav_" + m)} · {lvLabel(lv)}</span>;
              })}
            </div>
            <small className="status-hint">{t("ad_modules_from_role").replace("{role}", role.name)}{!u.perms && role.scope !== "all" ? " " + t("ad_levels_legacy") : ""}</small>
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
            {driftChanged.map(({ u, r, changes }) => (
              <li key={u.id}>
                <strong>{u.name}</strong> <span className="perm-drift-role">{r.name}</span>
                {changes.map(({ m, from, to }) => (
                  <span key={m} className={"perm-drift-chg " + (AD.permRank(to) > AD.permRank(from) ? "perm-drift-add" : "perm-drift-drop")}>
                    {t("nav_" + m)}: {lvLabel(from)} → {lvLabel(to)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {driftQuiet > 0 && <p className="perm-drift-quiet">{t("ad_drift_quiet").replace("{n}", driftQuiet)}</p>}
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
                      <small>{t("ad_role_accounts").replace("{n}", n)}{r.modulesMixed || (r.permsMixed || []).length ? " · " + t("ad_role_mixed") : ""}</small>
                      {!adRoleLocked(r) && (
                        <select className="select perm-setall" value="" aria-label={r.name + " · " + t("ad_set_all")} disabled={save && save.state === "saving"}
                          onChange={e => { const v = e.target.value; e.target.value = ""; setRoleAll(r, v); }}>
                          <option value="">{t("ad_set_all")}</option>
                          {AD_LEVELS.map(l => <option key={l} value={l}>{lvLabel(l)}</option>)}
                        </select>
                      )}
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
                    const lv = adRolePerms(r)[m] || "none";
                    const mixed = (r.permsMixed || []).includes(m);
                    return (
                      <td key={r.id} className={locked ? "perm-locked" : ""}>
                        <select className={"perm-lv perm-lv-" + lv} value={lv} disabled={locked || (save && save.state === "saving")}
                          aria-label={r.name + " · " + t("nav_" + m)}
                          title={locked ? (m === "admin" && !adRoleLocked(r) ? t("ad_admin_mod_hint") : t("ad_locked_hint")) : mixed ? t("ad_level_mixed") : undefined}
                          onChange={e => setRoleLevel(r, m, e.target.value)}>
                          {(m === "admin" ? ["none", "admin"] : AD_LEVELS).map(l => <option key={l} value={l}>{lvLabel(l)}</option>)}
                        </select>
                        {mixed && <span className="perm-mixed-dot" title={t("ad_level_mixed")}>•</span>}
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
    setRoles([...roles, { id: "R" + Date.now().toString(36), name: name.trim(), scope, modules: scope === "all" ? [...AD.MODULES] : [...AD_TEAM_MODULES], perms: scope === "all" ? adFullPerms() : Object.fromEntries(AD_TEAM_MODULES.map(m => [m, "edit"])) }]);
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
      // a new account gets its role's levels
      modules: adRoleMods(role), perms: adRolePerms(role),
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
