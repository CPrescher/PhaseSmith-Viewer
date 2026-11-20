"""Bundled library: selection, source links, restore, failures and phone layout."""
import asyncio
import os
from playwright.async_api import async_playwright, expect
from smoke import choose_tool

URL = os.environ.get('VIEWER_URL', 'http://127.0.0.1:4193').rstrip('/')


async def ready(page):
    await page.wait_for_function(
        'window.viewerDiagnostics?.().atoms.length > 0 && !window.viewerDiagnostics().session.suspended',
        timeout=45000,
    )


async def main():
    async with async_playwright() as p:
        options = {'args': ['--enable-unsafe-swiftshader']}
        if os.environ.get('CI'):
            options['args'] += ['--use-gl=angle', '--use-angle=swiftshader-webgl']
        if os.environ.get('BROWSER_CHANNEL'):
            options['channel'] = os.environ['BROWSER_CHANNEL']
        browser = await p.chromium.launch(**options)
        for phone in [False, True]:
            page = await browser.new_page(
                viewport={'width': 390 if phone else 1200, 'height': 844 if phone else 900},
                is_mobile=phone, has_touch=phone,
            )
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto(URL + '/')
            await ready(page)
            await page.locator('#library-open').click()
            await expect(page.locator('#library-search')).to_be_focused()
            await expect(page.locator('.library-select')).to_have_count(52)
            await page.locator('#library-search').fill('zinc blende')
            await expect(page.locator('[data-structure="sphalerite"]')).to_be_visible()
            await page.locator('#library-search').fill('not-a-mineral')
            await expect(page.locator('.library-empty')).to_be_visible()
            await page.locator('#library-search').fill('')
            await page.locator('#library-collection').select_option('types')
            await expect(page.locator('.library-select')).to_have_count(29)
            await page.locator('#library-search').fill('quartz')
            await page.locator('.library-reference summary').click()
            await expect(page.locator('.library-reference a').first).to_have_attribute('href', 'https://www.crystallography.net/cod/5000035.html')
            await page.screenshot(path=f"/tmp/viewer-library-{'phone' if phone else 'desktop'}.png")
            assert not await page.evaluate('document.scrollingElement.scrollWidth > innerWidth')
            assert await page.locator('#structure-library').evaluate('e => e.scrollWidth <= e.clientWidth')
            await page.keyboard.press('Escape')
            await expect(page.locator('#library-open')).to_be_focused()
            await page.locator('#library-open').click()
            await page.locator('[data-structure="quartz"]').click()
            await expect(page.locator('#name')).to_have_text('Quartz (alpha)')
            await expect(page.locator('#structure-library')).not_to_be_visible()
            await expect(page.locator('#source a')).to_have_attribute('href', 'https://www.crystallography.net/cod/5000035.html')
            info = page.locator('#structure-info')
            await page.get_by_role('button', name='Structure info for Quartz', exact=False).click()
            await expect(info).to_be_visible()
            await expect(page.locator('#info-cell')).to_contain_text('5.40385 ± 0.00007 Å')
            await expect(page.locator('#info-symmetry')).to_contain_text('Trigonal')
            await expect(page.locator('#info-symmetry')).to_contain_text('154')
            await expect(page.locator('#info-source a')).to_have_attribute('href', 'https://www.crystallography.net/cod/5000035.html')
            assert await info.evaluate('e => e.scrollWidth <= e.clientWidth')
            await page.keyboard.press('Escape')
            await expect(page.locator('#structure-info-open')).to_be_focused()
            assert await page.evaluate('new Set(window.viewerDiagnostics().atoms.map(a => a.element)).size') == 2
            await choose_tool(page, '#mode-export', phone)
            await page.locator('#session-save').click()
            await page.wait_for_timeout(300)
            await page.reload()
            await ready(page)
            await expect(page.locator('#name')).to_have_text('Quartz (alpha)')
            await expect(page.locator('#source a')).to_be_attached()
            # A missing CIF reports a useful error and preserves the old view.
            await page.route('**/structures/rutile.cif', lambda route: route.fulfill(status=404))
            await page.locator('#library-open').click()
            await page.locator('#library-search').fill('rutile')
            await page.locator('[data-structure="rutile"]').click()
            await expect(page.locator('#error')).to_contain_text('Could not open Rutile')
            await expect(page.locator('#name')).to_have_text('Quartz (alpha)')
            await page.unroute('**/structures/rutile.cif')
            await page.goto(URL + '/?structure=cubic-perovskite')
            await ready(page)
            await expect(page.locator('#name')).to_have_text('Ideal cubic perovskite')
            assert not errors, errors
            print(f"{'Phone' if phone else 'Desktop'} library: search, filter, select, reference, restore, failure, and deep link passed", flush=True)
            await page.close()
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
