"""Native regression checks for compact Detector and phase-label collisions."""
import asyncio, os
from playwright.async_api import async_playwright
from smoke import URL, choose_tool, diagnostics, settle, reveal_control
from gui_review_smoke import hit

async def check(browser, w, h):
    page = await browser.new_page(viewport={'width':w,'height':h}, has_touch=True)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.goto(URL+'/?example=forsterite')
    await page.wait_for_function('window.viewerDiagnostics?.().atoms.length===51')
    await choose_tool(page, '#mode-diffraction')
    await page.locator('#xrd-tab-detector').tap()
    camera = (await diagnostics(page))['camera']
    if w in (768,1024):
        parent = await page.locator('#detector-window').bounding_box()
        await page.locator('#detector-open-options').tap(); await settle(page)
        for selector in ['#xrd-close','#detector-open-options','#detector-hkl','#detector-go','[data-detector-view=image]','[data-detector-view=ewald]']:
            assert await hit(page.locator(selector)), (w, selector)
        field = await page.locator('#detector-hkl').bounding_box()
        go = await page.locator('#detector-go').bounding_box()
        assert abs(field['y']-go['y'])<2, (field, go)
        await page.locator('[data-detector-view=image]').tap()
        assert await page.locator('[data-detector-view=image]').get_attribute('aria-pressed')=='true'
        await page.locator('#detector-distance').fill('60'); await page.locator('#detector-distance').press('Tab')
        await page.locator('[data-detector-view=ewald]').tap()
        await page.locator('#detector-options-done').tap(); await settle(page)
        assert await page.locator('#detector-window').bounding_box()==parent, 'Options must restore the tablet inspector'
        assert (await diagnostics(page))['camera']==camera
    if w==667:
        await page.locator('#detector-link').check()
        await page.locator('#detector-reveal').tap(); await settle(page)
        label = page.locator('#detector-link').locator('..')
        label_box = await label.bounding_box()
        dock = await page.locator('#detector-window').bounding_box()
        assert label_box['y']+label_box['height']<=dock['y']+dock['height']-5, (label_box,dock)
        assert await hit(page.locator('#detector-link'))
        await page.locator('#detector-link').tap()
        assert not await page.locator('#detector-link').is_checked()
    if w in (375,390):
        await page.locator('#xrd-tab-reflection').tap()
        await page.locator('#reflection-hkl').fill('0 2 1');await page.locator('#reflection-hkl').press('Enter')
        await page.get_by_role('button',name='Phase sum',exact=True).tap();await settle(page)
        collisions = await page.evaluate('''() => {
          const s=document.querySelector('#reflection-phasors');
          const texts=[...s.querySelectorAll('text')], tags=texts.filter(e=>e.textContent.includes('×'));
          const overlap=(a,b)=>{a=a.getBoundingClientRect();b=b.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top};
          return tags.flatMap(a=>texts.filter(b=>a!==b&&overlap(a,b)).map(b=>[a.textContent,b.textContent]));
        }''')
        assert not collisions, collisions
        assert await page.locator('#reflection-tag-note').is_visible()
        slider=page.locator('#reflection-step')
        assert await hit(slider), 'Phase slider must fit before the explanation note'
        footer=await page.locator('.reflection-intensity').bounding_box()
        for selector in ['#reflection-step-back','#reflection-step-next','#reflection-all']:
            button=page.locator(selector)
            box=await button.bounding_box()
            assert box['y']+box['height']<=footer['y'], 'Whole phase-step buttons must fit above the footer'
            assert await hit(button)
        original=await slider.bounding_box()
        await slider.press('Home'); await settle(page)
        assert not await page.locator('#reflection-tag-note').is_visible()
        assert await slider.bounding_box()==original, 'Conditional explanation must not move phase controls'
        await slider.press('End'); await settle(page)
        assert await slider.bounding_box()==original
    if w==390:
        await page.locator('#xrd-close').tap()
        await choose_tool(page,'#style-open')
        camera=(await diagnostics(page))['camera']
        await reveal_control(page,'#adp-ellipsoids')
        label=page.locator('#adp-ellipsoids').locator('..')
        await label.scroll_into_view_if_needed()
        assert (await label.bounding_box())['height']>=44
        checked=await page.locator('#adp-ellipsoids').is_checked()
        await label.tap()
        assert await page.locator('#adp-ellipsoids').is_checked()!=checked
        summary=page.locator('#radius-details > summary')
        await summary.scroll_into_view_if_needed()
        assert (await summary.bounding_box())['height']>=44
        await summary.tap()
        assert await page.locator('#radius-details').evaluate('e=>e.open')
        assert (await diagnostics(page))['camera']==camera
    assert not errors, errors
    await page.close()

async def main():
    async with async_playwright() as p:
        for name in ['chromium']+(['webkit'] if os.environ.get('WEBKIT_EXECUTABLE') else []):
            args={'channel':os.environ.get('BROWSER_CHANNEL','chrome'),'args':['--enable-unsafe-swiftshader']} if name=='chromium' else {}
            if executable:=os.environ.get(name.upper()+'_EXECUTABLE'):
                args.pop('channel',None)
                args['executable_path']=executable
            browser=await getattr(p,name).launch(**args)
            for w,h in [(768,1024),(1024,768),(667,375),(390,844),(375,667)]:
                await check(browser,w,h)
                print(f'{name} {w}x{h}: compact controls, restoration and labels passed',flush=True)
            page=await browser.new_page(viewport={'width':1024,'height':768},has_touch=False)
            await page.goto(URL+'/?example=forsterite')
            await page.wait_for_function('window.viewerDiagnostics?.().atoms.length===51')
            await choose_tool(page,'#mode-diffraction')
            await page.locator('#xrd-tab-detector').click()
            assert not await page.locator('#detector-go').is_visible()
            field=await page.locator('#detector-hkl').bounding_box()
            assert field['width']>=80, field
            await page.close()
            print(f'{name} fine pointer: hkl field fills available width',flush=True)
            await browser.close()
if __name__=='__main__': asyncio.run(main())
