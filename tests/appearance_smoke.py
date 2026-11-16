"""Exercise element and pair styling while checking the underlying crystal."""

import asyncio
import math
from playwright.async_api import async_playwright

from smoke import URL, diagnostics, settle


async def check(browser, width, height):
    page = await browser.new_page(viewport={"width": width, "height": height}, has_touch=True)
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function("window.viewerDiagnostics?.().coordination.polyhedronCount === 12")
    await page.locator("#style-open").tap()
    target = page.locator("#style-target")
    size = page.locator("#style-size")
    paint = page.locator('[data-color="#668df3"]')
    reset = page.locator("#style-reset")
    values = await target.locator("option").evaluate_all(
        "options => options.map(o => ({label:o.textContent,value:o.value}))"
    )
    mg = next(o["value"] for o in values if "Mg" in o["label"] and "O" not in o["label"])
    si_o = next(o["value"] for o in values if "Si" in o["label"] and "O" in o["label"])
    before = await diagnostics(page)

    async def set_size(n):
        await size.fill(str(n))
        await settle(page)

    def check_crystal(current):
        assert [a["cartesian"] for a in current["atoms"]] == [a["cartesian"] for a in before["atoms"]]
        assert current["coordination"]["polyhedronCount"] == 12
        assert [r["counts"] for r in current["coordination"]["rules"]] == [[4], [6]]
        assert current["camera"] == before["camera"]

    await target.select_option(mg)
    assert not await page.locator("#style-opacity-row").is_visible()
    await paint.tap()
    await set_size(150)
    changed = await diagnostics(page)
    check_crystal(changed)
    for old, atom in zip(before["atoms"], changed["atoms"]):
        if atom["element"] == "Mg":
            assert atom["color"] == "#668df3"
            assert math.isclose(atom["radius"], 1.5 * old["radius"])
        else:
            assert atom["color"] == old["color"] and atom["radius"] == old["radius"]

    await target.select_option(si_o)
    opacity = page.locator("#style-opacity")
    await opacity.fill("60")
    await settle(page)
    material = (await diagnostics(page))["faceMaterials"][0]
    assert math.isclose(material["opacity"], 0.6)
    assert await page.locator('[data-field="opacity"]').first.input_value() == "60"
    geometry = material["geometry"]
    await opacity.fill("100")
    await settle(page)
    material = (await diagnostics(page))["faceMaterials"][0]
    assert not material["transparent"] and material["depthWrite"]
    assert material["geometry"] == geometry
    await page.locator("#mode-pairs").tap()
    await page.locator('[data-field="opacity"]').first.fill("20")
    await page.locator("#style-open").tap()
    assert await opacity.input_value() == "20"
    await paint.tap()
    assert not await size.is_visible()
    changed = await diagnostics(page)
    check_crystal(changed)
    faces = changed["faceMaterials"]
    assert all(s["color"] == "#668df3" and s["scale"] == 1 for s in faces[0]["styles"])
    assert faces[1]["styles"] == before["faceMaterials"][1]["styles"]
    assert [p["volume"] for p in changed["polyhedra"]] == [p["volume"] for p in before["polyhedra"]]
    await reset.tap()
    assert math.isclose((await diagnostics(page))["faceMaterials"][0]["opacity"], 0.34)
    assert (await diagnostics(page))["faceMaterials"][0]["styles"] == before["faceMaterials"][0]["styles"]
    await target.select_option(mg)
    await reset.tap()
    restored = await diagnostics(page)
    check_crystal(restored)
    for atom, original in zip(restored["atoms"], before["atoms"]):
        assert atom["color"] == original["color"]
        assert math.isclose(atom["radius"], original["radius"])
    # Pick an exposed sphere, then a polyhedron face with the spheres hidden.
    await page.locator("#style-pick").tap()
    for atom in sorted(restored["atoms"], key=lambda a: a["z"]):
        if await page.evaluate("([x,y]) => document.elementFromPoint(x,y)?.tagName === 'CANVAS'", [atom["x"], atom["y"]]):
            await page.touchscreen.tap(atom["x"], atom["y"])
            if (await target.input_value()).startswith("atom:"):
                break
    assert (await target.input_value()).startswith("atom:")
    await paint.tap()
    styled = await diagnostics(page)
    assert styled["appearance"]["pickMarkerCount"] == 1
    assert sum(a["color"] != b["color"] for a, b in zip(styled["atoms"], restored["atoms"])) == 1
    first_target = await target.input_value()
    first_key = first_target.removeprefix("atom:")
    first_atom = next(a for a in restored["atoms"] if a["key"] == first_key)
    for atom in sorted(restored["atoms"], key=lambda a: a["z"]):
        if await page.evaluate("([x,y]) => document.elementFromPoint(x,y)?.tagName === 'CANVAS'", [atom["x"], atom["y"]]):
            await page.touchscreen.tap(atom["x"], atom["y"])
            second_target = await target.input_value()
            if second_target.startswith("atom:") and second_target != first_target:
                break
    assert second_target != first_target and second_target.startswith("atom:")
    await page.locator('[data-color="#efa04c"]').tap()
    assert (await diagnostics(page))["appearance"]["atomOverrides"] == 2
    await target.select_option(first_target)
    await reset.tap()
    assert (await diagnostics(page))["appearance"]["atomOverrides"] == 1
    await page.locator("#style-reset-individual").tap()
    assert (await diagnostics(page))["appearance"]["atomOverrides"] == 0
    # A broad color edit must include atoms styled individually earlier.
    await page.touchscreen.tap(first_atom["x"], first_atom["y"])
    await paint.tap()
    assert (await diagnostics(page))["appearance"]["atomOverrides"] == 1
    await target.select_option("element:" + first_atom["element"])
    await page.locator('[data-color="#8cdf9b"]').tap()
    current = await diagnostics(page)
    assert all(a["color"] == "#8cdf9b" for a in current["atoms"] if a["element"] == first_atom["element"])
    await reset.tap()
    await page.locator("#show-atoms").tap()
    for atom in (await diagnostics(page))["atoms"]:
        if atom["element"] == "Si":
            await page.touchscreen.tap(atom["x"], atom["y"])
            if (await target.input_value()).startswith("poly:"):
                break
    assert (await target.input_value()).startswith("poly:")
    assert not await size.is_visible()
    await paint.tap()
    now = await diagnostics(page)
    assert all(s["scale"] == 1 for face in now["faceMaterials"] for s in face["styles"])
    assert now["appearance"]["polyhedronOverrides"] == 1
    assert now["appearance"]["pickMarkerCount"] == 1
    assert not now["selectedIds"]
    await page.locator("#mode-pairs").tap()
    assert (await diagnostics(page))["appearance"]["pickMarkerCount"] == 0
    assert await page.evaluate("window.scrollY === 0")
    await page.close()
    print(f"{width}×{height}: Mg radius/color, Si–O true geometry/color, geometry and reset verified")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        for dimensions in [(1024, 768), (768, 1024), (390, 844)]:
            await check(browser, *dimensions)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
