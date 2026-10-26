# Todaytec CRM frontend — sources

`index.html` at the repo root is a generated single-file bundle (served by Netlify and
by the Cloudflare Worker in `worker/`). Edit the files here, then rebuild it:

```sh
node frontend/build.mjs
```

- `src/index.template.html` — page shell, CSS and the root `<App>` / routing script
- `src/app/*.jsx|js` — app modules (Babel-transformed in the browser, loaded in the
  order the template lists them); `src/vendor/` — React, ReactDOM, Babel, SheetJS
- `bundle.json` — asset list (uuid → file, mime, gzip flag); the template references
  assets by uuid, the loader in `loader.html` swaps those for blob URLs at runtime
