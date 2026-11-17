"""Native touch rotation, pan, pinch and twist follow the fingers exactly."""
import asyncio
import math
import os
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from smoke import URL, HERE, diagnostics, settle


async def check(browser, width, height, dpi):
    context = await browser.new_context(
        viewport={"width": width, "height": height}, has_touch=True,
        is_mobile=True, device_scale_factor=dpi,
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # Touch mapping needs real projected atoms, not the expensive translucent
    # forsterite scene. Rendering/polyhedra retain their own browser checks.
    await page.goto(URL + ("/" if QUICK else "/?example=forsterite"))
    await page.wait_for_function("window.viewerDiagnostics?.().history.ready")
    if QUICK:
        await page.locator("#file").set_input_files(HERE / "skew-direction.cif")
        await page.wait_for_function("viewerDiagnostics().block === 'skew_direction' && viewerDiagnostics().history.ready")
    session = await context.new_cdp_session(page)
    largest_error = 0

    async def send(kind, points):
        await session.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    def points(x, y, gap):
        return [{"x": x - gap, "y": y, "id": 1}, {"x": x + gap, "y": y, "id": 2}]

    async def assert_rotation(before):
        after = await diagnostics(page)
        camera = after["camera"]
        assert math.dist(camera["target"], before["target"]) < 1e-9, "One finger moved the rotation center"
        distance = lambda c: math.dist(c["position"], c["target"])
        assert math.isclose(distance(camera), distance(before), rel_tol=1e-9), "One finger changed zoom"
        assert not after["selectedIds"], "Rotation picked an atom"
        return camera

    async def assert_projection(before, cx, cy, dx, dy, scale, angle=0):
        nonlocal largest_error
        after = await diagnostics(page)
        old = {a["key"]: a for a in before["atoms"]}
        for a in after["atoms"]:
            b = old[a["key"]]
            x, y = b["x"] - cx, b["y"] - cy
            c, s = math.cos(angle), math.sin(angle)
            expected = (cx + dx + scale * (c * x - s * y), cy + dy + scale * (s * x + c * y))
            error = math.dist((a["x"], a["y"]), expected)
            largest_error = max(largest_error, error)
            assert error < 0.5, (width, height, dpi, error, expected, a)
        assert not after["selectedIds"], "Gesture picked an atom"

    for view in ("reset", "view-b"):
        await page.locator("#" + view).click()
        await settle(page)
        box = await page.locator("canvas").first.bounding_box()
        # Deliberately off center so a center-based pinch cannot pass.
        cx, cy = box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.56
        # Off-center one-finger drags rotate without carrying the model along.
        # Repeat after a pan/pinch to catch stale samples crossing gestures.
        async def rotate():
            before = (await diagnostics(page))["camera"]
            await send("touchStart", [{"x": cx, "y": cy, "id": 1}])
            for dx, dy in [(8, 4), (20, 10), (30, 18), (12, 8)]:
                await send("touchMove", [{"x": cx + dx, "y": cy + dy, "id": 1}])
                await settle(page)
                await assert_rotation(before)
            await send("touchEnd", [])
            await page.wait_for_timeout(350)
            after = await assert_rotation(before)
            assert math.dist(after["position"], before["position"]) > 1e-3, "One finger did not rotate"

        await rotate()
        for pinch in (False, True):
            gap = 25
            # Add the second finger separately, as on a real tablet.
            await send("touchStart", points(cx, cy, gap)[:1])
            await send("touchStart", points(cx, cy, gap))
            before = await diagnostics(page)
            for i in range(1, 5):
                dx, dy = 8 * i, -5 * i
                next_gap = gap + 4 * i if pinch else gap
                await send("touchMove", points(cx + dx, cy + dy, next_gap))
                await settle(page)
                await assert_projection(before, cx, cy, dx, dy, next_gap / gap)
            # No creep while held or after release.
            await page.wait_for_timeout(250)
            await assert_projection(before, cx, cy, dx, dy, next_gap / gap)
            await send("touchEnd", [])
            await page.wait_for_timeout(350)
            await assert_projection(before, cx, cy, dx, dy, next_gap / gap)

        # Either finger can act as an off-center pivot while the other circles.
        # Exercise opposite directions and crossing atan2's branch cut.
        for fixed_id in (1, 2):
            pivot_x, pivot_y, radius = cx - 20, cy, 45
            moving_id = 3 - fixed_id
            fixed = {"x": pivot_x, "y": pivot_y, "id": fixed_id}

            def twist_points(angle):
                moving = {"x": pivot_x + radius * math.cos(angle),
                          "y": pivot_y + radius * math.sin(angle), "id": moving_id}
                return sorted([fixed, moving], key=lambda p: p["id"])

            await send("touchStart", twist_points(0)[:1])
            await send("touchStart", twist_points(0))
            before = await diagnostics(page)
            for value in (0.4, 1.4, 2.6, 3.5):
                angle = value if fixed_id == 1 else -value
                await send("touchMove", twist_points(angle))
                await settle(page)
                await assert_projection(before, pivot_x, pivot_y, 0, 0, 1, angle)
            await page.wait_for_timeout(100)
            await assert_projection(before, pivot_x, pivot_y, 0, 0, 1, angle)
            # Lifting the moving finger leaves the pivot finger without a jump.
            await send("touchEnd", [p for p in twist_points(angle) if p["id"] == moving_id])
            await page.wait_for_timeout(100)
            await assert_projection(before, pivot_x, pivot_y, 0, 0, 1, angle)
            await send("touchEnd", [])
            await page.wait_for_timeout(150)
            await assert_projection(before, pivot_x, pivot_y, 0, 0, 1, angle)

        # All three two-finger actions compose into the same screen transform.
        await send("touchStart", points(cx, cy, 25)[:1])
        await send("touchStart", points(cx, cy, 25))
        before = await diagnostics(page)
        for i in range(1, 5):
            angle, scale, dx, dy = -0.15 * i, 1 + 0.08 * i, 4 * i, -3 * i
            moved = [{"id": id, "x": cx + dx + sign * 25 * scale * math.cos(angle),
                      "y": cy + dy + sign * 25 * scale * math.sin(angle)}
                     for id, sign in ((1, -1), (2, 1))]
            await send("touchMove", moved)
            await settle(page)
            await assert_projection(before, cx, cy, dx, dy, scale, angle)
        await send("touchEnd", [])
        await page.wait_for_timeout(250)
        await assert_projection(before, cx, cy, dx, dy, scale, angle)
        await rotate()

    # Switching from a rotating finger to two fingers stops rotation inertia.
    await page.locator("#reset").click()
    await send("touchStart", points(cx, cy, gap)[:1])
    await send("touchMove", [{"x": cx - gap + 15, "y": cy + 10, "id": 1}])
    await settle(page)
    cx, cy = cx + 15, cy + 10
    await send("touchStart", points(cx, cy, gap))
    before = await diagnostics(page)
    await send("touchMove", points(cx + 20, cy + 15, gap))
    await page.wait_for_timeout(150)
    await assert_projection(before, cx, cy, 20, 15, 1)
    # Lift just the second finger: the first can rotate again without a jump.
    remaining = points(cx + 20, cy + 15, gap)[:1]
    # CDP's nonempty touchEnd list identifies the fingers being released.
    await send("touchEnd", points(cx + 20, cy + 15, gap)[1:])
    await settle(page)
    before = await diagnostics(page)
    await page.wait_for_timeout(100)
    assert (await diagnostics(page))["camera"] == before["camera"]
    remaining[0]["x"] += 25
    await send("touchMove", remaining)
    await settle(page)
    assert (await diagnostics(page))["camera"] != before["camera"]
    await assert_rotation(before["camera"])
    await send("touchEnd", [])
    assert not errors, errors
    print(f"{width}×{height}, DPI {dpi}: max pan/pinch/twist slip {largest_error:.4f} CSS px", flush=True)
    await context.close()


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        dimensions = [(1024, 768, 1)] if QUICK else [(1024, 768, 1), (1024, 768, 2), (768, 1024, 2), (390, 844, 3)]
        for size in dimensions:
            print(f"Starting touch gestures: {size[0]}×{size[1]}, DPI {size[2]}", flush=True)
            await check(browser, *size)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
