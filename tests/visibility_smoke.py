"""Native rendering acceptance for rule opacity and atom visibility controls."""

import asyncio
import json
import math
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle
from coordination_smoke import click_control


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
    await page.goto(URL + "?example=forsterite")
    await page.wait_for_function(
        'typeof window.viewerDiagnostics === "function" && window.viewerDiagnostics().atoms.some(a => a.element === "Mg")'
    )
    await settle(page)
    await click_control(page, page.locator("#mode-extent"), touch)
    await page.locator("#range-b-max").fill("2")
    await click_control(page, page.locator('#range-form button[type="submit"]'), touch)
    await click_control(page, page.locator("#mode-pairs"), touch)
    # Start from a deliberately changed zoom, so a silent refit is detectable.
    canvas = page.locator("canvas").first
    box = await canvas.bounding_box()
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    await page.mouse.wheel(0, -100)
    await settle(page)
    await page.wait_for_timeout(600)
    baseline = await diagnostics(page)

    def shape(d):
        return [(r["center"], r["environments"]) for r in d["coordination"]["rules"]]

    async def unchanged():
        d = await diagnostics(page)
        assert math.dist(d["camera"]["position"], baseline["camera"]["position"]) < 0.02
        assert d["camera"]["up"] == baseline["camera"]["up"]
        assert d["camera"]["target"] == baseline["camera"]["target"]
        assert d["ranges"] == baseline["ranges"]
        assert shape(d) == shape(baseline)
        assert d["sphereGeometry"] == baseline["sphereGeometry"]
        assert [(m["geometry"], m["material"]) for m in d["faceMaterials"]] == [
            (m["geometry"], m["material"]) for m in baseline["faceMaterials"]
        ]
        return d

    rows = page.locator("#pair-rules .pair-rule")
    si = rows.filter(
        has=page.locator('[data-field="center"] option:checked[value="Si"]')
    )
    mg = rows.filter(
        has=page.locator('[data-field="center"] option:checked[value="Mg"]')
    )
    assert await si.count() == await mg.count() == 1

    async def opacity(row, value):
        control = row.locator('[data-field="opacity"]')
        await control.fill(str(round(value * 100)))
        await control.dispatch_event("input")
        await control.dispatch_event("change")
        await settle(page)
        return await unchanged()

    # Scene assertions below inspect Three.js materials, rather than input values.
    for value in (0, 0.5, 1):
        d = await opacity(si, value)
        surfaces = d["faceMaterials"]
        assert surfaces[0]["opacity"] == value, surfaces
        assert surfaces[0]["visible"] == (value > 0)
        assert surfaces[0]["depthWrite"] == (value == 1)
        assert surfaces[0]["transparent"] == (value < 1)
        assert surfaces[1]["opacity"] == 0.34, surfaces
        assert all(s["outlineVisible"] and s["vertexCount"] > 0 for s in surfaces)
    d = await opacity(mg, 0.5)
    assert [s["opacity"] for s in d["faceMaterials"]] == [1, 0.5]
    await opacity(si, 0.5)

    # Use a visibly isolated sphere as a stable real pointer target.
    d = await diagnostics(page)
    visible = [
        a
        for a in d["atoms"]
        if box["x"] + 20 < a["x"] < box["x"] + box["width"] - 20
        and box["y"] + 80 < a["y"] < box["y"] + box["height"] - 20
        and all(
            a["id"] == b["id"] or math.dist((a["x"], a["y"]), (b["x"], b["y"])) > 18
            for b in d["atoms"]
        )
    ]
    assert visible
    target = visible[0]

    async def pick():
        if touch:
            await page.touchscreen.tap(target["x"], target["y"])
        else:
            await page.mouse.click(target["x"], target["y"])
        await settle(page)

    await pick()
    assert target["id"] in (await diagnostics(page))["selectedIds"]
    await click_control(page, page.locator("#show-atoms"), touch)
    d = await unchanged()
    assert d["renderedAtomCount"] == 0
    assert d["selectionObjectCount"] == 0
    assert not d["selectedIds"]
    await pick()
    assert not (await diagnostics(page))["selectedIds"], "Hidden atoms were pickable"
    await click_control(page, page.locator("#show-atoms"), touch)
    d = await unchanged()
    assert d["renderedAtomCount"] > 0
    await pick()
    assert target["id"] in (await diagnostics(page))["selectedIds"]
    assert (await diagnostics(page))["selectionObjectCount"] > 0
    # Element-specific controls must leave the complete coordination geometry intact.
    await click_control(page, page.locator('[data-element="O"]'), touch)
    d = await unchanged()
    assert not any(a["element"] == "O" and a["visible"] for a in d["atoms"])
    assert {"Mg", "Si"} <= {a["element"] for a in d["atoms"] if a["visible"]}
    await click_control(page, page.locator("#show-atoms"), touch)
    await click_control(page, page.locator("#show-atoms"), touch)
    d = await unchanged()
    assert not any(a["element"] == "O" and a["visible"] for a in d["atoms"])
    assert {"Mg", "Si"} <= {a["element"] for a in d["atoms"] if a["visible"]}
    await page.screenshot(path=f"/tmp/visibility-{browser_type.name}-{touch}.png")
    await click_control(page, page.locator("#show-atoms"), touch)
    await page.locator("#file").set_input_files(
        Path(__file__).parent / "known-distance.cif"
    )
    await page.wait_for_function(
        "window.viewerDiagnostics().block === 'periodic_distance'"
    )
    d = await diagnostics(page)
    assert d["atomsVisible"] and d["hiddenElements"] == []
    assert d["renderedAtomCount"] > 0 and not d["selectedIds"]
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
