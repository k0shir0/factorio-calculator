#!/usr/bin/env python3
"""Import top-favorited blueprints from factorioprints.com into content/blueprints/.

FactorioPrints exposes a publicly readable Firebase realtime database; this
script pulls the most-favorited prints, keeps only vanilla-2.0-compatible ones
whose blueprint strings actually decode, and writes them in this repo's
article.json format. Each generated article credits the original author and
links back to the FactorioPrints post.

Usage (run from the repo root):
    python tools/import-factorioprints.py fetch    # download data into tools/.fp-cache/
    python tools/import-factorioprints.py report   # triage table: decode status, unknown names
    python tools/import-factorioprints.py write    # generate content/blueprints/ + index.json

fetch is polite (throttled) and resumable; report/write work purely from the
cache. Curation lives in the dicts below (REJECT, CATEGORY, SUMMARY,
EXTRA_VANILLA) so the whole import is reproducible.
"""

import base64
import io
import json
import re
import sys
import time
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".fp-cache"
CONTENT = ROOT / "content" / "blueprints"
DATA_FILE = ROOT / "data" / "vanilla-2.0.55.json"

FIREBASE = "https://facorio-blueprints.firebaseio.com"
SUMMARY_COUNT = 150          # how many top-favorited prints to consider
MAX_STRING_BYTES = 2_000_000 # skip giant blueprint books
MAX_IMAGE_BYTES = 800_000    # firebasestorage fallback size cap
USER_AGENT = "factorio-calculator-blueprint-import/1.0 (github.com/k0shir0/factorio-calculator)"

# Slugs that are hand-authored in this repo; never overwritten.
HANDMADE = {"boiler-and-steam-engine-setup", "output-lane-balancer", "science-lab-setup"}

# ---------------------------------------------------------------------------
# Curation (filled in during triage)
# ---------------------------------------------------------------------------

# print id -> reason it is excluded (Space Age / modded / superseded / etc.)
REJECT = {
    "-L-AH-1ky1OVEvqy8_ti": "modded (small-electric-pole-2)",
    "-L8EWC3eaQfu76kF1K4Y": "modded (creative-mode chest)",
    "-OALgRNkWyBeeSIofrDh": "Space Age fluids (ammonia, fluoroketone barrels)",
    "-LZqEY3DcOLBx_kiyjim": "author marks it obsolete, superseded by -KnQ865j-qQ21WoUPbd3",
}

# print id -> gallery category. Every accepted print needs one.
CATEGORY = {
    "-KnQ865j-qQ21WoUPbd3": "Science",
    "-LV4ZJpfgpKKUkyodKiz": "Science",
    "-Kv98Ua8jl-tzglA7cp6": "Science",
    "-Kifx85ww99ZWLB-n-9S": "Science",
    "-Kj8bHstSx0LnWi6rqhU": "Science",
    "-KjZ17-ZfirKJBYRQT9X": "Belts & Balancers",
    "-KjZ0Rk_VXbdnxJ9jmUj": "Belts & Balancers",
    "-KjZ0gM62ddYvQA-mjiG": "Belts & Balancers",
    "-KjYAnqi971rVjBFIJMg": "Belts & Balancers",
    "-KjYBPkhc3qmG-cjAEcQ": "Belts & Balancers",
    "-KjYC--R9136wrJ3GJw1": "Belts & Balancers",
    "-Kkg4UNWOUDvybA9LeH_": "Belts & Balancers",
    "-KkfMB9sDjnYEVv2A7h7": "Belts & Balancers",
    "-KkfdBfOpOJ3Ty-mA5bR": "Belts & Balancers",
    "-ML5RsMXhj7tnbbzs02H": "Belts & Balancers",
    "-KioxPCe3zEvkTMzU2KN": "Belts & Balancers",
    "-KolvieQDa6BwdyXVNB8": "Belts & Balancers",
    "-LI0gc-a-2_VLWR-tx1d": "Starter Base",
    "-LrxBIuzRGB9jKLgPRqH": "Starter Base",
    "-KuGj0uUTKl8VpIau-_l": "Starter Base",
    "-LKIZarSTTZaO1_YpKXw": "Starter Base",
    "-LvWjwX1U25krBg-auKR": "Starter Base",
    "-LM4wBxeno99kepyTzDt": "Starter Base",
    "-Lhc1ZNoWVXaFBjQtqrU": "Starter Base",
    "-LZnvfhjmTqgTFnbWaWZ": "Starter Base",
    "-KolsaVErPTIBvfKk5uz": "Starter Base",
    "-Kn2afLokZdBO-uHcIAF": "Power",
    "-KYeNAYQVgk2DcbuORde": "Power",
    "-KjUiaibx5dJBC9svbMy": "Power",
    "-KoC28rMIQXCWWTHCxMp": "Power",
    "-LGzh1rL3S0dU-eJHfcr": "Power",
    "-KoltGTOcRBjmz4tieoA": "Power",
    "-Kl-a5-7hM9UdJQEYzjU": "Power",
    "-L5F2qiGFzcnPhWeSDtn": "Power",
    "-KjmRXj1uY-0VKIPzJuB": "Power",
    "-KYpTULTDIvDOsJfgjeS": "Mall",
    "-K_Me61B1oQ_Dmjbde9B": "Mall",
    "-KipClGfrJ9Bntuimft_": "Mall",
    "-L_03eJDny3Oir_K2sv-": "Mall",
    "-LKP3u-fYMTzons91uit": "Mall",
    "-MKMaZ2MpCYf7tMYFKMZ": "Mall",
    "-KoqhnFNxKU7FZqEi79w": "Mall",
    "-KoqizrS1hTxeWQP9JKD": "Mall",
    "-O9VOykV4CirECeCrQdq": "Mall",
    "-LZ32cSNYn9_J1PHsVMa": "Mall",
    "-LZrA2MkOQYKw5Wklea4": "Mall",
    "-LbP47CtKAiwauLskTo2": "Mall",
    "-L2vf5RR1laceC7w4pm7": "Mall",
    "-KudzGB86nFE7YTo2Mag": "Mall",
    "-KietyiL1H-mqf01qnxZ": "Mall",
    "-KjJ3CtQJvF3lWYrJTXV": "Mall",
    "-KjZIX7kOZQkjNigDi9o": "Smelting & Mining",
    "-L0AA-VH9GlXbgWAffhU": "Smelting & Mining",
    "-KlDJ21sGdPMmjaIK689": "Smelting & Mining",
    "-KoluN5jvWgI0egykK_W": "Smelting & Mining",
    "-LGZibw9_MsTwgweiHDZ": "Smelting & Mining",
    "-Lebyj-QESz_DofU_Ud3": "Smelting & Mining",
    "-LGWD0KUVgK6q4I6n9O1": "Smelting & Mining",
    "-LPg7BaSAJw7kbK7DAln": "Smelting & Mining",
    "-Km3O-6daMY2OZru9ipg": "Smelting & Mining",
    "-KkH4d9AFPh4AqjEChpR": "Smelting & Mining",
    "-KoMuqtFuzvniatJuoa7": "Oil & Chemicals",
    "-KjJ6MvDSt-GWrthi9Z4": "Oil & Chemicals",
    "-LX0DrUrauJqH8cVAq6A": "Oil & Chemicals",
    "-Kp6dNEnTZ7BaQaY42iU": "Oil & Chemicals",
    "-Kp6dxRcQbpr7UrzJC6x": "Oil & Chemicals",
    "-LGHi7ojCPQofDsZb7Ug": "Oil & Chemicals",
    "-KjEMCewunRtmK5dCvyT": "Oil & Chemicals",
    "-LWY-DinCSVmp1fy3OVa": "Circuits",
    "-KjmZa8RznafImLVCmO1": "Circuits",
    "-KjiYBWKe7zQN9QdFTQE": "Circuits",
    "-KoqgcmWqjJGLf6csjL4": "Circuits",
    "-KYg56ks0BIqpNvpIHFm": "Circuits",
    "-KpX1-lyYhE-3-DfxTba": "Circuits",
    "-Kp6eLXuhwCqXBXr0ltW": "Circuits",
    "-Ko4Un71BhDDTUvorRv5": "Trains & Rails",
    "-LfpQ63zCDlI03H8sH8_": "Trains & Rails",
    "-MKjG_WGMofYRTjqKl97": "Trains & Rails",
    "-K_VpUtsGAlQeBuZ1oez": "Trains & Rails",
    "-KvvSn0n4VDRCZxJlZbq": "Trains & Rails",
    "-Kroion4ELi9I7EiJ9XC": "Trains & Rails",
    "-KjYZyOEXtpW0OyjrC0D": "Trains & Rails",
    "-KjELJNoIpt6pewqi-Fz": "Trains & Rails",
    "-L9sMnI9prR83xg54NjG": "Trains & Rails",
    "-LaBW5bbDMIhZqd8-HDT": "Trains & Rails",
    "-Ld_Aek4jcDsbn8TV7GK": "Trains & Rails",
    "-LW6jFklIvbTruKnJHmJ": "Trains & Rails",
    "-LE0_ttF6cJPoiFi5l6u": "Trains & Rails",
    "-LUlUGdC3vejrp2Q6brd": "Trains & Rails",
    "-LmX7Wv397nenI_lILBD": "Trains & Rails",
    "-OA2Y5wpGsBswVdLFBeS": "Trains & Rails",
    "-KvTo4ycaiyxmsDlfwVQ": "Logistics",
    "-LG6lG4ros7_dUCGICUW": "Logistics",
    "-L0UQoaAhuOx6QzuojO6": "Logistics",
    "-MIMpsZJa9WHxI4H6fcD": "Production Blocks",
    "-LOAVA6Unf_1BxVkbbSk": "Production Blocks",
    "-Lr1EMRsMFcK4N-Im6Df": "Production Blocks",
    "-M4QXutKEXWAM-kEnOi4": "Production Blocks",
    "-Km1lkj01tpm3xAupmp_": "Production Blocks",
    "-LXbIUFG7ube0oKnTPVM": "Production Blocks",
    "-L29NrayplMDGheYeQGm": "Military",
}

# print id -> 1-2 sentence summary (own words), only where the original
# FactorioPrints post has a description worth summarizing.
SUMMARY = {
    "-KnQ865j-qQ21WoUPbd3": "Compact, tileable production tiles for every science pack, designed to start small and add more tiles as research speeds up. Works in 1.0 through 2.0 (Nauvis-only in Space Age).",
    "-LV4ZJpfgpKKUkyodKiz": "A tileable blueprint per science pack for all seven packs, meant to be dropped in as your base grows.",
    "-LI0gc-a-2_VLWR-tx1d": "All 45 blueprints from Nilaus' classic Base-in-a-Book let's-play series collected into one book.",
    "-LrxBIuzRGB9jKLgPRqH": "The 0.17 refresh of Nilaus' Base-in-a-Book collection (45 blueprints).",
    "-KjZ0Rk_VXbdnxJ9jmUj": "Part 1 of the Complete Belt Series: 65 yellow-belt balancers and arrays covering everything you need for belt work.",
    "-KjZ0gM62ddYvQA-mjiG": "Part 2 of the Complete Belt Series: the same 65 balancer layouts built with red belts.",
    "-KjZ17-ZfirKJBYRQT9X": "Part 3 of the Complete Belt Series: the 65 balancer layouts in blue-belt form.",
    "-KjYAnqi971rVjBFIJMg": "Addendum to the yellow-belt book with 9 extra balancer configurations.",
    "-KjYBPkhc3qmG-cjAEcQ": "Addendum to the red-belt book with 9 extra balancer configurations.",
    "-KjYC--R9136wrJ3GJw1": "Addendum to the blue-belt book with 9 extra balancer configurations.",
    "-KkfMB9sDjnYEVv2A7h7": "Yellow-belt split-off and priority-splitter designs (20 blueprints) closing out the Complete Belt Series.",
    "-KkfdBfOpOJ3Ty-mA5bR": "Red-belt split-off and priority-splitter designs (20 blueprints) from the Complete Belt Series.",
    "-Kkg4UNWOUDvybA9LeH_": "Blue-belt split-off and priority-splitter designs (20 blueprints) from the Complete Belt Series.",
    "-KYpTULTDIvDOsJfgjeS": "One blueprint that assembles every belt tier, with requester chests so upgrading your belts recycles the old ones into the new.",
    "-K_Me61B1oQ_Dmjbde9B": "Companion to All the Belts: builds every inserter type, recycling old inserters through requester chests when you upgrade.",
    "-Kn2afLokZdBO-uHcIAF": "Compact, tileable, no-waste nuclear, solar and steam power designs, updated for Factorio 2.0 with better UPS.",
    "-KYeNAYQVgk2DcbuORde": "A tiling-ready solar array at 18:15 panel/accumulator ratio, just 1.2 accumulators short of perfect.",
    "-KjUiaibx5dJBC9svbMy": "480 MW of nuclear power squeezed into 48×48 tiles — 208 kW per tile.",
    "-KoC28rMIQXCWWTHCxMp": "Modular 4-reactor plant (48 heat exchangers, 84 turbines) with belted fuel and steam-tank buffering.",
    "-LGzh1rL3S0dU-eJHfcr": "477 MW four-reactor plant with circuit-controlled fuelling that only burns cells when steam runs low.",
    "-KoltGTOcRBjmz4tieoA": "Modular early-game steam power block: 4 boilers and 8 steam engines, from the Base-in-a-Book series.",
    "-Kl-a5-7hM9UdJQEYzjU": "Combinator gadget that lights a row of lamps per 10% of stored power and sounds an alarm when the network dips below 20%.",
    "-L5F2qiGFzcnPhWeSDtn": "Full uranium chain in one facility: ore in, Kovarex enrichment, fuel cells and reprocessing out. Built in 2.0, no DLC needed.",
    "-KjmRXj1uY-0VKIPzJuB": "A tidy Kovarex enrichment complex — the layout explains itself in the screenshot.",
    "-KjZIX7kOZQkjNigDi9o": "Six tested smelter arrays that each saturate their belt tier, from yellow up to blue.",
    "-L0AA-VH9GlXbgWAffhU": "Tessellates 3 drills, 2 undergrounds and a pylon to pack the maximum number of miners onto a patch.",
    "-KlDJ21sGdPMmjaIK689": "Compact early-game smelting column from KatherineOfSky's 'Vanilla done right' series.",
    "-KoluN5jvWgI0egykK_W": "Early-game mining and smelting arrays sized to saturate a yellow belt, built to last into the mid game.",
    "-LGZibw9_MsTwgweiHDZ": "Train-fed smelting blocks producing 21.6k iron and copper plus 4.32k steel per minute.",
    "-Lebyj-QESz_DofU_Ud3": "Belt-fed smelter book covering iron, copper, stone and steel at every belt tier.",
    "-LGWD0KUVgK6q4I6n9O1": "30 smelting layouts for iron, copper and steel, including beaconed end-game variants.",
    "-Km3O-6daMY2OZru9ipg": "Tileable-in-all-directions smelting layouts for every furnace tier.",
    "-KkH4d9AFPh4AqjEChpR": "Electric-furnace plant with four balanced input and output lanes on red belts.",
    "-KoMuqtFuzvniatJuoa7": "Beaconless advanced oil processing block that runs fine without robots — buildable by hand mid-game.",
    "-KjJ6MvDSt-GWrthi9Z4": "Refinery that fits inside one roboport logistic area so tiled copies build themselves.",
    "-LX0DrUrauJqH8cVAq6A": "Large circuit-controlled refinery that cracks oil to hold ~90k petroleum gas in storage, with an add-on module for extra gas.",
    "-Kp6dNEnTZ7BaQaY42iU": "Three stacked blueprints for basic, advanced and cracking oil setups that overlay each other as your base matures.",
    "-Kp6dxRcQbpr7UrzJC6x": "Efficient plastic and sulfuric acid blocks — the two workhorses of oil processing.",
    "-LGHi7ojCPQofDsZb7Ug": "Expandable refinery book producing gas, both oils, lubricant, sulfur, acid, solid fuel and explosives; beacon-ready.",
    "-KjEMCewunRtmK5dCvyT": "Tileable battery plant: plates and acid in, batteries out.",
    "-LWY-DinCSVmp1fy3OVa": "Belted, robot-free production for green, red and blue circuits at multiple scales (21 blueprints).",
    "-KjmZa8RznafImLVCmO1": "Tileable red-circuit octagon fed by a half-plastic/half-copper belt.",
    "-KjiYBWKe7zQN9QdFTQE": "Compact processing-unit complex for the mid game; swap in level-3 assemblers late game.",
    "-KoqgcmWqjJGLf6csjL4": "Scalable modular green-circuit build that starts small and scales to blue belts on a main bus.",
    "-KYg56ks0BIqpNvpIHFm": "Turns a blue belt of iron and a blue belt of copper into a full belt of green circuits.",
    "-KpX1-lyYhE-3-DfxTba": "Two blue-circuit blueprints sized for different base scopes, from KatherineOfSky's series.",
    "-Kp6eLXuhwCqXBXr0ltW": "Two modular red-circuit variants sized to fill a red or blue belt.",
    "-Ko4Un71BhDDTUvorRv5": "Six chunk-aligned RHD rail pieces with power and circuit wires built in — build in chunks with the F4 grid.",
    "-LfpQ63zCDlI03H8sH8_": "ElderAxe's chunk-snapped 4-lane right-hand-drive rail set (18 pieces).",
    "-MKjG_WGMofYRTjqKl97": "ElderAxe's chunk-snapped 2-lane right-hand-drive rail set (13 pieces).",
    "-K_VpUtsGAlQeBuZ1oez": "Artentus' modular rail network: 20 snap-together pieces for building a full railway grid.",
    "-KvvSn0n4VDRCZxJlZbq": "Compact unloading hub plus mining outpost stations for 2-4 and 4-8 trains.",
    "-KjYZyOEXtpW0OyjrC0D": "The famous compact Celtic-knot four-way intersection, RHD.",
    "-KjELJNoIpt6pewqi-Fz": "Double unloading station with wired chests and inserters that keep the output belts compressed and balanced.",
    "-L9sMnI9prR83xg54NjG": "Station-building rail book: 2- and 4-car curves plus 2/4/8-car stackers in 4- and 8-lane variants.",
    "-LaBW5bbDMIhZqd8-HDT": "NRC's tileable railway system — 58 snap-together pieces.",
    "-Ld_Aek4jcDsbn8TV7GK": "Modular parts for balanced 2-4 RHD loading and unloading stations, with even wagon unloading.",
    "-LW6jFklIvbTruKnJHmJ": "Side-balanced train unloaders for 1-4 wagons that drain buffer chests evenly.",
    "-LE0_ttF6cJPoiFi5l6u": "Chunk-aligned 4-lane modular rail system, pre-wired with power and both signal cables.",
    "-LUlUGdC3vejrp2Q6brd": "A fully automated vanilla train network that dispatches idle trains on demand, LTN-style without mods.",
    "-LmX7Wv397nenI_lILBD": "Four books of LHD tracks, stations and trains for 3-8 rail systems.",
    "-OA2Y5wpGsBswVdLFBeS": "A 2.0 rail book (33 prints) using the new curved rails; despite the name it needs no DLC.",
    "-KipClGfrJ9Bntuimft_": "KatherineOfSky's classic early-game shopping mall.",
    "-L_03eJDny3Oir_K2sv-": "Self-contained factory that builds everything needed to jump from early to mid game, with near-full coverage of common items.",
    "-LKP3u-fYMTzons91uit": "Huge belt-based, circuit-controlled mall with integrated logistic storage.",
    "-MKMaZ2MpCYf7tMYFKMZ": "41-part modular mall with a standardized belt interface (built for 1.1; don't bulk-upgrade its interwoven belts).",
    "-KoqhnFNxKU7FZqEi79w": "Assembler arrays for all belts, undergrounds, splitters, inserters and assemblers — early and late-game variants.",
    "-KoqizrS1hTxeWQP9JKD": "Five themed mall modules (trains, production, nuclear, high tech, circuits) instead of one monolithic make-everything block.",
    "-O9VOykV4CirECeCrQdq": "Fully automatic mall for 2.0 that crafts what you're low on using the new combinator logic.",
    "-LZ32cSNYn9_J1PHsVMa": "Belt-driven item factory that builds nearly everything requestable from the logistic network (25 blueprints).",
    "-LZrA2MkOQYKw5Wklea4": "One-print big mall covering nearly everything except military and equipment.",
    "-LbP47CtKAiwauLskTo2": "The 'mall to end all malls': 17 fully modular sections, discussed at length on Reddit.",
    "-L2vf5RR1laceC7w4pm7": "Module production book: two blueprints per module type, with and without beacons.",
    "-KudzGB86nFE7YTo2Mag": "Perfect-ratio module assembly setup by 6180339887, compact and tileable.",
    "-KietyiL1H-mqf01qnxZ": "Builds trains, rails and rail infrastructure, including the fluid wagon.",
    "-KjJ3CtQJvF3lWYrJTXV": "jonts26's compact block that assembles every inserter type.",
    "-KvTo4ycaiyxmsDlfwVQ": "29×19 robot production block designed to get construction bots flying as early as possible.",
    "-LG6lG4ros7_dUCGICUW": "A collection of bot production plants whose frame assemblers pull from a belt loop.",
    "-L0UQoaAhuOx6QzuojO6": "Lamp-panel dashboards that visualize logistics stock and accumulator charge on the map.",
    "-KuGj0uUTKl8VpIau-_l": "Drop-in starter base to place as soon as Automation is researched; automates the very early game.",
    "-LKIZarSTTZaO1_YpKXw": "A beloved Reddit starter-base design preserved as a book of three prints.",
    "-LvWjwX1U25krBg-auKR": "Brian's 2.0 bootstrap book that takes a fresh map through the early game.",
    "-LM4wBxeno99kepyTzDt": "Quick-start base aimed squarely at reaching robots fast, then handing over to bot builds.",
    "-Lhc1ZNoWVXaFBjQtqrU": "Compact starter base producing 40 SPM with rocket — 100 SPM for red/green when upgraded to red belts; mall included.",
    "-LZnvfhjmTqgTFnbWaWZ": "Early-game base that rushes bots while keeping all sciences running.",
    "-KolsaVErPTIBvfKk5uz": "Three tiny bootstrap blueprints: red science + green circuits, gears + belts, and stone/furnace supply.",
    "-MIMpsZJa9WHxI4H6fcD": "110 blueprints collected from Nilaus' Factorio Master Class YouTube series.",
    "-LOAVA6Unf_1BxVkbbSk": "35 ready-made production blocks covering most vanilla intermediates.",
    "-Lr1EMRsMFcK4N-Im6Df": "ElderAxe's factory block collection (24 prints) for common intermediates.",
    "-M4QXutKEXWAM-kEnOi4": "A complete 2.5k SPM megabase as a 30-print book, designed to run without train deadlocks.",
    "-Km1lkj01tpm3xAupmp_": "Builds rockets from plates, coal and oil — everything between raw smelted inputs and the silo.",
    "-LXbIUFG7ube0oKnTPVM": "Rocket assembly plant producing one rocket per minute plus 40 seconds for the first.",
    "-L29NrayplMDGheYeQGm": "Five gun-turret perimeter defense patterns, each in five modular pieces.",
    "-KolvieQDa6BwdyXVNB8": "Reference book for splitting off and rebalancing a main bus: full-line, half-line and middle splits.",
    "-ML5RsMXhj7tnbbzs02H": "Raynquist's definitive balancer collection: every configuration from 1-1 to 9-9 plus larger ones, 184 prints, updated Fall 2025.",
    "-KioxPCe3zEvkTMzU2KN": "tuckjohn37's balancer compendium (37 prints) with tidy in-game icons, updated for 2.0.",
    "-Kv98Ua8jl-tzglA7cp6": "Belt-based (no bots) production for each science pack, sized for 1000 packs per minute.",
    "-Kifx85ww99ZWLB-n-9S": "Maser-kun's beaconed lab array — an optimized late-game science consumer.",
    "-Kj8bHstSx0LnWi6rqhU": "6180339887's classic all-six-sciences setup producing one pack per second each.",
}

# print id -> replacement title (rarely needed; e.g. emoji-heavy titles)
TITLE = {}

# Vanilla names that are legitimately placeable/referenced in blueprints but do
# not appear in data/vanilla-2.0.55.json (that file only covers the
# calculator's production items). Includes pre-2.0 names that Factorio 2.0
# migrates on import.
EXTRA_VANILLA = {
    # rails & trains (2.0 names + 1.x legacy names that the game migrates)
    "straight-rail", "curved-rail", "curved-rail-a", "curved-rail-b",
    "half-diagonal-rail", "rail", "rail-signal", "rail-chain-signal",
    "train-stop", "locomotive", "cargo-wagon", "fluid-wagon", "artillery-wagon",
    # logistic chests (2.0 names and 1.x legacy names)
    "passive-provider-chest", "active-provider-chest", "storage-chest",
    "buffer-chest", "requester-chest",
    "logistic-chest-passive-provider", "logistic-chest-active-provider",
    "logistic-chest-storage", "logistic-chest-buffer", "logistic-chest-requester",
    # inserters (1.x names migrate: filter-inserter -> inserter w/ filter,
    # stack-inserter -> bulk-inserter; see version-aware check below)
    "filter-inserter", "stack-filter-inserter", "bulk-inserter",
    # modules: 1.x "effectivity" spelling migrates to 2.0 "efficiency"
    "effectivity-module", "effectivity-module-2", "effectivity-module-3",
    # walls & military
    "stone-wall", "gate", "gun-turret", "laser-turret", "flamethrower-turret",
    "artillery-turret", "land-mine",
    # circuit network & misc entities
    "small-lamp", "arithmetic-combinator", "decider-combinator",
    "constant-combinator", "selector-combinator", "power-switch",
    "programmable-speaker", "display-panel",
    # tiles
    "stone-path", "concrete", "hazard-concrete-left", "hazard-concrete-right",
    "refined-concrete", "refined-hazard-concrete-left",
    "refined-hazard-concrete-right", "landfill",
    # editor-only helpers that appear in a few demo prints; they import fine
    "electric-energy-interface", "infinity-chest", "infinity-pipe",
    # removed/renamed pre-2.0 names; base-game migrations rewrite or drop
    # these on import, so the blueprints still install cleanly
    "science-pack-1", "science-pack-2", "science-pack-3",
    "high-tech-science-pack", "military-science-pack",
    "red-wire", "green-wire", "rocket-control-unit", "raw-wood",
    "iron-axe", "steel-axe", "empty-barrel", "used-up-uranium-fuel-cell",
    "fusion-reactor-equipment",
    "water-barrel", "crude-oil-barrel", "heavy-oil-barrel", "light-oil-barrel",
    "petroleum-gas-barrel", "lubricant-barrel", "sulfuric-acid-barrel",
}

# Names that exist only with the Space Age DLC (or 2.0+quality). Any hit
# rejects the print outright.
SPACE_AGE = {
    "foundry", "electromagnetic-plant", "biochamber", "cryogenic-plant",
    "biolab", "heating-tower", "lightning-rod", "lightning-collector",
    "tesla-turret", "railgun-turret", "rocket-turret", "agricultural-tower",
    "asteroid-collector", "crusher", "thruster", "cargo-landing-pad",
    "space-platform-hub", "cargo-bay", "fusion-reactor", "fusion-generator",
    "turbo-transport-belt", "turbo-underground-belt", "turbo-splitter",
    "big-mining-drill", "captive-biter-spawner",
    "quality-module", "quality-module-2", "quality-module-3",
    "recycler", "foundation", "rail-ramp", "rail-support",
    "artificial-yumako-soil", "overgrowth-yumako-soil",
    "artificial-jellynut-soil", "overgrowth-jellynut-soil", "ice-platform",
}

CATEGORIES = [
    "Science", "Smelting & Mining", "Belts & Balancers", "Trains & Rails",
    "Power", "Mall", "Circuits", "Oil", "Military", "Starter Base", "Logistics",
]

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def http_get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
        return data if binary else data.decode("utf-8")

def cache_json(name, fetch):
    """Fetch-once JSON cache under tools/.fp-cache/."""
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(0.15)
    return data

def decode_blueprint(bp_string):
    """Returns (root_kind, decoded_json) or raises ValueError."""
    s = bp_string.strip()
    if not s.startswith("0"):
        raise ValueError("bad version byte %r" % s[:1])
    raw = zlib.decompress(base64.b64decode(s[1:]))
    obj = json.loads(raw)
    for kind in ("blueprint", "blueprint_book", "upgrade_planner",
                 "deconstruction_planner"):
        if kind in obj:
            return kind, obj
    raise ValueError("unknown root %s" % list(obj.keys())[:3])

def game_version(obj):
    """(major, minor) from a decoded blueprint/book root."""
    root = next(iter(obj.values()))
    v = root.get("version", 0)
    return (v >> 48) & 0xFFFF, (v >> 32) & 0xFFFF

def count_blueprints(obj):
    kind, root = next(iter(obj.items())), None
    def walk(node):
        n = 0
        if isinstance(node, dict):
            if "blueprint" in node:
                n += 1
            for v in node.values():
                n += walk(v)
        elif isinstance(node, list):
            n = sum(walk(v) for v in node)
        return n
    return walk(obj)

def collect_names(node, out):
    """Every string under a "name" key, plus 1.x module-request item names."""
    if isinstance(node, dict):
        v = node.get("name")
        if isinstance(v, str):
            out.add(v)
        items = node.get("items")
        if isinstance(items, dict):
            # 1.x module requests are {item-name: count}; the 2.0 format is
            # {"in_inventory": [...], ...} whose keys are not item names.
            out.update(k for k, v in items.items()
                       if isinstance(k, str) and isinstance(v, int))
        for key, v in node.items():
            if key != "name":
                collect_names(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_names(v, out)

def has_quality(node):
    if isinstance(node, dict):
        q = node.get("quality")
        if isinstance(q, str) and q not in ("", "normal"):
            return True
        return any(has_quality(v) for v in node.values())
    if isinstance(node, list):
        return any(has_quality(v) for v in node)
    return False

def vanilla_allowlist():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    allow = {it["key"] for it in data["items"]}
    allow |= {r["key"] for r in data["recipes"]}
    allow |= {f["item_key"] for f in data["fluids"]}
    allow |= EXTRA_VANILLA
    return allow

def check_names(obj, allow):
    """Returns (space_age_hits, unknown_names). signal-* is always allowed."""
    names = set()
    collect_names(obj, names)
    sa = sorted(n for n in names if n in SPACE_AGE)
    # "stack-inserter" is the 1.x entity (migrates to bulk-inserter) but also
    # the SA-only 2.0 entity; disambiguate by blueprint version.
    if "stack-inserter" in names:
        major, _ = game_version(obj)
        if major >= 2:
            sa.append("stack-inserter (2.0 = Space Age only)")
    unknown = sorted(
        n for n in names
        if n not in allow and n not in SPACE_AGE
        # virtual signals (letters, colors, 2.0 rail shapes) are always fine
        and not n.startswith(("signal-", "shape-")) and n != "stack-inserter"
    )
    return sa, unknown

def slugify(title):
    s = title.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    words, out = s.split("-"), []
    for w in words:
        if len("-".join(out + [w])) > 48:
            break
        out.append(w)
    return "-".join(out) or "blueprint"

def fmt_version(major, minor):
    return f"{major}.{minor}"

# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

def cmd_fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    url = (f"{FIREBASE}/blueprintSummaries.json"
           f"?orderBy=%22numberOfFavorites%22&limitToLast={SUMMARY_COUNT}")
    summaries = cache_json("summaries.json", lambda: json.loads(http_get(url)))
    order = sorted(summaries, key=lambda k: -summaries[k].get("numberOfFavorites", 0))
    print(f"{len(order)} summaries")

    authors = {}
    for i, pid in enumerate(order):
        rec = cache_json(f"record-{pid}.json",
                         lambda p=pid: json.loads(http_get(f"{FIREBASE}/blueprints/{p}.json")))
        if not rec:
            continue
        uid = rec.get("authorId") or (rec.get("author") or {}).get("userId")
        if uid and uid not in authors:
            authors[uid] = cache_json(
                f"author-{uid}.json",
                lambda u=uid: json.loads(http_get(f"{FIREBASE}/users/{u}/displayName.json")))
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(order)} records")
    print("fetch done")

# ---------------------------------------------------------------------------
# shared analysis
# ---------------------------------------------------------------------------

def load_candidates():
    """Yields (pid, summary, record) in favorites order, cache only."""
    summaries = json.loads((CACHE / "summaries.json").read_text(encoding="utf-8"))
    order = sorted(summaries, key=lambda k: -summaries[k].get("numberOfFavorites", 0))
    for pid in order:
        path = CACHE / f"record-{pid}.json"
        if not path.exists():
            continue
        rec = json.loads(path.read_text(encoding="utf-8"))
        if rec:
            yield pid, summaries[pid], rec

def author_name(rec):
    uid = rec.get("authorId") or (rec.get("author") or {}).get("userId")
    if uid:
        path = CACHE / f"author-{uid}.json"
        if path.exists():
            name = json.loads(path.read_text(encoding="utf-8"))
            if name:
                return name
    return "unknown author"

def analyze(pid, rec, allow):
    """Returns dict with decode/filter results for one print."""
    out = {"pid": pid, "title": rec.get("title", "?"),
           "favorites": rec.get("numberOfFavorites", 0), "reject": None,
           "sa": [], "unknown": [], "version": None, "kind": None, "count": 0}
    if pid in REJECT:
        out["reject"] = REJECT[pid]
        return out
    tags = rec.get("tags") or []
    bad_tags = [t for t in tags if t.startswith("/mods/") and t != "/mods/vanilla/"]
    if bad_tags:
        out["reject"] = "mod tag " + ",".join(bad_tags)
        return out
    s = rec.get("blueprintString") or ""
    if not s:
        out["reject"] = "no blueprint string"
        return out
    if len(s) > MAX_STRING_BYTES:
        out["reject"] = f"string too big ({len(s) // 1024} KB)"
        return out
    try:
        kind, obj = decode_blueprint(s)
    except Exception as e:
        out["reject"] = f"decode failed: {e}"
        return out
    if kind not in ("blueprint", "blueprint_book"):
        out["reject"] = f"root is {kind}"
        return out
    out["kind"] = kind
    out["version"] = game_version(obj)
    out["count"] = count_blueprints(obj)
    if has_quality(obj):
        out["sa"].append("<quality fields>")
    sa, unknown = check_names(obj, allow)
    out["sa"] += sa
    out["unknown"] = unknown
    if out["sa"]:
        out["reject"] = "Space Age: " + ", ".join(out["sa"][:4])
    return out

# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------

def cmd_report():
    allow = vanilla_allowlist()
    accepted = flagged = 0
    for pid, _summary, rec in load_candidates():
        a = analyze(pid, rec, allow)
        desc = (rec.get("descriptionMarkdown") or "").replace("\n", " ")[:140]
        if a["reject"]:
            print(f"REJECT {pid} [{a['favorites']}] {a['title'][:60]}")
            print(f"       {a['reject']}")
        elif a["unknown"]:
            flagged += 1
            print(f"FLAG   {pid} [{a['favorites']}] {a['title'][:60]}")
            print(f"       unknown: {', '.join(a['unknown'][:10])}")
        else:
            accepted += 1
            cat = CATEGORY.get(pid, "!! NO CATEGORY")
            v = fmt_version(*a["version"]) if a["version"] else "?"
            print(f"OK     {pid} [{a['favorites']}] {a['title'][:60]}")
            print(f"       {a['kind']} v{v} x{a['count']}  cat={cat}  "
                  f"summary={'yes' if pid in SUMMARY else 'no'}")
            print(f"       desc: {desc}")
    print(f"\n{accepted} accepted, {flagged} flagged")

# ---------------------------------------------------------------------------
# write
# ---------------------------------------------------------------------------

THUMB_WIDTH = 480   # card-grid thumbnails (rendered at ~220-320 CSS px)
FULL_WIDTH = 1024   # article screenshot
# AVIF ~q60 matches WebP ~q80 visually at noticeably smaller sizes. Every
# major browser has decoded AVIF for years (Edge was last, early 2024).
IMG_OPTS = {"format": "AVIF", "quality": 60, "speed": 5}

def save_optimized(data, path, max_width):
    """Re-encodes image bytes as AVIF capped at max_width; returns True on success."""
    from PIL import Image
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        if im.width > max_width:
            im = im.resize((max_width, round(im.height * max_width / im.width)),
                           Image.LANCZOS)
        im.save(path, **IMG_OPTS)
        return True
    except Exception as e:
        print(f"       avif encode failed ({e})")
        return False

def fetch_image(pid, rec, img_dir):
    """Downloads the print's screenshot, stores it as AVIF (full article image
    plus a small card thumbnail); returns (image_name, thumb_name) or (None, None)."""
    image = rec.get("image") or {}
    imgur_id = image.get("id") or rec.get("imgurId")
    candidates = []
    if imgur_id:
        # 'h' suffix = 1024px thumbnail; still works for gif sources.
        candidates.append((f"https://i.imgur.com/{imgur_id}h.jpg", imgur_id))
    if rec.get("imageUrl"):
        candidates.append((rec["imageUrl"], "screenshot"))
    for url, stem in candidates:
        cache_path = CACHE / "images" / f"{pid}-{stem}.jpg"
        try:
            if cache_path.exists():
                data = cache_path.read_bytes()
            else:
                data = http_get(url, binary=True)
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_bytes(data)
                time.sleep(0.15)
        except Exception as e:
            print(f"       image fail {url}: {e}")
            continue
        # imgur serves a tiny placeholder for removed images
        if len(data) < 2000 or len(data) > MAX_IMAGE_BYTES:
            print(f"       image unusable ({len(data)} bytes) {url}")
            continue
        img_dir.mkdir(parents=True, exist_ok=True)
        full, thumb = f"{stem}.avif", f"{stem}-thumb.avif"
        if not save_optimized(data, img_dir / full, FULL_WIDTH):
            continue
        if not save_optimized(data, img_dir / thumb, THUMB_WIDTH):
            thumb = full  # fall back to the article image for the card
        return full, thumb
    return None, None

def body_markdown(pid, rec, a):
    author = author_name(rec)
    url = f"https://factorioprints.com/view/{pid}"
    lines = [f"By **{author}** — [View on FactorioPrints]({url})."]
    if pid in SUMMARY:
        lines += ["", SUMMARY[pid]]
    facts = []
    if a["kind"] == "blueprint_book":
        facts.append(f"Blueprint book with {a['count']} blueprints")
    major, minor = a["version"]
    if major >= 2:
        facts.append("made for Factorio 2.0")
    else:
        facts.append(f"made for Factorio {major}.{minor} — imports fine in 2.0, "
                     "the game migrates old entities automatically")
    lines += ["", "*" + "; ".join(facts) + ".*"]
    return "\n".join(lines)

def clean_tags(rec):
    tags = []
    for t in rec.get("tags") or []:
        t = t.strip("/").split("/")[-1].replace(",", ".")
        if t and t not in ("vanilla",) and t not in tags:
            tags.append(t)
    return tags

def cmd_write():
    allow = vanilla_allowlist()
    used_slugs = set(HANDMADE)
    entries = []
    written = 0
    for pid, _summary, rec in load_candidates():
        a = analyze(pid, rec, allow)
        if a["reject"] or a["unknown"]:
            continue
        if pid not in CATEGORY:
            print(f"SKIP (no category) {pid} {a['title'][:60]}")
            continue
        title = TITLE.get(pid, rec["title"]).strip()
        slug = slugify(title)
        while slug in used_slugs:
            slug += "-2"
        used_slugs.add(slug)

        art_dir = CONTENT / slug
        art_dir.mkdir(parents=True, exist_ok=True)
        fname, thumb = fetch_image(pid, rec, art_dir / "images")
        article = {
            "slug": slug,
            "title": title,
            "category": CATEGORY[pid],
            "tags": clean_tags(rec),
            "videoUrl": "",
            "thumbnail": thumb or "",
            "images": [fname] if fname else [],
            "blueprintString": rec["blueprintString"].strip(),
            "bodyMarkdown": body_markdown(pid, rec, a),
        }
        (art_dir / "article.json").write_text(
            json.dumps(article, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        entries.append({
            "slug": slug, "title": title, "category": CATEGORY[pid],
            "tags": article["tags"], "thumbnail": article["thumbnail"],
        })
        written += 1
        print(f"wrote  {slug}  ({'img' if fname else 'no img'})")

    # merge with the handmade articles, which own their manifest entries
    for slug in sorted(HANDMADE):
        art = json.loads((CONTENT / slug / "article.json").read_text(encoding="utf-8"))
        entries.append({
            "slug": art["slug"], "title": art["title"], "category": art["category"],
            "tags": art["tags"], "thumbnail": art["thumbnail"],
        })
    entries.sort(key=lambda e: e["title"].lower())
    index = {"blueprints": entries}
    (CONTENT / "index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n{written} articles written, {len(entries)} total in index.json")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "fetch":
        cmd_fetch()
    elif cmd == "report":
        cmd_report()
    elif cmd == "write":
        cmd_write()
    else:
        print(__doc__)
        sys.exit(1)
