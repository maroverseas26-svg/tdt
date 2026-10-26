// Rebuilds the single-file CRM bundle (repo-root index.html, served by Netlify and the
// Cloudflare Worker) from frontend/src. Edit the sources, then: node frontend/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "src");
const { assets, ext_resources, page_order } = JSON.parse(readFileSync(join(here, "bundle.json"), "utf8"));

const manifest = {};
for (const a of assets) {
  let bytes = readFileSync(join(src, a.file));
  if (a.compressed) bytes = gzipSync(bytes, { level: 9 });
  manifest[a.uuid] = { mime: a.mime, compressed: a.compressed, data: bytes.toString("base64") };
}
// "</" inside a JSON island would close the <script> tag early.
const island = (v) => JSON.stringify(v).replace(/<\//g, "<\\u002F");
const template = readFileSync(join(src, "index.template.html"), "utf8");

const html = readFileSync(join(here, "loader.html"), "utf8") +
  `  <script type="__bundler/manifest">\n${island(manifest)}\n  </script>\n\n` +
  `  <script type="__bundler/ext_resources">\n${island(ext_resources)}\n  </script>\n\n` +
  `  <script type="__bundler/page_order">\n${island(page_order)}\n  </script>\n\n` +
  `  <script type="__bundler/template">\n${island(template)}\n  </script>\n</body>\n</html>`;
writeFileSync(join(here, "..", "index.html"), html);
console.log(`index.html rebuilt: ${assets.length} assets, ${(html.length / 1024 / 1024).toFixed(2)} MB`);
