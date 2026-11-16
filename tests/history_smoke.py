"""Undo/redo through real controls, mouse and touch gestures (desktop/phone)."""
import asyncio
import math
import os
from playwright.async_api import async_playwright
from smoke import URL, HERE, diagnostics, choose_tool


async def idle(page):
    await page.wait_for_function("viewerDiagnostics().history.ready && !viewerDiagnostics().history.pending")
    await page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


async def state(page):
    return (await diagnostics(page))["history"]["snapshot"]


def equivalent(a, b):
    if isinstance(a, (float, int)) and not isinstance(a, bool):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(equivalent(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(equivalent(x, y) for x, y in zip(a, b))
    return a == b


async def check(browser, phone):
    context = await browser.new_context(viewport={"width": 390 if phone else 1440, "height": 844 if phone else 900}, has_touch=phone, is_mobile=phone)
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    await idle(page)

    async def press(selector):
        if selector in ["#mode-pairs", "#mode-lattice", "#mode-sites", "#mode-extent", "#mode-export", "#style-open"]:
            await choose_tool(page, selector, phone)
            await idle(page)
            return
        el = page.locator(selector).first
        await (el.tap() if phone else el.click())
        await idle(page)

    async def count():
        return (await diagnostics(page))["history"]["undoCount"]

    async def roundtrip(before, after):
        await press("#history-undo")
        restored = await state(page)
        assert equivalent(restored, before), ("undo", restored, before)
        await press("#history-redo")
        assert equivalent(await state(page), after), "redo failed"

    assert await count() == 0
    assert await page.locator("#history-undo").is_disabled()
    initial = await state(page)
    await press("#mode-pairs")
    await press("#add-rule")
    added = await state(page)
    assert len(added["rules"]) == len(initial["rules"]) + 1
    await roundtrip(initial, added)
    # UI navigation is not an edit and must preserve redo.
    await press("#history-undo")
    await press("#mode-lattice")
    assert await count() == 0
    assert not await page.locator("#history-redo").is_disabled()
    await press("#history-redo")
    n = await count()
    before = await state(page)
    await press("#plane-add")
    after = await state(page)
    assert len(after["lattice"]["planes"]) == 1
    await roundtrip(before, after)
    assert await count() == n + 1
    # Plane label settings and symmetry state restore their actual controls.
    before = await state(page)
    await page.locator("#lattice-label-offsets").uncheck()
    await idle(page)
    await roundtrip(before, await state(page))
    assert not await page.locator("#lattice-label-offsets").is_checked()
    before = await state(page)
    await press("#sym-toggle")
    await roundtrip(before, await state(page))
    before = await state(page)
    await press("#sym-filters input")
    await roundtrip(before, await state(page))
    # Site highlighting clears back to null, and asymmetric view restores
    # the original pair/visibility settings and measurement references.
    await press("#mode-sites")
    before = await state(page)
    await press("#site-table tbody tr")
    assert (await state(page))["highlightedSite"] is not None
    await roundtrip(before, await state(page))
    before = await state(page)
    await press("#asym-toggle")
    await roundtrip(before, await state(page))
    await press("#asym-toggle")
    # A typed/committed extent restores both the bounds and fitted camera.
    await press("#mode-extent")
    before = await state(page)
    await page.locator("#range-b-max").fill("2")
    await page.locator("#range-b-max").press("Enter")
    await idle(page)
    await roundtrip(before, await state(page))
    # Styles, including a reset that removes an override entirely.
    await press("#style-open")
    before = await state(page)
    await press("#style-swatches button")
    after = await state(page)
    assert after["appearance"] != before["appearance"]
    await roundtrip(before, after)
    before = await state(page)
    await press("#style-reset")
    await roundtrip(before, await state(page))
    # Held slider keys form one edit, including the custom cutoff slider.
    await press("#mode-pairs")
    field = page.locator('#pair-rules input[data-field="cutoff"]').first
    await field.focus()
    await field.fill("2.4")
    await field.press("Enter")
    await idle(page)
    slider = page.locator('#pair-rules [role="slider"]').first
    await field.click()
    await slider.focus()
    before = await state(page)
    n = await count()
    await page.keyboard.down("ArrowRight")
    for _ in range(5):
        await page.keyboard.down("ArrowRight")
    await page.keyboard.up("ArrowRight")
    await idle(page)
    assert await count() == n + 1, ("cutoff keyboard grouping", await count(), n)
    await roundtrip(before, await state(page))
    # Blurring a typed cutoff by toggling atom visibility is two edits.
    n = await count()
    await field.fill("2.55")
    visibility = page.locator("#show-atoms")
    previous_visibility = await visibility.is_checked()
    await visibility.click()
    await idle(page)
    assert await count() == n + 2, ("blur commit merged with next click", await count(), n)
    await press("#history-undo")
    assert (await state(page))["rules"][0]["cutoff"] == 2.55
    assert await visibility.is_checked() == previous_visibility
    await press("#history-redo")
    await press("#show-atoms")
    # Both global visibility shortcuts participate in semantic undo/redo.
    before = await state(page)
    await press("#show-polyhedra")
    after = await state(page)
    assert not after["polyhedraVisible"]
    assert all(not m['visible'] and not m['outlineVisible'] for m in (await diagnostics(page))['faceMaterials'])
    await roundtrip(before, after)
    await press("#show-polyhedra")
    # The speed control changes on animation frames, without input events.
    await field.click()
    box = await slider.bounding_box()
    before = await state(page)
    n = await count()
    sx, sy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + box["width"] * .35, sy, steps=5)
    await page.wait_for_timeout(450)
    await page.mouse.up()
    await idle(page)
    assert (await state(page))["rules"][0]["cutoff"] != before["rules"][0]["cutoff"]
    assert await count() == n + 1
    await roundtrip(before, await state(page))
    # One complete drag on the native opacity slider, despite many input events.
    opacity = page.locator('#pair-rules input[data-field="opacity"]').first
    await opacity.scroll_into_view_if_needed()
    box = await opacity.bounding_box()
    before = await state(page)
    n = await count()
    await page.mouse.move(box["x"] + box["width"] * .4, box["y"] + box["height"] / 2)
    await page.mouse.down()
    await page.mouse.move(box["x"] + box["width"] * .8, box["y"] + box["height"] / 2, steps=12)
    await page.mouse.up()
    await idle(page)
    assert await count() == n + 1
    await roundtrip(before, await state(page))
    # Measurement picks can be cleared back to an empty selection by undo.
    await press("#measure-distance")
    before = await state(page)
    atom = next(a for a in (await diagnostics(page))["atoms"] if 100 < a["x"] < (290 if phone else 1000) and 175 < a["y"] < (350 if phone else 650))
    await (page.touchscreen.tap(atom["x"], atom["y"]) if phone else page.mouse.click(atom["x"], atom["y"]))
    await idle(page)
    after = await state(page)
    assert after["measure"]["keys"]
    await roundtrip(before, after)
    await press("#clear")
    assert not (await state(page))["measure"]["keys"]
    # A picked copy's style and its removal are both reversible.
    await press("#style-open")
    await press("#style-pick")
    atom = next(a for a in (await diagnostics(page))["atoms"] if 100 < a["x"] < (290 if phone else 1000) and 175 < a["y"] < (350 if phone else 650))
    await (page.touchscreen.tap(atom["x"], atom["y"]) if phone else page.mouse.click(atom["x"], atom["y"]))
    await idle(page)
    before = await state(page)
    await press("#style-swatches button:last-child")
    after = await state(page)
    assert after["appearance"]["atoms"] or after["appearance"]["polyhedra"]
    await roundtrip(before, after)
    # Undoing its first override must leave the picked copy editable.
    await press("#history-undo")
    assert await page.locator("#style-swatches button:last-child").is_enabled()
    await press("#style-swatches button:last-child")
    assert equivalent(await state(page), after)
    await roundtrip(before, after)
    before = await state(page)
    await press("#style-reset-individual")
    after = await state(page)
    assert not after["appearance"]["atoms"] and not after["appearance"]["polyhedra"]
    await roundtrip(before, after)
    # A new actual edit discards redo; returning through tabs did not.
    await press("#history-undo")
    await press("#show-atoms")
    assert (await diagnostics(page))["history"]["redoCount"] == 0
    await press("#show-atoms")
    await press("#mode-pairs")
    # Camera rotation, including damping, is one entry. Pinch on the phone.
    canvas = page.locator("canvas").first
    box = await canvas.bounding_box()
    clear = (await diagnostics(page))["stage"]["clear"]
    x, y = box["x"] + clear["x"] + clear["w"] * .55, box["y"] + clear["y"] + clear["h"] * .55
    before = await state(page)
    n = await count()
    if phone:
        cdp = await context.new_cdp_session(page)
        points = lambda gap: [{"x": x-gap, "y": y, "id": 1}, {"x": x+gap, "y": y, "id": 2}]
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": points(15)})
        for gap in (20, 30, 40, 55):
            await cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": points(gap)})
            await page.wait_for_timeout(30)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    else:
        await page.mouse.move(x, y)
        await page.mouse.down()
        for i in range(10):
            await page.mouse.move(x + i*9, y + i*4)
            await page.wait_for_timeout(16)
        await page.mouse.up()
    await idle(page)
    after = await state(page)
    assert not equivalent(before["camera"], after["camera"])
    assert await count() == n + 1, ("camera grouping", await count(), n)
    await roundtrip(before, after)
    # Wheel burst is one entry. Right-drag is one pan, with exact reversal.
    before = await state(page)
    n = await count()
    await page.mouse.move(x, y)
    # Queue one native input burst without waiting for a rendered frame
    # between events. Software rendering in CI can take longer than the
    # gesture's quiet period; serial awaited inputs then become separate
    # gestures even though the test requested only a 35 ms pause.
    await asyncio.gather(*(page.mouse.wheel(0, 35) for _ in range(5)))
    await idle(page)
    assert await count() == n + 1, ("wheel grouping", await count(), n)
    await roundtrip(before, await state(page))
    before = await state(page)
    n = await count()
    await page.mouse.move(x, y)
    await page.mouse.down(button="right")
    await page.mouse.move(x+55, y+30, steps=10)
    await page.mouse.up(button="right")
    await idle(page)
    assert await count() == n + 1
    await roundtrip(before, await state(page))
    if not phone:
        # Back-to-back gestures remain separate even before damping settles.
        n = await count()
        for dx in (45, -35):
            await page.mouse.move(x, y)
            await page.mouse.down()
            await page.mouse.move(x + dx, y + 10, steps=6)
            await page.mouse.up()
        await idle(page)
        assert await count() == n + 2
        # Undo during the next gesture's residual motion is immediate and stable.
        before = await state(page)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + 65, y + 20, steps=8)
        await page.mouse.up()
        await page.keyboard.press("Control+z")
        await idle(page)
        assert equivalent(await state(page), before)
        await page.wait_for_timeout(400)
        assert equivalent(await state(page), before)
    # Exact turns and shortcut variants. Camera-only history keeps geometry.
    await press("#turn-open")
    before = await state(page)
    geometry = (await diagnostics(page))["sphereGeometry"]
    await press("#turn-right")
    after = await state(page)
    await page.locator("#turn-close").click()
    await page.keyboard.press("Control+z")
    await idle(page)
    assert equivalent(before, await state(page))
    assert (await diagnostics(page))["sphereGeometry"] == geometry
    await page.keyboard.press("Control+y")
    await idle(page)
    assert equivalent(after, await state(page))
    await page.keyboard.press("Meta+z")
    await idle(page)
    assert equivalent(before, await state(page))
    await page.keyboard.press("Meta+Shift+z")
    await idle(page)
    assert equivalent(after, await state(page))
    # Text input keeps browser undo, and an unrelated preference is not an edit.
    await press("#mode-export")
    n = await count()
    await page.locator("#export-dpi").fill("240")
    await page.locator("#export-dpi").press("Control+z")
    await idle(page)
    assert await count() == n
    # Export frames never enter history, and shortcuts are blocked during it.
    if await page.locator("#export-video").is_enabled():
        await page.locator('input[name="export-scale"][value="1"]').check()
        await page.locator("#export-seconds").select_option("4")
        await page.locator("#export-fps").select_option("24")
        await idle(page)
        before = await state(page)
        n = await count()
        await page.locator("#export-video").click()
        await page.wait_for_function("viewerDiagnostics().export.busy")
        assert await page.locator("#history-undo").is_disabled()
        assert await page.locator("#history-redo").is_disabled()
        await page.keyboard.press("Control+z")
        assert await count() == n
        await page.locator("#export-cancel").click()
        await page.wait_for_function("!viewerDiagnostics().export.busy")
        await idle(page)
        assert equivalent(await state(page), before)
        assert await count() == n
    # Autosave after undo survives a reload, with a fresh history.
    await press("#history-undo")
    saved = await state(page)
    await press("#session-save")
    await page.wait_for_function("!viewerDiagnostics().session.pending")
    await page.wait_for_timeout(200)
    await page.reload()
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    await idle(page)
    assert equivalent(await state(page), saved), "saved undo state was not restored"
    assert await count() == 0
    # Failed CIF leaves history usable; successful loading resets it.
    await press("#view-a")
    n = await count()
    await page.locator("#file").set_input_files({"name": "invalid.cif", "mimeType": "text/plain", "buffer": b"invalid"})
    await page.wait_for_function("document.getElementById('loading').hidden")
    assert await count() == n
    await page.locator("#file").set_input_files(HERE / "known-distance.cif")
    await page.wait_for_function("viewerDiagnostics().block === 'periodic_distance' && viewerDiagnostics().history.ready")
    assert await count() == 0
    assert await page.locator("#history-undo").is_disabled()
    assert await page.evaluate("document.scrollingElement.scrollWidth === innerWidth")
    await page.screenshot(path=f"/tmp/viewer-history-{'phone' if phone else 'desktop'}.png")
    assert not errors, errors
    await context.close()
    print(f"{'Phone' if phone else 'Desktop'}: scene edits, grouped gestures, shortcuts, session and load boundaries passed", flush=True)


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("CI"):
            options["args"] += ["--use-gl=angle", "--use-angle=swiftshader-webgl"]
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for phone in (False, True):
            await check(browser, phone)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
