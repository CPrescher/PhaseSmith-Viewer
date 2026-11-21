"""Phone (390×844, touch): a completed distance/angle measurement keeps the
selected atoms unobscured and its result visible, while a tool sheet
(Lattice with a plane and an arrow, Sites, Export, Style) is open; the full
lines open with Details."""

import asyncio
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle

CIF = """data_angle
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
MARGIN = 14  # px around each atom centre that must stay clear


def inside(rect, x, y, pad=0):
    return (
        rect
        and rect["x"] - pad <= x <= rect["x"] + rect["width"] + pad
        and rect["y"] - pad <= y <= rect["y"] + rect["height"] + pad
    )


async def check(browser, theme, mode):
    page = await browser.new_page(
        viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True
    )
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.add_init_script(f"localStorage.setItem('psv-theme','{theme}')")
    await page.goto(URL)
    await page.wait_for_function("window.viewerDiagnostics?.().atoms?.length > 0")
    await page.locator("#file").set_input_files(
        {"name": "angle.cif", "mimeType": "text/plain", "buffer": CIF.encode()}
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='angle'")
    await page.locator("#view-c").tap()
    if mode == "lattice":
        await choose_tool(page, "#mode-lattice", True)
        await page.locator("#plane-add").tap()
        await choose_tool(page, "#mode-directions")
        await page.locator("#arrow-add").tap()
        await choose_tool(page, "#mode-lattice")
    elif mode == "style":
        await choose_tool(page, "#style-open", True)
    else:
        await choose_tool(page, f"#mode-{mode}", True)
    for measure, labels, value in (
        ("angle", "ABC", "90.00"),
        ("distance", "AB", "1.4000"),
    ):
        await page.locator(f"#measure-{measure}").tap()
        await page.locator("#view-c").tap()
        await settle(page)
        # An explicit view preset re-centers the structure. Pan relative to
        # the currently open sheet after that preset, before the touch picks.
        sheet = await page.locator("#tool-layer .tool-window:not([hidden])").bounding_box()
        atom = next(a for a in (await diagnostics(page))["atoms"] if a["label"] == "B")
        await page.mouse.move(120, 300)
        await page.mouse.down(button="right")
        await page.mouse.move(120, 300 + sheet["y"] - 35 - atom["y"], steps=8)
        await page.mouse.up(button="right")
        await settle(page)
        if (await diagnostics(page))["selectedIds"]:
            await page.locator("#clear").tap()
            await settle(page)
        for label in labels:
            atom = next(
                a for a in (await diagnostics(page))["atoms"] if a["label"] == label
            )
            await page.touchscreen.tap(atom["x"], atom["y"])
            # Showing the details can resize the canvas. Read the next
            # atom's position after that layout has actually rendered.
            await settle(page)
        await settle(page)
        d = await diagnostics(page)
        assert len(d["selectedIds"]) == len(labels), (mode, measure, d["selectedIds"])
        # Result visible on screen, over the view.
        result = page.locator("#distance")
        assert await result.is_visible()
        assert value in await result.inner_text(), await result.inner_text()
        box = await result.bounding_box()
        assert (
            box
            and 0 <= box["x"]
            and box["x"] + box["width"] <= 390
            and 0 <= box["y"] < 844 * 0.5
        ), box
        # Full lines on demand (Details), bounded and closed again.
        await page.locator("#measure-more").tap()
        details = page.locator("#selection")
        assert await details.is_visible()
        text = await details.inner_text()
        assert all(label in text for label in labels), text
        await page.locator("#measure-more").tap()
        assert await details.is_hidden()
        # No overlay or tool sheet covers a selected atom.
        overlay = await page.locator("#measure-overlay").bounding_box()
        toolbar = await page.locator(".view-directions").bounding_box()
        sheet = await page.locator("#tool-layer .tool-window:not([hidden])").bounding_box()
        for atom in (a for a in d["atoms"] if a["label"] in labels):
            for name, rect in (("measurement", overlay), ("toolbar", toolbar), ("sheet", sheet)):
                assert not inside(rect, atom["x"], atom["y"], MARGIN), (
                    mode,
                    measure,
                    name,
                    atom,
                    rect,
                )
        # Touch targets stay usable.
        for sel in ("#measure-distance", "#measure-angle", "#measure-info", "#clear"):
            b = await page.locator(sel).bounding_box()
            assert b["width"] >= 40 and b["height"] >= 40, (sel, b)
        await page.screenshot(
            path=f"/tmp/psv-gui-assessment/phone-measure-{measure}-{mode}-{theme}.png"
        )
    assert not errors, errors
    await page.close()
    print(f"phone {theme} {mode}: angle and distance visible, atoms unobscured")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        for theme in ("dark", "light"):
            for mode in ("lattice", "sites", "export", "style"):
                await check(browser, theme, mode)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
