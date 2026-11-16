"""Translucent polyhedron faces of all pairs are drawn from one globally
depth-sorted batch; opaque pairs draw themselves; 0% draws outlines only.
Picking still resolves the individual polyhedron."""

import asyncio
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


async def set_opacity(page, index, percent):
    await page.evaluate(
        """([i,v])=>{const s=document.querySelectorAll('[id^="pair-opacity-"]:not([id*="value"])')[i];
        s.value=String(v);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}""",
        [index, percent],
    )
    await settle(page)


async def check(browser):
    page = await browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    await settle(page)
    d = await diagnostics(page)
    batch = d["translucentFaces"]
    assert batch["pairs"] == 2 and batch["singlePass"] and batch["backToFront"], batch
    assert [m["drawnBy"] for m in d["faceMaterials"]] == [
        "sorted-batch",
        "sorted-batch",
    ]
    assert batch["triangles"] == sum(m["vertexCount"] for m in d["faceMaterials"]) // 3
    # Per-pixel order comes from depth peeling; the sorted batch is only
    # the remainder fallback, which must stay empty here.
    await page.wait_for_function("window.viewerDiagnostics().transparency.used > 0")
    await page.wait_for_timeout(1000)  # let the adaptive budget settle
    peel = (await diagnostics(page))["transparency"]
    assert peel["method"] == "depth-peeling", peel
    # Twelve convex polyhedra: a self-reselecting depth test (speckle)
    # would use every layer and overflow; the real depth complexity is low.
    assert not peel["remainder"] and not peel["overflow"], peel
    assert 2 <= peel["used"] <= 16 and peel["used"] < peel["max"], peel

    # Rotating re-sorts; the order is back to front for each view.
    box = await page.locator("#viewport canvas").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    for dx, dy in ((220, 0), (0, 180), (-300, 120)):
        before = (await diagnostics(page))["translucentFaces"]["sorts"]
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + dx, cy + dy, steps=8)
        await page.mouse.up()
        await page.wait_for_timeout(600)
        after = (await diagnostics(page))["translucentFaces"]
        assert after["sorts"] > before and after["backToFront"], after

    # Different opacities share the batch; alpha follows each pair.
    await set_opacity(page, 1, 70)
    batch = (await diagnostics(page))["translucentFaces"]
    assert [round(a, 2) for a in batch["alphas"]] == [0.34, 0.7], batch
    # 100%: that pair leaves the batch and draws itself with depth writes.
    await set_opacity(page, 0, 100)
    d = await diagnostics(page)
    assert [m["drawnBy"] for m in d["faceMaterials"]] == ["own-mesh", "sorted-batch"]
    assert d["faceMaterials"][0]["depthWrite"] and d["translucentFaces"]["pairs"] == 1
    # 0%: outlines only.
    await set_opacity(page, 1, 0)
    d = await diagnostics(page)
    assert d["faceMaterials"][1]["drawnBy"] == "outline-only"
    assert (
        d["faceMaterials"][1]["outlineVisible"] and not d["translucentFaces"]["visible"]
    )
    await set_opacity(page, 0, 34)
    await set_opacity(page, 1, 34)

    # Picking a translucent polyhedron still selects one polyhedron.
    await page.locator("#style-open").click()
    picked = False
    for fx, fy in ((0.5, 0.5), (0.45, 0.4), (0.55, 0.6), (0.4, 0.55), (0.6, 0.45)):
        if await page.locator("#style-pick").get_attribute("aria-pressed") != "true":
            await page.locator("#style-pick").click()
        await page.mouse.click(
            box["x"] + box["width"] * fx, box["y"] + box["height"] * fy
        )
        await settle(page)
        target = await page.locator("#style-target").input_value()
        if target.startswith("poly:"):
            picked = True
            break
    assert picked, "no polyhedron could be picked"
    assert not errors, errors
    await page.close()
    print("Global face sorting, opacity classes and polyhedron picking passed")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        await check(browser)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
