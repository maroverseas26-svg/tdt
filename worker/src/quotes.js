// POST /api/quotes/send — emails the quote files the browser built (Excel and/or PDF) to the
// signed-in salesperson, who forwards them to the customer. The recipient is always the
// session's own address, so this can't be used to mail anyone else.
import { json, escapeHtml } from "./util.js";
import { sendMail } from "./mail.js";

const TYPES = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" };
const MAX_BYTES = 15 * 1024 * 1024;

export async function sendQuote(req, env, me) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.files) || !body.files.length || body.files.length > 2) return json({ ok: false, error: "bad_request" }, 400);
  if (!me.email) return json({ ok: false, error: "no_email" }, 400);
  let bytes = 0;
  const attachments = [];
  for (const f of body.files) {
    const name = String((f && f.filename) || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    const ext = name.split(".").pop().toLowerCase();
    if (!TYPES[ext] || typeof f.content !== "string" || !f.content) return json({ ok: false, error: "bad_file" }, 400);
    bytes += Math.floor((f.content.length * 3) / 4);
    attachments.push({ filename: name, content: f.content, mimeType: TYPES[ext] });
  }
  if (bytes > MAX_BYTES) return json({ ok: false, error: "too_large" }, 413);

  const quoteNo = String(body.quoteNo || "").slice(0, 60);
  const customer = String(body.customer || "").slice(0, 200);
  const appName = env.APP_NAME || "Todaytec CRM";
  await sendMail(env, {
    to: { name: me.name || undefined, email: me.email },
    subject: `Quotation ${quoteNo}${customer ? " – " + customer : ""}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#22313F;max-width:560px">
      <p>Hi ${escapeHtml(me.name || "")},</p>
      <p>Attached is quotation <strong>${escapeHtml(quoteNo)}</strong>${customer ? ` for <strong>${escapeHtml(customer)}</strong>` : ""}
      (${attachments.map((a) => escapeHtml(a.filename)).join(", ")}), ready to forward to the customer.</p>
      <p style="font-size:12px;color:#64748B">Sent from ${escapeHtml(appName)}.</p></div>`,
    attachments,
  });
  return json({ ok: true, to: me.email });
}
