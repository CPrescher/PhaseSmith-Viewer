"""Exact cutoff entry using real focus and typing, not replacing fill()."""
import asyncio
import os
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle

async def check(browser, width, height, touch):
    page = await browser.new_page(viewport={"width": width, "height": height}, has_touch=touch)
    await page.goto(URL + '/?example=forsterite')
    await page.wait_for_function('window.viewerDiagnostics?.().coordination.polyhedronCount === 12')
    await choose_tool(page, '#mode-pairs')
    row = page.locator('.pair-rule').first
    field = row.locator('[data-field=cutoff]')
    async def focus():
        if touch:
            if await field.get_attribute('aria-expanded') == 'false':
                await field.tap()
                assert not await field.evaluate('e => document.activeElement === e')
            await field.tap()
        else:
            await field.click()
        await settle(page)
        selection = await field.evaluate('e => [document.activeElement === e, e.selectionStart, e.selectionEnd, e.value]')
        assert selection[:3] == [True, 0, len(selection[3])], selection
    async def applied(expected):
        await settle(page)
        assert float(await field.input_value()) == expected
        assert (await diagnostics(page))['coordination']['rules'][0]['cutoff'] == expected
    await focus()
    await page.keyboard.type('2.5')
    await page.keyboard.press('Enter')
    await applied(2.5)
    assert not await field.evaluate('e => document.activeElement === e')
    await focus()
    await page.keyboard.type('1.80.5')
    await page.keyboard.press('Enter')
    await applied(2.5)
    assert 'Kept 2.50' in await row.locator('[role=status]').inner_text()
    await focus()
    await page.keyboard.type('2.1')
    await page.keyboard.press('Tab')
    await applied(2.1)
    assert not await row.locator('[role=status]').is_visible()
    await focus()
    await page.keyboard.type('bad')
    await page.keyboard.press('Tab')
    await applied(2.1)
    assert 'Kept 2.10' in await row.locator('[role=status]').inner_text()
    await focus()
    # A subsequent tap still permits deliberate insertion within the value.
    if not touch:
        await field.click()
        assert await field.evaluate('e => e.selectionStart === e.selectionEnd')
    await page.close()
    print(f'{width}x{height} touch={touch}: replacement, Enter/blur, invalid recovery and caret pass', flush=True)

async def main():
    async with async_playwright() as p:
        for engine in ['chromium','webkit']:
            if engine == 'chromium':
                browser = await p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL','chrome'), args=['--enable-unsafe-swiftshader'])
            else:
                options = {'executable_path':os.environ['WEBKIT_EXECUTABLE']} if os.environ.get('WEBKIT_EXECUTABLE') else {}
                browser = await p.webkit.launch(**options)
            for w,h,t in [(1440,900,False),(390,844,True),(375,667,True)]:
                await check(browser,w,h,t)
            await browser.close()
            print(engine,'passed',flush=True)

if __name__ == '__main__': asyncio.run(main())
