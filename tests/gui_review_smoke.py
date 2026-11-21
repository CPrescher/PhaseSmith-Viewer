"""Rendered compact workflows: reachable results, disclosures and linked views."""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, reveal_control, settle

async def hit(locator):
    return await locator.evaluate('''e => {
      const r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
      const t=document.elementFromPoint(x,y);
      return r.width>0 && r.height>0 && y>=0 && y<innerHeight && x>=0 && x<innerWidth && !!t && e.contains(t);
    }''')

async def check(browser,w,h,theme):
    page=await browser.new_page(viewport={'width':w,'height':h},has_touch=True,is_mobile=w<900,color_scheme=theme)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    await page.goto(URL+'/?example=forsterite')
    await page.wait_for_function('window.viewerDiagnostics?.().coordination.polyhedronCount===12')
    initial=await diagnostics(page)
    assert await page.locator('#tool-rail [role=group]').count()==4
    assert await page.locator('#tool-window-export #project-save, #tool-window-export #session-save').count()==0
    await page.locator('#file-menu-button').click()
    assert await hit(page.locator('#project-save'))
    assert await hit(page.locator('#project-open'))
    await page.keyboard.press('Escape')
    assert not await page.locator('#file-menu').is_visible()
    if w==1440:
        await reveal_control(page,'#session-fresh')
        page.once('dialog',lambda dialog:dialog.dismiss())
        await page.locator('#session-fresh').click()
        assert (await diagnostics(page))['camera']==initial['camera'], 'canceling Start fresh must keep the scene'
        await page.keyboard.press('Escape')
    if w>=700 and h>=540:
        assert not await page.locator('#tools-menu').is_visible(), 'duplicate launcher'
        rail=await page.locator('#tool-rail').bounding_box()
        view=await page.locator('#viewport').bounding_box()
        assert rail['y']+rail['height']/2<=view['y']+view['height']/2+1, 'rail may move up from center, not down'
    await choose_tool(page,'#mode-pairs')
    assert await hit(page.locator('[data-field=cutoff]').first)
    assert await hit(page.locator('#add-rule'))
    assert (await diagnostics(page))['camera']==initial['camera']
    await reveal_control(page,'#polyhedra-only')
    assert not await page.locator('#polyhedra-only').is_checked()
    await choose_tool(page,'#mode-sites')
    assert await hit(page.locator('#site-table tbody tr').first), 'Sites must lead with data'
    await choose_tool(page,'#mode-lattice')
    compact_button=page.locator('#tool-window-lattice [data-action=compact]')
    if await compact_button.is_visible():
        before=(await page.locator('#tool-window-lattice').bounding_box())
        pose=(await diagnostics(page))['camera']
        await compact_button.click()
        after=await page.locator('#tool-window-lattice').bounding_box()
        assert after['height']<before['height']-40
        assert (await diagnostics(page))['camera']==pose
        await compact_button.click()
        restored=await page.locator('#tool-window-lattice').bounding_box()
        assert restored==before
    await choose_tool(page,'#mode-extent')
    assert await page.locator('#range-apply').count() == 0
    field = page.locator('#range-a-max')
    await field.fill('2'); await field.press('Enter')
    assert len((await diagnostics(page))['atoms']) == 92
    await field.fill('1'); await field.press('Tab')
    assert len((await diagnostics(page))['atoms']) == 51, 'blur after returning to the original focus value must update the scene'
    if h<500 or w<500:
        for axis in 'abc':
            for bound in ['min','max']:
                assert await hit(page.locator(f'#range-{axis}-{bound}'))
    await choose_tool(page,'#style-open')
    assert await hit(page.locator('#style-swatches button').first), 'Style must expose a color'
    await choose_tool(page,'#mode-export')
    assert await hit(page.locator('#export-png'))
    await page.locator('#tool-window-export [data-action=close]').click()
    await choose_tool(page,'#mode-analysis')
    assert not await page.locator('#analysis-mode').is_visible(), 'mode is chosen from the tool launcher, without a duplicate selector'
    await page.wait_for_selector('#analysis-chart .analysis-stick',state='attached')
    if w==1440:
        assert await hit(page.locator('#show-atoms')) and await hit(page.locator('#size')), 'wide inspectors must leave bottom controls reachable'
    chart=await page.locator('#analysis-chart').bounding_box()
    bottom=await page.locator('#analysis-window').evaluate('e=>e.getBoundingClientRect().bottom')
    assert min(chart['height'],bottom-chart['y'])>=150, (w,h,'chart clipped',chart,bottom)
    await page.locator('#analysis-close').click()
    await choose_tool(page,'#mode-powder')
    await page.wait_for_function("document.querySelector('#analysis-table th')?.textContent==='2θ (°)'")
    assert await page.locator('#analysis-mode').input_value()=='powder'
    await reveal_control(page,'#project-save')
    await page.keyboard.press('Escape')
    assert await page.locator('#analysis-window').is_visible(), 'File dismisses before its underlying plot'
    await page.locator('#analysis-close').click()
    await choose_tool(page,'#mode-reflection')
    if w==1440:
        assert await hit(page.locator('#library-open')) and await hit(page.locator('#structure-info-open')), 'Reflection must leave the desktop header reachable'
    await page.locator('#reflection-hkl').fill('1 3 0')
    await page.locator('#reflection-hkl').press('Enter')
    compact=await page.locator('.reflection-mobile-tabs').is_visible()
    if compact:
        await page.locator('[data-reflection-view=sum]').click()
        await page.locator('#reflection-hkl').fill('1 1 1')
        await page.locator('#reflection-hkl').press('Enter')
        await page.locator('[data-reflection-view=rays]').click()
        assert await page.locator('#reflection-rays line').count()>0
        await page.locator('[data-reflection-view=crystal]').click()
    else:
        await page.locator('[data-panel=rays]').click()
    await page.locator('[data-view=edge]').click()
    await settle(page)
    if await page.locator('#tools-menu').is_visible():
        assert await page.locator('#reflection-explorer #tools-menu').count()==1
        assert await hit(page.locator('#reflection-intensity')), 'intensity must remain unobstructed'
        await page.locator('#tools-menu').click()
        await page.locator('#tool-rail').press('Escape')
        assert await page.locator('#reflection-explorer').is_visible(), 'Escape closes menu before its window'
    assert not await page.evaluate("[...document.querySelectorAll('#reflection-explorer svg *')].some(e=>[...e.attributes].some(a=>/NaN|Infinity/.test(a.value)))")
    await page.locator('#reflection-close').click()
    await choose_tool(page,'#mode-detector')
    if w<500:
        head=await page.locator('#detector-head').bounding_box()
        close=await page.locator('#detector-close').bounding_box()
        assert close['y']<head['y']+12 and close['x']>head['x']+head['width']-65, 'Close must stay at the top right'
        assert await page.locator('#detector-title').evaluate('e=>e.scrollWidth<=e.clientWidth+1'), 'title must wrap before header buttons'
    if h<500 or w<500:
        assert await hit(page.locator('#detector-next')), 'stepping must be visible on opening'
    await page.locator('#detector-animate').uncheck()
    tabs=page.locator('.detector-view-tabs')
    if await tabs.is_visible():
        globe=await page.locator('#detector-ewald .sphere').bounding_box()
        assert globe['width']>=100,(w,h,globe)
        await page.locator('[data-detector-view=image]').click()
        assert await page.locator('#detector-image .sensor').is_visible()
        if h<500:
            before=await page.locator('#detector-image').bounding_box()
            await page.locator('#detector-next').click()
            after=await page.locator('#detector-image').bounding_box()
            assert after==before, 'stepping must keep the detector in view'
            assert await hit(page.locator('#detector-image'))
        # Both diagrams retain valid render data for the combined PNG export.
        assert await page.locator('#detector-ewald .sphere').count()==1
        await page.locator('[data-detector-view=ewald]').click()
    await page.locator('#detector-link').check()
    before=(await diagnostics(page))['camera']
    await page.locator('#detector-reveal').click()
    await settle(page)
    assert (await page.locator('#detector-window').bounding_box())['height']<=320, 'linked dock must override a resized or wide desktop window'
    assert (await diagnostics(page))['camera']==before, 'reveal must not move the crystal'
    exposed=await page.evaluate("viewerDiagnostics().atoms.filter(a=>document.elementFromPoint(a.x,a.y)?.tagName==='CANVAS').length")
    assert exposed>=8,(w,h,exposed)
    if w==1440:
        assert await hit(page.locator('#show-atoms')) and await hit(page.locator('#size')), 'linked dock must leave bottom controls reachable'
    assert await page.locator('#detector-omega').is_visible()
    assert await page.locator('#detector-next').is_visible()
    if w<500:
        for selector in ['#detector-animate', '#detector-ring', '#detector-link']:
            assert await hit(page.locator(selector)), (w,h,'linked option clipped',selector)
        assert (await page.locator('#detector-omega').bounding_box())['height']>=44
    await page.locator('#detector-next').click()
    await page.locator('#detector-reveal').click()
    await page.locator('#detector-open-options').click()
    assert not await page.locator('#detector-options').evaluate('e=>e.matches(":modal")')
    if h<500:
        assert (await page.locator('#detector-options').bounding_box())['width']<=220, 'Options must leave the landscape diagram clear'
    for selector in ['#detector-wedge','#detector-calibration','#detector-mount']:
        await page.locator(selector+' > summary').click()
        assert await hit(page.locator('#detector-options-done'))
    assert await page.locator('#detector-options .analysis-body').evaluate('e=>e.scrollWidth<=e.clientWidth+1'), 'options overflow'
    await page.locator('#detector-options-done').click()
    if await page.locator('#tools-menu').is_visible():
        await page.locator('#tools-menu').click()
        assert await hit(page.locator('#mode-pairs')), 'Tools must be above science windows'
        await page.locator('#mode-pairs').click()
        assert not await page.locator('#detector-window').is_visible()
        assert await page.locator('#tool-window-pairs').is_visible()
        assert await hit(page.locator('#tools-menu')), 'launcher must return before the next input'
        await page.locator('#tools-menu').tap()
        await page.locator('#mode-reflection').tap()
        await page.locator('#reflection-close').tap()
    else:
        await page.locator('#detector-close').click()
        # Science inspectors must leave the entire tablet/desktop rail usable.
        for selector in ['#mode-analysis','#mode-powder','#mode-reflection','#mode-detector','#mode-analysis','#mode-reflection','#mode-detector','#mode-powder']:
            await page.locator(selector).click()
            expected={'#mode-analysis':'analysis-window','#mode-powder':'analysis-window','#mode-reflection':'reflection-explorer','#mode-detector':'detector-window'}[selector]
            assert await page.evaluate('''id=>{
              const win=document.getElementById(id);
              return win.open && [...document.querySelectorAll('dialog[open]')].every(other=>other===win || Number(getComputedStyle(other).zIndex)<Number(getComputedStyle(win).zIndex));
            }''',expected), 'selected science window must come to the front'
            for button in await page.locator('#tool-rail button').all():
                assert await hit(button), (w,h,selector,'covered rail action',await button.get_attribute('id'))
        await page.locator('#mode-sites').click()
        assert await hit(page.locator('#site-table tbody tr').first), 'settings must be reachable after science tools'
        await page.locator('#mode-reflection').click()
        await page.locator('#style-open').click()
        assert await hit(page.locator('#style-target')), 'Style must be reachable after Reflection'
    assert not errors,(w,h,errors[:5])
    assert await page.evaluate('document.scrollingElement.scrollWidth<=innerWidth && document.scrollingElement.scrollHeight<=innerHeight')
    await page.close()
    print(f'{w}×{h} {theme}: primary controls, diagrams, tabs, linked reveal, options and finite reflection labels passed',flush=True)

async def main():
    async with async_playwright() as p:
        engines=[p.chromium]+([p.webkit] if os.environ.get('WEBKIT_EXECUTABLE') else [])
        for engine in engines:
            options={'channel':os.environ.get('BROWSER_CHANNEL','chrome'),'args':['--enable-unsafe-swiftshader']} if engine.name=='chromium' else {'executable_path':os.environ['WEBKIT_EXECUTABLE']}
            browser=await engine.launch(**options)
            for w,h,theme in [(1440,900,'light'),(768,1024,'dark'),(390,844,'light'),(375,667,'dark'),(844,390,'dark'),(667,375,'light')]:
                await check(browser,w,h,theme)
            page=await browser.new_page(viewport={'width':390,'height':844},has_touch=True)
            await page.goto(URL+'/?example=forsterite')
            await page.wait_for_function('window.viewerDiagnostics?.().atoms.length>0')
            await choose_tool(page,'#mode-reflection')
            for w,h in [(1440,900),(390,844),(1024,768)]:
                await page.set_viewport_size({'width':w,'height':h})
                await page.wait_for_function("document.querySelector('#tools-menu').classList.contains('in-science') === (document.querySelector('#app').dataset.launcher === 'menu')")
                await settle(page)
                if w>1000:
                    assert not await page.locator('#tools-menu').is_visible()
                    assert await hit(page.locator('#reflection-wavelength'))
                else:
                    assert await page.locator('#reflection-explorer #tools-menu').count()==1
                    assert await hit(page.locator('#tools-menu'))
                    assert not await page.locator('.reflection-options').evaluate('e=>e.open'), 'compact disclosure choice must survive resize'
            print(engine.name+': live phone/desktop resize preserves reachable science controls',flush=True)
            await browser.close()
if __name__=='__main__': asyncio.run(main())
