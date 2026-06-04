/* Local, dev-only editor server for the Blueprints library.
 *
 * Run with:  npm run editor   (or: node tools/editor-server.js)
 *
 * It serves the static site AND exposes /api/* endpoints that write blueprint
 * articles and images into content/blueprints/. This server is never deployed:
 * GitHub Pages serves the static files only, so /api/* does not exist there and
 * the library is read-only. Uses Node built-ins only — no `npm install` needed.
 */

const http = require("http")
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "content", "blueprints")
const INDEX_FILE = path.join(CONTENT, "index.json")
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080
const MAX_BODY = 32 * 1024 * 1024 // 32 MB, generous for base64 images

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".lua": "text/plain; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
    let body = JSON.stringify(obj)
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    })
    res.end(body)
}

function sanitizeSlug(slug) {
    return String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60)
}

function sanitizeFilename(name) {
    // Strip any directory components, then allow a conservative character set.
    let base = path.basename(String(name || ""))
    base = base.replace(/[^a-zA-Z0-9._-]/g, "_")
    if (base === "" || base === "." || base === "..") {
        base = "image"
    }
    return base.slice(0, 80)
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let chunks = []
        let size = 0
        req.on("data", chunk => {
            size += chunk.length
            if (size > MAX_BODY) {
                reject(new Error("Request body too large"))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on("end", () => resolve(Buffer.concat(chunks)))
        req.on("error", reject)
    })
}

async function readJSONBody(req) {
    let buf = await readBody(req)
    if (buf.length === 0) {
        return {}
    }
    return JSON.parse(buf.toString("utf8"))
}

function loadIndex() {
    try {
        let data = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"))
        if (!Array.isArray(data.blueprints)) {
            data.blueprints = []
        }
        return data
    } catch (e) {
        return { blueprints: [] }
    }
}

function writeIndex(index) {
    index.blueprints.sort((a, b) => a.title.localeCompare(b.title))
    fs.mkdirSync(CONTENT, { recursive: true })
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + "\n")
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function handleHealth(req, res) {
    sendJSON(res, 200, { editor: true, version: 1 })
}

async function handleSave(req, res) {
    let body = await readJSONBody(req)
    let slug = sanitizeSlug(body.slug)
    if (!slug) {
        return sendJSON(res, 400, { ok: false, error: "Invalid or empty slug." })
    }
    if (!body.title || !String(body.title).trim()) {
        return sendJSON(res, 400, { ok: false, error: "Title is required." })
    }

    let article = {
        slug,
        title: String(body.title).trim(),
        category: String(body.category || "").trim(),
        tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [],
        videoUrl: String(body.videoUrl || "").trim(),
        thumbnail: body.thumbnail ? sanitizeFilename(body.thumbnail) : "",
        images: Array.isArray(body.images) ? body.images.map(sanitizeFilename) : [],
        blueprintString: String(body.blueprintString || "").trim(),
        bodyMarkdown: String(body.bodyMarkdown || ""),
    }

    let dir = path.join(CONTENT, slug)
    fs.mkdirSync(path.join(dir, "images"), { recursive: true })
    fs.writeFileSync(path.join(dir, "article.json"), JSON.stringify(article, null, 2) + "\n")

    // Upsert the manifest entry.
    let index = loadIndex()
    let entry = {
        slug,
        title: article.title,
        category: article.category,
        tags: article.tags,
        thumbnail: article.thumbnail,
    }
    let existing = index.blueprints.findIndex(b => b.slug === slug)
    if (existing >= 0) {
        index.blueprints[existing] = entry
    } else {
        index.blueprints.push(entry)
    }
    writeIndex(index)

    sendJSON(res, 200, { ok: true, slug })
}

async function handleUpload(req, res) {
    let body = await readJSONBody(req)
    let slug = sanitizeSlug(body.slug)
    let filename = sanitizeFilename(body.filename)
    if (!slug) {
        return sendJSON(res, 400, { ok: false, error: "Invalid slug." })
    }
    if (!body.dataBase64) {
        return sendJSON(res, 400, { ok: false, error: "No image data." })
    }
    let buffer
    try {
        buffer = Buffer.from(body.dataBase64, "base64")
    } catch (e) {
        return sendJSON(res, 400, { ok: false, error: "Invalid base64 data." })
    }
    let imagesDir = path.join(CONTENT, slug, "images")
    fs.mkdirSync(imagesDir, { recursive: true })
    fs.writeFileSync(path.join(imagesDir, filename), buffer)
    sendJSON(res, 200, { ok: true, filename })
}

async function handleDelete(req, res) {
    let body = await readJSONBody(req)
    let slug = sanitizeSlug(body.slug)
    if (!slug) {
        return sendJSON(res, 400, { ok: false, error: "Invalid slug." })
    }
    let dir = path.join(CONTENT, slug)
    if (dir === CONTENT || !dir.startsWith(CONTENT + path.sep)) {
        return sendJSON(res, 400, { ok: false, error: "Refusing to delete outside content dir." })
    }
    fs.rmSync(dir, { recursive: true, force: true })
    let index = loadIndex()
    index.blueprints = index.blueprints.filter(b => b.slug !== slug)
    writeIndex(index)
    sendJSON(res, 200, { ok: true })
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split("?")[0])
    if (urlPath === "/") {
        urlPath = "/index.html"
    }
    let filePath = path.join(ROOT, urlPath)
    // Prevent path traversal outside the repo root.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403)
        res.end("Forbidden")
        return
    }
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("404 Not Found")
            return
        }
        let ext = path.extname(filePath).toLowerCase()
        // This is a local dev server; never cache, so edits to source files and
        // content both appear immediately on reload.
        let headers = {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Cache-Control": "no-store",
        }
        res.writeHead(200, headers)
        fs.createReadStream(filePath).pipe(res)
    })
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
    let pathname = req.url.split("?")[0]
    try {
        if (pathname === "/api/health") {
            return handleHealth(req, res)
        }
        if (req.method === "POST" && pathname === "/api/save") {
            return await handleSave(req, res)
        }
        if (req.method === "POST" && pathname === "/api/upload") {
            return await handleUpload(req, res)
        }
        if (req.method === "POST" && pathname === "/api/delete") {
            return await handleDelete(req, res)
        }
        if (pathname.startsWith("/api/")) {
            return sendJSON(res, 404, { ok: false, error: "Unknown endpoint" })
        }
        serveStatic(req, res)
    } catch (e) {
        console.error("Request error:", e)
        sendJSON(res, 500, { ok: false, error: e.message })
    }
})

// Bind to localhost only: this dev server exposes file-writing endpoints and
// must never be reachable from the local network.
server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  Factorio site (dev + editor) running at:\n    http://localhost:${PORT}\n`)
    console.log("  The Blueprints editor is enabled because this is the local editor server.")
    console.log("  Add/edit blueprints, then commit & push content/blueprints/ to publish.\n")
})
