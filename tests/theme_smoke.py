"""Verify system theme following, explicit preference and scientific state."""

import asyncio
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


async def check(browser, width, height):
    page = await browser.new_page(
        viewport={"width": width, "height": height},
        has_touch=True,
        color_scheme="light",
    )
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    assert await page.locator("html").get_attribute("data-theme") == "light"
    await page.emulate_media(color_scheme="dark")
    await page.wait_for_function("document.documentElement.dataset.theme==='dark'")
    before = await diagnostics(page)
    await page.locator("#theme-toggle").tap()
    await settle(page)
    assert await page.locator("html").get_attribute("data-theme") == "light"
    after = await diagnostics(page)
    assert after["camera"] == before["camera"]
    assert [(a["cartesian"], a["color"]) for a in after["atoms"]] == [
        (a["cartesian"], a["color"]) for a in before["atoms"]
    ]
    assert after["polyhedra"] == before["polyhedra"]
    await page.emulate_media(color_scheme="light")
    await page.emulate_media(color_scheme="dark")
    assert await page.locator("html").get_attribute("data-theme") == "light"
    await page.reload()
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    assert await page.locator("html").get_attribute("data-theme") == "light"
    assert await page.evaluate("document.scrollingElement.scrollWidth===innerWidth")
    await page.screenshot(path=f"/tmp/psv-gui-assessment/light-{width}.png")
    await page.locator("#theme-toggle").tap()
    await page.screenshot(path=f"/tmp/psv-gui-assessment/dark-{width}.png")
    await page.close()
    print(
        f"{width}×{height}: system theme, switch, persistence and crystal state passed"
    )


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="chrome", args=["--enable-unsafe-swiftshader"]
        )
        for size in [(1440, 900), (1024, 768), (768, 1024), (390, 844)]:
            await check(browser, *size)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
