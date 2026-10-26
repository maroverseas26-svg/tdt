// Todaytec CRM — Send quotation: turns a quotation into the customer-facing quote (the "QT"
// sheet layout of the sales team's Excel template), lets the salesperson adjust it, then
// downloads it and/or emails it to the salesperson as Excel and/or PDF.
const QX = window.CRM;

// ---- Per-country defaults (seller block, terms, core prices). Admins can save their own
// version of any country to settings/quote_templates; that copy wins over these, field by
// field. The seller block here is only a suggestion for the first entry (see qxCompanyOf). ----
const QX_DEFAULT_TEMPLATES = {
  Thailand: {
    company: ["Todaytec Thailand Co., Ltd.", "8/1 Soi Kheha Romklao 72 Yaek 3", "Ratpattana Sub-District, Saphansung District", "Bangkok 10240, TAX ID: 0135567019491"],
    currency: "THB",
    usdRate: 32.5,
    termsTitle: "Terms & Conditions / ข้อกำหนดและเงื่อนไข",
    terms: [
      "Price Term: Prices are based on delivery within Thailand by Todaytec Thailand Co., Ltd./เงื่อนไขราคา: ราคาเป็นแบบส่งมอบภายในประเทศไทยโดยบริษัท Todaytec Thailand จำกัด",
      "Delivery: Free delivery within Thailand applies for orders of 96 rolls and above/การจัดส่งสินค้า: บริการจัดส่งฟรีภายในประเทศไทยเมื่อสั่งซื้อตั้งแต่ 96 ม้วนขึ้นไป",
      "Payment Term: Subject to the terms and conditions outlined in the official sales contract./เงื่อนไขการชำระเงิน: เป็นไปตามข้อตกลงและเงื่อนไขที่ระบุไว้ใน สัญญาซื้อขาย",
      "Packaging: For product size 110mm x 300m, packed 24 rolls per box./การบรรจุ: สำหรับสินค้าขนาด 110 มม. x 300 ม. บรรจุ 24 ม้วนต่อกล่อง",
    ],
    coreTitle: ["Grade / ประเภทแกน", "Description (Size) / รายละเอียด (ขนาด)", "Unit Price (THB/core) / ราคาต่อหน่วย (บาท/แกน)"],
    core: [
      ["1/2 inch core / แกนขนาด 1/2 นิ้ว", "All sizes / ทุกขนาด", "1.5 THB"],
      ["1/2 inch core with extra 1/2 inch core / แกนขนาด 1/2 นิ้ว พร้อมแกนเสริม 1/2 นิ้ว", "All sizes / ทุกขนาด", "3.0 THB"],
      ["1 inch core with extra 1 inch core / แกนขนาด 1 นิ้ว พร้อมแกนเสริม 1 นิ้ว", "All sizes / ทุกขนาด", "2.0 THB"],
      ["Plastic 1 inch core / แกนพลาสติก 1 นิ้ว", "All sizes / ทุกขนาด", "4.32 THB"],
      ["Plastic 1 inch core with extra 1 inch core / แกนพลาสติก 1 นิ้ว พร้อมแกนเสริม 1 นิ้ว", "All sizes / ทุกขนาด", "6.5 THB"],
      ["Avery 1 inch core / แกน Avery 1 นิ้ว", "110mm / 110 มม.", "31.65 THB"],
      ["Monarch 1 inch core / แกน Monarch 1 นิ้ว", "110mm / 110 มม.", "35.97 THB"],
    ],
  },
  // Seller details for these markets have not been supplied yet: the first salesperson to
  // quote for the country enters them on the Send quotation screen.
  Vietnam: { company: ["", "", "", ""], currency: "VND", termsTitle: "Terms & Conditions / Điều khoản và điều kiện", terms: [], coreTitle: ["Grade / Loại lõi", "Description (Size) / Mô tả (Kích thước)", "Unit Price (VND/core) / Đơn giá (VND/lõi)"], core: [] },
  Indonesia: { company: ["", "", "", ""], currency: "IDR", termsTitle: "Terms & Conditions", terms: [], coreTitle: ["Grade", "Description (Size)", "Unit Price (IDR/core)"], core: [] },
};

// Ribbon type and sales note per base product code, from the template; editable per quote.
const QX_PRODUCTS = {
  TDW108: { type: "General Wax", note: "TDW108 has been trusted for over 10 years thanks to its excellent printing performance, wide compatibility, and printhead protection.\n🔹 Material compatibility: Uncoated paper, writing paper, kraft paper, coated paper, synthetic paper, film labels.\n🔹 Energy saving, reduced friction, extended printhead lifespan.\n🔹 Applications: Logistics, packaging, retail, clothing tags, nurseries.\n🔹 Durability: Abrasion resistant (30 cycles), scratch resistant (10 cycles), not chemical resistant.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free." },
  TDW133: { type: "Premium Wax", note: "TDW133 prints sharply, offers high scratch resistance, and effectively protects the print head with a special silicone coating.\n🔹 Material compatibility: Film labels (PP, PET, PE, BOPP, PVC), uncoated paper, synthetic paper.\n🔹 High durability: Abrasion resistant (100 cycles), scratch resistant (220 cycles).\n🔹 Applications: Logistics, packaging, retail, clothing tags, nurseries.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free." },
  TDM230: { type: "Premium Wax Resin", note: "TDM230\n🔹 Cost-effective, fairly good scratch resistance\n🔹 Compatible with uncoated paper, coated paper, synthetic paper, and film labels.\n🔹 Abrasion resistance:\nSmudge-proof: 270 cycles\nScratch-resistant: 300 cycles\n🔹 Chemical resistance: Not chemically resistant.\n🔹 Applications: Warehouse labels, logistics, pharmaceuticals, retail labels, clothing tags, manufacturing, luggage.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free." },
  TDM238: { type: "Premium Enhance Wax Resin", note: "TDM238 - Highly scratch-resistant, withstands harsh environments\n🔹 Nearly as scratch-resistant as resin, sharp print quality, long-lasting durability.\n🔹 Compatible with uncoated paper, coated paper, synthetic paper, and film labels.\n🔹 Abrasion resistance:\nSmudge-proof: 530 cycles\nScratch-proof: 650 cycles\n🔹 Applications: Warehouse labels, logistics, pharmaceuticals, refrigeration industry, electronic labels, production lines, steel production, fixed assets, luggage.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free,UL" },
  TDR330: { type: "General Resin", note: "TDR330 – Highly Scratch-Resistant and Heat-Resistant\n🔹 Highest durability, scratch resistance almost like resin, excellent heat resistance.\n🔹 Compatible with uncoated paper (L2), coated paper (L1), synthetic paper (L1), and film labels (L1).\n🔹 Abrasion resistance:\nSmudge-proof: 700 cycles\nScratch-resistant: 800 cycles\n🔹 Chemical resistance:\nAlcohol resistance (95%): 50 cycles\nGasoline resistance (92#): 5 cycles\n🔹 Applications: Pharmaceuticals, cosmetics, simple packaging, refrigeration industry, high-temperature applications, electronic labels, automotive industry, chemical industry, steel production, electrical & mechanical equipment, garment labels.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free, ISAGA, Non-MOAH - MOSH" },
  TDR345: { type: "Premium Enhance Resin", note: "TDR345 – High-performance resin ribbon with superior alcohol resistance\n🔹 Compatible with coated paper, synthetic paper, and film labels.\n🔹 Abrasion resistance:\nSmudge-proof: 1000 cycles\nScratch-resistant: 1000 cycles\n🔹 Chemical resistance:\nAlcohol resistance (95%): 350 cycles (highest among all)\nGasoline resistance (92#): 90 cycles\nBrake fluid resistance (BOSCH DOT4 PLUS): 80 cycles ✅ Heat resistance: \nImmersion in 100℃ hot water for 2 hours \nWithstands -17℃ for 20 hours \nWithstands temperatures up to 200℃\n🔹 Applications: Electronics, chemicals, product labels.\n🔹 Meets safety standards – ROHS, REACH, ISO, MSDS, Halogen-Free, ISAGA, UL, Non-MOAH - MOSH" },
};
const QX_GRADE_TYPE = { "Wax": "General Wax", "Wax Resin": "Wax Resin", "Resin": "Resin" };
const QX_CCY_NAME = { THB: "Baht", VND: "VND", USD: "USD", IDR: "IDR" };

// Export libraries load on first use only (pinned versions + SRI), so the app bundle stays small.
const QX_LIBS = {
  ExcelJS: { src: "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", integrity: "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz" },
  html2pdf: { src: "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js", integrity: "sha384-Yv5O+t3uE3hunW8uyrbpPW3iw6/5/Y7HitWJBLgqfMoA36NogMmy+8wWZMpn3HWc" },
};
const qxLoading = {};
function qxLib(name) {
  if (window[name]) return Promise.resolve(window[name]);
  if (!qxLoading[name]) {
    qxLoading[name] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = QX_LIBS[name].src; s.integrity = QX_LIBS[name].integrity; s.crossOrigin = "anonymous";
      s.onload = () => (window[name] ? resolve(window[name]) : reject(new Error(name + " failed to load")));
      s.onerror = () => { delete qxLoading[name]; reject(new Error(name + " failed to load")); };
      document.head.appendChild(s);
    });
  }
  return qxLoading[name];
}

const qxRate = (ccy) => ((QX.CURRENCIES || {})[ccy] || { rate: 1 }).rate;
const qxRound = (v, d) => { const m = Math.pow(10, d); return Math.round((+v || 0) * m) / m; };
const qxBase = (code) => String(code || "").split(/[.\s·|/×x]/)[0].toUpperCase();
const qxDays = (from, to) => { const a = Date.parse(from), b = Date.parse(to); return a && b && b > a ? Math.round((b - a) / 86400000) : 30; };
const qxFileSafe = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
const qxFmt = (v, d) => (+v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
// Seller block of a country: entered once (by whoever quotes there first), then fixed for every
// quotation. A country counts as set up only when settings/quote_templates holds its company
// name; the hardcoded defaults above never do. Returns the 4 saved lines, or null.
function qxCompanyOf(saved, market) {
  const c = saved && saved[market] && saved[market].company;
  return Array.isArray(c) && String(c[0] || "").trim() ? [0, 1, 2, 3].map(i => String(c[i] || "")) : null;
}
// Saved templates over the defaults, per country and per field, so a country whose saved copy
// holds only its company still gets the default terms and core table.
function qxMergeTemplates(saved) {
  const out = { ...saved };
  Object.keys(QX_DEFAULT_TEMPLATES).forEach(m => { out[m] = { ...QX_DEFAULT_TEMPLATES[m], ...(saved[m] || {}) }; });
  return out;
}
// settings/quote_templates is shared by every country and edited by several people, so each
// save reads the current copy first and changes only its own part. Unlike SB.get/upsert these
// fail loudly, so a failed read is never mistaken for "nothing saved yet".
async function qxReadTemplates() {
  const r = await fetch(QX.SB.url + "/settings?id=eq.quote_templates&select=data", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const v = j && j[0] ? j[0].data : null;
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
async function qxWriteTemplates(value) {
  const r = await fetch(QX.SB.url + "/settings", { method: "POST", headers: QX.SB.headers(), body: JSON.stringify({ id: "quote_templates", data: value, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

function qxBlobToBase64(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = reject; r.readAsDataURL(blob); });
}
function qxDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function qxLogoBlob() {
  const url = window.__resources && window.__resources.quoteLogo;
  const blob = url && window.__resourceBlobs && window.__resourceBlobs[url];
  return blob ? Promise.resolve(blob) : (url ? fetch(url).then(r => r.blob()) : Promise.resolve(null));
}

// Draft = everything the salesperson can adjust. Saved on the quotation (exportDraft) so the
// next export starts from the last one. The seller block is not part of it: it always comes
// from the country's saved company (an old draft's `company` is ignored).
function qxInitDraft(q, cust, user, templates, market) {
  const saved = q.exportDraft || {};
  const tpl = templates[market] || QX_DEFAULT_TEMPLATES[market] || QX_DEFAULT_TEMPLATES.Vietnam;
  const quoteCcy = saved.quoteCcy || tpl.currency || QX.ccyOfCountry(market) || "VND";
  const baseCcy = saved.baseCcy || q.currency || ((q.items || [])[0] || {}).currency || quoteCcy;
  const usdDefault = tpl.usdRate && quoteCcy === tpl.currency ? tpl.usdRate : qxRound(qxRate("USD") / qxRate(quoteCcy), 4);
  const lines = (q.items || []).map((it, i) => {
    const code = it.structureCode || it.productCode || it.sku || "";
    const base = qxBase(code);
    const prev = (saved.lines || [])[i] || {};
    const prod = QX_PRODUCTS[base] || {};
    return {
      code: prev.code != null ? prev.code : base || code,
      type: prev.type != null ? prev.type : prod.type || QX_GRADE_TYPE[it.grade] || it.grade || "",
      width: it.width || "", length: it.length || "", qty: prev.qty != null ? prev.qty : it.qty || "",
      basePrice: lineUnitPrice(it),
      price: prev.price != null ? prev.price : null, // per-sqm override in quote currency
      note: prev.note != null ? prev.note : prod.note || "",
    };
  });
  return {
    market,
    attend: saved.attend != null ? saved.attend : (cust && cust.pic) || "",
    custName: saved.custName != null ? saved.custName : (cust && cust.name) || "",
    taxId: saved.taxId != null ? saved.taxId : (cust && cust.bizId) || "",
    address: saved.address != null ? saved.address : (cust && (cust.address || [cust.district, cust.city].filter(Boolean).join(", "))) || "",
    quoteNo: q.id,
    date: new Date().toISOString().slice(0, 10),
    payment: saved.payment || q.paymentTerms || "",
    validity: saved.validity || qxDays(q.quoteDate, q.validUntil) + " Days",
    issuedBy: saved.issuedBy || (user && user.name) || "",
    baseCcy, quoteCcy,
    usdRate: saved.usdRate || usdDefault,
    baseRate: saved.baseRate || qxRound(qxRate(baseCcy) / qxRate(quoteCcy), 6),
    lines,
    includeCore: saved.includeCore != null ? saved.includeCore : tpl.core.length > 0,
    coreTitle: saved.coreTitle || tpl.coreTitle.slice(),
    core: saved.core || tpl.core.map(r => r.slice()),
    termsTitle: saved.termsTitle || tpl.termsTitle,
    terms: saved.terms || tpl.terms.slice(),
    format: saved.format || "both",
  };
}

// Priced rows: unit price per sqm in the quote currency (base price × rate unless the sales
// typed one), its USD equivalent, and the template's "Amount" = price per roll.
function qxPriced(d) {
  const conv = d.baseCcy === d.quoteCcy ? 1 : d.baseCcy === "USD" ? +d.usdRate || 0 : +d.baseRate || 0;
  return d.lines.map(l => {
    const unit = l.price != null && l.price !== "" ? +l.price || 0 : (+l.basePrice || 0) * conv;
    const usd = +d.usdRate ? unit / +d.usdRate : 0;
    const amount = unit * ((+l.width || 0) / 1000) * (+l.length || 0);
    return { ...l, unit, usd, amount };
  });
}
// Consecutive lines of one product share the No./Item/Type/Note cells, as in the template.
function qxGroups(rows) {
  const groups = [];
  rows.forEach((r, i) => {
    const last = groups[groups.length - 1];
    if (last && last.code === r.code && last.type === r.type) last.rows.push(i);
    else groups.push({ code: r.code, type: r.type, note: r.note, rows: [i] });
  });
  return groups;
}
const qxUnitDigits = (ccy) => (ccy === "VND" || ccy === "IDR" ? 0 : 2);
// html2pdf captures inside a box as wide as the PDF page (A4 landscape minus margins ≈ 1077 px
// at 96 dpi); a wider document is cut off on the right.
const QX_DOC_WIDTH = 1060;

/* ---------- the document (on-screen preview and PDF source) ---------- */
function QuoteDoc({ d, rows, logoUrl, docRef }) {
  const groups = qxGroups(rows);
  const ud = qxUnitDigits(d.quoteCcy);
  const cell = { border: "1px solid #222", padding: "6px 8px", verticalAlign: "middle" };
  const head = { ...cell, background: "#2A8C6D", color: "#fff", fontWeight: 700, textAlign: "center" };
  const lbl = { ...cell, fontWeight: 700, whiteSpace: "nowrap" };
  return (
    <div ref={docRef} className="qx-doc" style={{ width: QX_DOC_WIDTH, boxSizing: "border-box", background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, 'Leelawadee UI', Tahoma, sans-serif", fontSize: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        {logoUrl ? <img src={logoUrl} alt="Todaytec" style={{ height: 54 }} /> : <strong style={{ fontSize: 22 }}>Todaytec</strong>}
        <div style={{ textAlign: "right", lineHeight: 1.45 }}>
          {d.company.map((line, i) => <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{line || " "}</div>)}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>{[7.5, 9.5, 11, 8, 8, 10.5, 8.5, 10, 8.5, 33].map((w, i) => <col key={i} style={{ width: w + "%" }} />)}</colgroup>
        <tbody>
          <tr><td colSpan={10} style={{ ...cell, background: "#377F74", color: "#fff", fontSize: 24, fontWeight: 700, textAlign: "center", padding: "12px 8px" }}>Quotation and List of Products</td></tr>
          <tr><td style={lbl}>Attend:</td><td colSpan={4} style={cell}>{d.attend}</td><td colSpan={2} style={lbl}>Term of payment:</td><td colSpan={3} style={cell}>{d.payment}</td></tr>
          <tr><td style={lbl}>Company:</td><td colSpan={4} style={cell}>{d.custName}</td><td style={lbl}>Quotation No:</td><td colSpan={2} style={{ ...cell, textAlign: "center" }}>{d.quoteNo}</td><td style={lbl}>Date:</td><td style={cell}>{QX.fmtDate ? QX.fmtDate(d.date) : d.date}</td></tr>
          <tr><td style={lbl}>Tax ID</td><td colSpan={4} style={cell}>{d.taxId}</td><td colSpan={2} style={lbl}>Exchange rate ({QX_CCY_NAME[d.quoteCcy] || d.quoteCcy}/USD)</td><td colSpan={3} style={cell}>{qxFmt(d.usdRate, 3)}</td></tr>
          <tr><td style={lbl}>Address:</td><td colSpan={4} style={cell}>{d.address}</td><td colSpan={2} style={lbl}>Validity Effective:</td><td colSpan={3} style={cell}>{d.validity}</td></tr>
          <tr>
            <td style={head}>No.</td><td style={head}>Item</td><td style={head}>Type of Ribbon</td><td colSpan={2} style={head}>Specifications (Wmm X LM)</td>
            <td style={head}>Quantity (MOQ)</td><td style={head}>Unit Price (USD)</td><td style={head}>Unit Price ({d.quoteCcy}) In {d.market}</td><td style={head}>Amount ({d.quoteCcy})</td><td style={head}>Note</td>
          </tr>
          {groups.map((g, gi) => g.rows.map((ri, k) => {
            const r = rows[ri];
            return (
              <tr key={ri}>
                {k === 0 && <td rowSpan={g.rows.length} style={{ ...cell, textAlign: "center" }}>{gi + 1}</td>}
                {k === 0 && <td rowSpan={g.rows.length} style={{ ...cell, textAlign: "center", fontWeight: 700 }}>{g.code}</td>}
                {k === 0 && <td rowSpan={g.rows.length} style={{ ...cell, textAlign: "center" }}>{g.type}</td>}
                <td style={{ ...cell, textAlign: "center" }}>{r.width}</td><td style={{ ...cell, textAlign: "center" }}>{r.length}</td>
                <td style={{ ...cell, textAlign: "center" }}>{qxFmt(r.qty, 0)}</td>
                <td style={{ ...cell, textAlign: "center" }}>{qxFmt(r.usd, 3)}</td>
                <td style={{ ...cell, textAlign: "center" }}>{qxFmt(r.unit, ud)}</td>
                <td style={{ ...cell, textAlign: "center" }}>{qxFmt(r.amount, ud)}</td>
                {k === 0 && <td rowSpan={g.rows.length} style={{ ...cell, whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.35 }}>{g.note}</td>}
              </tr>
            );
          }))}
        </tbody>
      </table>
      {d.includeCore && d.core.length > 0 && (
        <table style={{ width: "62%", borderCollapse: "collapse", marginTop: 16 }}>
          <tbody>
            <tr>{d.coreTitle.map((h, i) => <td key={i} style={{ ...cell, fontWeight: 700, textAlign: "center" }}>{h}</td>)}</tr>
            {d.core.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ ...cell, textAlign: "center", fontWeight: j === 0 ? 700 : 400 }}>{v}</td>)}</tr>)}
          </tbody>
        </table>
      )}
      {d.terms.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 11 }}>
          <tbody>
            <tr><td colSpan={2} style={{ ...cell, fontWeight: 700 }}>{d.termsTitle}</td></tr>
            {d.terms.map((x, i) => <tr key={i}><td style={{ ...cell, width: 36, textAlign: "center" }}>{i + 1}</td><td style={cell}>{x}</td></tr>)}
          </tbody>
        </table>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <tbody><tr>
          <td style={{ width: "33%", height: 90, textAlign: "center", verticalAlign: "top", fontWeight: 700, borderTop: "1px solid #222" }}>Issued by<br />{d.issuedBy}</td>
          <td style={{ width: "34%", textAlign: "center", verticalAlign: "top", fontWeight: 700, borderTop: "1px solid #222" }}>Approved by</td>
          <td style={{ width: "33%", textAlign: "center", verticalAlign: "top", fontWeight: 700, borderTop: "1px solid #222" }}>Customer Approved:</td>
        </tr></tbody>
      </table>
    </div>
  );
}

/* ---------- Excel (same grid as the template's QT sheet) ---------- */
async function qxBuildXlsx(d, rows) {
  const ExcelJS = await qxLib("ExcelJS");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("QT", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.39, bottom: 0.39, header: 0.2, footer: 0.2 } } });
  [11.1, 13.9, 16.2, 14.6, 11.7, 15.6, 11.9, 13.8, 11.2, 79].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const font = (o) => ({ name: "Arial", size: 12, ...o });
  const thin = { style: "thin", color: { argb: "FF000000" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const put = (addr, value, style) => { const c = ws.getCell(addr); c.value = value; Object.assign(c, style || {}); return c; };
  const border = (range) => { const [a, b] = range.split(":"); const s = ws.getCell(a), e = ws.getCell(b || a);
    for (let r = s.row; r <= e.row; r++) for (let c = s.col; c <= e.col; c++) ws.getCell(r, c).border = box; };

  const logo = await qxLogoBlob();
  if (logo) ws.addImage(wb.addImage({ buffer: await logo.arrayBuffer(), extension: "png" }), { tl: { col: 0, row: 0 }, ext: { width: 304, height: 54 } });
  d.company.forEach((line, i) => put("J" + (i + 1), line, { font: font({ bold: i === 0 }), alignment: { horizontal: "right", vertical: "middle" } }));

  ws.mergeCells("A6:J6");
  put("A6", "Quotation and List of Products", { font: font({ size: 26, bold: true, color: { argb: "FFFFFFFF" } }), fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF377F74" } }, alignment: { horizontal: "center", vertical: "middle" } });
  ws.getRow(6).height = 57;
  const L = { font: font({ bold: true }), alignment: { vertical: "middle" } };
  const V = { font: font(), alignment: { horizontal: "left", vertical: "middle", wrapText: true } };
  [["B7:E7"], ["H7:J7"], ["B8:E8"], ["G8:H8"], ["B9:E9"], ["H9:J9"], ["B10:E10"], ["H10:J10"]].forEach(([r]) => ws.mergeCells(r));
  put("A7", "Attend: ", L); put("B7", d.attend, V); put("F7", "Term of payment:", L); put("H7", d.payment, V);
  put("A8", "Company: ", L); put("B8", d.custName, V); put("F8", "Quotation No:", L); put("G8", d.quoteNo, { ...V, alignment: { horizontal: "center", vertical: "middle" } });
  put("I8", "Date:", L); put("J8", new Date(d.date + "T00:00:00Z"), { ...V, numFmt: "dd/mm/yyyy" });
  put("A9", "Tax ID ", L); put("B9", d.taxId, V); put("F9", `Exchange rate (${QX_CCY_NAME[d.quoteCcy] || d.quoteCcy}/USD)`, L); put("H9", +d.usdRate || 0, { ...V, numFmt: "#,##0.000" });
  put("A10", "Address: ", L); put("B10", d.address, V); put("F10", "Validity Effective:", L); put("H10", d.validity, V);
  border("A6:J10");
  [7, 8, 9].forEach(r => { ws.getRow(r).height = 31; }); ws.getRow(10).height = 40;

  ws.mergeCells("D11:E11");
  const H = { font: font({ bold: true, color: { argb: "FFFFFFFF" } }), fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A8C6D" } }, alignment: { horizontal: "center", vertical: "middle", wrapText: true } };
  [["A11", "No."], ["B11", "Item"], ["C11", "Type of Ribbon "], ["D11", "Specifications (Wmm X LM)"], ["F11", "Quantity (MOQ)"], ["G11", "Unit Price (USD )"],
    ["H11", `Unit Price (${d.quoteCcy})\nIn ${d.market} `], ["I11", `Amount (${d.quoteCcy})`], ["J11", "Note "]].forEach(([a, v]) => put(a, v, H));
  ws.getRow(11).height = 58;
  border("A11:J11");

  const ud = qxUnitDigits(d.quoteCcy) ? "#,##0.00" : "#,##0";
  const C = { font: font(), alignment: { horizontal: "center", vertical: "middle", wrapText: true } };
  let r = 12;
  qxGroups(rows).forEach((g, gi) => {
    const first = r, last = r + g.rows.length - 1;
    g.rows.forEach((ri) => {
      const x = rows[ri];
      put("D" + r, +x.width || x.width, C); put("E" + r, +x.length || x.length, C);
      put("F" + r, +x.qty || 0, { ...C, numFmt: "#,##0" });
      put("G" + r, qxRound(x.usd, 6), { ...C, numFmt: "#,##0.000" });
      put("H" + r, qxRound(x.unit, 6), { ...C, numFmt: ud });
      put("I" + r, { formula: `H${r}*(D${r}/1000*E${r})`, result: qxRound(x.amount, 6) }, { ...C, numFmt: ud });
      ws.getRow(r).height = 49;
      r++;
    });
    if (last > first) ["A", "B", "C", "J"].forEach(col => ws.mergeCells(`${col}${first}:${col}${last}`));
    put("A" + first, gi + 1, C); put("B" + first, g.code, { ...C, font: font({ bold: true }) }); put("C" + first, g.type, C);
    put("J" + first, g.note, { font: font({ size: 11 }), alignment: { horizontal: "left", vertical: "middle", wrapText: true } });
    border(`A${first}:J${last}`);
  });

  if (d.includeCore && d.core.length) {
    r += 2;
    const coreRow = (vals, bold) => {
      ws.mergeCells(`A${r}:C${r}`); ws.mergeCells(`D${r}:E${r}`);
      put("A" + r, vals[0], { font: font({ bold: true }), alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
      put("D" + r, vals[1], { font: font({ bold }), alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
      put("F" + r, vals[2], { font: font({ bold }), alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
      border(`A${r}:F${r}`); ws.getRow(r).height = 50; r++;
    };
    coreRow(d.coreTitle, true);
    d.core.forEach(row => coreRow(row, false));
  }
  if (d.terms.length) {
    r += 1;
    ws.mergeCells(`A${r}:C${r}`); ws.mergeCells(`D${r}:J${r}`);
    put("A" + r, d.termsTitle, { font: font({ size: 10, bold: true }), alignment: { horizontal: "center", vertical: "middle" } });
    border(`A${r}:J${r}`); ws.getRow(r).height = 25; r++;
    d.terms.forEach((x, i) => {
      ws.mergeCells(`B${r}:J${r}`);
      put("A" + r, i + 1, { font: font({ size: 10 }), alignment: { horizontal: "center", vertical: "middle" } });
      put("B" + r, x, { font: font({ size: 10 }), alignment: { horizontal: "left", vertical: "middle", wrapText: true } });
      border(`A${r}:J${r}`); ws.getRow(r).height = 28; r++;
    });
  }
  r += 1;
  ws.mergeCells(`A${r}:B${r}`); ws.mergeCells(`D${r}:F${r}`); ws.mergeCells(`H${r}:J${r}`);
  const S = { font: font({ bold: true }), alignment: { horizontal: "center", vertical: "top", wrapText: true }, border: { top: thin } };
  put("A" + r, "Issued by\n" + d.issuedBy, S); put("D" + r, "Approved by", S); put("H" + r, "Customer Approved:", S);
  ws.getRow(r).height = 103;
  ws.pageSetup.printArea = `A1:J${r}`;
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ---------- PDF (rendered from the preview) ---------- */
// The preview is zoomed to fit its panel, which throws html2canvas' coordinates off, so the
// PDF is captured from an unzoomed copy pinned to the page's top-left corner.
async function qxBuildPdf(node) {
  const html2pdf = await qxLib("html2pdf");
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:0;top:0;width:${QX_DOC_WIDTH}px;z-index:-1;pointer-events:none`;
  holder.appendChild(node.cloneNode(true));
  document.body.appendChild(holder);
  try {
    return await html2pdf().set({
      margin: [6, 6, 6, 6],
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 },
      jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
      pagebreak: { mode: ["css", "legacy"], avoid: "tr" },
    }).from(holder.firstChild).outputPdf("blob");
  } finally {
    holder.remove();
  }
}

/* ---------- the page ---------- */
function QuoteSendPage({ q, cust, onClose }) {
  const { t, user, isBoss, updateQuotation } = useApp();
  const docRef = React.useRef(null);
  const previewRef = React.useRef(null);
  const [zoom, setZoom] = React.useState(1);
  React.useEffect(() => {
    const el = previewRef.current;
    if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 16) / QX_DOC_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [saved, setSaved] = React.useState(null); // settings/quote_templates as stored
  const [d, setD] = React.useState(null);
  const [companyInput, setCompanyInput] = React.useState(["", "", "", ""]);
  const [editingCompany, setEditingCompany] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [msg, setMsg] = React.useState(null);
  const logoUrl = window.__resources && window.__resources.quoteLogo;
  const markets = Object.keys(QX_DEFAULT_TEMPLATES);
  const marketOf = () => { const c = QX.normCountry((cust && cust.country) || ""); return markets.includes(c) ? c : ((user && user.countries || []).map(QX.normCountry).find(x => markets.includes(x)) || "Vietnam"); };

  React.useEffect(() => {
    let on = true;
    qxReadTemplates().catch(e => { setMsg({ ok: false, text: t("qx_company_load_failed") + " (" + (e && e.message) + ")" }); return {}; }).then(s => {
      if (!on) return;
      const market = (q.exportDraft && q.exportDraft.market) || marketOf();
      setSaved(s);
      setCompanyInput(qxCompanyOf(s, market) || QX_DEFAULT_TEMPLATES[market].company.slice());
      setD(qxInitDraft(q, cust, user, qxMergeTemplates(s), market));
    });
    return () => { on = false; };
  }, [q.id]);

  if (!d) return <div className="page"><p className="empty">…</p></div>;
  const templates = qxMergeTemplates(saved);
  const companySaved = qxCompanyOf(saved, d.market);
  const companyOpen = !companySaved || editingCompany; // inputs shown: first-time setup or admin edit
  // Preview, Excel and PDF always carry the saved seller block once there is one.
  const doc = { ...d, company: companySaved || companyInput };
  const rows = qxPriced(d);
  const set = (k, v) => setD(prev => ({ ...prev, [k]: v }));
  const setLine = (i, k, v) => setD(prev => ({ ...prev, lines: prev.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const setList = (k, i, v) => setD(prev => ({ ...prev, [k]: prev[k].map((x, j) => (j === i ? v : x)) }));
  const ccys = Object.keys(QX.CURRENCIES || { VND: 1, THB: 1, USD: 1 });
  const switchMarket = (m) => {
    const tpl = templates[m] || QX_DEFAULT_TEMPLATES[m];
    const quoteCcy = tpl.currency || d.quoteCcy;
    setCompanyInput(qxCompanyOf(saved, m) || QX_DEFAULT_TEMPLATES[m].company.slice());
    setEditingCompany(false);
    setD(prev => ({ ...prev, market: m, quoteCcy,
      usdRate: tpl.usdRate || qxRound(qxRate("USD") / qxRate(quoteCcy), 4), baseRate: qxRound(qxRate(prev.baseCcy) / qxRate(quoteCcy), 6),
      termsTitle: tpl.termsTitle, terms: tpl.terms.slice(), coreTitle: tpl.coreTitle.slice(), core: tpl.core.map(r => r.slice()), includeCore: tpl.core.length > 0 }));
  };
  const setCcy = (k, v) => setD(prev => {
    const next = { ...prev, [k]: v };
    next.usdRate = k === "quoteCcy" ? qxRound(qxRate("USD") / qxRate(next.quoteCcy), 4) : prev.usdRate;
    next.baseRate = qxRound(qxRate(next.baseCcy) / qxRate(next.quoteCcy), 6);
    return next;
  });
  const fileBase = `Quotation_${qxFileSafe(d.quoteNo)}_${qxFileSafe(cust && (cust.shortName || cust.name))}`;

  const build = async () => {
    const files = [];
    if (d.format !== "pdf") files.push({ filename: fileBase + ".xlsx", blob: await qxBuildXlsx(doc, rows) });
    if (d.format !== "xlsx") files.push({ filename: fileBase + ".pdf", blob: await qxBuildPdf(docRef.current) });
    // Remember the adjustments on the quotation so the next export starts from them (the
    // seller block is not one of them, and replacing exportDraft drops an old draft's copy).
    const { quoteNo, date, company, ...draft } = d;
    updateQuotation(q.id, { exportDraft: draft });
    return files;
  };
  const run = async (kind) => {
    if (!companySaved) return;
    setBusy(kind); setMsg(null);
    try {
      const files = await build();
      if (kind === "download") { files.forEach(f => qxDownload(f.blob, f.filename)); setMsg({ ok: true, text: t("qx_downloaded") }); }
      else {
        const payload = { quoteNo: d.quoteNo, customer: d.custName, files: await Promise.all(files.map(async f => ({ filename: f.filename, content: await qxBlobToBase64(f.blob) }))) };
        const r = await fetch("/api/quotes/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
        setMsg({ ok: true, text: t("qx_sent").replace("{email}", j.to) });
      }
    } catch (e) {
      setMsg({ ok: false, text: t("qx_failed") + " (" + (e && e.message) + ")" });
    }
    setBusy("");
  };
  // First-time setup (anyone) or admin edit of the seller block: only [market].company changes.
  // If someone else set the country up in the meantime, a non-admin gets theirs, locked.
  const saveCompany = async () => {
    const m = d.market, lines = companyInput.map(s => String(s || "").trim());
    if (!lines[0]) { setMsg({ ok: false, text: t("qx_company_name_required") }); return; }
    setBusy("company"); setMsg(null);
    try {
      const fresh = await qxReadTemplates();
      if (qxCompanyOf(fresh, m) && !isBoss) {
        setSaved(fresh); setEditingCompany(false);
        setMsg({ ok: false, text: t("qx_company_taken").replace("{c}", m) });
      } else {
        const next = { ...fresh, [m]: { ...(fresh[m] || {}), company: lines } };
        await qxWriteTemplates(next);
        setSaved(next); setEditingCompany(false);
        setMsg({ ok: true, text: t("qx_company_saved").replace("{c}", m) });
      }
    } catch (e) {
      setMsg({ ok: false, text: t("qx_company_save_failed") + " (" + (e && e.message) + ")" });
    }
    setBusy("");
  };
  const startEditCompany = () => { setCompanyInput(companySaved.slice()); setEditingCompany(true); };
  const cancelEditCompany = () => { setCompanyInput(companySaved.slice()); setEditingCompany(false); };
  // Admin: currency, terms and core table become the country default (the company is saved
  // on its own, above). Merged into the current copy so other countries are kept.
  const saveDefault = async () => {
    const m = d.market;
    setBusy("default"); setMsg(null);
    try {
      const fresh = await qxReadTemplates();
      const next = { ...fresh, [m]: { ...(fresh[m] || {}), currency: d.quoteCcy, usdRate: +d.usdRate || undefined, termsTitle: d.termsTitle, terms: d.terms, coreTitle: d.coreTitle, core: d.core } };
      await qxWriteTemplates(next);
      setSaved(next);
      setMsg({ ok: true, text: t("qx_default_saved").replace("{c}", m) });
    } catch (e) {
      setMsg({ ok: false, text: t("qx_failed") + " (" + (e && e.message) + ")" });
    }
    setBusy("");
  };
  const companyLabels = ["qx_company_name", "qx_company_addr1", "qx_company_addr2", "qx_company_city_tax"];

  return (
    <div className="page qx-page">
      <button className="back-btn" onClick={onClose}><Icon d={ICONS.back} size={16} /> {t("qx_back")}</button>
      <header className="page-header">
        <div><h1>{t("qx_title")} · {q.id}</h1><p>{cust ? cust.name : ""}</p></div>
        <div className="page-actions qx-actions">
          <select className="select" value={d.format} onChange={e => set("format", e.target.value)} aria-label={t("qx_format")}>
            <option value="both">Excel + PDF</option><option value="xlsx">Excel</option><option value="pdf">PDF</option>
          </select>
          <button className="btn btn-ghost" disabled={!!busy || !companySaved} title={companySaved ? undefined : t("qx_company_required").replace("{c}", d.market)} onClick={() => run("download")}><Icon d={ICONS.download || ICONS.upload} size={15} /> {busy === "download" ? "…" : t("qx_download")}</button>
          <button className="btn btn-primary" disabled={!!busy || !companySaved || !(user && user.email)} title={companySaved ? undefined : t("qx_company_required").replace("{c}", d.market)} onClick={() => run("email")}>{busy === "email" ? "…" : t("qx_email_me").replace("{email}", (user && user.email) || "")}</button>
        </div>
      </header>
      {msg && <p className={msg.ok ? "login-sent" : "login-err"} style={{ marginBottom: 12 }}>{msg.text}</p>}
      {!companySaved && <p className="login-err" style={{ marginBottom: 12 }}>{t("qx_company_required").replace("{c}", d.market)}</p>}

      <div className="qx-grid">
        <section className="card qx-form">
          <h2>{t("qx_seller")}</h2>
          <div className="form-grid">
            <Field label={t("country")}>
              <select className="select" value={d.market} onChange={e => switchMarket(e.target.value)}>{markets.map(m => <option key={m} value={m}>{m}</option>)}</select>
            </Field>
          </div>
          <div className="qx-company" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, margin: "8px 0 16px" }}>
            <strong>{t(!companySaved ? "qx_company_setup" : editingCompany ? "qx_company_editing" : "qx_company_fixed").replace("{c}", d.market)}</strong>
            <p style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--muted)" }}>{t(!companySaved ? "qx_company_setup_hint" : "qx_company_fixed_hint").replace("{c}", d.market)}</p>
            <div className="form-grid">
              {(companyOpen ? companyInput : companySaved).map((line, i) => (
                <Field key={i} label={t(companyLabels[i])} required={companyOpen && i === 0}>
                  <input className="input" value={line} readOnly={!companyOpen} disabled={!companyOpen}
                    onChange={e => { const v = e.target.value; setCompanyInput(prev => prev.map((x, j) => (j === i ? v : x))); }} />
                </Field>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              {companyOpen && <button className="btn btn-primary" disabled={!!busy} onClick={saveCompany}>{busy === "company" ? "…" : t("qx_company_save")}</button>}
              {editingCompany && <button className="btn btn-ghost" disabled={!!busy} onClick={cancelEditCompany}>{t("cancel")}</button>}
              {companySaved && !editingCompany && isBoss && <button className="btn btn-ghost" onClick={startEditCompany}>{t("qx_company_edit")}</button>}
            </div>
          </div>

          <h2>{t("qx_customer")}</h2>
          <div className="form-grid">
            <Field label="Attend"><input className="input" value={d.attend} onChange={e => set("attend", e.target.value)} /></Field>
            <Field label="Company"><input className="input" value={d.custName} onChange={e => set("custName", e.target.value)} /></Field>
            <Field label="Tax ID"><input className="input" value={d.taxId} onChange={e => set("taxId", e.target.value)} /></Field>
            <Field label="Address"><input className="input" value={d.address} onChange={e => set("address", e.target.value)} /></Field>
            <Field label="Term of payment"><input className="input" value={d.payment} onChange={e => set("payment", e.target.value)} /></Field>
            <Field label="Validity Effective"><input className="input" value={d.validity} onChange={e => set("validity", e.target.value)} /></Field>
            <Field label="Issued by"><input className="input" value={d.issuedBy} onChange={e => set("issuedBy", e.target.value)} /></Field>
          </div>

          <h2>{t("qx_currency")}</h2>
          <div className="form-grid">
            <Field label={t("qx_base_ccy")}>
              <select className="select" value={d.baseCcy} onChange={e => setCcy("baseCcy", e.target.value)}>{ccys.map(c => <option key={c}>{c}</option>)}</select>
            </Field>
            <Field label={t("qx_quote_ccy")}>
              <select className="select" value={d.quoteCcy} onChange={e => setCcy("quoteCcy", e.target.value)}>{ccys.map(c => <option key={c}>{c}</option>)}</select>
            </Field>
            <Field label={`1 USD = ? ${d.quoteCcy}`}>
              <input className="input" type="number" step="any" value={d.usdRate} onChange={e => set("usdRate", e.target.value)} />
            </Field>
            {d.baseCcy !== d.quoteCcy && d.baseCcy !== "USD" && (
              <Field label={`1 ${d.baseCcy} = ? ${d.quoteCcy}`}>
                <input className="input" type="number" step="any" value={d.baseRate} onChange={e => set("baseRate", e.target.value)} />
              </Field>
            )}
          </div>

          <h2>{t("qx_lines")}</h2>
          <div className="table-wrap">
            <table className="table table-plain qx-lines">
              <thead><tr><th>Item</th><th>Type</th><th className="num">W×L</th><th className="num">MOQ</th><th className="num">{t("qx_unit_price")} ({d.quoteCcy}/m²)</th><th className="num">USD</th></tr></thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <React.Fragment key={i}>
                    <tr>
                      <td><input className="input" value={l.code} onChange={e => setLine(i, "code", e.target.value)} style={{ minWidth: 90 }} /></td>
                      <td><input className="input" value={l.type} onChange={e => setLine(i, "type", e.target.value)} style={{ minWidth: 130 }} /></td>
                      <td className="num">{l.width}×{l.length}</td>
                      <td className="num"><input className="input" type="number" value={l.qty} onChange={e => setLine(i, "qty", e.target.value)} style={{ width: 90 }} /></td>
                      <td className="num"><input className="input" type="number" step="any" placeholder={qxFmt(rows[i].unit, 4)} value={l.price == null ? "" : l.price} onChange={e => setLine(i, "price", e.target.value === "" ? null : e.target.value)} style={{ width: 110 }} /></td>
                      <td className="num">{qxFmt(rows[i].usd, 3)}</td>
                    </tr>
                    <tr><td colSpan={6}><textarea className="input" rows="3" placeholder={t("qx_note")} value={l.note} onChange={e => setLine(i, "note", e.target.value)} /></td></tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{t("qx_terms")}</h2>
          <Field label={t("qx_terms_title")}><input className="input" value={d.termsTitle} onChange={e => set("termsTitle", e.target.value)} /></Field>
          {d.terms.map((x, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <textarea className="input" rows="2" value={x} onChange={e => setList("terms", i, e.target.value)} />
              <button className="icon-btn" aria-label="remove" onClick={() => set("terms", d.terms.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => set("terms", [...d.terms, ""])}>+ {t("qx_add_term")}</button>

          <h2 style={{ marginTop: 16 }}>
            <label className="login-remember" style={{ margin: 0 }}><input type="checkbox" checked={d.includeCore} onChange={e => set("includeCore", e.target.checked)} /> {t("qx_core")}</label>
          </h2>
          {d.includeCore && d.core.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 6, marginBottom: 6 }}>
              {row.map((v, j) => <input key={j} className="input" value={v} onChange={e => set("core", d.core.map((rr, k) => (k === i ? rr.map((x, m) => (m === j ? e.target.value : x)) : rr)))} />)}
              <button className="icon-btn" aria-label="remove" onClick={() => set("core", d.core.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          {d.includeCore && <button className="btn btn-ghost btn-sm" onClick={() => set("core", [...d.core, ["", "", ""]])}>+ {t("qx_add_core")}</button>}

          {isBoss && (
            <div className="modal-actions">
              <button className="btn btn-ghost" disabled={!!busy} onClick={saveDefault}>{t("qx_save_default").replace("{c}", d.market)}</button>
            </div>
          )}
        </section>

        <section className="card qx-preview">
          <h2>{t("qx_preview")}</h2>
          <div className="qx-preview-scroll" ref={previewRef}><div style={{ zoom, padding: 8 }}><QuoteDoc d={doc} rows={rows} logoUrl={logoUrl} docRef={docRef} /></div></div>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { QuoteSendPage });
