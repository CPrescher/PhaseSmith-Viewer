"""Right-dragging must keep the grabbed point under the mouse on every move."""

import asyncio
import math
from playwright.async_api import async_playwright

from smoke import URL, diagnostics, settle


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
        for dx, dy in [(17, -8), (78, 47), (112, 31), (-18, -24)]:
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
    await page.close()
    print(f"{width}×{height} DPR {dpr}: maximum slip {max(errors):.4f} CSS px")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        for viewport in [(1440, 900, 1), (1024, 768, 2), (768, 1024, 2)]:
            await run(b, *viewport)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
