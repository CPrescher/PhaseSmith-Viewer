import test from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../web/history.js";

test("undo/redo retain independent snapshots and invalidate only a changed branch", () => {
  const history = createHistory();
  const initial = { rules: [{ cutoff: 2 }], selected: [] };
  history.reset(initial);
  initial.rules[0].cutoff = 99;
  const edited = { rules: [{ cutoff: 3 }], selected: ["A", "B"] };
  history.checkpoint(edited, "Change cutoff");
  edited.selected.reverse();
  let restored;
  history.undo((s) => { restored = s; s.selected.push("unrelated"); });
  assert.equal(restored.rules[0].cutoff, 2);
  assert.equal(history.state.redoLabel, "Change cutoff");
  history.checkpoint({ rules: [{ cutoff: 2 }], selected: [] }, "No change");
  assert.equal(history.state.redoCount, 1);
  history.redo((s) => { restored = s; });
  assert.deepEqual(restored.selected, ["A", "B"]);
  history.undo(() => {});
  history.checkpoint({ rules: [], selected: [] }, "Delete pair");
  assert.equal(history.state.redoCount, 0);
  assert.equal(history.redo(() => assert.fail()), false);
});

test("bounded history, reset, no-ops and failed restoration", () => {
  const history = createHistory({ limit: 2 });
  history.reset({ n: 0 });
  for (let n = 1; n <= 3; n++) history.checkpoint({ n }, `Edit ${n}`);
  assert.equal(history.state.undoCount, 2);
  assert.throws(() => history.undo(() => { throw Error("Restore failed"); }));
  assert.equal(history.state.undoCount, 2);
  let restored;
  history.undo((s) => { restored = s; });
  assert.equal(restored.n, 2);
  history.undo((s) => { restored = s; });
  assert.equal(restored.n, 1);
  assert.equal(history.undo(() => assert.fail()), false);
  history.reset({ n: 50 });
  assert.equal(history.state.redoCount, 0);
  assert.equal(history.checkpoint({ n: 50 }, "No-op"), false);
  assert.equal(history.state.undoCount, 0);
});


test("layout camera updates preserve the current undo and redo branches", () => {
  const history = createHistory();
  history.reset({ value: 0, camera: [1, 2, 3] });
  history.checkpoint({ value: 1, camera: [1, 2, 3] }, "Edit");
  history.amend({ camera: [4, 5, 6] });
  let restored;
  history.undo(s => { restored = s; });
  assert.equal(restored.value, 0);
  history.amend({ camera: [7, 8, 9] });
  assert.equal(history.state.redoCount, 1);
  history.redo(s => { restored = s; });
  assert.deepEqual(restored, { value: 1, camera: [4, 5, 6] });
  history.undo(s => { restored = s; });
  assert.deepEqual(restored, { value: 0, camera: [7, 8, 9] });
});
