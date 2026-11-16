"""IndexedDB session records survive browser restart and stay atomic across tabs."""

import asyncio
import tempfile
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


async def run(url, profile):
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(profile, channel="chrome")
        page = await context.new_page()
        await page.goto(url + "/fixture")
        result = await page.evaluate("""async()=>{
          const {createSessionStore}=await import('/web/session-store.js');
          const a=createSessionStore({dbName:'store-regression'}),b=createSessionStore({dbName:'store-regression'});
          await a.clear();
          const document={text:'data_large\\n'+'# saved CIF text\\n'.repeat(400000),filename:'large.cif'};
          const state={camera:[1,2,3],selected:['A','B','C']};
          const saving=a.save({document,state,entrypoint:'wollastonite'});state.camera[0]=999;await saving;
          let saved=await a.load();
          if(saved.state.camera[0]!==1)throw Error('Pending save was mutated');
          const id=saved.document.id;
          const pending=[];for(let n=0;n<12;n++)pending.push(a.save({document,state:{n},entrypoint:'wollastonite'}));
          await Promise.all(pending);saved=await a.load();
          if(saved.state.n!==11 || saved.document.id!==id)throw Error('Queued settings saves lost ordering or rewrote source identity');
          await b.save({document:{text:'data_other',filename:'other.cif'},state:{source:'other'}});
          await a.save({document,state:{source:'large'},entrypoint:'wollastonite'});
          saved=await b.load();
          if(saved.state.source!=='large'||saved.document.text!==document.text)throw Error('Cross-tab document/state mismatch');
          let rejected=false;try{await a.save({document,state:{invalid:()=>{}}})}catch{rejected=true}
          if(!rejected||(await a.load()).state.source!=='large')throw Error('Failed save replaced last good snapshot');
          await a.save({document:{text:'data_restart',filename:'restart.cif'},state:{camera:[4,5,6],selected:['A','B','C']},entrypoint:'wollastonite'});
          await a.close();await b.close();
          return {bytes:document.text.length,orderedSaves:12,crossTabAtomic:true,failedSaveRetained:true};
        }""")
        assert result["bytes"] > 6_000_000, result
        print(result, flush=True)
        await context.close()
        # A fresh browser process with the same isolated profile and origin.
        context = await p.chromium.launch_persistent_context(profile, channel="chrome")
        page = await context.new_page()
        await page.goto(url + "/fixture")
        result = await page.evaluate("""async()=>{
          const {createSessionStore}=await import('/web/session-store.js');const store=createSessionStore({dbName:'store-regression'});
          const loaded=await store.load();
          if(loaded.document.filename!=='restart.cif'||loaded.document.text!=='data_restart'||loaded.state.camera.join()!=='4,5,6'||loaded.state.selected.join()!=='A,B,C'||loaded.entrypoint!=='wollastonite')throw Error('Browser restart lost session');
          await store.clear();if(await store.load()!==null)throw Error('Cleared session remains');await store.close();return true;
        }""")
        assert result
        await context.close()
        print("Browser restart restored session; explicit clear removed it", flush=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(Handler, directory=str(root))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="viewer-session-test-") as profile:
            asyncio.run(run(f"http://127.0.0.1:{server.server_port}", profile))
    finally:
        server.shutdown()
