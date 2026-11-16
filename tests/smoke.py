"""Real-rendering smoke tests. Run with a Vite server on :4178.

Requires Playwright Python and installed Chromium/WebKit. Override VIEWER_URL.
Diagnostics are read only: all interaction uses real pointer/touch events.
"""
import asyncio
import itertools
import json
import math
import os
from pathlib import Path
import time
from playwright.async_api import async_playwright

URL = os.environ.get('VIEWER_URL', 'http://127.0.0.1:4178')
HERE = Path(__file__).resolve().parent

async def diagnostics(page):
    return await page.evaluate('window.viewerDiagnostics()')

async def settle(page):
    await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')

async def pair(page):
    d = await diagnostics(page)
    atoms = d['atoms']
    # Pick boundary copies of exactly the same crystallographic site. Their
    # separation is an independently known cell edge, not a minimum-image value.
    for a, b in itertools.combinations(atoms, 2):
        if a['element'] != 'Na' or b['element'] != 'Na':
            continue
        distance = math.dist(a['cartesian'], b['cartesian'])
        if abs(distance - 4) > 1e-7:
            continue
        if math.dist([a['x'],a['y']], [b['x'],b['y']]) < 30:
            continue
        visible = True
        for target in (a,b):
            if not (25 < target['x'] < 1000 and 25 < target['y'] < 730):
                visible = False
            # Avoid overlapping projections which could make picking ambiguous.
            if any(other['id'] != target['id'] and math.dist([target['x'],target['y']], [other['x'],other['y']]) < 22 for other in atoms):
                visible = False
        if visible:
            return a,b
    raise AssertionError('No unobscured periodic Na pair separated by the 4 Å cell edge')

async def run_browser(browser_type, touch=False):
    started = time.monotonic()
    options = {}
    # This workspace may have browser builds from an earlier Playwright release.
    override = os.environ.get(browser_type.name.upper() + '_EXECUTABLE')
    if override:
        options['executable_path'] = override
    elif not Path(browser_type.executable_path).exists():
        cache = Path.home()/'Library/Caches/ms-playwright'
        pattern = 'chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' if browser_type.name == 'chromium' else 'webkit-*/pw_run.sh'
        candidates = sorted(cache.glob(pattern))
        if candidates:
            options['executable_path'] = str(candidates[-1])
    browser = await browser_type.launch(**options)
    context = await browser.new_context(viewport={'width':1024 if touch else 1200,'height':768 if touch else 800}, has_touch=touch, device_scale_factor=1)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function('typeof window.viewerDiagnostics === "function" && window.viewerDiagnostics().atoms.length > 0')
    await page.locator('#file').set_input_files(HERE/'known-distance.cif')
    await page.wait_for_function("window.viewerDiagnostics().block === 'periodic_distance'")
    await settle(page)
    loaded = await diagnostics(page)
    assert len(loaded['atoms']) == 9, loaded
    assert sorted(round(math.sqrt(sum(v*v for v in axis)), 6) for axis in loaded['basis']) == [4,5,6], loaded
    await page.locator('#measure-distance').click()
    a,b = await pair(page)
    for atom in (a,b):
        if touch:
            await page.touchscreen.tap(atom['x'], atom['y'])
        else:
            await page.mouse.click(atom['x'], atom['y'])
    await settle(page)
    d = await diagnostics(page)
    assert len(d['selectedIds']) == 2, d
    assert abs(float(d['distance']) - 4) < 1e-5, d
    assert '4.000' in await page.locator('#distance').inner_text()
    await page.locator('#clear').click()
    before = (await diagnostics(page))['camera']
    canvas = page.locator('canvas').first
    box = await canvas.bounding_box()
    cx,cy = box['x']+box['width']*.5, box['y']+box['height']*.5
    await page.mouse.move(cx,cy)
    await page.mouse.down()
    await page.mouse.move(cx+85,cy+45, steps=12)
    await page.mouse.up()
    await settle(page)
    after = (await diagnostics(page))['camera']
    assert before != after, 'Drag did not rotate camera'
    assert not (await diagnostics(page))['selectedIds'], 'Drag incorrectly picked an atom'
    await page.mouse.wheel(0,250)
    await settle(page)
    assert after != (await diagnostics(page))['camera'], 'Wheel did not zoom camera'
    if browser_type.name == 'chromium':
        # Browser-native multi-touch, not synthetic dispatchEvent. Start a pinch
        # directly on an atom to catch accidental first/last-finger selection.
        a,_ = await pair(page)
        session = await context.new_cdp_session(page)
        camera = (await diagnostics(page))['camera']
        x,y = a['x'],a['y']
        points = lambda delta: [{'x':x-delta,'y':y,'id':1}, {'x':x+delta,'y':y,'id':2}]
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':points(10)})
        for delta in (15,22,30,40):
            await session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':points(delta)})
        await session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        await settle(page)
        d = await diagnostics(page)
        assert camera != d['camera'], 'Pinch did not zoom camera'
        assert not d['selectedIds'], 'Pinch incorrectly picked an atom'
        camera = d['camera']
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':cx,'y':cy,'id':1}]})
        for offset in (10,25,45,65):
            await session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':cx+offset,'y':cy+offset/2,'id':1}]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        await settle(page)
        d = await diagnostics(page)
        assert camera != d['camera'], 'Single-touch drag did not rotate camera'
        assert not d['selectedIds'], 'Single-touch drag incorrectly picked an atom'
    assert not errors, errors
    result = {'browser':browser_type.name,'touch':touch,'seconds':round(time.monotonic()-started,2),'atoms':len(d['atoms']),'known_distance_A':4,'page_errors':errors}
    await browser.close()
    return result

async def main():
    async with async_playwright() as p:
        for browser_type,touch in ((p.chromium,False),(p.chromium,True),(p.webkit,True)):
            print(json.dumps(await run_browser(browser_type,touch)), flush=True)

if __name__ == '__main__':
    asyncio.run(main())
