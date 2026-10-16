# Factorio Calculator + Blueprints

A minimal, black & mint-green Factorio production calculator with a built-in
**Blueprints** library. The calculator (Factory / Visualize / Resources /
Settings tabs) is a restyled fork of [Kirk McDonald's calculator][upstream]; the
**Blueprints** tab and its editor are new.

The whole site is **static** — it deploys to GitHub Pages (or any static host)
with no backend. A small Node script is used *only locally* to author blueprint
content.


npm run editor          # or:  node tools/editor-server.js
open http://localhost:8080, create a blueprint, click "Save to local repo"
git add content/blueprints && git commit -m "Add blueprint" && git push
```

`tools/editor-server.js` uses Node built-ins only (**no `npm install`**), binds
to `127.0.0.1`, and is never deployed. To preview the pure read-only experience,
serve the folder with any static server, e.g. `npx serve .`.



## Credits & license
- Calculator code © **Kirk McDonald**, [github.com/KirkMcDonald/kirkmcdonald.github.io][upstream],
  under the **Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
- Modifications (theme, Blueprints library + editor, cleanup) by **k0shir0**.
- *Factorio* and its icons/recipe data are property of **Wube Software**. This is
  an unofficial, fan-made tool.

[upstream]: https://github.com/KirkMcDonald/kirkmcdonald.github.io
