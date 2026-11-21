"""Capture verified checkpoints of the worked examples in both themes.

Run against a production viewer with VIEWER_URL and optional BROWSER_CHANNEL.
Reuses capture-docs.py so both scripts preserve the shared figure catalog.
"""
import asyncio
import csv
import importlib.util
import io
import os
from pathlib import Path
from playwright.async_api import async_playwright

spec = importlib.util.spec_from_file_location('capture_docs', Path(__file__).with_name('capture-docs.py'))
shots = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shots)


async def state(page):
    return await page.evaluate('window.viewerDiagnostics()')


async def change(field, value):
    await field.fill(str(value))
    await field.press('Enter')


async def main():
    async with async_playwright() as p:
        options = {'args': ['--enable-unsafe-swiftshader']}
        if os.environ.get('BROWSER_CHANNEL'):
            options['channel'] = os.environ['BROWSER_CHANNEL']
        browser = await p.chromium.launch(**options)
        errors = []
        async def scene(example=''):
            page = await browser.new_page(viewport={'width':1280,'height':800}, device_scale_factor=2, color_scheme='light')
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(shots.URL + '/' + ('?example='+example if example else ''))
            await page.wait_for_function('window.viewerDiagnostics?.().atoms.length > 0 && !window.viewerDiagnostics().session.suspended')
            return page
        async def capture(page, name, **options):
            if name.startswith('forsterite-') and name != 'forsterite-sites':
                await page.locator('[id^="pair-count-"]').last.scroll_into_view_if_needed()
            await page.wait_for_timeout(350)
            await shots.capture(page, 'tutorial-'+name, **options)

        page = await scene('forsterite')
        await page.locator('#mode-pairs').click()
        rules=page.locator('#pair-rules .pair-rule')
        si, mg=rules.nth(0), rules.nth(1)
        assert (await state(page))['coordination']['polyhedronCount'] == 12
        await capture(page,'forsterite-start')
        await mg.locator('[data-field=polyhedra]').uncheck()
        assert (await state(page))['coordination']['rules'][0]['counts'] == [4]
        await capture(page,'forsterite-silicon')
        await mg.locator('[data-field=polyhedra]').check()
        await si.locator('[data-field=polyhedra]').uncheck()
        assert (await state(page))['coordination']['rules'][1]['counts'] == [6]
        await capture(page,'forsterite-magnesium')
        # Restore both pairs so the inspector includes Si, Mg1 and Mg2.
        await si.locator('[data-field=polyhedra]').check()
        await page.locator('#mode-sites').click()
        await page.locator('#poly-table').scroll_into_view_if_needed()
        table = await page.locator('#poly-table').inner_text()
        assert all(value in table for value in ('11.787','12.392','2.208')), table
        await capture(page,'forsterite-sites')
        await page.locator('#mode-pairs').click()
        await change(mg.locator('[data-field=cutoff]'),2.15)
        assert (await state(page))['coordination']['rules'][1]['siteCounts'] == {'Mg1':[6],'Mg2':[3]}
        await capture(page,'forsterite-short-cutoff')
        await change(mg.locator('[data-field=cutoff]'),2.30)
        assert (await state(page))['coordination']['rules'][1]['siteCounts'] == {'Mg1':[6],'Mg2':[6]}
        await capture(page,'forsterite-restored')
        await page.close()

        page=await scene('wollastonite')
        await page.locator('#mode-extent').click()
        assert (await state(page))['ranges'][1] == [0,3]
        await capture(page,'wollastonite-three-cells')
        await change(page.locator('#range-b-max'),1)
        assert (await state(page))['ranges'][1] == [0,1]
        await capture(page,'wollastonite-one-cell')
        await change(page.locator('#range-b-max'),3)
        assert (await state(page))['ranges'][1] == [0,3]
        # A repeatable small tilt, using the visible Turn controls.
        await page.locator('#turn-open').click()
        await page.locator('#turn-preset-10').click()
        await page.locator('#turn-up').click()
        await page.keyboard.press('Escape')
        await capture(page,'wollastonite-tilted')
        await page.close()

        page=await scene()
        await page.locator('#file').set_input_files(shots.ROOT / 'public/example.cif')
        await page.wait_for_function('window.viewerDiagnostics().atoms.length > 0 && !window.viewerDiagnostics().session.suspended')
        await capture(page,'rock-salt-start')
        await page.locator('#mode-lattice').click()
        await page.locator('#plane-add').click()
        plane=page.locator('[data-plane-id]').first
        await change(plane.locator('[data-field=hkl]'),'1 1 1')
        await change(plane.locator('[data-field=m]'),0)
        await plane.locator('[data-field=family]').check()
        # The default oblique view already shows the parallel planes.
        first=(await state(page))['lattice']['planes'][0]
        assert first['hkl'] == [1,1,1] and first['m'] == 0 and first['family']
        await capture(page,'planes-111')
        await change(plane.locator('[data-field=hkl]'),'2 2 2')
        second=(await state(page))['lattice']['planes'][0]
        assert second['hkl'] == [2,2,2] and second['m'] == 0 and second['family']
        assert abs(second['d']*2-first['d']) < 1e-9
        await capture(page,'planes-222')
        await page.locator('#mode-lattice').click()
        await page.locator('#mode-powder').click()
        await page.wait_for_function("document.querySelector('#analysis-table th')?.textContent === '2θ (°)' && document.querySelector('#analysis-chart .analysis-profile')")
        await capture(page,'powder-settings',selectors=['#analysis-window'],display=680)
        await page.locator('#analysis-fwhm').fill('0')
        await page.wait_for_function("document.querySelector('#analysis-table tbody tr') && !document.querySelector('#analysis-chart .analysis-profile')")
        async def select_first(page):
            await page.locator('#analysis-table tbody tr').first.click()
            assert '3.256' in await page.locator('#analysis-detail').inner_text()
        await capture(page,'powder-sticks',selectors=['#analysis-window'],display=680,after_theme=select_first)
        await page.locator('#analysis-fwhm').fill('0.15')
        await page.wait_for_function("document.querySelector('#analysis-chart .analysis-profile')")
        await capture(page,'powder-broadened',selectors=['#analysis-window'],display=680,after_theme=select_first)
        async with page.expect_download() as download:
            await page.locator('#analysis-csv').click()
        data=await download.value
        rows=list(csv.reader(io.StringIO(Path(await data.path()).read_text())))
        assert len(rows)>2 and 'intensity' in ','.join(rows[0]).lower(), rows[:2]
        print('CSV columns:', rows[0], 'first line:', rows[1], flush=True)
        await page.close()
        assert not errors, errors
        await browser.close()
    print('All tutorial checkpoints verified.',flush=True)

if __name__ == '__main__':
    asyncio.run(main())
