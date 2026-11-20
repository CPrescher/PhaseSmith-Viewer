"""Pointer-driven unrestricted rotation and direct crystallographic direction checks."""

import asyncio
import json
import math
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, HERE, diagnostics, settle


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def norm(v):
    return math.sqrt(dot(v, v))


def unit(v):
    return [x / norm(v) for x in v]


def cross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def eye(d):
    return sub(d["camera"]["position"], d["camera"]["target"])


async def frames(page, n=60):
    await page.evaluate(
        "(n)=>new Promise(r=>{function tick(){if(--n<=0)r();else requestAnimationFrame(tick)}tick()})",
        n,
    )


async def run(browser_type, touch):
    options = {}
    override = os.environ.get(browser_type.name.upper() + "_EXECUTABLE")
    if override:
        options["executable_path"] = override
    elif not Path(browser_type.executable_path).exists():
        pattern = (
            "chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            if browser_type.name == "chromium"
            else "webkit-*/pw_run.sh"
        )
        candidates = sorted(
            (Path.home() / "Library/Caches/ms-playwright").glob(pattern)
        )
        if candidates:
            options["executable_path"] = str(candidates[-1])
    browser = await browser_type.launch(**options)
    context = await browser.new_context(
        viewport={"width": 1200, "height": 850}, has_touch=touch
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function('typeof window.viewerDiagnostics === "function"')
    await page.locator("#file").set_input_files(HERE / "skew-direction.cif")
    await page.wait_for_function(
        "window.viewerDiagnostics().block === 'skew_direction'"
    )
    await frames(page)
    box = await page.locator("canvas").first.bounding_box()
    x = box["x"] + box["width"] * 0.5
    y = box["y"] + box["height"] * 0.30
    session = await context.new_cdp_session(page) if touch else None
    initial = await diagnostics(page)
    axis = unit(cross(unit(eye(initial)), initial["camera"]["up"]))
    previous = unit(eye(initial))
    angle = 0
    min_up = 1
    for drag in range(6):
        if touch:
            await session.send(
                "Input.dispatchTouchEvent",
                {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]},
            )
        else:
            await page.mouse.move(x, y)
            await page.mouse.down()
        for step in range(1, 13):
            if touch:
                await session.send(
                    "Input.dispatchTouchEvent",
                    {
                        "type": "touchMove",
                        "touchPoints": [{"x": x, "y": y + step * 15, "id": 1}],
                    },
                )
            else:
                await page.mouse.move(x, y + step * 15)
            await settle(page)
            d = await diagnostics(page)
            current = unit(eye(d))
            angle += math.atan2(
                dot(axis, cross(previous, current)), dot(previous, current)
            )
            previous = current
            min_up = min(min_up, d["camera"]["up"][1])
        if touch:
            await session.send(
                "Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}
            )
        else:
            await page.mouse.up()
        await frames(page, 30)
        current = unit(eye(await diagnostics(page)))
        angle += math.atan2(dot(axis, cross(previous, current)), dot(previous, current))
        previous = current
    assert abs(angle) > 2 * math.pi, (angle, touch)
    assert min_up < -0.7, (min_up, touch)
    # A reset during residual inertia must remain at its requested orientation.
    await page.locator("#reset").click()
    await settle(page)
    reset = await diagnostics(page)
    await frames(page, 90)
    later = await diagnostics(page)
    assert norm(sub(eye(reset), eye(later))) < 1e-5, (reset["camera"], later["camera"])
    # Zoom still responds after looping; native pinch starts on the canvas.
    before = norm(eye(later))
    if touch:
        points = lambda gap: [
            {"x": x - gap, "y": y, "id": 1},
            {"x": x + gap, "y": y, "id": 2},
        ]
        await session.send(
            "Input.dispatchTouchEvent",
            {"type": "touchStart", "touchPoints": points(15)},
        )
        for gap in (25, 40, 60):
            await session.send(
                "Input.dispatchTouchEvent",
                {"type": "touchMove", "touchPoints": points(gap)},
            )
        await session.send(
            "Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}
        )
    else:
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, 150)
    await frames(page, 60)
    assert abs(norm(eye(await diagnostics(page))) - before) > 0.01
    # Real taps remain functional after complete rotations and zoom.
    await page.locator("#measure-distance").click()
    async def exposed_atoms():
        atoms = (await diagnostics(page))["atoms"]
        hit_ids = await page.evaluate(
            """atoms => atoms.filter(a =>
              document.elementFromPoint(a.x, a.y)?.tagName === 'CANVAS'
            ).map(a => a.id)""",
            atoms,
        )
        return [
            a for a in atoms if a["id"] in hit_ids
            and -1 < a["z"] < 1
            and box["y"] + 160 < a["y"] < box["y"] + box["height"] - 80
            and all(
                a["id"] == b["id"] or math.dist((a["x"], a["y"]), (b["x"], b["y"])) > 20
                for b in atoms
            )
        ]

    candidates = await exposed_atoms()
    if len(candidates) < 2:
        await page.locator("#reset").click()
        await frames(page, 30)
        candidates = await exposed_atoms()
    assert len(candidates) >= 2, "No unobscured test pair"
    candidates.sort(
        key=lambda a: math.dist(
            (a["x"], a["y"]),
            (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2),
        )
    )
    for a in candidates[:2]:
        if touch:
            await page.touchscreen.tap(a["x"], a["y"])
        else:
            await page.mouse.click(a["x"], a["y"])
    await frames(page, 30)
    selected = await diagnostics(page)
    assert len(selected["selectedIds"]) == 2, selected
    selected_ids = selected["selectedIds"]
    distance = selected["distance"]

    async def check_direction(indices):
        await frames(page, 30)
        d = await diagnostics(page)
        assert d["camera"]["projection"] == "orthographic"
        expected = unit(
            [sum(d["basis"][r][c] * indices[c] for c in range(3)) for r in range(3)]
        )
        assert dot(unit(eye(d)), expected) > 1 - 1e-9, (indices, d["camera"], expected)
        if indices in ([1, 0, 0], [0, 1, 0], [0, 0, 1]):
            k = indices.index(1)
            pairs = [
                (a, b)
                for a in d["atoms"]
                for b in d["atoms"]
                if abs(a["frac"][k] - b["frac"][k]) > 0.5
                and all(
                    abs(a["frac"][j] - b["frac"][j]) < 1e-8 for j in range(3) if j != k
                )
            ]
            assert pairs
            assert all(
                math.dist((a["x"], a["y"]), (b["x"], b["y"])) < 1e-6 for a, b in pairs
            ), "Indexed columns do not superimpose"
        assert d["stage"]["atFit"], "Direction did not recenter and fit the structure"
        assert d["selectedIds"] == selected_ids and d["distance"] == distance, d
        before = d["camera"]
        await frames(page, 45)
        assert (await diagnostics(page))["camera"] == before, (
            "Direction drifted under old damping"
        )

    for axis_id, indices in [("a", [1, 0, 0]), ("b", [0, 1, 0]), ("c", [0, 0, 1])]:
        await page.locator("#view-" + axis_id).click()
        await check_direction(indices)
    await page.locator(".view-directions details summary").click()
    await page.locator("#view-direction").fill("1 -2 1")
    await page.locator("#direction-form button[type=submit]").click()
    await check_direction([1, -2, 1])
    before = await diagnostics(page)
    await page.locator("#view-direction").fill("0 0 0")
    await page.locator("#direction-form button[type=submit]").click()
    await frames(page, 30)
    after = await diagnostics(page)
    assert await page.locator("#direction-error").inner_text()
    assert (
        before["camera"] == after["camera"]
        and before["selectedIds"] == after["selectedIds"]
        and before["distance"] == after["distance"]
    )
    print(
        json.dumps(
            {
                "browser": browser_type.name,
                "touch": touch,
                "rotation_degrees": round(math.degrees(angle)),
                "min_up_y": round(min_up, 3),
                "errors": errors,
            }
        ),
        flush=True,
    )
    assert not errors, errors
    await browser.close()


async def main():
    async with async_playwright() as p:
        for browser, touch in (
            (p.chromium, False),
            (p.chromium, True),
            (p.webkit, False),
        ):
            await run(browser, touch)


if __name__ == "__main__":
    asyncio.run(main())
