// History contains only plain viewer settings. Geometry and source CIFs stay
// outside it. Each checkpoint is one completed user action, not one frame.
export function createHistory({ limit = 100, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b) } = {}) {
  let current = null, past = [], future = [];
  const clone = (value) => structuredClone(value);
  return {
    reset(state) {
      current = clone(state);
      past = [];
      future = [];
    },
    checkpoint(state, label) {
      const next = clone(state);
      if (current === null || equal(current, next)) {
        current = next;
        return false;
      }
      past.push({ before: current, after: next, label });
      if (past.length > limit) past.shift();
      current = next;
      future = [];
      return true;
    },
    // Non-edit UI layout may refit the camera. Keep the present state in
    // sync without creating a step or discarding a pending redo branch.
    amend(fields) {
      if (current === null) return;
      current = { ...current, ...clone(fields) };
      if (past.length) past.at(-1).after = current;
      if (future.length) future.at(-1).before = current;
    },
    // Apply first: a failed restoration must not advance the history cursor.
    undo(apply) {
      const entry = past.at(-1);
      if (!entry) return false;
      apply(clone(entry.before));
      past.pop();
      future.push(entry);
      current = clone(entry.before);
      return true;
    },
    redo(apply) {
      const entry = future.at(-1);
      if (!entry) return false;
      apply(clone(entry.after));
      future.pop();
      past.push(entry);
      current = clone(entry.after);
      return true;
    },
    get state() {
      return { undoCount: past.length, redoCount: future.length, undoLabel: past.at(-1)?.label ?? "", redoLabel: future.at(-1)?.label ?? "" };
    },
  };
}
