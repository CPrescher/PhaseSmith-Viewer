// The crystal keeps its layout viewport while iPadOS resizes and sometimes
// pans the visual viewport above the keyboard. Fit only the active editor.
export function installKeyboardViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !navigator.maxTouchPoints) return;
  const editable = 'textarea, input:not([type]), input:is([type="text"], [type="number"], [type="search"])';
  let adjusted = null;
  let frame = 0;

  function restore() {
    if (!adjusted) return;
    adjusted.classList.remove("keyboard-fit");
    adjusted.style.removeProperty("--keyboard-height");
    adjusted.style.removeProperty("--keyboard-shift");
    adjusted = null;
  }

  function update() {
    frame = 0;
    const field = document.activeElement;
    const panel = field?.matches(editable) && field.closest("dialog, .tool-window, #direction-form, .turn-panel");
    if (adjusted !== panel) restore();
    if (!panel) return;

    const keyboardOpen = viewport.scale === 1 && document.documentElement.clientHeight - viewport.height > 50;
    if (keyboardOpen) {
      adjusted = panel;
      const stage = panel.closest("#viewport");
      const top = Math.max(viewport.offsetTop, stage?.getBoundingClientRect().top ?? 0) + 6;
      const bottom = viewport.offsetTop + viewport.height - 6;
      panel.classList.add("keyboard-fit");
      panel.style.setProperty("--keyboard-height", Math.max(1, bottom - top) + "px");
      const box = panel.getBoundingClientRect();
      const originalTop = box.top - (parseFloat(panel.style.getPropertyValue("--keyboard-shift")) || 0);
      const fitTop = Math.max(top, Math.min(originalTop, bottom - box.height));
      panel.style.setProperty("--keyboard-shift", (fitTop - originalTop) + "px");
    } else {
      restore();
    }

    // Scroll only the editor, keeping the caret and its accessory keys together
    // where space permits. Never scroll the document or refit the crystal.
    const group = field.closest(".tool-row") || panel;
    const keys = group.querySelector(`.numeric-keys[data-for="${CSS.escape(field.dataset.field || field.id)}"]:not([hidden])`);
    const inlineKeys = keys && !keys.hasAttribute("popover") ? keys : null;
    if (!keyboardOpen && !inlineKeys?.offsetHeight) return;
    for (let scroller = field.parentElement; scroller; scroller = scroller.parentElement) {
      if (scroller.scrollHeight > scroller.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) {
        const bounds = scroller.getBoundingClientRect();
        const input = field.getBoundingClientRect();
        const top = Math.max(bounds.top, viewport.offsetTop) + 4;
        const bottom = Math.min(bounds.bottom, viewport.offsetTop + viewport.height) - 4;
        const end = Math.max(input.bottom, inlineKeys?.getBoundingClientRect().bottom ?? input.bottom);
        const targetBottom = end - input.top <= bottom - top ? end : input.bottom;
        if (input.top < top) scroller.scrollTop += input.top - top;
        else if (targetBottom > bottom) scroller.scrollTop += targetBottom - bottom;
      }
      if (scroller === panel) break;
    }
  }

  function queue() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  document.addEventListener("focusin", queue);
  document.addEventListener("focusout", queue);
  viewport.addEventListener("resize", queue);
  viewport.addEventListener("scroll", queue);
}
