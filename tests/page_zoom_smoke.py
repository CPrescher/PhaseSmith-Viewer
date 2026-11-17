"""App-shell pinches must not magnify the page; dialogs must still scroll.

Uses real Chromium touch input. Safari's additional gesture-event guard is
checked separately in WebKit when WEBKIT_EXECUTABLE is supplied. Crystal
pinch/pan behavior is covered by touch_pan_smoke.py.
"""
import asyncio
import os
from playwright.async_api import async_playwright
from browser_test_config import QUICK
from smoke import URL


async def check(browser, native_touch):
    context = await browser.new_context(
        viewport={"width": 1024, "height": 768}, has_touch=True, is_mobile=True,
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(URL + ("/" if QUICK else "/?example=forsterite"))
    await page.wait_for_function("window.viewerDiagnostics?.().atoms.length > 0")
    session = await context.new_cdp_session(page) if native_touch else None

    async def pinch(x, y):
        async def send(kind, gap):
            await session.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [] if kind == "touchEnd" else [
                    {"x": x - gap, "y": y, "id": 1},
                    {"x": x + gap, "y": y, "id": 2},
                ],
            })
        await send("touchStart", 25)
        for gap in range(30, 101, 5):
            await send("touchMove", gap)
            await page.wait_for_timeout(20)
        await send("touchEnd", 0)
        await page.wait_for_timeout(150)

    async def shell_gestures(selector):
        # Safari's proprietary pinch event must be canceled, including when
        # it originates in a modal dialog in the top layer.
        for kind in ("gesturestart", "gesturechange"):
            prevented = await page.locator(selector).evaluate("""(el, kind) => {
                const event = new Event(kind, {bubbles: true, cancelable: true});
                el.dispatchEvent(event);
                return event.defaultPrevented;
            }""", kind)
            assert prevented, (selector, kind)
        if native_touch:
            box = await page.locator(selector).bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            await pinch(x, y)
            await page.touchscreen.tap(x, y)
            await page.wait_for_timeout(60)
            await page.touchscreen.tap(x, y)
            await page.wait_for_timeout(400)
        assert await page.evaluate("visualViewport.scale") == 1, selector

    await shell_gestures("header .structure")
    await page.locator("#library-open").click()
    await page.wait_for_function("document.querySelector('#library-results').children.length > 0")
    await shell_gestures("#library-title")
    if native_touch:
        dialog = page.locator("#structure-library")
        box = await dialog.bounding_box()
        await session.send("Input.synthesizeScrollGesture", {
            "x": box["x"] + box["width"] - 30,
            "y": box["y"] + box["height"] * 0.75,
            "yDistance": -250, "gestureSourceType": "touch", "speed": 600,
        })
        assert await dialog.evaluate("el => el.scrollTop") > 0, "Dialog cannot scroll"
    assert not errors, errors
    print(f"{browser.browser_type.name}: page scale stays at 1; gesture guard works", flush=True)

    if native_touch:
        # Positive control: the same pinch really does zoom an unprotected
        # page. This prevents a browser that ignores test input from passing.
        await page.locator("#library-close").click()
        await page.evaluate("""() => {
            document.documentElement.style.touchAction = 'auto';
            document.body.style.touchAction = 'auto';
        }""")
        await pinch(420, 28)
        assert await page.evaluate("visualViewport.scale") > 1.1, "Control pinch did not zoom"
    await context.close()


async def main():
    async with async_playwright() as p:
        options = {}
        if os.environ.get("CHROMIUM_EXECUTABLE"):
            options["executable_path"] = os.environ["CHROMIUM_EXECUTABLE"]
        elif os.environ.get("BROWSER_CHANNEL"):
            options["channel"] = os.environ["BROWSER_CHANNEL"]
        browser = await p.chromium.launch(**options)
        await check(browser, True)
        await browser.close()
        if os.environ.get("WEBKIT_EXECUTABLE"):
            browser = await p.webkit.launch(executable_path=os.environ["WEBKIT_EXECUTABLE"])
            await check(browser, False)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
