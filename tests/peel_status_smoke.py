"""Depth-peeling status stays accurate when frames outrun query results.

An isolated stack of N parallel translucent quads needs exactly N layers.
A 2-layer frame is drawn, then a 30-layer frame BEFORE the first query
resolves (so the 30-layer frame is drawn unmeasured). The onStatus
callback mirrors the app: it redraws when asked (`rerender`). The status
must end at overflow = true with 24 layers used; going back to 2 quads
must settle at used = 2, overflow = false with no lingering warning.
Run from the repository root: python tests/peel_status_smoke.py
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


SETUP = """async () => {
  const T = await import('/node_modules/three/build/three.module.js');
  const { createDepthPeeler, PEEL_LAYER } = await import('/web/peel.js');
  const r = new T.WebGLRenderer({ alpha: false, antialias: false });
  r.setPixelRatio(1); r.setSize(128, 128); r.setClearColor(0x000000, 1);
  document.body.append(r.domElement);
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.position.z = 50; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const stack = new T.Group(); scene.add(stack);
  const geometry = new T.PlaneGeometry(1.5, 1.5);
  const log = { notes: [], renders: 0 };
  let frame = 0;
  const render = () => { frame = 0; log.renders++; peeler.render(scene, camera); };
  const invalidate = () => { if (!frame) frame = requestAnimationFrame(render); };
  const peeler = createDepthPeeler({ THREE: T, renderer: r, onStatus: (s) => {
    log.notes.push({ used: s.used, overflow: s.overflow, remainder: s.remainder, stale: s.stale, rerender: s.rerender });
    if (s.rerender) invalidate();  // same as the app
  } });
  window.peelTest = {
    log, invalidate, peeler,
    setLayers(n) {
      for (const m of [...stack.children]) { stack.remove(m); m.material.dispose(); }
      for (let i = 0; i < n; i++) {
        const m = new T.Mesh(geometry, new T.MeshBasicMaterial({ color: 0x3366ff, transparent: true, opacity: .2, depthWrite: false, side: T.DoubleSide }));
        m.position.z = -20 + i * 1.3; m.layers.set(PEEL_LAYER); stack.add(m);
      }
    },
    renderNow: render,
  };
}"""


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
            await page.evaluate(SETUP)
            # 2 layers, then 30 layers in the same task: the second frame
            # cannot be measured (the first query is still pending).
            first = await page.evaluate(
                """() => { const t = window.peelTest;
                  t.setLayers(2); t.renderNow();
                  t.setLayers(30); t.renderNow();
                  return t.peeler.diagnostics(); }"""
            )
            assert first["pending"] and first["unmeasured"], first
            await page.wait_for_function(
                "(() => { const d = window.peelTest.peeler.diagnostics(); return d.overflow && !d.pending; })()",
                timeout=5000,
            )
            final = await page.evaluate("window.peelTest.peeler.diagnostics()")
            notes = await page.evaluate("window.peelTest.log.notes")
            print("30-layer stack:", json.dumps(final), json.dumps(notes))
            assert final["overflow"] and final["remainder"] and final["used"] == 24, (
                final
            )
            assert any(n["stale"] and n["rerender"] for n in notes), notes
            assert notes[-1]["overflow"], notes

            # Back to 2 layers: settles without a false warning.
            await page.evaluate(
                "() => { window.peelTest.setLayers(2); window.peelTest.invalidate(); }"
            )
            await page.wait_for_function(
                "(() => { const d = window.peelTest.peeler.diagnostics(); return !d.pending && !d.unmeasured && d.used === 2; })()",
                timeout=5000,
            )
            await page.wait_for_timeout(300)
            settled = await page.evaluate("window.peelTest.peeler.diagnostics()")
            notes = await page.evaluate("window.peelTest.log.notes")
            print("2-layer stack:", json.dumps(settled))
            assert (
                not settled["overflow"]
                and not settled["remainder"]
                and settled["used"] == 2
            ), settled
            assert not notes[-1]["overflow"] and not notes[-1]["rerender"], notes[-1]
            # No rerender loop: the render count stays put once settled.
            count = await page.evaluate("window.peelTest.log.renders")
            await page.wait_for_timeout(400)
            assert await page.evaluate("window.peelTest.log.renders") == count
            assert not errors, errors
            await browser.close()
    finally:
        server.shutdown()
    print(
        "Peel status: stale frames re-measured, true overflow reported, cleared after"
    )


if __name__ == "__main__":
    asyncio.run(main())
