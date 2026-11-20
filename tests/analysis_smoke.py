"""Production-path plot workers, numeric results and independent floating UI."""
import asyncio
import csv
import io
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, HERE, choose_tool, diagnostics, reveal_control

SIMPLE = """data_analysis_cube
_cell_length_a 4
_cell_length_b 4
_cell_length_c 4
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Cu1 Cu 0 0 0
"""


async def ready(page, column="Distance (Å)", rows=None):
    await page.wait_for_function(
        "([column,rows]) => document.querySelector('#analysis-table th')?.textContent === column && "
        "(rows === null || document.querySelectorAll('#analysis-table tbody tr').length === rows) && "
        "!document.querySelector('#analysis-window').hasAttribute('aria-busy')",
        arg=[column, rows],
    )


async def check(browser, width, height, theme):
    page = await browser.new_page(viewport={"width": width, "height": height}, has_touch=True, color_scheme=theme)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/")
    await page.wait_for_function("window.viewerDiagnostics?.().block")
    await page.locator("#file").set_input_files({"name": "analysis-cube.cif", "mimeType": "text/plain", "buffer": SIMPLE.encode()})
    await page.wait_for_function("window.viewerDiagnostics().block === 'analysis_cube'")
    await choose_tool(page, "#mode-pairs")
    before = await diagnostics(page)
    await choose_tool(page, "#mode-analysis")
    await ready(page, rows=2)
    assert not await page.locator("#tool-rail").evaluate("el => el.classList.contains('menu-open')")
    assert await page.locator("#analysis-rMin").input_value() == "0"
    assert await page.locator("#analysis-rMax").input_value() == "6"
    assert await page.locator("#analysis-table tbody tr").evaluate_all("rows => rows.map(row => [...row.cells].map(cell => cell.textContent.trim()))") == [["4.00000", "Cu–Cu ×3", "3"], ["5.65685", "Cu–Cu ×6", "6"]]
    after = await diagnostics(page)
    assert before["camera"] == after["camera"]
    assert after["windows"]["visible"] == ["pairs"], after["windows"]
    box = await page.locator("#analysis-window").bounding_box()
    assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= width and box["y"] + box["height"] <= height
    top = await page.evaluate("""() => {
      const w=document.querySelector('#analysis-window').getBoundingClientRect();
      const p=document.querySelector('#tool-window-pairs').getBoundingClientRect();
      const x=(Math.max(w.left,p.left)+Math.min(w.right,p.right))/2;
      const y=(Math.max(w.top,p.top)+Math.min(w.bottom,p.bottom))/2;
      return w.right<=p.left || p.right<=w.left || w.bottom<=p.top || p.bottom<=w.top || !!document.elementFromPoint(x,y)?.closest('#analysis-window');
    }""")
    assert top, "plot window must be above the existing tool"
    if width > 1000:
        await page.locator("#library-open").click()
        await page.keyboard.press("Escape")
        assert await page.locator("#analysis-window").is_visible()
        assert not await page.locator("#structure-library").is_visible()
        head = await page.locator("#analysis-head").bounding_box()
        await page.mouse.move(head["x"] + 140, head["y"] + 22)
        await page.mouse.down()
        await page.mouse.move(head["x"] + 200, head["y"] + 52, steps=6)
        await page.mouse.up()
        moved = await page.locator("#analysis-window").bounding_box()
        assert abs(moved["x"] - box["x"] - 60) < 2 and abs(moved["y"] - box["y"] - 30) < 2
    if await page.locator("#analysis-settings").get_attribute("open") is None:
        await page.locator("#analysis-settings > summary").click()
    await page.locator("#analysis-rMax").fill("7")
    await ready(page, rows=3)
    assert "6.92820" in await page.locator("#analysis-table tbody tr").last.inner_text()
    await page.locator("#analysis-rMin").fill("5")
    await ready(page, rows=2)
    assert "5.65685" in await page.locator("#analysis-table tbody tr").first.inner_text()
    await page.locator("#analysis-table tbody tr").first.click()
    assert "6 pairs/cell" in await page.locator("#analysis-detail").inner_text()
    assert await page.locator("#analysis-chart .selected").count() == 1
    async with page.expect_download() as download_info:
        await page.locator("#analysis-csv").click()
    download = await download_info.value
    rows = list(csv.reader(io.StringIO(Path(await download.path()).read_text())))
    assert rows[0][3] == "pairs_per_cell" and rows[1][3] == "6", rows

    await page.locator("#analysis-rMin").fill("8")
    await page.wait_for_function("document.querySelector('#analysis-status').textContent.includes('exceed')")
    assert not await page.locator("#analysis-results").is_visible(), "invalid settings must clear stale results"
    await page.locator("#analysis-rMin").fill("0")
    await ready(page, rows=3)
    await page.locator("#analysis-mode").select_option("powder")
    await page.locator("#file").set_input_files(HERE.parent / "public/structures/copper-fcc.cif")
    await page.wait_for_function("window.viewerDiagnostics().block !== 'analysis_cube'")
    await ready(page, column="2θ (°)", rows=3)
    first = await page.locator("#analysis-table tbody tr").first.inner_text()
    assert "43.3" in first and "1 1 1" in first, first
    assert await page.locator("#analysis-chart .analysis-profile").count() == 1
    await page.locator("#analysis-fwhm").fill("0")
    await ready(page, column="2θ (°)", rows=3)
    assert await page.locator("#analysis-chart .analysis-profile").count() == 0
    await page.locator("#analysis-fwhm").fill("0.005")
    await page.wait_for_function("document.querySelector('#analysis-status').textContent.includes('at least')")
    assert not await page.locator("#analysis-results").is_visible()
    await page.locator("#analysis-fwhm").fill("0.15")
    await ready(page, column="2θ (°)", rows=3)
    # Escape closes only the floating plot; the underlying pair editor stays open.
    await page.keyboard.press("Escape")
    assert not await page.locator("#analysis-window").is_visible()
    assert (await diagnostics(page))["windows"]["visible"] == ["pairs"]
    await choose_tool(page, "#mode-powder")
    await ready(page, column="2θ (°)", rows=3)
    assert await page.locator("#analysis-rMax").input_value() == "7"
    # Autosave and reload preserve the plot preferences and independent visibility.
    await page.wait_for_timeout(1800)
    await page.reload()
    await page.wait_for_function("window.viewerDiagnostics?.().session.restoredAt > 0")
    await ready(page, column="2θ (°)", rows=3)
    assert await page.locator("#analysis-rMax").input_value() == "7"
    assert (await diagnostics(page))["windows"]["visible"] == ["pairs"]
    if width == 1200:
        await page.locator("#analysis-file").set_input_files(
            {"name": "observed.xy", "mimeType": "text/plain", "buffer": b"43.2 130\n43.3 218\n43.4 -2\n"})
        await page.wait_for_selector(".analysis-observed-line", state="attached")
        await page.locator("#analysis-table tbody tr").first.click()
        await page.locator("#analysis-explain").click()
        await page.locator("#reflection-step-back").click()
        step = await page.input_value("#reflection-step")
        hkl = await page.input_value("#reflection-hkl")
        async with page.expect_download() as exercise:
            await page.locator("#reflection-project").click()
        download = await exercise.value
        fresh = await browser.new_page()
        await fresh.goto(URL)
        await fresh.wait_for_function("window.viewerDiagnostics?.().block")
        await fresh.locator("#file").set_input_files({
            "name": "lesson.psv", "mimeType": "application/json",
            "buffer": Path(await download.path()).read_bytes(),
        })
        await fresh.wait_for_selector("#reflection-explorer[open]")
        assert await fresh.input_value("#reflection-step") == step
        assert await fresh.input_value("#reflection-hkl") == hkl
        await fresh.locator("#reflection-close").click()
        await fresh.wait_for_selector(".analysis-observed-line", state="attached")
        assert "observed.xy" in await fresh.inner_text("#analysis-file-status")
        await fresh.close()
        await page.locator("#reflection-close").click()
    await page.locator("#analysis-mode").select_option("distances")
    await ready(page)
    # Range and element filter are rebuilt for a freshly loaded structure.
    await page.locator("#file").set_input_files(HERE.parent / "public/examples/forsterite.cif")
    await page.wait_for_function("window.viewerDiagnostics().atoms.some(a => a.element === 'Mg')")
    await ready(page)
    # All pairs retain distinct matching colors in chart, legend and table.
    color_data = await page.evaluate("""() => {
      const lines=[...document.querySelectorAll('#analysis-chart .analysis-stick[data-pair]')];
      return [...document.querySelectorAll('#analysis-legend [data-pair]')].map(tag => ({
        pair:tag.dataset.pair,
        color:getComputedStyle(tag.querySelector('.analysis-pair-swatch')).backgroundColor,
        strokes:[...new Set(lines.filter(l => l.dataset.pair===tag.dataset.pair).map(l => getComputedStyle(l).stroke))]
      }));
    }""")
    assert {r["pair"] for r in color_data} == {"Mg–Mg", "Mg–Si", "Mg–O", "Si–Si", "Si–O", "O–O"}, color_data
    assert len({r["color"] for r in color_data}) == 6, color_data
    assert all(r["strokes"] == [r["color"]] for r in color_data), color_data
    assert not await page.locator('#analysis-pair option[value="O–Si"]').count()
    assert await page.locator('#analysis-table .analysis-pair-swatch').count() > 0
    si_color = next(r["color"] for r in color_data if r["pair"] == "Si–O")
    await reveal_control(page, "#analysis-pair")
    await page.locator("#analysis-pair").select_option("Si–O")
    await ready(page)
    assert all("Si–O" in text for text in await page.locator("#analysis-table tbody tr").all_inner_texts())
    assert await page.locator('#analysis-legend [data-pair="Si–O"] .analysis-pair-swatch').evaluate("el => getComputedStyle(el).backgroundColor") == si_color
    assert await page.locator('#analysis-legend [data-pair]').count() == 1
    assert await page.locator("#analysis-table tbody tr").count() == 10
    await page.locator("#analysis-more").click()
    assert await page.locator("#analysis-table tbody tr").count() > 10
    await page.locator("#analysis-more").click()
    assert await page.locator("#analysis-table tbody tr").count() == 10
    await page.locator("#analysis-rMax").fill("6")
    await ready(page)
    await page.locator("#analysis-window .analysis-body").evaluate("el => el.scrollTop=0")
    await page.screenshot(path=f"/tmp/phasesmith-analysis-{width}-{theme}.png")
    assert not await page.evaluate("document.scrollingElement.scrollWidth > innerWidth || document.scrollingElement.scrollHeight > innerHeight")
    assert not errors, errors
    await page.locator("#analysis-close").click()
    assert not await page.locator("#analysis-window").is_visible()
    print(f"{browser.browser_type.name} {width}×{height} {theme}: floating plots, periodic counts, XRD, CSV, errors and restoration passed", flush=True)
    await page.close()


async def main():
    async with async_playwright() as p:
        engines = [p.chromium] + ([p.webkit] if os.environ.get("WEBKIT_EXECUTABLE") else [])
        for engine in engines:
            options = {}
            if engine.name == "chromium":
                options["args"] = ["--enable-unsafe-swiftshader"]
                if os.environ.get("BROWSER_CHANNEL"):
                    options["channel"] = os.environ["BROWSER_CHANNEL"]
            if os.environ.get(engine.name.upper() + "_EXECUTABLE"):
                options["executable_path"] = os.environ[engine.name.upper() + "_EXECUTABLE"]
            browser = await engine.launch(**options)
            for width, height, theme in [(1200, 900, "dark"), (390, 844, "light"), (844, 390, "dark")]:
                await check(browser, width, height, theme)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
