"""Touch number pads and accessory keys for viewing and arrow directions."""
import asyncio
import os
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle


async def check(browser, width, height, touch=True):
    page = await browser.new_page(
        viewport={"width": width, "height": height},
        has_touch=touch, is_mobile=touch,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount===12")

    async def activate(locator):
        await (locator.tap() if touch else locator.click())

    async def enter(field, keys):
        assert await field.get_attribute("inputmode") == "decimal"
        assert await field.get_attribute("autocorrect") == "off"
        await field.fill("12")
        if touch:
            await field.press("End")
            await keys.locator('[data-key="space"]').tap()
            await keys.locator('[data-key="minus"]').tap()
            await field.press("3")
            await keys.locator('[data-key="space"]').tap()
            await field.press("4")
            assert await field.input_value() == "12 -3 4"
            assert await field.evaluate("el => el === document.activeElement")
            await keys.locator('[data-key="done"]').tap()
        else:
            assert not await keys.is_visible()
            await field.fill("12 -3 4")
            await field.press("Enter")
        assert not await keys.is_visible()

    await activate(page.locator('.view-directions summary'))
    form = page.locator("#direction-form")
    field = page.locator("#view-direction")
    await enter(field, form.locator(".numeric-keys"))
    await settle(page)
    assert not await page.locator("#direction-error").inner_text()
    assert await page.locator('.view-directions details').evaluate("el => el.classList.contains('active')")
    assert "12" in (await diagnostics(page))["viewReadout"]["text"]
    # Enter remains a submit action, including fractional directions.
    await field.fill(".5 -1 0")
    await field.press("Enter")
    assert not await page.locator("#direction-error").inner_text()
    await activate(page.locator('.view-directions summary'))

    await choose_tool(page, "#mode-lattice", touch)
    await activate(page.locator("#arrow-add"))
    row = page.locator("[data-arrow-id]").first
    field = row.locator('[data-field="uvw"]')
    await enter(field, row.locator(".numeric-keys"))
    assert (await diagnostics(page))["lattice"]["arrows"][0]["uvw"] == [12, -3, 4]
    await field.fill(".5 -1 0")
    await field.press("Enter")
    assert (await diagnostics(page))["lattice"]["arrows"][0]["uvw"] == [.5, -1, 0]
    assert not errors, errors
    assert await page.evaluate("document.scrollingElement.scrollWidth <= innerWidth")
    await page.close()
    print(f"{width}×{height}: view and arrow direction keys passed", flush=True)


async def main():
    async with async_playwright() as p:
        options = {"channel": os.environ["BROWSER_CHANNEL"]} if os.environ.get("BROWSER_CHANNEL") else {}
        browser = await p.chromium.launch(**options)
        for width, height, touch in [(1440, 900, False), (1024, 768, True), (390, 844, True)]:
            await check(browser, width, height, touch)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
