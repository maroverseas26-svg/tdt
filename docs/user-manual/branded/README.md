# Branded sales user manual

`build-branded.mjs` turns the Markdown sections (`../00-…11-*.md`) and screenshots (`../img/`) into
a Todaytec-branded A4 manual, following the Visual Identity 2024 guide (`天地数码Visual ldentity2024 (1).pdf`).

```sh
NODE_PATH=$(npm root -g) node docs/user-manual/branded/build-branded.mjs
# optional: MANUAL_VERSION=1.1 MANUAL_DATE="November 2026" NODE_PATH=… node …
```

Run it again whenever a section or screenshot changes. It writes:

- `Todaytec-CRM-Sales-User-Manual.html`: self-contained, already paginated (fonts, logo and images embedded)
- `Todaytec-CRM-Sales-User-Manual.pdf`: A4, printed from that HTML (TOC page numbers, bookmarks, links)
- `preview/*.png`: cover, contents, a section page (steps + screenshot), a tips callout page

Section titles come from the image table in `../README.md`. Inside the Markdown: `### ` headings,
numbered lists (step blocks), bullet lists, `![caption](img/x.png)` (Figure n — caption, shown at most
at 0.75× native pixels), tables, `**Tips**` followed by a list (callout), and a paragraph that is all bold
(FAQ question). Other `**bold**` text is a UI label and is styled like a key.

## Brand rules applied

- Colours: Todaytec Blue `#062741` (PANTONE 289 C), Todaytec Green `#0c938e` (PANTONE 7716 C);
  secondary white, light grey `#efefef`, dark grey `#7d7d7d`, black `#090909`.
- Logo: vector paths taken from the guide (`assets/logo*.svg`, `assets/e-symbol.svg`); top-right of each
  page; reverse version (white wordmark, green “E”) on Todaytec Blue. On the cover, logo width = page
  diagonal ÷ 9 (40.4 mm) with the margin = logo height (12 mm); clear space ≥ height of the “T”;
  never under 8 mm / 72 px wide.
- Graphic: the “E” symbol and the thin-outline ring from the guide’s graphics chapter.
- Type: Roboto (the guide’s English brand font) 300/400/500/700, Noto Sans Thai for Thai; Chinese falls
  back to Source Han Sans / Noto Sans SC / PingFang / Microsoft YaHei, then Arial / Helvetica as the guide allows.
- Back cover: logo + English full-name lock-up and www.todaytec.com, as on the guide’s brochure and bag.

Fonts in `fonts/` are static WOFF2 files from Fontsource (SIL Open Font License).
