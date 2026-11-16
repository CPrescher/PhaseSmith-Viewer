"""Real-browser coordination regression: run Vite on :4178.

public/examples/forsterite.cif is the PCK 2026–27 week 4 source
_Projekt/Strukturen/Forsterit.cif, AMCSD 0001118, Bostrom (1987),
American Mineralogist 72, 965–972, XNi2+ = 0.00.
"""

import asyncio
import json
import os
from pathlib import Path
import tempfile
from playwright.async_api import async_playwright
from smoke import URL, HERE, diagnostics, settle


async def click_control(page, control, touch):
    if touch:
        await control.scroll_into_view_if_needed()
        box = await control.bounding_box()
        assert box
        await page.touchscreen.tap(
            box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        )
    else:
        await control.click()
    await settle(page)


async def run(browser_type, touch):
    options = {}
    override = os.environ.get(browser_type.name.upper() + "_EXECUTABLE")
    if override:
        options["executable_path"] = override
    elif not Path(browser_type.executable_path).exists():
        cache = Path.home() / "Library/Caches/ms-playwright"
        pattern = (
            "chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            if browser_type.name == "chromium"
            else "webkit-*/pw_run.sh"
        )
        candidates = sorted(cache.glob(pattern))
        if candidates:
            options["executable_path"] = str(candidates[-1])
    browser = await browser_type.launch(**options)
    context = await browser.new_context(
        viewport={"width": 1024, "height": 768}, has_touch=touch
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function('typeof window.viewerDiagnostics === "function"')
    await page.locator("#file").set_input_files(
        HERE.parent / "public/examples/forsterite.cif"
    )
    await page.wait_for_function(
        'window.viewerDiagnostics().atoms.some(a => a.element === "Mg")'
    )
    while await page.locator("#pair-rules .pair-rule").count():
        await click_control(
            page, page.locator('#pair-rules button[aria-label^="Delete "]').first, touch
        )
    await click_control(page, page.locator("#add-rule"), touch)
    rows = page.locator("#pair-rules .pair-rule")

    async def configure(row, center, cutoff):
        await row.locator('[data-field="center"]').select_option(center)
        await row.locator('[data-field="neighbor"]').select_option("O")
        await row.locator('[data-field="cutoff"]').fill(str(cutoff))
        await row.locator('[data-field="cutoff"]').dispatch_event("change")
        await settle(page)

    await configure(rows.nth(0), "Si", 2.0)
    await click_control(page, page.locator("#add-rule"), touch)
    await configure(rows.nth(1), "Mg", 2.3)
    d = await diagnostics(page)

    async def toggle(index, field):
        await click_control(
            page, rows.nth(index).locator(f'[data-field="{field}"]'), touch
        )
        return (await diagnostics(page))["coordination"]

    c = await toggle(0, "bonds")
    assert c["bondCount"] > 0 and c["polyhedronCount"] == 0, c
    si_bonds = c["bondCount"]
    c = await toggle(1, "bonds")
    assert c["bondCount"] > si_bonds, c
    assert [r["counts"] for r in c["rules"]] == [[4], [6]], c
    c = await toggle(0, "polyhedra")
    assert c["polyhedronCount"] > 0 and c["isolated"], c
    d = await diagnostics(page)
    assert {a["element"] for a in d["atoms"]} == {"Si", "O"}, d["coordination"]
    assert d["coordination"]["outsideAtomCount"] > 0
    assert len(
        {(a["sourceIndex"], tuple(round(v, 7) for v in a["frac"])) for a in d["atoms"]}
    ) == len(d["atoms"])
    assert all(
        len(e["vertices"]) == 4 and e["edgeCount"] == 6
        for e in c["rules"][0]["environments"]
    ), c
    si_poly = c["polyhedronCount"]
    c = await toggle(1, "polyhedra")
    assert c["polyhedronCount"] > si_poly, c
    assert all(
        len(e["vertices"]) == 6 and e["edgeCount"] == 12
        for e in c["rules"][1]["environments"]
    ), c
    c = await toggle(0, "polyhedra")
    d = await diagnostics(page)
    assert {a["element"] for a in d["atoms"]} == {"Mg", "O"}, d["coordination"]
    assert (
        c["rules"][0]["polyhedronCount"] == 0 and c["rules"][1]["polyhedronCount"] > 0
    ), c
    await configure(rows.nth(1), "Mg", 2.15)
    c = (await diagnostics(page))["coordination"]
    assert c["rules"][1]["counts"] == [3, 6], c
    assert c["rules"][1]["siteCounts"] == {"Mg1": [6], "Mg2": [3]}, c
    await configure(rows.nth(1), "Mg", 1.0)
    assert not (await diagnostics(page))["atoms"], (
        "Incomplete shells left loose atoms in isolation mode"
    )
    await configure(rows.nth(1), "Mg", 2.3)
    await toggle(0, "polyhedra")
    # Native pointer/touch picking of an unobscured periodic ligand.
    d = await diagnostics(page)
    import math

    targets = [
        a
        for a in d["atoms"]
        if a["outsideCell"]
        and 390 < a["x"] < 1000
        and 80 < a["y"] < 690
        and all(
            a["id"] == b["id"] or math.dist((a["x"], a["y"]), (b["x"], b["y"])) > 24
            for b in d["atoms"]
        )
    ]
    assert targets, "No unobscured periodic ligand"
    a = targets[0]
    if touch:
        await page.touchscreen.tap(a["x"], a["y"])
    else:
        await page.mouse.click(a["x"], a["y"])
    await settle(page)
    assert a["id"] in (await diagnostics(page))["selectedIds"]
    screenshot = (
        Path(tempfile.gettempdir())
        / f"coordination-{browser_type.name}-{'touch' if touch else 'mouse'}.png"
    )
    await page.screenshot(path=str(screenshot))
    await page.locator("#file").set_input_files(HERE / "known-distance.cif")
    await page.wait_for_function(
        "window.viewerDiagnostics().block === 'periodic_distance'"
    )
    d = await diagnostics(page)
    assert (
        d["coordination"]["rules"] == []
        and d["coordination"]["bondCount"] == 0
        and d["coordination"]["polyhedronCount"] == 0
    ), d
    assert len(d["atoms"]) == 9 and not d["selectedIds"], d
    assert not errors, errors
    await browser.close()
    return {"browser": browser_type.name, "touch": touch, "errors": errors}


async def main():
    async with async_playwright() as p:
        for browser, touch in (
            (p.chromium, False),
            (p.chromium, True),
            (p.webkit, True),
        ):
            print(json.dumps(await run(browser, touch)), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
