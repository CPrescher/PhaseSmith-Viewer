"""Check the published guide under the same URL prefix as the viewer."""
import asyncio
import os
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote
from playwright.async_api import async_playwright, expect

URL = os.environ.get('VIEWER_URL', 'http://127.0.0.1:4181/PhaseSmith-Viewer').rstrip('/')
DOCS = URL + '/docs/'


class PageLinks(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.links, self.images, self.ids = [], [], set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag == 'img' and attrs.get('src'):
            self.images.append(attrs['src'])


async def main():
    async with async_playwright() as p:
        options = {'args': ['--enable-unsafe-swiftshader']}
        if os.environ.get('CI'):
            options['args'] += ['--use-gl=angle', '--use-angle=swiftshader-webgl']
        if os.environ.get('BROWSER_CHANNEL'):
            options['channel'] = os.environ['BROWSER_CHANNEL']
        browser = await p.chromium.launch(**options)
        context = await browser.new_context(viewport={'width':1280, 'height':800})
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        page = await context.new_page()
        await page.goto(DOCS)
        await expect(page.locator('h1')).to_contain_text('PhaseSmith Viewer user guide')

        # Crawl actual output links, including anchors and image assets. This
        # catches repository-prefix errors that a root-path preview can hide.
        pending, parsed = [DOCS], {}
        while pending:
            address = pending.pop()
            if address in parsed:
                continue
            response = await context.request.get(address)
            assert response.ok, (address, response.status)
            doc = parsed[address] = PageLinks(await response.text())
            for src in doc.images:
                asset = urljoin(address, src)
                if urlsplit(asset).netloc == urlsplit(DOCS).netloc:
                    response = await context.request.get(asset)
                    assert response.ok, (asset, response.status)
            for href in doc.links:
                target = urljoin(address, href).split('#')[0]
                if target.startswith(DOCS) and (target.endswith('.html') or target.endswith('/')):
                    pending.append(target)
        assert len(parsed) >= 13, len(parsed)
        for address, doc in parsed.items():
            for href in doc.links:
                target = urljoin(address, href)
                path, _, anchor = target.partition('#')
                if path in parsed and anchor:
                    assert unquote(anchor) in parsed[path].ids, (address, target)

        await page.wait_for_load_state('networkidle')
        await page.get_by_role('button', name='Search', exact=True).click()
        await page.locator('#localsearch-input').fill('occupancy')
        result = page.locator('#localsearch-list').get_by_role('link').filter(has_text='Scientific conventions').first
        await expect(result).to_be_visible()
        await result.click()
        await expect(page).to_have_url(DOCS + 'science.html#diffraction')
        await page.reload()
        await expect(page.locator('h1')).to_contain_text('Scientific conventions')
        await page.get_by_role('switch').click()
        assert await page.evaluate("document.documentElement.classList.contains('dark')")

        await page.set_viewport_size({'width':390, 'height':844})
        await page.goto(DOCS)
        await page.get_by_role('button', name='Menu', exact=True).click()
        await page.locator('#VPSidebarNav').get_by_role('link', name='Your first structure', exact=True).click()
        await expect(page.locator('h1')).to_contain_text('Your first structure')
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'Mobile overflow'
        await page.wait_for_load_state('networkidle')
        await page.get_by_role('button', name='Search', exact=True).click()
        await expect(page.locator('#localsearch-input')).to_be_visible()
        await page.keyboard.press('Escape')

        # The mobile launcher must expose a working Help link without moving
        # the model or losing the current scene to documentation navigation.
        await page.goto(URL + '/')
        await page.wait_for_function('window.viewerDiagnostics?.().atoms.length > 0')
        await page.locator('#tools-menu').click()
        help_link = page.get_by_role('link', name='Documentation (opens in a new tab)', exact=True)
        await expect(help_link).to_be_in_viewport()
        async with context.expect_page() as popup:
            await help_link.click()
        guide = await popup.value
        await expect(guide).to_have_url(DOCS)
        await expect(guide.locator('h1')).to_contain_text('PhaseSmith Viewer user guide')
        assert not errors, errors
        print(f'Documentation: {len(parsed)} pages, anchors, images, search, mobile navigation, theme and viewer Help passed')
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
