"""Right-drag anchors the grabbed point, then rotation preserves the crystal center."""

import asyncio
import math
from playwright.async_api import async_playwright

from smoke import URL, crystal_center, diagnostics, settle


async def run(browser, width, height, dpr):
    page = await browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=dpr)
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount === 12")
    canvas = await page.locator("canvas").bounding_box()

    async def drag():
        before = await diagnostics(page)
        center = [canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2]
        candidate = min(before["atoms"], key=lambda a: math.dist(center, [a["x"], a["y"]]))
        x, y = candidate["x"], candidate["y"]
        selected = before["selectedIds"]
        await page.mouse.move(x, y)
        await page.mouse.down(button="right")
        largest_error = 0
        for dx, dy in [(17, -8), (78, 47), (112, 31), (93, -52)]:
            await page.mouse.move(x + dx, y + dy)
            await settle(page)
            atom = (await diagnostics(page))["atoms"][candidate["id"]]
            largest_error = max(largest_error, math.dist([atom["x"], atom["y"]], [x + dx, y + dy]))
        await page.mouse.up(button="right")
        await page.wait_for_timeout(350)
        after = await diagnostics(page)
        atom = after["atoms"][candidate["id"]]
        largest_error = max(largest_error, math.dist([atom["x"], atom["y"]], [x + dx, y + dy]))
        assert after["selectedIds"] == selected
        assert largest_error < 0.5, f"Grabbed point slipped {largest_error:.2f} CSS pixels"
        return largest_error

    errors = [await drag()]
    await page.locator("#view-b").click()
    await page.mouse.move(canvas["width"] / 2, canvas["y"] + canvas["height"] / 2)
    await page.mouse.wheel(0, -180)
    await page.wait_for_timeout(450)
    errors.append(await drag())
    before = await diagnostics(page)
    fixed = crystal_center(before)
    rotation_drift = []
    await page.mouse.move(*fixed)
    await page.mouse.down()
    for dx, dy in [(70, 10), (110, 80), (50, 110)]:
        await page.mouse.move(fixed[0] + dx, fixed[1] + dy)
        await settle(page)
        rotation_drift.append(math.dist(fixed, crystal_center(await diagnostics(page))))
    await page.mouse.up()
    await page.wait_for_timeout(350)
    after = await diagnostics(page)
    rotation_drift.append(math.dist(fixed, crystal_center(after)))
    assert after["camera"]["up"] != before["camera"]["up"], "Drag did not rotate the crystal"
    await page.locator("#turn-open").click()
    await settle(page)
    fixed = crystal_center(await diagnostics(page))
    for action in ("right", "clockwise"):
        await page.locator("#turn-" + action).click()
        await settle(page)
        rotation_drift.append(math.dist(fixed, crystal_center(await diagnostics(page))))
    assert max(rotation_drift) < 0.5, f"Crystal center drifted {max(rotation_drift):.2f} CSS pixels"
    await page.close()
    print(f"{width}×{height} DPR {dpr}: max pan slip {max(errors):.4f}, max rotation drift {max(rotation_drift):.4f} CSS px")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        for viewport in [(1440, 900, 1), (1024, 768, 2), (768, 1024, 2)]:
            await run(b, *viewport)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
