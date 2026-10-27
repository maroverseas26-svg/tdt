// Builds the branded (Todaytec Visual Identity 2024) sales user manual from the Markdown sections.
//
//   NODE_PATH=$(npm root -g) node docs/user-manual/branded/build-branded.mjs
//
// Reads ../00-…11-*.md and ../img/*.png, writes next to this script:
//   Todaytec-CRM-Sales-User-Manual.html   static, self-contained (fonts, logo and images embedded)
//   Todaytec-CRM-Sales-User-Manual.pdf    A4, printed from that HTML by Playwright's Chromium
//   preview/*.png                          cover, contents, a section page (steps + screenshot), a tips page
//
// The Markdown is laid out once in Chromium and paginated into A4 sheets by the script in
// PAGINATE below, so the HTML and the PDF have the same pages, running headers and page numbers.
// Optional env: MANUAL_VERSION (default 1.0), MANUAL_DATE (default: today, "October 2026").
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright"); // resolved via NODE_PATH
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const OUT_HTML = join(HERE, "Todaytec-CRM-Sales-User-Manual.html");
const OUT_PDF = join(HERE, "Todaytec-CRM-Sales-User-Manual.pdf");
const PREVIEW = join(HERE, "preview");

const TITLE = "Todaytec CRM — Sales User Manual";
const SUBTITLE = "Step-by-step guide for the sales team";
const VERSION = process.env.MANUAL_VERSION || "1.0";
const DATE = process.env.MANUAL_DATE || new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

// ---------- Brand (Todaytec Visual Identity 2024) ----------
// Primary: 天地蓝 Todaytec Blue #062741 (PANTONE 289 C), 天地绿 Todaytec Green #0c938e (PANTONE 7716 C).
// Secondary: white #ffffff, light grey #efefef, dark grey #7d7d7d, black #090909.
// Type: Roboto (English brand font); Source Han Sans / 思源黑体 for Chinese.

// ---------- Section titles ----------
// The sections have no title line. Titles come from the image table in ../README.md
// ("| `img/x.png` | 02 Customers | …"), falling back to the file name.
function sectionTitles() {
  const map = {};
  const readme = existsSync(join(SRC, "README.md")) ? readFileSync(join(SRC, "README.md"), "utf8") : "";
  for (const m of readme.matchAll(/^\|\s*`[^`]+`\s*\|\s*(\d{2})\s+([^|]+?)\s*\|/gm)) map[m[1]] ??= m[2];
  return map;
}
const titleFromFile = (f) =>
  f.replace(/^\d+-/, "").replace(/\.md$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ---------- Markdown → blocks (the subset the manual uses) ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Typographic polish only: curly quotes and apostrophes. Never rewrites words.
const smart = (s) =>
  s.replace(/(\w)'(\w)/g, "$1’$2").replace(/'([^']*)'/g, "‘$1’").replace(/"([^"]*)"/g, "“$1”");

function inline(md, { chips = true } = {}) {
  const codes = [];
  let s = md.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = smart(esc(s));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*(.+?)\*\*/g, (_, t) => (chips ? `<b class="ui${t.length <= 30 ? " nw" : ""}">${t}</b>` : `<strong>${t}</strong>`));
  s = s.replace(/(^|[^*\w])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

function parse(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,4})\s+(.*)$/))) { blocks.push({ t: "h", level: m[1].length, text: m[2] }); i++; continue; }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) { blocks.push({ t: "fig", alt: m[1], src: m[2] }); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
        .map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      blocks.push({ t: "table", head: cells[0], rows: cells.slice(1) });
      continue;
    }
    if (/^(\d+)\.\s+/.test(line) || /^[-*]\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i];
        const im = l.match(ordered ? /^(\d+)\.\s+(.*)$/ : /^[-*]\s+(.*)$/);
        if (im) items.push({ text: ordered ? im[2] : im[1], sub: [] });
        else if (/^\s+[-*]\s+/.test(l) && items.length) items.at(-1).sub.push(l.replace(/^\s+[-*]\s+/, ""));
        else if (/^\s+\S/.test(l) && items.length) items.at(-1).text += " " + l.trim();
        else break;
        i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "note", text: q.join(" ") });
      continue;
    }
    const p = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|!\[|\s*\||\d+\.\s|[-*]\s|>)/.test(lines[i])) p.push(lines[i++].trim());
    if (!p.length) p.push(lines[i++].trim());
    blocks.push({ t: "p", text: p.join(" ") });
  }
  return blocks;
}

// ---------- Blocks → HTML ----------
const TIPS_ICON = '<svg class="ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="3"/></svg>';
let figN = 0;

function imageData(src) {
  const file = join(SRC, src);
  if (!existsSync(file)) { console.warn(`  ! missing image ${src}`); return null; }
  const buf = readFileSync(file);
  // PNG IHDR: width/height at bytes 16–23. Used to cap each screenshot at its native size.
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const ext = src.split(".").pop().toLowerCase().replace("jpg", "jpeg");
  return { uri: `data:image/${ext};base64,${buf.toString("base64")}`, w, h };
}

function list(b, cls = "") {
  if (b.t === "ol") {
    return `<ol class="steps ${cls}">${b.items.map((it, k) =>
      `<li><span class="n">${k + 1}</span><div class="tx">${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>` : ""}</div></li>`).join("")}</ol>`;
  }
  return `<ul class="bul ${cls}">${b.items.map((it) =>
    `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`;
}

function renderSection(sec) {
  const blocks = parse(sec.md);
  const out = [];
  const toc = [];
  let lead = true;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const tipsLabel = b.t === "p" && /^\*\*(Tips?|Note)\*\*:?$/.test(b.text);
    if (tipsLabel && blocks[k + 1] && ["ul", "ol", "p"].includes(blocks[k + 1].t)) {
      const label = b.text.replace(/\*|:/g, "");
      const nb = blocks[++k];
      out.push(`<aside class="tips"><div class="tips-h">${TIPS_ICON}${label}</div>${nb.t === "p" ? `<p>${inline(nb.text)}</p>` : list(nb)}</aside>`);
      continue;
    }
    if (b.t === "h") {
      lead = false;
      const id = `${sec.id}-${slug(b.text)}`;
      if (b.level <= 3) toc.push({ id, text: smart(esc(b.text)) });
      out.push(`<h${b.level === 2 ? 3 : b.level} id="${id}" class="kwn">${inline(b.text, { chips: false })}</h${b.level === 2 ? 3 : b.level}>`);
    } else if (b.t === "p") {
      if (lead) { out.push(`<p class="lead">${inline(b.text)}</p>`); continue; }
      const q = b.text.match(/^\*\*(.+)\*\*$/);
      if (q) out.push(`<p class="q kwn"><span class="qm">Q</span><span>${inline(q[1], { chips: false })}</span></p>`);
      else out.push(`<p${/:$/.test(b.text) ? ' class="kwn"' : ""}>${inline(b.text)}</p>`);
    } else if (b.t === "ol" || b.t === "ul") {
      out.push(list(b));
    } else if (b.t === "fig") {
      const img = imageData(b.src);
      if (!img) continue;
      figN++;
      out.push(`<figure><div class="frame"><img src="${img.uri}" alt="${esc(b.alt)}" width="${img.w}" height="${img.h}" style="width:${Math.round(img.w * 0.75)}px"></div>` +
        `<figcaption><span class="fn">Figure ${figN}</span> — ${inline(b.alt, { chips: false })}</figcaption></figure>`);
    } else if (b.t === "table") {
      out.push(`<table><thead><tr>${b.head.map((c) => `<th>${inline(c, { chips: false })}</th>`).join("")}</tr></thead>` +
        `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if (b.t === "note") {
      out.push(`<aside class="tips"><div class="tips-h">${TIPS_ICON}Note</div><p>${inline(b.text)}</p></aside>`);
    }
    if (b.t !== "p") lead = false;
  }
  return { html: out.join("\n"), toc };
}

// ---------- Brand assets ----------
const asset = (f) => readFileSync(join(HERE, "assets", f), "utf8");
function logoSymbol() {
  // Vector logo extracted from the guide (page 9). The wordmark colour is a CSS variable so the same
  // symbol serves the standard (Todaytec Blue) and the reverse (white on Todaytec Blue) versions.
  const svg = asset("logo.svg");
  const vb = svg.match(/viewBox="([^"]+)"/)[1];
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "").replace(/fill="#062741"/g, 'fill="var(--wm, #062741)"');
  const e = asset("e-symbol.svg");
  const evb = e.match(/viewBox="([^"]+)"/)[1];
  const ebody = e.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "").replace(/fill="#0c938e"/g, 'fill="var(--es, #0c938e)"');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
    `<symbol id="logo" viewBox="${vb}">${body}</symbol><symbol id="esym" viewBox="${evb}">${ebody}</symbol></defs></svg>`;
}
const LOGO = (cls) => `<svg class="logo ${cls}" viewBox="0 0 551.4219 162.9893" role="img" aria-label="Todaytec"><use href="#logo"/></svg>`;

function fontFaces() {
  const fonts = JSON.parse(readFileSync(join(HERE, "fonts", "fonts.json"), "utf8"));
  return fonts.map((f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;` +
    `src:url(data:font/woff2;base64,${readFileSync(join(HERE, "fonts", f.file)).toString("base64")}) format('woff2');unicode-range:${f.unicodeRange};}`).join("\n");
}

// ---------- Styles ----------
const CSS = `
:root{--blue:#062741;--green:#0c938e;--white:#fff;--lgrey:#efefef;--dgrey:#7d7d7d;--black:#090909;
  --pw:210mm;--ph:297mm;--mx:18mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#d7d7d7;color:var(--black);
  font:400 9.6pt/1.55 Roboto,'Noto Sans Thai','Source Han Sans SC','Noto Sans SC','PingFang SC','Microsoft YaHei',Arial,Helvetica,sans-serif;
  font-kerning:normal;text-rendering:optimizeLegibility}
#src{width:calc(var(--pw) - 2*var(--mx))}
.page{position:relative;width:var(--pw);height:var(--ph);margin:10mm auto;background:#fff;overflow:hidden;
  box-shadow:0 1mm 4mm rgba(0,0,0,.18)}
@page{size:A4;margin:0}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;break-after:page}.page:last-child{break-after:auto}}
a{color:inherit;text-decoration:none}

/* running header / footer */
.hd{position:absolute;left:var(--mx);right:var(--mx);top:10mm;height:8mm;display:flex;align-items:flex-end;justify-content:space-between;
  border-bottom:.3mm solid var(--lgrey);padding-bottom:2.2mm}
.hd .sec{font-size:7pt;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--dgrey)}
.hd .sec b{color:var(--green);font-weight:700;margin-right:2mm}
.hd .logo{width:24mm;height:auto;display:block;margin-bottom:.4mm}
.ft{position:absolute;left:var(--mx);right:var(--mx);bottom:9mm;display:flex;align-items:center;justify-content:space-between;
  font-size:7pt;color:var(--dgrey);letter-spacing:.04em}
.ft .pn{display:flex;align-items:center;gap:2.2mm;color:var(--blue);font-weight:700;font-size:8pt}
.ft .pn:before{content:"";width:6mm;height:.6mm;background:var(--green)}
.body{position:absolute;left:var(--mx);right:var(--mx);top:25mm;bottom:19mm;overflow:hidden}
.body>:first-child{margin-top:0}

/* section opener band */
.band{position:absolute;left:0;right:0;top:0;height:62mm;background:var(--blue);color:#fff;overflow:hidden}
.band .logo{position:absolute;top:10mm;right:var(--mx);width:28mm;--wm:#fff}
.band .ring{position:absolute;left:var(--mx);top:19mm;width:30mm;height:30mm;border:.35mm solid var(--green);border-radius:50%;
  display:flex;flex-direction:column;align-items:center;justify-content:center}
.band .ring .no{font-size:24pt;font-weight:500;line-height:1}
.band .ring .lbl{font-size:6pt;letter-spacing:.2em;text-transform:uppercase;color:var(--green);margin-top:1.2mm}
.band h2{position:absolute;left:calc(var(--mx) + 38mm);right:var(--mx);top:27mm;margin:0;font-size:25pt;line-height:1.1;font-weight:700;letter-spacing:-.01em}
.band .kick{position:absolute;left:calc(var(--mx) + 38mm);top:21.5mm;font-size:7pt;letter-spacing:.2em;text-transform:uppercase;color:var(--green);font-weight:500}
.band .esym{position:absolute;right:46mm;bottom:-40mm;width:46mm;height:71mm;--es:rgba(12,147,142,.22)}
.band .line{position:absolute;left:0;bottom:0;width:100%;height:1.4mm;background:var(--green)}
.page.opener .body{top:72mm}

/* text */
p{margin:0 0 3mm}
.lead{font-size:11.5pt;line-height:1.5;color:var(--blue);font-weight:300;margin-bottom:6mm;max-width:160mm}
.lead .ui{font-size:10pt}
h3{font-size:13pt;line-height:1.25;color:var(--blue);font-weight:700;margin:7mm 0 3mm;padding-top:3mm;position:relative}
h3:before{content:"";position:absolute;left:0;top:0;width:8mm;height:.8mm;background:var(--green)}
h4{font-size:10.5pt;color:var(--blue);margin:5mm 0 2mm}
em{font-style:italic}
code{font-family:'Roboto Mono',Consolas,monospace;font-size:.92em;background:var(--lgrey);padding:0 1mm;border-radius:.8mm}

/* UI labels as keys */
.ui{font-weight:500;color:var(--blue);background:var(--lgrey);border-radius:1.1mm;padding:.15mm 1mm .25mm;
  box-shadow:inset 0 -.35mm 0 rgba(125,125,125,.45);font-size:.94em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ui.nw{white-space:nowrap}

/* numbered steps */
ol.steps{list-style:none;margin:0 0 4mm;padding:0;border:.3mm solid var(--lgrey);border-radius:1.6mm;overflow:hidden}
ol.steps>li{display:flex;gap:3.2mm;padding:2.2mm 3.2mm 2.2mm 2.6mm;border-top:.3mm solid var(--lgrey);align-items:flex-start}
ol.steps>li:first-child{border-top:0}
ol.steps .n{flex:0 0 5.4mm;height:5.4mm;border-radius:50%;background:var(--blue);color:#fff;font-weight:700;font-size:7.8pt;
  display:flex;align-items:center;justify-content:center;margin-top:-.1mm}
ol.steps .tx{flex:1;padding-top:.2mm}
ol.steps.cont{border-top-left-radius:0;border-top-right-radius:0}
ol.steps.cut{border-bottom-left-radius:0;border-bottom-right-radius:0;margin-bottom:0}

/* bullets */
ul.bul,.tips ul,ol.steps ul{list-style:none;margin:0 0 4mm;padding:0}
ul.bul>li,.tips li,ol.steps ul>li{position:relative;padding-left:5mm;margin:0 0 1.6mm}
ul.bul>li:before,.tips li:before,ol.steps ul>li:before{content:"";position:absolute;left:.6mm;top:1.75mm;width:1.6mm;height:1.6mm;border-radius:50%;background:var(--green)}
ol.steps ul{margin:1.5mm 0 0}

/* tips */
.tips{background:var(--lgrey);border-left:1.2mm solid var(--green);border-radius:0 1.6mm 1.6mm 0;padding:3.4mm 4.5mm 2mm 4.2mm;margin:2mm 0 5mm}
.tips-h{display:flex;align-items:center;gap:1.8mm;font-size:7.5pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--green);margin-bottom:2.2mm}
.tips .ring{width:3.6mm;height:3.6mm}
.tips .ui{background:#fff}
.tips ul{margin-bottom:0}.tips p{margin-bottom:1.6mm}

/* FAQ */
.q{display:flex;gap:2.6mm;align-items:baseline;font-weight:700;color:var(--blue);font-size:10.5pt;margin:5mm 0 2mm}
.q .qm{flex:0 0 5.4mm;height:5.4mm;border-radius:50%;border:.35mm solid var(--green);color:var(--green);font-size:7.5pt;
  display:inline-flex;align-items:center;justify-content:center;transform:translateY(-.2mm)}

/* figures */
figure{margin:2mm 0 5.5mm;break-inside:avoid}
figure .frame{background:var(--lgrey);border-radius:1.6mm;padding:2.6mm;display:flex;justify-content:center}
figure img{display:block;max-width:100%;height:auto;background:#fff;border:.25mm solid rgba(125,125,125,.25);border-radius:.6mm}
figcaption{font-size:7.6pt;color:var(--dgrey);margin-top:1.8mm;line-height:1.4}
figcaption .fn{color:var(--green);font-weight:700}

/* tables */
table{width:100%;border-collapse:collapse;margin:1mm 0 5mm;font-size:9pt}
th{background:var(--blue);color:#fff;font-weight:500;text-align:left;padding:2.2mm 3mm;font-size:8pt;letter-spacing:.04em}
td{padding:2.2mm 3mm;border-bottom:.3mm solid var(--lgrey);vertical-align:top}
tbody tr:nth-child(even) td{background:#f7f7f7}
td:first-child{white-space:nowrap;width:1%}

/* cover */
.cover,.back{background:var(--blue);color:#fff}
.cover .logo{position:absolute;top:12mm;right:12mm;width:40.4mm;--wm:#fff}
.cover .esym{position:absolute;left:-26mm;top:30mm;width:104mm;height:160mm}
.cover .halo{position:absolute;right:-62mm;top:52mm;width:150mm;height:150mm;border:.35mm solid var(--green);border-radius:50%;opacity:.8}
.cover .halo2{position:absolute;right:-34mm;top:80mm;width:94mm;height:94mm;border:.25mm solid rgba(255,255,255,.18);border-radius:50%}
.cover .tb{position:absolute;left:24mm;right:24mm;bottom:34mm}
.cover .eyebrow{font-size:8pt;letter-spacing:.24em;text-transform:uppercase;color:var(--green);font-weight:500;margin-bottom:5mm}
.cover h1{margin:0;font-size:34pt;line-height:1.08;font-weight:700;letter-spacing:-.015em}
.cover h1 span{display:block;font-weight:300;color:#fff}
.cover .sub{margin-top:6mm;font-size:13pt;font-weight:300;color:var(--lgrey)}
.cover .rule{width:22mm;height:1mm;background:var(--green);margin:9mm 0 5mm}
.cover .meta{font-size:8.5pt;color:rgba(255,255,255,.7);letter-spacing:.04em}
.cover .meta b{color:#fff;font-weight:500}
.cover .slogan,.back .slogan{position:absolute;left:24mm;bottom:16mm;font-size:7.5pt;font-weight:500;letter-spacing:.32em;color:#fff}
.cover .band-b{position:absolute;left:0;right:0;bottom:0;height:3mm;background:var(--green)}

/* contents */
.toc-title{font-size:26pt;font-weight:700;color:var(--blue);margin:2mm 0 1mm;letter-spacing:-.01em}
.toc-kick{font-size:7pt;letter-spacing:.2em;text-transform:uppercase;color:var(--green);font-weight:500}
.toc-sec{break-inside:avoid;padding:3.2mm 0 2.4mm;border-top:.3mm solid var(--lgrey)}
.toc-sec:first-of-type{border-top:0}
.toc-row{display:flex;align-items:baseline;gap:3mm}
.toc-row .no{flex:0 0 9mm;font-size:13pt;font-weight:300;color:var(--green)}
.toc-row .t{font-size:11pt;font-weight:700;color:var(--blue)}
.toc-row .dots{flex:1;border-bottom:.35mm dotted rgba(125,125,125,.6);transform:translateY(-1mm)}
.toc-row .pg{font-weight:700;color:var(--blue);min-width:7mm;text-align:right}
.toc-subs{columns:2;column-gap:8mm;margin:1.2mm 0 0 12mm;font-size:8.2pt;color:var(--dgrey)}
.toc-subs a{display:flex;gap:2mm;break-inside:avoid;padding:.35mm 0}
.toc-subs a .t{flex:1}
.toc-subs a .pg{color:var(--blue);font-weight:500}
.toc-head{margin-bottom:6mm}

/* back cover */
.back .esym{position:absolute;right:-40mm;top:-30mm;width:140mm;height:215mm;--es:rgba(12,147,142,.28)}
.back .lockup{position:absolute;left:24mm;bottom:62mm}
.back .lockup .logo{width:60mm;--wm:#fff;display:block}
.back .lockup .co{margin-top:6mm;font-size:10pt;font-weight:700;letter-spacing:.06em}
.back .lockup .web{margin-top:2mm;font-size:9pt;color:var(--lgrey);font-weight:300;letter-spacing:.04em}
.back .lockup .doc{margin-top:12mm;font-size:8pt;color:rgba(255,255,255,.6)}
.back .band-b{position:absolute;left:0;right:0;bottom:0;height:3mm;background:var(--green)}
`;

// ---------- Paginator (runs in Chromium) ----------
// Flows #src blocks into fixed A4 sheets. Rules: each section starts a new sheet with its opener band;
// headings, FAQ questions and "…:" lines stay with the next block; step / bullet lists split between
// items (never leaving a single item behind); figures, tables and tips stay whole.
const PAGINATE = String.raw`
(() => {
  const D = document, src = D.getElementById('src'), out = D.getElementById('pages');
  const meta = JSON.parse(D.getElementById('meta').textContent);
  let page, body, pageNo = 0;
  const el = (t, c, h) => { const e = D.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  function newPage(kind, sec) {
    pageNo++;
    page = el('section', 'page ' + (kind || ''));
    page.dataset.page = pageNo;
    if (kind === 'opener') page.appendChild(el('div', 'band', D.getElementById('tpl-band-' + sec.id).innerHTML));
    else page.appendChild(el('div', 'hd', '<span class="sec">' + (sec.no ? '<b>' + sec.no + '</b>' : '') + sec.title + '</span>' + meta.logo));
    body = el('div', 'body'); page.appendChild(body);
    page.appendChild(el('div', 'ft', '<span>' + meta.footer + '</span><span class="pn">' + pageNo + '</span>'));
    out.appendChild(page);
  }
  const fits = () => { const last = body.lastElementChild; return !last || last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 0.5; };
  const isList = (b) => b.matches('ol.steps, ul.bul');
  function carryKwn(sec) {
    const carry = [];
    while (body.children.length > 1 && body.lastElementChild.classList.contains('kwn')) carry.unshift(body.lastElementChild), body.lastElementChild.remove();
    newPage('', sec);
    carry.forEach((c) => body.appendChild(c));
  }
  function place(b, sec) {
    body.appendChild(b);
    if (fits()) return;
    b.remove();
    if (isList(b) && b.children.length >= 3) {
      const head = b.cloneNode(false); head.classList.add('cut'); body.appendChild(head);
      const items = [...b.children]; let n = 0;
      for (const li of items) { head.appendChild(li); if (!fits()) { li.remove(); break; } n++; }
      if (n >= 2 && items.length - n >= 1) {
        const rest = b.cloneNode(false); rest.classList.add('cont');
        items.slice(n).forEach((li) => rest.appendChild(li));
        newPage('', sec); place(rest, sec); return;
      }
      [...head.children].forEach((li) => b.appendChild(li)); head.remove();
      items.forEach((li) => b.appendChild(li));
    }
    carryKwn(sec);
    body.appendChild(b);
    if (!fits()) { // taller than a whole sheet: let the screenshot shrink to the space left
      const img = b.querySelector('img');
      if (img) { img.style.width = 'auto'; img.style.maxHeight = (body.getBoundingClientRect().bottom - img.getBoundingClientRect().top - 16) + 'px'; }
    }
  }
  // cover + contents
  for (const id of ['tpl-cover']) { pageNo++; const c = el('section', 'page cover', D.getElementById(id).innerHTML); c.dataset.page = pageNo; out.appendChild(c); }
  const contents = { id: 'contents', title: 'Contents', no: '' };
  newPage('', contents);
  for (const b of [...D.getElementById('toc').children]) place(b, contents);
  // sections
  for (const s of [...src.children]) {
    const sec = { id: s.id, title: s.dataset.title, no: s.dataset.no };
    newPage('opener', sec);
    s.removeAttribute('id'); page.id = sec.id;
    for (const b of [...s.children]) place(b, sec);
  }
  if (meta.back) { pageNo++; const c = el('section', 'page back', D.getElementById('tpl-back').innerHTML); c.dataset.page = pageNo; out.appendChild(c); }
  // contents page numbers
  for (const a of D.querySelectorAll('#pages [data-target]')) {
    const t = D.getElementById(a.dataset.target);
    const pg = t && t.closest('.page');
    a.querySelector('.pg').textContent = pg ? pg.dataset.page : '';
  }
  src.remove(); D.getElementById('toc').remove();
  D.querySelectorAll('template, #meta, #paginate').forEach((e) => e.remove());
  return pageNo;
})()`;

// ---------- Assemble ----------
function build() {
  const titles = sectionTitles();
  const files = readdirSync(SRC).filter((f) => /^\d{2}-.*\.md$/.test(f)).sort();
  const sections = files.map((f, k) => {
    const num = f.slice(0, 2);
    const id = `s${num}`;
    return { id, file: f, no: String(k + 1).padStart(2, "0"), title: smart(esc(titles[num] || titleFromFile(f))), md: readFileSync(join(SRC, f), "utf8") };
  });
  figN = 0;
  const rendered = sections.map((s) => ({ ...s, ...renderSection(s) }));

  const toc = rendered.map((s) =>
    `<div class="toc-sec"><a class="toc-row" href="#${s.id}" data-target="${s.id}"><span class="no">${s.no}</span><span class="t">${s.title}</span><span class="dots"></span><span class="pg"></span></a>` +
    (s.toc.length ? `<div class="toc-subs">${s.toc.map((h) => `<a href="#${h.id}" data-target="${h.id}"><span class="t">${h.text}</span><span class="pg"></span></a>`).join("")}</div>` : "") +
    `</div>`).join("");
  const tocHead = `<div class="toc-head"><div class="toc-kick">${esc(TITLE)}</div><div class="toc-title">Contents</div></div>`;

  const bands = rendered.map((s) => `<template id="tpl-band-${s.id}">${LOGO("")}` +
    `<div class="ring"><span class="no">${s.no}</span><span class="lbl">Section</span></div>` +
    `<div class="kick">Todaytec CRM · Sales</div><h2>${s.title}</h2>` +
    `<svg class="esym" viewBox="0 0 147.59 227.378" aria-hidden="true"><use href="#esym"/></svg><div class="line"></div></template>`).join("");

  const [t1, t2] = TITLE.split(" — ");
  const cover = `<template id="tpl-cover">${LOGO("")}<div class="halo"></div><div class="halo2"></div>` +
    `<svg class="esym" viewBox="0 0 147.59 227.378" aria-hidden="true"><use href="#esym"/></svg>` +
    `<div class="tb"><div class="eyebrow">User manual</div><h1>${esc(t1)} —<span>${esc(t2)}</span></h1>` +
    `<div class="sub">${esc(SUBTITLE)}</div><div class="rule"></div>` +
    `<div class="meta"><b>Version ${esc(VERSION)}</b> &nbsp;·&nbsp; ${esc(DATE)}</div></div>` +
    `<div class="slogan">BARCODING THE WORLD</div><div class="band-b"></div></template>`;

  // Back cover: the guide's logo + English full name lock-up (p. 20) and the website used on its
  // brochures and bag (pp. 65, 68). No other contact data.
  const back = `<template id="tpl-back"><svg class="esym" viewBox="0 0 147.59 227.378" aria-hidden="true"><use href="#esym"/></svg>` +
    `<div class="lockup">${LOGO("")}<div class="co">HANGZHOU TODAYTEC DIGITAL CO., LTD.</div><div class="web">www.todaytec.com</div>` +
    `<div class="doc">${esc(TITLE)} · Version ${esc(VERSION)} · ${esc(DATE)}</div></div>` +
    `<div class="slogan">BARCODING THE WORLD</div><div class="band-b"></div></template>`;

  const meta = { logo: LOGO(""), footer: `${esc(TITLE)}`, back: true };
  const src = rendered.map((s) => `<section id="${s.id}" data-title="${s.title}" data-no="${s.no}">${s.html}</section>`).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<style>${fontFaces()}\n${CSS}</style></head>
<body>${logoSymbol()}
<script type="application/json" id="meta">${JSON.stringify(meta)}</script>
${cover}${back}${bands}
<div id="toc">${tocHead}${toc}</div>
<div id="src">${src}</div>
<main id="pages"></main>
</body></html>`;
}

// ---------- Render ----------
const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;
const html = build();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // The paginator measures with print styles, so the sheets match what Chromium prints.
  const pages = await page.evaluate(PAGINATE);
  const finalHtml = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));
  writeFileSync(OUT_HTML, finalHtml);

  const view = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await view.goto("file://" + OUT_HTML, { waitUntil: "load" });
  await view.evaluate(() => document.fonts.ready);
  await view.pdf({ path: OUT_PDF, format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, outline: true, tagged: true });

  // Previews: cover, contents, first section opener with steps + a screenshot, first sheet with a tips callout.
  mkdirSync(PREVIEW, { recursive: true });
  const shot = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.4 });
  await shot.goto("file://" + OUT_HTML, { waitUntil: "load" });
  await shot.evaluate(() => document.fonts.ready);
  const pick = await shot.evaluate(() => {
    const ps = [...document.querySelectorAll(".page")];
    const idx = (f) => ps.findIndex(f);
    const section = idx((p) => p.classList.contains("opener") && p.querySelector("ol.steps") && p.querySelector("figure"));
    const tips = idx((p, i) => i !== section && p.querySelector(".tips") && p.querySelector("ol.steps") && p.querySelector("figure"));
    return { cover: 0, contents: 1, section, tips };
  });
  const names = { cover: "1-cover", contents: "2-contents", section: "3-section-steps-screenshot", tips: "4-tips-callout" };
  for (const f of readdirSync(PREVIEW)) if (f.endsWith(".png")) unlinkSync(join(PREVIEW, f));
  for (const [k, i] of Object.entries(pick)) {
    if (i < 0) continue;
    await shot.locator(".page").nth(i).screenshot({ path: join(PREVIEW, `${names[k]}.png`) });
  }
  console.log(`${pages} pages, ${figN} figures`);
  console.log(`${basename(OUT_HTML)}  ${kb(OUT_HTML)}`);
  console.log(`${basename(OUT_PDF)}  ${kb(OUT_PDF)}`);
  for (const f of readdirSync(PREVIEW)) console.log(`preview/${f}  ${kb(join(PREVIEW, f))}`);
} finally {
  await browser.close();
}
