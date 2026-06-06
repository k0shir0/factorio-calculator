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
- **Ratios** — a visual reference of common production ratios (steam power,
  smelting, oil cracking, green circuits, …) drawn with the game's own icons.
- **Blueprints** — a gallery of builds. Each opens a wiki-style article with an
  embedded build video, screenshots, an optional copy-able blueprint string, and
  a Markdown write-up.
- **Credits** — attribution, the **Sources** / references behind the data and
  ratios, and a changelog of fixes/cleanup.

## Project layout

```
index.html              Entry point (all tabs live here)
calc.css / dropdown.css Calculator styles (restyled)
blueprints.css          Blueprints / Ratios / Credits styles
blueprints.js           Blueprints gallery, article view, and create/publish editor
ratios.js               Ratios reference tab
*.js                    Calculator engine (recipe solver, graphs, etc.)
third_party/            Vendored libraries (d3, dagre, BigInteger, pako, popper,
                        marked, DOMPurify)
data/                   Game data (vanilla-2.0.55.json) + icon sprite sheet
content/blueprints/     Your blueprint content (committed, served read-only)
tools/editor-server.js  Local-only dev server + content editor API (never shipped)
.nojekyll               Tells GitHub Pages to serve files as-is
```

## Add a blueprint (no code)

Blueprints are authored in the browser with the **+ New blueprint** GUI on the
**Blueprints** tab — title, category, tags, video URL, an optional in-game
blueprint string, screenshots (drag & drop; click ☆ for the gallery thumbnail),
and a Markdown write-up. There are two ways to add the result to the library:

**A. Download & commit — works on the live site or locally.** Click
**Finish → download & publish**. The blueprint is packaged as a single
self-contained `article.json` (screenshots embedded), and you get a **Download**
button, **Copy** buttons, and one-click **GitHub commit links** to the exact
paths (auto-detected from your repo). Add the two files (`article.json` and the
updated `index.json`) and push — GitHub Pages redeploys and it goes live. The
published library stays **read-only** for visitors; a download never changes the
live site.

**B. Save directly — when running the local editor.** Run the editor server and
a **Save to local repo** button also appears, which writes the files straight
into `content/blueprints/` for you:

```bash
npm run editor          # or:  node tools/editor-server.js
# open http://localhost:8080, create a blueprint, click "Save to local repo"
git add content/blueprints && git commit -m "Add blueprint" && git push
```

`tools/editor-server.js` uses Node built-ins only (**no `npm install`**), binds
to `127.0.0.1`, and is never deployed. To preview the pure read-only experience,
serve the folder with any static server, e.g. `npx serve .`.

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
