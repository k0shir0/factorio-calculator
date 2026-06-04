/*Copyright 2015-2024 Kirk McDonald

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/

class ColorScheme {
    constructor(name, key, scheme) {
        this.name = name
        this.key = key
        this.scheme = scheme
    }
    apply() {
        let html = document.documentElement
        for (let [name, value] of this.scheme) {
            html.style.setProperty(name, value)
        }
    }
}

export let colorSchemes = [
    new ColorScheme(
        "Default",
        "default",
        // Black + mint-green. Keep these in sync with the :root values in
        // calc.css; this scheme is applied as inline styles at load time and
        // overrides the stylesheet, so it must carry the same palette.
        new Map([
            ["--dark", "#0b0f0d"],
            ["--dark-overlay", "rgba(11, 15, 13, 0.85)"],
            ["--medium", "#151b18"],
            ["--main", "#121815"],
            ["--light", "#25322b"],
            ["--foreground", "#cdd8d2"],
            ["--accent", "#3eb489"],
            ["--bright", "#eafff6"],
        ])
    ),
    new ColorScheme(
        "Printer-friendly",
        "printer",
        new Map([
            ["--dark", "#f0f0f0"],
            ["--dark-overlay", "#ffffff"],
            ["--medium", "#ffffff"],
            ["--main", "#ffffff"],
            ["--light", "#dddddd"],
            ["--foreground", "#000000"],
            ["--accent", "#222222"],
            ["--bright", "#111111"],
        ])
    )
]
