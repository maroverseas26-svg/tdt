// SMTP mail via worker-mailer. Credentials are Worker secrets:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
import { WorkerMailer } from "worker-mailer";

// MAIL_FROM may be "Name <addr@x>" or a bare address; worker-mailer wants { name, email }.
export function parseAddress(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || "");
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(s || "").trim() };
}

// attachments: [{ filename, content (base64), mimeType }]
export async function sendMail(env, { to, cc, subject, html, attachments }) {
  const port = Number(env.SMTP_PORT || 465);
  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465, // 465 = implicit TLS; 587 upgrades with STARTTLS
    startTls: port !== 465,
    credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
    authType: ["plain", "login"],
  });
  try {
    await mailer.send({ from: parseAddress(env.MAIL_FROM || env.SMTP_USER), to, cc, subject, html, attachments });
  } finally {
    await mailer.close();
  }
}
