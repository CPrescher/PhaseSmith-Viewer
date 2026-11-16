"""The common two-pair workflow must fit on one screen in both tablet orientations."""

import asyncio
from playwright.async_api import async_playwright, expect
from smoke import HERE, URL, choose_tool, diagnostics, pair, settle


async def on_screen(control):
    return await control.evaluate("""el => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return r.top >= 0 && r.bottom <= innerHeight && !!top && (el.contains(top) || top.closest('label')?.control === el);
    }""")


async def check_panel_widths(page):
    clipped = await page.evaluate("""() => [...document.querySelectorAll(
      '.tool-window-body, .pair-rule, .view-top, .view-bottom'
    )].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className || el.tagName)""")
    assert not clipped, f"Controls overflow horizontally: {clipped}"


async def check(browser, width, height):
    page = await browser.new_page(
        viewport={"width": width, "height": height}, has_touch=True, is_mobile=width < 1200
    )
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount === 12"
    )
    await settle(page)
    await page.wait_for_function("document.querySelector('canvas').clientHeight > 200")
    dimensions = await page.evaluate("""() => {
      const doc = document.scrollingElement, c = document.querySelector('canvas').getBoundingClientRect();
      return { width: doc.scrollWidth, height: doc.scrollHeight, canvas: c.toJSON() };
    }""")
    assert dimensions["width"] <= width + 1 and dimensions["height"] <= height + 1, (
        dimensions
    )
    await choose_tool(page, "#mode-pairs")
    await check_panel_widths(page)
    canvas = dimensions["canvas"]
    assert canvas["height"] >= height * 0.42 and canvas["width"] >= width * 0.49, canvas

    # Check hit targets before Playwright gets a chance to auto-scroll to them.
    for selector in [
        "#mode-extent",
        "#show-atoms",
        "#view-b",
        '[data-element="Mg"]',
    ]:
        assert await on_screen(page.locator(selector)), (width, height, selector)
    sliders = page.locator('[data-field="opacity"]')
    assert await sliders.count() == 2
    for i in range(2):
        await sliders.nth(i).scroll_into_view_if_needed()
        assert await on_screen(sliders.nth(i)), (width, height, "opacity", i)
    # Opening a tuner by touch must not let the compatibility click land on
    # one of its buttons (it opens in place of the row under the field).
    fields = page.locator('[data-field="cutoff"]')
    for index in [0, 1]:
        await fields.nth(index).tap()
        await expect(fields.nth(index)).to_have_attribute("aria-expanded", "true", timeout=1500)
        assert [float(await fields.nth(i).input_value()) for i in (0, 1)] == [1.8, 2.3]
    await page.locator(".cutoff-tuner:visible .done-button").tap()
    await choose_tool(page, "#mode-extent", True)
    for selector in ["#range-b-max", "#range-c-max", '#range-form button[type="submit"]']:
        assert await on_screen(page.locator(selector)), (width, height, selector)
    await page.locator("#range-b-max").fill("2")
    await page.locator('#range-form button[type="submit"]').tap()
    await settle(page)
    assert (await diagnostics(page))["ranges"][1] == [0, 2]
    assert await page.evaluate("window.scrollY") == 0
    await page.close()
    print(
        f"{width}×{height}: canvas {canvas['width']:.0f}×{canvas['height']:.0f}; controls on screen"
    )


async def check_phone(browser):
    page = await browser.new_page(
        viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True
    )
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount === 12")
    await check_panel_widths(page)
    await page.locator("#file").set_input_files(HERE / "known-distance.cif")
    await page.wait_for_function("window.viewerDiagnostics?.().block === 'periodic_distance'")
    await settle(page)
    assert await page.evaluate("document.scrollingElement.scrollWidth === innerWidth")
    assert await page.evaluate("document.scrollingElement.scrollHeight === innerHeight")
    # The forsterite example starts with boundary copies hidden.
    await choose_tool(page, "#mode-extent", True)
    if not await page.locator("#boundary").is_checked():
        await page.locator("#boundary").tap()
        await settle(page)
    # Close the sheet: the crystal takes the whole view again for picking.
    await page.locator("#tool-window-extent [data-action=close]").tap()
    await settle(page)
    await page.locator("#measure-distance").tap()
    await settle(page)
    for atom in await pair(page):
        await page.touchscreen.tap(atom["x"], atom["y"])
    await settle(page)
    assert "4.000" in await page.locator("#distance").inner_text()
    await page.locator("#clear").tap()
    await page.locator("#view-b").tap()
    assert await on_screen(page.locator("canvas"))
    await page.close()
    print("390×844 touch: imported CIF, measured 4 Å, cleared and oriented the crystal")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            channel="chrome", args=["--enable-unsafe-swiftshader"]
        )
        for width, height in [(1440, 900), (1024, 768), (768, 1024), (820, 1180)]:
            await check(browser, width, height)
        await check_phone(browser)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
