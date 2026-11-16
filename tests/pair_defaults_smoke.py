"""Pair estimates follow UI element changes, while manual settings survive."""

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for width, height in [(1200, 800), (390, 844)]:
            page = await browser.new_page(
                viewport={"width": width, "height": height}, has_touch=True,
                color_scheme="dark",
            )
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(URL + "/?example=forsterite")
            await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount === 12")
            await choose_tool(page, "#mode-pairs")
            await page.locator("#add-rule").click()
            row = page.locator(".pair-rule").last
            center = row.locator("[data-field=center]")
            neighbor = row.locator("[data-field=neighbor]")
            cutoff = row.locator("[data-field=cutoff]")
            assert await center.input_value() == "Mg"
            assert 2.2 < float(await cutoff.input_value()) < 2.5
            await row.locator("[data-field=polyhedra]").check()
            assert (await diagnostics(page))["coordination"]["rules"][-1]["counts"] == [6]
            await center.select_option("Si")
            assert 1.7 < float(await cutoff.input_value()) < 1.9
            assert (await diagnostics(page))["coordination"]["rules"][-1]["counts"] == [4]
            await neighbor.select_option("Mg")
            assert float(await cutoff.input_value()) > 2.5
            await neighbor.select_option("O")
            await cutoff.fill("1.812345")
            await cutoff.press("Enter")
            await page.locator("#viewport canvas").click(position={"x": 15, "y": 200})
            await page.locator("#polyhedra-only").uncheck()
            await settle(page)
            assert float(await cutoff.input_value()) == 1.812345

            # Deleting another pair must not change this pair's default color.
            state = await diagnostics(page)
            si_color = next(a["color"] for a in state["atoms"] if a["element"] == "Si")
            last_id = state["coordination"]["rules"][-1]["id"]
            assert next(f for f in state["faceMaterials"] if f["id"] == last_id)["color"] == si_color
            await page.locator(".pair-rule").first.locator(".pair-main .icon-button").click()
            state = await diagnostics(page)
            assert next(f for f in state["faceMaterials"] if f["id"] == last_id)["color"] == si_color
            await choose_tool(page, "#mode-export", False)
            await page.locator("#session-save").click()
            await page.wait_for_timeout(200)
            await page.reload()
            await page.wait_for_function(
                "window.viewerDiagnostics?.().session.restoredAt > 0 && !window.viewerDiagnostics().session.suspended && window.viewerDiagnostics().coordination.rules.length > 0",
                timeout=45000,
            )
            assert (await diagnostics(page))["coordination"]["rules"][-1]["cutoff"] == 1.812345
            await page.emulate_media(color_scheme="light")
            await settle(page)
            assert {a["element"]: a["color"] for a in (await diagnostics(page))["atoms"]} == {
                a["element"]: a["color"] for a in state["atoms"]
            }
            await page.locator("#file").set_input_files(
                Path(__file__).resolve().parents[1] / "public/examples/wollastonite.cif"
            )
            await page.wait_for_function("document.querySelector('#source').textContent.includes('wollastonite.cif')")
            state = await diagnostics(page)
            ca = next(r for r in state["coordination"]["rules"] if r["center"] == "Ca")
            assert 2.6 < ca["cutoff"] < 2.9
            assert not errors, errors
            await page.close()
            print(f"{width}×{height}: estimated shells, element changes, stable colors and saved cutoff passed")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
