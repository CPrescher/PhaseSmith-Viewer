from smoke import reveal_control
"""Almandine space-group axis selection and session restoration."""

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from smoke import URL, diagnostics, choose_tool


async def check(browser, width, height):
    context = await browser.new_context(viewport={"width": width, "height": height}, has_touch=True)
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?structure=almandine")
    await page.wait_for_function("window.viewerDiagnostics?.().atoms.length > 0")
    await choose_tool(page, "#mode-lattice")
    await page.locator("#sym-toggle").check()
    await page.locator("#sym-axes-only").click()
    await page.locator("#sym-types-none").click()
    assert not (await diagnostics(page))["lattice"]["symmetry"]["visibleElements"]
    await page.locator('#sym-axis-types input[value="rotation:3"]').check()
    space = (await diagnostics(page))["lattice"]["symmetry"]
    assert space["complete"]
    assert len(space["visibleElements"]) == 7
    assert all(e["symbols"] == ["3"] for e in space["visibleElements"])
    assert await page.locator("#sym-view, #sym-view-note, .sym-help").count() == 0
    # Save through the normal export panel, then restore from IndexedDB.
    await choose_tool(page, "#mode-export")
    await reveal_control(page, "#session-save")
    await page.locator("#session-save").click()
    # The status may still show an earlier save from the same minute.
    # Wait for this selection's transaction rather than its unchanged text.
    await page.wait_for_function("""async () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('phasesmith-viewer-session', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const state = db.transaction('records', 'readonly').objectStore('records').get('state');
          state.onerror = () => { db.close(); reject(state.error); };
          state.onsuccess = () => {
            db.close();
            const sym = state.result?.state.lattice.symmetry;
            resolve(sym?.shown && sym?.hiddenTypes.includes('rotation:4'));
          };
        };
      });
    }""")
    await page.reload()
    await page.wait_for_function("window.viewerDiagnostics?.().lattice.symmetry.shown")
    restored = (await diagnostics(page))["lattice"]["symmetry"]
    assert len(restored["visibleElements"]) == 7
    assert restored["hiddenTypes"] == space["hiddenTypes"]
    await choose_tool(page, "#mode-lattice")
    assert len((await diagnostics(page))["lattice"]["symmetry"]["visibleElements"]) == 7
    await page.locator("#sym-types-all").click()
    assert len((await diagnostics(page))["lattice"]["symmetry"]["visibleElements"]) > 7
    await page.locator("#sym-types-none").click()
    await page.locator('#sym-axis-types input[value="rotation:3"]').check()
    await page.locator("#sym-toggle").scroll_into_view_if_needed()
    Path("/tmp/psv-gui-assessment").mkdir(exist_ok=True)
    await page.screenshot(path=f"/tmp/psv-gui-assessment/symmetry-{width}.png")
    assert await page.evaluate("document.scrollingElement.scrollWidth === innerWidth")
    assert not errors, errors
    await context.close()
    print(f"{width}×{height}: space-group offsets, exact axis types and session restore passed")


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for size in ([(1000, 750)] if QUICK else [(1440, 900), (390, 844)]):
            await check(browser, *size)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
