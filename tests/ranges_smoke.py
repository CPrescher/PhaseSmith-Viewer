from smoke import reveal_control
"""Native browser acceptance for independently editable fractional display bounds."""

import asyncio
import itertools
import json
import math
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, HERE, diagnostics, settle, choose_tool
from coordination_smoke import click_control


def atom_key(a):
    return f"{a['sourceIndex']}:" + ",".join(str(round(v * 1e9)) for v in a["frac"])


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
        viewport={"width": 1024 if touch else 1200, "height": 768 if touch else 850},
        has_touch=touch,
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL + "?example=wollastonite")
    await page.wait_for_function(
        'typeof window.viewerDiagnostics === "function" && window.viewerDiagnostics().atoms.some(a => a.element === "Si")'
    )
    await settle(page)
    # The public example is a real teaching CIF, not a synthetic chain.
    assert "wollaston" in (await diagnostics(page))["block"].lower()
    await click_control(page, page.locator("#measure-distance"), touch)
    await choose_tool(page, "#mode-pairs")
    rows = page.locator("#pair-rules .pair-rule")
    while await rows.count():
        await click_control(page, rows.first.locator('button[aria-label^="Delete "]'), touch)
    await click_control(page, page.locator("#add-rule"), touch)
    row = rows.first
    await row.locator('[data-field="center"]').select_option("Si")
    await row.locator('[data-field="neighbor"]').select_option("O")
    await row.locator('[data-field="cutoff"]').fill("1.8")
    # Enter commits the typed cutoff and closes its tuner (which covers the
    # Bonds/Polyhedra row while open).
    await row.locator('[data-field="cutoff"]').press("Enter")
    if not await row.locator('[data-field="polyhedra"]').is_checked():
        await click_control(page, row.locator('[data-field="polyhedra"]'), touch)
    await reveal_control(page, "#polyhedra-only")
    if not await page.locator("#polyhedra-only").is_checked():
        await click_control(page, page.locator("#polyhedra-only"), touch)
    await settle(page)
    await click_control(page, page.locator("#mode-extent"), touch)
    await click_control(page, page.locator("#range-reset"), touch)
    initial = await diagnostics(page)
    base = len(initial["coordination"]["rules"][0]["environments"])
    assert base == 6, base

    async def bound(axis, end, value):
        control = page.locator(f"#range-{axis}-{end}")
        await control.fill(str(value))
        await click_control(
            page, page.locator('#range-apply'), touch
        )
        await settle(page)

    await bound("b", "max", 3)
    d = await diagnostics(page)
    envs = d["coordination"]["rules"][0]["environments"]
    assert len(envs) == 3 * base, len(envs)
    assert all(len(e["vertices"]) == 4 and e["edgeCount"] == 6 for e in envs)
    lookup = {atom_key(a): a for a in d["atoms"]}
    links = [
        (a, b, set(a["vertices"]) & set(b["vertices"]))
        for a, b in itertools.combinations(envs, 2)
        if set(a["vertices"]) & set(b["vertices"])
    ]
    assert len(links) == 16, len(links)
    assert len(set(v for e in envs for v in e["vertices"])) == 56
    crossing = [
        link
        for link in links
        if math.floor(lookup[link[0]["center"]]["frac"][1] + 1e-8)
        != math.floor(lookup[link[1]["center"]]["frac"][1] + 1e-8)
    ]
    assert len(crossing) == 4, len(crossing)
    assert all(lookup[v]["element"] == "O" for _, _, shared in crossing for v in shared)
    # Select a translated center and a neighboring O through the actual canvas.
    canvas = await page.locator("canvas").first.bounding_box()
    candidates = []
    for e in envs:
        a = lookup[e["center"]]
        if a["frac"][1] < 1:
            continue
        for key in e["vertices"]:
            b = lookup[key]
            if all(
                canvas["x"] + 25 < t["x"] < canvas["x"] + canvas["width"] - 25
                and canvas["y"] + 70 < t["y"] < canvas["y"] + canvas["height"] - 25
                and all(
                    t["id"] == o["id"]
                    or math.dist((t["x"], t["y"]), (o["x"], o["y"])) > 9
                    for o in d["atoms"]
                )
                for t in (a, b)
            ):
                candidates.append((a, b))
    assert candidates, "No unobscured translated center/ligand measurement pair"
    a, b = candidates[0]
    for t in (a, b):
        if touch:
            await page.touchscreen.tap(t["x"], t["y"])
        else:
            await page.mouse.click(t["x"], t["y"])
    await settle(page)
    measured = await diagnostics(page)
    assert set(measured["selectedIds"]) == {a["id"], b["id"]}, measured["selectedIds"]
    assert (
        abs(float(measured["distance"]) - math.dist(a["cartesian"], b["cartesian"]))
        < 1e-5
    )
    await page.screenshot(path=f"/tmp/ranges-{browser_type.name}-{touch}.png")

    await bound("a", "min", -0.5)
    await bound("a", "max", 0.75)
    await bound("b", "min", -0.25)
    await bound("c", "max", 0.5)
    before = await diagnostics(page)
    assert before["ranges"] == [[-0.5, 0.75], [-0.25, 3], [0, 0.5]], before["ranges"]
    await bound("a", "min", 2)
    after = await diagnostics(page)
    assert after["ranges"] == before["ranges"]
    assert [(a["sourceIndex"], a["frac"]) for a in after["atoms"]] == [
        (a["sourceIndex"], a["frac"]) for a in before["atoms"]
    ]
    assert await page.locator("#range-error").inner_text()
    assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
        "Horizontal tablet overflow"
    )
    await page.locator("#file").set_input_files(HERE / "known-distance.cif")
    await page.wait_for_function(
        "window.viewerDiagnostics().block === 'periodic_distance'"
    )
    d = await diagnostics(page)
    assert d["ranges"] == [[0, 1], [0, 1], [0, 1]], d["ranges"]
    assert len(d["atoms"]) > 0 and not d["selectedIds"]
    assert not d["coordination"]["polyhedronCount"]
    assert not errors, errors
    await browser.close()
    return {
        "browser": browser_type.name,
        "touch": touch,
        "tetrahedra": len(envs),
        "shared_links": len(links),
        "cross_cell_links": len(crossing),
        "errors": errors,
    }


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
