// Copies CRM accounts from Supabase users(_all) into D1 "tdt", hashing passwords with
// PBKDF2-SHA256 (same format as src/index.js). Never prints passwords. Re-run right
// before the DNS cutover to pick up passwords changed in the old app.
//   CLOUDFLARE_API_TOKEN=... node scripts/sync-users-from-supabase.cjs
const c = require("crypto"), fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");

const KEY = "sb_publishable_oyNvDtCWmqijIP_DTiqlmA_3tn_W3_p"; // public key, already in the frontend bundle
const ITERATIONS = 100000;
// The old app falls back to the seed password when a seed account has none stored.
const SEED_IDS = ["u-hoang", "u-thao", "u-noom", "u-kook", "u-noon", "u-ice", "u-min", "u-tu", "u-khuong", "u-tien", "u-ly", "u-hien", "u-hang", "u-hoa"];
const seedPw = (id) => (id === "u-thao" ? "123" : SEED_IDS.includes(id) ? "todaytec" : "");
const q = (v) => (v == null ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");

const raw = execFileSync("curl", ["-sS", "-H", "apikey: " + KEY, "-H", "Authorization: Bearer " + KEY,
  "https://trmdqpgsdvujodhgyvlv.supabase.co/rest/v1/users?id=eq._all&select=data"], { encoding: "utf8" });
const users = JSON.parse(raw)[0].data;
const now = new Date().toISOString();
const sql = users.map((u) => {
  const { password, ...profile } = u;
  const pw = password || seedPw(u.id);
  let hash = null;
  if (pw) {
    const salt = c.randomBytes(16);
    hash = `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${c.pbkdf2Sync(String(pw), salt, ITERATIONS, 32, "sha256").toString("base64")}`;
  }
  return `INSERT INTO users (id,email,active,deleted,profile,pw_hash,pw_updated_at,updated_at) VALUES (${q(u.id)},${q(String(profile.email || "").trim().toLowerCase())},${profile.active === false ? 0 : 1},${profile._deleted ? 1 : 0},${q(JSON.stringify(profile))},${q(hash)},${hash ? q(now) : "NULL"},${q(now)})
ON CONFLICT(id) DO UPDATE SET email=excluded.email, active=excluded.active, deleted=excluded.deleted, profile=excluded.profile, pw_hash=excluded.pw_hash, pw_updated_at=excluded.pw_updated_at, updated_at=excluded.updated_at;`;
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tdt-users-"));
const file = path.join(dir, "users.sql");
fs.writeFileSync(file, sql.join("\n") + "\n", { mode: 0o600 });
try {
  execFileSync("npx", ["wrangler", "d1", "execute", "tdt", "--remote", "--file", file, "-y"], { cwd: path.join(__dirname, ".."), stdio: "inherit" });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`synced ${users.length} accounts`);
