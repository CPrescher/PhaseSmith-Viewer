"""Portable project downloads reopen in a fresh browser on desktop and phone."""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from smoke import URL, HERE, diagnostics, choose_tool
from history_smoke import idle, equivalent


async def download_project(page):
    async with page.expect_download() as pending:
        await page.locator("#project-save").click()
    download = await pending.value
    return download.suggested_filename, Path(await download.path()).read_bytes()


async def check(browser, phone):
    options = dict(viewport={"width": 390 if phone else (1000 if QUICK else 1440), "height": 844 if phone else (750 if QUICK else 900)},
                   has_touch=phone, is_mobile=phone, accept_downloads=True)
    context = await browser.new_context(**options)
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL + "/")
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    # A local, multiblock CIF cannot be recovered from a library URL.
    original = (HERE / "known-distance.cif").read_text()
    cif = original + "\n" + original.replace("data_periodic_distance", "data_second").replace("_cell_length_a 4", "_cell_length_a 7")
    await page.locator("#file").set_input_files({"name": "local.cif", "mimeType": "text/plain", "buffer": cif.encode()})
    await page.wait_for_function("viewerDiagnostics().block === 'periodic_distance' && viewerDiagnostics().history.ready")
    await page.locator("#block").select_option("second")
    await page.wait_for_function("viewerDiagnostics().block === 'second' && viewerDiagnostics().history.ready")
    await idle(page)
    await choose_tool(page, "#mode-pairs")
    await page.locator("#add-rule").click()
    cutoff = page.locator('#pair-rules input[data-field="cutoff"]').first
    await cutoff.fill("5.2")
    await cutoff.dispatch_event("change")
    await choose_tool(page, "#mode-lattice")
    await page.locator("#plane-add").click()
    await page.locator("#arrow-add").click()
    await page.locator("#lattice-label-offsets").uncheck()
    await choose_tool(page, "#style-open")
    await page.locator("#style-target").select_option("element:Na")
    await page.locator("#style-swatches button:last-child").click()
    await page.locator("#radius-details summary").click()
    await page.locator("#radius-site").select_option("Na1")
    await page.locator("#radius-entry").select_option("1/VIII")
    await page.locator("#radius-model").select_option("crystal")
    await choose_tool(page, "#mode-sites")
    await page.locator("#labels-toggle").check()
    await page.locator("#measure-distance").click()
    await idle(page)
    await page.locator("#tool-window-sites [data-action=close]").click()
    atom = await page.evaluate("viewerDiagnostics().atoms.find(a => a.visible && document.elementFromPoint(a.x, a.y)?.tagName === 'CANVAS')")
    assert atom, "No exposed atom available for the measurement"
    await page.mouse.click(atom["x"], atom["y"])
    await idle(page)
    assert (await diagnostics(page))["history"]["snapshot"]["measure"]["keys"]
    await page.locator("#view-a").click()
    await page.locator("#theme-toggle").click()
    await choose_tool(page, "#mode-export")
    await page.locator("#export-dpi").fill("450")
    await page.locator("#export-transparent").check()
    await idle(page)
    filename, data = await download_project(page)
    assert filename == "local.psv"
    saved = json.loads(data)
    assert saved["document"] == {"filename": "local.cif", "text": cif}
    assert saved["state"]["block"] == "second"
    assert saved["state"]["rules"][0]["cutoff"] == 5.2
    assert saved["state"]["lattice"]["planes"] and saved["state"]["lattice"]["arrows"]
    assert saved["state"]["appearance"]["elements"]
    assert saved["state"]["atoms"]["radiusModel"] == "crystal"
    assert saved["state"]["atoms"]["siteRadii"] == [["Na1", "1/VIII"]]
    assert equivalent(saved["state"]["camera"], (await diagnostics(page))["history"]["snapshot"]["camera"])
    assert not errors, errors
    await context.close()

    # No IndexedDB or localStorage carries over. Restore through the real picker.
    context = await browser.new_context(**options)
    page = await context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    await choose_tool(page, "#mode-export")
    async with page.expect_file_chooser() as chooser:
        await page.locator("#project-open").click()
    await (await chooser.value).set_files({"name": "shared.PSV", "mimeType": "application/json", "buffer": data})
    await page.wait_for_function("document.getElementById('project-status').textContent === 'Opened shared.PSV.' && viewerDiagnostics().history.ready")
    await idle(page)
    name, reopened_data = await download_project(page)
    reopened = json.loads(reopened_data)
    assert name == "shared.psv"
    assert reopened["document"] == saved["document"]
    assert equivalent(reopened["state"], saved["state"]), (reopened["state"], saved["state"])
    assert reopened["theme"] == saved["theme"]
    assert (await diagnostics(page))["history"]["undoCount"] == 0

    # Malformed envelope, future version and invalid CIF preserve the live scene.
    before = (await diagnostics(page))["history"]["snapshot"]
    for payload in [b"not JSON", json.dumps({**saved, "version": 999}).encode(),
                    json.dumps({**saved, "document": {"filename": "bad.cif", "text": "invalid"}}).encode()]:
        await page.locator("#project-file").set_input_files({"name": "bad.psv", "mimeType": "application/json", "buffer": payload})
        await page.wait_for_function("document.getElementById('project-status').classList.contains('error') && document.getElementById('project-file').value === '' && document.getElementById('loading').hidden")
        await idle(page)
        assert equivalent((await diagnostics(page))["history"]["snapshot"], before)
        assert await page.locator("#project-save").is_enabled()
    # Header picker supports .psv as well, including reopening the same file.
    for _ in range(2):
        await page.locator("#file").set_input_files({"name": "header.psv", "mimeType": "application/json", "buffer": data})
        await page.wait_for_function("document.getElementById('project-status').textContent === 'Opened header.psv.' && document.getElementById('file').value === '' && viewerDiagnostics().history.ready")
        await idle(page)
        assert equivalent((await diagnostics(page))["history"]["snapshot"], before)
    # Reopened projects also resume through the existing browser autosave.
    await page.locator("#session-save").click()
    await page.wait_for_function("document.getElementById('session-status').textContent.startsWith('Saved on this device')")
    await page.reload()
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    resumed = await diagnostics(page)
    assert resumed["block"] == "second", (resumed["block"], resumed["session"])
    assert equivalent((await diagnostics(page))["history"]["snapshot"], before)
    assert not await page.evaluate("document.scrollingElement.scrollWidth > innerWidth")
    assert await page.locator("#open").evaluate("el => el.getBoundingClientRect().right <= innerWidth"), "Header open button is clipped"
    await page.locator("#project-save").scroll_into_view_if_needed()
    await page.screenshot(path=f"/tmp/viewer-project-{'phone' if phone else 'desktop'}.png")
    # Import a project in the pre-model format and recover its exact sphere radii.
    old_atoms = saved["state"]["atoms"]
    del old_atoms["siteRadii"], old_atoms["radiusModel"]
    old_atoms["size"] = 1
    await page.locator("#file").set_input_files({
        "name": "legacy.psv", "mimeType": "application/json", "buffer": json.dumps(saved).encode()
    })
    await page.wait_for_function("document.getElementById('project-status').textContent === 'Opened legacy.psv.'")
    legacy = await diagnostics(page)
    assert legacy["history"]["snapshot"]["atoms"]["radiusModel"] == "classic"
    assert all(a["radius"] == 0.52 for a in legacy["atoms"] if a["element"] == "Na")
    assert not errors, errors
    await context.close()
    print(f"{'Phone' if phone else 'Desktop'}: portable roundtrip, multiblock CIF, invalid files and autosave passed", flush=True)


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for phone in (False, True):
            await check(browser, phone)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
