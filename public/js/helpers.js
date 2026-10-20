window.exportCSV = function (name, rows) {
  if (!rows || !rows.length) { alert("No data to export"); return; }
  var cols = Object.keys(rows[0]);
  // Digit strings that Excel would mangle — business IDs (leading zero dropped) and long
  // numbers (shown as 3.7E+09) — are written as text cells so they survive a round trip.
  var esc = function (v) {
    v = v == null ? "" : String(v);
    if (/^0\d+$/.test(v) || /^\d{10,}$/.test(v)) return '="' + v + '"';
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var csv = [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(","); })).join("\n");
  var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".csv"; a.click();
};
// Download a blank import template: headers row + example rows (arrays of strings).
window.downloadCSVTemplate = function (name, headers, exampleRows) {
  var esc = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [headers.map(esc).join(",")].concat((exampleRows || []).map(function (r) { return r.map(esc).join(","); }));
  var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + "-template.csv"; a.click();
};
window.crmConfirm = function (msg, onYes) {
  var ov = document.createElement('div'); ov.className = 'crm-confirm-ov';
  ov.innerHTML = '<div class="crm-confirm"><p></p><div class="crm-confirm-btns"><button class="btn btn-ghost" data-x></button><button class="btn btn-danger" data-y></button></div></div>';
  ov.querySelector('p').textContent = msg;
  var dict = (window.I18N && window.I18N[(function(){try{return JSON.parse(localStorage.getItem('ttcrm_lang_v1'))||'en'}catch(e){return 'en'}})()]) || {};
  ov.querySelector('[data-x]').textContent = dict.cancel || 'Cancel';
  ov.querySelector('[data-y]').textContent = dict.pd_delete || 'Delete';
  var close = function () { ov.remove(); };
  ov.querySelector('[data-x]').onclick = close;
  ov.querySelector('[data-y]').onclick = function () { close(); try { onYes && onYes(); } catch (e) {} };
  ov.onclick = function (e) { if (e.target === ov) close(); };
  document.body.appendChild(ov);
};
