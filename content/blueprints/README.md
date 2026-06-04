# Blueprint content

Everything in this folder is the **content** for the Blueprints tab. It is plain
JSON + images, committed to the repo and served read-only on the live site.

You normally don't edit these files by hand — run the local editor
(`npm run editor`, then use the **+ New blueprint** / **Edit** buttons). The
editor writes exactly the structure below. The format is documented here in case
you want to edit or script it directly.

## Structure

```
content/blueprints/
  index.json                 Gallery manifest (one entry per blueprint)
  <slug>/
    article.json             The full article
    images/                  Screenshots + thumbnail for this blueprint
      my-screenshot.png
```

`<slug>` is a lowercase, hyphenated id (e.g. `red-circuit-block`). It is also the
folder name and the value used in the shareable URL: `?bp=<slug>`.

### `index.json`

```json
{
  "blueprints": [
    {
      "slug": "red-circuit-block",
      "title": "Red Circuit Block",
      "category": "Circuits",
      "tags": ["circuits", "mid-game"],
      "thumbnail": "thumb.png"
    }
  ]
}
```

`thumbnail` is a filename inside that blueprint's `images/` folder (or `""` for a
generated text tile).

### `<slug>/article.json`

```json
{
  "slug": "red-circuit-block",
  "title": "Red Circuit Block",
  "category": "Circuits",
  "tags": ["circuits", "mid-game"],
  "videoUrl": "https://www.youtube.com/watch?v=...",
  "thumbnail": "thumb.png",
  "images": ["thumb.png", "overview.png"],
  "blueprintString": "0eNq...",
  "bodyMarkdown": "## Overview\n\nText, **Markdown**, tables, etc."
}
```

- `videoUrl` — a YouTube or Vimeo link; it is embedded automatically.
- `blueprintString` — optional in-game import string; shown with a copy button.
- `bodyMarkdown` — the article body. Rendered Markdown is sanitized (DOMPurify)
  before display.
- `images` — filenames present in `images/`; shown as a screenshot gallery.

Keep `index.json` in sync with the `article.json` files (the editor does this for
you). After editing, commit and push to publish.
