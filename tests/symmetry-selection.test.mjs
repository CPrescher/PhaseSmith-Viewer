import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { symmetryElements, filterSymmetryElements } from '../web/crystal-math.js';

const box = [[0, 1], [0, 1], [0, 1]];
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const { instance: { exports: wasm } } = await WebAssembly.instantiate(fs.readFileSync(new URL('../public/engine.wasm', import.meta.url)), {});
const input = new TextEncoder().encode(JSON.stringify({ text: fs.readFileSync(new URL('../public/structures/almandine.cif', import.meta.url), 'utf8'), block: null }));
const pointer = wasm.input_buffer(input.length);
new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
const length = wasm.import_cif();
const almandine = JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length)));
assert(!almandine.error);

const directionKey = ({ start, end }) => {
  const d = end.map((v, i) => v - start[i]);
  const sign = Math.sign(d.find(v => Math.abs(v) > 1e-8));
  const max = Math.max(...d.map(Math.abs));
  return d.map(v => Math.round(v / max * sign) || 0).join(',');
};

test('almandine has pure threefold axes in all four body-diagonal directions, with space-group offsets', () => {
  const result = symmetryElements(almandine.symmetryOperations, almandine.basis, box);
  assert(result.complete, result.note);
  const axes = result.elements.filter(e => e.category === 'rotation' && e.symbols.includes('3'));
  assert.deepEqual([...new Set(axes.map(directionKey))].sort(), ['1,-1,-1', '1,-1,1', '1,1,-1', '1,1,1']);
  // Only [000]–[111] is a pure threefold body diagonal in this CIF setting.
  const fullDiagonals = axes.filter(e => e.start.every(v => v === 0 || v === 1) && e.end.every(v => v === 0 || v === 1));
  assert.equal(fullDiagonals.length, 1);
  assert.deepEqual([fullDiagonals[0].start, fullDiagonals[0].end], [[0, 0, 0], [1, 1, 1]]);
});

test('exact type selection preserves a twofold rotation carried by a fourfold axis', () => {
  const operations = [
    { rotation: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], translation: [0, 0, 0] },
    { rotation: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], translation: [0, 0, 0] },
    { rotation: [[0, 1, 0], [-1, 0, 0], [0, 0, -1]], translation: [0, 0, 0] },
  ];
  const { elements } = symmetryElements(operations, identity, [[-0.1, 0.1], [-0.1, 0.1], [-0.1, 0.1]]);
  const categories = new Set(['rotation']);
  const both = filterSymmetryElements(elements, categories);
  assert.equal(both.length, 1);
  assert.equal(both[0].order, 4);
  assert.deepEqual(both[0].symbols, ['2', '4']);
  const twofold = filterSymmetryElements(elements, categories, new Set(['rotation:4']));
  assert.equal(twofold.length, 1);
  assert.equal(twofold[0].order, 2);
  assert.equal(twofold[0].symbol, '2');
  assert.deepEqual(twofold[0].symbols, ['2']);
  assert.equal(filterSymmetryElements(elements, categories, new Set(['rotation:2', 'rotation:4'])).length, 0);
  assert.equal(filterSymmetryElements(elements, new Set(['rotoinversion']), new Set(['rotation:4'])).length, 1);
  assert.deepEqual(both[0].symbols, ['2', '4'], 'filtering must not mutate cached elements');
});
