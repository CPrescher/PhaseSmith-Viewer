"""Touch number pads and accessory keys for viewing and arrow directions."""
import asyncio
import os
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle


async def check(browser, width, height, touch=True, locale="en-US"):
    page = await browser.new_page(
        viewport={"width": width, "height": height},
        has_touch=touch, is_mobile=touch, locale=locale,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount===12")

    async def activate(locator):
        await (locator.tap() if touch else locator.click())

    async def enter(field, keys):
        assert await field.get_attribute("inputmode") == ("none" if touch else "text")
        assert await field.get_attribute("autocorrect") == "off"
        if touch:
            await field.focus()
            assert not await keys.is_visible()
            await field.tap()
        await field.fill("0")
        if touch:
            assert (await keys.locator('[data-key="1"]').bounding_box())["height"] == 44
            assert (await keys.bounding_box())["height"] <= 244
            await field.press("End")
            separator = "," if locale == "de-DE" else "."
            assert await keys.get_by_text(separator, exact=True).count() == 1
            assert await keys.get_by_text("." if separator == "," else ",", exact=True).count() == 0
            for key in ["decimal", "5", "space", "minus", "1", "space", "0"]:
                await keys.locator(f'[data-key="{key}"]').tap()
            assert await field.input_value() == f"0{separator}5 -1 0"
            assert await field.evaluate("el => el === document.activeElement")
            await keys.locator('[data-key="done"]').tap()
        else:
            assert not await keys.is_visible()
            await field.fill("0,5 -1 0")
            await field.press("Enter")
        assert not await keys.is_visible()

    await activate(page.locator('.view-directions summary'))
    form = page.locator("#direction-form")
    field = page.locator("#view-direction")
    await enter(field, form.locator(".numeric-keys"))
    await settle(page)
    assert not await page.locator("#direction-error").inner_text()
    assert await page.locator('.view-directions details').evaluate("el => el.classList.contains('active')")
    assert (await diagnostics(page))["viewReadout"]["text"] == "[1 −2 0]"
    # Enter remains a submit action, including fractional directions.
    await field.fill(".5 -1 0")
    await field.press("Enter")
    assert not await page.locator("#direction-error").inner_text()
    await field.fill("110")
    await field.press("Enter")
    assert await field.input_value() == "1 1 0"
    await activate(page.locator('.view-directions summary'))

    await choose_tool(page, "#mode-directions", touch)
    await activate(page.locator("#arrow-add"))
    row = page.locator("[data-arrow-id]").first
    field = row.locator('[data-field="uvw"]')
    await enter(field, row.locator('.numeric-keys[data-for="uvw"]'))
    assert (await diagnostics(page))["lattice"]["arrows"][0]["uvw"] == [.5, -1, 0]
    await field.fill(".5 -1 0")
    await field.press("Enter")
    assert (await diagnostics(page))["lattice"]["arrows"][0]["uvw"] == [.5, -1, 0]
    assert await row.get_by_role("button", name="Remove arrow [0.5 -1 0]").count() == 1
    for field_name, text in [("origin", "0.5 0 0"), ("length", "2")]:
        field = row.locator(f'[data-field="{field_name}"]')
        if touch:
            await field.tap()
        await field.fill(text)
        if touch:
            await row.locator(f'[data-for="{field_name}"] [data-key="done"]').tap()
        else:
            await field.press("Enter")
    arrow = (await diagnostics(page))["lattice"]["arrows"][0]
    assert arrow["endFrac"] == [1.5, -2, 0]

    for tool in ["reflection", "detector"]:
        await choose_tool(page, f"#mode-{tool}", touch)
        field = page.locator(f"#{tool}-hkl")
        if not touch:
            await field.blur()
            await field.click()
            assert await field.evaluate("e => e.selectionEnd - e.selectionStart === e.value.length")
        if touch:
            await field.tap()
        await field.fill("200")
        if touch:
            await page.locator(f'[data-for="{tool}-hkl"] [data-key="done"]').tap()
        else:
            await field.press("Enter")
        assert await field.input_value() == "2 0 0"
        await activate(page.locator(f"#{tool}-close"))
    if touch:
        await choose_tool(page, "#mode-extent", touch)
        bound = page.locator("#range-a-min")
        await bound.tap()
        await bound.press("ControlOrMeta+a")
        pad = page.locator('[data-for="range-a-min"]')
        field_box, pad_box = await bound.bounding_box(), await pad.bounding_box()
        assert field_box and pad_box
        assert pad_box["height"] <= 197
        digit_boxes = [await pad.locator(f'[data-key="{n}"]').bounding_box() for n in range(10)]
        for n in range(1, 10):
            assert digit_boxes[n]["x"] == digit_boxes[1 + (n - 1) % 3]["x"]
            assert digit_boxes[n]["y"] == digit_boxes[1 + 3 * ((n - 1) // 3)]["y"]
        assert digit_boxes[1]["x"] < digit_boxes[2]["x"] < digit_boxes[3]["x"]
        assert digit_boxes[1]["y"] < digit_boxes[4]["y"] < digit_boxes[7]["y"] < digit_boxes[0]["y"]
        assert digit_boxes[0]["x"] == digit_boxes[2]["x"]
        assert (await pad.locator('[data-key="1"]').bounding_box())["height"] == 44
        assert (pad_box["y"] + pad_box["height"] <= field_box["y"] or
                field_box["y"] + field_box["height"] <= pad_box["y"] or
                pad_box["x"] + pad_box["width"] <= field_box["x"] or
                field_box["x"] + field_box["width"] <= pad_box["x"])
        for key in ["minus", "0", "decimal", "2", "5", "done"]:
            await pad.locator(f'[data-key="{key}"]').tap()
        assert float(await bound.input_value()) == -.25
        assert not await pad.is_visible()
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
        await check(browser, 320, 568, locale="de-DE")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
