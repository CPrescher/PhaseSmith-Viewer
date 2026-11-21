"""FXAA preserves interior RGBA and smooths edges after translucent compositing.

Run against the Vite development server; this check imports source modules.
"""
import asyncio,json
from playwright.async_api import async_playwright
from smoke import URL

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel='chrome')
  page=await browser.new_page()
  await page.goto(URL)
  result=await page.evaluate('''async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const {createLiveAntialias} = await import('/web/live-antialias.js');
    const r = new T.WebGLRenderer({alpha:true, antialias:false});
    r.setSize(128,128); r.setClearColor(0,0);
    const gl=r.getContext(), scene=new T.Scene(), camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);
    camera.position.z=2;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute([-.9,-.8,0,.9,-.8,0,-.3,.9,0],3));
    scene.add(new T.Mesh(geometry,new T.MeshBasicMaterial({color:0x5588aa,transparent:true,opacity:.5})));
    const aa=createLiveAntialias(r);
    const read=()=>{const a=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,a);return a};
    r.render(scene,camera); const before=read(); aa.render(); const after=read();
    const pixel=(a,x,y)=>[...a.slice(4*(128*y+x),4*(128*y+x)+4)];
    const alphaLevels=a=>new Set([...a].filter((_,i)=>i%4===3)).size;
    const out={interiorBefore:pixel(before,50,40),interiorAfter:pixel(after,50,40),clear:pixel(after,0,0),levelsBefore:alphaLevels(before),levelsAfter:alphaLevels(after)};
    r.setSize(200,80);r.render(scene,camera);aa.render();out.error=gl.getError();
    aa.dispose();geometry.dispose();r.dispose();return out;
  }''')
  assert result['interiorBefore']==result['interiorAfter'],result
  assert result['clear']==[0,0,0,0],result
  assert result['levelsAfter']>result['levelsBefore']+5,result
  assert result['error']==0,result
  print(json.dumps(result));await browser.close()
asyncio.run(main())
