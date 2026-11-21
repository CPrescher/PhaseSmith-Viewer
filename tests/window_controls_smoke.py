"""Native full-screen header, laptop rail, and both-corner palette resizing."""
import asyncio,json,os
from playwright.async_api import async_playwright
from smoke import URL,choose_tool,diagnostics,settle
from gui_review_smoke import hit

async def coordinate_click(page,selector):
 r=await page.locator(selector).bounding_box()
 await page.mouse.click(r['x']+r['width']/2,r['y']+r['height']/2)

async def resize_left(page,selector,grip):
 before=await page.locator(selector).bounding_box();camera=(await diagnostics(page))['camera']
 r=await page.locator(grip).bounding_box()
 await page.mouse.move(r['x']+6,r['y']+r['height']-6);await page.mouse.down();await page.mouse.move(r['x']-45,r['y']-50,steps=8);await page.mouse.up();await settle(page)
 after=await page.locator(selector).bounding_box()
 assert after['width']>before['width']+30,(selector,before,after)
 assert abs(after['x']+after['width']-before['x']-before['width'])<2,(selector,before,after)
 assert after['height']<before['height']-30,(selector,before,after)
 assert (await diagnostics(page))['camera']==camera

async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(channel='chrome')
  for w,h in [(1440,900),(1280,720),(1024,768)]:
   page=await b.new_page(viewport={'width':w,'height':h});await page.goto(URL+'/?example=forsterite');await page.wait_for_function('window.viewerDiagnostics?.().atoms.length>0')
   for e in await page.locator('#tool-rail .rail-button').all():assert await hit(e),await e.get_attribute('id')
   assert await page.locator('#tool-rail').evaluate('e=>e.scrollHeight<=e.clientHeight+1'), 'Laptop rail must show every label without scrolling'
   assert await page.locator('#name').evaluate('e=>e.scrollWidth<=e.clientWidth+1'), 'formula should fit before optional header text'
   if w==1440:
    await coordinate_click(page,'#fullscreen-toggle');await page.wait_for_function('!!document.fullscreenElement')
    await coordinate_click(page,'#theme-toggle');assert await page.locator('html').get_attribute('data-theme')=='dark'
    await coordinate_click(page,'#structure-info-open');assert await page.locator('#structure-info').is_visible();await page.locator('#structure-info-close').click()
    await coordinate_click(page,'#library-open');assert await page.locator('#structure-library').is_visible();await page.locator('#library-close').click()
    if await page.evaluate('!!document.fullscreenElement'):
     await coordinate_click(page,'#fullscreen-toggle');await page.wait_for_function('!document.fullscreenElement')
    else:
     await coordinate_click(page,'#fullscreen-toggle');await page.wait_for_function('!!document.fullscreenElement');await coordinate_click(page,'#fullscreen-toggle');await page.wait_for_function('!document.fullscreenElement')
    async with page.expect_file_chooser():await coordinate_click(page,'#open')
    for tool in ['pairs','sites','lattice','extent','export','style']:
     await choose_tool(page,'#style-open' if tool=='style' else '#mode-'+tool)
     await resize_left(page,'#tool-window-'+tool,'#tool-window-'+tool+' .window-grip-left')
     # Each test starts at the default rectangle, through the documented reset.
     await page.locator('#tool-window-'+tool+' .tool-window-title').dblclick()
     panel=page.locator('#tool-window-'+tool)
     box=await panel.bounding_box();grip=await panel.locator('.window-grip:not(.window-grip-left)').bounding_box()
     await page.mouse.move(grip['x']+grip['width']-4,grip['y']+grip['height']-4);await page.mouse.down()
     await page.mouse.move(grip['x']+grip['width']-4,box['y']+180,steps=8);await page.mouse.up()
     await panel.locator('[data-action=compact]').click()
     assert (await panel.bounding_box())['height'] <= (await panel.locator('.tool-window-head').bounding_box())['height']+3
     assert await hit(panel.locator('[data-action=close]')), 'Folded panel grips must not cover Close'
     await panel.locator('[data-action=close]').click();assert not await panel.is_visible()
     await choose_tool(page,'#style-open' if tool=='style' else '#mode-'+tool)
     await panel.locator('[data-action=compact]').click()
     assert await panel.locator('.window-grip-left').is_visible(), 'Expand must restore corner resizing'
     await panel.locator('.tool-window-title').dblclick()
    await page.locator('#tool-window-style [data-action=close]').click()
    await choose_tool(page,'#mode-sites')
    body=await page.locator('#tool-window-sites .tool-window-body').bounding_box()
    await page.mouse.click(body['x']+2,body['y']+2)
    await page.keyboard.press('Escape')
    assert not await page.locator('#tool-window-sites').is_visible(), 'Escape after a blank-body click must close the palette'
   for tool,dialog,close in [('powder','analysis-window','analysis-close'),('detector','detector-window','detector-close')]:
    await choose_tool(page,'#mode-'+tool)
    assert await hit(page.locator('#structure-info-open')) and await hit(page.locator('#open'))
    assert await hit(page.locator('#show-atoms')) and await hit(page.locator('#size'))
    assert await page.evaluate("viewerDiagnostics().atoms.some(a=>document.elementFromPoint(a.x,a.y)?.tagName==='CANVAS')")
    if w==1440:
     # Move away from the left edge before expanding to the left.
     head=await page.locator('#'+dialog+' header h2').bounding_box();await page.mouse.move(head['x']+10,head['y']+10);await page.mouse.down();await page.mouse.move(head['x']+150,head['y']+10,steps=8);await page.mouse.up()
     await resize_left(page,'#'+dialog,'#'+dialog+' .science-resize-left')
    await page.locator('#'+close).click()
   await page.close();print(f'{w}x{h}: header, rail, resize and exposed crystal passed',flush=True)
  await b.close()
asyncio.run(main())
