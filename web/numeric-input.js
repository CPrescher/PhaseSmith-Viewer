// Native number pads can omit signs and separators. These touch keys keep
// the input focused and use the same change/undo/save path as typed edits.
const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// A click moves focus on mousedown. Collapsing the extra row then can move
// the pressed control before mouseup, so the browser clicks its parent.
let mousePressed = false;
const pendingHides = new Set();
function releaseMouse() {
  mousePressed = false;
  for (const keys of pendingHides) keys.hidden = true;
  pendingHides.clear();
}
if (typeof window !== "undefined") {
  window.addEventListener("mousedown", () => { mousePressed = true; }, true);
  window.addEventListener("mouseup", () => setTimeout(releaseMouse, 0), true);
  window.addEventListener("blur", releaseMouse);
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

export function numericKeys(input, caption, withSpace = false, { inputMode, onDone } = {}) {
  input.inputMode = inputMode ?? (withSpace ? "numeric" : "decimal");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  input.enterKeyHint = "done";
  const keys = make("div", { className: "tool-line numeric-keys", hidden: true });
  keys.dataset.for = input.dataset.field ?? input.id;
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", `Extra keys for ${caption}`);
  keys.append(make("span", { className: "micro", textContent: caption }));
  let edited = false;
  const hideKeys = () => {
    if (mousePressed) pendingHides.add(keys);
    else keys.hidden = true;
  };
  input.addEventListener("focus", () => {
    pendingHides.delete(keys);
    keys.hidden = false;
  });
  input.addEventListener("change", () => { edited = false; });
  input.addEventListener("blur", (event) => {
    // An accessory-only edit also needs the usual change/undo/save path.
    if (edited) input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!keys.contains(event.relatedTarget)) {
      // Native validation can refocus this input during the change/blur
      // sequence. Recheck focus once the browser finishes moving it.
      requestAnimationFrame(() => {
        if (document.activeElement !== input && !keys.contains(document.activeElement)) hideKeys();
      });
    }
  });
  keys.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== input && !keys.contains(event.relatedTarget)) hideKeys();
  });
  const edit = (apply) => {
    input.focus({ preventScroll: true });
    const previous = input.value;
    apply();
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    edited ||= input.value !== previous;
  };
  const key = (text, label, action, name) => {
    const button = make("button", { type: "button", className: "secondary", textContent: text });
    button.setAttribute("aria-label", label);
    button.dataset.key = name;
    // Keep the input focused, with its caret and native keyboard, on touch.
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", action);
    keys.append(button);
  };
  if (withSpace) {
    key("−", "Insert minus sign", () => edit(() => input.setRangeText("-", input.selectionStart, input.selectionEnd, "end")), "minus");
    key("Space", "Insert space between indices", () => edit(() => input.setRangeText(" ", input.selectionStart, input.selectionEnd, "end")), "space");
  } else {
    key("±", `Toggle sign for ${caption}`, () => edit(() => {
      const start = input.selectionStart, end = input.selectionEnd;
      const negative = input.value.startsWith("-");
      const signed = /^[+-]/.test(input.value);
      input.value = negative ? input.value.slice(1) : `-${input.value.replace(/^\+/, "")}`;
      const shift = negative ? -1 : signed ? 0 : 1;
      input.setSelectionRange(Math.max(0, start + shift), Math.max(0, end + shift));
    }), "sign");
  }
  const finish = () => {
    onDone?.();
    input.blur();
    keys.hidden = true;
  };
  key("Done", `Finish editing ${caption}`, finish, "done");
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish();
    }
  });
  return keys;
}
