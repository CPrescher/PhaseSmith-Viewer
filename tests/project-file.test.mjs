import test from "node:test";
import assert from "node:assert/strict";
import { parseProject, serializeProject, projectFilename } from "../web/project-file.js";

const snapshot = () => ({
  document: { text: "data_晶体\n# embedded source\n", filename: "晶体.cif" },
  state: {
    block: "晶体", ranges: [[0, 1], [0, 2], [-1, 1]],
    rules: Array.from({ length: 30 }, (_, id) => ({ id: id + 1, cutoff: 51 })),
    appearance: { elements: [["Fe", { color: "#abcdef" }]] },
    atoms: { show: true, hidden: ["O"] },
    lattice: { planes: Array.from({ length: 60 }, (_, id) => ({ id })) },
    camera: { position: [1, 2, 3], up: [0, 1, 0], target: [0, 0, 0] },
    measure: { mode: "angle", keys: ["first", "vertex", "last"] },
    panels: ["lattice"],
  },
  theme: "light",
});

test("portable files embed the complete source and settings without truncation", () => {
  const source = snapshot();
  const loaded = parseProject(serializeProject(source));
  assert.deepEqual(loaded.document, source.document);
  assert.deepEqual(loaded.state, source.state);
  assert.equal(loaded.theme, "light");
  assert.ok(Number.isFinite(Date.parse(loaded.savedAt)));
  const withBom = parseProject("\uFEFF" + serializeProject(source));
  assert.deepEqual(withBom.state, source.state);
});

test("invalid, unrelated, incomplete, and future files give useful errors", () => {
  assert.throws(() => parseProject("data_crystal"), /not valid JSON/);
  for (const value of [null, [], {}, { version: 1 }])
    assert.throws(() => parseProject(JSON.stringify(value)), /not a PhaseSmith/);
  const project = JSON.parse(serializeProject(snapshot()));
  assert.throws(() => parseProject(JSON.stringify({ ...project, version: 2 })), /version 2 is not supported/);
  for (const document of [null, {}, { text: "", filename: "a.cif" }])
    assert.throws(() => parseProject(JSON.stringify({ ...project, document })), /embedded CIF/);
  for (const state of [null, [], {}, { ...project.state, camera: {} }])
    assert.throws(() => parseProject(JSON.stringify({ ...project, state })), /settings/);
  assert.throws(() => serializeProject({ ...snapshot(), state: { ...project.state, ranges: [[0, 100], [0, 100], [0, 100]] } }), /too many cells/);
});

test("download names have a single project suffix and no path characters", () => {
  assert.equal(projectFilename("quartz.cif"), "quartz.psv");
  assert.equal(projectFilename("quartz.MCIF"), "quartz.psv");
  assert.equal(projectFilename("view.PSV"), "view.psv");
  assert.equal(projectFilename("my/view: 1.cif"), "my-view- 1.psv");
  assert.equal(projectFilename("..."), "structure.psv");
});
