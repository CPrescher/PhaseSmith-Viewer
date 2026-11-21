from smoke import reveal_control
"""Portable browser check of the production build under its GitHub Pages path."""

import asyncio
import os
from playwright.async_api import async_playwright

URL = os.environ.get("VIEWER_URL", "http://127.0.0.1:4181/PhaseSmith-Viewer").rstrip(
    "/"
)


async def main():
    async with async_playwright() as p:
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
                await page.locator("#mode-analysis").click()
                await page.wait_for_function("document.querySelector('#analysis-table tbody tr')")
                assert await page.locator("#analysis-chart .analysis-stick").count() > 0
                assert await page.locator("#analysis-legend [data-pair]").count() > 0
                assert await page.locator('#analysis-pair option[value="Na–Cl"]').count() == 1
                await page.locator("#mode-powder").click()
                await page.wait_for_function("document.querySelector('#analysis-table th')?.textContent === '2θ (°)'")
                await page.locator("#analysis-close").click()
            if example == "forsterite":
                assert state["coordination"]["polyhedronCount"] == 12
                await page.locator("#mode-lattice").click()
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
            assert not errors, errors
            print(
                f"{example or 'NaCl'}: production assets, PhaseSmith WASM and viewer passed",
                flush=True,
            )
            await page.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
