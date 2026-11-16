"""Per-pixel translucency order with intersecting faces (depth peeling).

Two coincident-in-projection triangles whose depths swap at x = 0:
A (red) is in front on the left, B (blue) on the right. Both alpha 0.5
over black, linear output. Any object or triangle order gets one side
wrong; per-pixel peeling must give left [128,0,64] and right [64,0,128],
for either draw order, and also with the app's batched RGBA-vertex
material path (createFaceSorter → peeler).
Run from the repository root: python tests/peel_pixel_smoke.py
"""

import asyncio
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = str(Path(__file__).resolve().parent.parent)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

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


SCRIPT = """async (mode) => {
  const T = await import('/node_modules/three/build/three.module.js');
  const { createDepthPeeler, PEEL_LAYER } = await import('/web/peel.js');
  const { createFaceSorter } = await import('/web/face-sort.js');
  const r = new T.WebGLRenderer({ alpha: false, antialias: false });
  r.setPixelRatio(1); r.setSize(256, 256);
  r.outputColorSpace = T.LinearSRGBColorSpace; r.setClearColor(0x000000, 1);
  document.body.append(r.domElement);
  const s = new T.Scene(), c = new T.OrthographicCamera(-1, 1, 1, -1, .1, 20);
  c.position.z = 5; c.lookAt(0, 0, 0); c.updateMatrixWorld();
  function triangle(positions, color) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
    g.setAttribute('color', new T.Float32BufferAttribute([...color, ...color, ...color], 3));
    return new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, opacity: .5, transparent: true, depthWrite: false, side: T.DoubleSide }));
  }
  const a = triangle([-1, -1, 1, 1, -1, -1, 0, 1, 0], [1, 0, 0]);
  const b = triangle([-1, -1, -1, 1, -1, 1, 0, 1, 0], [0, 0, 1]);
  const peeler = createDepthPeeler({ THREE: T, renderer: r });
  if (mode === 'batch') {
    // App path: one RGBA-vertex batch for both "pairs".
    const sorter = createFaceSorter(T);
    sorter.mesh.material = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true });
    s.add(sorter.mesh);
    sorter.sync([a, b], c);
  } else {
    for (const m of mode === 'reversed' ? [b, a] : [a, b]) { m.layers.set(PEEL_LAYER); s.add(m); }
  }
  peeler.render(s, c);
  const gl = r.getContext(), pixel = (x, y) => { const v = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, v); return [...v]; };
  return { left: pixel(96, 96), right: pixel(160, 96), status: peeler.diagnostics() };
}"""


def close(pixel, expected):
    return all(abs(p - e) <= 2 for p, e in zip(pixel[:3], expected))


async def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel="chrome")
            page = await browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(f"http://127.0.0.1:{server.server_port}/fixture")
            for mode in ("objects", "reversed", "batch"):
                result = await page.evaluate(SCRIPT, mode)
                print(mode, json.dumps(result))
                assert close(result["left"], [128, 0, 64]), (mode, result)
                assert close(result["right"], [64, 0, 128]), (mode, result)
            assert not errors, errors
            await browser.close()
    finally:
        server.shutdown()
    print("Per-pixel order correct on both sides of the intersection")


if __name__ == "__main__":
    asyncio.run(main())
