// Todaytec CRM — Cloudflare Worker "tdt"
// Serves the CRM frontend (the bundled index.html), the auth API (/api/auth, /api/users),
// the CRM data API (/rest/v1, PostgREST-compatible, over D1), attachments (/api/files) and
// quote emails (/api/quotes/send).
// Every data route needs a session cookie; SMTP credentials are Worker secrets.
import INDEX_HTML from "../dist/index.html";
import { json, headerMatchesSecret } from "./util.js";
import { currentUser, publicAuthRoute, accountRoute } from "./auth.js";
import { restRoute } from "./rest.js";
import { rpcRoute } from "./rpc.js";
import { serveFile } from "./files.js";
import { sendQuote } from "./quotes.js";

// Data sync/verification scripts (worker/scripts) authenticate with the MIGRATION_TOKEN
// secret instead of a session; removing the secret disables this path.
const SYSTEM_USER = { id: "system", name: "system", role: "BOD", system: true };

async function route(req, env, url, ctx) {
  const { pathname: path } = url;
  // POSTs must be JSON: a cross-site <form> can't send that without a CORS preflight,
  // which this API never grants (PUT/DELETE always need one) — with SameSite=Lax that blocks CSRF.
  if (req.method === "POST" && !(req.headers.get("content-type") || "").includes("application/json")) {
    return json({ ok: false, error: "json_required" }, 415);
  }

  const open = publicAuthRoute(req, env, url, ctx);
  if (open) return open;

  const me = (await currentUser(req, env)) ||
    ((await headerMatchesSecret(req, "x-migration-token", env.MIGRATION_TOKEN)) ? SYSTEM_USER : null);
  if (!me) return json({ ok: false, error: "unauthorized" }, 401);

  if (path.startsWith("/rest/v1/rpc/") && req.method === "POST") return rpcRoute(req, env, url);
  if (path.startsWith("/rest/v1/")) return restRoute(req, env, url, me);
  const file = path.match(/^\/api\/files\/([0-9a-f]{64})$/);
  if (file && req.method === "GET") return serveFile(env, file[1], url);
  if (path === "/api/quotes/send" && req.method === "POST" && !me.system) return sendQuote(req, env, me);

  return (await accountRoute(req, env, url, me)) || json({ ok: false, error: "not_found" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/rest/v1/")) {
      if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(req.method === "HEAD" ? null : INDEX_HTML, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
        });
      }
      return new Response("Not found", { status: 404 });
    }
    try {
      return await route(req, env, url, ctx);
    } catch (e) {
      console.error("api error", url.pathname, e && e.stack);
      return json({ ok: false, error: "server_error" }, 500);
    }
  },
};
