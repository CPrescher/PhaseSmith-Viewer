"""Axis views recenter projected geometry after pan/pinch on every screen size."""

import asyncio
import itertools
import math
import os
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle
from steering_smoke import dot, cross, unit, sub, eye


# Long, skew cell with unequal spheres protruding at just one corner. Its
# projected center differs from the center of its Cartesian bounding box.
CIF = b"""data_axis_framing
_cell_length_a 4
_cell_length_b 7
_cell_length_c 18
_cell_angle_alpha 74
_cell_angle_beta 83
_cell_angle_gamma 67
_space_group_name_H-M_alt 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na .98 .92 .97
Cl1 Cl .2 .1 .3
"""


async def check(browser, width, height, touch):
    context = await browser.new_context(
        viewport={"width": width, "height": height}, has_touch=touch,
        is_mobile=touch, device_scale_factor=2 if touch else 1,
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL)
    await page.wait_for_function("window.viewerDiagnostics?.().atoms.length > 0")
    await page.locator("#file").set_input_files(
        {"name": "axis-framing.cif", "mimeType": "text/plain", "buffer": CIF}
    )
    await page.wait_for_function("viewerDiagnostics().block === 'axis_framing'")
    await settle(page)
    session = await context.new_cdp_session(page) if touch else None
    largest_center_error = 0

    async def displace():
        rect = await page.locator("#viewport canvas").bounding_box()
        x, y = rect["x"] + rect["width"] * .5, rect["y"] + rect["height"] * .4
        before = (await diagnostics(page))["camera"]
        if touch:
            def fingers(dx, dy, gap):
                return [{"x": x + dx - gap, "y": y + dy, "id": 1},
                        {"x": x + dx + gap, "y": y + dy, "id": 2}]
            for kind, points in [("touchStart", fingers(0, 0, 25)),
                                 ("touchMove", fingers(36, 28, 50)),
                                 ("touchEnd", [])]:
                await session.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})
                await settle(page)
        else:
            await page.mouse.move(x, y)
            await page.mouse.down(button="right")
            await page.mouse.move(x + 70, y + 35, steps=6)
            await page.mouse.up(button="right")
            await page.mouse.wheel(0, -100)
            await page.wait_for_timeout(400)
        after = (await diagnostics(page))["camera"]
        assert math.dist(before["target"], after["target"]) > .1, "Test did not pan"
        assert abs(math.dist(before["position"], before["target"]) -
                   math.dist(after["position"], after["target"])) > .1, "Test did not zoom"

    async def assert_frame(indices):
        nonlocal largest_center_error
        await settle(page)
        d = await diagnostics(page)
        rect = await page.locator("#viewport canvas").bounding_box()
        direction = unit(eye(d))
        expected = unit([dot(row, indices) for row in d["basis"]])
        assert dot(direction, expected) > 1 - 1e-10, "Centering tilted the lattice direction"
        right = unit(cross(d["camera"]["up"], direction))
        up = unit(cross(direction, right))
        pixels = rect["height"] / (2 * math.dist(d["camera"]["position"], d["camera"]["target"]) * math.tan(math.radians(19)))
        cx, cy = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2
        center = [sum(row) / 2 for row in d["basis"]]
        bounds = []
        for fractional in itertools.product((0, 1), repeat=3):
            point = [dot(row, fractional) for row in d["basis"]]
            offset = sub(sub(point, center), d["camera"]["target"])
            bounds.append((cx + dot(offset, right) * pixels, cy - dot(offset, up) * pixels, 0))
        bounds.extend((a["x"], a["y"], a["radius"] * pixels) for a in d["atoms"])
        left = min(x - r for x, y, r in bounds)
        right_edge = max(x + r for x, y, r in bounds)
        top = min(y - r for x, y, r in bounds)
        bottom = max(y + r for x, y, r in bounds)
        error = math.dist(((left + right_edge) / 2, (top + bottom) / 2), (cx, cy))
        largest_center_error = max(error, largest_center_error)
        assert error < 1e-5, (width, height, indices, "off center", error)
        assert left > rect["x"] and right_edge < rect["x"] + rect["width"]
        assert top > rect["y"] and bottom < rect["y"] + rect["height"]
        assert d["stage"]["atFit"]
        await page.wait_for_timeout(250)
        assert (await diagnostics(page))["camera"] == d["camera"], "Old gesture moved axis view"

    for axis, indices in [("a", [1, 0, 0]), ("b", [0, 1, 0]), ("c", [0, 0, 1])]:
        await displace()
        button = page.locator("#view-" + axis)
        await (button.tap() if touch else button.click())
        await assert_frame(indices)
    await page.locator(".view-directions summary").click()
    await page.locator("#view-direction").fill("1 -2 1")
    await page.locator("#view-direction").press("Enter")
    await assert_frame([1, -2, 1])
    await page.keyboard.press("Escape")
    await page.set_viewport_size({"width": height, "height": width})
    await settle(page)
    await page.locator("#view-b").click()
    await assert_frame([0, 1, 0])
    assert not errors, errors
    print(f"{width}×{height}, touch={touch}: a/b/c/[uvw] and rotated screen centered within {largest_center_error:.6f} CSS px", flush=True)
    await context.close()


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        for width, height, touch in [(1440, 900, False), (1024, 768, True),
                                      (768, 1024, True), (390, 844, True), (844, 390, True)]:
            await check(browser, width, height, touch)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
