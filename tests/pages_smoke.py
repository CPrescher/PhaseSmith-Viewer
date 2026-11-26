from smoke import choose_tool, reveal_control
"""Portable browser check of the production build under its GitHub Pages path."""

import argparse
import asyncio
import os
from playwright.async_api import async_playwright

URL = os.environ.get("VIEWER_URL", "http://127.0.0.1:4181/PhaseSmith-Viewer").rstrip(
    "/"
)


async def check_tablet_library(page):
    for group in ("overlay", "analysis"):
        trigger = page.locator(f"#{group}-menu")
        await trigger.tap()
        choices = page.locator(f"#{group}-choices")
        box = await choices.bounding_box()
        buttons = choices.locator("button")
        rail = await page.locator("#tool-rail").bounding_box()
        assert box and rail and 0 <= box["x"] < box["x"] + box["width"] <= rail["x"]
        assert box["height"] <= 8 + 54 * await buttons.count(), (group, box)
        for button in (buttons.first, buttons.last):
            assert await button.evaluate("""b => {
                const r = b.getBoundingClientRect();
                return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }"""), group
        await trigger.tap()

    await page.locator("#library-open").tap()
    assert await page.locator("#library-close").evaluate("b => b === document.activeElement")
    await page.get_by_role("button", name="Open Aragonite", exact=True).tap()
    await page.wait_for_function("window.viewerDiagnostics().coordination.rules.some(r => r.center === 'C')")
    await choose_tool(page, "#mode-pairs")
    row = page.locator('.pair-rule').filter(has=page.locator('[data-field="center"] option[value="C"]:checked'))
    await row.locator('[data-field="polyhedra"]').tap()
    rule = await page.evaluate("window.viewerDiagnostics().coordination.rules.find(r => r.center === 'C')")
    assert rule["counts"] == [3] and rule["polyhedronCount"] == rule["centerCount"] > 0
    assert all(shell["faceCount"] == 1 and shell["edgeCount"] == 3 for shell in rule["environments"])


async def check_mixed_pointer_keypads(page):
    for tool, add, field_name in [
        ("#mode-lattice", "#plane-add", "hkl"),
        ("#mode-directions", "#arrow-add", "uvw"),
    ]:
        await choose_tool(page, tool, touch=True)
        await page.locator(add).tap()
        field = page.locator(f'[data-field="{field_name}"]').last
        keypad = page.locator(f'.numeric-keys[data-for="{field_name}"]').last
        await field.click()
        assert await field.evaluate("el => el === document.activeElement")
        assert not await keypad.is_visible()
        await field.tap()
        assert await keypad.is_visible()
        delete = keypad.locator('[data-key="backspace"]')
        enter = keypad.locator('[data-key="done"]')
        delete_box, enter_box = await delete.bounding_box(), await enter.bounding_box()
        assert await enter.inner_text() == "⏎"
        assert await keypad.locator('[data-key="space"]').inner_text() == "␣"
        assert enter_box["x"] == delete_box["x"] and enter_box["width"] == delete_box["width"]
        assert enter_box["height"] == 3 * delete_box["height"] + 6
        await field.fill("123")
        await field.press("End")
        for expected in ["12", "1", "", ""]:
            await page.touchscreen.tap(delete_box["x"] + delete_box["width"] / 2,
                                       delete_box["y"] + delete_box["height"] / 2)
            assert await field.input_value() == expected and await keypad.is_visible()
        await field.click()
        assert not await keypad.is_visible()


async def check_tablet_detector_figures(page):
    await choose_tool(page, "#mode-detector", touch=True)
    panel = page.locator("#detector-window")
    # The inspector is resizable independently of the tablet viewport.
    await panel.evaluate("el => { el.style.width = '760px'; el.style.height = '460px'; }")
    plots = [panel.locator(selector) for selector in ["#detector-ewald", "#detector-image"]]
    left, right = [await plot.bounding_box() for plot in plots]
    assert left and right and left["x"] + left["width"] <= right["x"]
    assert abs(left["y"] - right["y"]) < 1 and abs(left["height"] - right["height"]) < 1
    assert left["height"] >= 0.65 * left["width"], (left, right)
    await panel.evaluate("el => { el.style.width = '560px'; }")
    await panel.locator('[data-detector-view="image"]').tap()
    assert await plots[1].is_visible() and not await plots[0].is_visible()
    await panel.locator("#detector-close").tap()


async def check_shared_halite(page):
    await page.goto(URL + "/?example=halite-222")
    await page.wait_for_function("window.viewerDiagnostics?.().lattice.planes[0]?.polygons.length === 5")
    state = await page.evaluate("viewerDiagnostics()")
    plane = state["lattice"]["planes"][0]
    assert state["block"] == "halite" and plane["hkl"] == [2, 2, 2]
    assert plane["visible"] and plane["family"] and plane["faces"]["visible"]
    assert abs(plane["d"] - 1.628) < 0.001


async def main(tablet_webkit=False):
    async with async_playwright() as p:
        if tablet_webkit:
            browser = await p.webkit.launch()
            page = await browser.new_page(**{
                **p.devices["iPad (gen 7) landscape"],
                "viewport": {"width": 1024, "height": 700},
            })
            await page.goto(URL + "/")
            await page.wait_for_function("window.viewerDiagnostics?.().atoms.length > 0")
            await check_tablet_library(page)
            await check_mixed_pointer_keypads(page)
            await check_tablet_detector_figures(page)
            await check_shared_halite(page)
            await browser.close()
            print("WebKit tablet: compact menus, Library focus and aragonite faces passed")
            return

        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("CI"):
            options["args"] += ["--use-gl=angle", "--use-angle=swiftshader-webgl"]
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for example in ["", "forsterite", "wollastonite"]:
            phone = example == "wollastonite"
            page = await browser.new_page(
                viewport={
                    "width": 390 if phone else 1000,
                    "height": 844 if phone else 750,
                },
                has_touch=phone,
                is_mobile=phone,
            )
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(URL + "/" + ("?example=" + example if example else ""))
            await page.wait_for_function(
                "window.viewerDiagnostics?.().atoms.length>0 && !window.viewerDiagnostics().session.suspended",
                timeout=45000,
            )
            state = await page.evaluate("window.viewerDiagnostics()")
            assert state["measureMode"] == "info", state["measureMode"]
            assert state["viewReadout"]["visible"]
            if not example:
                await page.locator("#structure-info-open").click()
                group = page.locator("#info-symmetry dt", has_text="Space group").locator("+ dd")
                assert await group.inner_text() == "Fm3\u0305m"
                assert await page.locator("#info-name").inner_text() == "NaCl"
                await page.locator("#structure-info-close").click()
                # Exercise both plot workers on the deployed base path as part
                # of the short release check; full interactions have their own suite.
                await choose_tool(page, "#mode-analysis")
                await page.wait_for_function("document.querySelector('#analysis-table tbody tr')")
                assert await page.locator("#analysis-chart .analysis-stick").count() > 0
                assert await page.locator("#analysis-legend [data-pair]").count() > 0
                assert await page.locator('#analysis-pair option[value="Na–Cl"]').count() == 1
                await choose_tool(page, "#mode-powder")
                await page.wait_for_function("document.querySelector('#analysis-table th')?.textContent === '2θ (°)'")
                await page.locator("#analysis-close").click()
            if example == "forsterite":
                assert state["coordination"]["polyhedronCount"] == 12
                await choose_tool(page, "#mode-lattice")
                await page.locator("#plane-add").click()
                hkl = page.locator("[data-plane-id] [data-field=hkl]").first
                await hkl.fill("-1 -1 -1")
                await hkl.dispatch_event("change")
                await page.wait_for_function(
                    "window.viewerDiagnostics().lattice.planes[0].m===-1 && window.viewerDiagnostics().lattice.planes[0].polygons.length>0"
                )
                await page.locator("#mode-export").click()
                await reveal_control(page, "#session-save")
                await page.locator("#session-save").click()
                await page.wait_for_timeout(200)
                await page.reload()
                await page.wait_for_function(
                    "window.viewerDiagnostics?.().session.restoredAt>0 && !window.viewerDiagnostics().session.suspended && window.viewerDiagnostics().lattice.planes[0]?.m===-1",
                    timeout=45000,
                )
            elif example == "wollastonite":
                assert "wollaston" in state["block"].lower()
                assert state["ranges"][1] == [0, 3]
                assert not await page.evaluate(
                    "document.scrollingElement.scrollWidth>innerWidth"
                )
                await page.set_viewport_size({"width": 1024, "height": 700})
                await check_tablet_library(page)
                await check_mixed_pointer_keypads(page)
                await check_tablet_detector_figures(page)
            if not example:
                await check_shared_halite(page)
            assert not errors, errors
            print(
                f"{example or 'NaCl'}: production assets, PhaseSmith WASM and viewer passed",
                flush=True,
            )
            await page.close()
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tablet-webkit", action="store_true")
    asyncio.run(main(parser.parse_args().tablet_webkit))
