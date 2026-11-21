"""Linked reflection, detector, and powder views through their public controls."""

import asyncio
import base64
import os
import math
import json
import struct
from smoke import HERE, URL, choose_tool, reveal_control
from playwright.async_api import async_playwright


async def check(browser, width, height):
    page = await browser.new_page(
        viewport={"width": width, "height": height}, has_touch=width < 500
    )
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function("window.viewerDiagnostics?.().block")
    await page.locator("#file").set_input_files(
        HERE.parent / "public/structures/periclase.cif"
    )
    await page.wait_for_function("window.viewerDiagnostics().block==='1000053'")
    if width > 500:
        await choose_tool(page, "#mode-powder")
        await page.wait_for_selector(
            "#analysis-chart .analysis-stick", state="attached"
        )
    await choose_tool(page, "#mode-reflection")
    await page.fill("#reflection-hkl", "2 0 0")
    await reveal_control(page, "#reflection-detector")
    await page.click("#reflection-detector")
    assert await page.is_visible("#detector-window")
    assert not await page.is_visible("#reflection-explorer")
    assert await page.input_value("#detector-spots") == "2 0 0"
    print(width, await page.inner_text("#detector-detail"), flush=True)
    if width > 500:
        assert "2 0 0" in await page.inner_text("#analysis-detail")
        assert await page.locator("#analysis-chart .selected").count() == 1

    async def check_starting_beam():
        beam = page.locator("#detector-ewald line.incident").first
        dx, dy = await beam.evaluate("""e => [
            e.x2.baseVal.value - e.x1.baseVal.value,
            e.y2.baseVal.value - e.y1.baseVal.value
        ]""")
        assert dx > 1 and abs(dy) < 1e-6, (dx, dy)

    nodes = page.locator("#detector-ewald .lattice-node")
    radii = lambda: nodes.evaluate_all("els => els.map(e => e.r.baseVal.value)")
    # Resizing the phone dialog replaces the SVG nodes. Read the computed
    # fill from a currently attached node once the first drawing is ready.
    await page.wait_for_function("""() => {
        const node = document.querySelector('#detector-ewald .lattice-node');
        return node && getComputedStyle(node).fill.includes('ewald-lattice-ball');
    }""")
    normal_radii = await radii()
    assert normal_radii
    initial_spots = await page.locator("#detector-image").inner_html()
    await page.locator("#detector-point-size").fill("200")
    assert all(
        abs(big - 2 * small) < 1e-5
        for big, small in zip(await radii(), normal_radii, strict=True)
    )
    assert initial_spots == await page.locator("#detector-image").inner_html()
    await page.locator("#detector-point-size").fill("100")
    await check_starting_beam()
    # In beam view, outgoing and detector offsets have the same signed azimuth.
    await page.click("#ewald-beam")
    await page.focus("#detector-azimuth")
    for angle in [45, 135, -135, -45]:
        await page.locator("#detector-azimuth").fill(str(angle))
        vectors = await page.evaluate("""() => {
          const ray = document.querySelector('#detector-ewald line.outgoing');
          const sensor = document.querySelector('#detector-image .sensor');
          const hit = document.querySelector('#detector-image .active-spot');
          return [[ray.x2.baseVal.value-ray.x1.baseVal.value,ray.y2.baseVal.value-ray.y1.baseVal.value],
                  [hit.cx.baseVal.value-sensor.cx.baseVal.value,hit.cy.baseVal.value-sensor.cy.baseVal.value]];
        }""")
        ray, spot = vectors
        assert abs(math.atan2(*ray) - math.atan2(*spot)) < 1e-5, vectors
        assert (spot[0] < 0) == (abs(angle) < 90)
        assert (spot[1] < 0) == (angle > 0)
    await page.locator("#detector-azimuth").fill("0")
    await page.click("#ewald-reset")
    await check_starting_beam()
    angle = await page.input_value("#detector-omega")
    # The display and navigation controls must stay put between Bragg crossings.
    await page.evaluate("""() => {
      const selectors = ['#detector-ewald','#detector-image','#detector-prev','#detector-next'];
      window.stepLayout = () => selectors.flatMap(s => {
        const r = document.querySelector(s).getBoundingClientRect();
        return [r.x,r.y,r.width,r.height];
      });
      window.stepBounds = [window.stepLayout()];
    }""")
    await page.check("#detector-animate")
    await page.evaluate("""() => {
      const output = document.querySelector('#detector-omega-value');
      window.stepAngles = new Set();
      window.stepObserver = new MutationObserver(() => { window.stepAngles.add(output.textContent); window.stepBounds.push(window.stepLayout()); });
      window.stepObserver.observe(output, {childList:true});
    }""")
    await page.click("#detector-prev")
    await page.wait_for_function(
        "!document.querySelector('#detector-window').hasAttribute('aria-busy')"
    )
    assert (
        await page.evaluate("window.stepObserver.disconnect(); window.stepAngles.size")
        > 1
    )
    assert await page.evaluate(
        "window.stepBounds.every(b => b.every((v,i) => Math.abs(v-window.stepBounds[0][i]) < 1))"
    )
    await page.uncheck("#detector-animate")
    assert await page.input_value("#detector-omega") != angle
    await page.click("#detector-next")
    assert await page.input_value("#detector-omega") == angle
    await page.locator("#detector-hkl").press("Enter")
    await page.click("#detector-open-options")
    await page.fill("#detector-diameter", "100")
    await page.locator("#detector-diameter").press("Tab")
    assert not await page.locator("#detector-image .active-spot").count()
    await page.fill("#detector-diameter", "200")
    await page.locator("#detector-diameter").press("Tab")
    assert await page.locator("#detector-image .active-spot").count()
    await page.select_option("#detector-outline", "rectangle")
    await page.fill("#detector-width", "100")
    await page.locator("#detector-width").press("Tab")
    assert await page.locator("#detector-image rect.sensor").count()
    assert not await page.locator("#detector-image .active-spot").count()
    await page.select_option("#detector-outline", "circle")
    await page.keyboard.press("Escape")
    assert await page.is_visible("#detector-window") and not await page.is_visible(
        "#detector-options"
    )
    await page.wait_for_function(
        "document.activeElement.id === 'detector-open-options'"
    )
    assert (await page.locator("#detector-go").is_visible()) == (width < 500)
    if width < 500:
        await page.locator("#detector-go").tap()
        assert await page.input_value("#detector-spots") == "2 0 0"
    if width > 500:
        # Drag the dialog's resize grip and verify BOTH drawings occupy the new space.
        win = page.locator("#detector-window")
        box = await win.bounding_box()
        grids = page.locator("#detector-ewald .sphere, #detector-image .sensor")
        sizes = await grids.evaluate_all(
            "els => els.map(e=>e.getBoundingClientRect().width)"
        )
        x, y = box["x"] + box["width"] - 3, box["y"] + box["height"] - 3
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + 65, y + 54, steps=6)
        await page.mouse.up()
        await page.wait_for_function(
            """old => [...document.querySelectorAll('#detector-ewald .sphere,#detector-image .sensor')]
            .every((e,i)=>e.getBoundingClientRect().width>old[i]+15)""",
            arg=sizes,
        )
        gap = await page.evaluate("""() => document.querySelector('#detector-window').getBoundingClientRect().bottom
          - document.querySelector('#detector-scope').getBoundingClientRect().bottom""")
        assert gap < 36, gap
        # The laptop inspector starts beside the crystal at the left edge.
        # Move it inward so a leftward resize has actual viewport space.
        title = await page.locator("#detector-title").bounding_box()
        await page.mouse.move(title["x"] + 8, title["y"] + 8)
        await page.mouse.down()
        await page.mouse.move(title["x"] + 88, title["y"] + 8, steps=4)
        await page.mouse.up()
        box = await win.bounding_box()
        handle = await page.locator("#detector-resize-left").bounding_box()
        x, y = handle["x"] + 6, handle["y"] + handle["height"] - 6
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x - 36, y - 25, steps=4)
        await page.mouse.up()
        resized = await win.bounding_box()
        assert resized["width"] > box["width"] + 30
        assert abs((resized["width"] + resized["x"]) - (box["width"] + box["x"])) < 2
    # Scrub to the 020 crossing on the physical angular scale.
    slider = page.locator("#detector-omega")
    bounds = await slider.bounding_box()
    await slider.click(
        position={
            "x": 8 + (bounds["width"] - 16) * (180 + 21.43) / 360,
            "y": bounds["height"] / 2,
        }
    )
    assert await page.input_value("#detector-spots") == "0 2 0"
    assert await page.input_value("#detector-hkl") == "2 0 0"
    assert (
        await page.locator("#detector-image .detector-spot-label").text_content()
        == "(0 2 0)"
    )
    await page.locator("#detector-hkl").press("Enter")
    await page.focus("#detector-azimuth")
    await page.keyboard.press("End")
    assert await page.input_value("#detector-spots") == "2 0 0"
    await page.click("#detector-ring")
    assert not await page.locator(".powder-ring").count()
    await page.click("#detector-ring")
    await page.click("#detector-explain")
    assert not await page.is_visible("#reflection-error")
    assert await page.input_value("#reflection-hkl") == "2 0 0"
    await page.click("#reflection-close")
    await page.click("#detector-next")
    assert await page.locator("#detector-image .detector-hit").count()
    if await page.locator('[data-detector-view="image"]').is_visible():
        await page.locator('[data-detector-view="image"]').click()
    await page.locator("#detector-image .detector-hit").first.click()
    if await page.locator('[data-detector-view="ewald"]').is_visible():
        await page.locator('[data-detector-view="ewald"]').click()
    await page.fill("#detector-hkl", "1 0 0")
    await page.locator("#detector-hkl").press("Enter")
    assert "cancels" in await page.inner_text("#detector-status")
    assert not await page.locator(
        "#detector-ewald .outgoing,#detector-ewald .tracked-node,#detector-ewald .spot-label"
    ).count()
    await page.fill("#detector-hkl", "2 0 0")
    await page.locator("#detector-hkl").press("Enter")
    await page.click("#detector-explain")
    await page.fill("#reflection-hkl", "2 2 2")
    await reveal_control(page, "#reflection-detector")
    await page.click("#reflection-detector")
    assert await page.input_value("#detector-spots") == "2 2 2"
    assert float(await page.input_value("#detector-distance")) < 100
    assert await page.locator("#detector-ewald .detector-plane").count() == 1
    camera = lambda: page.evaluate("window.viewerDiagnostics().camera")
    planes = lambda: page.evaluate("window.viewerDiagnostics().lattice.detectorPlane")
    original = await camera()
    assert not await page.is_checked("#detector-link")
    await page.focus("#detector-omega")
    await page.keyboard.press("ArrowRight")
    new_spot = await page.input_value("#detector-spots")
    assert new_spot and new_spot != "2 2 2"
    assert await page.input_value("#detector-hkl") == "2 2 2"
    assert await camera() == original and await planes() is None
    await page.check("#detector-link")
    assert (await planes())["hkl"] == list(map(int, new_spot.split()))
    assert (await planes())["polygons"] > 0
    linked = await camera()
    assert linked["position"] != original["position"]
    sphere = page.locator("#detector-ewald")
    axes = sphere.locator(".cell-axis-label")
    assert await axes.all_text_contents() == ["a", "b", "c"]
    axis_positions = lambda: axes.evaluate_all(
        "els => els.map(el => [el.x.baseVal[0].value, el.y.baseVal[0].value])"
    )
    before_axes = await axis_positions()
    near_path = sphere.locator(".sphere-grid.near")
    before_grid = await near_path.get_attribute("d")
    spot_positions = await page.locator("#detector-image").inner_html()
    bounds = await sphere.bounding_box()
    x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2

    async def point(selector):
        return await sphere.locator(selector).evaluate(
            "e => [e.cx.baseVal.value, e.cy.baseVal.value]"
        )

    origin = await point(".origin")
    assert await sphere.evaluate("s => [s.clientWidth/2, s.clientHeight/2]") == origin
    center = await point(".sphere-center")
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 25, y + 15, steps=4)
    await page.mouse.up()
    assert await near_path.get_attribute("d") != before_grid
    assert await point(".origin") == origin
    assert math.dist(center, await point(".sphere-center")) > 1
    assert await axis_positions() != before_axes
    rotated_camera = await camera()
    assert math.dist(rotated_camera["position"], linked["position"]) > 0.01

    # Compare the screen direction of each inset edge to the main crystal's compass.
    async def check_linked_axes():
        await page.wait_for_function("""() => {
          const main = window.viewerDiagnostics().axisCompass;
          return [...document.querySelectorAll('#detector-ewald .cell-axis')].every((g,i) => {
            if (g.querySelector('.cell-end')) return main[i].projectedLength < 0.35;
            const l = g.querySelector('line');
            const dx = l.x2.baseVal.value-l.x1.baseVal.value, dy = l.y1.baseVal.value-l.y2.baseVal.value;
            return (dx*main[i].x + dy*main[i].y) / (Math.hypot(dx,dy)*main[i].projectedLength) > 0.99999;
          });
        }""")

    await check_linked_axes()
    rotated_grid = await near_path.get_attribute("d")
    r = float(await sphere.locator(".sphere").get_attribute("r"))
    await page.click("#ewald-in")
    assert float(await sphere.locator(".sphere").get_attribute("r")) > r
    assert await point(".origin") == origin
    await page.evaluate("""document.addEventListener('contextmenu', e => {
      window.menuSuppressed = e.defaultPrevented;
    }, {once: true})""")
    await sphere.click(button="right")
    assert await page.evaluate("window.menuSuppressed")
    assert await near_path.get_attribute("d") == rotated_grid
    async with page.expect_download() as pending:
        await page.click("#detector-save")
    download = await pending.value
    assert download.suggested_filename.endswith("-diffraction.png")
    data = (await download.path()).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24])[0] >= 1400
    # The axis colors must survive the SVG-to-PNG conversion in the actual download.
    assert await page.evaluate(
        r"""async encoded => {
      const image = new Image();
      image.src = "data:image/png;base64," + encoded;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width / 2, image.height).data;
      const colors = new Set([...document.querySelectorAll('.cell-axis-label')].map(el =>
        getComputedStyle(el).fill.match(/\d+/g).join(",")));
      for (let i = 0; i < pixels.length && colors.size; i += 4)
        colors.delete([pixels[i], pixels[i+1], pixels[i+2]].join(","));
      return !colors.size;
    }""",
        base64.b64encode(data).decode(),
    )
    await page.click("#ewald-beam")
    assert math.dist(await point(".sphere-center"), origin) < 1e-6
    assert await point(".origin") == origin
    await page.click("#ewald-reset")
    assert await near_path.get_attribute("d") == before_grid
    assert await page.locator("#detector-image").inner_html() == spot_positions
    assert math.dist((await camera())["position"], linked["position"]) < 1e-8
    await page.focus("#detector-omega")
    await page.keyboard.press("ArrowRight")
    assert (await camera())["position"] != linked["position"]
    await page.keyboard.press("Home")
    assert not await page.locator("#detector-image .detector-hit").count()
    assert not await sphere.locator(
        ".spot-label, .tracked-node, .detector-plane"
    ).count()
    assert await planes() is None
    if width > 500:
        assert not await page.locator("#analysis-chart .selected").count()
    await page.uncheck("#detector-link")
    restored = await camera()
    assert all(
        abs(a - b) < 1e-8 for a, b in zip(restored["position"], original["position"])
    )
    assert restored["up"] == original["up"]
    await page.click("#ewald-beam")
    await page.keyboard.press("Escape")
    assert not await page.is_visible("#detector-window")
    if width > 500:
        assert await page.is_visible("#analysis-window")
        await page.keyboard.press("Escape")
        assert not await page.is_visible("#analysis-window")
    await choose_tool(page, "#mode-detector")
    assert await page.is_visible("#detector-window")
    await check_starting_beam()
    await page.click("#detector-open-options")
    await page.click("#detector-mount summary")
    identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    sample = {
        "orientations": [
            {"candidate": "A", "orientation_matrix": identity},
            {
                "candidate": "B",
                "orientation_matrix": [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
            },
        ],
        "phase_smith_plane_vectors_m_and_directions": [
            [0, 0, 0.2],
            [0, 1, 0],
            [1, 0, 0],
            [0, 0, 1],
            [1, 0, 1],
        ],
    }
    await page.locator("#detector-orientation-file").set_input_files(
        {
            "name": "orientations.json",
            "mimeType": "application/json",
            "buffer": json.dumps(sample).encode(),
        }
    )
    await page.select_option("#detector-candidate", label="B")
    await page.fill("#detector-set-angle", "-12.5")
    await page.click("#detector-mount-form [type=submit]")
    assert "Orientation applied" in await page.inner_text("#detector-mount-status")
    assert await page.input_value("#detector-omega") == "-12.5"
    await page.fill("#detector-axis", "0 0 0")
    await page.click("#detector-mount-form [type=submit]")
    assert "nonzero" in await page.inner_text("#detector-mount-status")
    assert await page.input_value("#detector-omega") == "-12.5"
    await page.click("#detector-mount summary")
    await page.click("#detector-calibration summary")
    await page.locator("#detector-poni").set_input_files(
        {
            "name": "offset.poni",
            "mimeType": "text/plain",
            "buffer": (
                'Detector: Detector\nDetector_config: {"pixel1":0.0002,"pixel2":0.0001,"max_shape":[1000,2200]}\n'
                "Distance: 0.065\nPoni1: 0.11\nPoni2: 0.095\nRot1: 0.02\nRot2: 0.035\nRot3: -0.03\nWavelength: 1e-10"
            ).encode(),
        }
    )
    await page.wait_for_function(
        "document.querySelector('#detector-distance').disabled"
    )
    assert await page.text_content("#detector-size") == "2200 × 1000 px"
    assert await page.locator("#detector-image rect.sensor").count()
    await page.click("#detector-options-done")
    await page.click("#detector-next")
    assert "column " in await page.inner_text("#detector-detail")
    await page.click("#detector-open-options")
    await page.click("#detector-clear-poni")
    await page.click("#detector-options-done")
    assert await page.text_content("#detector-size") == "200 mm diameter"
    if width > 500:
        # Capture the selected reflection across real main-canvas drag samples.
        await page.click("#detector-open-options")
        await page.fill("#detector-wavelength", "0.75")
        await page.locator("#detector-wavelength").press("Tab")
        await page.click("#detector-options-done")
        await page.fill("#detector-hkl", "2 0 0")
        await page.locator("#detector-hkl").press("Enter")
        await page.click("#detector-next")
        assert await page.locator("#detector-image .active-spot").count()
        await page.check("#detector-link")
        old_matrix = await page.input_value("#detector-matrix")
        old_grid = await near_path.get_attribute("d")
        old_angle = await page.input_value("#detector-omega")
        old_azimuth = await page.input_value("#detector-azimuth")
        xy = await page.evaluate("""() => {
          const canvas=document.querySelector('#viewport canvas');
          for(let y=25;y<innerHeight-40;y+=24) for(let x=25;x<innerWidth-50;x+=24)
            if(document.elementFromPoint(x,y)===canvas && document.elementFromPoint(x+32,y+20)===canvas) return [x,y];
        }""")
        assert xy
        await page.mouse.move(*xy)
        before_spot = await page.input_value("#detector-spots")
        initial_indices = await page.locator("#detector-spots option").evaluate_all(
            "els => els.map(e => e.value)"
        )
        # Hold the same reflection across a perceptible amount of pointer
        # travel, then release it during the same one-pixel-at-a-time drag.
        await page.mouse.down()
        for step in range(1, 17):
            await page.mouse.move(xy[0] + step, xy[1])
            await page.evaluate(
                "() => new Promise(r=> requestAnimationFrame(()=>requestAnimationFrame(r)))"
            )
            angle = await page.input_value("#detector-omega")
            if step <= 9:
                assert angle == old_angle
                assert await page.input_value("#detector-spots") == before_spot
                assert "Snapped" in await page.inner_text("#detector-status")
                assert (
                    await page.locator("#detector-spots option").evaluate_all(
                        "els => els.map(e => e.value)"
                    )
                    == initial_indices
                )
            elif angle != old_angle:
                break
        assert angle != old_angle
        await page.mouse.up()
        await page.mouse.move(*xy)
        dragged_indices = set()
        for dx, dy in [(138, 64), (-90, 110), (60, -95)]:
            await page.mouse.down()
            x, y = xy
            for i in range(1, 11):
                await page.mouse.move(x + dx * i / 10, y + dy * i / 10)
                await page.evaluate(
                    "() => new Promise(r=> requestAnimationFrame(()=>requestAnimationFrame(r)))"
                )
                index = await page.input_value("#detector-spots")
                for slider in ("omega", "azimuth"):
                    value = float(await page.input_value("#detector-" + slider))
                    label = await page.inner_text("#detector-" + slider + "-value")
                    assert abs(value - float(label.rstrip("°"))) < 0.011
                vector = await sphere.locator("line.outgoing").count()
                plane = await planes()
                assert bool(
                    await page.locator("#detector-image .active-spot").count()
                ) == bool(index)
                if index:
                    assert vector and plane["hkl"] == list(map(int, index.split()))
                    dragged_indices.add(index)
                else:
                    assert not vector and plane is None
                    assert not await sphere.locator(".reciprocal,.spot-label").count()
            await page.mouse.up()
            await page.mouse.move(*xy)
            if dragged_indices - {before_spot}:
                break
        assert dragged_indices - {before_spot}, (before_spot, dragged_indices)
        assert await page.input_value("#detector-matrix") != old_matrix
        await check_linked_axes()
        assert await near_path.get_attribute("d") == old_grid
        assert await page.input_value("#detector-omega") != old_angle
        assert await page.input_value("#detector-azimuth") != old_azimuth
        await page.click("#detector-next")
        assert await page.locator("#detector-image .active-spot").count()
        # Repeated snap/release within one curved drag used to deform the
        # mounting matrix, change zoom, and eventually hide the unit cell.
        initial_camera = await camera()
        distance = math.dist(initial_camera["position"], initial_camera["target"])
        await page.mouse.move(*xy)
        await page.mouse.down()
        for frame in range(1, 121):
            await page.mouse.move(
                xy[0] + 70 * math.sin(frame * 0.048),
                xy[1] + 45 * math.sin(frame * 0.079),
            )
            await page.evaluate("() => new Promise(requestAnimationFrame)")
            if frame % 10:
                continue
            view = await page.evaluate("""() => {
              const {camera, axisCompass, atoms} = viewerDiagnostics();
              return {camera, axes:axisCompass.map(a=>[a.x,a.y,a.z]),
                inView:atoms.filter(a=>a.visible && Math.abs(a.z)<1 &&
                  a.x>=0 && a.x<innerWidth && a.y>=0 && a.y<innerHeight).length};
            }""")
            cam = view["camera"]
            assert math.isclose(
                math.dist(cam["position"], cam["target"]), distance, rel_tol=1e-9
            )
            assert view["inView"] == 27
            matrix = await page.input_value("#detector-matrix")
            for basis in (
                view["axes"],
                [list(map(float, row.split())) for row in matrix.splitlines()],
            ):
                for i, axis in enumerate(basis):
                    for j, other in enumerate(basis):
                        dot = sum(a * b for a, b in zip(axis, other))
                        assert abs(dot - int(i == j)) < 1e-9
        await page.mouse.up()
        await check_linked_axes()
        # Close/reopen preserves the exact selected reflection and the Ewald camera.
        await page.click("#detector-next")
        await page.wait_for_function(
            "!document.querySelector('#detector-window').hasAttribute('aria-busy')"
        )
        pose = await camera()
        index = await page.input_value("#detector-spots")
        await page.click("#detector-close")
        assert math.dist((await camera())["position"], pose["position"]) < 1e-9
        assert await planes() is None
        await choose_tool(page, "#mode-detector")
        assert await page.is_checked("#detector-link")
        assert await page.input_value("#detector-spots") == index
        assert await near_path.get_attribute("d") == old_grid
        await check_linked_axes()
        await page.click("#detector-close")
        await page.mouse.move(*xy)
        await page.mouse.down()
        await page.mouse.move(xy[0] + 65, xy[1] + 22, steps=8)
        await page.mouse.up()
        # Capture the actual pose at the click; normal trackball damping can
        # still be moving the crystal between the release and the click.
        await page.evaluate("""() => document.querySelector('#mode-detector').addEventListener('click',
          () => { window.reopenPose = viewerDiagnostics().camera }, {capture:true, once:true})""")
        await choose_tool(page, "#mode-detector")
        moved = await page.evaluate("window.reopenPose")
        assert math.dist(moved["position"], pose["position"]) > 0.01
        assert math.dist((await camera())["position"], moved["position"]) < 1e-8
        await check_linked_axes()
        await page.uncheck("#detector-link")
    assert not errors, errors
    await page.close()


async def main():
    async with async_playwright() as p:
        options = {"args": ["--enable-unsafe-swiftshader"]}
        if os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        b = await p.chromium.launch(**options)
        for w, h in [(1280, 900), (390, 844)]:
            await check(b, w, h)
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
