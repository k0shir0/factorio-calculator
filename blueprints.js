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
let devMode = false              // true only when the local editor server answers
let serverRepo = null            // {owner, name, branch} reported by the local server
let manifest = []                // array of {slug, title, category, tags, thumbnail}
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

// Resolve a stored image reference to a usable <img> src. Self-contained
// blueprints embed images as data: URLs (used as-is); server-saved blueprints
// store a filename inside the blueprint's images/ folder.
function imgSrc(slug, img) {
    return (typeof img === "string" && img.startsWith("data:")) ? img : imageUrl(slug, img)
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
        if (data && data.repo && data.repo.owner && data.repo.name) {
            serverRepo = data.repo
        }
        return !!(data && data.editor === true)
    } catch (e) {
        return false
    }
}

// Determine the GitHub repo so the publish panel can link to it: prefer what
// the local editor server reported (from `git remote`), else derive it from a
// GitHub Pages URL (<owner>.github.io[/<repo>]). Returns null if unknown.
function getRepoInfo() {
    if (serverRepo && serverRepo.owner && serverRepo.name) {
        return { owner: serverRepo.owner, name: serverRepo.name, branch: serverRepo.branch || "main" }
    }
    let m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i)
    if (m) {
        let owner = m[1]
        let seg = location.pathname.split("/").filter(Boolean)[0]
        return { owner, name: seg || `${owner}.github.io`, branch: "main" }
    }
    return null
}

function ghNewFileUrl(repo, path) {
    // Path segments are all URL-safe ([a-z0-9-/._]); keep slashes literal so
    // GitHub creates the nested folders.
    return `https://github.com/${repo.owner}/${repo.name}/new/${repo.branch}?filename=${path}`
}

function ghEditFileUrl(repo, path) {
    return `https://github.com/${repo.owner}/${repo.name}/edit/${repo.branch}/${path}`
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
        el("button", {
            class: "bp-btn bp-btn-primary bp-new",
            onclick: () => showEditor(null),
        }, "+ New blueprint"),
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
                ? "No blueprints yet. Click “+ New blueprint” to create one."
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
            el("img", { src: imgSrc(bp.slug, bp.thumbnail), alt: bp.title, loading: "lazy", decoding: "async" }),
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
            gal.appendChild(el("a", { href: imgSrc(slug, img), target: "_blank", rel: "noopener" }, [
                el("img", { src: imgSrc(slug, img), alt: "", loading: "lazy", decoding: "async" }),
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

    // Working image list of { name, data }. `data` is a full data: URL for
    // newly added images; for images already committed as files it is null and
    // `name` is the filename.
    let images = (article.images || []).map((img, i) => {
        if (typeof img === "string" && img.startsWith("data:")) {
            return { name: `image-${i + 1}.png`, data: img }
        }
        return { name: img, data: null }
    })
    let thumbName = ""
    if (article.thumbnail) {
        if (String(article.thumbnail).startsWith("data:")) {
            let match = images.find(im => im.data === article.thumbnail)
            thumbName = match ? match.name : (images[0] ? images[0].name : "")
        } else {
            thumbName = article.thumbnail
        }
    }

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
    let thumbHelp = el("div", { class: "bp-images-hint" }, "Click ☆ to set the gallery thumbnail. Images are embedded into the downloaded blueprint file.")
    let imagesList = el("div", { class: "bp-images-list" })
    imagesWrap.appendChild(drop)
    imagesWrap.appendChild(fileInput)
    imagesWrap.appendChild(thumbHelp)
    imagesWrap.appendChild(imagesList)

    function pendingSlug() {
        return (slugInput.value || slugify(titleInput.value)).trim()
    }

    function renderImages() {
        clear(imagesList)
        if (!images.length) {
            imagesList.appendChild(el("div", { class: "bp-images-empty" }, "No images yet."))
        }
        for (let im of images) {
            let isThumb = im.name === thumbName
            let src = im.data || (pendingSlug() ? imageUrl(pendingSlug(), im.name) : "")
            imagesList.appendChild(el("div", { class: "bp-image-item" + (isThumb ? " is-thumb" : "") }, [
                el("img", { src, alt: im.name }),
                el("div", { class: "bp-image-name" }, im.name),
                el("button", { class: "bp-mini", title: "Set as thumbnail", onclick: () => { thumbName = im.name; renderImages() } }, isThumb ? "★ thumb" : "☆ thumb"),
                el("button", { class: "bp-mini bp-mini-danger", title: "Remove", onclick: () => { images = images.filter(x => x !== im); if (thumbName === im.name) thumbName = ""; renderImages() } }, "remove"),
            ]))
        }
    }

    async function addFiles(fileList) {
        for (let file of fileList) {
            if (!file.type.startsWith("image/")) {
                continue
            }
            try {
                let data = await readFileAsDataUrl(file)
                let name = uniqueImageName(images, file.name)
                images.push({ name, data })
                if (!thumbName) {
                    thumbName = name
                }
                renderImages()
            } catch (e) {
                alert("Could not read image: " + e.message)
            }
        }
    }

    drop.addEventListener("click", () => fileInput.click())
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = "" })
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover") })
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"))
    drop.addEventListener("drop", e => {
        e.preventDefault()
        drop.classList.remove("dragover")
        if (e.dataTransfer && e.dataTransfer.files) {
            addFiles(e.dataTransfer.files)
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

    // Build a draft object from the current form state (or null if invalid).
    function buildDraft() {
        let finalSlug = pendingSlug()
        if (!titleInput.value.trim()) { alert("Title is required."); return null }
        if (!finalSlug) { alert("Slug is required."); return null }
        if (isNew && manifest.some(b => b.slug === finalSlug)) {
            alert(`A blueprint with slug "${finalSlug}" already exists. Choose a different title/slug.`)
            return null
        }
        return {
            slug: finalSlug,
            title: titleInput.value.trim(),
            category: categoryInput.value.trim(),
            tags: tagsInput.value.split(",").map(s => s.trim()).filter(Boolean),
            videoUrl: videoInput.value.trim(),
            blueprintString: bpInput.value.trim(),
            bodyMarkdown: bodyInput.value,
            images: images,
            thumbName: thumbName,
        }
    }

    let status = el("span", { class: "bp-status" })
    let actions = el("div", { class: "bp-editor-actions" })
    actions.appendChild(el("button", { class: "bp-btn bp-btn-primary", onclick: onPublish }, "Finish → download & publish"))
    if (devMode) {
        actions.appendChild(el("button", { class: "bp-btn", onclick: onSaveServer }, "Save to local repo"))
    }
    actions.appendChild(el("button", { class: "bp-btn", onclick: () => slug ? navigateTo(slug) : navigateTo(null) }, "Cancel"))
    actions.appendChild(status)
    form.appendChild(actions)

    async function onPublish() {
        let draft = buildDraft()
        if (!draft) { return }
        status.textContent = "Preparing…"
        try {
            let { article, manifestEntry } = await buildSelfContained(draft)
            status.textContent = ""
            showPublishPanel(article, manifestEntry, draft.slug)
        } catch (e) {
            status.textContent = ""
            alert("Could not prepare blueprint: " + e.message)
        }
    }

    async function onSaveServer() {
        let draft = buildDraft()
        if (!draft) { return }
        status.textContent = "Saving…"
        try {
            await saveDraftToServer(draft)
            await loadManifest()
            navigateTo(draft.slug)
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
// Publish / export helpers
// ---------------------------------------------------------------------------

// Ensure an image name is unique within the working list (and filesystem-safe).
function uniqueImageName(images, filename) {
    let base = String(filename || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_") || "image.png"
    let name = base
    let i = 1
    while (images.some(im => im.name === name)) {
        let dot = base.lastIndexOf(".")
        name = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
        i++
    }
    return name
}

// Build the self-contained article.json (images embedded as data: URLs) plus
// the small index.json manifest entry (with a downscaled thumbnail).
async function buildSelfContained(draft) {
    let images = draft.images.map(im => im.data || imageUrl(draft.slug, im.name))
    let thumb = draft.images.find(im => im.name === draft.thumbName)
    let thumbSmall = ""
    if (thumb) {
        thumbSmall = thumb.data ? await downscaleDataUrl(thumb.data, 360) : imageUrl(draft.slug, thumb.name)
    }
    let article = {
        slug: draft.slug,
        title: draft.title,
        category: draft.category,
        tags: draft.tags,
        videoUrl: draft.videoUrl,
        thumbnail: thumbSmall,
        images: images,
        blueprintString: draft.blueprintString,
        bodyMarkdown: draft.bodyMarkdown,
    }
    let manifestEntry = {
        slug: draft.slug,
        title: draft.title,
        category: draft.category,
        tags: draft.tags,
        thumbnail: thumbSmall,
    }
    return { article, manifestEntry }
}

// Save a draft via the local editor server: upload new images as files, then
// write article.json and update index.json.
async function saveDraftToServer(draft) {
    let imageNames = []
    let thumbnail = ""
    for (let im of draft.images) {
        let name = im.name
        if (im.data) {
            let dataBase64 = im.data.slice(im.data.indexOf(",") + 1)
            let resp = await apiPost("/api/upload", { slug: draft.slug, filename: im.name, dataBase64 })
            if (!resp.ok || !resp.filename) {
                throw new Error(resp.error || "image upload failed")
            }
            name = resp.filename
        }
        imageNames.push(name)
        if (im.name === draft.thumbName) {
            thumbnail = name
        }
    }
    let resp = await apiPost("/api/save", {
        slug: draft.slug,
        title: draft.title,
        category: draft.category,
        tags: draft.tags,
        videoUrl: draft.videoUrl,
        thumbnail: thumbnail,
        images: imageNames,
        blueprintString: draft.blueprintString,
        bodyMarkdown: draft.bodyMarkdown,
    })
    if (!resp.ok) {
        throw new Error(resp.error || "save failed")
    }
}

function downloadText(filename, text, mime) {
    let blob = new Blob([text], { type: mime || "application/json" })
    let url = URL.createObjectURL(blob)
    let a = el("a", { href: url, download: filename })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// Downscale a data: URL to at most maxW wide, returning a small JPEG data URL.
function downscaleDataUrl(dataUrl, maxW) {
    return new Promise(resolve => {
        if (!dataUrl || !String(dataUrl).startsWith("data:")) { resolve(dataUrl || ""); return }
        let img = new Image()
        img.onload = () => {
            let scale = Math.min(1, maxW / (img.width || maxW))
            let w = Math.max(1, Math.round((img.width || maxW) * scale))
            let h = Math.max(1, Math.round((img.height || maxW) * scale))
            let canvas = document.createElement("canvas")
            canvas.width = w
            canvas.height = h
            canvas.getContext("2d").drawImage(img, 0, 0, w, h)
            try { resolve(canvas.toDataURL("image/jpeg", 0.72)) } catch (e) { resolve(dataUrl) }
        }
        img.onerror = () => resolve(dataUrl)
        img.src = dataUrl
    })
}

// The "you're done — here's how to publish" screen.
function showPublishPanel(article, manifestEntry, slug) {
    clear(root)
    let repo = getRepoInfo()
    let articleJson = JSON.stringify(article, null, 2) + "\n"
    let entries = manifest.filter(b => b.slug !== slug).concat([manifestEntry])
    entries.sort((a, b) => String(a.title).localeCompare(String(b.title)))
    let indexJson = JSON.stringify({ blueprints: entries }, null, 2) + "\n"
    let articlePath = `${CONTENT_ROOT}/${slug}/article.json`
    let indexPath = `${CONTENT_ROOT}/index.json`

    let panel = el("div", { class: "bp-publish" })
    panel.appendChild(el("h1", { class: "bp-title" }, "Publish “" + article.title + "”"))
    panel.appendChild(el("p", { class: "bp-publish-intro" },
        "Your blueprint is packaged as a self-contained JSON (images included). Add these two files to the repository — GitHub Pages redeploys and it goes live."))

    panel.appendChild(el("div", { class: "bp-step" }, [
        el("h2", null, "1. Add the blueprint file"),
        el("div", { class: "bp-step-path" }, articlePath),
        el("div", { class: "bp-step-actions" }, [
            el("button", { class: "bp-btn bp-btn-primary", onclick: () => downloadText(slug + ".article.json", articleJson) }, "Download article.json"),
            el("button", { class: "bp-btn", onclick: e => copyText(articleJson, e.target) }, "Copy JSON"),
            repo ? el("a", { class: "bp-btn bp-btn-link", href: ghNewFileUrl(repo, articlePath), target: "_blank", rel: "noopener" }, "Create on GitHub →") : null,
        ]),
    ]))

    panel.appendChild(el("div", { class: "bp-step" }, [
        el("h2", null, "2. Update the index"),
        el("div", { class: "bp-step-path" }, indexPath),
        el("div", { class: "bp-step-actions" }, [
            el("button", { class: "bp-btn bp-btn-primary", onclick: () => downloadText("index.json", indexJson) }, "Download index.json"),
            el("button", { class: "bp-btn", onclick: e => copyText(indexJson, e.target) }, "Copy JSON"),
            repo ? el("a", { class: "bp-btn bp-btn-link", href: ghEditFileUrl(repo, indexPath), target: "_blank", rel: "noopener" }, "Edit on GitHub →") : null,
        ]),
        el("p", { class: "bp-step-hint" }, "Replace the whole file with this — it already includes your existing blueprints."),
    ]))

    if (!repo) {
        panel.appendChild(el("p", { class: "bp-step-hint" },
            "Direct GitHub commit links appear here automatically when you open this on your published site or run the local editor."))
    }
    if (devMode) {
        panel.appendChild(el("p", { class: "bp-step-hint" },
            "Running locally you can also go back and use “Save to local repo” to write these files directly, then commit with git."))
    }

    panel.appendChild(el("div", { class: "bp-editor-actions" }, [
        el("button", { class: "bp-btn", onclick: () => navigateTo(null) }, "Back to gallery"),
    ]))

    root.appendChild(panel)
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

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader()
        reader.onload = () => resolve(reader.result)
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
