// Shared helpers for the tdt Worker.

export const enc = new TextEncoder();
export const now = () => Math.floor(Date.now() / 1000);
export const normEmail = (s) => String(s || "").trim().toLowerCase();
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));

// Base64 <-> bytes without spreading huge arrays into String.fromCharCode (stack limit).
export function b64(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// SQLite string literal. Used where bound parameters would exceed D1's 100-per-query cap
// (long IN lists); quote doubling is the only escaping SQLite string literals need.
export const lit = (v) => "'" + String(v).replace(/\u0000/g, "").replace(/'/g, "''") + "'";

// Constant-time check of a request header against a secret (both hashed first so the
// comparison length never depends on the input).
export async function headerMatchesSecret(req, header, secret) {
  const got = req.headers.get(header);
  if (!secret || !got) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(got)), crypto.subtle.digest("SHA-256", enc.encode(secret))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
