"""Stable layout: the crystal canvas, the tool launcher (rail, or the header
Tools button on phones), the open tool window's outline and the mouse-action
buttons keep their exact bounds in every animation frame while atoms are
picked, measurement modes and tools change, pairs/planes/arrows are added and
edited, a tool window is scrolled by a real touch gesture (wheel with a
mouse), Turn and editors open and close, and after a resize/orientation round
trip. Each tool keeps its own scroll position; picking never scrolls or
replaces the open tool.

Portable: Playwright's bundled Chromium by default. BROWSER_CHANNEL=chrome uses
an installed Chrome and CHROMIUM_EXECUTABLE another Chromium build;
WEBKIT_EXECUTABLE=/path/to/pw_run.sh also runs WebKit (Playwright has no touch
swipe and no wheel on mobile WebKit, so WebKit runs touch without mobile
emulation and scrolls with the wheel). VIEWER_URL selects the app.
"""

import asyncio
import os
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from phone_measure_smoke import CIF

URL = os.environ.get("VIEWER_URL", "http://127.0.0.1:4179").rstrip("/")
SIZES = [(390, 844, True), (768, 1024, True), (700, 900, False), (1440, 900, False)]
WINDOW = "#tool-layer .tool-window:not([hidden])"
RECTS = """(sels) => Object.fromEntries(sels.map((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return [s, [r.x, r.y, r.width, r.height]];
}))"""
RECORD = """(sels) => {
  window.__frames = [];
  window.__recording = true;
  const frame = () => {
    if (!window.__recording) return;
    window.__frames.push(Object.fromEntries(sels.map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return [s, [r.x, r.y, r.width, r.height]];
    })));
    requestAnimationFrame(frame);
  };
  frame();
}"""
NO_PAGE_SCROLL = """() => scrollX === 0 && scrollY === 0 &&
  document.scrollingElement.scrollWidth <= innerWidth &&
  document.scrollingElement.scrollHeight <= innerHeight"""
# A point is usable when the element drawn there is the target (or inside it).
HITS = """([sel, dy]) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + (dy ?? r.height / 2));
  return Boolean(hit && (hit === el || el.contains(hit)));
}"""


def same(a, b):
    return all(abs(x - y) < 1 for x, y in zip(a, b))


async def check(browser, engine, width, height, touch, theme):
    context = await browser.new_context(
        viewport={"width": width, "height": height},
        has_touch=touch,
        is_mobile=touch and engine == "chromium",
    )
    await context.add_init_script(f"localStorage.setItem('psv-theme', '{theme}')")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().atoms.length>0 && !window.viewerDiagnostics().session.suspended",
        timeout=45000,
    )
    await page.locator("#file").set_input_files(
        {"name": "angle.cif", "mimeType": "text/plain", "buffer": CIF.encode()}
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='angle'")
    phone = width <= 640
    where = f"{engine} {width}×{height} {theme}"
    launcher = "#tools-menu" if phone else "#tool-rail"
    tracked = ["#viewport", "canvas", launcher, WINDOW, "#measure-info", "#measure-distance", "#measure-angle", "#clear"]

    baseline = None

    async def settle(action=""):
        await page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
        if baseline:  # fail at the action that moved something
            now = await page.evaluate(RECTS, tracked)
            for selector in tracked:
                assert same(now[selector], baseline[selector]), (where, action, selector, now[selector], baseline[selector])

    async def press(selector):
        locator = page.locator(selector).first
        launcher_button = selector.startswith("#mode-") or selector == "#style-open"
        if launcher_button and await locator.get_attribute("aria-pressed") == "true":
            return
        if launcher_button and not await locator.is_visible():  # phone: Tools menu
            menu = page.locator("#tools-menu")
            await (menu.tap() if touch else menu.click())
            await locator.wait_for(state="visible")
        await (locator.tap() if touch else locator.click())
        await settle(selector)
        assert await page.evaluate(NO_PAGE_SCROLL), (where, "page scrolled", selector)

    async def pick(label):
        atom = next(a for a in (await page.evaluate("viewerDiagnostics()"))["atoms"] if a["label"] == label)
        assert await page.evaluate(
            "([x,y])=>document.elementFromPoint(x,y)?.tagName==='CANVAS'", [atom["x"], atom["y"]]
        ), (where, "atom covered", label)
        if touch:
            await page.touchscreen.tap(atom["x"], atom["y"])
        else:
            await page.mouse.click(atom["x"], atom["y"])
        await settle("pick " + label)

    async def scroll_window(dy):
        box = await page.locator(WINDOW + " .tool-window-body").bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] - 30
        if touch and engine == "chromium":
            # A real compositor touch gesture, not element.scrollTop.
            cdp = await context.new_cdp_session(page)
            await cdp.send(
                "Input.synthesizeScrollGesture",
                {"x": x, "y": y, "yDistance": -dy, "gestureSourceType": "touch", "speed": 1200},
            )
        else:
            await page.mouse.move(x, y)
            await page.mouse.wheel(0, dy)
        await page.wait_for_timeout(300)
        await settle("window scroll")

    async def window_scroll():
        return await page.locator(WINDOW + " .tool-window-body").evaluate("el => el.scrollTop")

    async def shown_tool():
        return await page.locator(WINDOW).get_attribute("data-tool")

    await press("#mode-pairs")
    await press("#view-c")
    assert await shown_tool() == "pairs", (where, "Pairs opens first")
    if (await page.evaluate("viewerDiagnostics().windows.profile")) == "sheet":
        window = await page.locator(WINDOW).bounding_box()
        atom = next(a for a in (await page.evaluate("viewerDiagnostics()"))["atoms"] if a["label"] == "B")
        await page.locator(WINDOW + ' [data-action=close]').click()
        dy = window["y"] - 80 - atom["y"]
        await page.mouse.move(120, atom["y"])
        await page.mouse.down(button="right")
        await page.mouse.move(120, atom["y"] + dy, steps=8)
        await page.mouse.up(button="right")
        await press("#mode-pairs")
    baseline = await page.evaluate(RECTS, tracked)
    await page.evaluate(RECORD, tracked)

    # Picks and measurement modes; the open tool stays as it is.
    await pick("A")
    if phone:
        await press("#measure-more")
        text = await page.locator("#selection").inner_text()
        assert "occupancy" in text and "frac" in text, (where, text)
        await press("#measure-more")
        assert await page.locator("#selection").is_hidden(), (where, "details stayed open")
    else:
        assert "occupancy" in await page.locator("#selection").inner_text(), where
    await press("#measure-distance")
    await pick("A")
    await pick("B")
    assert "1.4000" in await page.locator("#distance").inner_text(), where
    await press("#measure-angle")
    for label in "ABC":
        await pick(label)
    assert "90.00" in await page.locator("#distance").inner_text(), where
    await press("#clear")
    await press("#measure-info")
    assert await shown_tool() == "pairs", (where, "picking replaced the tool")

    # Every tool opens in the same window outline (tracked); additions and edits.
    for mode in ["extent", "sites", "lattice", "export", "pairs"]:
        await press("#mode-" + mode)
        assert await shown_tool() == mode, (where, mode)
    await press("#add-rule")
    cutoff = page.locator("[data-field=cutoff]").last
    sub = await page.locator(".pair-rule:last-child .pair-sub").bounding_box()
    await cutoff.click()
    await expect_attr(cutoff, "aria-expanded", "true", where)
    # The tuner covers the row under the field instead of pushing it down.
    assert same(list((await page.locator(".pair-rule:last-child .pair-sub").bounding_box()).values()), list(sub.values())), where
    await page.keyboard.press("Escape")
    await expect_attr(cutoff, "aria-expanded", "false", where)
    assert await shown_tool() == "pairs", (where, "Escape in the cutoff closed the window")
    await cutoff.fill("2.1")
    await cutoff.press("Tab")
    assert float(await cutoff.input_value()) == 2.1, where
    await press("#mode-lattice")
    assert await page.locator("#lattice-labels-toggle").evaluate(
        "el => getComputedStyle(el.nextElementSibling, '::before').display !== 'none'"
    ), (where, "checkbox state indicator missing")
    for _ in range(3):
        await press("#plane-add")
    hkl = page.locator("[data-plane-id] [data-field=hkl]").last
    await hkl.fill("1 1 0")
    await hkl.press("Tab")
    await press("#arrow-add")
    uvw = page.locator("[data-arrow-id] [data-field=uvw]").last
    await uvw.fill("1 1 0")
    await uvw.press("Tab")

    # Genuine scrolling inside the tool window; the window outline stays.
    await scroll_window(400)
    scrolled = await window_scroll()
    room = await page.locator(WINDOW + " .tool-window-body").evaluate("el => el.scrollHeight - el.clientHeight")
    assert scrolled > 0 and (scrolled > 50 or scrolled >= room - 1), (where, "window did not scroll", scrolled, room)
    await pick("A")
    assert abs(await window_scroll() - scrolled) < 1, (where, "pick scrolled the tool window")
    assert await shown_tool() == "lattice", (where, "pick replaced the tool")
    # Each tool returns with its own scroll position.
    await press("#mode-pairs")
    await press("#mode-lattice")
    assert abs(await window_scroll() - scrolled) < 1, (where, "Lattice lost its scroll position")

    # Style opens at its header, which is not hidden.
    await press("#style-open")
    assert await page.evaluate(HITS, ["#style-pick", None]), (where, "Style controls hidden")

    # Turn: fully usable, Escape restores focus, a press outside closes it.
    await press("#turn-open")
    if touch:
        close = await page.locator("#turn-close").bounding_box()
        assert close["width"] >= 44 and close["height"] >= 44, (where, close)
    for selector in ["#turn-close", "#turn-preset-5", "#turn-down-right", "#turn-counterclockwise"]:
        assert await page.evaluate(HITS, [selector, None]), (where, "Turn control hidden", selector)
    await press("#turn-right")
    await page.keyboard.press("Escape")
    await settle("Turn Escape")
    assert await page.locator("#turn-panel").is_hidden(), (where, "Escape kept Turn open")
    assert await page.evaluate("document.activeElement?.id") == "turn-open", (where, "focus not restored")
    await press("#turn-open")
    await press("#view-a")
    assert await page.locator("#turn-panel").is_hidden(), (where, "outside press kept Turn open")

    frames = await page.evaluate("() => { window.__recording = false; return window.__frames; }")
    assert len(frames) > 20, (where, len(frames))
    for i, frame in enumerate(frames):
        for selector in tracked:
            assert same(frame[selector], baseline[selector]), (where, "frame", i, selector, frame[selector], baseline[selector])

    # Resize / orientation round trip: fills the new window, keeps the tool
    # and its window, then returns to exactly the same layout.
    await page.set_viewport_size({"width": height, "height": width})
    await page.wait_for_timeout(300)
    turned = await page.evaluate(RECTS, ["canvas", WINDOW])
    assert await page.evaluate(NO_PAGE_SCROLL), (where, "page scrolled after rotation")
    canvas = turned["canvas"]
    assert canvas[0] >= 0 and canvas[1] >= 0 and canvas[0] + canvas[2] <= height + 1 and canvas[1] + canvas[3] <= width + 1, (where, canvas)
    win = turned[WINDOW]
    assert win[0] >= -1 and win[1] >= -1 and win[0] + win[2] <= height + 1 and win[1] + win[3] <= width + 1, (where, "window off screen", win)
    assert await shown_tool() == "style", (where, "rotation changed the tool")
    await page.set_viewport_size({"width": width, "height": height})
    await page.wait_for_timeout(300)
    back = await page.evaluate(RECTS, tracked)
    for selector in tracked:
        assert same(back[selector], baseline[selector]), (where, "after rotation", selector, back[selector], baseline[selector])

    assert not errors, (where, errors)
    await context.close()
    print(f"{where}: {len(frames)} frames, canvas {baseline['canvas'][2]:.0f}×{baseline['canvas'][3]:.0f} and tool window fixed")


async def expect_attr(locator, name, value, where):
    for _ in range(30):
        if await locator.get_attribute(name) == value:
            return
        await asyncio.sleep(0.05)
    raise AssertionError((where, name, value, await locator.get_attribute(name)))


async def check_landscape_legend(browser, engine, theme):
    """A three-element legend stays usable beside Size on a landscape phone,
    with the side sheet open."""
    page = await browser.new_page(
        viewport={"width": 844, "height": 390}, has_touch=True, is_mobile=True
    )
    await page.add_init_script(f"localStorage.setItem('psv-theme', '{theme}')")
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12 && !viewerDiagnostics().session.suspended",
        timeout=45000,
    )
    await page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    from smoke import choose_tool
    await choose_tool(page, "#mode-pairs", True)
    toolbar = await page.locator(".view-directions").bounding_box()
    reset = await page.locator("#reset").bounding_box()
    assert reset["x"] >= toolbar["x"] and reset["x"] + reset["width"] <= toolbar["x"] + toolbar["width"] + 1
    assert toolbar["height"] <= 56, (engine, theme, "toolbar wrapped", toolbar)
    sheet = await page.locator(WINDOW).bounding_box()
    tracked = ["#viewport", "canvas", "#tools-menu", WINDOW, "#measure-info", "#clear"]
    before = await page.evaluate(RECTS, tracked)
    size_box = await page.locator(".size-control").bounding_box()
    assert size_box["y"] >= sheet["y"] + sheet["height"], (engine, theme, "Size under the side sheet")
    for element in ["Mg", "Si", "O"]:
        chip = page.locator(f'[data-element="{element}"]')
        await chip.scroll_into_view_if_needed()
        await page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
        assert await page.evaluate(HITS, [f'[data-element="{element}"]', None]), (engine, theme, element, "legend target covered")
        await chip.tap()
        await expect_attr(chip, "aria-pressed", "false", (engine, theme, element))
        current_size = await page.locator(".size-control").bounding_box()
        assert same(list(current_size.values()), list(size_box.values())), (engine, theme, "Size moved after element toggle")
        await chip.tap()
        await expect_attr(chip, "aria-pressed", "true", (engine, theme, element))
    after = await page.evaluate(RECTS, tracked)
    assert all(same(before[s], after[s]) for s in tracked), (engine, theme, "legend changed bounds")
    assert await page.evaluate(NO_PAGE_SCROLL), (engine, theme, "legend scrolled page")
    await page.close()
    print(f"{engine} 844×390 {theme}: toolbar on one row, legend usable beside the side sheet")


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("CI"):
            options["args"] += ["--use-gl=angle", "--use-angle=swiftshader-webgl"]
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        elif os.environ.get("CHROMIUM_EXECUTABLE"):
            options["executable_path"] = os.environ["CHROMIUM_EXECUTABLE"]
        browsers = [("chromium", await p.chromium.launch(**options))]
        if os.environ.get("WEBKIT_EXECUTABLE"):
            browsers.append(("webkit", await p.webkit.launch(executable_path=os.environ["WEBKIT_EXECUTABLE"])))
        for engine, browser in browsers:
            cases = [(390, 844, True, "dark"), (1000, 750, False, "light")] if QUICK else [
                (w, h, touch, theme) for w, h, touch in SIZES for theme in ["dark", "light"]
            ]
            for width, height, touch, theme in cases:
                await check(browser, engine, width, height, touch, theme)
            for theme in (["light"] if QUICK else ["dark", "light"]):
                await check_landscape_legend(browser, engine, theme)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
