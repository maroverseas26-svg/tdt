#!/usr/bin/env python3
"""Unpack the single-file bundle (index.html exported from the design tool) into a
plain static site under public/: real .js/.jsx/.css/.woff2/.png files referenced by
path, so the code can be read, diffed, edited and deployed to Cloudflare Pages.

Usage: python3 tools/unbundle.py legacy/index.bundle.html public
"""
import base64
import gzip
import json
import os
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "legacy/index.bundle.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public"

# Bundled scripts by their header comment -> output path (load order is kept from the template).
NAMES = {
    "@license React\n * react.development.js": "vendor/react.development.js",
    "@license React\n * react-dom.development.js": "vendor/react-dom.development.js",
    "xlsx.js (C) 2013-present SheetJS": "vendor/xlsx.full.min.js",
    "window.CRM_CUSTOMERS": "js/data-customers.js",
    "window.CRM_PRODUCTS": "js/data-products.js",
    "Todaytec CRM — UI strings": "js/i18n.js",
    "Todaytec CRM — static seed data": "js/crm-core.js",
    "tweaks-panel.jsx": "src/tweaks-panel.jsx",
    "Todaytec CRM — app shell": "src/app-shell.jsx",
    "Todaytec CRM — Looker Studio-style date range": "src/date-range.jsx",
    "Todaytec CRM — Overview pivot tables": "src/overview-pivots.jsx",
    "Todaytec CRM — Overview dashboard": "src/overview.jsx",
    "Todaytec CRM — Customer list": "src/customers.jsx",
    "Todaytec CRM — Pipelines": "src/pipelines.jsx",
    "Todaytec CRM — Projects module": "src/projects.jsx",
    "Todaytec CRM — PO List tab": "src/po-list.jsx",
    "Todaytec CRM — Products tab": "src/products.jsx",
    "Todaytec CRM — Sales Targets": "src/targets.jsx",
    "Todaytec CRM — Targets: BY CUSTOMER BY ITEM": "src/targets-by-item.jsx",
    "Todaytec CRM — Accounts & Permissions": "src/admin.jsx",
    "Todaytec CRM — Samples module": "src/samples.jsx",
    "Todaytec CRM — Quotations module": "src/quotations.jsx",
    "Todaytec CRM — Sales Forecast module": "src/forecast.jsx",
    "Todaytec CRM — Customer Retention Dashboard": "src/retention.jsx",
}
EXT_NAMES = {"logoMini": "assets/logo-mini.png", "logoFull": "assets/logo-full.png"}


def block(html, kind):
    m = re.search(r'<script type="__bundler/' + kind + r'">(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None


def decode(entry):
    data = base64.b64decode(entry["data"])
    return gzip.decompress(data) if entry.get("compressed") else data


def write(rel, data):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def main():
    html = open(SRC, encoding="utf-8").read()
    manifest = block(html, "manifest")
    template = block(html, "template")
    ext = block(html, "ext_resources") or []

    paths = {}
    for e in ext:
        paths[e["uuid"]] = EXT_NAMES.get(e["id"], "assets/" + e["id"] + ".png")

    # Fonts: name each file from its @font-face block (family / weight / style / subset).
    for m in re.finditer(r"/\* ([\w-]+) \*/\s*@font-face \{(.*?)\}", template, re.S):
        subset, body = m.group(1), m.group(2)
        fam = re.search(r"font-family: '([^']+)'", body).group(1)
        weight = re.search(r"font-weight: (\d+)", body).group(1)
        style = re.search(r"font-style: (\w+)", body).group(1)
        uuid = re.search(r'url\("([0-9a-f-]{36})"\)', body).group(1)
        name = "%s-%s%s-%s.woff2" % (fam.lower().replace(" ", "-"), weight,
                                      "" if style == "normal" else "-" + style, subset)
        paths[uuid] = "fonts/" + name

    for uuid, entry in manifest.items():
        if uuid in paths:
            continue
        mime = entry["mime"]
        if "javascript" in mime:
            head = decode(entry)[:400].decode("utf-8", "replace")
            hit = next((p for k, p in NAMES.items() if k in head), None)
            if hit is None and head.startswith("!function(e,t)") and "Babel" in head:
                hit = "vendor/babel.min.js"
            paths[uuid] = hit or "js/" + uuid + ".js"
        else:
            paths[uuid] = "assets/" + uuid

    for uuid, entry in manifest.items():
        write(paths[uuid], decode(entry))

    # Split the template: font CSS and app CSS to files, inline helper scripts to a file,
    # the inline JSX entry point to src/main.jsx.
    styles = re.findall(r"<style>(.*?)</style>", template, re.S)
    write("css/fonts.css", styles[0].strip() + "\n")
    write("css/app.css", styles[1].strip() + "\n")
    template = template.replace("<style>" + styles[0] + "</style>",
                                '<link rel="stylesheet" href="/css/fonts.css">', 1)
    template = template.replace("<style>" + styles[1] + "</style>",
                                '<link rel="stylesheet" href="/css/app.css">', 1)

    helpers = re.findall(r"<script>(.*?)</script>", template, re.S)
    write("js/helpers.js", "\n".join(h.strip() for h in helpers) + "\n")
    for i, h in enumerate(helpers):
        template = template.replace("<script>" + h + "</script>",
                                    '<script src="/js/helpers.js"></script>' if i == 0 else "", 1)

    main_jsx = re.search(r'<script type="text/babel">(.*?)</script>', template, re.S).group(1)
    write("src/main.jsx", main_jsx.strip() + "\n")
    template = template.replace('<script type="text/babel">' + main_jsx + "</script>",
                                '<script type="text/babel" src="/src/main.jsx"></script>', 1)

    # Rewrite uuid references to real paths; drop SRI attributes (files are self-hosted now).
    for uuid, rel in paths.items():
        template = template.replace(uuid, "/" + rel)
    for rel in ("fonts.css",):
        css_path = os.path.join(OUT, "css", rel)
        css = open(css_path, encoding="utf-8").read()
        for uuid, p in paths.items():
            css = css.replace(uuid, "/" + p)
        write("css/" + rel, css)
    template = re.sub(r'\s+integrity="[^"]*"', "", template)
    template = re.sub(r'\s+crossorigin="[^"]*"', "", template)

    # The bundle runtime exposed ext resources as window.__resources; keep that contract.
    res = {e["id"]: "/" + paths[e["uuid"]] for e in ext}
    template = re.sub(r"(<head[^>]*>)",
                      lambda m: m.group(1) + "\n<script>window.__resources = " + json.dumps(res) + ";</script>",
                      template, count=1)
    write("index.html", template)

    for uuid, rel in sorted(paths.items(), key=lambda x: x[1]):
        print(rel)


if __name__ == "__main__":
    main()
