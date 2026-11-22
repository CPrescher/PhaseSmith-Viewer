// Keep the real field focused so selection, validation and form submission
// work the same with touch keys, paste or a hardware keyboard.
const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function keypadPosition(field, pad, view) {
  const gap = 6;
  const right = view.left + view.width - gap;
  const bottom = view.top + view.height - gap;
  const left = Math.max(view.left + gap, Math.min(field.left, right - pad.width));
  if (field.bottom + gap + pad.height <= bottom)
    return { left, top: field.bottom + gap };
  if (field.top - gap - pad.height >= view.top + gap)
    return { left, top: field.top - gap - pad.height };
  const top = Math.max(view.top + gap, Math.min(field.top, bottom - pad.height));
  if (field.right + gap + pad.width <= right) return { left: field.right + gap, top };
  if (field.left - gap - pad.width >= view.left + gap) return { left: field.left - gap - pad.width, top };
  // A very short viewport can fit neither side. Keep the field uncovered
  // and let the keypad scroll in the larger of the two remaining spaces.
  const below = bottom - field.bottom - gap;
  const above = field.top - view.top - 2 * gap;
  const height = Math.max(0, Math.max(above, below));
  return { left, top: below >= above ? field.bottom + gap : field.top - gap - height, height };
}

export function enableTripletSelection(input) {
  let firstMouseClick = false;
  let mousePress = false;
  input.addEventListener("pointerdown", (event) => {
    mousePress = event.pointerType === "mouse" && event.button === 0;
    firstMouseClick = mousePress && document.activeElement !== input;
  });
  input.addEventListener("click", () => {
    if (firstMouseClick && input.selectionStart === input.selectionEnd) input.select();
    firstMouseClick = false;
  });
  input.addEventListener("dblclick", () => {
    if (mousePress) input.select();
  });
}

export function numericKeys(input, caption, withSpace = false, {
  fractionalIndices = false, inputMode = withSpace && !fractionalIndices ? "numeric" : "decimal",
  onDone, nativeEnter = false, signed = true,
} = {}) {
  const number = input.type === "number";
  const indexKeypad = withSpace && (inputMode === "numeric" || fractionalIndices);
  const keys = make("div", { className: "numeric-keys", hidden: true });
  const floating = typeof keys.showPopover === "function";
  // Number controls have no selection API. Browser editing commands insert
  // at their native caret and preserve intermediate values such as "-" or "1.".
  const touch = globalThis.matchMedia?.("(any-pointer: coarse)").matches &&
    (!indexKeypad || floating) &&
    (!number || typeof document.execCommand === "function");
  // The iPhone's native number pad lacks a space bar. If the custom pad
  // is unavailable, triplet fields still need a keyboard with separators.
  const nativeMode = indexKeypad ? "text" : inputMode;
  input.inputMode = touch ? "none" : nativeMode;
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  if (!nativeEnter) input.enterKeyHint = "done";

  keys.dataset.for = input.dataset.field ?? input.id;
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", `Keypad for ${caption}`);
  let listeners;
  let nativeFallback = false;
  let edited = false;
  function hide() {
    listeners?.abort();
    if (keys.hidePopover && keys.matches(":popover-open")) keys.hidePopover();
    keys.hidden = true;
  }
  function finish() {
    onDone?.();
    input.blur();
    hide();
  }
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !nativeEnter) {
      event.preventDefault();
      finish();
    }
  });
  if (!touch) return keys;

  keys.classList.add("touch-keypad");
  if (floating) keys.popover = "manual";
  // Keep the input focused even if a fast tap lands in a gap between keys.
  keys.addEventListener("pointerdown", event => event.preventDefault());
  keys.addEventListener("touchend", event => {
    const key = event.target.closest('[data-key="backspace"]');
    if (!key || !event.cancelable) return;
    // Consume this tap before Safari can synthesize a click at its location.
    event.preventDefault();
    if (event.touches.length || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    if (key.contains(document.elementFromPoint(touch.clientX, touch.clientY))) key.click();
  }, { passive: false });

  function position() {
    if (!input.getClientRects().length) return hide();
    const v = window.visualViewport;
    const view = { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0,
      width: v?.width ?? innerWidth, height: v?.height ?? innerHeight };
    keys.style.maxHeight = "";
    const { left, top, height } = keypadPosition(input.getBoundingClientRect(), keys.getBoundingClientRect(), view);
    keys.style.left = left + "px";
    keys.style.top = top + "px";
    if (height !== undefined) keys.style.maxHeight = height + "px";
  }
  function replace(text, backspace = false) {
    input.focus({ preventScroll: true });
    if (number) {
      const previous = input.value;
      const handled = document.execCommand(backspace ? "delete" : "insertText", false, text);
      edited ||= input.value !== previous;
      if (!handled && !backspace) {
        // Some browsers advertise insertText but decline it on number inputs.
        nativeFallback = true;
        input.inputMode = inputMode;
        input.blur();
        input.focus({ preventScroll: true });
      }
      return;
    }
    const end = input.selectionEnd;
    const start = backspace && input.selectionStart === end ? Math.max(0, end - 1) : input.selectionStart;
    input.setRangeText(text, start, end, "end");
    edited = true;
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: backspace ? "deleteContentBackward" : "insertText", data: backspace ? null : text,
    }));
  }
  function toggleSign() {
    const start = input.selectionStart, end = input.selectionEnd;
    const negative = input.value.startsWith("-");
    const shift = negative ? -1 : input.value.startsWith("+") ? 0 : 1;
    input.value = negative ? input.value.slice(1) : "-" + input.value.replace(/^\+/, "");
    input.setSelectionRange(Math.max(0, start + shift), Math.max(0, end + shift));
    edited = true;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  function add(text, name, label, action) {
    const button = make("button", { type: "button", className: "secondary", textContent: text });
    button.setAttribute("aria-label", label);
    button.dataset.key = name;
    button.addEventListener("click", action);
    keys.append(button);
  }
  function populate() {
    for (const digit of "1234567890") add(digit, digit, digit, () => replace(digit));
    if (inputMode === "decimal") {
      const separator = fractionalIndices
        ? new Intl.NumberFormat(navigator.languages).formatToParts(1.1).find(part => part.type === "decimal").value
        : ".";
      add(separator, "decimal", "Decimal separator", () => replace(separator));
    }
    if (signed) {
      if (withSpace || number) add("−", "minus", "Insert minus sign", () => replace("-"));
      else add("±", "sign", "Toggle sign", toggleSign);
    }
    if (withSpace) add("␣", "space", "Insert space", () => replace(" "));
    if (input.tagName === "TEXTAREA") add("↵", "newline", "New row", () => replace("\n"));
    add("⌫", "backspace", "Backspace", () => replace("", true));
    add("⏎", "done", `Finish editing ${caption}`, finish);
  }
  function show() {
    if (!keys.hidden || nativeFallback) return;
    if (!keys.childElementCount) populate();
    keys.hidden = false;
    if (!floating) return;
    keys.showPopover();
    listeners = new AbortController();
    position();
    const options = { signal: listeners.signal };
    const panel = input.closest("dialog, .tool-window, #direction-form, .turn-panel");
    if (panel) {
      const movement = new MutationObserver(position);
      movement.observe(panel, { attributes: true, attributeFilter: ["style", "class", "hidden", "open"] });
      listeners.signal.addEventListener("abort", () => movement.disconnect(), { once: true });
    }
    document.addEventListener("pointerdown", event => {
      // Drag handles prevent default to keep the active editor focused.
      if (event.defaultPrevented && panel?.contains(event.target)) return;
      if (event.target !== input && !keys.contains(event.target) &&
          !Array.from(input.labels ?? []).some(label => label.contains(event.target))) {
        input.blur();
        hide();
      }
    }, options);
    document.addEventListener("scroll", position, { ...options, capture: true });
    window.addEventListener("resize", position, options);
    window.visualViewport?.addEventListener("resize", position, options);
    window.visualViewport?.addEventListener("scroll", position, options);
  }
  keys.addEventListener("toggle", event => {
    // Removing a focused editor can close its popover without a blur event.
    if (event.newState === "closed" && !keys.matches(":popover-open")) hide();
  });
  // Dialog autofocus, Tab and a mouse on a hybrid device can all focus a
  // field. Reserve the floating keypad for an intentional touch or pen tap.
  let touchPress = false;
  input.addEventListener("pointerdown", event => {
    touchPress = event.pointerType === "touch" || event.pointerType === "pen";
    if (!touchPress && !keys.hidden) hide();
  });
  input.addEventListener("pointercancel", () => { touchPress = false; });
  input.addEventListener("click", () => {
    if (touchPress && document.activeElement === input) show();
    touchPress = false;
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && !keys.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  });
  input.addEventListener("change", () => { edited = false; });
  input.addEventListener("blur", event => {
    if (edited) input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!keys.contains(event.relatedTarget)) hide();
  });
  keys.addEventListener("focusout", event => {
    if (event.relatedTarget !== input && !keys.contains(event.relatedTarget)) hide();
  });
  return keys;
}
