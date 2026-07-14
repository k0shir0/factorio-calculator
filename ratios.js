/* Ratios tab — a visual reference of common vanilla Factorio 2.0 production
 * ratios, drawn with the game's own icons (via spec.items[...].icon).
 *
 * Numbers were verified against this site's own vanilla-2.0.55 data: offshore
 * pump 1200 water/s (pumping_speed 20/tick), boiler 1.8 MW @ 165 C -> 60
 * water/s into 60 steam/s, steam engine 900 kW drawing 30 steam/s. That gives
 * the classic 1 offshore pump : 20 boilers : 40 steam engines = 36 MW.
 *
 * Circuit, steel, Kovarex and rocket ratios were derived from the recipes in
 * the same data file (e.g. advanced-circuit: 6 s, 4 cable + 2 green + 2
 * plastic; rocket-part: 3 s, 10 LDS + 10 fuel + 10 processing units, 100
 * parts per launch). Solar (25:21) and nuclear (1:4:7) match the wiki's
 * entity power numbers, which are not part of the calculator data set.
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
            { key: "boiler", count: 20, label: "Boilers" },
            { key: "steam-engine", count: 40, label: "Steam engines" },
        ],
        result: "36 MW",
        note: "The classic 1 : 20 : 40. Each boiler turns 60 water/s into 60 steam/s (1.8 MW); each steam engine draws 30 steam/s for 900 kW. One offshore pump (1200 water/s) feeds 20 boilers, and every boiler powers 2 steam engines — 36 MW total.",
    },
    {
        title: "Solar power",
        chain: [
            { key: "solar-panel", count: 25, label: "Solar panels" },
            { key: "accumulator", count: 21, label: "Accumulators" },
        ],
        result: "≈1.05 MW day & night",
        note: "The classic 25 : 21 (0.84 accumulators per panel). A panel peaks at 60 kW but averages 42 kW over the day/night cycle; 21 accumulators store just enough to carry 25 panels' load through the night. Rule of thumb: ~24 panels + 20 accumulators per megawatt of steady draw.",
    },
    {
        title: "Nuclear power",
        chain: [
            { key: "nuclear-reactor", count: 1, label: "Reactor" },
            { key: "heat-exchanger", count: 4, label: "Heat exchangers" },
            { key: "steam-turbine", count: 7, label: "Steam turbines" },
        ],
        result: "40 MW",
        note: "One reactor makes 40 MW of heat; each heat exchanger consumes 10 MW, boiling 103 water/s into steam; each turbine draws 60 steam/s for 5.82 MW (7 turbines slightly over-cover the 6.9 needed). Adjacent reactors get +100% neighbour bonus each: a 2×2 block produces 480 MW and wants 48 exchangers, 83 turbines and 5 offshore pumps.",
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
        title: "Steel",
        chain: [
            { key: "iron-plate", count: 5, label: "Iron plates" },
            { key: "steel-plate", count: 1, label: "Steel plate" },
        ],
        result: "1 : 1 furnaces",
        note: "Each steel plate eats 5 iron plates, and smelting it takes 5× as long (16 s vs 3.2 s) — so a steel column needs exactly as many furnaces as the iron column feeding it. A full yellow belt of iron plates (from 24 steel/electric furnaces) becomes 3 steel/s out of another 24 furnaces.",
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
    {
        title: "Red circuits",
        chain: [
            { key: "copper-cable", count: 5, label: "Copper-cable assemblers" },
            { key: "electronic-circuit", count: 2, label: "Green-circuit assemblers" },
            { key: "advanced-circuit", count: 12, label: "Red-circuit assemblers" },
        ],
        result: "2 red/s per tier speed",
        note: "Same assembler tier throughout. 12 red-circuit assemblers (6 s craft) consume 8 cables/s directly plus 4 green circuits/s; the 2 green-circuit assemblers making those need another 12 cables/s, and 5 cable assemblers cover both. Plastic (2 per red circuit) comes in from the side.",
    },
    {
        title: "Blue circuits",
        chain: [
            { key: "copper-cable", count: 10, label: "Copper-cable assemblers" },
            { key: "electronic-circuit", count: 6, label: "Green-circuit assemblers" },
            { key: "advanced-circuit", count: 6, label: "Red-circuit assemblers" },
            { key: "processing-unit", count: 5, label: "Blue-circuit assemblers" },
        ],
        result: "0.5 blue/s per tier speed",
        note: "The whole chain at one assembler tier: 5 processing-unit assemblers (10 s craft, 20 green + 2 red each) consume 10 green/s and 1 red/s. Counting the greens and cables the red circuits themselves need, everything balances at 10 cable : 6 green : 6 red : 5 blue. Sulfuric acid (5 per unit) is piped in.",
    },
    {
        title: "Oil → petroleum (full cracking)",
        chain: [
            { key: "oil-refinery", count: 20, label: "Oil refineries" },
            { key: "chemical-plant", count: 5, label: "Heavy-oil crackers" },
            { key: "chemical-plant", count: 17, label: "Light-oil crackers" },
        ],
        result: "≈390 petroleum/s",
        note: "Advanced oil processing (5 s per refinery: 100 crude + 50 water → 25 heavy + 45 light + 55 petroleum), then crack all heavy oil to light and all light to petroleum. With no modules the balance is 20 refineries : 5 heavy crackers : 17 light crackers. Productivity or speed modules shift these counts.",
    },
    {
        title: "Rocket",
        chain: [
            { key: "rocket-part", count: 100, label: "Rocket parts" },
            { key: "rocket-silo", count: 1, label: "Rocket silo" },
        ],
        result: "1 launch",
        note: "Each rocket part costs 10 low-density structures + 10 rocket fuel + 10 processing units, so one launch consumes 1000 of each. An unmoduled silo (3 s per part) assembles a rocket in 5 minutes.",
    },
    {
        title: "Kovarex enrichment",
        chain: [
            { key: "uranium-238", count: 3, label: "U-238 in" },
            { key: "uranium-235", count: 1, label: "U-235 out" },
        ],
        result: "+1 U-235 per centrifuge-minute",
        note: "One Kovarex cycle (60 s) takes 40 U-235 + 5 U-238 into the centrifuge and returns 41 + 2 — a net +1 U-235 for 3 U-238 every minute, once the 40-piece starter stock is saved up. Regular uranium processing only yields U-235 0.7% of the time, so Kovarex is what turns the leftover U-238 pile into reactor and ammo fuel.",
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
