"""Atom picks and explicit equivalent-site selection remain distinct."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle, choose_tool

async def check(browser, width, height, touch):
    page = await browser.new_page(viewport={'width': width, 'height': height}, has_touch=touch)
    await page.goto(URL)
    await page.wait_for_function('window.viewerDiagnostics?.().atoms.length > 0')
    await choose_tool(page, '#mode-sites')
    camera = (await diagnostics(page))['camera']
    async def pick():
        atom = await page.evaluate('''() => viewerDiagnostics().atoms.find(a =>
            a.visible && document.elementFromPoint(a.x,a.y)?.tagName === 'CANVAS')''')
        assert atom, 'No exposed atom to pick'
        await (page.touchscreen.tap(atom['x'],atom['y']) if touch else page.mouse.click(atom['x'],atom['y']))
        await settle(page)
        d = await diagnostics(page)
        assert len(d['selectedIds']) == 1
        assert d['selectionObjectCount'] == 1
        assert d['highlightedSite'] is None
        assert await page.locator('#site-table tr.selected').count() == 0
        assert d['camera'] == camera
        return d['atomInfo']['label']
    label = await pick()
    row = page.locator(f'#site-table tr[data-site="{label}"]')
    await (row.tap() if touch else row.click())
    d = await diagnostics(page)
    assert d['highlightedSite'] == label
    assert sum(a['label'] == label and a['visible'] for a in d['atoms']) > 1
    assert not d['selectedIds'] and d['selectionObjectCount'] == 0
    assert d['atomInfo'] is None
    assert await row.evaluate("e => e.classList.contains('selected')")
    assert 'CN 6' in await page.locator('#shell-summary').inner_text()
    assert d['camera'] == camera
    # A site row must inspect a central copy, even though the rendered atom
    # list begins at the boundary. Measure in Cartesian space for skew cells.
    middle = [sum(r) / 2 for r in d['ranges']]
    center = [sum(middle[j] * d['basis'][j][i] for j in range(3)) for i in range(3)]
    copies = [a for a in d['atoms'] if a['label'] == label and a['visible']]
    distance2 = lambda a: sum((a['cartesian'][i] - center[i]) ** 2 for i in range(3))
    shell_center = next(a for a in copies if a['id'] == d['shellCenterId'])
    assert abs(distance2(shell_center) - min(map(distance2, copies))) < 1e-8
    await page.locator('#shell-outline').uncheck()
    await page.locator('#shell-outline').check()
    assert (await diagnostics(page))['shellCenterId'] == shell_center['id']
    # Picking with a group already highlighted must remove every old group halo.
    await pick()
    # Keyboard row activation follows the same explicit group-selection path.
    await row.focus()
    await row.press('Enter')
    d = await diagnostics(page)
    assert d['highlightedSite'] == label and not d['selectedIds']
    await row.press('Enter')
    assert (await diagnostics(page))['highlightedSite'] is None
    await page.close()
    print(f'{width}x{height}: one atom, equivalent-site row, atom after group, keyboard toggle; camera fixed',flush=True)

async def main():
    async with async_playwright() as p:
        for engine in ['chromium','webkit']:
            browser = await (p.chromium.launch(channel='chrome') if engine == 'chromium' else
                p.webkit.launch(executable_path=str(sorted((Path.home()/'Library/Caches/ms-playwright').glob('webkit-*/pw_run.sh'))[-1])))
            for w,h,t in [(1440,900,False),(390,844,True),(375,667,True)]:
                await check(browser,w,h,t)
            await browser.close()
            print(engine,'passed',flush=True)

if __name__ == '__main__': asyncio.run(main())
