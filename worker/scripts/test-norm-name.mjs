// Checks the customer-name normalisation (normName + LEGAL_WORDS) the app uses for duplicate
// matching (frontend/src/app/data.js) and that merge-duplicate-customers.mjs carries the
// very same code.   node scripts/test-norm-name.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
// LEGAL_WORDS line + normName function, whitespace-collapsed.
function extract(src, label) {
  const legal = /const LEGAL_WORDS = [^\n]+/.exec(src);
  const fn = /function normName\(s\) \{[\s\S]*?\n\s*\}\n/.exec(src);
  if (!legal || !fn) throw new Error("normName not found in " + label);
  return legal[0] + "\n" + fn[0];
}
const app = extract(read("../../frontend/src/app/data.js"), "data.js");
const script = extract(read("./merge-duplicate-customers.mjs"), "merge-duplicate-customers.mjs");
const flat = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) failed++; };
check(flat(app) === flat(script), "merge script normName is identical to the app's");

const normName = new Function(app + "\nreturn normName;")();
const same = (a, b) => check(normName(a) === normName(b), `"${a}" = "${b}"  (${normName(a)})`);
const differ = (a, b) => check(normName(a) !== normName(b), `"${a}" ≠ "${b}"  (${normName(a)} | ${normName(b)})`);
differ("CÔNG TY TNHH AN PHÁT", "CÔNG TY TNHH AN PHÚC");
// Known limit of folding: names that differ only by a diacritic share a key (the MST
// guard still keeps two companies with different MSTs apart).
same("Hộ Kinh Doanh Bảo An", "Hộ Kinh Doanh Bảo Ân");
same("Hộ Kinh Doanh DIỆP BẢO BẢO", "HỘ KINH DOANH DIỆP BẢO BẢO");
same("Hộ Kinh Doanh DIỆP BẢO BẢO", "Hộ  kinh doanh Diệp Bảo Bảo");
check(normName("CÔNG TY ĐỨC ĐẠT") === "cong ty duc dat", `Đ/đ fold to d  (${normName("CÔNG TY ĐỨC ĐẠT")})`);
// Unicode NFC vs NFD input (copy-paste from different sources) must agree.
same("Hộ Kinh Doanh DIỆP".normalize("NFC"), "Hộ Kinh Doanh DIỆP".normalize("NFD"));
same("CÔNG TY TNHH LIAN-TA-HSING (VIỆT NAM)", "Công ty TNHH Lian Ta Hsing");
same("SIAM LABEL CO., LTD", "Siam Label Company Limited");
const thai = "บริษัท สยาม ลาเบล จำกัด";
check(normName(thai) === thai, `Thai name unchanged, combining marks kept  (${normName(thai)})`);
check(normName("ห้างหุ้นส่วนจำกัด ที.พี.ปริ้นท์") === "ห้างหุ้นส่วนจำกัด ที พี ปริ้นท์", `Thai tone marks / sara am survive  (${normName("ห้างหุ้นส่วนจำกัด ที.พี.ปริ้นท์")})`);
differ("บริษัท สยาม ลาเบล จำกัด", "บริษัท สยาม ลาเบิล จำกัด");
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exitCode = failed ? 1 : 0;
