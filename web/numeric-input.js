// Native number pads can omit signs and separators. These touch keys keep
// the input focused and use the same change/undo/save path as typed edits.
const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

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
  input.addEventListener("focus", () => { keys.hidden = false; });
  input.addEventListener("change", () => { edited = false; });
  input.addEventListener("blur", (event) => {
    // An accessory-only edit also needs the usual change/undo/save path.
    if (edited) input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!keys.contains(event.relatedTarget)) keys.hidden = true;
  });
  keys.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== input && !keys.contains(event.relatedTarget)) keys.hidden = true;
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
    key("±", "Toggle offset sign", () => edit(() => {
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
