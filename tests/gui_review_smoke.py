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
    assert await page.locator('#tool-rail > [role=group]').count()==4
    assert await page.locator('#tool-window-export #project-save, #tool-window-export #session-save').count()==0
    rail=page.locator('#tool-rail')
    menu=page.locator('#tools-menu')
    if not await rail.is_visible():await menu.click()
    for group in ['overlay','analysis']:
        trigger=page.locator('#'+group+'-menu')
        if not await trigger.is_visible():continue
        before=await rail.bounding_box()
        await trigger.click()
        flyout=page.locator('#'+group+'-choices')
        box=await flyout.bounding_box()
        assert box and box['x']>=0 and box['x']+box['width']<=before['x'], (w,h,group,box,before)
        assert box['y']>=0 and box['y']+box['height']<=h
        buttons = flyout.locator('button')
        assert box['height'] <= 8 + 54 * await buttons.count(), (w, h, group, box)
        assert await hit(buttons.first) and await hit(buttons.last)
        assert await rail.bounding_box()==before
        await page.keyboard.press('ArrowDown')
        assert await flyout.locator('button').nth(1).evaluate('b=>b===document.activeElement')
        await page.keyboard.press('Escape')
        assert not await flyout.is_visible() and await trigger.evaluate('b=>b===document.activeElement')
    if await menu.get_attribute('aria-expanded')=='true':await menu.click()
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
    add_pair = page.locator('#add-rule')
    await add_pair.scroll_into_view_if_needed()
    assert await hit(add_pair)
    if w == 768:
        await add_pair.tap()
        await settle(page)
        last = page.locator('#pair-rules .pair-rule').last
        assert await last.evaluate('el => el === document.activeElement')
        card, button = await last.bounding_box(), await add_pair.bounding_box()
        assert button['x'] >= card['x']+card['width'] and abs(card['y']-button['y']) < 1
        body = page.locator('#tool-window-pairs .tool-window-body')
        assert await body.evaluate('el => el.scrollHeight > el.clientHeight')
        track = page.locator('#tool-window-pairs .panel-scroll-track:visible').first
        assert await hit(track)
        await body.evaluate('el => el.scrollTop = 0')
        await settle(page)
        thumb = await track.locator('span').bounding_box()
        x, y = thumb['x']+thumb['width']/2, thumb['y']+thumb['height']/2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x, y+24, steps=4)
        await page.mouse.up()
        assert await body.evaluate('el => el.scrollTop > 0')
        await last.get_by_role('button', name='Delete', exact=False).click()
    assert (await diagnostics(page))['camera']==initial['camera']
    await reveal_control(page,'#polyhedra-only')
    assert not await page.locator('#polyhedra-only').is_checked()
    await choose_tool(page,'#mode-sites')
    assert await hit(page.locator('#site-table tbody tr').first), 'Sites must lead with data'
    await choose_tool(page,'#mode-lattice')
    assert await page.locator('.tool-window [data-action=compact]').count() == 0
    if w == 768:
        for tool,item in [('lattice','plane'), ('directions','arrow')]:
            if tool != 'lattice':
                await choose_tool(page,'#mode-'+tool)
            add = page.locator('#'+item+'-add')
            for _ in range(3):
                await add.tap()
            await settle(page)
            last = page.locator('[data-'+item+'-id]').last
            card, button = await last.bounding_box(), await add.bounding_box()
            assert button['x'] >= card['x']+card['width'] and abs(button['y']-card['y']) < 1
            assert abs(card['height']-button['height']) < 1
            await add.tap()
            await settle(page)
            card, button = await last.bounding_box(), await add.bounding_box()
            assert button['x'] < card['x'] and button['y'] >= card['y']+card['height']-1
    if w < 500:
        await choose_tool(page,'#mode-directions')
        panel = page.locator('#tool-window-directions')
        empty = await panel.bounding_box()
        assert await panel.locator('.panel-scroll-track:visible').count() == 0
        assert await hit(page.locator('#arrow-add'))
        await page.locator('#arrow-add').click()
        await page.wait_for_function('h => document.querySelector("#tool-window-directions").offsetHeight > h', arg=empty['height'])
        await panel.get_by_role('button', name='Remove arrow', exact=False).click()
        await page.wait_for_function('h => document.querySelector("#tool-window-directions").offsetHeight === h', arg=empty['height'])
    await choose_tool(page,'#mode-extent')
    assert await page.locator('#range-apply').count() == 0
    if w < 500:
        panel = page.locator('#tool-window-extent')
        async def bottom_gap():
            return await panel.evaluate('''el => {
                const body = el.querySelector('.tool-window-body');
                // Short displays can scroll. Measure the trailing space after
                // the last control in both the scrolling and fitted layouts.
                const row = el.querySelector('.section-title').getBoundingClientRect();
                return el.getBoundingClientRect().bottom - row.bottom
                    + body.scrollHeight - body.clientHeight - body.scrollTop;
            }''')
        assert 0 <= await bottom_gap() <= 20, 'Extent should end just below Cell and Boundary'
        if h >= 800:
            assert await hit(page.locator('#boundary'))
            assert await panel.locator('.tool-window-body').evaluate('e => e.scrollHeight === e.clientHeight')
    field = page.locator('#range-a-max')
    increase = page.get_by_role('button', name='Increase a maximum by one cell')
    decrease = page.get_by_role('button', name='Decrease a maximum by one cell')
    assert await decrease.is_disabled()
    await increase.tap()
    assert await field.input_value() == '2'
    assert len((await diagnostics(page))['atoms']) == 92
    await decrease.tap()
    assert await field.input_value() == '1' and await decrease.is_disabled()
    await field.fill('1.25'); await field.press('Enter')
    await increase.tap()
    assert await field.input_value() == '2.25'
    await page.locator('#range-reset').click()
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
    await page.locator('#export-png').scroll_into_view_if_needed()
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
    await choose_tool(page,'#mode-diffraction')
    await page.wait_for_function("document.querySelector('#powder-table th')?.textContent==='2θ (°)'")
    await reveal_control(page,'#project-save')
    await page.keyboard.press('Escape')
    assert await page.locator('#xrd-workspace').is_visible(), 'File dismisses before its underlying XRD workspace'
    await page.locator('#xrd-tab-reflection').click()
    if h > 600 and w > 640:
        for control in ['#open', '#file-menu-button', '#library-open', '#structure-info-open']:
            assert await hit(page.locator(control)), (w, h, 'Reflection covers the header', control)
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
    assert not await page.evaluate("[...document.querySelectorAll('#reflection-explorer svg *')].some(e=>[...e.attributes].some(a=>/NaN|Infinity/.test(a.value)))")
    await page.locator('#xrd-tab-detector').click()
    if w<500:
        head=await page.locator('#xrd-head').bounding_box()
        close=await page.locator('#xrd-close').bounding_box()
        assert close['y']<head['y']+16 and close['x']>head['x']+head['width']-65, 'Close must stay at the top right'
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
    assert (await page.locator('#xrd-workspace').bounding_box())['height']<=340, 'linked dock must override a resized or wide desktop window'
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
    if w<=640 or h<=500:
        await page.locator('#xrd-close').click()
        assert not await page.locator('#xrd-workspace').is_visible()
        assert await hit(page.locator('#tools-menu')), 'launcher must return after closing phone XRD sheet'
    else:
        await page.locator('#xrd-close').click()
        # Science inspectors must leave the entire tablet/desktop rail usable.
        for selector in ['#mode-analysis','#mode-diffraction']:
            await choose_tool(page,selector)
            if selector=='#mode-diffraction':
                for tab in ['#xrd-tab-powder','#xrd-tab-reflection','#xrd-tab-detector']:
                    await page.locator(tab).click()
            for button in await page.locator('#tool-rail button:visible').all():
                assert await hit(button), (w,h,selector,'covered rail action',await button.get_attribute('id'))
        await page.locator('#mode-sites').click()
        assert await hit(page.locator('#site-table tbody tr').first), 'settings must be reachable after science tools'
        assert await page.locator('#analysis-window').is_visible()
        assert await page.locator('#xrd-workspace').is_visible()
        await choose_tool(page, '#mode-pairs')
        assert not await page.locator('#tool-window-sites').is_visible()
        assert await hit(page.locator('#tool-window-pairs [data-action=close]'))
        assert await page.locator('#xrd-workspace').is_visible()
        await page.locator('#style-open').click()
        assert await hit(page.locator('#style-target')), 'Style must be reachable after XRD'
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
            await choose_tool(page,'#mode-diffraction')
            await page.locator('#xrd-tab-reflection').click()
            for w,h in [(1440,900),(390,844),(1024,768)]:
                await page.set_viewport_size({'width':w,'height':h})
                await settle(page)
                if w>1000:
                    assert not await page.locator('#tools-menu').is_visible()
                    assert await hit(page.locator('#radiation-wavelength'))
                else:
                    assert await hit(page.locator('#xrd-close'))
                    assert not await page.locator('.reflection-options').evaluate('e=>e.open'), 'compact disclosure choice must survive resize'
            print(engine.name+': live phone/desktop resize preserves reachable science controls',flush=True)
            await browser.close()
if __name__=='__main__': asyncio.run(main())
