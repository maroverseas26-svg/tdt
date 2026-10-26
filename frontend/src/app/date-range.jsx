// Todaytec CRM — Looker Studio-style date range filter: preset list + 2-month calendar
// + an optional comparison range. One control replaces every pair of loose date inputs, so
// "last 30 days vs previous period" reads the same on every tab.
const DRC = window.CRM;
const DR_L = {
  en: { range: "Date range", cmp: "Compare to", none: "None", prev: "Previous period", prevYear: "Previous year", fixed: "Custom", apply: "Apply", cancel: "Cancel", start: "Start date", end: "End date", vs: "vs",
    all: "All time", today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last14: "Last 14 days", last28: "Last 28 days", last30: "Last 30 days", thisWeek: "This week", lastWeek: "Last week", thisMonth: "This month", mtd: "Month to date", lastMonth: "Last month", thisQuarter: "This quarter", qtd: "Quarter to date", lastQuarter: "Last quarter", thisYear: "This year", ytd: "Year to date", lastYear: "Last year", custom: "Custom", wd: ["M", "T", "W", "T", "F", "S", "S"] },
  vi: { range: "Khoảng ngày", cmp: "So sánh với", none: "Không", prev: "Kỳ trước", prevYear: "Cùng kỳ năm trước", fixed: "Tùy chọn", apply: "Áp dụng", cancel: "Hủy", start: "Từ ngày", end: "Đến ngày", vs: "so với",
    all: "Toàn bộ", today: "Hôm nay", yesterday: "Hôm qua", last7: "7 ngày qua", last14: "14 ngày qua", last28: "28 ngày qua", last30: "30 ngày qua", thisWeek: "Tuần này", lastWeek: "Tuần trước", thisMonth: "Tháng này", mtd: "Từ đầu tháng", lastMonth: "Tháng trước", thisQuarter: "Quý này", qtd: "Từ đầu quý", lastQuarter: "Quý trước", thisYear: "Năm nay", ytd: "Từ đầu năm", lastYear: "Năm trước", custom: "Tùy chọn", wd: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] },
  th: { range: "ช่วงวันที่", cmp: "เปรียบเทียบกับ", none: "ไม่มี", prev: "ช่วงก่อนหน้า", prevYear: "ปีก่อนหน้า", fixed: "กำหนดเอง", apply: "ใช้งาน", cancel: "ยกเลิก", start: "วันเริ่ม", end: "วันสิ้นสุด", vs: "เทียบกับ",
    all: "ทั้งหมด", today: "วันนี้", yesterday: "เมื่อวาน", last7: "7 วันล่าสุด", last14: "14 วันล่าสุด", last28: "28 วันล่าสุด", last30: "30 วันล่าสุด", thisWeek: "สัปดาห์นี้", lastWeek: "สัปดาห์ที่แล้ว", thisMonth: "เดือนนี้", mtd: "ตั้งแต่ต้นเดือน", lastMonth: "เดือนที่แล้ว", thisQuarter: "ไตรมาสนี้", qtd: "ตั้งแต่ต้นไตรมาส", lastQuarter: "ไตรมาสที่แล้ว", thisYear: "ปีนี้", ytd: "ตั้งแต่ต้นปี", lastYear: "ปีที่แล้ว", custom: "กำหนดเอง", wd: ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"] },
};
const drT = (lang, k) => (DR_L[lang] || DR_L.en)[k] || DR_L.en[k] || k;
const drISO = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const drParse = (s) => { const a = String(s || "").split("-"); return a.length === 3 && a[0].length === 4 ? new Date(+a[0], +a[1] - 1, +a[2]) : null; };
const drAdd = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const drSOW = (d) => drAdd(d, -((d.getDay() + 6) % 7));           // week starts Monday
const drSOM = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const drEOM = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const drSOQ = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const drEOQ = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
const DR_PRESETS = ["all", "today", "yesterday", "last7", "last14", "last28", "last30", "thisWeek", "lastWeek", "thisMonth", "mtd", "lastMonth", "thisQuarter", "qtd", "lastQuarter", "thisYear", "ytd", "lastYear", "custom"];

// preset → {from,to}. "Last N days" ends yesterday, as in Looker Studio.
function drPresetRange(preset, v) {
  const n = new Date(); const T = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const mk = (a, b) => ({ from: drISO(a), to: drISO(b) });
  const lastN = (k) => mk(drAdd(T, -k), drAdd(T, -1));
  switch (preset) {
    case "today": return mk(T, T);
    case "yesterday": { const y = drAdd(T, -1); return mk(y, y); }
    case "last7": return lastN(7);
    case "last14": return lastN(14);
    case "last28": return lastN(28);
    case "last30": return lastN(30);
    case "thisWeek": return mk(drSOW(T), T);
    case "lastWeek": { const s = drAdd(drSOW(T), -7); return mk(s, drAdd(s, 6)); }
    case "thisMonth": return mk(drSOM(T), drEOM(T));
    case "mtd": return mk(drSOM(T), T);
    case "lastMonth": { const s = new Date(T.getFullYear(), T.getMonth() - 1, 1); return mk(s, drEOM(s)); }
    case "thisQuarter": return mk(drSOQ(T), drEOQ(T));
    case "qtd": return mk(drSOQ(T), T);
    case "lastQuarter": { const s = new Date(T.getFullYear(), drSOQ(T).getMonth() - 3, 1); return mk(s, drEOQ(s)); }
    case "thisYear": return mk(new Date(T.getFullYear(), 0, 1), new Date(T.getFullYear(), 11, 31));
    case "ytd": return mk(new Date(T.getFullYear(), 0, 1), T);
    case "lastYear": return mk(new Date(T.getFullYear() - 1, 0, 1), new Date(T.getFullYear() - 1, 11, 31));
    case "custom": return { from: (v && v.from) || "", to: (v && v.to) || "" };
    default: return { from: "", to: "" };
  }
}
// {preset,from,to,cmp,cmpFrom,cmpTo} → resolved {from,to,cmp,cmpFrom,cmpTo,hasCmp}
function drResolve(v) {
  const val = v || {};
  const r = drPresetRange(val.preset || "all", val);
  const cmp = val.cmp || "none";
  let cf = "", ct = "";
  if (cmp === "fixed") { cf = val.cmpFrom || ""; ct = val.cmpTo || ""; }
  else if (cmp !== "none" && r.from && r.to) {
    const a = drParse(r.from), b = drParse(r.to);
    if (a && b) {
      if (cmp === "prevYear") { cf = drISO(new Date(a.getFullYear() - 1, a.getMonth(), a.getDate())); ct = drISO(new Date(b.getFullYear() - 1, b.getMonth(), b.getDate())); }
      else { const len = Math.round((b - a) / 86400000) + 1; const end = drAdd(a, -1); cf = drISO(drAdd(end, -(len - 1))); ct = drISO(end); }
    }
  }
  return { from: r.from, to: r.to, cmp, cmpFrom: cf, cmpTo: ct, hasCmp: cmp !== "none" && !!(cf && ct) };
}
const drFmt = (s) => s ? DRC.fmtDate(s) : "";
function drLabel(v, lang) {
  const val = v || {}; const p = val.preset || "all";
  if (p === "all") return drT(lang, "all");
  const r = drPresetRange(p, val);
  if (!r.from && !r.to) return drT(lang, "all");
  const dates = drFmt(r.from) + " – " + drFmt(r.to);
  return p === "custom" ? dates : drT(lang, p) + " · " + dates;
}
// Persisted per page (localStorage), so a rep's chosen window survives a reload.
function useDateRange(key, init) {
  const LS = "ttcrm_dr_" + key;
  const [v, setV] = React.useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS)); if (s && typeof s === "object" && s.preset) return s; } catch (e) { }
    return Object.assign({ preset: "all", from: "", to: "", cmp: "none", cmpFrom: "", cmpTo: "" }, init || {});
  });
  const set = (nv) => { setV(nv); try { localStorage.setItem(LS, JSON.stringify(nv)); } catch (e) { } };
  return [v, set, drResolve(v)];
}

if (!document.getElementById("dr-css")) {
  const _s = document.createElement("style"); _s.id = "dr-css";
  _s.textContent = `.dr-wrap{position:relative;display:inline-flex}
.dr-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:7px 12px;font:500 13px/1.25 inherit;color:#0f172a;cursor:pointer}
.dr-btn:hover{border-color:#0f766e}
.dr-btn .dr-ico{color:#0f766e;flex:none}
.dr-btn small{display:block;color:#94a3b8;font-weight:500;font-size:11px;margin-top:2px}
.dr-btn .dr-cap{text-align:left}
.dr-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:80;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.16);padding:14px;display:flex;gap:14px;width:600px;max-width:calc(100vw - 24px)}
.dr-pop.dr-right{left:auto;right:0}
.dr-pop{max-width:calc(100vw - 24px);max-height:calc(100vh - 90px);overflow:auto}
.dr-presets{flex:0 0 170px;max-height:330px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding-right:6px;border-right:1px solid #f1f5f9}
.dr-preset{text-align:left;background:none;border:0;border-radius:8px;padding:6px 9px;font:500 12.5px/1.3 inherit;color:#334155;cursor:pointer}
.dr-preset:hover{background:#f1f5f9}
.dr-preset.on{background:#0f766e;color:#fff}
.dr-main{display:flex;flex-direction:column;gap:10px;flex:1}
.dr-cals{display:flex;gap:16px}
.dr-cal{flex:1 1 0;min-width:0}
.dr-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.dr-cal-title{font:600 12.5px/1 inherit;color:#0f172a}
.dr-nav{background:none;border:0;color:#64748b;cursor:pointer;padding:2px 6px;border-radius:6px;font-size:13px}
.dr-nav:hover{background:#f1f5f9;color:#0f766e}
.dr-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}
.dr-wd{text-align:center;font:600 9.5px/1 inherit;color:#94a3b8;padding:4px 0;text-transform:uppercase}
.dr-day{border:0;background:none;padding:5px 0;font:500 11.5px/1 inherit;color:#334155;cursor:pointer;border-radius:6px}
.dr-day:hover{background:#e6f4f1}
.dr-day.dim{color:#cbd5e1}
.dr-day.in{background:#e6f4f1;border-radius:0}
.dr-day.edge{background:#0f766e;color:#fff}
.dr-day.today{box-shadow:inset 0 0 0 1px #0f766e}
.dr-fields{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dr-fields label{font:500 11px/1 inherit;color:#64748b;display:flex;flex-direction:column;gap:4px}
.dr-fields input,.dr-fields select{border:1px solid #e2e8f0;border-radius:8px;padding:5px 8px;font:500 12px/1.2 inherit;color:#0f172a;background:#fff}
.dr-cmp{border-top:1px solid #f1f5f9;padding-top:10px;display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}
.dr-cmp-hint{font:500 11px/1.3 inherit;color:#94a3b8;margin-left:auto;text-align:right}
.dr-acts{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #f1f5f9;padding-top:10px}
.dr-acts button{border-radius:8px;padding:6px 14px;font:600 12.5px/1 inherit;cursor:pointer}
.dr-cancel{background:#fff;border:1px solid #e2e8f0;color:#475569}
.dr-apply{background:#0f766e;border:1px solid #0f766e;color:#fff}
.dr-cmpbar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#f8fafc;border:1px solid #eef2f6;border-radius:10px;padding:8px 14px;margin:0 0 12px}
.dr-cmpbar .dr-cb-lbl{font:600 10.5px/1 inherit;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
.dr-cb-m{display:flex;flex-direction:column;gap:2px}
.dr-cb-m span{font:500 10.5px/1 inherit;color:#94a3b8;text-transform:uppercase;letter-spacing:.03em}
.dr-cb-m strong{font:700 14px/1.15 inherit;color:#0f172a}
.dr-cb-m em{font-style:normal;font:500 11px/1.2 inherit;color:#64748b}
.dr-d{font:600 11.5px/1 inherit;padding:2px 6px;border-radius:6px;margin-left:6px}
.dr-up{background:#e7f6ef;color:#0f766e}.dr-down{background:#fdeaea;color:#b91c1c}.dr-flat{background:#f1f5f9;color:#64748b}`;
  document.head.appendChild(_s);
}

function DrCal({ month, from, to, onPick, onNav, navLeft, navRight, lang }) {
  const first = drSOM(month), start = drSOW(first);
  const a = drParse(from), b = drParse(to);
  const today = drISO(new Date());
  const cells = []; for (let i = 0; i < 42; i++) cells.push(drAdd(start, i));
  const title = month.toLocaleDateString(lang === "vi" ? "vi-VN" : lang === "th" ? "th-TH" : "en-GB", { month: "long", year: "numeric" });
  return (
    <div className="dr-cal">
      <div className="dr-cal-head">
        {navLeft ? <button className="dr-nav" onClick={() => onNav(-1)}>‹</button> : <span />}
        <span className="dr-cal-title">{title}</span>
        {navRight ? <button className="dr-nav" onClick={() => onNav(1)}>›</button> : <span />}
      </div>
      <div className="dr-grid">
        {drT(lang, "wd").map((w, i) => <div className="dr-wd" key={i}>{w}</div>)}
        {cells.map((d, i) => {
          const iso = drISO(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isEdge = (a && iso === from) || (b && iso === to);
          const inRange = a && b && d >= a && d <= b;
          return <button key={i} className={"dr-day" + (inMonth ? "" : " dim") + (inRange ? " in" : "") + (isEdge ? " edge" : "") + (iso === today ? " today" : "")}
            onClick={() => onPick(iso)}>{d.getDate()}</button>;
        })}
      </div>
    </div>
  );
}

function DateRangeFilter({ value, onChange, label, align, compare = true }) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || { preset: "all" });
  const [pick, setPick] = useState("from");
  const [calM, setCalM] = useState(() => drSOM(new Date()));
  const wrap = React.useRef(null);
  const pop = React.useRef(null);
  // Keep the panel inside the viewport: a trigger sitting in the top-right corner would
  // otherwise open a 700px panel off the right edge. Nudge it back after it mounts.
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = pop.current; if (!el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.right > vw - 12) dx = (vw - 12) - r.right;
    if (r.left + dx < 12) dx = 12 - r.left;
    if (dx) el.style.transform = "translateX(" + Math.round(dx) + "px)";
  }, [open]);
  React.useEffect(() => { if (open) { setDraft(value || { preset: "all" }); setPick("from"); const r = drPresetRange((value || {}).preset || "all", value); const f = drParse(r.from); setCalM(drSOM(f || new Date())); } }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const dR = drPresetRange(draft.preset || "all", draft);
  const set = (patch) => setDraft(d => Object.assign({}, d, patch));
  const pickDay = (iso) => {
    if (pick === "from" || !dR.from || iso < dR.from) { set({ preset: "custom", from: iso, to: "" }); setPick("to"); }
    else { set({ preset: "custom", from: dR.from, to: iso }); setPick("from"); }
  };
  const res = drResolve(value);
  const cmpTxt = res.hasCmp ? drT(lang, "vs") + " " + drFmt(res.cmpFrom) + " – " + drFmt(res.cmpTo) : "";
  const dDraft = drResolve(draft);
  return (
    <div className="dr-wrap" ref={wrap}>
      <button className="dr-btn" onClick={() => setOpen(o => !o)}>
        <svg className="dr-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>
        <span className="dr-cap">{label ? label + ": " : ""}{drLabel(value, lang)}{cmpTxt ? <small>{cmpTxt}</small> : null}</span>
        <span style={{ color: "#94a3b8" }}>▾</span>
      </button>
      {open && (
        <div className={"dr-pop" + (align === "right" ? " dr-right" : "")} ref={pop}>
          <div className="dr-presets">
            {DR_PRESETS.map(p => (
              <button key={p} className={"dr-preset" + ((draft.preset || "all") === p ? " on" : "")}
                onClick={() => { set({ preset: p }); if (p !== "custom") { const r = drPresetRange(p, draft); const f = drParse(r.from); if (f) setCalM(drSOM(f)); } }}>{drT(lang, p)}</button>
            ))}
          </div>
          <div className="dr-main">
            <div className="dr-cals">
              <DrCal month={calM} from={dR.from} to={dR.to} onPick={pickDay} onNav={(n) => setCalM(m => new Date(m.getFullYear(), m.getMonth() + n, 1))} navLeft lang={lang} />
              <DrCal month={new Date(calM.getFullYear(), calM.getMonth() + 1, 1)} from={dR.from} to={dR.to} onPick={pickDay} onNav={(n) => setCalM(m => new Date(m.getFullYear(), m.getMonth() + n, 1))} navRight lang={lang} />
            </div>
            <div className="dr-fields">
              <label>{drT(lang, "start")}<input type="date" value={dR.from} onChange={e => { set({ preset: "custom", from: e.target.value, to: dR.to }); }} /></label>
              <span style={{ color: "#94a3b8", alignSelf: "flex-end", padding: "0 2px 6px" }}>→</span>
              <label>{drT(lang, "end")}<input type="date" value={dR.to} onChange={e => { set({ preset: "custom", from: dR.from, to: e.target.value }); }} /></label>
            </div>
            {compare && (
              <div className="dr-cmp">
                <label style={{ font: "500 11px/1 inherit", color: "#64748b", display: "flex", flexDirection: "column", gap: 4 }}>{drT(lang, "cmp")}
                  <select value={draft.cmp || "none"} onChange={e => set({ cmp: e.target.value })}>
                    {["none", "prev", "prevYear", "fixed"].map(c => <option key={c} value={c}>{drT(lang, c === "prev" ? "prev" : c === "prevYear" ? "prevYear" : c === "fixed" ? "fixed" : "none")}</option>)}
                  </select>
                </label>
                {draft.cmp === "fixed" && (
                  <React.Fragment>
                    <label>{drT(lang, "start")}<input type="date" value={draft.cmpFrom || ""} onChange={e => set({ cmpFrom: e.target.value })} /></label>
                    <label>{drT(lang, "end")}<input type="date" value={draft.cmpTo || ""} onChange={e => set({ cmpTo: e.target.value })} /></label>
                  </React.Fragment>
                )}
                {dDraft.hasCmp && <span className="dr-cmp-hint">{drFmt(dDraft.cmpFrom)} – {drFmt(dDraft.cmpTo)}</span>}
              </div>
            )}
            <div className="dr-acts">
              <button className="dr-cancel" onClick={() => setOpen(false)}>{drT(lang, "cancel")}</button>
              <button className="dr-apply" onClick={() => { onChange(draft); setOpen(false); }}>{drT(lang, "apply")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Comparison strip: current vs comparison window for a handful of metrics.
// metrics: [{ label, cur, prev, fmt }]
function DrCompareBar({ range, metrics }) {
  const { lang } = useApp();
  if (!range || !range.hasCmp) return null;
  const delta = (cur, prev) => {
    if (!prev) return { txt: cur ? "▲ new" : "—", cls: cur ? "dr-up" : "dr-flat" };
    const d = Math.round((cur - prev) / Math.abs(prev) * 100);
    return { txt: (d > 0 ? "▲ +" : d < 0 ? "▼ " : "") + d + "%", cls: d > 0 ? "dr-up" : d < 0 ? "dr-down" : "dr-flat" };
  };
  return (
    <div className="dr-cmpbar">
      <span className="dr-cb-lbl">{drT(lang, "vs")} {drFmt(range.cmpFrom)} – {drFmt(range.cmpTo)}</span>
      {(metrics || []).map((m, i) => {
        const f = m.fmt || (v => DRC.fmtNum(v));
        const d = delta(m.cur, m.prev);
        return (
          <div className="dr-cb-m" key={i}>
            <span>{m.label}</span>
            <strong>{f(m.cur)}<em className={"dr-d " + d.cls}>{d.txt}</em></strong>
            <em>{f(m.prev)}</em>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { DateRangeFilter, DrCompareBar, useDateRange, drResolve, drLabel, drPresetRange, DR_PRESETS });
