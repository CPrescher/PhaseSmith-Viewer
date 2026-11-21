"""Capture real viewer controls in both themes; never reconstruct the UI.

Serve a production viewer build first. Requires tests/requirements-browser.txt.
VIEWER_URL=http://127.0.0.1:4193/PhaseSmith-Viewer BROWSER_CHANNEL=chrome python scripts/capture-docs.py
"""
import asyncio
import json
import math
import os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/guide/public/images'
URL = os.environ.get('VIEWER_URL', 'http://127.0.0.1:4193/PhaseSmith-Viewer').rstrip('/')
figures = json.loads((ROOT / 'docs/.vitepress/theme/figures.json').read_text())


async def rect(page, selectors, pad=8):
    boxes = [await page.locator(s).bounding_box() for s in selectors]
    assert all(boxes), selectors
    x = max(0, math.floor(min(b['x'] for b in boxes) - pad))
    y = max(0, math.floor(min(b['y'] for b in boxes) - pad))
    right = min(page.viewport_size['width'], math.ceil(max(b['x'] + b['width'] for b in boxes) + pad))
    bottom = min(page.viewport_size['height'], math.ceil(max(b['y'] + b['height'] for b in boxes) + pad))
    return {'x': x, 'y': y, 'width': right - x, 'height': bottom - y}


async def capture(page, name, selectors=None, labels=(), regions=(), display=740, after_theme=None):
    clip = await rect(page, selectors) if selectors else {'x':0,'y':0,**page.viewport_size}
    meta = {'width':clip['width'], 'height':clip['height'], 'display':display}
    if labels:
        meta['labels'] = []
        for selector, label in labels:
            b = await page.locator(selector).bounding_box()
            meta['labels'].append({'x':b['x'] + b['width']/2 - clip['x'], 'y':b['y']+b['height']-clip['y'], 'text':label})
    if regions:
        meta['regions'] = []
        for i, (selectors, label) in enumerate(regions):
            b = await rect(page, selectors, pad=3)
            meta['regions'].append({**b,'number':i+1,'text':label})
    figures[name] = meta
    (ROOT / 'docs/.vitepress/theme/figures.json').write_text(json.dumps(figures,indent=2)+'\n')
    menu_open = 'menu-open' in (await page.locator('#tool-rail').get_attribute('class') or '')
    file_open = await page.locator('#file-menu:popover-open').count() > 0
    # Toggle on the SAME page to preserve camera, selections and panel scroll.
    for theme in ['light','dark']:
        if await page.locator('html').get_attribute('data-theme') != theme:
            plot_open = await page.locator('#analysis-window').get_attribute('open') is not None
            plot_mode = await page.locator('#analysis-mode').input_value()
            if plot_open:
                await page.locator('#analysis-close').click()
            await page.locator('#theme-toggle').click()
            if plot_open:
                await page.locator('#mode-powder' if plot_mode == 'powder' else '#mode-analysis').click()
                await page.wait_for_function("document.querySelector('#analysis-table tbody tr')")
            if menu_open and 'menu-open' not in (await page.locator('#tool-rail').get_attribute('class') or ''):
                await page.locator('#tools-menu').click()
            if file_open and not await page.locator('#file-menu:popover-open').count():
                await page.locator('#file-menu-button').click()
        if after_theme:
            await after_theme(page)
        await page.mouse.move(2, page.viewport_size['height'] - 2)
        await page.wait_for_timeout(300)
        assert await page.locator('html').get_attribute('data-theme') == theme
        await page.screenshot(path=str(OUT / f'{name}-{theme}.png'), clip=clip)
    print(name, flush=True)


async def main():
    async with async_playwright() as p:
        options = {'args':['--enable-unsafe-swiftshader']}
        if os.environ.get('BROWSER_CHANNEL'):
            options['channel'] = os.environ['BROWSER_CHANNEL']
        browser = await p.chromium.launch(**options)
        async def scene(phone=False, example='forsterite'):
            page = await browser.new_page(viewport={'width':390 if phone else 1280,'height':844 if phone else 800}, device_scale_factor=2, color_scheme='light', has_touch=phone, is_mobile=phone)
            await page.goto(URL + '/' + ('?example='+example if example else ''))
            await page.wait_for_function('window.viewerDiagnostics?.().atoms.length > 0 && !window.viewerDiagnostics().session.suspended')
            return page
        page = await scene()
        await capture(page, 'interface', regions=[
            (['#library-open','#open','#file-menu-button'],'Library, Open file and project menu'),
            (['.view-directions'],'View directions and Turn'),
            (['.measure-row'],'Info, Distance, Angle and Clear'),
            (['#tool-rail'],'Tool rail'),
            (['.atoms-bar'],'Visibility, elements and sphere size'),
        ])
        await capture(page, 'measurements', ['.measure-row'], labels=[('#measure-info','Info'),('#measure-distance','Distance'),('#measure-angle','Angle'),('#clear','Clear')], display=520)
        await capture(page, 'view-controls', ['.view-directions'], display=600)
        await capture(page, 'file-controls', ['#library-open','#open','#file-menu-button'], labels=[('#library-open','Library'),('#open','Open file'),('#file-menu-button','Project menu')], display=420)
        await capture(page, 'visibility', ['.atoms-bar'], labels=[('label:has(#show-atoms)','Atoms'),('label:has(#show-polyhedra)','Polyhedra'),('#elements','Elements'),('#size','Size')], display=620)
        await page.locator('#mode-pairs').click()
        await capture(page,'forsterite')
        await capture(page,'pairs',['#tool-window-pairs'],display=420)
        for name, button in [('sites','#mode-sites'),('extent','#mode-extent'),('appearance','#style-open'),('lattice','#mode-lattice'),('export','#mode-export')]:
            await page.locator(button).click()
            if name == 'lattice':
                await page.locator('#plane-add').click()
            tool = 'style' if name == 'appearance' else name
            await capture(page,name,[f'#tool-window-{tool}'],display=420)
            if name == 'export':
                await page.locator('#file-menu-button').click()
                await capture(page,'project',['#file-menu'],display=420)
                await page.keyboard.press('Escape')
        await page.close()
        page=await scene(example='')
        await page.locator('#mode-analysis').click()
        await page.wait_for_function("document.querySelector('#analysis-table tbody tr')")
        await capture(page,'pair-distances',['#analysis-window'],display=680)
        await page.locator('#mode-powder').click()
        await page.wait_for_function("document.querySelector('#analysis-table th')?.textContent === '2θ (°)'")
        await capture(page,'powder',['#analysis-window'],display=680)
        await page.close()
        page=await scene(phone=True)
        await capture(page,'phone', regions=[
            (['.measure-row'],'Measurement buttons at the upper right'),
            (['#tools-menu'],'Tools button at the lower right'),
        ],display=320)
        await page.locator('#tools-menu').click()
        await capture(page,'phone-tools',['#tool-rail','#tools-menu'],display=360)
        await page.close()
        await browser.close()
    (ROOT / 'docs/.vitepress/theme/figures.json').write_text(json.dumps(figures,indent=2)+'\n')

if __name__ == '__main__':
    asyncio.run(main())
