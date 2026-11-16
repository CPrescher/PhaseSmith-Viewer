"""Analytic GPU regression for transparent faces whose depth order changes.

Serve the actual rendering modules beside Three.js and compare framebuffer
pixels against ordinary alpha composition. A centroid/object sorter fails
these fixtures, including the case with disjoint geometry.
"""

import asyncio
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/fixture":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<!doctype html><body></body>")
        else:
            super().do_GET()


async def check(browser, url):
    page = await browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(url + "/fixture")
    cases = await page.evaluate(
        """async () => {
        const T = await import('/node_modules/three/build/three.module.js');
        const {createFaceSorter} = await import('/web/face-sort.js');
        const {createDepthPeeler, PEEL_LAYER} = await import('/web/peel.js');
        const renderer = new T.WebGLRenderer({alpha:false, antialias:false});
        renderer.setSize(256, 256);
        renderer.outputColorSpace = T.LinearSRGBColorSpace;
        renderer.setClearColor(0, 1);
        document.body.append(renderer.domElement);
        const camera = new T.OrthographicCamera(-1,1,1,-1,.01,10000);
        camera.position.z = 5; camera.lookAt(0,0,0); camera.updateMatrixWorld();
        function triangle(positions, color, opacity) {
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3));
            geometry.computeVertexNormals();
            geometry.setAttribute('color',new T.Float32BufferAttribute([...color,...color,...color],3));
            return new T.Mesh(geometry,new T.MeshBasicMaterial({
                vertexColors:true, opacity, transparent:opacity<1,
                depthWrite:opacity===1, side:T.DoubleSide, forceSinglePass:true
            }));
        }
        const peeler = createDepthPeeler({THREE:T,renderer});
        peeler.setExportMode(true);
        const gl = renderer.getContext();
        const pixel = (x,y) => {
            const v=new Uint8Array(4);
            gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);
            return [...v];
        };
        const results=[];
        for (const [name, alphaA, alphaB, reverse, disjoint, opaque, nearby] of [
            ['crossing',.5,.5,false,false,false],
            ['reversed rules',.5,.5,true,false,false],
            ['different opacities',.25,.75,false,false,false],
            ['disjoint faces',.5,.5,false,true,false],
            ['opaque obstruction',.5,.5,false,false,true],
            ['nearby faces',.5,.5,false,false,false,true]
        ]) {
            const scene=new T.Scene();
            const a=triangle(nearby ? [-1,-1,.01,1,-1,.01,0,1,.01] : disjoint
                ? [-1,-1,-.5,1,-1,.5,-1,1,-.5]
                : [-1,-1,1,1,-1,-1,0,1,0], [1,0,0],alphaA);
            const b=triangle(nearby ? [-1,-1,0,1,-1,0,0,1,0] : disjoint
                ? [.7,-.95,0,.9,-.95,0,.8,-.75,0]
                : [-1,-1,-1,1,-1,1,0,1,0], [0,0,1],alphaB);
            const sources=reverse?[b,a]:[a,b];
            scene.add(...sources);
            if(opaque) scene.add(triangle([-1,-1,2,1,-1,2,0,1,2],[0,1,0],1));
            const batch=createFaceSorter(T);
            batch.mesh.material=new T.MeshBasicMaterial({vertexColors:true,
                transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true});
            scene.add(batch.mesh); batch.sync(sources,camera);
            batch.mesh.layers.set(PEEL_LAYER);
            peeler.render(scene,camera);
            results.push({name,left:pixel(96,96),right:pixel(160,96),sample:pixel(230,14)});
        }
        peeler.dispose(); renderer.dispose();
        return results;
        }"""
    )
    expected = {
        "crossing": {"left": [128, 0, 64], "right": [64, 0, 128]},
        "reversed rules": {"left": [128, 0, 64], "right": [64, 0, 128]},
        "different opacities": {"left": [64, 0, 143], "right": [16, 0, 191]},
        "disjoint faces": {"sample": [128, 0, 64]},
        "nearby faces": {"left": [128, 0, 64], "right": [128, 0, 64]},
        "opaque obstruction": {"left": [0, 255, 0], "right": [0, 255, 0]},
    }
    for case in cases:
        for point, rgb in expected[case["name"]].items():
            assert all(abs(a - b) <= 2 for a, b in zip(case[point][:3], rgb)), case
    assert not errors, errors
    print(
        "Per-pixel transparency: crossing/disjoint faces, rule order, alpha and opaque depth passed"
    )
    await page.close()


async def main(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        await check(browser, url)
        await browser.close()


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(Handler, directory=str(root))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(main(f"http://127.0.0.1:{server.server_port}"))
    finally:
        server.shutdown()
