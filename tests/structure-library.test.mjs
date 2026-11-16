import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { structureLibrary, libraryEntry, libraryFilename, entryForFilename, searchLibrary } from '../web/structure-library.js';

test('library searches names, formulas, aliases and overlapping collections', () => {
  assert(searchLibrary('zinc blende').some(e => e.id === 'sphalerite'));
  assert(searchLibrary('NaCl').some(e => e.id === 'halite'));
  assert(searchLibrary('feldspar').some(e => e.id === 'albite'));
  assert(searchLibrary('biotite').some(e => e.id === 'phlogopite'));
  assert(searchLibrary('B2', 'types').some(e => e.id === 'cscl'));
  assert.equal(searchLibrary('B2', 'minerals').length, 0);
  assert.equal(searchLibrary('no-such-mineral').length, 0);
  assert.equal(libraryEntry('unknown'), undefined);
  for (const entry of structureLibrary) assert.equal(entryForFilename(libraryFilename(entry)), entry);
});

test('every bundled CIF has provenance, integrity and a valid expanded structure', async () => {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL('../public/engine.wasm', import.meta.url)), {});
  const wasm = instance.exports;
  assert.equal(new Set(structureLibrary.map(e => e.id)).size, structureLibrary.length);
  const parsed = new Map();
  for (const entry of structureLibrary) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.match(entry.file, /^(structures|examples)\/[a-z0-9-]+\.cif$/);
    assert(entry.source.citation.length > 30, entry.id);
    assert.match(entry.source.url, /^https:\/\//);
    assert(entry.collections.every(c => ['types', 'minerals'].includes(c)), entry.id);
    const bytes = fs.readFileSync(new URL(`../public/${entry.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.id);
    const input = new TextEncoder().encode(JSON.stringify({ text: bytes.toString('utf8'), block: null }));
    const pointer = wasm.input_buffer(input.length);
    new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
    const length = wasm.import_cif();
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length)));
    assert(!data.error, `${entry.id}: ${data.error}`);
    assert(data.atoms.length > 0 && data.volume > 0, entry.id);
    for (const atom of data.atoms) assert(atom.frac.every(Number.isFinite), entry.id);
    parsed.set(entry.id, data);
  }
  // Independent chemical expectations, including rounded thirds that used
  // to multiply special-position atoms and break the empirical formula.
  const expected = {
    quartz: { Si: 3, O: 6 }, brucite: { Mg: 1, O: 2, H: 2 },
    wurtzite: { Zn: 2, S: 2 }, graphite: { C: 4 },
    fluorapatite: { Ca: 10, P: 6, O: 24, F: 2 },
    forsterite: { Mg: 8, Si: 4, O: 16 }, spinel: { Mg: 8, Al: 16, O: 32 },
    pyrope: { Mg: 24, Al: 16, Si: 24, O: 96 },
    'cubic-perovskite': { Ca: 1, Ti: 1, O: 3 }, perovskite: { Ca: 4, Ti: 4, O: 12 },
    'magnesium-hcp': { Mg: 2 }, 'copper-fcc': { Cu: 4 }, 'iron-bcc': { Fe: 2 },
  };
  for (const [id, counts] of Object.entries(expected)) {
    const actual = {};
    for (const atom of parsed.get(id).atoms) actual[atom.element] = (actual[atom.element] ?? 0) + atom.occupancy;
    assert.deepEqual(actual, counts, id);
  }
});
