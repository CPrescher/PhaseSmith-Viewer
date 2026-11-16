"""Right-click zoom commands and one-atom information selection."""

import asyncio
import math
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


def eye(camera):
    return [a - b for a, b in zip(camera["position"], camera["target"])]


async def check(browser, width, height):
    page = await browser.new_page(
        viewport={"width": width, "height": height}, has_touch=True
    )
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    box = await page.locator("canvas").bounding_box()
    x, y = box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.55
    original = (await diagnostics(page))["camera"]
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, -300)
    await settle(page)
    before = (await diagnostics(page))["camera"]
    await page.mouse.click(x, y, button="right")
    await settle(page)
    single = (await diagnostics(page))["camera"]
    assert math.isclose(
        math.hypot(*eye(single)) / math.hypot(*eye(before)), 1.25, rel_tol=1e-7
    )
    await page.wait_for_timeout(400)
    await page.mouse.click(x, y, button="right")
    await page.wait_for_timeout(60)
    await page.mouse.click(x, y, button="right")
    await settle(page)
    fitted = (await diagnostics(page))["camera"]
    assert math.isclose(
        math.hypot(*eye(fitted)), math.hypot(*eye(original)), rel_tol=1e-7
    )
    assert fitted["up"] == original["up"]
    await page.mouse.move(x, y)
    await page.mouse.down(button="right")
    await page.mouse.move(x + 60, y + 30, steps=5)
    await page.mouse.up(button="right")
    await settle(page)
    assert math.isclose(
        math.hypot(*eye((await diagnostics(page))["camera"])),
        math.hypot(*eye(fitted)),
        rel_tol=1e-7,
    )

    assert (await diagnostics(page))["measureMode"] == "info"
    assert await page.locator("#measure-info").get_attribute("aria-pressed") == "true"
    picked = []
    for reverse in [False, True]:
        current = await diagnostics(page)
        atoms = sorted(current["atoms"], key=lambda a: a["x"], reverse=reverse)
        for atom in atoms:
            if await page.evaluate(
                "([x,y])=>document.elementFromPoint(x,y)?.tagName==='CANVAS'",
                [atom["x"], atom["y"]],
            ):
                await page.touchscreen.tap(atom["x"], atom["y"])
                await settle(page)
                state = await diagnostics(page)
                if state["selectedIds"]:
                    break
        assert len(state["selectedIds"]) == 1
        assert state["distance"] is None and state["angle"] is None
        picked.append(state["selectedIds"][0])
        details = (
            page.locator("#atom-info")
            if await page.locator("#atom-info").is_visible()
            else page.locator("#selection")
        )
        text = await details.inner_text()
        assert "occupancy" in text and "frac" in text and "xyz" in text, text
    assert picked[0] != picked[1]
    name = {1440: "desktop", 1024: "landscape", 768: "portrait", 390: "phone"}[width]
    for theme in ["light", "dark"]:
        if await page.locator("html").get_attribute("data-theme") != theme:
            await page.locator("#theme-toggle").tap()
        await page.screenshot(
            path=f"/tmp/psv-gui-assessment/review3/{name}-{theme}-info.png"
        )
    await page.close()
    print(
        f"{width}×{height}: single/double right click, pan discrimination and Info replacement passed"
    )


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        for size in [(1440, 900), (1024, 768), (768, 1024), (390, 844)]:
            await check(b, *size)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
