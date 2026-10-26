// File attachments. The app stores attachments inline as data: URLs inside a record
// (e.g. PO proof scans), which can push one row past D1's 2 MB limit and makes every
// list download carry the files. On write they are moved into `files` (content-addressed,
// chunked) and the record keeps { name, type, size, dataUrl: "/api/files/<key>", fileKey }.
// The app's <a href={dataUrl} download> works unchanged against that same-origin URL.
import { sha256, json } from "./util.js";

const CHUNK = 900 * 1024;
const INLINE_MARK = '"dataUrl":"data:';

export const hasInlineFiles = (text) => text.includes(INLINE_MARK);

function decodeDataUrl(url) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (!m) return null;
  const isB64 = /;base64/i.test(m[2]);
  const bytes = isB64 ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { mime: m[1] || "application/octet-stream", bytes };
}

async function putFile(env, dataUrl, name) {
  const f = decodeDataUrl(dataUrl);
  if (!f) return null;
  const key = await sha256(f.bytes);
  const exists = await env.DB.prepare("SELECT 1 FROM files WHERE key = ?1 AND part = 0").bind(key).first();
  if (!exists) {
    const stmts = [];
    for (let off = 0, part = 0; off < f.bytes.length || part === 0; off += CHUNK, part++) {
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO files (key, part, mime, name, size, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(key, part, f.mime, String(name || ""), f.bytes.length, f.bytes.slice(off, off + CHUNK), Math.floor(Date.now() / 1000)));
    }
    await env.DB.batch(stmts);
  }
  return key;
}

// Returns the record with inline attachments moved out (same object when there were none).
export async function externalizeRecord(env, rec) {
  if (!rec || typeof rec !== "object" || !Array.isArray(rec.attachments)) return rec;
  let changed = false;
  const attachments = [];
  for (const a of rec.attachments) {
    if (a && typeof a.dataUrl === "string" && a.dataUrl.startsWith("data:")) {
      const key = await putFile(env, a.dataUrl, a.name);
      if (key) { attachments.push({ ...a, dataUrl: "/api/files/" + key, fileKey: key }); changed = true; continue; }
    }
    attachments.push(a);
  }
  return changed ? { ...rec, attachments } : rec;
}

export async function serveFile(env, key, url) {
  if (!/^[0-9a-f]{64}$/.test(key)) return json({ ok: false, error: "not_found" }, 404);
  const { results } = await env.DB.prepare("SELECT part, mime, name, size, data FROM files WHERE key = ?1 ORDER BY part").bind(key).all();
  if (!results.length) return json({ ok: false, error: "not_found" }, 404);
  // D1 hands BLOBs back as an array of byte values (ArrayBuffer on some runtimes).
  const parts = results.map((r) => (r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : Uint8Array.from(r.data)));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { body.set(p, off); off += p.length; }
  const name = url.searchParams.get("name") || results[0].name || "file";
  const mime = results[0].mime || "application/octet-stream";
  // Uploads are user content on the app's origin: only images and PDFs may render inline,
  // anything else (HTML, SVG, …) is forced to download so it can never run script here.
  const inline = (/^image\//.test(mime) && !/svg/i.test(mime)) || mime === "application/pdf";
  return new Response(body, {
    headers: {
      "content-type": mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
