// Copies the bundled CRM frontend (repo-root index.html) into ./dist, where src/index.js imports it.
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
copyFileSync(join(root, "..", "index.html"), join(dist, "index.html"));
console.log("dist/index.html ready");
