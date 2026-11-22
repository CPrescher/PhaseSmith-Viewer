import test from "node:test";
import assert from "node:assert/strict";
import { keypadPosition } from "../web/numeric-input.js";

test("touch keypad stays inside the visible viewport and leaves the edited field uncovered", () => {
  const pad = { width: 270, height: 193 };
  for (const [width, height] of [[1024, 768], [768, 1024], [507, 310], [390, 215], [320, 178]]) {
    const view = { left: 8, top: 65, width, height };
    for (const x of [0, .5, 1]) {
      for (const y of [0, .5, 1]) {
        const left = view.left + x * (width - 100), top = view.top + y * (height - 44);
        const field = { left, top, right: left + 100, bottom: top + 44 };
        const placed = keypadPosition(field, pad, view);
        const right = placed.left + pad.width, bottom = placed.top + (placed.height ?? pad.height);
        assert.ok(placed.left >= view.left && right <= view.left + width);
        assert.ok(placed.top >= view.top && bottom <= view.top + height);
        assert.ok(right <= field.left || placed.left >= field.right ||
          bottom <= field.top || placed.top >= field.bottom);
      }
    }
  }
});
