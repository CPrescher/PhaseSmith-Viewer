"""Native inputs: stationary scene, single toggleable tools, aligned info,
independent global visibility, precise editing and saved settings."""
import asyncio, math, os
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from smoke import URL, diagnostics, settle, choose_tool

TOOLS=['#mode-pairs','#mode-lattice','#style-open','#mode-sites','#mode-extent','#mode-export']
SIZES=[(1440,900),(1920,1080),(1024,768),(768,1024),(390,844),(375,667),(844,390),(667,375),(960,1050)]
async def ready(page):
 await page.goto(URL+'/?example=forsterite')
 await page.wait_for_function('window.viewerDiagnostics?.().coordination.polyhedronCount===12 && !viewerDiagnostics().session.suspended')
 await settle(page)
async def launcher(page,button):
 if not await page.locator(button).is_visible():
  prior=await diagnostics(page)
  await page.locator('#tools-menu').click()
  await settle(page)
  unchanged(prior,await diagnostics(page))
  menu=await page.locator('#tool-rail').bounding_box();trigger=await page.locator('#tools-menu').bounding_box()
  assert menu['y']+menu['height']<=trigger['y']-4,(menu,trigger)
 await page.locator(button).click()
 await settle(page)
def unchanged(before,after):
 assert before['camera']==after['camera'],'Overlay changed the camera'
 assert len(before['atoms'])==len(after['atoms'])
 shift=max(math.dist([a['x'],a['y']],[b['x'],b['y']]) for a,b in zip(before['atoms'],after['atoms']))
 assert shift<.01,('Overlay moved the projected structure',shift)
async def pick(page,avoid=None):
 d=await diagnostics(page)
 candidates=[a for a in d['atoms'] if a['visible'] and a['id']!=avoid and await page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.tagName==='CANVAS'",[a['x'],a['y']])]
 assert candidates,'No exposed atom to inspect'
 prior=next((a for a in d['atoms'] if a['id']==avoid),None)
 target=max(candidates,key=lambda a:math.dist([a['x'],a['y']],[prior['x'],prior['y']])) if prior else candidates[0]
 await page.mouse.click(target['x'],target['y']);await settle(page)
 assert (await diagnostics(page))['selectedIds']
async def matrix(browser):
 for theme in ['dark','light']:
  sizes=([(1200,800),(390,844)] if theme=='dark' else [(768,1024),(844,390)]) if QUICK else SIZES
  for w,h in sizes:
   ctx=await browser.new_context(viewport={'width':w,'height':h},has_touch=w<1100,is_mobile=w<900)
   await ctx.add_init_script(f"localStorage.setItem('psv-theme','{theme}')")
   page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await ready(page);base=await diagnostics(page)
   assert await page.locator('#view-readout').evaluate("el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit)}"),'View direction readout obscured'
   assert base['windows']['visible']==[]
   icons={key:await page.locator(key).bounding_box() for key in ['#show-atoms','#show-polyhedra']}
   for rect in icons.values():
    assert rect['x']<w*.5 and rect['y']>h-80 and min(rect['width'],rect['height'])>=44,rect
   assert icons['#show-atoms']['x']<=24,('Visibility icons must start at the lower left',icons)
   phone_launcher=await page.locator('#tools-menu').is_visible()
   if phone_launcher:
    trigger=await page.locator('#tools-menu').bounding_box()
    assert trigger['x']>w*.75 and trigger['y']>h-80,trigger
   assert await page.locator('[data-action=pin],[data-action=minimize],#tools-tidy').count()==0
   bounds=None
   for tool in TOOLS:
    await launcher(page,tool)
    d=await diagnostics(page);unchanged(base,d)
    for key,rect in icons.items():assert await page.locator(key).bounding_box()==rect,('Visibility shortcut moved',key)
    if phone_launcher:assert await page.locator('#tools-menu').bounding_box()==trigger
    assert len(d['windows']['visible'])==1
    rect=await page.locator('.tool-window:not([hidden])').bounding_box()
    body=await page.locator('.tool-window:not([hidden]) .tool-window-body').bounding_box()
    assert body['height']>=120,('Editor too small for usable controls',w,h,body)
    if bounds: assert rect==bounds,('Tool switch moved palette',w,h,rect,bounds)
    bounds=rect
    assert rect['x']>=0 and rect['y']>=0 and rect['x']+rect['width']<=w+.5 and rect['y']+rect['height']<=h+.5
    if d['windows']['profile'] in ['sheet','side']:
     for selector in ['.view-bottom','#view-readout','.axis-compass','#tools-menu']:
      control=await page.locator(selector).bounding_box()
      if control:assert rect['y']+rect['height']<=control['y']-7,(w,h,selector,rect,control)
    if d['windows']['profile']=='side':
     for selector in ['#history-undo','#history-redo','.tool-window:not([hidden]) .tool-window-title']:
      assert await page.locator(selector).evaluate("el=>{const r=el.getBoundingClientRect();const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===h||el.contains(h)}"),(w,h,'History/editor collision',selector)
   if w<=640:
    # All three default element chips must be visible without sideways scrolling.
    assert await page.locator('#elements button').count()==3
    for chip in await page.locator('#elements button').all():
     assert await chip.evaluate("el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit)}"),'Element chip obscured'
   await launcher(page,TOOLS[-1]);assert (await diagnostics(page))['windows']['visible']==[]
   unchanged(base,await diagnostics(page))
   # Info is right-aligned to its own mode toolbar at every responsive size.
   await pick(page)
   row=await page.locator('.measure-row').bounding_box();info=await page.locator('.measure-details').bounding_box()
   assert abs(row['x']+row['width']-info['x']-info['width'])<1,(w,h,row,info)
   assert info['y']>=row['y']+row['height'],(w,h,row,info)
   # The global polyhedra toggle leaves scientific data and atoms unchanged.
   d=await diagnostics(page);geometry=[m['geometry'] for m in d['faceMaterials']]
   await page.locator('#show-polyhedra').uncheck();await settle(page);hidden=await diagnostics(page)
   assert hidden['polyhedra']==d['polyhedra'] and hidden['coordination']==d['coordination']
   assert all(not m['visible'] and not m['outlineVisible'] for m in hidden['faceMaterials'])
   assert hidden['atomsVisible'] and hidden['visibleAtomCount']==d['visibleAtomCount']
   assert [m['geometry'] for m in hidden['faceMaterials']]==geometry
   unchanged(d,hidden)
   await page.locator('#show-atoms').uncheck();await settle(page)
   assert (await diagnostics(page))['visibleAtomCount']==0
   await page.locator('#show-polyhedra').check();await settle(page)
   assert any(m['visible'] for m in (await diagnostics(page))['faceMaterials'])
   assert (await diagnostics(page))['visibleAtomCount']==0
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   assert not errors,errors
   await ctx.close()
   print(f'{w}x{h} {theme}: scene fixed, tools toggle/swap, info aligned, Atoms/Polyhedra independent',flush=True)
async def editing(browser):
 page=await browser.new_page(viewport={'width':1200 if QUICK else 1440,'height':800 if QUICK else 900},has_touch=True)
 await ready(page);await choose_tool(page,'#mode-pairs')
 assert 'Hide atoms outside polyhedra' in await page.locator('label:has(#polyhedra-only)').inner_text()
 await page.locator('#polyhedra-filter-help').wait_for(state='visible')
 pose=await diagnostics(page);window=await page.locator('#tool-window-pairs').bounding_box()
 mg=page.locator('.pair-rule').filter(has=page.locator('[data-field=center] option:checked[value=Mg]'))
 field=mg.locator('[data-field=cutoff]');await field.fill('2.15');await field.press('Enter')
 await page.wait_for_function('viewerDiagnostics().coordination.rules.some(r=>r.center==="Mg"&&r.counts.join(",")==="3,6")')
 updated=await diagnostics(page);assert updated['camera']==pose['camera']
 prior={a['key']:a for a in pose['atoms']}
 assert max(math.dist([a['x'],a['y']],[prior[a['key']]['x'],prior[a['key']]['y']]) for a in updated['atoms'] if a['key'] in prior)<.01
 assert await page.locator('#tool-window-pairs').bounding_box()==window
 # Hiding globally survives rebuilds, opacity edits and plane changes.
 await page.locator('#show-polyhedra').uncheck()
 await field.fill('2.30');await field.press('Enter');await settle(page)
 opacity=mg.locator('[data-field=opacity]');await opacity.focus();await opacity.press('ArrowRight')
 await settle(page);d=await diagnostics(page)
 assert all(not m['visible'] and not m['outlineVisible'] for m in d['faceMaterials'])
 await choose_tool(page,'#mode-lattice');await page.locator('#plane-add').click();await settle(page)
 assert any(p['faces']['visible'] for p in (await diagnostics(page))['lattice']['planes'])
 await choose_tool(page,'#mode-export');await page.locator('#session-save').click()
 await page.wait_for_function('!viewerDiagnostics().session.pending && viewerDiagnostics().session.status.startsWith("Saved")')
 await page.wait_for_timeout(1200) # let the IndexedDB save transaction commit
 await page.reload();await page.wait_for_function('window.viewerDiagnostics?.().session.restoredAt>0 && !viewerDiagnostics().session.suspended')
 assert not (await diagnostics(page))['polyhedraVisible']
 await page.locator('#show-polyhedra').check();await settle(page)
 assert all(m['visible'] and m['outlineVisible'] for m in (await diagnostics(page))['faceMaterials'])
 await page.close()
 print('Editing: cutoff/science/camera stable; global visibility survives rebuild/opacity/session; planes unaffected',flush=True)
FRAMES = """sels=>{window.__stationaryFrames=[];window.__stationaryRecording=true;function sample(){if(!window.__stationaryRecording)return;window.__stationaryFrames.push(sels.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));requestAnimationFrame(sample)}sample()}"""
async def frame_check(page, selectors, action):
 before=await page.evaluate("sels=>sels.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})",selectors)
 await page.evaluate(FRAMES,selectors)
 await action()
 await settle(page)
 frames=await page.evaluate("()=>{window.__stationaryRecording=false;return window.__stationaryFrames}")
 assert len(frames)>3
 for frame in frames:
  assert all(abs(x-y)<.6 for old,new in zip(before,frame) for x,y in zip(old,new)),('Control moved during native edit',before,frame)
async def interaction_details(browser, phone=False):
 # WebKit's desktop test build has no native mobile wheel implementation;
 # use its touch-capable narrow viewport, with native mouse slider drags.
 page=await browser.new_page(viewport={'width':390 if phone else (1200 if QUICK else 1440),'height':844 if phone else (800 if QUICK else 900)},has_touch=phone,is_mobile=phone and browser.browser_type.name=='chromium')
 await ready(page);await choose_tool(page,'#mode-pairs',phone)
 win=page.locator('#tool-window-pairs');body=win.locator('.tool-window-body')
 mg=page.locator('.pair-rule').filter(has=page.locator('[data-field=center] option:checked[value=Mg]'))
 field=mg.locator('[data-field=cutoff]')
 await field.click();track=mg.locator('[data-field=cutoff-speed]');await track.scroll_into_view_if_needed()
 pose=await diagnostics(page);counts=await mg.locator('.pair-counts').inner_text()
 async def cutoff_drag():
  box=await track.bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']/2
  if phone and browser.browser_type.name=='chromium':
   cdp=await page.context.new_cdp_session(page)
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':cx,'y':cy,'id':1}]})
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':cx-box['width']*.3,'y':cy,'id':1}]})
  else:
   await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx-box['width']*.3,cy,steps=4)
  await page.wait_for_function("([id,old])=>document.getElementById(id).textContent!==old",arg=[await mg.locator('.pair-counts').get_attribute('id'),counts],timeout=15000)
  if phone and browser.browser_type.name=='chromium':await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  else:await page.mouse.up()
  await page.wait_for_timeout(120)
 selectors=['#tool-window-pairs', '[aria-label="Mg–O distance cutoff (Å)"]','[aria-label="Mg–O cutoff speed control (Å)"]','#measure-info','#show-atoms','#show-polyhedra']
 await frame_check(page,selectors,cutoff_drag)
 assert (await diagnostics(page))['camera']==pose['camera']
 await field.fill('2.15');await field.press('Enter');await settle(page)
 assert any(r['center']=='Mg' and r['counts']==[3,6] for r in (await diagnostics(page))['coordination']['rules'])
 slider=mg.locator('[data-field=opacity]');await slider.scroll_into_view_if_needed()
 async def opacity_drag():
  box=await slider.bounding_box();x=box['x']+box['width']*.34;y=box['y']+box['height']/2
  if phone and browser.browser_type.name=='chromium':
   cdp=await page.context.new_cdp_session(page)
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':box['x']+box['width']*.75,'y':y,'id':1}]})
   await page.wait_for_timeout(150)
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  else:
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(box['x']+box['width']*.75,y,steps=6);await page.wait_for_timeout(150);await page.mouse.up()
 await frame_check(page,['#tool-window-pairs', '[aria-label="Mg–O distance cutoff (Å)"]', '#pair-opacity-1','#measure-info'],opacity_drag)
 # Native thumb sizes differ by engine, so the same pointer endpoint can
 # yield different percentages. Require a substantial, non-clamped change
 # and verify the renderer uses the exact resulting value.
 value=float(await slider.input_value());assert 55<value<100,value
 assert abs(next(m['opacity'] for m in (await diagnostics(page))['faceMaterials'] if m['id']==1)-value/100)<1e-8
 if phone:
  # Remember the actual scroll position after focusing the chosen entry.
  await field.click();saved=await body.evaluate('el=>el.scrollTop');base=await diagnostics(page)
  await win.locator('[data-action=tune]').tap();assert (await diagnostics(page))['windows']['state']['tune'];unchanged(base,await diagnostics(page))
  await win.locator('[data-action=tune]').tap();assert abs(await body.evaluate('el=>el.scrollTop')-saved)<1
 else:
  base=await diagnostics(page);head=await win.locator('.tool-window-title').bounding_box()
  await page.mouse.move(head['x']+20,head['y']+10);await page.mouse.down();await page.mouse.move(head['x']-100,head['y']+50,steps=6);await page.mouse.up();await settle(page)
  unchanged(base,await diagnostics(page))
  grip=await win.locator('.window-grip').bounding_box();await page.mouse.move(grip['x']+grip['width']-4,grip['y']+grip['height']-4);await page.mouse.down();await page.mouse.move(grip['x']+grip['width']+20,grip['y']+grip['height']+20,steps=5);await page.mouse.up();await settle(page)
  unchanged(base,await diagnostics(page))
 # Lattice changes must retain row bounds and per-tool scroll on return.
 await choose_tool(page,'#mode-lattice',phone)
 for _ in range(4):await page.locator('#plane-add').click()
 row=page.locator('[data-plane-id]').first;hkl=row.locator('input[type=text]').first
 await hkl.fill('1 1 1');await hkl.press('Tab');await hkl.scroll_into_view_if_needed();await settle(page)
 rect=await row.bounding_box();await hkl.fill('0 0 0');await hkl.press('Tab');await settle(page)
 after=await row.bounding_box();assert all(abs(rect[k]-after[k])<.6 for k in rect),(rect,after)
 assert (await diagnostics(page))['lattice']['planes'][0]['error']
 lattice_body=page.locator('#tool-window-lattice .tool-window-body');await lattice_body.hover();await page.mouse.wheel(0,400);await page.wait_for_timeout(150)
 saved=await lattice_body.evaluate('el=>el.scrollTop');assert saved>0
 await choose_tool(page,'#mode-pairs',phone);assert float(await field.input_value())==2.15
 await choose_tool(page,'#mode-lattice',phone);assert abs(await lattice_body.evaluate('el=>el.scrollTop')-saved)<1
 # Pick an exposed atom without replacing or scrolling the active editor.
 before=await diagnostics(page);rect=await page.locator('.tool-window:not([hidden])').bounding_box();await pick(page);after=await diagnostics(page)
 assert after['windows']['visible']==['lattice'];unchanged(before,after)
 assert await page.locator('.tool-window:not([hidden])').bounding_box()==rect
 assert abs(await lattice_body.evaluate('el=>el.scrollTop')-saved)<1
 if phone:
  await page.locator('#measure-more').tap();box=await page.locator('#selection').bounding_box();panel=await page.locator('#tool-window-lattice').bounding_box()
  assert box['x']>=0 and box['x']+box['width']<=390 and box['y']+box['height']<=panel['y']-4,(box,panel)
  await page.locator('#measure-more').tap()
  await page.set_viewport_size({'width':844,'height':390});await settle(page);assert (await diagnostics(page))['windows']['visible']==['lattice']
  await page.set_viewport_size({'width':390,'height':844});await settle(page);assert (await diagnostics(page))['windows']['visible']==['lattice']
  # Closing in landscape then rotating must also refresh the Turn dock's
  # footer reserve; no active editor may be needed to compute that gap.
  await page.set_viewport_size({'width':844,'height':390});await settle(page)
  await page.locator('#tool-window-lattice [data-action=close]').tap()
  await page.set_viewport_size({'width':390,'height':844});await settle(page)
  base=await diagnostics(page);await page.locator('#turn-open').tap();await settle(page)
  unchanged(base,await diagnostics(page))
  panel=await page.locator('#turn-panel').bounding_box();footer=await page.locator('.view-bottom').bounding_box()
  assert panel['y']+panel['height']<=footer['y']-7,(panel,footer)
  await page.locator('#turn-close').tap();await choose_tool(page,'#mode-lattice',True)
 buttons=page.locator('.tool-window:not([hidden]) .window-button')
 for box in await buttons.evaluate_all('els=>els.filter(e=>e.getClientRects().length).map(e=>({w:e.offsetWidth,h:e.offsetHeight}))'):
  if phone:assert min(box['w'],box['h'])>=44,box
 await page.close()
 print(('Phone' if phone else 'Desktop')+': native edit frames, fixed scene on move/resize, values/scroll, invalid hkl, picking, Tune/rotation',flush=True)

async def main():
 async with async_playwright() as p:
  opts={'args':['--enable-unsafe-swiftshader']}
  if os.environ.get('CI'):opts['args']+=['--use-gl=angle','--use-angle=swiftshader-webgl']
  if os.environ.get('BROWSER_CHANNEL'):opts['channel']=os.environ['BROWSER_CHANNEL']
  elif os.environ.get('CHROMIUM_EXECUTABLE'):opts['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
  browsers=[await p.chromium.launch(**opts)]
  if os.environ.get('WEBKIT_EXECUTABLE'):
   browsers.append(await p.webkit.launch(executable_path=os.environ['WEBKIT_EXECUTABLE']))
  for b in browsers:
   print('Browser: '+b.browser_type.name,flush=True)
   await matrix(b);await editing(b);await interaction_details(b);await interaction_details(b,True);await b.close()
if __name__=='__main__':asyncio.run(main())
