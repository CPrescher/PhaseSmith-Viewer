"""Browser checks for lattice overlays, symmetry, sites, volumes and angles."""

import asyncio
import math
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


async def change(locator, value):
    await locator.fill(str(value))
    await locator.dispatch_event("change")
    await locator.page.wait_for_timeout(70)


async def check(browser, w, h):
    page = await browser.new_page(
        viewport={"width": w, "height": h}, has_touch=True, is_mobile=w < 1200
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    await page.locator("#mode-sites").tap()
    assert await page.locator("#site-table tbody tr").count() == 6
    volumes = await page.locator("#poly-table tbody tr").all_inner_texts()
    assert any("Mg1" in r and "11.787" in r for r in volumes), volumes
    assert any("Mg2" in r and "12.392" in r for r in volumes), volumes
    assert any("Si" in r and "2.208" in r for r in volumes), volumes
    await page.locator("#labels-toggle").check()
    await page.locator("#asym-toggle").check()
    await settle(page)
    data = await diagnostics(page)
    assert len(data["atoms"]) == 6, data
    assert {a["label"] for a in data["atoms"]} == {"Mg1", "Mg2", "Si", "O1", "O2", "O3"}
    assert data["coordination"]["polyhedronCount"] == 0
    await page.locator("#asym-toggle").uncheck()
    assert (await diagnostics(page))["coordination"]["polyhedronCount"] == 12

    await page.locator("#mode-lattice").tap()
    await page.locator("#plane-add").tap()
    plane = page.locator("[data-plane-id]").first
    await change(plane.locator('[data-field="hkl"]'), "1 1 0")
    await change(plane.locator('[data-field="m"]'), 1)
    assert "d" in await plane.inner_text()
    await plane.locator('[data-field="family"]').check()
    await change(plane.locator('[data-field="m"]'), 0.25)
    shifted = (await diagnostics(page))["lattice"]["planes"][0]
    assert shifted["offsets"] == [0.25, 1.25], shifted
    for polygon in shifted["polygons"]:
        assert all(
            math.isclose(sum(vertex[:2]), polygon["m"]) for vertex in polygon["frac"]
        )
    await plane.locator('[data-field="family"]').uncheck()
    await change(plane.locator('[data-field="m"]'), 1)
    await page.locator("#arrow-add").tap()
    arrow = page.locator("[data-arrow-id]").first
    await change(arrow.locator('[data-field="uvw"]'), "1 0 0")
    await change(arrow.locator('[data-field="origin"]'), ".2 .2 .2")
    overlay = (await diagnostics(page))["lattice"]
    assert math.isclose(
        overlay["planes"][0]["d"], 1 / math.sqrt(1 / 4.749**2 + 1 / 10.1985**2)
    )
    assert all(
        math.isclose(sum(v[:2]), 1)
        for poly in overlay["planes"][0]["polygons"]
        for v in poly["frac"]
    )
    assert all(
        math.isclose(a, b)
        for a, b in zip(overlay["arrows"][0]["endFrac"], [1.2, 0.2, 0.2])
    )
    assert math.isclose(overlay["arrows"][0]["lengthAngstrom"], 4.749)
    await page.locator("#sym-toggle").check()
    await settle(page)
    symmetry = (await diagnostics(page))["lattice"]["symmetry"]
    assert len(symmetry["operations"]) == 8
    assert symmetry["counts"]["inversion"] > 0
    assert symmetry["counts"]["mirror"] > 0
    assert symmetry["counts"]["glide"] > 0
    assert not errors, errors
    await page.screenshot(path=f"/tmp/psv-gui-assessment/science-{w}.png")
    assert await page.evaluate("document.scrollingElement.scrollHeight===innerHeight")
    # A dedicated three-site structure allows an independent right-angle check.
    cif = """data_angle
_cell_length_a 4
_cell_length_b 5
_cell_length_c 6
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
A Na .15 .5 .5
B Na .5 .5 .5
C Cl .5 .85 .5
"""
    await page.locator("#file").set_input_files(
        {"name": "angle.cif", "mimeType": "text/plain", "buffer": cif.encode()}
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='angle'")
    reset = (await diagnostics(page))["lattice"]
    assert (
        reset["planes"] == []
        and reset["arrows"] == []
        and not reset["symmetry"]["shown"]
    )
    await page.locator("#measure-angle").tap()
    await page.locator("#view-c").tap()
    await settle(page)
    for label in ["A", "B", "C"]:
        atom = next(
            a for a in (await diagnostics(page))["atoms"] if a["label"] == label
        )
        await page.touchscreen.tap(atom["x"], atom["y"])
    await settle(page)
    assert "90.00" in await page.locator("#distance").inner_text(), await page.locator(
        "#distance"
    ).inner_text()
    assert len((await diagnostics(page))["selectedIds"]) == 3
    oblique = cif.replace("data_angle", "data_oblique").replace(
        "_cell_angle_gamma 90", "_cell_angle_gamma 67"
    )
    await page.locator("#file").set_input_files(
        {"name": "oblique.cif", "mimeType": "text/plain", "buffer": oblique.encode()}
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='oblique'")
    await page.locator("#view-c").tap()
    await settle(page)
    a, b, c = (await diagnostics(page))["axisCompass"]
    cosine = (a["x"] * b["x"] + a["y"] * b["y"]) / (
        a["projectedLength"] * b["projectedLength"]
    )
    assert math.isclose(math.degrees(math.acos(cosine)), 67, abs_tol=1e-7)
    assert c["lineOfSight"] and c["z"] > 0.999
    assert not errors, errors
    await page.close()
    print(
        f"{w}×{h}: 6 independent sites, volumes, plane/arrow/symmetry, 90° angle passed"
    )


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="chrome", args=["--enable-unsafe-swiftshader"]
        )
        for dimensions in [(1440, 900), (1024, 768), (768, 1024), (390, 844)]:
            await check(browser, *dimensions)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
