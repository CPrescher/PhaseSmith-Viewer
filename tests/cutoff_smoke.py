"""Check fine cutoff control with real mouse and touchscreen holds."""

import asyncio
import math
from playwright.async_api import async_playwright

from smoke import URL, diagnostics, settle


async def run(browser, touch):
    page = await browser.new_page(viewport={"width": 1024, "height": 768}, has_touch=touch)
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount === 12")
    rows = page.locator(".pair-rule")
    si = rows.nth(0).locator('[data-field="cutoff"]')
    mg = rows.nth(1).locator('[data-field="cutoff"]')
    slider = rows.nth(1).locator('[data-field="cutoff-speed"]')
    await (mg.tap() if touch else mg.click())
    await slider.wait_for(state="visible")
    box = await slider.bounding_box()
    assert box
    center = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    session = await page.context.new_cdp_session(page) if touch else None

    async def hold(fraction):
        x = center + fraction * box["width"] / 2
        if touch:
            async def dispatch(kind, point):
                await session.send("Input.dispatchTouchEvent", {
                    "type": kind, "touchPoints": [] if point is None else [{"x": point, "y": y, "id": 1}]
                })
            await dispatch("touchStart", center)
            await dispatch("touchMove", x)
        else:
            await page.mouse.move(center, y)
            await page.mouse.down()
            await page.mouse.move(x, y)
        await page.wait_for_timeout(800)
        if touch:
            await dispatch("touchEnd", None)
        else:
            await page.mouse.up()
        await settle(page)
        end = float(await mg.input_value())
        await page.wait_for_timeout(220)
        assert float(await mg.input_value()) == end, "Cutoff drifted after release"
        return end

    initial = float(await mg.input_value())
    assert await hold(0) == initial
    slow = await hold(-0.20)
    fast = await hold(-0.82)
    assert 0 < initial - slow < 0.1, (initial, slow)
    assert slow - fast > 2 * (initial - slow), (slow, fast)
    assert await hold(0.82) > fast
    assert float(await si.input_value()) == 1.8

    await mg.fill("2.15")
    await mg.press("Enter")
    await settle(page)
    assert (await diagnostics(page))["coordination"]["rules"][1]["counts"] == [3, 6]
    await mg.press("ArrowUp")
    assert math.isclose(float(await mg.input_value()), 2.25)
    await mg.press("ArrowDown")
    assert math.isclose(float(await mg.input_value()), 2.15)
    done = rows.nth(1).locator(".done-button")
    await (done.tap() if touch else done.click())
    assert not await slider.is_visible(), "Done reopened the cutoff editor"
    await (mg.tap() if touch else mg.click())
    await slider.wait_for(state="visible")
    await slider.press("Escape")
    assert not await slider.is_visible(), "Escape reopened the cutoff editor"
    await page.close()
    print(f"{'Touch' if touch else 'Mouse'}: slow {initial-slow:.2f} Å, fast {slow-fast:.2f} Å in 0.8 s; release stopped both")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        for touch in (False, True):
            await run(browser, touch)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
