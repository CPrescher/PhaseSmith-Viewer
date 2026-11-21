"""Native acceptance for automatic plane offsets, display size and labels."""

import asyncio
import math
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle
from science_smoke import change

OUT = Path("/tmp/psv-gui-assessment/plane-controls")


async def replace_triplet_with_mouse(field, replacement, committed_text):
    selected_text = "el => el.value.slice(el.selectionStart, el.selectionEnd)"
    await field.click()
    assert await field.evaluate(selected_text) == await field.input_value()
    await field.press_sequentially(replacement)
    await field.press("Tab")
    await field.click()
    await field.click()
    assert await field.evaluate(selected_text) == ""
    await field.dblclick()
    assert await field.evaluate(selected_text) == committed_text


async def check(browser, width, height, theme):
    touch = width < 1200
    page = await browser.new_page(
        viewport={"width": width, "height": height},
        has_touch=touch,
        is_mobile=touch,
        color_scheme=theme,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )

    async def activate(locator):
        if touch:
            await locator.tap()
        else:
            await locator.click()

    async def state():
        return (await diagnostics(page))["lattice"]

    await choose_tool(page, "#mode-lattice", touch)
    assert await page.locator("#lattice-label-offsets").is_visible()
    await activate(page.locator("#plane-add"))
    row = page.locator("[data-plane-id]").first
    hkl, offset = row.locator("[data-field=hkl]"), row.locator("[data-field=m]")
    assert await hkl.get_attribute("inputmode") == "numeric"
    assert await offset.get_attribute("inputmode") == "decimal"
    if touch:
        # The native number pad may omit signs/spaces. Accessory buttons edit
        # at the caret without dismissing it; Done commits through history.
        hkl_keys = row.locator('.numeric-keys[data-for="hkl"]')
        offset_keys = row.locator('.numeric-keys[data-for="m"]')
        await hkl.fill("12")
        await hkl.press("End")
        await hkl_keys.locator('[data-key="space"]').tap()
        assert await hkl.evaluate("el => el === document.activeElement")
        await hkl_keys.locator('[data-key="minus"]').tap()
        await hkl.press("3")
        await hkl_keys.locator('[data-key="space"]').tap()
        await hkl.press("4")
        assert await hkl.input_value() == "12 -3 4"
        await hkl_keys.locator('[data-key="done"]').tap()
        assert (await state())["planes"][0]["hkl"] == [12, -3, 4]
        assert not await hkl_keys.is_visible()
        await offset.fill("0.25")
        await offset_keys.locator('[data-key="sign"]').tap()
        assert await offset.input_value() == "-0.25"
        assert await offset.evaluate("el => el === document.activeElement")
        await offset_keys.locator('[data-key="done"]').tap()
        assert (await state())["planes"][0]["m"] == -.25
        # Exercise an accessory-only edit, without typing any numeric keys.
        await offset.tap()
        await offset_keys.locator('[data-key="sign"]').tap()
        await offset_keys.locator('[data-key="done"]').tap()
        assert (await state())["planes"][0]["m"] == .25
        await activate(row.locator("button[aria-label^='Remove plane']"))
        await activate(page.locator("#plane-add"))
    else:
        await replace_triplet_with_mouse(hkl, "210", "2 1 0")
        assert (await state())["planes"][0]["hkl"] == [2, 1, 0]
        assert not await row.locator('.numeric-keys[data-for="hkl"]').is_visible()
    # Compact indices are expanded visibly; letters are rejected as whole edits,
    # including paste/fill paths where beforeinput may not contain the text.
    await change(hkl, "123")
    assert (await state())["planes"][0]["hkl"] == [1, 2, 3]
    assert await hkl.input_value() == "1 2 3"
    await hkl.press("End")
    await hkl.press("a")
    assert await hkl.input_value() == "1 2 3"
    await hkl.fill("1e2 0 0")
    assert await hkl.input_value() == "1 2 3"
    await change(hkl, "1234")
    p = (await state())["planes"][0]
    assert p["hkl"] == [1, 2, 3] and p["error"]
    assert "spaces" in await row.locator("[data-readout]").inner_text()
    assert not await hkl.evaluate("el => el.validity.valid")
    await change(hkl, "12 -3 4")
    p = (await state())["planes"][0]
    assert p["hkl"] == [12, -3, 4] and not p["error"], p
    assert await hkl.evaluate("el => el.validity.valid")
    await change(hkl, "1−10")
    assert (await state())["planes"][0]["hkl"] == [1, -1, 0]
    # iPad replacement/composition edits can bypass cancelable beforeinput.
    # Exercise that fallback for both fields, as well as typing and paste.
    for field in [hkl, offset]:
        assert await field.get_attribute("autocorrect") == "off"
        assert await field.get_attribute("autocapitalize") == "off"
        previous = await field.input_value()
        await field.press("End")
        await field.press("a")
        assert await field.input_value() == previous
        await field.fill("1e2")
        assert await field.input_value() == previous
        await field.evaluate("""el => {
            el.dispatchEvent(new InputEvent('beforeinput', {
                inputType: 'insertReplacementText', data: 'hello', cancelable: false
            }));
            el.value = 'hello';
            el.dispatchEvent(new InputEvent('input', {
                inputType: 'insertReplacementText', data: 'hello', isComposing: true
            }));
            el.dispatchEvent(new CompositionEvent('compositionend', {data: 'hello'}));
        }""")
        assert await field.input_value() == previous
    for value in ["-0.25", "−0,5", "+.75"]:
        await change(offset, value)
        assert (await state())["planes"][0]["m"] == float(value.replace("−", "-").replace(",", "."))
    await offset.fill("1.2.3")
    assert await offset.input_value() == "+.75"
    await change(offset, "")
    p = (await state())["planes"][0]
    assert p["m"] == .75 and p["error"]
    assert not await offset.evaluate("el => el.validity.valid")
    # Start a fresh, automatically positioned plane for the remaining checks.
    await activate(row.locator("button[aria-label^='Remove plane']"))
    await activate(page.locator("#plane-add"))
    for indices, expected in [
        ("1 0 0", 1),
        ("-1 -1 -1", -1),
        ("1 -1 0", 0),
        ("1 1 0", 1),
    ]:
        await change(hkl, indices)
        p = (await state())["planes"][0]
        assert p["m"] == expected and p["autoOffset"] and p["polygons"], p
        assert float(await offset.input_value()) == expected
        assert all(
            math.isclose(
                sum(a * b for a, b in zip(vertex, p["hkl"])), p["m"], abs_tol=1e-9
            )
            for poly in p["polygons"]
            for vertex in poly["frac"]
        )
    # Explicit placement is kept when the orientation is subsequently edited.
    await change(offset, 0.25)
    await change(hkl, "-1 1 0")
    p = (await state())["planes"][0]
    assert p["m"] == 0.25 and not p["autoOffset"] and p["polygons"], p
    await change(hkl, "1 1 0")
    await change(offset, 1)
    original = await diagnostics(page)
    slider = row.locator("[data-field=size]")
    await slider.scroll_into_view_if_needed()
    r = await slider.bounding_box()
    if touch:
        await page.touchscreen.tap(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    else:
        await page.mouse.click(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    await settle(page)
    enlarged = await diagnostics(page)
    p = enlarged["lattice"]["planes"][0]
    assert p["size"] == 150 and p["m"] == 1, p
    assert p["d"] == original["lattice"]["planes"][0]["d"]
    assert enlarged["ranges"] == original["ranges"]
    assert [a["frac"] for a in enlarged["atoms"]] == [
        a["frac"] for a in original["atoms"]
    ]
    assert any(
        v < 0 or v > 1
        for poly in p["polygons"]
        for vertex in poly["frac"]
        for v in vertex
    )
    assert all(
        math.isclose(v[0] + v[1], 1, abs_tol=1e-9)
        for poly in p["polygons"]
        for v in poly["frac"]
    )
    # Face opacity has independent outline-only, opaque and translucent states.
    opacity = row.locator("[data-field=opacity]")
    assert math.isclose(p["opacity"], 0.28)
    for key, expected in [("Home", 0), ("End", 1)]:
        await opacity.press(key)
        await settle(page)
        q = (await state())["planes"][0]
        assert q["opacity"] == expected and q["visible"], q
        assert (
            q["polygons"] == p["polygons"]
            and q["m"] == p["m"]
            and q["size"] == p["size"]
        ), q
    await opacity.scroll_into_view_if_needed()
    r = await opacity.bounding_box()
    if touch:
        await page.touchscreen.tap(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    else:
        await page.mouse.click(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    await settle(page)
    assert (await state())["planes"][0]["opacity"] == 0.5
    await row.locator("[data-field=family]").check()
    offsets = (await state())["planes"][0]["offsets"]
    await slider.press("End")
    await settle(page)
    assert (await state())["planes"][0]["offsets"] == offsets
    await row.locator("[data-field=family]").uncheck()
    await slider.press("Home")
    assert (await state())["planes"][0]["opacity"] == 0.5
    # m=0 can be included or omitted explicitly, not implicitly suppressed.
    await change(hkl, "1 -1 0")
    await change(offset, 0)
    await choose_tool(page, "#mode-directions")
    await activate(page.locator("#arrow-add"))
    if not touch:
        uvw = page.locator("[data-arrow-id] [data-field=uvw]").first
        await replace_triplet_with_mouse(uvw, "1 -2 0", "1 -2 0")
        assert (await state())["arrows"][0]["uvw"] == [1, -2, 0]
    await choose_tool(page, "#mode-lattice")
    before = await state()
    assert any("m=0" in text for text in before["labels"]["anchors"])
    arrows = [text for text in before["labels"]["anchors"] if text.startswith("[")]
    labels_box = await page.locator('label:has(#lattice-labels-toggle)').bounding_box()
    offset_label = page.locator('label:has(#lattice-label-offsets)')
    offset_box = await offset_label.bounding_box()
    assert (await offset_label.inner_text()).strip() == "m"
    assert abs(labels_box["y"] - offset_box["y"]) < 1
    assert 0 <= offset_box["x"] - labels_box["x"] - labels_box["width"] <= 8
    await page.locator("#lattice-label-offsets").uncheck()
    after = await state()
    assert not any("m=" in text for text in after["labels"]["anchors"])
    assert [
        text for text in after["labels"]["anchors"] if text.startswith("[")
    ] == arrows
    await page.locator("#lattice-labels-toggle").uncheck()
    assert await offset_label.is_visible()
    assert await page.locator("#lattice-label-offsets").is_disabled()
    assert await offset_label.evaluate("el => Number(getComputedStyle(el).opacity) < 1")
    assert await page.locator("#plane-label-position").is_disabled()
    await settle(page)
    assert not (await state())["labels"]["shown"]
    await page.locator("#lattice-labels-toggle").check()
    assert not await page.locator("#lattice-label-offsets").is_checked()
    await page.locator("#lattice-label-offsets").check()
    await change(hkl, "1 1 1")
    await change(offset, 1.5)
    await activate(page.locator("#reset"))
    assert await page.locator("#plane-label-position").input_value() == "outside"
    canvas = await page.locator("#viewport canvas").bounding_box()
    for position in ["outside", "edge", "center"]:
        await page.locator("#plane-label-position").select_option(position)
        await settle(page)
        assert (await state())["labels"]["position"] == position
        labels = page.locator(".lattice-label:not([hidden])").filter(has_text="(111)")
        assert await labels.count() == 1
        r = await labels.bounding_box()
        assert r["x"] >= canvas["x"] - 1 and r["y"] >= canvas["y"] - 1, (
            position,
            r,
            canvas,
        )
        assert (
            r["x"] + r["width"] <= canvas["x"] + canvas["width"] + 1
            and r["y"] + r["height"] <= canvas["y"] + canvas["height"] + 1
        ), (position, r, canvas)
        assert await page.evaluate("document.scrollingElement.scrollWidth===innerWidth")
        await page.screenshot(path=str(OUT / f"{width}-{theme}-{position}.png"))
    assert not errors, errors
    await page.close()
    print(
        f"{width}×{height} {theme}: automatic/manual m, size, label text and positions passed",
        flush=True,
    )


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        for w, h in [(1440, 900), (1024, 768), (768, 1024), (390, 844)]:
            for theme in ["light", "dark"]:
                await check(browser, w, h, theme)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
