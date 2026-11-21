"""Decode real PNG/video downloads and verify state restoration."""

import asyncio
import base64
import struct
import zlib
from pathlib import Path
from playwright.async_api import async_playwright
from smoke import URL, diagnostics, settle


def png_dpi(data):
    offset = 8
    physical = []
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        tag = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        checksum = struct.unpack(
            ">I", data[offset + 8 + length : offset + 12 + length]
        )[0]
        assert zlib.crc32(tag + payload) == checksum, tag
        if tag == b"pHYs":
            x, y, unit = struct.unpack(">IIB", payload)
            assert unit == 1 and x == y
            physical.append(x * 0.0254)
        offset += length + 12
    assert len(physical) == 1, physical
    return physical[0]


async def check(browser):
    page = await browser.new_page(
        viewport={"width": 1440, "height": 900}, has_touch=True, accept_downloads=True
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + "/?example=forsterite")
    await page.wait_for_function(
        "window.viewerDiagnostics?.().coordination.polyhedronCount===12"
    )
    await page.locator("#mode-lattice").tap()
    await page.locator("#plane-add").tap()
    await page.locator("#arrow-add").tap()
    await page.locator("#mode-sites").tap()
    await page.locator("#labels-toggle").check()
    await page.locator("#mode-export").tap()
    await settle(page)
    await page.locator("#export-dpi").fill("300")
    # A manual view must survive moving an editor. Export should be identical
    # wherever the floating editor sits (including plane/arrow label placement).
    await page.mouse.move(400, 400)
    await page.mouse.wheel(0, -80)
    await settle(page)
    before = await diagnostics(page)
    viewport = await page.locator("#viewport canvas").first.bounding_box()
    async with page.expect_download() as pending:
        await page.locator("#export-png").tap()
    png = await pending.value
    data = Path(await png.path()).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert abs(png_dpi(data) - 300) < 0.01
    width, height = struct.unpack(">II", data[16:24])
    assert width > 600 and height > 600, (width, height)
    assert width * height < viewport["width"] * viewport["height"] * 4 * 0.7, (width, height, viewport)
    await png.save_as("/tmp/psv-gui-assessment/export-image.png")
    assert (await diagnostics(page))["camera"] == before["camera"]
    head = await page.locator("#tool-title-export").bounding_box()
    await page.mouse.move(head["x"] + 40, head["y"] + head["height"] / 2)
    await page.mouse.down()
    await page.mouse.move(head["x"] - 360, head["y"] - 100, steps=8)
    await page.mouse.up()
    await settle(page)
    assert (await diagnostics(page))["camera"] == before["camera"]
    async with page.expect_download() as pending:
        await page.locator("#export-png").tap()
    moved = await pending.value
    assert Path(await moved.path()).read_bytes() == data, "Editor position changed the exported crystal/labels"

    await page.locator("#export-dpi").fill("600")
    await page.locator("#export-transparent").check()
    async with page.expect_download() as pending:
        await page.locator("#export-png").tap()
    transparent = await pending.value
    transparent_data = Path(await transparent.path()).read_bytes()
    assert abs(png_dpi(transparent_data) - 600) < 0.01
    data = base64.b64encode(transparent_data).decode()
    pixels = await page.evaluate(
        """data => new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
      const g=c.getContext('2d');g.drawImage(img,0,0);
      const rgba=g.getImageData(0,0,c.width,c.height).data;
      const body={x1:c.width,y1:c.height,x2:0,y2:0},compass={...body};
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
        if(rgba[(y*c.width+x)*4+3]<8)continue;
        const box=x<c.width-192?body:compass;
        box.x1=Math.min(box.x1,x);box.y1=Math.min(box.y1,y);
        box.x2=Math.max(box.x2,x);box.y2=Math.max(box.y2,y);
      }
      resolve({corner:rgba[3],body,compass,width:c.width,height:c.height});};img.onerror=reject;
      img.src='data:image/png;base64,'+data;
    })""",
        data,
    )
    assert pixels["corner"] == 0, pixels
    body, compass = pixels["body"], pixels["compass"]
    assert 20 <= body["x1"] <= 80 and 20 <= body["y1"] <= 80, pixels
    assert 20 <= pixels["height"] - body["y2"] <= 80, pixels
    # The compass moves to the lower-right corner of the cropped output;
    # its 72 CSS px circle has a 12 CSS px inset at this 2× export scale.
    for key, expected in {"x1": width - 168, "x2": width - 25,
                          "y1": height - 168, "y2": height - 25}.items():
        assert abs(compass[key] - expected) <= 2, pixels

    if not await page.locator("#export-video").is_disabled():
        await page.locator('input[name="export-scale"][value="1"]').check()
        await page.locator("#export-seconds").select_option("4")
        await page.locator("#export-fps").select_option("24")
        async with page.expect_download(timeout=30000) as pending:
            await page.locator("#export-video").tap()
        movie = await pending.value
        movie_data = Path(await movie.path()).read_bytes()
        await movie.save_as(
            "/tmp/psv-gui-assessment/export-movie"
            + Path(movie.suggested_filename).suffix
        )
        assert len(movie_data) > 10000
        assert not (await diagnostics(page))["export"]["busy"]
        assert (await diagnostics(page))["camera"] == before["camera"]
        mime = (await diagnostics(page))["export"]["video"]["mime"]
        metadata = await page.evaluate(
            """({data,mime})=>new Promise((resolve,reject)=>{
          const v=document.createElement('video');v.muted=true;
          const timer=setTimeout(()=>reject(Error('Movie decode timed out')),10000);
          v.onloadedmetadata=()=>{clearTimeout(timer);resolve({width:v.videoWidth,height:v.videoHeight,duration:v.duration});};
          v.onerror=()=>reject(Error(v.error?.message||'Movie decode failed'));
          v.src='data:'+mime+';base64,'+data;
        })""",
            {"data": base64.b64encode(movie_data).decode(), "mime": mime},
        )
        assert metadata["width"] > 500 and metadata["height"] > 400, metadata
        assert metadata["duration"] >= 3.5, metadata
        await page.locator("#export-video").tap()
        await page.locator("#export-cancel").wait_for(state="visible")
        await page.wait_for_timeout(150)
        await page.locator("#export-cancel").tap()
        await page.wait_for_function("!window.viewerDiagnostics().export.busy")
        assert (await diagnostics(page))["camera"] == before["camera"]

        # Resizing during a recording stops it without a download and
        # restores the live render scale at the current viewport size.
        downloads = []
        page.on("download", lambda d: downloads.append(d))
        await page.locator("#export-video").tap()
        await page.locator("#export-cancel").wait_for(state="visible")
        await page.wait_for_timeout(200)
        await page.set_viewport_size({"width": 1024, "height": 768})
        await page.wait_for_function(
            "!window.viewerDiagnostics().export.busy", timeout=10000
        )
        await settle(page)
        status = await page.locator("#export-status").inner_text()
        assert "resized" in status and "nothing was saved" in status, status
        await page.wait_for_timeout(500)
        assert not downloads, downloads
        canvas = await page.evaluate(
            """()=>{const c=document.querySelector('#viewport canvas');const r=c.getBoundingClientRect();
            return {w:c.width,h:c.height,cw:r.width,ch:r.height};}"""
        )
        assert abs(canvas["w"] - canvas["cw"]) <= 1, canvas
        assert abs(canvas["h"] - canvas["ch"]) <= 1, canvas
        assert await page.locator("#export-video").is_enabled()
        print("Movie decoded", metadata)
    else:
        print(
            "Video unsupported", await page.locator("#export-video-note").inner_text()
        )
    assert not errors, errors
    await page.close()
    print(f"PNG {width}×{height}, transparent background and export state passed")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        await check(browser)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
