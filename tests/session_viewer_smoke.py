from smoke import choose_tool, reveal_control
"""Full viewer settings and ordered measurements survive an actual browser restart."""

import asyncio
import math
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle
from science_smoke import change

ANGLE_CIF = """data_angle
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


async def record(page):
    return await page.evaluate("""()=>new Promise((resolve,reject)=>{const r=indexedDB.open('phasesmith-viewer-session',1);
    r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records','readonly'),q=tx.objectStore('records').get('state');
    q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(q.result??null);tx.oncomplete=()=>db.close()}})""")


async def wait_record(page, predicate):
    for _ in range(60):
        value = await record(page)
        if value and predicate(value):
            return value
        await page.wait_for_timeout(100)
    raise AssertionError("Session snapshot was not saved")


def same(a, b, path="state"):
    if isinstance(a, (float, int)) and not isinstance(a, bool):
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-7), (path, a, b)
    elif isinstance(a, dict):
        assert a.keys() == b.keys(), (path, a.keys(), b.keys())
        for key in a:
            same(a[key], b[key], path + "." + key)
    elif isinstance(a, list):
        assert len(a) == len(b), (path, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}[{i}]")
    else:
        assert a == b, (path, a, b)


async def ready(page, block=None):
    await page.wait_for_function(
        "window.viewerDiagnostics?.().atoms.length>0 && !window.viewerDiagnostics().session.suspended",
        timeout=20000,
    )
    if block:
        await page.wait_for_function(
            "(b)=>window.viewerDiagnostics().block===b", arg=block
        )
    await settle(page)


async def run(profile):
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            profile, channel="chrome", viewport={"width": 1440, "height": 900}
        )
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL + "/?example=forsterite")
        await ready(page)
        # Broad appearance plus one copy, using the normal target picker.
        await page.locator("#style-open").click()
        await page.locator("#style-target").select_option("element:Mg")
        await page.locator('[data-color="#668df3"]').click()
        await page.locator("#style-size").press("ArrowRight")
        await page.locator("#style-pick").click()
        picked = False
        for a in (await diagnostics(page))["atoms"]:
            if await page.evaluate(
                '([x,y])=>document.elementFromPoint(x,y)?.tagName==="CANVAS"',
                [a["x"], a["y"]],
            ):
                await page.mouse.click(a["x"], a["y"])
                await settle(page)
                if (await page.locator("#style-target").input_value()).startswith(
                    "atom:"
                ):
                    picked = True
                    break
        assert picked
        await page.locator('[data-color="#efa04c"]').click()
        await page.locator("#style-size").press("ArrowRight")
        # Repeated cells, customized plane, arrow, labels and symmetry.
        await page.locator("#mode-extent").click()
        await page.locator("#range-c-max").fill("2")
        await page.locator("#range-c-max").press("Enter")
        await choose_tool(page, "#mode-lattice")
        await page.locator("#plane-add").click()
        row = page.locator("[data-plane-id]").first
        await change(row.locator("[data-field=hkl]"), "1 1 0")
        await change(row.locator("[data-field=m]"), 0.75)
        await row.locator("[data-field=size]").press("End")
        await row.locator("[data-field=opacity]").press("End")
        await page.locator("#lattice-label-offsets").uncheck()
        await page.locator("#plane-label-position").select_option("edge")
        await choose_tool(page, "#mode-directions")
        await page.locator("#arrow-add").click()
        arrow = page.locator("[data-arrow-id]").first
        await change(arrow.locator("[data-field=uvw]"), "1 1 0")
        await change(arrow.locator("[data-field=origin]"), ".2 .3 .4")
        await choose_tool(page, "#mode-symmetry")
        await page.locator("#sym-toggle").check()
        await page.locator("#mode-sites").click()
        await page.locator("#labels-toggle").check()
        await page.locator("#turn-open").click()
        await page.locator("#turn-preset-10").click()
        await page.locator("#turn-right").click()
        await page.locator("#turn-close").click()
        canvas = await page.locator("#viewport canvas").bounding_box()
        x = canvas["x"] + canvas["width"] * 0.55
        y = canvas["y"] + canvas["height"] * 0.55
        await page.mouse.move(x, y)
        await page.mouse.down(button="right")
        await page.mouse.move(x + 31, y + 17, steps=5)
        await page.mouse.up(button="right")
        await settle(page)
        # Export preferences and the typed direction text are settings too.
        await page.locator(".view-directions details summary").click()
        await page.locator("#view-direction").fill("1 -2 1")
        await page.keyboard.press("Escape")
        await page.locator("#mode-export").click()
        await page.locator("#export-dpi").fill("600")
        await page.locator("#export-background").select_option("transparent")
        await page.locator('input[name=export-scale][value="4"]').check()
        await page.locator("#export-seconds").select_option("4")
        await page.locator("#export-fps").select_option("24")
        await reveal_control(page, "#session-save")
        await page.locator("#session-save").click()
        await page.wait_for_timeout(200)
        # Leave Style active; autosave must preserve it without opening Export again.
        await page.locator("#style-open").click()
        before = await wait_record(page, lambda r: r["state"]["panels"][-1] == "style")
        before_pose = (await diagnostics(page))["camera"]
        assert (
            before["state"]["appearance"]["atoms"]
            and before["state"]["appearance"]["elements"]
        )
        await context.close()
        context = await p.chromium.launch_persistent_context(
            profile, channel="chrome", viewport={"width": 1440, "height": 900}
        )
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL + "/?example=forsterite")
        await ready(page)
        await page.wait_for_function("window.viewerDiagnostics().session.restoredAt>0")
        after = await wait_record(page, lambda r: r["savedAt"] > before["savedAt"])
        same(before["state"], after["state"])
        same(before_pose, (await diagnostics(page))["camera"], "camera")
        assert not (await diagnostics(page))["turn"]["open"]
        assert await page.locator("#style-editor").is_visible()
        assert (
            await page.locator("#style-target").input_value()
            == before["state"]["styleTarget"]
        )
        assert await page.locator("#style-reset").inner_text() == "Reset atom"
        await page.locator("#style-reset").click()
        assert (await diagnostics(page))["appearance"]["atomOverrides"] == 0
        print(
            "Full viewer state, per-copy appearance and exact view survived browser restart",
            flush=True,
        )
        # Imported data on an example URL wins on reload; ABC order must survive.
        await page.locator("#file").set_input_files(
            {
                "name": "angle-session.cif",
                "mimeType": "text/plain",
                "buffer": ANGLE_CIF.encode(),
            }
        )
        await ready(page, "angle")
        await page.locator("#mode-pairs").click()
        await page.locator("#measure-angle").click()
        await page.locator("#view-c").click()
        await settle(page)
        for label in ["A", "B", "C"]:
            atom = next(
                a for a in (await diagnostics(page))["atoms"] if a["label"] == label
            )
            await page.mouse.click(atom["x"], atom["y"])
            await settle(page)
        original = await diagnostics(page)
        assert math.isclose(original["angle"], 90)
        await page.locator("#mode-export").click()
        await reveal_control(page, "#session-save")
        await page.locator("#session-save").click()
        await wait_record(
            page,
            lambda r: r["state"]["block"] == "angle"
            and len(r["state"]["measure"]["keys"]) == 3,
        )
        await page.reload()
        await ready(page, "angle")
        restored = await diagnostics(page)
        assert [x["label"] for x in restored["selectedSites"]] == ["A", "B", "C"]
        assert math.isclose(restored["angle"], 90)
        assert restored["measureMode"] == "angle"
        print(
            "Imported CIF and ordered90° measurement restored on the same example URL",
            flush=True,
        )
        # Explicit different route starts that requested example and its new defaults.
        await page.goto(URL + "/?example=wollastonite")
        await ready(page)
        assert "wollaston" in (await diagnostics(page))["block"].lower()
        # The example intentionally shows Si–O chains only. Opening its
        # CIF normally also generates the default Ca–O rule.
        await page.locator("#file").set_input_files(
            Path(__file__).resolve().parents[1] / "public/examples/wollastonite.cif"
        )
        await page.wait_for_function("document.querySelector('#source').textContent.includes('wollastonite.cif')")
        await ready(page)
        ca = None
        for row in await page.locator("#pair-rules .pair-rule").all():
            if await row.locator("[data-field=center]").input_value() == "Ca":
                ca = row
                break
        assert (
            ca is not None
            and 2.6 < float(await ca.locator("[data-field=cutoff]").input_value()) < 2.9
        )
        await page.locator("#mode-export").click()
        page.once("dialog", lambda dialog: dialog.accept())
        async with page.expect_navigation():
            await reveal_control(page, "#session-fresh")
            await page.locator("#session-fresh").click()
        await ready(page)
        assert "wollaston" in (await diagnostics(page))["block"].lower()
        assert (await diagnostics(page))["session"]["restoredAt"] == 0
        assert not errors, errors
        print(
            "Explicit example navigation, estimated Ca–O default and Start fresh passed",
            flush=True,
        )
        await context.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="viewer-state-test-") as profile:
        asyncio.run(run(profile))
