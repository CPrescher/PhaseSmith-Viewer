"""Native acceptance for automatic plane offsets, display size and labels."""

import asyncio
import math
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle
from science_smoke import change

OUT = Path("/tmp/psv-gui-assessment/plane-controls")


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

    await activate(page.locator("#mode-lattice"))
    await activate(page.locator("#plane-add"))
    row = page.locator("[data-plane-id]").first
    hkl, offset = row.locator("[data-field=hkl]"), row.locator("[data-field=m]")
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
    await activate(page.locator("#arrow-add"))
    before = await state()
    assert any("m=0" in text for text in before["labels"]["anchors"])
    arrows = [text for text in before["labels"]["anchors"] if text.startswith("[")]
    await page.locator("#lattice-label-offsets").uncheck()
    after = await state()
    assert not any("m=" in text for text in after["labels"]["anchors"])
    assert [
        text for text in after["labels"]["anchors"] if text.startswith("[")
    ] == arrows
    await page.locator("#lattice-labels-toggle").uncheck()
    assert await page.locator("#lattice-label-offsets").is_disabled()
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
