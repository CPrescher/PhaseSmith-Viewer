"""Full orthographic views keep deep periodic images visible and pickable."""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import HERE, URL, diagnostics, settle


async def check(browser):
    page = await browser.new_page(
        viewport={"width": 1200, "height": 850}, has_touch=True
    )
    await page.goto(URL)
    await page.locator("#file").set_input_files(HERE / "known-distance.cif")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().block==='periodic_distance'"
    )
    await page.locator("#mode-extent").tap()
    await page.locator("#range-c-max").fill("20")
    await page.locator('#range-form button[type="submit"]').tap()
    await page.locator("#view-c").tap()
    rect = await page.locator("canvas").bounding_box()
    x, y = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2
    for _ in range(2):
        await page.mouse.click(x, y, button="right")
        await page.wait_for_timeout(50)
    await settle(page)
    data = await diagnostics(page)
    assert all(-1 < a["z"] < 1 for a in data["atoms"]), (
        "Deep images clipped by the camera"
    )
    front = next(a for a in data["atoms"] if a["frac"] == [0, 1, 20])
    await page.locator("#measure-info").tap()
    await page.touchscreen.tap(front["x"], front["y"])
    assert (await diagnostics(page))["selectedSites"][0]["frac"] == [0, 1, 20]
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, -300)
    await settle(page)
    assert all(-1 < a["z"] < 1 for a in (await diagnostics(page))["atoms"])
    await page.close()
    print(
        "Twenty cells along the viewing direction: full depth and true front image verified"
    )


async def main():
    async with async_playwright() as p:
        chromium = await p.chromium.launch(channel="chrome")
        await check(chromium)
        await chromium.close()
        executable = sorted(
            (Path.home() / "Library/Caches/ms-playwright").glob("webkit-*/pw_run.sh")
        )[-1]
        webkit = await p.webkit.launch(executable_path=str(executable))
        await check(webkit)
        await webkit.close()


if __name__ == "__main__":
    asyncio.run(main())
