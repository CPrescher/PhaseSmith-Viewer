"""Empty clicks clear completed selections, while unfinished measurements and gestures survive."""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle
from session_viewer_smoke import ANGLE_CIF
from gui_review_smoke import hit


async def check(browser, w, h, touch):
    page = await browser.new_page(
        viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch
    )
    await page.goto(URL)
    await page.wait_for_function("window.viewerDiagnostics?.().atoms.length>0")
    await page.locator("#file").set_input_files(
        {
            "name": "selection.cif",
            "mimeType": "text/plain",
            "buffer": ANGLE_CIF.encode(),
        }
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='angle'")

    async def act(locator):
        if touch:
            await locator.tap()
        else:
            await locator.click()

    async def pick(label):
        a = next(a for a in (await diagnostics(page))["atoms"] if a["label"] == label)
        if touch:
            await page.touchscreen.tap(a["x"], a["y"])
        else:
            await page.mouse.click(a["x"], a["y"])
        await settle(page)

    async def blank():
        r = await page.locator("#viewport canvas").bounding_box()
        # Empty canvas inside the stage (not under an open tool sheet).
        clear = (await diagnostics(page))["stage"]["clear"]
        x, y = r["x"] + clear["x"] + 16, r["y"] + clear["y"] + clear["h"] * 0.55
        if touch:
            await page.touchscreen.tap(x, y)
        else:
            await page.mouse.click(x, y)
        await settle(page)

    async def count(n):
        assert len((await diagnostics(page))["selectedIds"]) == n

    await act(page.locator("#view-c"))
    await settle(page)
    await act(page.locator("#measure-info"))
    await pick("A")
    await count(1)
    neighbors = page.get_by_role("button", name="View neighbors", exact=True)
    assert await hit(neighbors), "Atom info shortcut must receive pointer clicks"
    if touch:
        assert (await neighbors.bounding_box())["height"] >= 44
    camera = (await diagnostics(page))["camera"]
    await act(neighbors)
    assert await page.locator("#tool-window-sites").is_visible()
    assert (await page.locator("#shell-summary").inner_text()).startswith("A · CN")
    assert (await diagnostics(page))["camera"] == camera
    await act(page.locator('#tool-window-sites [data-action=close]'))
    await blank()
    await count(0)
    assert not await neighbors.is_visible()
    await act(page.locator("#measure-distance"))
    await pick("A")
    await count(1)
    await blank()
    await count(1)
    await pick("B")
    await count(2)
    before = await diagnostics(page)
    r = await page.locator("#viewport canvas").bounding_box()
    x, y = r["x"] + 16, r["y"] + r["height"] * 0.55
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 28, y + 18, steps=5)
    await page.mouse.up()
    await settle(page)
    assert (await diagnostics(page))["selectedIds"] == before["selectedIds"]
    await page.mouse.click(x, y, button="right")
    await settle(page)
    assert (await diagnostics(page))["selectedIds"] == before["selectedIds"]
    await blank()
    await count(0)
    await act(page.locator("#reset"))
    await act(page.locator("#view-c"))
    await act(page.locator("#measure-angle"))
    await settle(page)
    for label, n in [("A", 1), ("B", 2)]:
        await pick(label)
        await count(n)
        await blank()
        await count(n)
    await pick("C")
    await count(3)
    assert abs((await diagnostics(page))["angle"] - 90) < 1e-8
    await blank()
    await count(0)
    # Clicking an atom after a completed selection still starts a new one.
    await pick("A")
    await pick("B")
    await pick("C")
    await pick("A")
    await count(1)

    # Every mode transition clears both partial and completed selections.
    # Pressing the current mode again preserves the picks.
    for source, labels in [("info", "A"), ("distance", "AB"), ("angle", "ABC")]:
        for target in ("info", "distance", "angle"):
            if source == target:
                continue
            for n in range(1, len(labels) + 1):
                await act(page.locator(f"#measure-{source}"))
                if await page.locator("#clear").is_enabled():
                    await act(page.locator("#clear"))
                for label in labels[:n]:
                    await pick(label)
                await count(n)
                picked = (await diagnostics(page))["selectedIds"]
                await act(page.locator(f"#measure-{source}"))
                assert (await diagnostics(page))["selectedIds"] == picked
                await act(page.locator(f"#measure-{target}"))
                await count(0)
                state = await diagnostics(page)
                assert state["measureMode"] == target
                assert state["distance"] is None and state["angle"] is None
                assert state["atomInfo"] is None
                assert await page.locator("#clear").is_disabled()
                assert not await page.locator("#measure-overlay").evaluate(
                    "el => el.classList.contains('active')"
                )
                await pick("A")
                await count(1)
    await page.close()
    print(
        f"{w}×{h}: mode switches reset picks; empty clicks and gestures behave correctly",
        flush=True,
    )


async def main():
    async with async_playwright() as p:
        for kind in ["chromium", "webkit"]:
            if kind == "chromium":
                browser = await p.chromium.launch(channel="chrome")
            else:
                exe = sorted(
                    (Path.home() / "Library/Caches/ms-playwright").glob(
                        "webkit-*/pw_run.sh"
                    )
                )[-1]
                browser = await p.webkit.launch(executable_path=str(exe))
            for w, h, touch in [(1440, 900, False), (390, 844, True)]:
                await check(browser, w, h, touch)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
