# Factorio Calculator + Blueprints

A minimal, black & mint-green Factorio production calculator with a built-in
**Blueprints** library. The calculator (Factory / Visualize / Resources /
Settings tabs) is a restyled fork of [Kirk McDonald's calculator][upstream]; the
**Blueprints** tab and its editor are new.

The whole site is **static** — it deploys to GitHub Pages (or any static host)
with no backend. A small Node script is used *only locally* to author blueprint
content.

## Tabs

- **Factory / Visualize / Resources / Settings** — the production calculator
  (base vanilla Factorio 2.0 data).
- **Blueprints** — a gallery of builds. Each opens a wiki-style article with an
  embedded build video, screenshots, an optional copy-able blueprint string, and
  a Markdown write-up.
- **Credits** — attribution and a changelog of fixes/cleanup.

## Project layout

```
index.html              Entry point (all tabs live here)
calc.css / dropdown.css Calculator styles (restyled)
blueprints.css          Blueprints + Credits styles
blueprints.js           Blueprints gallery, article view, and dev-only editor UI
*.js                    Calculator engine (recipe solver, graphs, etc.)
third_party/            Vendored libraries (d3, dagre, BigInteger, pako, popper,
                        marked, DOMPurify)
data/                   Game data (vanilla-2.0.55.json) + icon sprite sheet
content/blueprints/     Your blueprint content (committed, served read-only)
tools/editor-server.js  Local-only dev server + content editor API (never shipped)
.nojekyll               Tells GitHub Pages to serve files as-is
```

## Run it locally (with the editor)

The Blueprints **editor only runs locally**. `tools/editor-server.js` is a tiny
Node server (built-ins only — **no `npm install` needed**) that serves the site
*and* saves blueprint content into `content/blueprints/`.

```bash
npm run editor          # or:  node tools/editor-server.js
# then open http://localhost:8080
```

On `localhost`, a **+ New blueprint** button and per-article **Edit / Delete**
controls appear. Use them to:

1. Write the article (title, category, tags, video URL, blueprint string, body).
2. Drag in screenshots; click ☆ to choose the gallery thumbnail.
3. **Save** — writes `content/blueprints/<slug>/article.json`, images under
   `content/blueprints/<slug>/images/`, and updates
   `content/blueprints/index.json`.

To preview the **read-only (production)** experience locally, serve the folder
with any plain static server instead, e.g. `npx serve .` — the editor controls
won't appear because there is no `/api` to answer them.

## Publish to GitHub Pages

The site is 100% static, so publishing is just pushing the files and turning
Pages on.

**1. Create the repository and push:**

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

(Or use GitHub's web **“Add file → Upload files”** and drag everything in. The
`.git` and `.claude` folders are not needed for that path.)

**2. Enable Pages:** in the repo, go to **Settings → Pages → Build and
deployment**, set **Source = Deploy from a branch**, **Branch = `main` / `/
(root)`**, and Save. After a minute your site is live at
`https://<you>.github.io/<repo>/`.

**3. Add/change blueprints later:** run the editor locally, make your edits, then
commit and push the `content/blueprints/` changes — Pages redeploys
automatically.

```bash
git add content/blueprints
git commit -m "Add blueprint: <name>"
git push
```

There is **no server in production**, so the `/api/*` endpoints don't exist and
the Blueprints library is **read-only** for visitors — by design.

## Security

This is a static site with a deliberately small attack surface:

- Blueprint Markdown is rendered through **DOMPurify**, so even if a malicious
  snippet were ever pasted into an article it cannot inject scripts.
- Video/links are restricted to `http(s)`; the deep-link slug is sanitized.
- A **Content-Security-Policy** restricts framing to YouTube/Vimeo and blocks
  plugins/objects.
- The editor server binds to **127.0.0.1** only and is never deployed.

## Game data

Only base vanilla Factorio 2.0 (`data/vanilla-2.0.55.json`) ships, and the
data-set switcher is hidden. To regenerate/extend the data, see `dump.lua` /
`process_data.py` ([Kirk McDonald's tooling][upstream]).

## Credits & license

- Calculator code © **Kirk McDonald**, [github.com/KirkMcDonald/kirkmcdonald.github.io][upstream],
  under the **Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
- Modifications (theme, Blueprints library + editor, cleanup) by **k0shir0**.
- *Factorio* and its icons/recipe data are property of **Wube Software**. This is
  an unofficial, fan-made tool.

[upstream]: https://github.com/KirkMcDonald/kirkmcdonald.github.io
