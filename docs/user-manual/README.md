# Todaytec CRM — user manual for sales (source)

One Markdown file per section (`00-…` to `11-…`), written for salespeople. The files have no
title line: each section heading is added when the manual is assembled. Screenshots are in
`img/`, taken from a local demo build with fictional data.

## Images

| File | Section | Caption |
|---|---|---|
| `img/login.png` | 00 Getting started | Sign-in screen with the **Sign in** button and **Forgot password?** link |
| `img/topbar.png` | 00 Getting started | Top bar: date range on the left; country, language and profile on the right |
| `img/date-range.png` | 00 Getting started | Date range picker on **This month**, with the **Apply** button |
| `img/overview-kpis.png` | 01 Overview | Overview counters: customers, pipeline, projects, samples, quotations, PO conversion |
| `img/customers-toolbar.png` | 02 Customers | Customer list toolbar: search box and **Group by Name Code** |
| `img/customer-add-duplicate.png` | 02 Customers | **Add customer** form showing the **Possible duplicates** warning |
| `img/customer-profile.png` | 02 Customers | Customer profile with the **Update status** dropdown |
| `img/pipelines-board.png` | 03 Pipelines | Pipelines board with the **Board / List** switch and a project card |
| `img/project-new.png` | 04 Projects | **New Project** form: **Customer** and **Project name** |
| `img/project-stage.png` | 04 Projects | Project detail: project code (e.g. VN261013-01) and the **Stage** dropdown |
| `img/samples-list.png` | 05 Samples | Samples list with **New sample** and a test status |
| `img/sample-feedback.png` | 05 Samples | **Test status** card with **Save & link project** |
| `img/quotation-detail.png` | 06 Quotations | Quotation detail: **Status** dropdown and **Send quotation** |
| `img/send-quotation-seller.png` | 06 Quotations | **Send quotation**: file format, **Download**, **Email to …** and the first-time seller company setup |
| `img/send-quotation-currency.png` | 06 Quotations | **Currency** section: **Show USD column** checkbox and **Quote currency** |
| `img/send-quotation-actions.png` | 06 Quotations | **Excel + PDF** download links under the buttons, next to **Email to …** |
| `img/po-list.png` | 07 PO List | PO List with **New PO** and one customer row opened |
| `img/po-from-quote.png` | 07 PO List | Quotation set to **Won**, with **Create PO from this quote** → **New PO** |
| `img/po-new-form.png` | 07 PO List | **New PO** form prefilled from a two-line quote, with **Quotation reference** |
| `img/retention.png` | 08 Retention | Retention dashboard: health filter and one customer opened |
| `img/targets.png` | 09 Targets & Forecast | **Sales Targets (KPI)** with the **Input by PIC / By customer / Tracking** tabs |
| `img/forecast.png` | 09 Targets & Forecast | **Sales Forecast**: a forecast cell and the **Status** dropdown |
| `img/products.png` | 10 Products | Products list: search box and a product opened to its variant |
| `img/permissions-matrix.png` | 11 Access & FAQ | Permissions page (admin view): legend of the access levels above the **View / Edit / Admin** matrix |

## Refreshing the screenshots

Local only — never against the deployed Worker or its D1.

```sh
cd worker
npm install
npx wrangler d1 migrations apply tdt --local
npm run build
npx wrangler dev --local                      # leave running
node ../docs/user-manual/tools/seed-demo.mjs  # resets the LOCAL D1 and loads fictional demo data
cd .. && NODE_PATH=$(npm root -g) node docs/user-manual/tools/capture.mjs   # optional: shot names
```

- `tools/seed-demo.mjs` creates the demo accounts (`sales.demo@example.com`, Sales Executive with
  **Edit** on every team module; `admin.demo@example.com`, BOD, used only for the Permissions shot;
  password `demo1234`, local only; `nam.demo@example.com` has Admin on Quotations, for tests) and about 15 fictional customers with POs, projects, samples,
  quotations, a price list, contact logs, forecast and targets, all dated relative to today.
- `tools/capture.mjs` signs in, outlines the elements each step talks about in red, crops each
  shot at 1440×900 and keeps every PNG under 250 KB. It answers `/api/quotes/send` itself, so no
  email is sent. Run the seed again before each full capture: the capture saves the Thailand
  seller company, sets one quotation to Won and changes one forecast status.
