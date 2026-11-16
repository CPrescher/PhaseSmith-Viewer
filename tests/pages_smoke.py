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
