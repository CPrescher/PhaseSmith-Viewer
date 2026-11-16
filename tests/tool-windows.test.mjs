import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorRect,
  chooseTool,
  clampRect,
  clearFraction,
  closeTool,
  defaultRect,
  frontTool,
  initialState,
  layoutProfile,
  launcherFor,
  minimizeTool,
  moveTool,
  openTools,
  pinTool,
  placeWindow,
  resolveRect,
  setTune,
  stageRect,
  stageOffset,
  unpinTool,
  validateState,
} from "../web/tool-windows.js";

const inside = (r, ws) => r.x >= 0 && r.y >= 0 && r.x + r.w <= ws.width && r.y + r.h <= ws.height;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("profiles follow the workspace, not tab semantics", () => {
  assert.equal(layoutProfile({ width: 1440, height: 844 }), "float"); // desktop
  assert.equal(layoutProfile({ width: 1024, height: 712 }), "float"); // tablet landscape
  assert.equal(layoutProfile({ width: 768, height: 968 }), "sheet"); // tablet portrait
  assert.equal(layoutProfile({ width: 390, height: 788 }), "sheet"); // phone portrait
  assert.equal(layoutProfile({ width: 375, height: 611 }), "sheet"); // small phone
  assert.equal(layoutProfile({ width: 844, height: 334 }), "side"); // phone landscape
  assert.equal(launcherFor({ width: 1024, height: 712 }), "rail");
  assert.equal(launcherFor({ width: 768, height: 968 }), "rail");
  assert.equal(launcherFor({ width: 390, height: 788 }), "menu");
  assert.equal(launcherFor({ width: 844, height: 334 }), "menu");
});

test("default palettes stay on screen, clear of the right column and the card", () => {
  const metrics = { paletteTop: 236, railColumn: 92, bottomGap: 40 };
  for (const ws of [
    { width: 1920, height: 1024 },
    { width: 1440, height: 844 },
    { width: 1024, height: 712 },
    { width: 900, height: 600 },
  ]) {
    const r = defaultRect("float", ws, metrics);
    assert.ok(inside(r, ws), JSON.stringify([ws, r]));
    assert.ok(r.x + r.w <= ws.width - 92, "rail/compass column stays free");
    assert.ok(r.y >= Math.min(236, ws.height - 40 - 300), "palette starts below the card's reserved height");
    assert.ok(r.h >= 280 && r.h <= 720, "bounded height");
    // The crystal keeps most of the view.
    assert.ok(clearFraction(ws, [r]) >= 0.6, JSON.stringify([ws, clearFraction(ws, [r])]));
  }
  // Sheets: full width at the bottom, below the rail, guide shares kept.
  const phone = { width: 390, height: 788 };
  const sheet = defaultRect("sheet", phone, {});
  assert.deepEqual([sheet.x, sheet.w, sheet.y + sheet.h], [0, 390, 788]);
  assert.ok(clearFraction(phone, [sheet]) >= 0.5);
  const small = { width: 375, height: 611 };
  assert.ok(clearFraction(small, [defaultRect("sheet", small, {})]) >= 0.35);
  const tablet = { width: 768, height: 968 };
  const tabletSheet = defaultRect("sheet", tablet, { railBottom: 470 });
  assert.ok(tabletSheet.y >= 478, "sheet stays below the rail");
  assert.ok(clearFraction(tablet, [tabletSheet]) >= 0.45);
  const landscape = { width: 844, height: 334 };
  const side = defaultRect("side", landscape, { sideTop: 72 });
  assert.equal(side.x + side.w, 844);
  assert.equal(side.y, 72);
  assert.ok(clearFraction(landscape, [side]) >= 0.5);
});

test("clamping keeps windows reachable; anchoring survives a resize round trip", () => {
  const ws = { width: 1000, height: 700 };
  assert.deepEqual(clampRect({ x: 900, y: -40, w: 300, h: 400 }, ws), { x: 692, y: 8, w: 300, h: 400 });
  assert.deepEqual(clampRect({ x: 10, y: 10, w: 2000, h: 2000 }, ws), { x: 8, y: 8, w: 984, h: 684 });
  const r = { x: 640, y: 200, w: 300, h: 420 };
  const a = anchorRect(r, ws);
  assert.equal(a.ax, "right");
  // Wider window: the palette keeps its distance from the right edge.
  assert.deepEqual(resolveRect(a, { width: 1300, height: 700 }), { x: 940, y: 200, w: 300, h: 420 });
  assert.deepEqual(resolveRect(a, ws), r);
  // A narrower window clamps the display, the stored intent stays.
  const narrow = { width: 500, height: 700 };
  const shown = clampRect(resolveRect(a, narrow), narrow);
  assert.ok(inside(shown, narrow));
  assert.deepEqual(resolveRect(a, ws), r);
});

test("stage area and offset", () => {
  const ws = { width: 1440, height: 844 };
  assert.deepEqual(stageRect(ws, []), { x: 0, y: 0, w: 1440, h: 844 });
  const palette = { x: 988, y: 242, w: 360, h: 562 };
  const clear = stageRect(ws, [palette]);
  assert.deepEqual(clear, { x: 0, y: 0, w: 988, h: 844 });
  assert.deepEqual(stageOffset(ws, clear), { x: -226, y: 0 });
  const phone = { width: 390, height: 788 };
  const sheet = { x: 0, y: 426, w: 390, h: 362 };
  assert.deepEqual(stageOffset(phone, stageRect(phone, [sheet])), { x: 0, y: -181 });
  // Two palettes side by side: the crystal moves left of both.
  const kept = { x: 620, y: 242, w: 360, h: 562 };
  assert.deepEqual(stageRect(ws, [palette, kept]), { x: 0, y: 0, w: 620, h: 844 });
  assert.ok(Math.abs(clearFraction(ws, [palette, kept]) - (1 - (2 * 360 * 562) / (1440 * 844))) < 1e-9);
  // A palette moved into the middle never squeezes the crystal into a
  // sliver: the whole view stays the stage.
  const moved = { x: 240, y: 274, w: 360, h: 562 };
  assert.deepEqual(stageRect(ws, [palette, moved]), { x: 0, y: 0, w: 1440, h: 844 });
  // A palette on the left: the stage is the right-hand column.
  assert.deepEqual(stageRect(ws, [{ x: 8, y: 100, w: 340, h: 600 }]), { x: 348, y: 0, w: 1092, h: 844 });
});

test("a new palette goes beside kept windows, or nowhere", () => {
  const ws = { width: 1440, height: 844 };
  const base = { x: 988, y: 242, w: 360, h: 562 };
  const placed = placeWindow(base, [base], ws);
  assert.ok(placed && !overlap(placed, base) && inside(placed, ws));
  assert.equal(placed.x, 988 - 8 - 360);
  const full = [base, { ...base, x: 620 }, { ...base, x: 252 }];
  assert.equal(placeWindow(base, full, ws), null);
});

test("choosing replaces the main palette; kept windows are never duplicated", () => {
  let s = initialState("pairs");
  s = chooseTool(s, "lattice");
  assert.equal(s.main, "lattice");
  assert.deepEqual(openTools(s), ["lattice"]);
  assert.deepEqual(s.order, ["lattice"], "order only names open tools");
  s = pinTool(s, "lattice", { ax: "right", dx: 92, ay: "top", dy: 242, w: 360, h: 562 });
  assert.equal(s.main, null);
  assert.deepEqual(s.pinned, ["lattice"]);
  s = chooseTool(s, "pairs");
  assert.deepEqual(openTools(s).sort(), ["lattice", "pairs"]);
  s = chooseTool(s, "lattice"); // already kept: brought to the front only
  assert.equal(s.main, "pairs");
  assert.equal(frontTool(s), "lattice");
  assert.deepEqual(openTools(s).sort(), ["lattice", "pairs"]);
  // Minimize, choose restores; close keeps the other window.
  s = minimizeTool(s, "pairs");
  assert.deepEqual(s.minimized, ["pairs"]);
  s = chooseTool(s, "pairs");
  assert.deepEqual(s.minimized, []);
  s = closeTool(s, "lattice");
  assert.deepEqual(openTools(s), ["pairs"]);
  assert.equal(s.rects.lattice, undefined);
  // Unpinning makes a kept window the main palette at its place.
  s = pinTool(s, "pairs", { ax: "left", dx: 40, ay: "top", dy: 60, w: 320, h: 400 });
  s = chooseTool(s, "sites");
  s = unpinTool(s, "pairs");
  assert.equal(s.main, "pairs");
  assert.deepEqual(s.pinned, []);
  assert.deepEqual(s.rects.main, { ax: "left", dx: 40, ay: "top", dy: 60, w: 320, h: 400 });
  assert.deepEqual(openTools(s), ["pairs"], "the previous main palette closed");
  // Moving stores an anchored rect; null returns to the default place.
  s = moveTool(s, "pairs", null);
  assert.equal(s.rects.main, undefined);
  // Tune is per main palette and ends with a tool switch.
  s = setTune(s, true);
  assert.equal(s.tune, true);
  assert.equal(chooseTool(s, "lattice").tune, false);
});

test("saved window state is validated", () => {
  assert.equal(validateState(null), null);
  const s = validateState({
    main: "pairs",
    pinned: ["lattice", "pairs", "bogus", "lattice"],
    minimized: ["export", "lattice"],
    order: ["export", "lattice"],
    rects: { main: { ax: "left", dx: 1, dy: 2, ay: "top", w: 300, h: 400 }, lattice: { ax: "up" }, sites: { ax: "left", dx: 1, dy: 2, ay: "top", w: 3, h: 4 } },
    tune: true,
  });
  assert.deepEqual(s, {
    main: "pairs",
    pinned: ["lattice"],
    minimized: ["lattice"],
    order: ["lattice", "pairs"],
    rects: { main: { ax: "left", dx: 1, dy: 2, ay: "top", w: 300, h: 400 } },
    tune: true,
  });
  // A round trip is lossless.
  assert.deepEqual(validateState(s), s);
});
