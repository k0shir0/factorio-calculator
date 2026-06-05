/* Ratios tab — a visual reference of common vanilla Factorio 2.0 production
 * ratios, drawn with the game's own icons (via spec.items[...].icon).
 *
 * Numbers were verified against the official wiki and this site's own
 * vanilla-2.0.55 data. Note that Factorio 2.0's fluid overhaul changed the
 * classic steam ratio: boilers now use 6 water/s (not 60), so one offshore pump
 * feeds 200 boilers, not 20.
 *
 * renderRatios() is called from init.js once the game data (spec) is loaded, so
 * the icons are available.
 */

import { spec } from "./factory.js"

const ICON_SIZE = 64

// Each group is one ratio. A "chain" is the left-to-right sequence of stages;
// each stage is { key, count, label } where key is an item/entity key used to
// look up the icon.
const RATIO_GROUPS = [
    {
        title: "Steam power",
        chain: [
            { key: "offshore-pump", count: 1, label: "Offshore pump" },
            { key: "boiler", count: 200, label: "Boilers" },
            { key: "steam-engine", count: 400, label: "Steam engines" },
        ],
        result: "360 MW",
        note: "Vanilla 2.0 numbers. Each boiler turns 6 water/s into 60 steam/s; each steam engine draws 30 steam/s for 900 kW. One offshore pump (1200 water/s) supplies 200 boilers, which power 400 steam engines. (In 1.1 this was the famous 1 : 20 : 40 — the 2.0 fluid changes made boilers far less thirsty.)",
    },
    {
        title: "Ore → plates",
        chain: [
            { key: "electric-mining-drill", count: 5, label: "Electric mining drills" },
            { key: "steel-furnace", count: 4, label: "Steel / electric furnaces" },
        ],
        result: "2.5 plates/s",
        note: "Iron or copper. A drill mines 0.5 ore/s; a steel or electric furnace smelts 0.625 plate/s. With basic stone furnaces (0.3125 plate/s) the ratio is 5 drills : 8 furnaces.",
    },
    {
        title: "Furnaces per belt of plates",
        chain: [
            { key: "steel-furnace", count: 24, label: "Steel / electric furnaces" },
            { key: "transport-belt", count: 1, label: "Full yellow belt" },
        ],
        result: "15 plates/s",
        note: "Fills one yellow belt (15/s) with plates. Stone furnaces: 48. Red belt (30/s): double the furnaces. Blue belt (45/s): triple.",
    },
    {
        title: "Miners per belt of ore",
        chain: [
            { key: "electric-mining-drill", count: 30, label: "Electric mining drills" },
            { key: "transport-belt", count: 1, label: "Full yellow belt" },
        ],
        result: "15 ore/s",
        note: "Each electric mining drill outputs 0.5 ore/s. Red belt: 60 drills. Blue belt: 90 drills.",
    },
    {
        title: "Green circuits",
        chain: [
            { key: "copper-cable", count: 3, label: "Copper-cable assemblers" },
            { key: "electronic-circuit", count: 2, label: "Green-circuit assemblers" },
        ],
        result: "3 : 2",
        note: "Every electronic circuit needs 3 copper cables. Using the same assembler tier, 3 copper-cable assemblers exactly feed 2 electronic-circuit assemblers.",
    },
]

const BELT_REFERENCE = [
    { key: "transport-belt", label: "Yellow belt", rate: "15 / s" },
    { key: "fast-transport-belt", label: "Red belt", rate: "30 / s" },
    { key: "express-transport-belt", label: "Blue belt", rate: "45 / s" },
]

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(tag, className, children) {
    let node = document.createElement(tag)
    if (className) {
        node.className = className
    }
    if (children !== undefined && children !== null) {
        for (let c of [].concat(children)) {
            if (c === null || c === undefined || c === false) {
                continue
            }
            node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)))
        }
    }
    return node
}

// Returns an icon node for an item/entity key, or a small placeholder.
function iconFor(key) {
    let item = spec.items.get(key)
    if (item && item.icon) {
        return item.icon.make(ICON_SIZE, true)
    }
    return el("span", "ratio-icon-missing", "?")
}

function stageNode(stage) {
    return el("div", "ratio-stage", [
        el("div", "ratio-count", stage.count + "×"),
        iconFor(stage.key),
        el("div", "ratio-label", stage.label),
    ])
}

function groupNode(group) {
    let chain = el("div", "ratio-chain")
    group.chain.forEach((stage, i) => {
        if (i > 0) {
            chain.appendChild(el("div", "ratio-arrow", "→"))
        }
        chain.appendChild(stageNode(stage))
    })
    if (group.result) {
        chain.appendChild(el("div", "ratio-equals", "="))
        chain.appendChild(el("div", "ratio-result", group.result))
    }
    return el("div", "ratio-card", [
        el("h2", "ratio-title", group.title),
        chain,
        group.note ? el("p", "ratio-note", group.note) : null,
    ])
}

function beltReferenceNode() {
    let row = el("div", "belt-ref-row")
    for (let belt of BELT_REFERENCE) {
        row.appendChild(el("div", "belt-ref", [
            iconFor(belt.key),
            el("div", "belt-ref-label", belt.label),
            el("div", "belt-ref-rate", belt.rate),
        ]))
    }
    return el("div", "ratio-card", [
        el("h2", "ratio-title", "Belt throughput"),
        row,
    ])
}

// ---------------------------------------------------------------------------
// Entry point (called from init.js after the game data is loaded)
// ---------------------------------------------------------------------------

export function renderRatios() {
    let root = document.getElementById("ratios_root")
    if (!root || !spec || !spec.items || spec.items.size === 0) {
        return
    }
    while (root.firstChild) {
        root.removeChild(root.firstChild)
    }
    root.appendChild(el("p", "ratio-intro",
        "Common vanilla Factorio 2.0 production ratios. Counts are numbers of buildings; hover an icon for its name."))
    root.appendChild(beltReferenceNode())
    for (let group of RATIO_GROUPS) {
        root.appendChild(groupNode(group))
    }
}
