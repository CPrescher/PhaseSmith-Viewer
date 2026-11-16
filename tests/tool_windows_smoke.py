"""Tool-window workflow: edit while the affected structure stays in view.

Real mouse/touch input only (diagnostics are read only). Checks, on a desktop,
a landscape and a portrait tablet and phones (both themes):
- the default palette covers neither the original canvas controls nor the
  crystal, and the crystal is framed in the area the windows leave clear;
- dragging the cutoff speed track and the opacity slider moves no control
  (0 px) while the counts, polyhedra and face opacity change live;
- choosing another tool keeps the palette outline; values, selection and
  scroll stay with each tool; invalid (hkl) shows an error without reflow;
  a new plane appears without moving the camera;
- picking atoms and measuring never replaces or scrolls the open tool;
- Keep open gives a second window beside the first, never a duplicate;
  windows move, clamp on resize and return; Tidy restores default places;
- right-drag pan stays 1:1 and wheel zoom keeps the cursor point fixed with
  the crystal centred off-axis; Fit frames it inside the clear area;
- phone: Tools menu, bottom sheet, explicit Tune / All settings (scroll
  restored), bounded Details, 44 px targets, state across orientation.
Known forsterite volumes (Mg1 11.787, Mg2 12.392, Si 2.208 Å³) are read from
the Sites table at the end.

Portable: bundled Chromium by default; BROWSER_CHANNEL=chrome or
CHROMIUM_EXECUTABLE to choose another; VIEWER_URL selects the app.
"""

import asyncio
import math
import os
from playwright.async_api import async_playwright

URL = os.environ.get("VIEWER_URL", "http://127.0.0.1:4179").rstrip("/")
WINDOW = "#tool-layer .tool-window:not([hidden])"
ORIGINAL = ["#view-a", "#view-b", "#view-c", ".view-directions summary", "#turn-open", "#reset",
            "#measure-info", "#measure-distance", "#measure-angle", "#clear", "#show-atoms", "#size"]
HITS = """(sel) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return Boolean(hit && (hit === el || el.contains(hit) || hit.closest('label')?.contains(el)));
}"""
RECTS = """(sels) => sels.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })"""
RECORD = """(sels) => { window.__frames = []; window.__rec = true;
  const f = () => { if (!window.__rec) return;
    window.__frames.push(sels.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    requestAnimationFrame(f); };
  f(); }"""
STOP = "() => { window.__rec = false; return window.__frames; }"


async def diag(page):
    return await page.evaluate("viewerDiagnostics()")


async def settle(page, frames=2):
    for _ in range(frames):
        await page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")


def same(a, b, tol=0.51):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


async def tap(page, selector, touch):
    loc = page.locator(selector).first
    await (loc.tap() if touch else loc.click())
    await settle(page)


async def choose(page, button, touch):
    loc = page.locator(button)
    if not await loc.is_visible():
        await tap(page, "#tools-menu", touch)
        await loc.wait_for(state="visible")
    await tap(page, button, touch)


async def stage_frames_crystal(page, where, margin=2):
    """Every visible atom centre lies inside the clear stage area, and no
    window covers it."""
    d = await diag(page)
    canvas = await page.locator("canvas").bounding_box()
    clear = d["stage"]["clear"]
    left, top = canvas["x"] + clear["x"], canvas["y"] + clear["y"]
    for a in d["atoms"]:
        if not a["visible"]:
            continue
        assert left - margin <= a["x"] <= left + clear["w"] + margin and top - margin <= a["y"] <= top + clear["h"] + margin, (where, "atom outside the clear area", a["label"], a["x"], a["y"], clear)
        assert await page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.tagName", [a["x"], a["y"]]) in ("CANVAS", "SPAN"), (where, "atom covered", a["label"])


async def open_page(browser, width, height, touch, theme):
    context = await browser.new_context(viewport={"width": width, "height": height}, has_touch=touch, is_mobile=touch and width < 900)
    await context.add_init_script(f"localStorage.setItem('psv-theme','{theme}')")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12 && !viewerDiagnostics().session.suspended", timeout=45000
    )
    await settle(page)
    return context, page, errors


async def check_defaults(page, where, guide):
    d = await diag(page)
    assert d["windows"]["visible"] == ["pairs"], (where, d["windows"]["visible"])
    for sel in ORIGINAL:
        assert await page.evaluate(HITS, sel), (where, "original control covered", sel)
    await stage_frames_crystal(page, where)
    assert d["windows"]["clearFraction"] >= guide, (where, "clear area", d["windows"]["clearFraction"], guide)
    return d


async def desktop(browser, width, height, touch, theme):
    where = f"{width}×{height} {'touch' if touch else 'mouse'} {theme}"
    context, page, errors = await open_page(browser, width, height, touch, theme)
    d = await check_defaults(page, where, 0.6 if width >= 1200 else 0.5)
    assert d["windows"]["profile"] == "float", where

    # ---- Cutoff speed track: nothing moves, the structure changes live.
    mg = page.locator('.pair-rule[data-tune-item="rule:1"]')
    field = mg.locator("[data-field=cutoff]")
    await (field.tap() if touch else field.click())
    track = mg.locator("[data-field=cutoff-speed]")
    await track.wait_for(state="visible")
    watched = [WINDOW, '.pair-rule[data-tune-item="rule:1"] [data-field=cutoff]', '.pair-rule[data-tune-item="rule:1"] [data-field=cutoff-speed]',
               '.pair-rule[data-tune-item="rule:2"] [data-field=polyhedra]', '.pair-rule[data-tune-item="rule:2"] [data-field=opacity]',
               "#pair-count-1", "#measure-info", "#view-c", "canvas"]
    before = await page.evaluate(RECTS, watched)
    pose = (await diag(page))["camera"]
    counts0 = await page.locator("#pair-count-1").inner_text()
    box = await track.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    await page.evaluate(RECORD, watched)
    if touch:
        cdp = await context.new_cdp_session(page)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy, "id": 1}]})
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx + box["width"] * 0.45, "y": cy, "id": 1}]})
        await page.wait_for_timeout(900)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    else:
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + box["width"] * 0.45, cy, steps=4)
        await page.wait_for_timeout(900)
        await page.mouse.up()
    await page.wait_for_timeout(250)
    frames = await page.evaluate(STOP)
    assert len(frames) > 10, (where, len(frames))
    for frame in frames:
        for i, rect in enumerate(frame):
            assert same(rect, before[i]), (where, "moved during cutoff drag", watched[i], rect, before[i])
    value = float(await field.input_value())
    assert value > 2.3, (where, "cutoff did not grow", value)
    assert await page.locator("#pair-count-1").inner_text() != counts0, (where, "counts did not follow the cutoff")
    assert (await diag(page))["camera"] == pose, (where, "cutoff edit moved the camera")
    await field.fill("2.3")
    await field.press("Enter")
    await settle(page)
    assert float(await field.input_value()) == 2.3, where
    assert await field.get_attribute("aria-expanded") == "false", (where, "Enter kept the tuner open")
    await page.keyboard.press("Escape")  # leaves the field; the window stays
    assert (await diag(page))["windows"]["visible"] == ["pairs"], (where, "Escape in a field closed the tool")

    # ---- Opacity slider: live faces, no movement.
    slider = page.locator('.pair-rule[data-tune-item="rule:2"] [data-field=opacity]')
    sbox = await slider.bounding_box()
    before = await page.evaluate(RECTS, watched)
    await page.evaluate(RECORD, watched)
    sx, sy = sbox["x"] + sbox["width"] * 0.34, sbox["y"] + sbox["height"] / 2
    if touch:
        cdp = await context.new_cdp_session(page)
        for kind, x in (("touchStart", sx), ("touchMove", sx + sbox["width"] * 0.3), ("touchMove", sbox["x"] + sbox["width"] * 0.8)):
            await cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": sy, "id": 2}]})
            await page.wait_for_timeout(60)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    else:
        await page.mouse.move(sx, sy)
        await page.mouse.down()
        await page.mouse.move(sbox["x"] + sbox["width"] * 0.8, sy, steps=6)
        await page.mouse.up()
    await settle(page)
    frames = await page.evaluate(STOP)
    for frame in frames:
        for i, rect in enumerate(frame):
            assert same(rect, before[i]), (where, "moved during opacity drag", watched[i], rect, before[i])
    faces = {f["id"]: f["opacity"] for f in (await diag(page))["faceMaterials"]}
    assert faces[2] > 0.6, (where, "face opacity not live", faces)

    # ---- Tool switch: same outline; Lattice edits; error without reflow.
    pairs_rect = (await page.evaluate(RECTS, [WINDOW]))[0]
    await choose(page, "#mode-lattice", touch)
    assert same((await page.evaluate(RECTS, [WINDOW]))[0], pairs_rect), (where, "Lattice changed the palette outline")
    pose = (await diag(page))["camera"]
    await tap(page, "#plane-add", touch)
    row = page.locator("[data-plane-id]").first
    hkl = row.locator("[data-field=hkl]")
    await hkl.fill("1 1 1")
    await hkl.press("Tab")
    await settle(page)
    lattice = (await diag(page))["lattice"]
    assert lattice["planes"][0]["hkl"] == [1, 1, 1] and not lattice["planes"][0]["error"], (where, lattice["planes"][0])
    assert (await diag(page))["camera"] == pose, (where, "adding a plane moved the camera")
    row_rect = (await page.evaluate(RECTS, ["[data-plane-id]"]))[0]
    await hkl.fill("0 0 0")
    await hkl.press("Tab")
    await settle(page)
    assert "zero" in (await row.locator("[data-readout]").inner_text()), where
    assert same((await page.evaluate(RECTS, ["[data-plane-id]"]))[0], row_rect), (where, "invalid hkl reflowed the row")
    await hkl.fill("1 1 1")
    await hkl.press("Tab")

    # ---- Measuring with a tool open: the tool stays, nothing scrolls.
    await tap(page, "#measure-distance", touch)
    d = await diag(page)
    picks = [a for a in d["atoms"] if a["visible"] and await page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.tagName==='CANVAS'", [a["x"], a["y"]])][:2]
    for a in picks:
        await (page.touchscreen.tap(a["x"], a["y"]) if touch else page.mouse.click(a["x"], a["y"]))
        await settle(page)
    d = await diag(page)
    assert len(d["selectedIds"]) == 2 and d["distance"] > 0, (where, d["selectedIds"])
    assert d["windows"]["visible"] == ["lattice"], (where, "measuring replaced the tool")
    assert same((await page.evaluate(RECTS, [WINDOW]))[0], pairs_rect), (where, "measuring moved the palette")
    await tap(page, "#measure-info", touch)

    # ---- Keep open: a second window beside it, never a duplicate.
    await tap(page, "#tool-window-lattice [data-action=pin]", touch)
    await choose(page, "#mode-pairs", touch)
    d = await diag(page)
    rects = d["windows"]["rects"]
    assert sorted(d["windows"]["visible"]) == ["lattice", "pairs"], (where, d["windows"]["visible"])
    a, b = rects["lattice"], rects["pairs"]
    assert a["x"] >= b["x"] + b["w"] or b["x"] >= a["x"] + a["w"] or a["y"] >= b["y"] + b["h"] or b["y"] >= a["y"] + a["h"], (where, "windows overlap", rects)
    await choose(page, "#mode-lattice", touch)
    assert await page.locator(WINDOW).count() == 2, (where, "duplicate window")
    for sel in ORIGINAL:
        assert await page.evaluate(HITS, sel), (where, "original control covered with two windows", sel)
    await stage_frames_crystal(page, where + " two windows")

    if not touch:
        # ---- Move, clamp on resize, return; Tidy.
        head = await page.locator("#tool-window-pairs .tool-window-head").bounding_box()
        await page.mouse.move(head["x"] + 60, head["y"] + head["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(head["x"] - 200, head["y"] + 80, steps=6)
        await page.mouse.up()
        await settle(page)
        moved = (await diag(page))["windows"]["rects"]["pairs"]
        view = await page.locator("canvas").bounding_box()
        expected_y = min(b["y"] + 80, view["height"] - b["h"] - 8)  # stays fully on screen
        assert abs(moved["x"] - (b["x"] - 260)) < 2 and abs(moved["y"] - expected_y) < 2, (where, moved, b)
        await page.set_viewport_size({"width": 900, "height": 640})
        await page.wait_for_timeout(250)
        small = await diag(page)
        ws = small["windows"]
        canvas = await page.locator("canvas").bounding_box()
        for tool, r in ws["rects"].items():
            assert r["x"] >= 0 and r["y"] >= 0 and r["x"] + r["w"] <= canvas["width"] + 0.5 and r["y"] + r["h"] <= canvas["height"] + 0.5, (where, "window off screen", tool, r)
        await page.set_viewport_size({"width": width, "height": height})
        await page.wait_for_timeout(250)
        assert same(list((await diag(page))["windows"]["rects"]["pairs"].values()), list(moved.values()), 1), (where, "window did not return")
        await tap(page, "#tools-tidy", touch)
        d = await diag(page)
        assert same(list(d["windows"]["rects"]["lattice"].values()), list(a.values()), 1), (where, "Tidy", d["windows"]["rects"])

        # ---- 1:1 pan and cursor-anchored zoom with the off-axis stage.
        assert d["stage"]["x"] != 0, (where, "stage offset expected with palettes open")
        atom = min((x for x in d["atoms"] if x["visible"]), key=lambda x: x["x"])
        x0, y0 = atom["x"], atom["y"]
        await page.mouse.move(x0, y0)
        await page.mouse.down(button="right")
        await page.mouse.move(x0 + 60, y0 + 35, steps=5)
        await page.mouse.up(button="right")
        await settle(page)
        moved_atom = next(x for x in (await diag(page))["atoms"] if x["id"] == atom["id"])
        assert math.dist([moved_atom["x"], moved_atom["y"]], [x0 + 60, y0 + 35]) < 0.5, (where, "pan slipped", moved_atom, x0, y0)
        await page.mouse.move(moved_atom["x"], moved_atom["y"])
        await page.mouse.wheel(0, -240)
        await page.wait_for_timeout(300)
        zoomed = next(x for x in (await diag(page))["atoms"] if x["id"] == atom["id"])
        assert math.dist([zoomed["x"], zoomed["y"]], [moved_atom["x"], moved_atom["y"]]) < 0.5, (where, "zoom not anchored", zoomed, moved_atom)
        # Double right-click fits inside the clear area again.
        c = await page.locator("canvas").bounding_box()
        await page.mouse.click(c["x"] + 40, c["y"] + c["height"] - 140, button="right")
        await page.mouse.click(c["x"] + 40, c["y"] + c["height"] - 140, button="right")
        await settle(page)
        assert (await diag(page))["stage"]["atFit"], where
        await stage_frames_crystal(page, where + " after fit")

    assert not errors, (where, errors)
    await context.close()
    print(f"{where}: stationary cutoff/opacity drags, same outline per tool, kept window, clear-area framing")


async def phone(browser, width, height, theme):
    where = f"phone {width}×{height} {theme}"
    context, page, errors = await open_page(browser, width, height, True, theme)
    d = await check_defaults(page, where, 0.35)
    assert d["windows"]["profile"] == "sheet" and d["windows"]["launcher"] == "menu", where
    sheet = (await page.evaluate(RECTS, [WINDOW]))[0]
    # 44 px targets for the launcher, window chrome and pair controls.
    for sel in ["#tools-menu", "#tool-window-pairs [data-action=close]", "#tool-window-pairs [data-action=minimize]",
                "#tool-window-pairs .tune-button", ".pair-rule [data-field=cutoff]", ".pair-rule label:has([data-field=polyhedra])", ".pair-rule .icon-button"]:
        r = (await page.evaluate(RECTS, [sel]))[0]
        assert r[2] >= 43.5 and r[3] >= 43.5, (where, "small target", sel, r)
    # Tools menu: labelled, then the sheet keeps its place per tool.
    await tap(page, "#tools-menu", True)
    for sel in ["#mode-pairs", "#mode-lattice", "#mode-export"]:
        r = (await page.evaluate(RECTS, [sel]))[0]
        assert r[3] >= 43.5, (where, sel, r)
    await tap(page, "#mode-sites", True)
    assert same((await page.evaluate(RECTS, [WINDOW]))[0], sheet), (where, "Sites sheet outline")
    await choose(page, "#mode-pairs", True)
    # Scroll Pairs a little, choose the Mg–O cutoff and Tune.
    body = page.locator("#tool-window-pairs .tool-window-body")
    await body.evaluate("el => el.scrollTo(0, 40)")
    scroll = await body.evaluate("el => el.scrollTop")
    mg = page.locator('.pair-rule[data-tune-item="rule:1"]')
    await mg.locator("[data-field=polyhedra]").tap()  # marks Mg–O as the entry to tune
    await mg.locator("[data-field=polyhedra]").tap()
    await settle(page)
    scroll = await body.evaluate("el => el.scrollTop")  # where All settings must return
    await tap(page, "#tool-window-pairs .tune-button", True)
    d = await diag(page)
    title = await page.locator("#tool-title-pairs").inner_text()
    assert "Mg–O" in title, (where, title)
    assert d["windows"]["clearFraction"] >= 0.55, (where, "Tune clear area", d["windows"]["clearFraction"])
    assert await mg.locator("[data-field=cutoff]").is_visible() and await mg.locator("[data-field=opacity]").is_visible(), where
    assert not await page.locator('.pair-rule[data-tune-item="rule:2"]').is_visible(), (where, "Tune shows other entries")
    await stage_frames_crystal(page, where + " tune")
    # Exact entry in Tune.
    field = mg.locator("[data-field=cutoff]")
    await field.fill("2.4")
    await field.press("Enter")
    await settle(page)
    assert float(await field.input_value()) == 2.4
    await tap(page, "#tool-window-pairs .tune-button", True)
    assert abs(await body.evaluate("el => el.scrollTop") - scroll) < 1, (where, "All settings lost the scroll position")
    assert await page.locator('.pair-rule[data-tune-item="rule:2"]').is_visible(), where
    # Pick: the sheet stays, Details is bounded and inside the clear area.
    d = await diag(page)
    atom = [a for a in d["atoms"] if a["visible"] and await page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.tagName==='CANVAS'", [a["x"], a["y"]])][0]
    await page.touchscreen.tap(atom["x"], atom["y"])
    await settle(page)
    assert (await diag(page))["windows"]["visible"] == ["pairs"], where
    await tap(page, "#measure-more", True)
    pop = await page.locator("#selection").bounding_box()
    assert pop and pop["x"] >= 0 and pop["x"] + pop["width"] <= width + 0.5, (where, pop)
    canvas = await page.locator("canvas").bounding_box()
    clear = (await diag(page))["stage"]["clear"]
    assert pop["y"] + pop["height"] <= canvas["y"] + clear["y"] + clear["h"] + 1, (where, "Details over the sheet", pop, clear)
    assert "occupancy" in await page.locator("#selection").inner_text(), where
    await tap(page, "#measure-more", True)
    # Orientation round trip keeps tool, sheet and scroll.
    kept = await body.evaluate("el => (el.scrollTo(0, 30), el.scrollTop)")
    assert kept > 0, where
    await page.set_viewport_size({"width": height, "height": width})
    await page.wait_for_timeout(300)
    d = await diag(page)
    assert d["windows"]["profile"] == "side" and d["windows"]["visible"] == ["pairs"], (where, d["windows"])
    assert await page.evaluate(HITS, "#turn-open"), (where, "Turn covered in landscape")
    await page.set_viewport_size({"width": width, "height": height})
    await page.wait_for_timeout(300)
    assert same((await page.evaluate(RECTS, [WINDOW]))[0], sheet), (where, "sheet after rotation")
    assert abs(await body.evaluate("el => el.scrollTop") - kept) < 1, (where, "scroll after rotation")
    # Known physical volumes in Sites (scientific values untouched).
    await choose(page, "#mode-sites", True)
    rows = [r.strip() for r in await page.locator("#poly-table tbody tr").all_inner_texts()]
    for label, volume in (("Mg1", "11.787"), ("Mg2", "12.392"), ("Si", "2.208")):
        assert any(label in r and volume in r for r in rows), (where, label, rows)
    assert not errors, (where, errors)
    await context.close()
    print(f"{where}: menu, sheet, Tune/All settings, bounded Details, rotation state, known volumes")


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("CI"):
            options["args"] += ["--use-gl=angle", "--use-angle=swiftshader-webgl"]
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        elif os.environ.get("CHROMIUM_EXECUTABLE"):
            options["executable_path"] = os.environ["CHROMIUM_EXECUTABLE"]
        browser = await p.chromium.launch(**options)
        for theme in ("dark", "light"):
            await desktop(browser, 1440, 900, False, theme)
            await phone(browser, 390, 844, theme)
        await desktop(browser, 1920, 1080, False, "dark")
        await desktop(browser, 1024, 768, True, "light")
        await phone(browser, 375, 667, "dark")
        # Portrait tablet: one sheet below the rail, original controls free.
        context, page, errors = await open_page(browser, 768, 1024, True, "dark")
        d = await check_defaults(page, "768×1024", 0.45)
        assert d["windows"]["profile"] == "sheet" and d["windows"]["launcher"] == "rail"
        assert not errors, errors
        await context.close()
        print("768×1024: sheet below the rail, controls and crystal clear")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
