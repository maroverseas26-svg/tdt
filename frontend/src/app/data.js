// Todaytec CRM — static seed data, mappings, store helpers
(function () {
  // Customer Status → Pipeline stage (from CRM mapping sheet)
  const STATUS_TO_FUNNEL = {
    "Wrong number / Out of service": "Check",
    "Approach on Linkedin/Call/Line": "Attempted Contact",
    "Customer blocked Line": "Attempted Contact",
    "Customer blocked calls": "Attempted Contact",
    "Hung up abruptly": "Attempted Contact",
    "No response from customer": "Attempted Contact",
    "Send company profile via Line/Email": "Cold Lead",
    "Customer asked to call back later": "Cold Lead",
    "Currently buying ribbon from another supplier": "Warm Lead",
    "Customer requested a meeting": "Warm Lead",
    "Quotation / Quote": "Warm Lead",
    "Send samples": "Warm Lead",
    "Move to Quote - Project": "Hot Lead",
    "Current Customer": "Hot Lead",
    "No demand": "Check",
    "Company Status: Liquidation Completion": "Check",
  };
  const STAGES = ["New", "Check", "Attempted Contact", "Cold Lead", "Warm Lead", "Hot Lead"];
  const STAGE_KEY = { "New": "stage_New", "Check": "stage_Check", "Attempted Contact": "stage_AttemptedContact", "Cold Lead": "stage_ColdLead", "Warm Lead": "stage_WarmLead", "Hot Lead": "stage_HotLead" };
  const STAGE_COLORS = {
    "New": "#94A3B8", "Check": "#64748B", "Attempted Contact": "#8B5CF6",
    "Cold Lead": "#0EA5E9", "Warm Lead": "#F59E0B", "Hot Lead": "#E11D48",
  };
  // default status when a card is dragged INTO a stage
  const STAGE_DEFAULT_STATUS = {
    "New": "", "Check": "Wrong number / Out of service",
    "Attempted Contact": "No response from customer",
    "Cold Lead": "Send company profile via Line/Email",
    "Warm Lead": "Quotation / Quote", "Hot Lead": "Current Customer",
  };
  const ALL_STATUSES = Object.keys(STATUS_TO_FUNNEL);

  const MODULES = ["overview", "customers", "pipelines", "projects", "samples", "quotations", "polist", "products", "target", "forecast", "retention", "admin"];

  // Sample testing status
  const SAMPLE_STATUSES = ["Đang test", "Đạt", "Không đạt", "Chưa phản hồi"];
  const SAMPLE_STATUS_COLORS = {
    "Đang test": "#0EA5E9", "Đạt": "#16A34A", "Không đạt": "#E11D48", "Chưa phản hồi": "#94A3B8",
  };

  // Quotation status
  const QUOTE_STATUSES = ["Draft", "Sent", "Negotiating", "Won", "Lost"];
  const QUOTE_STATUS_COLORS = {
    Draft: "#94A3B8", Sent: "#0EA5E9", Negotiating: "#F59E0B", Won: "#16A34A", Lost: "#E11D48",
  };

  // Order type for PO
  const ORDER_TYPES = ["New", "Repeat"];

  // Decision criteria for projects
  const DECISION_CRITERIA = ["Price", "Quality", "Lead time", "Credit terms"];

  // Reorder engine status
  const REORDER_STATUSES = ["Chưa đến hạn", "Sắp đến hạn", "Quá hạn chưa đặt"];
  const REORDER_STATUS_COLORS = {
    "Chưa đến hạn": "#94A3B8", "Sắp đến hạn": "#F59E0B", "Quá hạn chưa đặt": "#E11D48",
  };
  const REORDER_SOON_DAYS = 14; // window before predicted date considered "soon"
  const SALES_ACTIONS = ["Đã gọi nhắc - Khách hẹn tuần sau", "Đang chờ phản hồi", "Đã chốt được PO mới"];

  // Lead reminder: days without contactHistory before flagging as "forgotten"
  const LEAD_STALE_DAYS = 14;

  // Customer group classification (A–G)
  const GROUPS = [
    { id: "A", label: "A - Big & Regular", color: "#16A34A" },
    { id: "B", label: "B - Potential to develop", color: "#0EA5E9" },
    { id: "C", label: "C – Small but active", color: "#8B5CF6" },
    { id: "D", label: "D – Repeat Order", color: "#F59E0B" },
    { id: "E", label: "E – New", color: "#13988D" },
    { id: "F", label: "F – Inactive", color: "#94A3B8" },
    { id: "G", label: "G – Blacklist", color: "#1F2937" },
    { id: "DE", label: "DE", color: "#DB2777" },
  ];
  // Canonical customer-group normaliser. Accepts a bare id ("A","DE"), a full label
  // ("A - Big & Regular", "DE"), or dirty text and returns the matching
  // GROUPS id, or "" if unrecognised. Multi-letter ids (DE) are tested BEFORE single
  // letters so "DE" is never truncated to "D". Use EVERYWHERE a group value is read for
  // display / filtering / KPI bucketing so a labelled or two-letter group never drops out.
  function normGroup(g) {
    const s = String(g == null ? "" : g).trim();
    if (!s) return "";
    const up = s.toUpperCase();
    const ids = GROUPS.map(x => x.id).sort((a, b) => b.length - a.length);
    for (const id of ids) {
      const U = id.toUpperCase();
      if (up === U) return id;
      if (up.length > U.length && up.slice(0, U.length) === U && !/[A-Z0-9]/.test(up.charAt(U.length))) return id;
    }
    return "";
  }
  const USD_RATE = 26350;
  // VND per 1 unit of currency
  const CURRENCIES = { VND: { rate: 1, symbol: "₫" }, THB: { rate: 730, symbol: "฿" }, USD: { rate: 26350, symbol: "$" }, IDR: { rate: 1.62, symbol: "Rp" } };
  // Sales exports name the currency per ROW, often in Chinese ("越南盾" = VND, "美元" = USD).
  // A file can mix them, so the import converts row by row instead of trusting one dropdown.
  function currencyOf(raw, fallback) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return fallback || "";
    if (/越南盾|vnd|vnđ|đồng|dong/i.test(s)) return "VND";
    if (/美元|usd|dollar|\$/i.test(s)) return "USD";
    if (/泰铢|泰銖|thb|baht|฿/i.test(s)) return "THB";
    if (/印尼盾|idr|rupiah|^rp\.?$/i.test(s)) return "IDR";
    const up = s.toUpperCase();
    return CURRENCIES[up] ? up : (fallback || "");
  }
  // Markets the company operates in — used as the default country list when no
  // customer data exists yet (e.g. before the first import).
  const MARKETS = ["Vietnam", "Thailand", "Indonesia"];
  // One market = one price list. A product code exists ONCE PER MARKET with its own unit
  // price and its own currency (TDM240 Vietnam = VND, TDM240 Thailand = THB), so country is
  // part of a product's identity, never a filter bolted on afterwards.
  const COUNTRY_CCY = { Vietnam: "VND", Thailand: "THB", Indonesia: "IDR" };
  function ccyOfCountry(c) { return COUNTRY_CCY[normCountry(c)] || "VND"; }
  // KPI country ticked for an account in Permissions. "-" is the explicit "no country"
  // sentinel written when the chip is UNTICKED, so an account can be removed from the
  // Targets grid and every PIC filter. A blank/undefined value still falls back to the
  // account's permission scope (legacy records that never touched the chip).
  const KPI_NONE = "-";
  // ---- PO price model (ONE source of truth) --------------------------------
  //   unit price = price per m²
  //   roll price = unit price × area per roll        (area = sqmPerRoll, else W/1000 × L)
  //   value      = roll price × qty
  // Whichever two of {unitPrice, rollPrice, value} are known, the third is derived.
  // Creating a PO supplies the unit price (from the Products tab) and computes down;
  // an import supplies value + qty only, so it solves backwards for both prices.
  function poPricing({ unitPrice, rollPrice, amount, qty, areaRoll }) {
    const n = (v) => { const x = parseFloat(String(v == null ? "" : v).toString().replace(/[^\d.-]/g, "")); return isNaN(x) ? 0 : x; };
    const q = n(qty), a = n(areaRoll);
    let up = n(unitPrice), rp = n(rollPrice), amt = n(amount);
    if (!rp && up && a) rp = up * a;
    if (!amt && rp && q) amt = rp * q;
    if (!rp && amt && q) rp = amt / q;              // import: value + qty → roll price
    if (!up && rp && a) up = rp / a;                // … then roll price ÷ area → unit price
    if (!amt && rp && q) amt = rp * q;
    return { unitPrice: up, rollPrice: rp, amount: Math.round(amt), areaRoll: a };
  }
  // Area of one roll in m² — an explicit sqm/roll wins, else width(mm)/1000 × length(m).
  function rollArea(it) {
    const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
    const s = n(it && it.sqmPerRoll);
    return s > 0 ? s : (n(it && it.width) / 1000) * n(it && it.length);
  }
  // A product's identity is ALWAYS a product / structure code (e.g. "TDM240.110×300").
  // Grade ("Resin", "Wax Resin") and product TYPE ("FR", "JR") are ATTRIBUTES — never the
  // product name. Storing them as the name made one physical order line import several
  // times under different "products" (the duplicate lines in the PO detail).
  var NON_CODE_RE = /^(fr|jr|nr|others?|wax|resin|wax\s*resin|near\s*edge|flat\s*head|n\/?a|none|-|—|_)$/i;
  function cleanCode(v) { var s = String(v == null ? "" : v).trim(); return (!s || NON_CODE_RE.test(s)) ? "" : s; }
  // Base code of a structure code: "TDM240.110×300" → "TDM240", "TDM230.910" → "TDM230".
  function baseCode(v) { var s = cleanCode(v); return s ? s.split(/[.\s·|/]/)[0].trim() : ""; }
  function kpiCountryOf(u) {
    if (!u) return "";
    const tc = u.targetCountry;
    if (tc === KPI_NONE) return "";
    if (tc) return normCountry(tc);
    const first = (u.countries || []).filter(x => x && x !== "*")[0];
    return first ? normCountry(first) : "";
  }
  // Canonical country normaliser — maps dirty variants ("VN","TH","việt nam"…) onto the
  // market name. Use EVERYWHERE a country list/filter/permission is built so "VN" and
  // "Vietnam" never split into two. Values outside the markets pass through unchanged.
  // Business ID (tax code) shape per market.
  //   Vietnam — company / organisation: 10 digits. Dependent unit (branch): 13 digits
  //     written with a hyphen, 10 + "-" + 3. Individual: the 12-digit personal ID.
  //   Thailand — 13 digits.
  // Excel drops leading zeros, so a Vietnamese code that comes back short is padded to the
  // length it is registered under. Markets with no rule are stored as plain digits.
  const BIZ_ID_RULES = { Vietnam: [10, 12, 13], Thailand: [13] };
  function bizIdLens(country) { return BIZ_ID_RULES[normCountry(country)] || null; }
  function formatBizId(raw, country) {
    const d = String(raw == null ? "" : raw).replace(/\D+/g, "");
    if (!d) return "";
    const lens = bizIdLens(country);
    if (!lens) return d;
    const target = lens.find(L => d.length <= L);
    const out = target ? d.padStart(target, "0") : d;
    // A 13-digit Vietnamese code is a branch code and is always written 10-3.
    if (normCountry(country) === "Vietnam" && out.length === 13) return out.slice(0, 10) + "-" + out.slice(10);
    return out;
  }
  // "" when the code is acceptable (or the market has no rule), else the expected lengths.
  function bizIdIssue(raw, country) {
    const d = String(raw == null ? "" : raw).replace(/\D+/g, "");
    if (!d) return "";
    const lens = bizIdLens(country);
    if (!lens) return "";
    return lens.includes(d.length) ? "" : lens.join(" / ");
  }
  function normCountry(c) {
    const s = String(c || "").trim();
    if (/^(vn|viet\s*nam|vietnam|việt\s*nam)$/i.test(s)) return "Vietnam";
    if (/^(th|thai|thailand|ไทย)$/i.test(s)) return "Thailand";
    if (/^(id|idn|indonesia)$/i.test(s)) return "Indonesia";
    return s;
  }

  // roles: scope 'all' = see everything (BOD); 'country' = all data within assigned
  // countries (managers); 'own' = only own sales code. Titles map to the Sales Team allocation.
  const SEED_ROLES = [
    { id: "BOD", name: "Admin", scope: "all", fixed: true },
    { id: "SMGR", name: "Sales Manager", scope: "country" },
    { id: "OPMGR", name: "Operation Manager", scope: "country" },
    { id: "SRSALE", name: "Senior Sales", scope: "own" },
    { id: "SALEEXEC", name: "Sales Executive", scope: "own" },
    { id: "TELE", name: "Telesales", scope: "own" },
    { id: "SUPPORT", name: "Sales Support", scope: "own" },
    { id: "SADMIN", name: "Sales Admin", scope: "own" },
    { id: "SALE", name: "Sales", scope: "own", fixed: true },
  ];

  const _M_TEAM = ["overview", "customers", "pipelines", "projects", "samples", "quotations", "polist", "products", "target", "forecast", "retention"];
  const _M_ALL = [..._M_TEAM, "admin"];
  function _u(id, name, email, role, code, country, modules, loginCard) {
    return { id, name, email, role, salesCode: code, countries: [country], modules, active: true, avatar: (name[0] || "?").toUpperCase(), loginCard: !!loginCard };
  }
  const SEED_USERS = [
    _u("u-hoang", "Mr. Hoang", "hoang@todaytec.vn", "BOD", "", "*", _M_ALL, true),
    _u("u-thao", "Thao", "thaohh28@gmail.com", "BOD", "", "*", _M_ALL, true),
    // ---- Thailand team ----
    _u("u-noom", "Noom", "phumiphat@todaytec.co.th", "SMGR", "NOOM", "Thailand", _M_TEAM, true),
    _u("u-kook", "Kook", "Kook@todaytec.co.th", "SUPPORT", "KOOK", "Thailand", _M_TEAM, false),
    _u("u-noon", "Noon", "Piyarat@todaytec.co.th", "SADMIN", "NOON", "Thailand", _M_TEAM, false),
    _u("u-ice", "Ice", "Kamonwan@todaytec.co.th", "SALEEXEC", "ICE", "Thailand", _M_TEAM, false),
    _u("u-min", "Min", "Nisarat@todaytec.co.th", "SALEEXEC", "MIN", "Thailand", _M_TEAM, false),
    // ---- Vietnam team ----
    _u("u-tu", "Tu", "tu.qc@todaytec.com.vn", "SMGR", "TU", "Vietnam", _M_TEAM, true),
    _u("u-khuong", "Khuong", "khuong.hl@todaytec.com.vn", "SRSALE", "KHUONG", "Vietnam", _M_TEAM, false),
    _u("u-tien", "Tien", "tien.nh@todaytec.com.vn", "SRSALE", "TIEN", "Vietnam", _M_TEAM, false),
    _u("u-ly", "Ly", "Ly.dta@todaytec.com.vn", "TELE", "LY", "Vietnam", _M_TEAM, false),
    _u("u-hien", "Hien", "CSKH@todaytec.com.vn", "SUPPORT", "HIEN", "Vietnam", _M_TEAM, false),
    _u("u-hang", "Hang", "Hang.lv@todaytec.com.vn", "OPMGR", "HANG", "Vietnam", _M_ALL, true),
    _u("u-hoa", "Hoa", "hoa.pnk@todaytec.com.vn", "SADMIN", "HOA", "Vietnam", _M_TEAM, false),
  ];

  function findCust(name) {
    const c = window.CRM_CUSTOMERS.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
    return c ? c.id : null;
  }

  const SEED_PROJECTS = [
    {
      id: "P-2609", name: "An Phat — quarterly wax/resin", customerId: findCust("An Phat Barcode"),
      classification: "Resupply", product: "TTR Wax/Resin 110mm", ink: "Wax/Resin", productName: "TT-WR300",
      width: 110, length: 300, qtyRolls: 800, qtySqm: 26400, pricePerSqm: 5300, value: 139920000,
      closeMonth: "2026-07", sampleSent: true, quoteSent: true, poReceived: true,
      potential: "High", stage: "PO", result: "", endCustomer: "", industry: "Barcode dealer",
      application: "Label printing", supplier: "", competitor: "", failReason: "",
      createdBy: "LINH", following: "LINH", note: "Q3 PO confirmed, recurring quarterly.", createdAt: "2026-05-30",
      probability: 80, expectedCloseDate: "2026-07-15", lossCompetitorPrice: 0, decisionCriteria: "Price", linkedSampleId: "",
    },
    {
      id: "P-2610", name: "Viet Thai — premium wax trial", customerId: findCust("Viet Thai Thermal"),
      classification: "New project", product: "TTR Premium Wax 110mm", ink: "Premium Wax", productName: "TT-PW200",
      width: 110, length: 450, qtyRolls: 400, qtySqm: 19800, pricePerSqm: 4400, value: 87120000,
      closeMonth: "2026-08", sampleSent: true, quoteSent: false, poReceived: false,
      potential: "Medium", stage: "Sample", result: "", endCustomer: "", industry: "Ribbon dealer",
      application: "Carton labeling", supplier: "Armor", competitor: "AR-01", failReason: "",
      createdBy: "TUAN", following: "TUAN", note: "Testing against current Armor premium wax.", createdAt: "2026-06-04",
      probability: 20, expectedCloseDate: "2026-08-10", lossCompetitorPrice: 4600, decisionCriteria: "Quality", linkedSampleId: "SMP-0001",
    },
    {
      id: "P-2601", name: "Softtrade — Wax/Resin annual supply", customerId: findCust("SOFTTRADE COMPANY"),
      classification: "Resupply", product: "TTR Wax/Resin 110mm", ink: "Wax/Resin", productName: "TT-WR300",
      width: 110, length: 300, qtyRolls: 2500, qtySqm: 82500, pricePerSqm: 5200, value: 429000000,
      closeMonth: "2026-08", sampleSent: true, quoteSent: true, poReceived: false,
      potential: "High", stage: "Quotation", result: "", endCustomer: "", industry: "Barcode solutions",
      application: "Label printing", supplier: "Armor", competitor: "AR-01", failReason: "",
      createdBy: "KOOK", following: "KOOK", note: "Forecast 2,000–3,000 finished rolls; every ribbon type.", createdAt: "2026-04-12",
      probability: 50, expectedCloseDate: "2026-08-20", lossCompetitorPrice: 5400, decisionCriteria: "Price", linkedSampleId: "",
    },
    {
      id: "P-2602", name: "Markpak — Resin project vs Ricoh", customerId: findCust("MARKPAK LIMITED"),
      classification: "New project", product: "TTR Resin 90mm", ink: "Resin", productName: "TT-R500",
      width: 90, length: 300, qtyRolls: 1000, qtySqm: 27000, pricePerSqm: 8900, value: 240300000,
      closeMonth: "2026-09", sampleSent: true, quoteSent: false, poReceived: false,
      potential: "Medium", stage: "Sample", result: "", endCustomer: "Pospak group", industry: "Packaging",
      application: "PET sticker", supplier: "Ricoh / Armor", competitor: "RC-02", failReason: "",
      createdBy: "KOOK", following: "KOOK", note: "Will switch only if resin is cheaper than Ricoh & Armor.", createdAt: "2026-05-02",
      probability: 20, expectedCloseDate: "2026-09-05", lossCompetitorPrice: 9100, decisionCriteria: "Quality", linkedSampleId: "SMP-0002",
    },
    {
      id: "P-2603", name: "Qisheng — Premium wax quotation", customerId: findCust("Qisheng Electronics"),
      classification: "New project", product: "TTR Premium Wax 110mm", ink: "Premium Wax", productName: "TT-PW200",
      width: 110, length: 450, qtyRolls: 800, qtySqm: 39600, pricePerSqm: 4300, value: 170280000,
      closeMonth: "2026-07", sampleSent: false, quoteSent: true, poReceived: false,
      potential: "High", stage: "Quotation", result: "", endCustomer: "", industry: "Electronics",
      application: "Carton labeling", supplier: "", competitor: "", failReason: "",
      createdBy: "JENNY", following: "JENNY", note: "", createdAt: "2026-05-18",
      probability: 50, expectedCloseDate: "2026-07-08", lossCompetitorPrice: 0, decisionCriteria: "Price", linkedSampleId: "",
    },
    {
      id: "P-2604", name: "MDCC — switch from DNP", customerId: findCust("M D C C"),
      classification: "Conversion", product: "TTR Wax 110mm jumbo", ink: "Wax", productName: "TT-W100",
      width: 110, length: 9000, qtyRolls: 60, qtySqm: 59400, pricePerSqm: 3100, value: 184140000,
      closeMonth: "2026-06", sampleSent: true, quoteSent: true, poReceived: true,
      potential: "High", stage: "PO", result: "", endCustomer: "", industry: "Label converting",
      application: "Jumbo slitting", supplier: "DNP China / Yamato", competitor: "DNP-01", failReason: "",
      createdBy: "KOOK", following: "KOOK", note: "First PO confirmed, recurring monthly potential.", createdAt: "2026-03-22",
      probability: 80, expectedCloseDate: "2026-06-25", lossCompetitorPrice: 3300, decisionCriteria: "Lead time", linkedSampleId: "",
    },
    {
      id: "P-2605", name: "KS 1689 — quote follow-up", customerId: findCust("K.S. 1689"),
      classification: "New project", product: "TTR Wax/Resin 80mm", ink: "Wax/Resin", productName: "TT-WR300",
      width: 80, length: 300, qtyRolls: 500, qtySqm: 12000, pricePerSqm: 5400, value: 64800000,
      closeMonth: "2026-07", sampleSent: false, quoteSent: true, poReceived: false,
      potential: "Medium", stage: "Quotation", result: "", endCustomer: "", industry: "Barcode reseller",
      application: "Label printing", supplier: "", competitor: "", failReason: "",
      createdBy: "ICE", following: "ICE", note: "", createdAt: "2026-05-20",
      probability: 50, expectedCloseDate: "2026-07-12", lossCompetitorPrice: 0, decisionCriteria: "Price", linkedSampleId: "",
    },
    {
      id: "P-2606", name: "OGA — sample evaluation", customerId: findCust("OGA International"),
      classification: "New project", product: "TTR Resin 60mm", ink: "Resin", productName: "TT-R500",
      width: 60, length: 300, qtyRolls: 300, qtySqm: 5400, pricePerSqm: 9200, value: 49680000,
      closeMonth: "2026-08", sampleSent: true, quoteSent: false, poReceived: false,
      potential: "Medium", stage: "Sample", result: "", endCustomer: "", industry: "Solutions",
      application: "Tag label", supplier: "", competitor: "", failReason: "",
      createdBy: "NOOM", following: "NOOM", note: "Printing requirement from their customer.", createdAt: "2026-05-25",
      probability: 20, expectedCloseDate: "2026-08-01", lossCompetitorPrice: 0, decisionCriteria: "Quality", linkedSampleId: "SMP-0003",
    },
    {
      id: "P-2607", name: "ST Ribbon — jumbo restock", customerId: findCust("ST RIBBON CO., LTD (Head office)"),
      classification: "Resupply", product: "TTR Wax jumbo 110mm", ink: "Wax", productName: "TT-W100",
      width: 110, length: 12000, qtyRolls: 40, qtySqm: 52800, pricePerSqm: 2950, value: 155760000,
      closeMonth: "2026-06", sampleSent: false, quoteSent: true, poReceived: true,
      potential: "High", stage: "Won", result: "Won", endCustomer: "", industry: "Ribbon slitting",
      application: "Jumbo slitting", supplier: "", competitor: "", failReason: "",
      createdBy: "NOOM", following: "NOOM", note: "Repeat order, Q2.", createdAt: "2026-02-10",
      probability: 100, expectedCloseDate: "2026-06-15", lossCompetitorPrice: 0, decisionCriteria: "Credit terms", linkedSampleId: "",
    },
    {
      id: "P-2608", name: "The Perfect Label — resin trial", customerId: findCust("THA PERFECT LABEL"),
      classification: "New project", product: "TTR Resin 110mm", ink: "Resin", productName: "TT-R500",
      width: 110, length: 300, qtyRolls: 200, qtySqm: 6600, pricePerSqm: 8800, value: 58080000,
      closeMonth: "2026-05", sampleSent: true, quoteSent: false, poReceived: false,
      potential: "Low", stage: "Lost", result: "Lost", endCustomer: "", industry: "Label solutions",
      application: "Label printing", supplier: "Ricoh / Armor", competitor: "RC-02", failReason: "Sample failed customer test",
      createdBy: "ICE", following: "ICE", note: "Sent the sample for testing, it failed the test.", createdAt: "2026-04-05",
      probability: 0, expectedCloseDate: "2026-05-15", lossCompetitorPrice: 9000, decisionCriteria: "Quality", linkedSampleId: "SMP-0004",
    },
  ].filter(p => p.customerId);

  const PROJECT_STAGES = ["Proposal", "Sample", "Quotation", "PO", "Won", "Lost"];
  const PROJECT_STAGE_COLORS = { Proposal: "#94A3B8", Sample: "#8B5CF6", Quotation: "#F59E0B", PO: "#0EA5E9", Won: "#16A34A", Lost: "#E11D48" };
  const INK_TYPES = ["Wax", "Premium Wax", "Wax/Resin", "Resin"];

  // ---- MODULE A seed: Samples ----
  const SEED_SAMPLES = [
    {
      id: "SMP-0001", customerId: findCust("Viet Thai Thermal"), projectId: "P-2610",
      productCode: "TT-PW200", ink: "Premium Wax", width: 110, length: 450, qtySent: 2,
      sentDate: "2026-06-05", courier: "GHTK", trackingNo: "GHTK7745210",
      testStatus: "Đang test", feedbackDate: "", feedbackNote: "",
      comparedAgainst: "Armor AR-01", followUpDate: "2026-06-19",
      createdBy: "TUAN",
    },
    {
      id: "SMP-0002", customerId: findCust("MARKPAK LIMITED"), projectId: "P-2602",
      productCode: "TT-R500", ink: "Resin", width: 90, length: 300, qtySent: 3,
      sentDate: "2026-05-10", courier: "Kerry Express", trackingNo: "KE9920331",
      testStatus: "Đang test", feedbackDate: "", feedbackNote: "",
      comparedAgainst: "Ricoh B110A", followUpDate: "2026-06-16",
      createdBy: "KOOK",
    },
    {
      id: "SMP-0003", customerId: findCust("OGA International"), projectId: "P-2606",
      productCode: "TT-R500", ink: "Resin", width: 60, length: 300, qtySent: 2,
      sentDate: "2026-05-28", courier: "Flash Express", trackingNo: "FE1183420",
      testStatus: "Đạt", feedbackDate: "2026-06-08",
      feedbackNote: "Chất lượng nét in tốt, khách yêu cầu báo giá.",
      comparedAgainst: "", followUpDate: "2026-06-08",
      createdBy: "NOOM",
    },
    {
      id: "SMP-0004", customerId: findCust("THA PERFECT LABEL"), projectId: "P-2608",
      productCode: "TT-R500", ink: "Resin", width: 110, length: 300, qtySent: 2,
      sentDate: "2026-04-08", courier: "Flash Express", trackingNo: "FE1029981",
      testStatus: "Không đạt", feedbackDate: "2026-04-20",
      feedbackNote: "Mực bị xước khi in trên decal bóng, không đạt yêu cầu.",
      comparedAgainst: "Ricoh B110A", followUpDate: "2026-04-20",
      createdBy: "ICE",
    },
  ].filter(s => s.customerId);

  // ---- MODULE B seed: Quotations ----
  const SEED_QUOTATIONS = [
    {
      id: "QT-2026-001", customerId: findCust("SOFTTRADE COMPANY"), projectId: "P-2601",
      quoteDate: "2026-05-05", validUntil: "2026-06-05",
      items: [{ productCode: "TT-WR300", width: 110, length: 300, qty: 2500, unitPrice: 5200, currency: "VND" }],
      paymentTerms: "T/T 30 days", revisionNo: 1, status: "Negotiating", approvedBy: "",
      createdBy: "KOOK",
    },
    {
      id: "QT-2026-002", customerId: findCust("Qisheng Electronics"), projectId: "P-2603",
      quoteDate: "2026-05-20", validUntil: "2026-06-20",
      items: [{ productCode: "TT-PW200", width: 110, length: 450, qty: 800, unitPrice: 4300, currency: "VND" }],
      paymentTerms: "T/T 30 days", revisionNo: 1, status: "Sent", approvedBy: "",
      createdBy: "JENNY",
    },
    {
      id: "QT-2026-003", customerId: findCust("K.S. 1689"), projectId: "P-2605",
      quoteDate: "2026-05-22", validUntil: "2026-06-22",
      items: [{ productCode: "TT-WR300", width: 80, length: 300, qty: 500, unitPrice: 5400, currency: "VND" }],
      paymentTerms: "COD", revisionNo: 2, status: "Sent", approvedBy: "Mr. Hoang",
      createdBy: "ICE",
    },
    {
      id: "QT-2026-004", customerId: findCust("M D C C"), projectId: "P-2604",
      quoteDate: "2026-03-25", validUntil: "2026-04-25",
      items: [{ productCode: "TT-W100", width: 110, length: 9000, qty: 60, unitPrice: 3100, currency: "VND" }],
      paymentTerms: "T/T 30 days", revisionNo: 1, status: "Won", approvedBy: "",
      createdBy: "KOOK",
    },
  ].filter(q => q.customerId);

  // ---- MODULE D: Reorder Engine ----
  // Compute avg cycle / predicted reorder date per customer+product pair from PO history.
  function computeReorderEngine(pos, todayStr) {
    const today = todayStr ? new Date(todayStr) : new Date();
    const groups = {};
    pos.forEach(p => {
      if (!p.customerId) return;
      const key = p.customerId + "::" + (p.commercial || p.materialName || "");
      (groups[key] = groups[key] || []).push(p);
    });
    const out = [];
    Object.entries(groups).forEach(([key, list]) => {
      if (list.length < 2) return; // need at least 2 orders to compute a cycle
      const sorted = list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const d1 = parseDate(sorted[i - 1].date), d2 = parseDate(sorted[i].date);
        if (!d1 || !d2) continue;
        const days = Math.round((d2 - d1) / 86400000);
        if (days > 0) gaps.push(days);
      }
      if (!gaps.length) return;
      const avgCycle = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
      const avgQty = Math.round(sorted.reduce((s, p) => s + (p.qty || 0), 0) / sorted.length);
      const last = sorted[sorted.length - 1];
      const lastDate = parseDate(last.date);
      if (!lastDate) return;
      const predicted = new Date(lastDate.getTime() + avgCycle * 86400000);
      const daysUntil = Math.round((predicted - today) / 86400000);
      let status;
      if (daysUntil > REORDER_SOON_DAYS) status = "Chưa đến hạn";
      else if (daysUntil >= 0) status = "Sắp đến hạn";
      else status = "Quá hạn chưa đặt";
      const [customerId, productCode] = [last.customerId, last.commercial || last.materialName || ""];
      out.push({
        key, customerId, productCode,
        avgOrderCycleDays: avgCycle, avgQtyPerOrder: avgQty,
        lastOrderDate: last.date, predictedReorderDate: predicted.toISOString().slice(0, 10),
        daysUntil, reorderStatus: status, pic: last.pic, group: last.group,
        unit: last.unit, width: last.width, length: last.length,
      });
    });
    return out;
  }

  // ---- MODULE: Customer Retention Dashboard ----
  // Per-customer reorder health: days since last PO, avg order frequency, % of monthly target.
  // "% of monthly target" allocates each PIC's monthly VND target to their customers in proportion
  // to each customer's trailing historical share of that PIC's revenue, then compares the
  // customer's current-month actual PO amount against that allocated share.
  // parentMap (customerId → Name Code) is optional; when supplied, retention
  // rolls up by Name Code (parent) instead of by individual company.
  function computeRetentionEngine(pos, targets, todayStr, parentMap) {
    const today = todayStr ? new Date(todayStr) : new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const curYear = String(today.getFullYear());
    const curMonthIdx = today.getMonth(); // 0-based
    const keyFor = (p) => (parentMap && parentMap[p.customerId]) ? nameCodeKey(parentMap[p.customerId]) : p.customerId;

    const byCustomer = {};
    pos.forEach(p => {
      if (!p.customerId) return;
      (byCustomer[keyFor(p)] = byCustomer[keyFor(p)] || []).push(p);
    });

    // total historical revenue per PIC (for allocating target share)
    const picTotal = {};
    pos.forEach(p => { if (p.pic) picTotal[p.pic] = (picTotal[p.pic] || 0) + (p.amountVnd || 0); });

    const out = [];
    Object.entries(byCustomer).forEach(([groupKey, list]) => {
      // representative company = member with the most revenue (drives the row's
      // customerId / profile link); track all members for lookups & rollups.
      const revByCust = {};
      list.forEach(p => { revByCust[p.customerId] = (revByCust[p.customerId] || 0) + (p.amountVnd || 0); });
      const memberCustomerIds = Object.keys(revByCust);
      const customerId = memberCustomerIds.sort((a, b) => revByCust[b] - revByCust[a])[0];
      const nameCode = parentMap ? (parentMap[customerId] || customerId) : customerId;
      const invSet = distinctInvoices(list);
      const invoiceCount = invSet.size;
      const sorted = list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const last = sorted[sorted.length - 1];
      const lastDate = parseDate(last.date) || today;
      const daysSinceLastPO = Math.max(0, Math.round((today - lastDate) / 86400000));

      // average order frequency (days between consecutive orders)
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const d1 = parseDate(sorted[i - 1].date), d2 = parseDate(sorted[i].date);
        if (!d1 || !d2) continue;
        const days = Math.round((d2 - d1) / 86400000);
        if (days > 0) gaps.push(days);
      }
      const avgFrequencyDays = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;

      // this customer's revenue (all-time) and PIC
      const pic = last.pic || "";
      const custTotal = list.reduce((s, p) => s + (p.amountVnd || 0), 0);
      const share = (pic && picTotal[pic]) ? custTotal / picTotal[pic] : 0;
      const picMonthlyTarget = (targets[curYear] && targets[curYear][pic]) ? (targets[curYear][pic][curMonthIdx] || 0) : 0;
      const allocatedTarget = Math.round(picMonthlyTarget * share);

      const thisMonthActual = list
        .filter(p => p.year === today.getFullYear() && p.month === curMonthIdx + 1)
        .reduce((s, p) => s + (p.amountVnd || 0), 0);

      const pctOfTarget = allocatedTarget > 0 ? (thisMonthActual / allocatedTarget) * 100 : (thisMonthActual > 0 ? 100 : null);

      // 12-month actual (this year) + allocated target arrays, for annual/YTD/MTD tracking
      const actualArr = Array(12).fill(0);
      list.forEach(p => { if (String(p.year) === curYear) { const mi = (p.month || 0) - 1; if (mi >= 0 && mi < 12) actualArr[mi] += p.amountVnd || 0; } });
      const picTargetArr = (targets[curYear] && targets[curYear][pic]) ? targets[curYear][pic] : [];
      const targetArr = Array.from({ length: 12 }, (_, mi) => Math.round((picTargetArr[mi] || 0) * share));

      // product codes (mã hàng) bought + cross-sell detection
      const prodKeys = sorted.map(p => p.commercial || p.materialName || "").filter(Boolean);
      const distinctProducts = new Set(prodKeys).size;
      const priorKeys = new Set(prodKeys.slice(0, -1));
      const lastKey = prodKeys[prodKeys.length - 1] || "";
      const newProductCode = sorted.length > 1 && lastKey && !priorKeys.has(lastKey);
      const isNewCustomer = sorted.length === 1;

      // health classification
      let health;
      const overdue = avgFrequencyDays !== null && daysSinceLastPO > avgFrequencyDays * 1.5;
      const veryOverdue = avgFrequencyDays !== null && daysSinceLastPO > avgFrequencyDays * 2.5;
      const lowTarget = pctOfTarget !== null && pctOfTarget < 70;
      const veryLowTarget = pctOfTarget !== null && pctOfTarget < 40;
      if (veryOverdue || veryLowTarget) health = "red";
      else if (overdue || lowTarget) health = "yellow";
      else health = "green";

      out.push({
        customerId, nameCode, memberCustomerIds, companyCount: memberCustomerIds.length,
        pic, group: last.group,
        daysSinceLastPO, avgFrequencyDays,
        pctOfTarget, allocatedTarget, thisMonthActual,
        distinctProducts, newProductCode, isNewCustomer,
        totalPoAmount: custTotal, productList: [...new Set(prodKeys)],
        invoiceCount, invoiceList: [...invSet],
        targetArr, actualArr,
        firstOrderDate: sorted[0] ? sorted[0].date : "",
        lastOrderDate: last.date, orderCount: sorted.length, health,
      });
    });
    return out.sort((a, b) => b.daysSinceLastPO - a.daysSinceLastPO);
  }

  // Retention health from SERVER per-customer stats (po_customer_stats) + current-year
  // monthly aggregate (po_agg). Same formulas/output as computeRetentionEngine, but each
  // customer's heavy per-PO work (gaps, distinct, min/max) was done server-side — so this
  // scales to millions of POs (row count = #customers). Rolls up members by parent (Name
  // Code) like the RAM engine. Exact for single-company parents; multi-company parents sum
  // counts/totals and po_count-weight the avg-gap (a small, documented approximation).
  // statsRows: [{customer_id,po_count,inv_count,first_date,last_date,total_amt,avg_gap_days,distinct_products,last_pic,last_product}]
  // monthRows: po_agg rows for the current year (for the 12-month actual arrays).
  function computeRetentionFromStats(statsRows, monthRows, targets, parentMap, custById, todayStr) {
    const today = todayStr ? new Date(todayStr) : new Date();
    const curYear = String(today.getFullYear());
    const curMonthIdx = today.getMonth();
    const nkey = (cid) => (parentMap && parentMap[cid]) ? nameCodeKey(parentMap[cid]) : cid;
    // current-year actual per customer per month
    const actByCust = {};
    (monthRows || []).forEach(r => { if (String(r.yr) !== curYear) return; const cid = r.cust; const mi = (parseInt(r.mo, 10) || 0) - 1; if (mi < 0 || mi > 11) return; (actByCust[cid] = actByCust[cid] || Array(12).fill(0))[mi] += Number(r.amount) || 0; });
    // PIC all-time revenue (share denominator) — approximated from each customer's last PIC
    const picTotal = {};
    (statsRows || []).forEach(s => { const pic = s.last_pic || ""; if (pic) picTotal[pic] = (picTotal[pic] || 0) + (Number(s.total_amt) || 0); });
    // group member customers by parent
    const groups = {};
    (statsRows || []).forEach(s => { if (!s.customer_id) return; (groups[nkey(s.customer_id)] = groups[nkey(s.customer_id)] || []).push(s); });
    const out = [];
    Object.values(groups).forEach(members => {
      const rep = members.slice().sort((a, b) => (Number(b.total_amt) || 0) - (Number(a.total_amt) || 0))[0];
      const customerId = rep.customer_id;
      const memberCustomerIds = members.map(m => m.customer_id);
      const nameCode = parentMap ? (parentMap[customerId] || customerId) : customerId;
      const orderCount = members.reduce((s, m) => s + (Number(m.po_count) || 0), 0);
      const invoiceCount = members.reduce((s, m) => s + (Number(m.inv_count) || 0), 0);
      const custTotal = members.reduce((s, m) => s + (Number(m.total_amt) || 0), 0);
      const distinctProducts = members.reduce((s, m) => s + (Number(m.distinct_products) || 0), 0);
      const firstOrderDate = members.map(m => m.first_date).filter(Boolean).sort()[0] || "";
      const lastByDate = members.slice().filter(m => m.last_date).sort((a, b) => String(b.last_date).localeCompare(String(a.last_date)))[0] || rep;
      const lastOrderDate = lastByDate.last_date || "";
      const pic = lastByDate.last_pic || "";
      const lastProduct = lastByDate.last_product || "";
      // po_count-weighted avg gap across members
      let gw = 0, gn = 0; members.forEach(m => { if (m.avg_gap_days != null) { const w = Number(m.po_count) || 1; gw += Number(m.avg_gap_days) * w; gn += w; } });
      const avgFrequencyDays = gn ? Math.round(gw / gn) : null;
      const lastD = parseDate(lastOrderDate) || today;
      const daysSinceLastPO = Math.max(0, Math.round((today - lastD) / 86400000));
      const actualArr = Array(12).fill(0);
      memberCustomerIds.forEach(cid => { const a = actByCust[cid]; if (a) for (let i = 0; i < 12; i++) actualArr[i] += a[i]; });
      const thisMonthActual = actualArr[curMonthIdx] || 0;
      const share = (pic && picTotal[pic]) ? custTotal / picTotal[pic] : 0;
      const picMonthlyTarget = (targets[curYear] && targets[curYear][pic]) ? (targets[curYear][pic][curMonthIdx] || 0) : 0;
      const allocatedTarget = Math.round(picMonthlyTarget * share);
      const picTargetArr = (targets[curYear] && targets[curYear][pic]) ? targets[curYear][pic] : [];
      const targetArr = Array.from({ length: 12 }, (_, mi) => Math.round((picTargetArr[mi] || 0) * share));
      const pctOfTarget = allocatedTarget > 0 ? (thisMonthActual / allocatedTarget) * 100 : (thisMonthActual > 0 ? 100 : null);
      const isNewCustomer = orderCount === 1;
      let health;
      const overdue = avgFrequencyDays !== null && daysSinceLastPO > avgFrequencyDays * 1.5;
      const veryOverdue = avgFrequencyDays !== null && daysSinceLastPO > avgFrequencyDays * 2.5;
      const lowTarget = pctOfTarget !== null && pctOfTarget < 70;
      const veryLowTarget = pctOfTarget !== null && pctOfTarget < 40;
      if (veryOverdue || veryLowTarget) health = "red"; else if (overdue || lowTarget) health = "yellow"; else health = "green";
      const group = (custById && custById[customerId] && custById[customerId].group) || "";
      out.push({
        customerId, nameCode, memberCustomerIds, companyCount: memberCustomerIds.length,
        pic, group, daysSinceLastPO, avgFrequencyDays,
        pctOfTarget, allocatedTarget, thisMonthActual,
        distinctProducts, newProductCode: false, isNewCustomer,
        totalPoAmount: custTotal, productList: lastProduct ? [lastProduct] : [],
        invoiceCount, invoiceList: [],
        targetArr, actualArr,
        firstOrderDate, lastOrderDate, orderCount, health,
      });
    });
    return out.sort((a, b) => b.daysSinceLastPO - a.daysSinceLastPO);
  }

  // ---- persistence (localStorage overlay over seed data) ----
  const LS = {
    extras: "ttcrm_extra_customers_v1",
    roles: "ttcrm_roles_v2",
    logs: "ttcrm_logs_v1",
    calendar: "ttcrm_calendar_v1",
    users: "ttcrm_users_v6",
    projects: "ttcrm_projects_v2",
    // v2 (27/07/2026): bumped so every browser drops its stale local PO copy after the
    // Supabase `pos` table was truncated — otherwise the old rows merge straight back up.
    // v3 (07/08/2026): bumped after the 414 mis-priced Thai POs were deleted server-side.
    polist: "ttcrm_polist_v3",
    // v2 (07/08/2026): bumped after the country split — every browser must drop its local
    // copy of the old "All"-country catalogue instead of merging it back up.
    products: "ttcrm_products_v2",
    targets: "ttcrm_targets_v1",
    targetGroups: "ttcrm_target_groups_v1",
    targetCust: "ttcrm_target_cust_v1",
    sqmFix: "ttcrm_qty_sqm_fix_v1",
    custOverrides: "ttcrm_cust_overrides_v1",
    session: "ttcrm_session_v1",
    lang: "ttcrm_lang_v1",
    activity: "ttcrm_activity_v1",
    samples: "ttcrm_samples_v1",
    quotations: "ttcrm_quotations_v1",
    reorderLog: "ttcrm_reorder_log_v1",
    forecast: "ttcrm_forecast_v1",
    skuForecast: "ttcrm_sku_forecast_v1",
  };
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return (v && v !== "undefined" && v !== "null") ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  const SB = {
    // PostgREST-compatible API served by the Cloudflare Worker on this origin (D1 behind
    // it); the session cookie authenticates every call — there is no client key any more.
    url: "/rest/v1",
    // Tables whose blob is an ARRAY of records keyed by `id` (vs. an object keyed by
    // arbitrary keys). Array tables merge by record id; object tables merge by key.
    ARRAY_TABLES: { projects: 1, samples: 1, quotations: 1, pos: 1, forecast: 1, products: 1, users: 1, customers: 1, logs: 1, activity: 1 },
    // Tables SHARDED across many small rows (id = table+"~"+n): a single 6-7 MB POST
    // (rejected by the API gateway) is never sent, and localStorage's ~5 MB cap is moot
    // because each shard write is < 0.5 MB. Reads paginate, so this scales to very large
    // datasets (browser RAM becomes the only ceiling, not the storage layer).
    SHARD_TABLES: { products: 1, logs: 1 },
    // Row-per-record tables (id = record id, data = one record): one Supabase row per PO,
    // bulk-upserted in small batches on import, one row per edit. Scales to millions.
    ROW_TABLES: { pos: 1, customers: 1, projects: 1, samples: 1, quotations: 1 },
    // Deep nested-object tables sharded by TOP-LEVEL KEY (one row per year / customer):
    // id = table+"~"+key, data = that key's sub-object. A huge object is never sent as one
    // blob and a single key's edit writes one small row. See getDeepShards / putDeepShards.
    DEEP_ROW_TABLES: { targets: 1, targetGroups: 1, targetCust: 1, skuForecast: 1 },
    ROW_BATCH: 500,
    SHARD_BYTES: 450000,
    PAGE: 1000,
    // Bounded RAM hydration cap: newest N POs loaded into memory at startup (full history
    // stays on the server; detail views fetch on demand). Keeps startup flat at any scale.
    RAM_CAP: 6000,
    // Object-blob tables whose value is DEEPLY nested (year → pic → month array, etc.).
    // A shallow {...remote,...local} clobbers a whole branch when two users edit
    // different leaves, so these merge recursively instead (see deepMergeWins).
    DEEP_TABLES: { targets: 1, targetGroups: 1, targetCust: 1, skuForecast: 1 },
    headers() { return { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }; },
    // Timestamps are written as full ISO UTC (see NOW()), but legacy rows carry the bare
    // "YYYY-MM-DD HH:mm" form, which Date() reads as LOCAL time — 7 hours adrift here, and
    // enough to make an older record win a merge. Treat a stamp with no zone as UTC.
    ts(r) {
      if (!r || !r._updated) return 0;
      let s = String(r._updated);
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
      return +new Date(s) || 0;
    },
    idOf(r) { return r == null ? null : (r.id != null ? r.id : (r.forecastId != null ? r.forecastId : null)); },
    // Union two record arrays by id (forecast rows key on forecastId). For a record
    // present in both, the one with the newer `_updated` wins (local wins on ties / when
    // neither is stamped). Tombstones ({_deleted:true}) are just records — a newer
    // tombstone wins, so a delete on one client is not resurrected by another's stale copy.
    mergeArrById(remote, local) {
      const m = new Map();
      (Array.isArray(remote) ? remote : []).forEach(r => { const k = this.idOf(r); if (k != null) m.set(k, r); });
      (Array.isArray(local) ? local : []).forEach(l => {
        const k = this.idOf(l);
        if (k == null) { return; }
        const r = m.get(k);
        m.set(k, (!r || this.ts(l) >= this.ts(r)) ? l : r);
      });
      return [...m.values()];
    },
    // Union two objects by key (local wins per key). Used for targets etc.
    mergeObj(remote, local) {
      return { ...(remote && typeof remote === "object" ? remote : {}), ...(local && typeof local === "object" ? local : {}) };
    },
    // Recursively merge two nested objects. Where both sides hold a plain object the
    // merge descends; anywhere else `over` wins (falling back to `base`). This keeps
    // one user's edit to rep A's KPI from wiping another user's edit to rep B, because
    // the two live on different branches and only the shared leaf can conflict.
    deepMergeWins(base, over) {
      const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
      if (!isObj(base)) return isObj(over) ? { ...over } : (over === undefined ? base : over);
      if (!isObj(over)) return { ...base };
      const out = { ...base };
      Object.keys(over).forEach(k => { out[k] = (isObj(base[k]) && isObj(over[k])) ? this.deepMergeWins(base[k], over[k]) : over[k]; });
      return out;
    },
    upsert(table, value, rowId) {
      try { fetch(this.url + "/" + table, { method: "POST", headers: this.headers(), body: JSON.stringify({ id: rowId || "_all", data: value, updated_at: new Date().toISOString() }) }).then(r => { if (!r.ok) console.warn("[SB] upsert " + table + " HTTP " + r.status); }).catch(e => console.warn("[SB] upsert " + table + " failed", e)); } catch (e) {}
    },
    // Push that MERGES with the server's current value first, so concurrent edits from
    // other users are preserved instead of being clobbered by a whole-blob overwrite.
    // Falls back to a plain upsert if the pre-fetch fails.
    async push(table, value) {
      if (this.ROW_TABLES[table]) { try { await this.putRows(table, value); } catch (e) { console.warn("[SB] push(rows) " + table + " failed", e); } return value; }
      if (this.DEEP_ROW_TABLES[table]) { try { return await this.pushDeep(table, value); } catch (e) { console.warn("[SB] push(deep) " + table + " failed", e); return value; } }
      if (this.SHARD_TABLES[table]) {
        try {
          const remote = await this.getShards(table);
          const merged = this.mergeArrById(Array.isArray(remote) ? remote : [], value);
          await this.putShards(table, merged);
          return merged;
        } catch (e) { try { await this.putShards(table, value); } catch (_) {} console.warn("[SB] push " + table + " failed", e); return value; }
      }
      try {
        const remote = await this.get(table);
        const merged = this.DEEP_TABLES[table]
          ? this.deepMergeWins(remote && typeof remote === "object" ? remote : {}, value)
          : (this.ARRAY_TABLES[table] ? this.mergeArrById(remote, value) : this.mergeObj(remote, value));
        this.upsert(table, merged);
        return merged;
      } catch (e) { this.upsert(table, value); return value; }
    },
    async get(table, rowId) {
      if (!rowId && this.ROW_TABLES[table]) return this.getRows(table);
      if (!rowId && this.DEEP_ROW_TABLES[table]) return this.getDeepShards(table);
      if (!rowId && this.SHARD_TABLES[table]) return this.getShards(table);
      try {
        const r = await fetch(this.url + "/" + table + "?id=eq." + (rowId || "_all") + "&select=data", {});
        if (!r.ok) return null;
        const j = await r.json(); return j && j[0] ? j[0].data : null;
      } catch (e) { return null; }
    },
    // Read every shard row (id = table+"~"+n), paginated, concatenating their arrays.
    // Also merges a legacy pre-shard single blob (id="_all") if one still exists, so a
    // not-yet-migrated database still loads. Returns null ONLY when nothing at all exists
    // (fresh DB) so the caller keeps its code seed; [] means "explicitly empty".
    async getShards(table) {
      const hdr = {};
      const out = []; let found = false; let offset = 0;
      for (;;) {
        let j = null;
        try {
          const r = await fetch(this.url + "/" + table + "?id=like." + table + "~*&select=data&order=id.asc&limit=" + this.PAGE + "&offset=" + offset, { headers: hdr });
          if (!r.ok) break;
          j = await r.json();
        } catch (e) { break; }
        if (!Array.isArray(j) || !j.length) break;
        found = true;
        for (const row of j) if (Array.isArray(row.data)) for (const rec of row.data) out.push(rec);
        if (j.length < this.PAGE) break;
        offset += this.PAGE;
      }
      try {
        const r = await fetch(this.url + "/" + table + "?id=eq._all&select=data", { headers: hdr });
        if (r.ok) { const j = await r.json(); if (j && j[0]) { found = true; const legacy = j[0].data; if (Array.isArray(legacy) && legacy.length) return this.mergeArrById(out, legacy); } }
      } catch (e) {}
      return found ? out : null;
    },
    // Write an array as N shard rows, each < SHARD_BYTES, one SMALL POST per shard (so a
    // giant single request is never sent). Then delete leftover shards from a previously
    // larger dataset and the legacy "_all" blob. Failures are surfaced, not swallowed.
    async putShards(table, arr) {
      arr = Array.isArray(arr) ? arr : [];
      const shards = []; let cur = [], bytes = 2;
      for (const rec of arr) {
        const b = JSON.stringify(rec).length + 1;
        if (cur.length && bytes + b > this.SHARD_BYTES) { shards.push(cur); cur = []; bytes = 2; }
        cur.push(rec); bytes += b;
      }
      shards.push(cur);
      const now = new Date().toISOString(); const ids = []; let ok = true;
      for (let i = 0; i < shards.length; i++) {
        const id = table + "~" + i; ids.push(id);
        try {
          const r = await fetch(this.url + "/" + table, { method: "POST", headers: this.headers(), body: JSON.stringify({ id, data: shards[i], updated_at: now }) });
          if (!r.ok) { ok = false; console.warn("[SB] shard write " + id + " HTTP " + r.status); }
        } catch (e) { ok = false; console.warn("[SB] shard write " + id + " failed", e); }
      }
      // Only prune the old data AFTER every shard wrote OK — otherwise keep the legacy
      // "_all" blob and old shards as a safety net so a partial write never loses data.
      if (ok) try {
        const lr = await fetch(this.url + "/" + table + "?id=like." + table + "~*&select=id", { headers: this.headers() });
        if (lr.ok) { const rows = await lr.json(); const keep = new Set(ids);
          for (const row of rows) if (!keep.has(row.id)) await fetch(this.url + "/" + table + "?id=eq." + encodeURIComponent(row.id), { method: "DELETE", headers: this.headers() }); }
        await fetch(this.url + "/" + table + "?id=eq._all", { method: "DELETE", headers: this.headers() });
      } catch (e) {}
      return ok;
    },
    // ---- DEEP object tables sharded by TOP-LEVEL KEY (targets / targetGroups / skuForecast) ----
    // Read every key row (id = table+"~"+key), paginated, into one object; also absorbs a
    // legacy single "_all" blob if not yet migrated. Returns null ONLY when nothing exists.
    async getDeepShards(table) {
      const hdr = {};
      const pre = table + "~"; const out = {}; let found = false; let offset = 0;
      for (;;) {
        let j = null;
        try {
          const r = await fetch(this.url + "/" + table + "?id=like." + table + "~*&select=id,data&order=id.asc&limit=" + this.PAGE + "&offset=" + offset, { headers: hdr });
          if (!r.ok) break; j = await r.json();
        } catch (e) { break; }
        if (!Array.isArray(j) || !j.length) break;
        found = true;
        for (const row of j) { const k = String(row.id).slice(pre.length); if (k && row.data !== undefined) out[k] = row.data; }
        if (j.length < this.PAGE) break; offset += this.PAGE;
      }
      try {
        const r = await fetch(this.url + "/" + table + "?id=eq._all&select=data", { headers: hdr });
        if (r.ok) { const j = await r.json(); const legacy = j && j[0] ? j[0].data : null; if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) { found = true; Object.keys(legacy).forEach(k => { if (!(k in out)) out[k] = legacy[k]; }); } }
      } catch (e) {}
      return found ? out : null;
    },
    // Write an object as N key rows (id = table+"~"+key), one SMALL POST each. A key whose
    // value is null/undefined is DELETED. On a FULL write (no keys arg) also prune leftover
    // key rows not in the object and drop the legacy "_all" blob. Failures surfaced, not swallowed.
    async putDeepShards(table, obj, keys) {
      obj = (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
      const full = !(Array.isArray(keys) && keys.length);
      const writeKeys = full ? Object.keys(obj) : keys;
      const now = new Date().toISOString(); let ok = true;
      for (const k of writeKeys) {
        const id = table + "~" + k;
        if (obj[k] == null) { try { await fetch(this.url + "/" + table + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: this.headers() }); } catch (e) {} continue; }
        try {
          const r = await fetch(this.url + "/" + table, { method: "POST", headers: this.headers(), body: JSON.stringify({ id, data: obj[k], updated_at: now }) });
          if (!r.ok) { ok = false; console.warn("[SB] deep write " + id + " HTTP " + r.status); }
        } catch (e) { ok = false; console.warn("[SB] deep write " + id + " failed", e); }
      }
      if (full && ok) try {
        const keep = new Set(Object.keys(obj).map(k => table + "~" + k));
        const lr = await fetch(this.url + "/" + table + "?id=like." + table + "~*&select=id", { headers: this.headers() });
        if (lr.ok) { const rows = await lr.json(); for (const row of rows) if (!keep.has(row.id)) await fetch(this.url + "/" + table + "?id=eq." + encodeURIComponent(row.id), { method: "DELETE", headers: this.headers() }); }
        await fetch(this.url + "/" + table + "?id=eq._all", { method: "DELETE", headers: this.headers() });
      } catch (e) {}
      return ok;
    },
    // Push a deep object, MERGING with the server first so concurrent edits survive.
    // With `keys` (targeted): only those top-level keys are merged & written (cheap — one
    // small fetch+write per key). Without keys (full): merge the whole object, write every
    // key and prune removed ones. deepMergeWins keeps two users' edits on different branches.
    async pushDeep(table, value, keys) {
      const v = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
      if (Array.isArray(keys) && keys.length) {
        const hdr = {}; const out = {};
        for (const k of keys) {
          let remoteVal = null;
          try { const r = await fetch(this.url + "/" + table + "?id=eq." + encodeURIComponent(table + "~" + k) + "&select=data", { headers: hdr }); if (r.ok) { const j = await r.json(); if (j && j[0]) remoteVal = j[0].data; } } catch (e) {}
          out[k] = (k in v) ? this.deepMergeWins(remoteVal && typeof remoteVal === "object" ? remoteVal : {}, v[k]) : null;
        }
        try { await this.putDeepShards(table, out, keys); } catch (e) {}
        return v;
      }
      try {
        const remote = await this.getDeepShards(table);
        const merged = this.deepMergeWins(remote && typeof remote === "object" ? remote : {}, v);
        await this.putDeepShards(table, merged);
        return merged;
      } catch (e) { try { await this.putDeepShards(table, v); } catch (_) {} return v; }
    },
    _mergeInto(map, rec, id) { const ex = map.get(id); if (!ex || this.ts(rec) >= this.ts(ex)) map.set(id, rec); },
    // Read a row-per-record table: paginate ALL rows (each row.data = one record). Also
    // absorbs a legacy single-blob "_all" row or shard rows (row.data = array) so a not-
    // yet-migrated table still loads. De-dupes by record id (newest _updated wins). Returns
    // null ONLY when nothing exists (fresh DB) so the caller keeps its seed. onProgress(n) per page.
    async getRows(table, onProgress) {
      const hdr = {};
      const byId = new Map(); let offset = 0; let found = false;
      for (;;) {
        let j = null;
        try {
          const r = await fetch(this.url + "/" + table + "?select=id,data&order=id.asc&limit=" + this.PAGE + "&offset=" + offset, { headers: hdr });
          if (!r.ok) break;
          j = await r.json();
        } catch (e) { break; }
        if (!Array.isArray(j) || !j.length) break;
        found = true;
        for (const row of j) {
          const d = row.data;
          if (Array.isArray(d)) { for (const rec of d) { const id = this.idOf(rec); if (id != null) this._mergeInto(byId, rec, id); } }
          else if (d && typeof d === "object") { const id = this.idOf(d); if (id != null) this._mergeInto(byId, d, id); }
        }
        if (onProgress) try { onProgress(byId.size); } catch (e) {}
        if (j.length < this.PAGE) break;
        offset += this.PAGE;
      }
      return found ? [...byId.values()] : null;
    },
    // Bulk-upsert records as ONE ROW EACH, in batches of ROW_BATCH (each request small &
    // reliable). Retries a failed batch up to 3x. Returns {ok,written,failedBatches,total}.
    // onProgress(written,total,failedBatches) per batch. NEVER sends one giant body.
    async putRows(table, records, onProgress) {
      const recs = (Array.isArray(records) ? records : [records]).filter(r => r && this.idOf(r) != null);
      let written = 0, failedBatches = 0;
      for (let i = 0; i < recs.length; i += this.ROW_BATCH) {
        const batch = recs.slice(i, i + this.ROW_BATCH);
        const body = JSON.stringify(batch.map(r => ({ id: String(this.idOf(r)), data: r, updated_at: (r._updated ? new Date(r._updated).toISOString() : new Date().toISOString()) })));
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const res = await fetch(this.url + "/" + table, { method: "POST", headers: this.headers(), body });
            ok = res.ok;
            if (!ok) console.warn("[SB] putRows " + table + " HTTP " + res.status + " (try " + (attempt + 1) + ")");
          } catch (e) { console.warn("[SB] putRows " + table + " error (try " + (attempt + 1) + ")", e); }
          if (!ok) await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
        }
        if (ok) written += batch.length; else failedBatches++;
        if (onProgress) try { onProgress(written, recs.length, failedBatches); } catch (e) {}
      }
      if (table === "pos" && written) this.clearAggCache();
      return { ok: failedBatches === 0, written, failedBatches, total: recs.length };
    },
    // ---- SERVER-SIDE READ (Phase 2): query/aggregate WITHOUT loading the whole table ----
    // Generic RPC caller (Postgres functions po_agg / po_month_totals / po_count).
    async rpc(fn, args) {
      try {
        const r = await fetch(this.url + "/rpc/" + fn, { method: "POST", headers: this.headers(), body: JSON.stringify(args || {}) });
        if (!r.ok) { console.warn("[SB] rpc " + fn + " HTTP " + r.status); return null; }
        return await r.json();
      } catch (e) { console.warn("[SB] rpc " + fn + " failed", e); return null; }
    },
    // Base filter that selects ONLY real per-row PO objects — excludes the legacy blob
    // row (id=_all) and any shard rows (id=pos~n) that may still coexist pre-cutover.
    _objGuard() { return "&id=not.eq._all&id=not.like.pos~*"; },
    // Fetch ONE filtered, ordered, paginated page of PO records straight from the DB.
    // opts: { from,to (date YYYY-MM-DD), pic, customerIds:[], search, includeDeleted,
    //         order:'date'|'amount', dir:'asc'|'desc', limit, offset }
    // Returns { rows:[record...], total } — total is the exact match count (from the
    // Content-Range header) so the UI can paginate millions without holding them.
    async queryPage(opts) {
      const o = opts || {};
      let qs = "?select=data" + this._objGuard();
      if (o.from) qs += "&data->>date=gte." + encodeURIComponent(o.from);
      if (o.to) qs += "&data->>date=lte." + encodeURIComponent(o.to);
      if (o.pic) qs += "&data->>pic=ilike." + encodeURIComponent(o.pic);
      const _qv = (x) => encodeURIComponent('"' + String(x).replace(/"/g, '') + '"');
      if (Array.isArray(o.customerIds) && o.customerIds.length) qs += "&data->>customerId=in.(" + o.customerIds.map(_qv).join(",") + ")";
      if (Array.isArray(o.pics) && o.pics.length) qs += "&data->>pic=in.(" + o.pics.map(_qv).join(",") + ")";
      if (o.search) { const s = encodeURIComponent("*" + String(o.search).trim() + "*"); qs += "&or=(data->>poNumber.ilike." + s + ",data->>invNo.ilike." + s + ")"; }
      if (!o.includeDeleted) qs += "&or=(data->>_deleted.is.null,data->>_deleted.eq.false)";
      const col = o.order === "amount" ? "data->>amountVnd" : "data->>date";
      qs += "&order=" + col + "." + (o.dir === "asc" ? "asc" : "desc");
      const limit = o.limit || 100, offset = o.offset || 0;
      qs += "&limit=" + limit + "&offset=" + offset;
      try {
        const r = await fetch(this.url + "/pos" + qs, { headers: { Prefer: "count=exact", Range: offset + "-" + (offset + limit - 1), "Range-Unit": "items" } });
        if (!r.ok) { console.warn("[SB] queryPage HTTP " + r.status); return { rows: [], total: 0, error: r.status }; }
        const j = await r.json();
        const cr = r.headers.get("content-range") || "";
        const total = cr.indexOf("/") >= 0 ? parseInt(cr.split("/")[1], 10) : (Array.isArray(j) ? j.length : 0);
        return { rows: Array.isArray(j) ? j.map(x => x.data) : [], total: isNaN(total) ? 0 : total };
      } catch (e) { console.warn("[SB] queryPage failed", e); return { rows: [], total: 0, error: String(e) }; }
    },
    // Fetch ALL matching PO records for a filter (paginated internally). Guarded by a
    // safety cap so a runaway filter can't pull millions into RAM; returns {rows,total,
    // capped}. Used when the view must group/sequence the whole filtered set (e.g. one
    // company's history) — callers pass a tight filter (customerIds / date range).
    // onProgress(loaded, expected) fires after every page so the UI can show real progress
    // instead of an empty table while a large history streams in.
    async queryAll(opts, cap, onProgress) {
      cap = cap || 20000;   // 0 / undefined → default cap
      const page = 1000; let offset = 0; let rows = []; let total = 0;
      for (;;) {
        const r = await this.queryPage(Object.assign({}, opts, { limit: page, offset }));
        total = r.total;
        rows = rows.concat(r.rows);
        if (onProgress) try { onProgress(rows.length, Math.min(total || 0, cap)); } catch (e) {}
        if (!r.rows.length || rows.length >= total || rows.length >= cap) break;
        offset += page;
      }
      return { rows, total, capped: total > rows.length };
    },
    // Live PO count (server-side, excludes deleted). Falls back to null if RPC missing.
    async countLive() { const n = await this.rpc("po_count", {}); return (n == null ? null : Number(n)); },
    // Monthly totals for one year: [{mo,amount,sqm,cnt}]. For KPI cards / Overview.
    async aggYear(year) { const r = await this.rpc("po_month_totals", { p_year: String(year) }); return Array.isArray(r) ? r : []; },
    // One paginated pass over an RPC. Returns null (NOT []) when the server refuses:
    // callers must be able to tell "no rows" from "request failed", otherwise a Postgres
    // statement timeout silently renders every PO KPI as 0 instead of falling back to RAM.
    // A timeout (57014) on these table-scanning aggregates is usually transient — a cold
    // cache or two of them racing — so each page is retried with a short backoff.
    async _rpcPages(fn, body, label) {
      const page = 1000; let offset = 0; const out = [];
      for (;;) {
        let j = null, got = false;
        for (let attempt = 0; attempt < 3 && !got; attempt++) {
          if (attempt) await new Promise(r => setTimeout(r, 1200 * attempt));
          try {
            const r = await fetch(this.url + "/rpc/" + fn + "?limit=" + page + "&offset=" + offset, { method: "POST", headers: this.headers(), body });
            if (!r.ok) { console.warn("[SB] " + label + " HTTP " + r.status + (attempt < 2 ? " — retrying" : "")); continue; }
            j = await r.json(); got = true;
          } catch (e) { console.warn("[SB] " + label + " failed", e); }
        }
        if (!got || !Array.isArray(j)) return null;
        if (!j.length) break;
        for (const x of j) out.push(x);
        if (j.length < page) break;
        offset += page;
      }
      return out;
    },
    // Heavy aggregates run ONE AT A TIME. Overview, PO List, Targets and Retention all ask
    // on mount; letting three full table scans race is what pushed them past the timeout.
    _rpcGate: null,
    _serialize(run) {
      const next = (this._rpcGate || Promise.resolve()).then(run, run);
      this._rpcGate = next.catch(() => {});
      return next;
    },
    // Grouped aggregate over a date range: [{yr,mo,pic,cust,grp,amount,sqm,cnt}] — or null
    // when the server could not answer, so callers fall back to the RAM PO array instead of
    // rendering 0. Overview + PO List + Targets + Retention all ask for the same range at
    // once, so identical concurrent calls SHARE one fetch and a good answer is cached until
    // POs are written (see clearAggCache in putRows).
    // NOTE: if this logs "HTTP 500 / 57014 statement timeout", run the one-off migration
    // deploy/supabase/migrations/speed_up_po_aggregates.sql — po_agg has to scan every
    // JSONB row without those indexes.
    async aggRange(from, to) {
      const key = (from || "") + "|" + (to || "");
      this._aggCache = this._aggCache || {};
      if (this._aggCache[key]) return this._aggCache[key];
      const p = this._serialize(() => this._aggFetch(from, to));
      this._aggCache[key] = p;
      const r = await p;
      if (r === null && this._aggCache[key] === p) delete this._aggCache[key];
      return r;
    },
    // A 2-year span reliably outruns the statement timeout on a large pos table while a
    // single year fits, so a multi-year range is fetched one CALENDAR YEAR at a time and
    // merged (po_agg already groups by year+month, so the union is exactly the same rows).
    async _aggFetch(from, to) {
      const body = (f, t) => JSON.stringify({ p_from: f || null, p_to: t || null });
      const y0 = parseInt(String(from || "").slice(0, 4), 10), y1 = parseInt(String(to || "").slice(0, 4), 10);
      if (!y0 || !y1 || y1 <= y0 || y1 - y0 > 6) return await this._rpcPages("po_agg", body(from, to), "aggRange");
      const out = [];
      for (let y = y0; y <= y1; y++) {
        const part = await this._rpcPages("po_agg", body(y === y0 ? from : y + "-01-01", y === y1 ? to : y + "-12-31"), "aggRange " + y);
        if (part === null) return null;
        for (const x of part) out.push(x);
      }
      return out;
    },
    // Grouped aggregate by MATERIAL (base structure code) for the Overview product pivot:
    // [{yr,mo,code,pic,amount,sqm,cnt}] — or null when the RPC is missing or times out, so
    // the caller falls back to the POs held in RAM instead of rendering 0. Needs the one-off
    // migration deploy/supabase/migrations/po_agg_material.sql.
    async aggMaterialRange(from, to) {
      const key = "MAT|" + (from || "") + "|" + (to || "");
      this._aggCache = this._aggCache || {};
      if (this._aggCache[key]) return this._aggCache[key];
      const p = this._serialize(() => this._aggMatFetch(from, to));
      this._aggCache[key] = p;
      const r = await p;
      if (r === null && this._aggCache[key] === p) delete this._aggCache[key];
      return r;
    },
    async _aggMatFetch(from, to) {
      const body = (f, t) => JSON.stringify({ p_from: f || null, p_to: t || null });
      const y0 = parseInt(String(from || "").slice(0, 4), 10), y1 = parseInt(String(to || "").slice(0, 4), 10);
      if (!y0 || !y1 || y1 <= y0 || y1 - y0 > 6) return await this._rpcPages("po_agg_material", body(from, to), "aggMaterialRange");
      const out = [];
      for (let y = y0; y <= y1; y++) {
        const part = await this._rpcPages("po_agg_material", body(y === y0 ? from : y + "-01-01", y === y1 ? to : y + "-12-31"), "aggMaterialRange " + y);
        if (part === null) return null;
        for (const x of part) out.push(x);
      }
      return out;
    },
    clearAggCache() { this._aggCache = {}; },
    // Every LIVE PO whose poNumber is in `nums`. The importer needs these: dedup runs
    // against the POs held in RAM, and RAM only holds the loaded date window — without
    // this, re-importing a file duplicates every PO that sits outside that window.
    async posByPoNumbers(nums) {
      const list = [...new Set((nums || []).map(n => String(n == null ? "" : n).trim()).filter(Boolean))];
      if (!list.length) return [];
      const out = []; const CH = 50;
      for (let i = 0; i < list.length; i += CH) {
        const inList = list.slice(i, i + CH).map(n => '"' + n.replace(/["\\]/g, "") + '"').join(",");
        try {
          const r = await fetch(this.url + "/pos?select=data" + this._objGuard() + "&data->>poNumber=in.(" + encodeURIComponent(inList) + ")&or=(data->>_deleted.is.null,data->>_deleted.eq.false)&limit=10000", {});
          if (!r.ok) { console.warn("[SB] posByPoNumbers HTTP " + r.status); continue; }
          const j = await r.json();
          if (Array.isArray(j)) j.forEach(x => { if (x && x.data) out.push(x.data); });
        } catch (e) { console.warn("[SB] posByPoNumbers failed", e); }
      }
      return out;
    },
    // On-demand PO fetches for DETAIL views (so full history need not live in RAM):
    async posForCustomers(customerIds) { if (!Array.isArray(customerIds) || !customerIds.length) return []; const r = await this.queryAll({ customerIds, includeDeleted: false }, 5000); return r.rows; },
    async poById(id) { try { const r = await fetch(this.url + "/pos?id=eq." + encodeURIComponent(String(id)) + "&select=data" + this._objGuard(), {}); if (!r.ok) return null; const j = await r.json(); return (j && j[0]) ? j[0].data : null; } catch (e) { return null; } },
    // Every stored record behind one PO number — TOMBSTONES INCLUDED. Feeds the "input
    // history" panel: which records a PO is really made of, when each was written, and
    // which ones were already removed. A blank PO number falls back to customer + date.
    async poHistory(poNumber, customerId, date) {
      const pn = String(poNumber == null ? "" : poNumber).trim();
      const hdr = {};
      let qs = "";
      if (pn) qs = "&data->>poNumber=eq." + encodeURIComponent(pn);
      else if (customerId) qs = "&data->>customerId=eq." + encodeURIComponent(String(customerId)) + (date ? "&data->>date=eq." + encodeURIComponent(String(date)) : "");
      else return [];
      try {
        const r = await fetch(this.url + "/pos?select=data" + this._objGuard() + qs + "&limit=400", { headers: hdr });
        if (!r.ok) return [];
        const j = await r.json();
        return (Array.isArray(j) ? j : []).map(x => x && x.data).filter(Boolean);
      } catch (e) { return []; }
    },
    // How many (live) POs a customer already has — for New/Repeat + priorCount, exact at any scale.
    async poCountForCustomer(customerId) { try { const r = await fetch(this.url + "/pos?select=id" + this._objGuard() + "&data->>customerId=eq." + encodeURIComponent(String(customerId)) + "&or=(data->>_deleted.is.null,data->>_deleted.eq.false)", { headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" } }); const cr = r.headers.get("content-range") || ""; const n = cr.indexOf("/") >= 0 ? parseInt(cr.split("/")[1], 10) : 0; return isNaN(n) ? 0 : n; } catch (e) { return 0; } },
    // How many live POs use a product code (structure code / commercial name). RAM only
    // holds a date window, so deleting a price-list row must ask the server before it can
    // claim the code is unused. Returns -1 when the check itself failed.
    async poCountForCode(code) {
      const c = String(code == null ? "" : code).trim(); if (!c) return 0;
      const qv = '"' + c.replace(/["\\]/g, "") + '"';
      try {
        const r = await fetch(this.url + "/pos?select=id" + this._objGuard()
          + "&and=(or(data->>structureCode.eq." + encodeURIComponent(qv) + ",data->>commercial.eq." + encodeURIComponent(qv)
          + "),or(data->>_deleted.is.null,data->>_deleted.eq.false))",
          { headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" } });
        if (!r.ok) return -1;
        const cr = r.headers.get("content-range") || "";
        const n = cr.indexOf("/") >= 0 ? parseInt(cr.split("/")[1], 10) : 0;
        return isNaN(n) ? -1 : n;
      } catch (e) { return -1; }
    },
    // Find a live PO already using an invoice number (dup check) — server-side, any scale.
    async poByInvoice(invNo, excludeId) { const n = String(invNo == null ? "" : invNo).trim(); if (!n) return null; try { const r = await fetch(this.url + "/pos?select=data" + this._objGuard() + "&data->>invNo=eq." + encodeURIComponent(n) + "&or=(data->>_deleted.is.null,data->>_deleted.eq.false)&limit=5", {}); if (!r.ok) return null; const j = await r.json(); const rows = Array.isArray(j) ? j.map(x => x.data) : []; return rows.find(p => p && p.id !== excludeId) || null; } catch (e) { return null; } },
    // Customer ids a sales code owns THROUGH ITS POs. RAM only ever holds a bounded PO
    // window, so a rep's scope cannot be derived from `pos` — without this a rep whose
    // customers were never given an `owner` sees an empty CRM. Returns [] on failure
    // (callers still have the owner-based grants).
    async custIdsForPics(codes) {
      const raw = (codes || []).map(c => String(c == null ? "" : c).trim()).filter(Boolean);
      // match both the code as stored on the user record and its upper-case form
      const list = [...new Set([...raw, ...raw.map(c => c.toUpperCase())])];
      if (!list.length) return [];
      const out = new Set(); const CH = 25;
      for (let i = 0; i < list.length; i += CH) {
        const inList = list.slice(i, i + CH).map(n => '"' + n.replace(/["\\]/g, "") + '"').join(",");
        let offset = 0; const page = 1000;
        for (;;) {
          let j = null;
          try {
            const r = await fetch(this.url + "/pos?select=cid:data->>customerId" + this._objGuard() + "&data->>pic=in.(" + encodeURIComponent(inList) + ")&or=(data->>_deleted.is.null,data->>_deleted.eq.false)&limit=" + page + "&offset=" + offset, {});
            if (!r.ok) { console.warn("[SB] custIdsForPics HTTP " + r.status); break; }
            j = await r.json();
          } catch (e) { console.warn("[SB] custIdsForPics failed", e); break; }
          if (!Array.isArray(j) || !j.length) break;
          j.forEach(x => { if (x && x.cid) out.add(String(x.cid)); });
          if (j.length < page) break;
          offset += page;
          if (offset > 200000) break;
        }
      }
      return [...out];
    },
    // Per-customer retention stats (po_customer_stats) — one row per customer, paginated.
    // null when the server refuses, so Retention falls back to the RAM engine.
    async customerStats() {
      return await this._serialize(() => this._rpcPages("po_customer_stats", "{}", "customerStats"));
    },
  };
  // Password-reset endpoints on the Worker: the app POSTs to `${RESET_FN_BASE}/request-reset`
  // and `/confirm-reset`. SMTP credentials live only in the Worker's secrets.
  const RESET_FN_BASE = "/api/auth";

  // Account/session API on the Worker (cookie session; see worker/src/auth.js).
  const API = {
    async call(method, path, body) {
      const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      return { ...j, ok: r.ok && j.ok !== false, status: r.status };
    },
    me() { return this.call("GET", "/api/auth/me"); },
    login(email, password) { return this.call("POST", "/api/auth/login", { email, password }); },
    logout() { return this.call("POST", "/api/auth/logout", {}); },
    users() { return this.call("GET", "/api/users"); },
    async saveUser(u) {
      const r = await this.call("PUT", "/api/users/" + encodeURIComponent(u.id), u);
      if (!r.ok) console.warn("[API] save user " + u.id + " failed", r.error || r.status);
      return r;
    },
  };
  // A 401 from the data/account API means the session expired or was revoked (password
  // change, account disabled): tell the app to show the sign-in screen.
  if (!window.__tdtFetchWrapped) {
    window.__tdtFetchWrapped = true;
    const _fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const r = await _fetch(input, init);
      if (r.status === 401) {
        const u = typeof input === "string" ? input : (input && input.url) || "";
        if (/^\/(rest\/v1|api)\//.test(u) && !/^\/api\/auth\/(login|me)$/.test(u)) window.dispatchEvent(new Event("tdt:unauthorized"));
      }
      return r;
    };
  }
  // Whole-blob tables synced via saveJSON. The high-volume record tables (pos, customers,
  // projects, samples, quotations) sync ONE ROW PER RECORD, and the deep KPI tables
  // (targets, targetGroups, skuForecast) sync ONE ROW PER KEY — both from core.jsx, never
  // as one blob — so import/entry scale to ~1M without a giant POST or localStorage loss.
  const SB_MAP = {
    [LS.forecast]: "forecast",
    [LS.products]: "products", [LS.custOverrides]: "custOverrides",
    [LS.logs]: "logs", [LS.activity]: "activity",
  };
  function saveJSON(key, val) {
    // Never persist undefined / functions — doing so writes the string "undefined"
    // (which then fails to parse on reload) and would push garbage to the backend.
    if (typeof val === "undefined" || typeof val === "function") return;
    // Merge with the server's current value before writing, so simultaneous edits from
    // other users are not overwritten (whole-blob upsert used to clobber them).
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { try { localStorage.removeItem(key); } catch (_) {} } if (SB_MAP[key]) SB.push(SB_MAP[key], val); }

  const SEED_ACTIVITY = [
    { ts: "2026-06-09 16:05", user: "LINH", action: "status", target: "Truong Phat Barcode Equipment", detail: "Quotation / Quote" },
    { ts: "2026-06-09 14:20", user: "MINT", action: "added", target: "CODETECH SOLUTIONS & SUPPLY CO., LTD.", detail: "Quotation / Quote" },
    { ts: "2026-06-08 11:30", user: "TUAN", action: "project", target: "Viet Thai — premium wax trial", detail: "Sample sent" },
    { ts: "2026-06-08 10:05", user: "MINT", action: "added", target: "YC Supply Printing Co., Ltd.", detail: "New lead" },
    { ts: "2026-05-21 16:40", user: "ICE", action: "status", target: "TRIP AHOLIC CO., LTD.", detail: "Quotation / Quote" },
    { ts: "2026-05-20 11:15", user: "ICE", action: "status", target: "Honeywell SPS Thailand", detail: "Current Customer" },
    { ts: "2026-05-19 09:30", user: "ICE", action: "status", target: "AUTO ID SUPPLY COMPANY LIMITED", detail: "Send company profile via Line/Email" },
    { ts: "2026-05-18 15:00", user: "KOOK", action: "project", target: "Markpak — Resin project vs Ricoh", detail: "Sample sent" },
    { ts: "2026-05-12 13:45", user: "NOOM", action: "project", target: "OGA — sample evaluation", detail: "Created project" },
  ];

  // ---- duplicate detection ----
  const LEGAL_WORDS = /\b(co|ltd|limited|company|corporation|corp|public|pcl|plc|inc|head office|thailand|th)\b/g;
  function normName(s) {
    return (s || "").toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9\u0E00-\u0E7F ]+/g, " ")
      .replace(LEGAL_WORDS, " ")
      .replace(/\s+/g, " ").trim();
  }
  function normPhone(s) { return (s || "").replace(/\D+/g, "").replace(/^66/, "0").replace(/^0+/, ""); }
  // Business ID (TIN) matching key. Leading zeros are dropped because Excel drops them:
  // a file column holding 0311856851 comes back as 311856851, and the two must still be
  // recognised as the same company instead of creating a second record.
  function normBizId(s) { return (s || "").replace(/\D+/g, "").replace(/^0+/, ""); }
  // returns [{customer, reasons:[...], exact:bool}]
  function findDuplicates(input, customers) {
    const nName = normName(input.name);
    const nShort = normName(input.shortName);
    const nBiz = normBizId(input.bizId);
    const nPhone = normPhone(input.phone);
    const nEmail = (input.email || "").trim().toLowerCase();
    if (!nName && !nBiz && !nPhone && !nEmail) return [];
    const out = [];
    for (const c of customers) {
      const reasons = []; let exact = false;
      const cBiz = normBizId(c.bizId);
      if (nBiz && cBiz && nBiz === cBiz) { reasons.push("bizId"); exact = true; }
      const cName = normName(c.name), cShort = normName(c.shortName);
      if (nName && cName && (cName === nName || cShort === nName)) { reasons.push("name"); exact = true; }
      else if (nName && nName.length >= 4 && cName && (cName.includes(nName) || nName.includes(cName))) reasons.push("name~");
      else if (nShort && nShort.length >= 3 && (cShort === nShort || cName === nShort)) reasons.push("name~");
      if (nPhone && nPhone.length >= 6) {
        const phones = [c.phone, c.phone2, c.phone3].map(normPhone);
        if (phones.some(p => p && (p === nPhone || p.endsWith(nPhone) || nPhone.endsWith(p)))) { reasons.push("phone"); exact = true; }
      }
      if (nEmail && c.email && c.email.toLowerCase().includes(nEmail)) { reasons.push("email"); exact = true; }
      if (reasons.length) out.push({ customer: c, reasons, exact });
    }
    out.sort((a, b) => (b.exact - a.exact) || (b.reasons.length - a.reasons.length));
    return out.slice(0, 5);
  }

  // ---- Name Code (parent grouping) ----------------------------------------
  // A "Name Code" is the parent key that groups several company records (each
  // with its own Business ID / TIN) under one customer, e.g. TDT = Todaytec VN
  // + Todaytec TL + Todaytec CN. Profile, pipeline, projects, PO, retention &
  // forecast all roll up by Name Code.
  // Display Name Code for a record — falls back to short name / name so legacy
  // records imported before Name Code existed still group sensibly.
  function nameCodeOf(c) {
    if (!c) return "";
    return (c.nameCode || c.shortName || c.name || c.id || "").toString().trim();
  }
  // Normalized key for grouping / equality (case-insensitive, single-spaced).
  function nameCodeKey(s) { return (s || "").toString().trim().toUpperCase().replace(/\s+/g, " "); }
  // Suggest a Name Code from a company name: first letters of the dominant
  // (first significant) word, padded with following initials to ~3 chars.
  // Legal suffixes (Co/Ltd/…) are stripped first. Editable — just a seed.
  function suggestNameCode(name) {
    const cleaned = (name || "").toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(LEGAL_WORDS, " ")
      .replace(/[^a-z0-9\u0E00-\u0E7F ]+/g, " ")
      .replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const words = cleaned.split(" ").filter(Boolean);
    let code = words[0].slice(0, 3);
    for (let i = 1; i < words.length && code.length < 3; i++) code += words[i][0];
    return code.toUpperCase();
  }
  // Distinct Name Codes present in the customer list, each with its companies.
  // → { KEY: { code, key, companies:[...] } }
  function nameCodeGroups(customers) {
    const map = {};
    (customers || []).forEach(c => {
      const code = nameCodeOf(c); if (!code) return;
      const key = nameCodeKey(code);
      (map[key] = map[key] || { code, key, companies: [] }).companies.push(c);
    });
    return map;
  }
  // customerId → Name Code (display) lookup map.
  function parentMapOf(customers) {
    const m = {};
    (customers || []).forEach(c => { m[c.id] = nameCodeOf(c); });
    return m;
  }
  // Existing company sharing this Business ID (TIN), if any.
  function findByBizId(bizId, customers) {
    const n = normBizId(bizId); if (!n) return null;
    return (customers || []).find(c => normBizId(c.bizId) === n) || null;
  }
  // INV numbers are numeric and globally unique. Returns the PO already using it.
  function invInUse(invNo, pos, excludeId) {
    const n = String(invNo == null ? "" : invNo).trim(); if (!n) return null;
    return (pos || []).find(p => p.id !== excludeId && String(p.invNo == null ? "" : p.invNo).trim() === n) || null;
  }
  // Distinct non-empty INV numbers across a list of POs.
  function distinctInvoices(list) {
    const s = new Set();
    (list || []).forEach(p => { const n = String(p.invNo == null ? "" : p.invNo).trim(); if (n) s.add(n); });
    return s;
  }

  // simple CSV parser (quotes + embedded newlines)
  function parseCSV(text) {
    // auto-detect delimiter from the header line (comma / semicolon / tab)
    const firstLine = (text.split(/\r?\n/)[0] || "");
    const counts = { ",": (firstLine.match(/,/g) || []).length, ";": (firstLine.match(/;/g) || []).length, "\t": (firstLine.match(/\t/g) || []).length };
    const DELIM = counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : (counts["\t"] > counts[","] ? "\t" : ",");
    const rows = []; let row = [], field = "", inQ = false;
    const isBreak = (c) => c === DELIM || c === "\n" || c === "\r" || c === undefined;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }          // escaped quote ""
          else if (isBreak(text[i + 1])) { inQ = false; }          // real closing quote
          else { field += '"'; }                                   // lenient: stray quote inside a quoted field → literal
        } else field += ch;
      } else {
        // a quote only OPENS a quoted field when it's the first non-space char of the field;
        // a stray quote in the middle of an unquoted value (e.g. 24" Co) is a literal char.
        if (ch === '"' && field.trim() === "") { inQ = true; field = ""; }
        else if (ch === DELIM) { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (ch === "\r") { }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    // Unwrap Excel's text-cell form ={"0311856851"} — what our own export writes so Excel
    // keeps leading zeros — so a re-imported export reads back as the plain value.
    const unwrap = (v) => { const m = /^="([\s\S]*)"$/.exec(String(v == null ? "" : v).trim()); return m ? m[1] : v; };
    return rows.filter(r => r.some(x => x && x.trim())).map(r => r.map(unwrap));
  }

  // Robust date parser: accepts ISO (yyyy-mm-dd), dd/mm/yyyy, mm/dd/yyyy, Excel serials.
  // Returns a Date or null (never throws). Day-first when ambiguous (VN/TH convention).
  function parseDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d.getTime()) ? null : d; }
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
      let day, mon;
      if (a > 12) { day = a; mon = b; }
      else if (b > 12) { mon = a; day = b; }
      else { day = a; mon = b; }
      const d = new Date(y, mon - 1, day); return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      if (n > 59 && n < 60000) { const d = new Date(Math.round((n - 25569) * 86400000)); return isNaN(d.getTime()) ? null : d; }
    }
    const d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function toISO(v) {
    const d = parseDate(v);
    return d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : "";
  }
  // Normalize every PO's date fields to ISO and recompute year/month so malformed imported
  // dates (e.g. "17/06/2026") don't break stats or crash date math. Keeps unparseable dates as-is.
  function normalizePOs(list) {
    return (list || []).map(p => {
      const iso = toISO(p.date || p.poDate);
      if (!iso) return p;
      return { ...p, date: iso, poDate: toISO(p.poDate) || iso, year: +iso.slice(0, 4), month: +iso.slice(5, 7) };
    });
  }

  // Auto-generated timeline entries were STORED as Vietnamese sentences before the text
  // became translatable. Recognise those shapes on the way out so an existing log reads in
  // the language the user picked, without rewriting what is already in the database.
  function logText(text, t) {
    var s = String(text == null ? "" : text), m;
    if (!s || typeof t !== "function") return s;
    if ((m = /^Tạo báo giá\s+(\S+)\s+\((.*)\)\s*$/.exec(s))) return t("log_quote_created").replace("{id}", m[1]).replace("{status}", m[2]);
    if ((m = /^Báo giá\s+(\S+)\s*→\s*(.*)$/.exec(s))) return t("log_quote_status").replace("{id}", m[1]).replace("{status}", m[2].trim());
    if ((m = /^Đã gửi mẫu\s*([^(]*?)\s*(?:\(so với\s*(.*?)\)\s*)?$/.exec(s))) return t("log_sample_sent").replace("{code}", m[1] || "") + (m[2] ? " " + t("log_sample_cmp").replace("{x}", m[2]) : "");
    if ((m = /^Kết quả mẫu\s*(\S*)\s*:\s*([^—]*?)\s*(?:—\s*(.*))?$/.exec(s))) return t("log_sample_result").replace("{code}", m[1]).replace("{status}", m[2]) + (m[3] ? " — " + m[3] : "");
    return s;
  }
  // Read a CSV or Excel file into a list of sheets, each { name, rows:[[...]] }.
  function readImportFile(file) {
    return new Promise((resolve, reject) => {
      const name = (file && file.name) || "";
      const isExcel = /\.(xlsx|xlsm|xls)$/i.test(name);
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read_failed"));
      if (isExcel) {
        if (!window.XLSX) { reject(new Error("xlsx_lib_missing")); return; }
        reader.onload = () => {
          try {
            const wb = window.XLSX.read(new Uint8Array(reader.result), { type: "array" });
            const sheets = wb.SheetNames.map(sn => {
              const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: "" });
              const rows = aoa.map(r => (r || []).map(c => (c == null ? "" : String(c))))
                .filter(r => r.some(x => x && String(x).trim()));
              return { name: sn, rows };
            }).filter(s => s.rows.length);
            resolve({ excel: true, sheets });
          } catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try { resolve({ excel: false, sheets: [{ name: "CSV", rows: parseCSV(String(reader.result)) }] }); }
          catch (e) { reject(e); }
        };
        reader.readAsText(file);
      }
    });
  }

  function findCustByName(name, list) {
    const c = (list || window.CRM_CUSTOMERS).find(x => x.name.toLowerCase().includes(name.toLowerCase()));
    return c ? c.id : null;
  }
  const SEED_LOGS = [
    { id: "L-s1", customerId: findCustByName("Dong Nai Packaging"), type: "meeting", text: "Factory visit — Amata IP, discuss wax/resin trial", when: "2026-06-16 10:00", user: "TUAN", ts: "2026-06-05 09:12" },
    { id: "L-s2", customerId: findCustByName("Quadel"), type: "meeting", text: "Quote review call with K. Add", when: "2026-06-12 14:30", user: "ICE", ts: "2026-06-04 16:40" },
    { id: "L-s3", customerId: findCustByName("SOFTTRADE COMPANY"), type: "call", outcome: "Connected", text: "Confirmed forecast 2,000–3,000 rolls; asked for updated price list.", user: "KOOK", ts: "2026-06-03 11:05" },
    { id: "L-s4", customerId: findCustByName("An Phat Barcode"), type: "note", text: "Q3 PO confirmed. Prepare contract renewal docs before July.", user: "LINH", ts: "2026-06-02 15:22" },
    { id: "L-s5", customerId: findCustByName("Markpak"), type: "call", outcome: "NoAnswer", text: "Tried K. Nawin about resin sample feedback.", user: "KOOK", ts: "2026-06-01 10:48" },
  ].filter(l => l.customerId);

  // ---- seed PO list (synthesized from real PO List structure & product codes) ----
  function po(custName, group, pic, year, month, day, product, grade, width, length, qty, amountVnd, poNumber, newRepeat, orderCount, productType) {
    const sqm = Math.round(width / 1000 * length * qty);
    return {
      customerId: findCustByName(custName), group, pic, year, month,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      productType: productType || "FR", commercial: product, grade, materialName: product,
      width, length, qty, unit: (productType === "JR" ? "Kg" : "Cuộn"), amountVnd,
      sqm, poNumber, poDate: `${year}-${String(month).padStart(2, "0")}-${String(Math.max(1, day - 2)).padStart(2, "0")}`,
      invNo: "", edpCode: "", partNumber: "", itm: "", reportCode: "", deliveryCode: "",
      newRepeat, orderCount, commissionRate: 0, commissionAmt: 0, priceList: 0, warning: "",
    };
  }
  const SEED_POS = [
    po("An Phat Barcode", "A", "LINH", 2026, 6, 5, "TDW121", "Wax", 110, 300, 800, 52800000, "PO-AP-2606", "Repeat", 7),
    po("Viet Thai Thermal", "A", "TUAN", 2026, 6, 3, "TDW108", "Wax", 110, 300, 500, 34500000, "PO-VT-2606", "Repeat", 5),
    po("Tan Binh Ribbon", "D", "TUAN", 2026, 5, 28, "TDR380", "Resin", 110, 300, 120, 32400000, "PO-TB-2605", "Repeat", 4),
    po("Saigon Label", "E", "TUAN", 2026, 5, 22, "TDM238", "Wax Resin", 90, 300, 150, 17250000, "PO-SG-2605", "New", 1),
    po("An Phat Barcode", "A", "LINH", 2026, 5, 8, "TDW121", "Wax", 110, 300, 750, 49500000, "PO-AP-2605", "Repeat", 6),
    po("Truong Phat", "E", "LINH", 2026, 6, 8, "TDW131", "Wax", 110, 300, 300, 20400000, "PO-TP-2606", "New", 1),
    po("SOFTTRADE COMPANY", "A", "KOOK", 2026, 6, 4, "TDW108", "Wax", 110, 300, 1200, 81600000, "PO-ST-2606", "Repeat", 9),
    po("MARKPAK LIMITED", "D", "KOOK", 2026, 5, 30, "TDR380", "Resin", 90, 300, 200, 47000000, "PO-MP-2605", "Repeat", 3),
    po("M D C C", "A", "KOOK", 2026, 6, 2, "TDW121", "Wax", 110, 9000, 60, 184140000, "PO-MD-2606", "Repeat", 5),
    po("QUALITY RIBBON (THAILAND) CO.,LTD.", "D", "KOOK", 2026, 4, 18, "TDW131", "Wax", 110, 300, 400, 26000000, "PO-QR-2604", "Repeat", 2),
    po("ST RIBBON CO., LTD (Head office)", "A", "NOOM", 2026, 6, 6, "TDW101", "Wax", 110, 12000, 40, 155760000, "PO-SR-2606", "Repeat", 6),
    po("Orange Intertrade Company", "B", "NOOM", 2026, 5, 15, "TDM238", "Wax Resin", 110, 300, 350, 40250000, "PO-OI-2605", "Repeat", 3),
    po("Honeywell Safety and Productivity Solutions Thailand", "B", "ICE", 2026, 5, 26, "TDR380", "Resin", 60, 300, 180, 29700000, "PO-HW-2605", "New", 1),
    po("KS 1689", "E", "ICE", 2026, 6, 9, "TDM238", "Wax Resin", 80, 300, 150, 16200000, "PO-KS-2606", "New", 1),
    // JR (Jumbo Roll) seed orders — tracked by sqm rather than rolls
    po("SOFTTRADE COMPANY", "A", "KOOK", 2026, 6, 12, "TDR345", "Resin", 1100, 4000, 1, 124000000, "PO-ST-2606-JR", "Repeat", 10, "JR"),
    po("An Phat Barcode", "A", "LINH", 2026, 6, 18, "TDW108", "Wax", 1100, 3500, 1, 92400000, "PO-AP-2606-JR", "Repeat", 8, "JR"),
  ].filter(p => p.customerId).map((p, i) => ({ id: "PO-" + String(i + 1).padStart(3, "0"), ...p }));

  // ---- seed targets: VND per sales per month ----
  const SEED_TARGETS = {
    "2026": {
      ICE: [200, 220, 240, 260, 280, 300, 300, 320, 320, 340, 340, 360].map(x => x * 1e6),
      KOOK: [400, 420, 450, 480, 500, 520, 540, 560, 560, 580, 600, 620].map(x => x * 1e6),
      NOOM: [380, 400, 420, 450, 470, 490, 500, 520, 520, 540, 560, 580].map(x => x * 1e6),
      JENNY: [120, 130, 140, 150, 160, 170, 180, 180, 190, 200, 200, 210].map(x => x * 1e6),
      MINT: [100, 110, 120, 130, 140, 150, 160, 160, 170, 180, 180, 190].map(x => x * 1e6),
      LINH: [250, 270, 290, 310, 330, 350, 360, 380, 380, 400, 420, 440].map(x => x * 1e6),
      TUAN: [220, 240, 260, 280, 300, 320, 330, 350, 350, 370, 390, 410].map(x => x * 1e6),
    },
  };

  // group-level target breakdown derived from rep targets (A..E weights)
  const GROUP_WEIGHTS = { A: 0.4, B: 0.25, C: 0.15, D: 0.1, E: 0.1 };
  const SEED_TARGET_GROUPS = {};
  Object.entries(SEED_TARGETS).forEach(([year, reps]) => {
    SEED_TARGET_GROUPS[year] = {};
    Object.entries(reps).forEach(([pic, arr]) => {
      SEED_TARGET_GROUPS[year][pic] = {};
      Object.entries(GROUP_WEIGHTS).forEach(([g, w]) => {
        SEED_TARGET_GROUPS[year][pic][g] = arr.map(v => Math.round(v * w));
      });
    });
  });

  // ---- Sales Forecast (FC vs Actual) ----
  // Canonical PIC/owner code for any raw string. Accounts are matched case-insensitively
  // on salesCode OR name (admin accounts have no sales code and are addressed by name),
  // so an imported "Ly" / "khuong" / "Thuy" resolves to the account's real code. An
  // unknown value is returned trimmed — never dropped, so nothing silently disappears.
  function canonCodeFn(users) {
    const m = {};
    const put = (k, v) => { const kk = String(k == null ? "" : k).trim().toUpperCase(); if (kk && !(kk in m)) m[kk] = v; };
    const live = (users || []).filter(u => !u._deleted);
    const dead = (users || []).filter(u => u._deleted);
    [...live, ...dead].forEach(u => {
      const code = String(u.salesCode || "").trim() || String(u.name || "").trim();
      if (!code) return;
      put(u.salesCode, code); put(u.name, code); put(u.shortName, code);
    });
    return (raw) => { const s = String(raw == null ? "" : raw).trim(); return s ? (m[s.toUpperCase()] || s) : ""; };
  }

  const FORECAST_STATUSES = ["Draft", "Submitted", "Locked"];
  const FORECAST_STATUS_COLORS = { Draft: "#94A3B8", Submitted: "#0EA5E9", Locked: "#16A34A" };

  function fc(custName, salesId, year, month, fcQtyJumboSqm, fcValueJumbo, fcQtyFinishedRolls, fcValueFinished, status) {
    return {
      customerId: findCustByName(custName), salesId,
      targetYear: year, targetMonth: month,
      fcQtyJumboSqm: fcQtyJumboSqm || 0, fcValueJumbo: fcValueJumbo || 0,
      fcQtyFinishedRolls: fcQtyFinishedRolls || 0, fcValueFinished: fcValueFinished || 0,
      status: status || "Submitted",
    };
  }
  const SEED_FORECAST = [
    // June 2026 — has matching PO actuals (for achievement tracking demo)
    fc("An Phat Barcode", "LINH", 2026, 6, 3500, 88000000, 900, 58000000, "Submitted"),
    fc("Viet Thai Thermal", "TUAN", 2026, 6, 0, 0, 600, 41000000, "Submitted"),
    fc("SOFTTRADE COMPANY", "KOOK", 2026, 6, 4000, 110000000, 1200, 82000000, "Locked"),
    fc("M D C C", "KOOK", 2026, 6, 0, 0, 60, 184000000, "Locked"),
    fc("ST RIBBON CO., LTD (Head office)", "NOOM", 2026, 6, 0, 0, 50, 190000000, "Submitted"),
    fc("KS 1689", "ICE", 2026, 6, 0, 0, 200, 22000000, "Submitted"),
    fc("Truong Phat", "LINH", 2026, 6, 0, 0, 350, 24000000, "Submitted"),
    // customers without June actuals — shows under-achievement
    fc("Tan Binh Ribbon", "TUAN", 2026, 6, 0, 0, 150, 40000000, "Submitted"),
    fc("Honeywell Safety and Productivity Solutions Thailand", "ICE", 2026, 6, 0, 0, 200, 33000000, "Submitted"),
    // May 2026 — earlier period, all Locked
    fc("Tan Binh Ribbon", "TUAN", 2026, 5, 0, 0, 110, 30000000, "Locked"),
    fc("MARKPAK LIMITED", "KOOK", 2026, 5, 0, 0, 220, 50000000, "Locked"),
    fc("An Phat Barcode", "LINH", 2026, 5, 0, 0, 700, 47000000, "Locked"),
    // July 2026 — draft, no actuals yet
    fc("An Phat Barcode", "LINH", 2026, 7, 3800, 95000000, 950, 60000000, "Draft"),
    fc("SOFTTRADE COMPANY", "KOOK", 2026, 7, 4200, 118000000, 1300, 86000000, "Draft"),
  ].filter(f => f.customerId).map((f, i) => ({ forecastId: "FC-" + String(i + 1).padStart(3, "0"), ...f }));

  window.CRM = {
    normName, canonCodeFn, normCountry, normGroup, cleanCode, baseCode, kpiCountryOf, KPI_NONE, poPricing, rollArea, findDuplicates, parseCSV, readImportFile, parseDate, toISO, normalizePOs, SB, API, RESET_FN_BASE,
    nameCodeOf, nameCodeKey, suggestNameCode, nameCodeGroups, parentMapOf, findByBizId, formatBizId, bizIdIssue, invInUse, distinctInvoices, logText,
    STATUS_TO_FUNNEL, STAGES, STAGE_KEY, STAGE_COLORS, STAGE_DEFAULT_STATUS, ALL_STATUSES,
    MODULES, MARKETS, SEED_USERS, SEED_ROLES, SEED_PROJECTS, PROJECT_STAGES, PROJECT_STAGE_COLORS, INK_TYPES,
    LS, loadJSON, saveJSON, SEED_ACTIVITY, SEED_LOGS, SEED_POS, SEED_TARGETS, SEED_TARGET_GROUPS, GROUPS, USD_RATE,
    SEED_SAMPLES, SEED_QUOTATIONS, SAMPLE_STATUSES, SAMPLE_STATUS_COLORS,
    QUOTE_STATUSES, QUOTE_STATUS_COLORS, ORDER_TYPES, DECISION_CRITERIA,
    REORDER_STATUSES, REORDER_STATUS_COLORS, REORDER_SOON_DAYS, SALES_ACTIONS, LEAD_STALE_DAYS,
    computeReorderEngine, computeRetentionEngine, computeRetentionFromStats,
    SEED_FORECAST, FORECAST_STATUSES, FORECAST_STATUS_COLORS,
    fmtVND(n) { if (!n && n !== 0) return "—"; return new Intl.NumberFormat("en-US").format(n); },
    fmtMoney(vnd, cur) {
      if (!vnd && vnd !== 0) return "—";
      const c = CURRENCIES[cur] || CURRENCIES.VND;
      const v = vnd / c.rate;
      const sym = "";   // currency symbols are not printed — the currency picker names the unit
      const neg = v < 0 ? "-" : "";
      const abs = Math.abs(v);
      const fmt = (n, d) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(n);
      if (cur === "VND" || !cur) {
        if (abs >= 1e9) return neg + fmt(abs / 1e9, 2) + " tỷ";
        if (abs >= 1e6) return neg + fmt(abs / 1e6, abs / 1e6 < 10 ? 1 : 0) + " tr";
        if (abs >= 1e3) return neg + fmt(abs / 1e3, 0) + "k";
        return neg + fmt(abs, 0);
      }
      if (cur === "USD") {
        if (abs >= 1e6) return neg + fmt(abs / 1e6, 2) + "M";
        if (abs >= 1e3) return neg + fmt(abs / 1e3, 1) + "K";
        return neg + fmt(abs, 2);
      }
      if (abs >= 1e6) return neg + fmt(abs / 1e6, 2) + "M";
      if (abs >= 1e3) return neg + fmt(abs / 1e3, 1) + "K";
      return neg + fmt(abs, abs < 100 ? 2 : 0);
    },
    fmtMoneyFull(vnd, cur) {
      if (!vnd && vnd !== 0) return "—";
      const c = CURRENCIES[cur] || CURRENCIES.VND;
      const v = vnd / c.rate;
      if (cur === "USD") return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
      const digits = cur === "VND" || !cur ? 0 : (Math.abs(v) < 100 ? 2 : 0);
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v);
    },
    CURRENCIES, currencyOf, COUNTRY_CCY, ccyOfCountry,
    // PO / line units are STORED as Vietnamese literals ("Cuộn" / "Kg") for data
    // compatibility; the UI must print them in the language the user picked, so every
    // display goes through unitLabel() instead of showing the raw field.
    unitKey(u) {
      const s = String(u || "").trim().toLowerCase();
      if (!s) return "";
      if (["cuộn", "cuon", "roll", "rolls", "ม้วน"].indexOf(s) >= 0) return "unit_roll";
      if (["kg", "kgs", "kilogram", "กก.", "กก"].indexOf(s) >= 0) return "unit_kg";
      if (["pcs", "pc", "piece", "pieces", "cái", "ชิ้น"].indexOf(s) >= 0) return "unit_pcs";
      if (["sqm", "m2", "m²", "ตร.ม."].indexOf(s) >= 0) return "unit_sqm";
      return "";
    },
    unitLabel(u, t) { const k = this.unitKey(u); return k && t ? t(k) : String(u || ""); },
    fmtNum(n) { if (!n && n !== 0) return "—"; return new Intl.NumberFormat("en-US").format(n); },
    fmtDate(s) {
      if (!s) return "—";
      const p = String(s).split("-");
      if (p.length === 3) return p[2] + "/" + p[1] + "/" + p[0];
      if (p.length === 2) return p[1] + "/" + p[0];
      return s;
    },
    daysSince(dateStr) {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return Math.floor((new Date() - d) / 86400000);
    },
    // Shared target-tracking metric: given a 12-month target array, a 12-month actual array,
    // and a 0-based selected month, returns annual/YTD/MTD target+actual + ratios.
    tgMetric(tgArr, acArr, selMonth) {
      tgArr = tgArr || []; acArr = acArr || [];
      const m = (selMonth == null ? new Date().getMonth() : selMonth);
      const sum = (arr, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += arr[i] || 0; return s; };
      const annualTarget = sum(tgArr, 0, 11);
      const ytdTarget = sum(tgArr, 0, m);
      const ytdActual = sum(acArr, 0, m);
      const mtdTarget = tgArr[m] || 0;
      const mtdActual = acArr[m] || 0;
      const prevActual = m > 0 ? (acArr[m - 1] || 0) : 0;
      const r = (a, b) => (b ? a / b : null);
      return {
        annualTarget, ytdTarget, ytdActual, mtdTarget, mtdActual, prevActual,
        lackMTD: mtdTarget - mtdActual, lackYTD: annualTarget - ytdActual,
        pctAnnual: r(ytdActual, annualTarget), pctYTD: r(ytdActual, ytdTarget), pctMTD: r(mtdActual, mtdTarget),
      };
    },
  };
})();
