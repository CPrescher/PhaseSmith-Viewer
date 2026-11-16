"""Native discrete rotations preserve zoom, pivot and selection without inertia."""

import asyncio
import math
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle

OUT = Path("/tmp/psv-gui-assessment/turn-controls")


def eye(d):
    return [x - y for x, y in zip(d["camera"]["position"], d["camera"]["target"])]


def close(a, b):
    assert all(abs(x - y) < 1e-7 for x, y in zip(a, b)), (a, b)


def angle(a, b):
    return math.degrees(
        math.acos(
            max(
                -1,
                min(
                    1,
                    sum(x * y for x, y in zip(a, b)) / math.hypot(*a) / math.hypot(*b),
                ),
            )
        )
    )


async def check(browser, w, h, theme):
    touch = w < 1200
    page = await browser.new_page(
        viewport={"width": w, "height": h},
        has_touch=touch,
        is_mobile=touch,
        color_scheme=theme,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=wollastonite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().atoms.length>0 && !window.viewerDiagnostics().session.suspended"
    )

    async def act(locator):
        if touch:
            await locator.tap()
        else:
            await locator.click()

    await act(page.locator("#view-c"))
    await settle(page)
    assert (await diagnostics(page))["viewReadout"]["text"] == "[0 0 1]"
    # Pick one atom before opening the pad.
    for a in (await diagnostics(page))["atoms"]:
        if await page.evaluate(
            '([x,y])=>document.elementFromPoint(x,y)?.tagName==="CANVAS"',
            [a["x"], a["y"]],
        ):
            if touch:
                await page.touchscreen.tap(a["x"], a["y"])
            else:
                await page.mouse.click(a["x"], a["y"])
            await settle(page)
            if (await diagnostics(page))["selectedIds"]:
                break
    original = await diagnostics(page)
    assert len(original["selectedIds"]) == 1
    await act(page.locator("#turn-open"))
    assert await page.locator("#turn-panel").is_visible()
    if w <= 640:
        # Phones: the pad opens along the bottom edge and covers no atom.
        panel = await page.locator("#turn-panel").bounding_box()
        canvas = await page.locator("#viewport canvas").bounding_box()
        assert panel["y"] + panel["height"] <= canvas["y"] + canvas["height"] + 1, (panel, canvas)
        for a in (await diagnostics(page))["atoms"]:
            if a["visible"]:
                assert not (panel["x"] <= a["x"] <= panel["x"] + panel["width"] and panel["y"] <= a["y"] <= panel["y"] + panel["height"]), ("Turn covers an atom", a["label"], panel)
    for degrees in [90, 60, 45, 30, 10, 5]:
        await act(page.locator(f"#turn-preset-{degrees}"))
        before = await diagnostics(page)
        await act(page.locator("#turn-right"))
        await settle(page)
        after = await diagnostics(page)
        assert math.isclose(angle(eye(before), eye(after)), degrees, abs_tol=1e-6)
        close(before["camera"]["target"], after["camera"]["target"])
        assert math.isclose(
            math.hypot(*eye(before)), math.hypot(*eye(after)), rel_tol=1e-10
        )
        assert after["selectedIds"] == original["selectedIds"]
        assert after["turn"]["angle"] == degrees
        await act(page.locator("#turn-left"))
        await settle(page)
        back = await diagnostics(page)
        close(back["camera"]["position"], before["camera"]["position"])
        close(back["camera"]["up"], before["camera"]["up"])
        assert await page.locator("#axis-compass .compass-axis").evaluate_all(
            'nodes=>nodes.every(n=>getComputedStyle(n).opacity==="1")'
        )
    await act(page.locator("#turn-preset-45"))
    for forward, reverse in [
        ("up", "down"),
        ("up-right", "down-left"),
        ("up-left", "down-right"),
        ("clockwise", "counterclockwise"),
    ]:
        before = await diagnostics(page)
        await act(page.locator("#turn-" + forward))
        await settle(page)
        after = await diagnostics(page)
        if forward == "clockwise":
            close(eye(before), eye(after))
            assert math.isclose(
                angle(before["camera"]["up"], after["camera"]["up"]), 45, abs_tol=1e-6
            )
        else:
            assert math.isclose(angle(eye(before), eye(after)), 45, abs_tol=1e-6)
        await act(page.locator("#turn-" + reverse))
        await settle(page)
        back = await diagnostics(page)
        close(back["camera"]["position"], before["camera"]["position"])
        close(back["camera"]["up"], before["camera"]["up"])
    await page.locator("#turn-angle").fill("37.5")
    await act(page.locator("#turn-right"))
    await settle(page)
    assert (await diagnostics(page))["turn"]["angle"] == 37.5
    before = await diagnostics(page)
    await page.locator("#turn-angle").fill("0")
    await settle(page)
    assert not (await diagnostics(page))["turn"]["inputValid"]
    close((await diagnostics(page))["camera"]["position"], before["camera"]["position"])
    await act(page.locator("#turn-preset-90"))
    assert await page.evaluate(
        "document.scrollingElement.scrollWidth===innerWidth && document.scrollingElement.scrollHeight===innerHeight"
    )
    OUT.mkdir(exist_ok=True, parents=True)
    await page.screenshot(path=str(OUT / f"{w}-{theme}-open.png"))
    await page.keyboard.press("Escape")
    assert await page.locator("#turn-panel").is_hidden()
    # A step after a drag must remove old Trackball damping completely.
    r = await page.locator("#viewport canvas").bounding_box()
    x = r["x"] + r["width"] * 0.5
    y = r["y"] + r["height"] * 0.6
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 48, y + 24, steps=6)
    await page.mouse.up()
    await act(page.locator("#turn-open"))
    await act(page.locator("#turn-up"))
    await settle(page)
    stopped = await diagnostics(page)
    await page.wait_for_timeout(600)
    later = await diagnostics(page)
    close(stopped["camera"]["position"], later["camera"]["position"])
    close(stopped["camera"]["up"], later["camera"]["up"])
    assert not errors, errors
    await page.close()
    print(
        f"{w}×{h} {theme}: six presets, diagonal/roll/custom turns, compass color, selection/zoom/pivot and no drift passed",
        flush=True,
    )


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        for w, h in [(1440, 900), (1024, 768), (768, 1024), (390, 844)]:
            for theme in ["light", "dark"]:
                await check(b, w, h, theme)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
