"""Native wheel zoom keeps an off-center world point under the mouse."""

import asyncio
import math
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


async def check(browser, width, height):
    page = await browser.new_page(
        viewport={"width": width, "height": height}, device_scale_factor=2
    )
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    canvas = await page.locator("canvas").bounding_box()
    center = (canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2)
    largest_error = 0
    for view in ("reset", "view-b"):
        await page.locator("#" + view).click()
        await settle(page)
        atoms = (await diagnostics(page))["atoms"]
        candidates = []
        for atom in atoms:
            if (
                canvas["x"] + 80 < atom["x"] < canvas["x"] + canvas["width"] - 80
                and canvas["y"] + 120 < atom["y"] < canvas["y"] + canvas["height"] - 100
            ):
                candidates.append(atom)
        assert candidates
        target = max(candidates, key=lambda a: math.dist(center, (a["x"], a["y"])))
        await page.mouse.move(target["x"], target["y"])
        for delta in (-180, 180, -250, 250):
            before = await diagnostics(page)
            await page.mouse.wheel(0, delta)
            await page.wait_for_timeout(120)
            after = await diagnostics(page)
            point = next(a for a in after["atoms"] if a["key"] == target["key"])
            largest_error = max(
                largest_error,
                math.dist((point["x"], point["y"]), (target["x"], target["y"])),
            )
            assert before["camera"] != after["camera"]
            assert largest_error < 0.5, largest_error
    await page.close()
    print(f"{width}×{height}: zoom anchor maximum slip {largest_error:.4f} CSS px")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        for dimensions in [(1440, 900), (1024, 768), (768, 1024)]:
            await check(b, *dimensions)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
