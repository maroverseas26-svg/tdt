// Accounts, sessions and password reset. Accounts + PBKDF2 hashes live in D1 table `users`;
// the session is an HttpOnly cookie whose SHA-256 is stored in `sessions`.
import { enc, now, normEmail, randomToken, sha256, b64, unb64, json, escapeHtml } from "./util.js";
import { sendMail } from "./mail.js";

const SESSION_COOKIE = "tdt_session";
const SESSION_TTL_S = 30 * 24 * 3600;
const RESET_TTL_S = 30 * 60;
const MIN_PASSWORD = 4; // same rule as the app's reset screen (rp_short)
const MAX_FAILS = 10; // failed logins per email per window before 429
const FAIL_WINDOW_S = 15 * 60;
// Fields a non-admin may not change on their own profile.
const PROTECTED_FIELDS = ["id", "email", "role", "modules", "perms", "editModules", "deleteModules", "exportModules", "countries", "salesCode", "active", "_deleted", "loginCard"];

/* ---------- password hashing (PBKDF2-SHA256, iterations stored per hash) ---------- */
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
export async function hashPassword(password, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}
async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2-sha256" || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}
const iterationsOf = (env) => Number(env.PBKDF2_ITERATIONS) || 100000;

/* ---------- users ---------- */
export function toPublic(row) {
  const p = JSON.parse(row.profile || "{}");
  delete p.password;
  return { ...p, id: row.id, active: !!row.active, ...(row.deleted ? { _deleted: true } : {}) };
}
export const isAdmin = (u) => !!u && (u.system || u.role === "BOD" || (Array.isArray(u.modules) && u.modules.includes("admin")));
// Legacy duplicate emails: the newest account wins — its id carries the creation ms ("u-<ms>").
const idTime = (id) => { const m = /(\d{6,})/.exec(id || ""); return m ? +m[1] : 0; };

async function findLoginUser(env, email) {
  const { results } = await env.DB.prepare("SELECT * FROM users WHERE email = ?1 AND active = 1 AND deleted = 0").bind(email).all();
  return results.sort((a, b) => idTime(b.id) - idTime(a.id))[0] || null;
}

function upsertStmt(env, user) {
  const { password, ...profile } = user;
  return env.DB.prepare(
    `INSERT INTO users (id, email, active, deleted, profile, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, active = excluded.active, deleted = excluded.deleted,
       profile = excluded.profile, updated_at = excluded.updated_at`
  ).bind(String(user.id), normEmail(profile.email), profile.active === false ? 0 : 1, profile._deleted ? 1 : 0,
    JSON.stringify(profile), new Date().toISOString());
}
async function setPasswordStmts(env, userId, password) {
  return [
    env.DB.prepare("UPDATE users SET pw_hash = ?2, pw_updated_at = ?3 WHERE id = ?1")
      .bind(userId, await hashPassword(password, iterationsOf(env)), new Date().toISOString()),
    // A password change signs the account out everywhere.
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId),
  ];
}

// The old app kept every account in one Supabase row users(_all). /rest/v1 serves that
// shape from this table (profiles only — never a hash) and accepts admin writes to it.
export async function profilesBlob(env) {
  const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY id").all();
  return results.map(toPublic);
}
export async function saveProfilesBlob(env, me, list) {
  if (!isAdmin(me) || !Array.isArray(list)) return;
  const stmts = list.filter((u) => u && u.id && normEmail(u.email)).map((u) => upsertStmt(env, u));
  if (stmts.length) await env.DB.batch(stmts);
}

/* ---------- sessions ---------- */
function readCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export async function currentUser(req, env) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.active = 1 AND u.deleted = 0`
  ).bind(await sha256(token), now()).first();
  return row ? toPublic(row) : null;
}

function resetEmailHtml(appName, name, link) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#22313F">
    <h2 style="color:#0E7A71">${appName}</h2>
    <p>Hi ${name || "there"},</p>
    <p>We received a request to reset your password. Click the button below to set a new one. This link expires in ${RESET_TTL_S / 60} minutes.</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#13988D;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Reset password</a>
    </p>
    <p style="font-size:12px;color:#64748B">If you didn't request this, you can safely ignore this email.</p>
    <p style="font-size:12px;color:#94A3B8;word-break:break-all">${link}</p>
  </div>`;
}

/* ---------- handlers ---------- */
async function login(req, env) {
  const { email: rawEmail, password } = await req.json().catch(() => ({}));
  const email = normEmail(rawEmail);
  if (!email || !password) return json({ ok: false, error: "invalid_credentials" }, 400);

  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ?1 AND ts > ?2")
    .bind(email, now() - FAIL_WINDOW_S).first("n");
  if (fails >= MAX_FAILS) return json({ ok: false, error: "too_many_attempts" }, 429);

  const row = await findLoginUser(env, email);
  if (!row || !(await verifyPassword(String(password), row.pw_hash))) {
    await env.DB.prepare("INSERT INTO login_failures (email, ts) VALUES (?1, ?2)").bind(email, now()).run();
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256(token), row.id, now() + SESSION_TTL_S, now()),
    env.DB.prepare("DELETE FROM login_failures WHERE email = ?1 OR ts < ?2").bind(email, now() - FAIL_WINDOW_S),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now()),
  ]);
  return json({ ok: true, user: toPublic(row) }, 200, { "set-cookie": sessionCookie(token, SESSION_TTL_S) });
}

async function logout(req, env) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

// Always answers the same way so callers can't probe which emails exist; the mail
// itself goes out in waitUntil so response timing doesn't leak it either.
async function requestReset(req, env, url, ctx) {
  const { email } = await req.json().catch(() => ({}));
  const generic = json({ ok: true, message: "If that email is registered, a reset link has been sent." });
  const row = email ? await findLoginUser(env, normEmail(email)) : null;
  if (!row) return generic;

  const token = randomToken();
  await env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256(token), row.id, now() + RESET_TTL_S, now()).run();
  const base = (env.APP_URL || url.origin).replace(/\/$/, "");
  const link = `${base}/?reset=${token}`;
  const appName = env.APP_NAME || "Todaytec CRM";
  const profile = toPublic(row);
  ctx.waitUntil(
    sendMail(env, { to: profile.email, subject: `Reset your ${appName} password`, html: resetEmailHtml(escapeHtml(appName), escapeHtml(profile.name), link) })
      .catch((e) => console.error("reset mail failed", row.id, e && e.message))
  );
  return generic;
}

async function confirmReset(req, env) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.newPassword || body.password || "");
  const tokenHash = await sha256(String(body.token || ""));
  const rec = await env.DB.prepare("SELECT * FROM password_resets WHERE token_hash = ?1 AND used = 0 AND expires_at > ?2")
    .bind(tokenHash, now()).first();
  if (!rec) return json({ ok: false, error: "invalid_or_expired" }, 400);
  if (password.length < MIN_PASSWORD) return json({ ok: false, error: "too_short" }, 400);
  await env.DB.batch([
    ...(await setPasswordStmts(env, rec.user_id, password)),
    env.DB.prepare("UPDATE password_resets SET used = 1 WHERE token_hash = ?1").bind(tokenHash),
  ]);
  return json({ ok: true });
}

async function changePassword(req, env, me) {
  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT pw_hash FROM users WHERE id = ?1").bind(me.id).first();
  if (!row || !(await verifyPassword(String(currentPassword || ""), row.pw_hash))) return json({ ok: false, error: "invalid_credentials" }, 401);
  if (String(newPassword || "").length < MIN_PASSWORD) return json({ ok: false, error: "too_short" }, 400);
  await env.DB.batch(await setPasswordStmts(env, me.id, String(newPassword)));
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function listUsers(env) {
  return json({ ok: true, users: await profilesBlob(env) });
}

// Admins may save any account (and set an initial password); everyone else may only
// edit their own profile, with role/scope fields kept as they are.
async function saveUser(req, env, me, id) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ ok: false, error: "bad_request" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
  let user;
  if (isAdmin(me)) {
    user = { ...body, id };
  } else if (me.id === id && existing) {
    const cur = toPublic(existing);
    user = { ...cur, ...body, id };
    for (const k of PROTECTED_FIELDS) { if (k in cur) user[k] = cur[k]; else delete user[k]; }
    delete user.password;
  } else {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  if (!normEmail(user.email)) return json({ ok: false, error: "email_required" }, 400);
  const stmts = [upsertStmt(env, user)];
  if (isAdmin(me) && body.password) {
    if (String(body.password).length < MIN_PASSWORD) return json({ ok: false, error: "too_short" }, 400);
    stmts.push(...(await setPasswordStmts(env, id, String(body.password))));
  }
  if (user.active === false || user._deleted) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true, user: toPublic(await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first()) });
}

async function setUserPassword(req, env, id) {
  const { password } = await req.json().catch(() => ({}));
  if (String(password || "").length < MIN_PASSWORD) return json({ ok: false, error: "too_short" }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(id).first();
  if (!exists) return json({ ok: false, error: "not_found" }, 404);
  await env.DB.batch(await setPasswordStmts(env, id, String(password)));
  return json({ ok: true });
}

async function deleteUser(env, id) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const profile = { ...toPublic(row), active: false, _deleted: true };
  await env.DB.batch([upsertStmt(env, profile), env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id)]);
  return json({ ok: true });
}

// Routes that work without a session; returns null when the path isn't one of them.
export function publicAuthRoute(req, env, url, ctx) {
  const { pathname: path } = url;
  if (req.method !== "POST") return null;
  if (path === "/api/auth/login") return login(req, env);
  if (path === "/api/auth/logout") return logout(req, env);
  if (path === "/api/auth/request-reset") return requestReset(req, env, url, ctx);
  if (path === "/api/auth/confirm-reset") return confirmReset(req, env);
  return null;
}

// Session-only account routes; returns null when the path isn't one of them.
export function accountRoute(req, env, url, me) {
  const { pathname: path } = url;
  const method = req.method;
  if (path === "/api/auth/me" && method === "GET") return json({ ok: true, user: me });
  if (path === "/api/auth/change-password" && method === "POST") return changePassword(req, env, me);
  if (path === "/api/users" && method === "GET") return listUsers(env);
  const m = path.match(/^\/api\/users\/([^/]+)(\/password)?$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!m[2] && method === "PUT") return saveUser(req, env, me, id);
  if (!isAdmin(me)) return json({ ok: false, error: "forbidden" }, 403);
  if (m[2] && method === "POST") return setUserPassword(req, env, id);
  if (!m[2] && method === "DELETE") return deleteUser(env, id);
  return null;
}
