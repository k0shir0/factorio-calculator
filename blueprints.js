/* Blueprints library tab.
 *
 * Read path (works everywhere, including GitHub Pages): renders a gallery of
 * blueprint cards from content/blueprints/index.json and an article view per
 * blueprint from content/blueprints/<slug>/article.json.
 *
 * Write path (dev only): when the page is served by the local editor server
 * (tools/editor-server.js) on localhost, an in-browser editor appears that
 * saves articles + images back into the repo via /api/* endpoints. On a static
 * host none of that exists, so the library is read-only by construction.
 *
 * Article markdown is authored by the site owner (trusted), so rendered HTML is
 * injected directly. Do not point this at untrusted user input.
 */

const CONTENT_ROOT = "content/blueprints"
const INDEX_URL = CONTENT_ROOT + "/index.json"

let root = null
let devMode = false
let manifest = []        // array of {slug, title, category, tags, thumbnail}
let initialized = false

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag, props, children) {
    let node = document.createElement(tag)
    if (props) {
        for (let key in props) {
            if (key === "class") {
                node.className = props[key]
            } else if (key === "dataset") {
                Object.assign(node.dataset, props[key])
            } else if (key.startsWith("on") && typeof props[key] === "function") {
                node.addEventListener(key.slice(2).toLowerCase(), props[key])
            } else if (key === "html") {
                node.innerHTML = props[key]
            } else if (props[key] !== null && props[key] !== undefined) {
                node.setAttribute(key, props[key])
            }
        }
    }
    if (children !== undefined && children !== null) {
        appendChildren(node, children)
    }
    return node
}

function appendChildren(node, children) {
    if (Array.isArray(children)) {
        for (let c of children) {
            appendChildren(node, c)
        }
    } else if (children instanceof Node) {
        node.appendChild(children)
    } else if (children !== null && children !== undefined && children !== false) {
        node.appendChild(document.createTextNode(String(children)))
    }
}

function clear(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild)
    }
}

// ---------------------------------------------------------------------------
// Paths and parsing
// ---------------------------------------------------------------------------

function articleUrl(slug) {
    return `${CONTENT_ROOT}/${slug}/article.json`
}

function imageUrl(slug, filename) {
    return `${CONTENT_ROOT}/${slug}/images/${filename}`
}

function slugify(title) {
    return String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
}

// Convert a YouTube/Vimeo URL into an embeddable URL, or null if unrecognized.
function videoEmbedUrl(url) {
    if (!url) {
        return null
    }
    let yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/)
    if (yt) {
        return `https://www.youtube.com/embed/${yt[1]}`
    }
    let vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (vimeo) {
        return `https://player.vimeo.com/video/${vimeo[1]}`
    }
    return null
}

function renderMarkdown(md) {
    let html
    if (window.marked && typeof window.marked.parse === "function") {
        html = window.marked.parse(md || "")
    } else {
        // Fallback if the markdown lib failed to load: show as escaped text.
        let div = document.createElement("div")
        div.textContent = md || ""
        return div.innerHTML
    }
    // Sanitize the generated HTML before it is injected. Article content is
    // authored by the site owner, but this strips <script>, event handlers,
    // javascript: URLs etc. as defense-in-depth.
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
        return window.DOMPurify.sanitize(html, { ADD_ATTR: ["target"] })
    }
    return html
}

// Returns the URL only if it is a safe http(s) (or relative) link, else null.
// Blocks javascript:, data:, and other potentially dangerous schemes.
function safeUrl(url) {
    if (!url) {
        return null
    }
    try {
        let u = new URL(url, location.href)
        if (u.protocol === "http:" || u.protocol === "https:") {
            return u.href
        }
    } catch (e) {}
    return null
}

// ---------------------------------------------------------------------------
// Dev-mode detection
// ---------------------------------------------------------------------------

// The editor only appears when BOTH the host is local AND the editor server
// answers /api/health. On GitHub Pages neither holds, so the library is
// read-only and no save endpoints exist.
async function detectDevMode() {
    let host = location.hostname
    let isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === ""
    if (!isLocal) {
        return false
    }
    try {
        let resp = await fetch("/api/health", { cache: "no-store" })
        if (!resp.ok) {
            return false
        }
        let data = await resp.json()
        return !!(data && data.editor === true)
    } catch (e) {
        return false
    }
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadManifest() {
    try {
        let resp = await fetch(INDEX_URL, { cache: "no-store" })
        if (!resp.ok) {
            manifest = []
            return
        }
        let data = await resp.json()
        manifest = Array.isArray(data.blueprints) ? data.blueprints : []
    } catch (e) {
        console.log("Failed to load blueprint manifest:", e)
        manifest = []
    }
}

async function loadArticle(slug) {
    let resp = await fetch(articleUrl(slug), { cache: "no-store" })
    if (!resp.ok) {
        throw new Error(`Blueprint "${slug}" not found.`)
    }
    return resp.json()
}

// ---------------------------------------------------------------------------
// Routing (uses ?bp=<slug>, which does not collide with the calculator hash)
// ---------------------------------------------------------------------------

function currentSlug() {
    let s = new URLSearchParams(location.search).get("bp")
    if (!s) {
        return null
    }
    // Slugs are always lowercase [a-z0-9-]; sanitizing the query param prevents
    // it from being used to fetch unexpected paths.
    s = s.toLowerCase().replace(/[^a-z0-9-]/g, "")
    return s || null
}

function navigateTo(slug, replace) {
    let url = new URL(location.href)
    if (slug) {
        url.searchParams.set("bp", slug)
    } else {
        url.searchParams.delete("bp")
    }
    if (replace) {
        history.replaceState({}, "", url)
    } else {
        history.pushState({}, "", url)
    }
    route()
}

async function route() {
    if (!root) {
        return
    }
    let slug = currentSlug()
    if (slug) {
        await showArticle(slug)
    } else {
        showGallery()
    }
}

// ---------------------------------------------------------------------------
// Gallery view
// ---------------------------------------------------------------------------

let galleryState = { search: "", category: "" }

function categories() {
    let set = new Set()
    for (let bp of manifest) {
        if (bp.category) {
            set.add(bp.category)
        }
    }
    return Array.from(set).sort()
}

function filteredManifest() {
    let q = galleryState.search.trim().toLowerCase()
    return manifest.filter(bp => {
        if (galleryState.category && bp.category !== galleryState.category) {
            return false
        }
        if (q) {
            let hay = (bp.title + " " + (bp.tags || []).join(" ")).toLowerCase()
            if (!hay.includes(q)) {
                return false
            }
        }
        return true
    })
}

function showGallery() {
    clear(root)

    let toolbar = el("div", { class: "bp-toolbar" }, [
        el("input", {
            class: "bp-search",
            type: "text",
            placeholder: "Search blueprints…",
            value: galleryState.search,
            oninput: e => { galleryState.search = e.target.value; renderCards() },
        }),
        (() => {
            let sel = el("select", {
                class: "bp-category",
                onchange: e => { galleryState.category = e.target.value; renderCards() },
            }, [el("option", { value: "" }, "All categories")])
            for (let c of categories()) {
                sel.appendChild(el("option", { value: c, selected: c === galleryState.category ? "selected" : null }, c))
            }
            return sel
        })(),
        devMode ? el("button", {
            class: "bp-btn bp-btn-primary bp-new",
            onclick: () => showEditor(null),
        }, "+ New blueprint") : null,
    ])
    root.appendChild(toolbar)

    let grid = el("div", { class: "bp-grid", id: "bp-grid" })
    root.appendChild(grid)
    renderCards()
}

function renderCards() {
    let grid = document.getElementById("bp-grid")
    if (!grid) {
        return
    }
    clear(grid)
    let items = filteredManifest()
    if (items.length === 0) {
        grid.appendChild(el("div", { class: "bp-empty" },
            manifest.length === 0
                ? "No blueprints yet." + (devMode ? " Click “+ New blueprint” to add one." : "")
                : "No blueprints match your search."))
        return
    }
    for (let bp of items) {
        grid.appendChild(card(bp))
    }
}

function card(bp) {
    let thumb
    if (bp.thumbnail) {
        thumb = el("div", { class: "bp-card-thumb" }, [
            el("img", { src: imageUrl(bp.slug, bp.thumbnail), alt: bp.title, loading: "lazy" }),
        ])
    } else {
        // Fallback tile: first letters of the title on a mint accent block.
        let initials = bp.title.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase()
        thumb = el("div", { class: "bp-card-thumb bp-card-thumb-fallback" }, initials)
    }
    return el("a", {
        class: "bp-card",
        href: `?bp=${encodeURIComponent(bp.slug)}`,
        onclick: e => { e.preventDefault(); navigateTo(bp.slug) },
    }, [
        thumb,
        el("div", { class: "bp-card-body" }, [
            el("div", { class: "bp-card-title" }, bp.title),
            el("div", { class: "bp-card-meta" }, [
                bp.category ? el("span", { class: "bp-badge" }, bp.category) : null,
            ]),
        ]),
    ])
}

// ---------------------------------------------------------------------------
// Article view
// ---------------------------------------------------------------------------

async function showArticle(slug) {
    clear(root)
    root.appendChild(el("div", { class: "bp-article" }, [
        el("button", { class: "bp-back", onclick: () => navigateTo(null) }, "← All blueprints"),
        el("div", { class: "bp-loading" }, "Loading…"),
    ]))

    let article
    try {
        article = await loadArticle(slug)
    } catch (e) {
        clear(root)
        root.appendChild(el("div", { class: "bp-article" }, [
            el("button", { class: "bp-back", onclick: () => navigateTo(null) }, "← All blueprints"),
            el("div", { class: "bp-empty" }, e.message),
        ]))
        return
    }

    clear(root)
    let container = el("div", { class: "bp-article" })

    container.appendChild(el("div", { class: "bp-article-head" }, [
        el("button", { class: "bp-back", onclick: () => navigateTo(null) }, "← All blueprints"),
        devMode ? el("div", { class: "bp-article-actions" }, [
            el("button", { class: "bp-btn", onclick: () => showEditor(slug) }, "Edit"),
            el("button", { class: "bp-btn bp-btn-danger", onclick: () => deleteBlueprint(slug) }, "Delete"),
        ]) : null,
    ]))

    container.appendChild(el("h1", { class: "bp-title" }, article.title))
    let meta = el("div", { class: "bp-article-meta" })
    if (article.category) {
        meta.appendChild(el("span", { class: "bp-badge" }, article.category))
    }
    for (let t of (article.tags || [])) {
        meta.appendChild(el("span", { class: "bp-tag" }, t))
    }
    container.appendChild(meta)

    // Video
    let embed = videoEmbedUrl(article.videoUrl)
    if (embed) {
        container.appendChild(el("div", { class: "bp-video" }, [
            el("iframe", {
                src: embed,
                frameborder: "0",
                allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
                allowfullscreen: "true",
                loading: "lazy",
            }),
        ]))
    } else {
        let videoLink = safeUrl(article.videoUrl)
        if (videoLink) {
            container.appendChild(el("p", { class: "bp-video-link" }, [
                el("a", { href: videoLink, target: "_blank", rel: "noopener" }, "Watch the build video"),
            ]))
        }
    }

    // Blueprint string
    if (article.blueprintString) {
        container.appendChild(el("div", { class: "bp-string-row" }, [
            el("button", {
                class: "bp-btn bp-btn-primary",
                onclick: e => copyText(article.blueprintString, e.target),
            }, "Copy blueprint string"),
            el("span", { class: "bp-string-hint" }, "Paste into Factorio → Import string"),
        ]))
    }

    // Body
    container.appendChild(el("div", { class: "bp-body", html: renderMarkdown(article.bodyMarkdown) }))

    // Image gallery
    if (article.images && article.images.length) {
        let gal = el("div", { class: "bp-gallery" })
        for (let img of article.images) {
            gal.appendChild(el("a", { href: imageUrl(slug, img), target: "_blank", rel: "noopener" }, [
                el("img", { src: imageUrl(slug, img), alt: "", loading: "lazy" }),
            ]))
        }
        container.appendChild(el("h2", { class: "bp-gallery-heading" }, "Screenshots"))
        container.appendChild(gal)
    }

    root.appendChild(container)
}

function copyText(text, btn) {
    let done = () => {
        if (btn) {
            let old = btn.textContent
            btn.textContent = "Copied!"
            setTimeout(() => { btn.textContent = old }, 1500)
        }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
    } else {
        fallbackCopy(text, done)
    }
}

function fallbackCopy(text, done) {
    let ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand("copy") } catch (e) {}
    document.body.removeChild(ta)
    if (done) done()
}

// ---------------------------------------------------------------------------
// Editor (dev only)
// ---------------------------------------------------------------------------

async function showEditor(slug) {
    clear(root)
    let isNew = !slug
    let article = {
        slug: "",
        title: "",
        category: "",
        tags: [],
        videoUrl: "",
        thumbnail: "",
        images: [],
        blueprintString: "",
        bodyMarkdown: "",
    }
    if (!isNew) {
        try {
            article = Object.assign(article, await loadArticle(slug))
        } catch (e) {
            alert(e.message)
            navigateTo(null)
            return
        }
    }

    // Working copy of uploaded image filenames.
    let images = (article.images || []).slice()
    let thumbnail = article.thumbnail || ""

    let form = el("div", { class: "bp-editor" })
    form.appendChild(el("h1", { class: "bp-title" }, isNew ? "New blueprint" : `Editing: ${article.title}`))

    let titleInput = field(form, "Title", el("input", { type: "text", class: "bp-input", value: article.title }))
    let slugInput = field(form, "Slug (folder name)", el("input", {
        type: "text", class: "bp-input", value: article.slug, placeholder: "auto from title",
        readonly: isNew ? null : "readonly",
    }))
    if (isNew) {
        titleInput.addEventListener("input", () => {
            if (!slugInput.dataset.touched) {
                slugInput.value = slugify(titleInput.value)
            }
        })
        slugInput.addEventListener("input", () => { slugInput.dataset.touched = "1" })
    }
    let categoryInput = field(form, "Category", el("input", { type: "text", class: "bp-input", value: article.category, placeholder: "e.g. Smelting, Circuits, Mall" }))
    let tagsInput = field(form, "Tags (comma separated)", el("input", { type: "text", class: "bp-input", value: (article.tags || []).join(", ") }))
    let videoInput = field(form, "Build video URL (YouTube / Vimeo)", el("input", { type: "text", class: "bp-input", value: article.videoUrl, placeholder: "https://www.youtube.com/watch?v=…" }))
    let bpInput = field(form, "Blueprint string (optional)", el("textarea", { class: "bp-input bp-textarea-small" }, article.blueprintString))

    // Images
    let imagesWrap = el("div", { class: "bp-images-edit" })
    let imagesField = field(form, "Images (drag & drop or click)", imagesWrap)
    let drop = el("div", { class: "bp-dropzone" }, "Drop images here or click to choose")
    let fileInput = el("input", { type: "file", accept: "image/*", multiple: "multiple", style: "display:none" })
    let thumbHelp = el("div", { class: "bp-images-hint" }, "Click the star to set the gallery thumbnail.")
    let imagesList = el("div", { class: "bp-images-list" })
    imagesWrap.appendChild(drop)
    imagesWrap.appendChild(fileInput)
    imagesWrap.appendChild(thumbHelp)
    imagesWrap.appendChild(imagesList)

    function renderImages() {
        clear(imagesList)
        if (!images.length) {
            imagesList.appendChild(el("div", { class: "bp-images-empty" }, "No images yet."))
        }
        for (let fn of images) {
            let isThumb = fn === thumbnail
            imagesList.appendChild(el("div", { class: "bp-image-item" + (isThumb ? " is-thumb" : "") }, [
                el("img", { src: pendingSlug() ? imageUrl(pendingSlug(), fn) : "", alt: fn }),
                el("div", { class: "bp-image-name" }, fn),
                el("button", { class: "bp-mini", title: "Set as thumbnail", onclick: () => { thumbnail = fn; renderImages() } }, isThumb ? "★ thumb" : "☆ thumb"),
                el("button", { class: "bp-mini bp-mini-danger", title: "Remove from list", onclick: () => { images = images.filter(x => x !== fn); if (thumbnail === fn) thumbnail = ""; renderImages() } }, "remove"),
            ]))
        }
    }

    function pendingSlug() {
        return (slugInput.value || slugify(titleInput.value)).trim()
    }

    async function uploadFiles(fileList) {
        let slugForUpload = pendingSlug()
        if (!slugForUpload) {
            alert("Enter a title or slug first, so images have a folder to go in.")
            return
        }
        for (let file of fileList) {
            if (!file.type.startsWith("image/")) {
                continue
            }
            try {
                let dataBase64 = await readFileAsBase64(file)
                let resp = await apiPost("/api/upload", {
                    slug: slugForUpload,
                    filename: file.name,
                    dataBase64,
                })
                if (resp.ok && resp.filename) {
                    if (!images.includes(resp.filename)) {
                        images.push(resp.filename)
                    }
                    if (!thumbnail) {
                        thumbnail = resp.filename
                    }
                    renderImages()
                } else {
                    alert("Upload failed: " + (resp.error || "unknown error"))
                }
            } catch (e) {
                alert("Upload failed: " + e.message)
            }
        }
    }

    drop.addEventListener("click", () => fileInput.click())
    fileInput.addEventListener("change", () => { uploadFiles(fileInput.files); fileInput.value = "" })
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover") })
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"))
    drop.addEventListener("drop", e => {
        e.preventDefault()
        drop.classList.remove("dragover")
        if (e.dataTransfer && e.dataTransfer.files) {
            uploadFiles(e.dataTransfer.files)
        }
    })
    renderImages()

    // Body markdown with live preview
    let bodyWrap = el("div", { class: "bp-body-edit" })
    let bodyInput = el("textarea", { class: "bp-input bp-textarea" }, article.bodyMarkdown)
    let preview = el("div", { class: "bp-body bp-preview" })
    function renderPreview() {
        preview.innerHTML = renderMarkdown(bodyInput.value)
    }
    bodyInput.addEventListener("input", renderPreview)
    bodyWrap.appendChild(el("div", { class: "bp-body-edit-cols" }, [
        el("div", { class: "bp-body-edit-col" }, [el("label", { class: "bp-label" }, "Body (Markdown)"), bodyInput]),
        el("div", { class: "bp-body-edit-col" }, [el("label", { class: "bp-label" }, "Preview"), preview]),
    ]))
    form.appendChild(bodyWrap)
    renderPreview()

    // Save / cancel
    let status = el("span", { class: "bp-status" })
    form.appendChild(el("div", { class: "bp-editor-actions" }, [
        el("button", { class: "bp-btn bp-btn-primary", onclick: save }, "Save"),
        el("button", { class: "bp-btn", onclick: () => slug ? navigateTo(slug) : navigateTo(null) }, "Cancel"),
        status,
    ]))

    async function save() {
        let finalSlug = pendingSlug()
        if (!titleInput.value.trim()) { alert("Title is required."); return }
        if (!finalSlug) { alert("Slug is required."); return }
        if (isNew && manifest.some(b => b.slug === finalSlug)) {
            alert(`A blueprint with slug "${finalSlug}" already exists. Choose a different title/slug.`)
            return
        }
        let payload = {
            slug: finalSlug,
            title: titleInput.value.trim(),
            category: categoryInput.value.trim(),
            tags: tagsInput.value.split(",").map(s => s.trim()).filter(Boolean),
            videoUrl: videoInput.value.trim(),
            thumbnail: thumbnail,
            images: images,
            blueprintString: bpInput.value.trim(),
            bodyMarkdown: bodyInput.value,
        }
        status.textContent = "Saving…"
        try {
            let resp = await apiPost("/api/save", payload)
            if (resp.ok) {
                await loadManifest()
                navigateTo(payload.slug)
            } else {
                status.textContent = ""
                alert("Save failed: " + (resp.error || "unknown error"))
            }
        } catch (e) {
            status.textContent = ""
            alert("Save failed: " + e.message)
        }
    }

    root.appendChild(form)
}

function field(form, labelText, inputNode) {
    form.appendChild(el("div", { class: "bp-field" }, [
        el("label", { class: "bp-label" }, labelText),
        inputNode,
    ]))
    return inputNode
}

async function deleteBlueprint(slug) {
    if (!confirm(`Delete blueprint "${slug}"? This removes its folder from the repo.`)) {
        return
    }
    try {
        let resp = await apiPost("/api/delete", { slug })
        if (resp.ok) {
            await loadManifest()
            navigateTo(null)
        } else {
            alert("Delete failed: " + (resp.error || "unknown error"))
        }
    } catch (e) {
        alert("Delete failed: " + e.message)
    }
}

// ---------------------------------------------------------------------------
// API + file helpers
// ---------------------------------------------------------------------------

async function apiPost(path, body) {
    let resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    let text = await resp.text()
    let data
    try { data = JSON.parse(text) } catch (e) { data = { ok: false, error: text || resp.statusText } }
    if (!resp.ok && data.ok === undefined) {
        data.ok = false
    }
    return data
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader()
        reader.onload = () => {
            let result = reader.result
            let comma = result.indexOf(",")
            resolve(comma >= 0 ? result.slice(comma + 1) : result)
        }
        reader.onerror = () => reject(new Error("Could not read file"))
        reader.readAsDataURL(file)
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function initBlueprints() {
    if (initialized) {
        return
    }
    initialized = true
    root = document.getElementById("blueprints_root")
    if (!root) {
        return
    }
    devMode = await detectDevMode()
    if (devMode) {
        document.body.classList.add("bp-dev")
    }
    await loadManifest()
    window.addEventListener("popstate", route)
    await route()
}
