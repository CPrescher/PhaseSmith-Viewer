import "./load-diffraction-engine.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reflection, harmonicIndices, rayLayers, crystalRayLayers } from '../web/reflection-model.js';
import { xrayFormFactor } from '../web/structure-analysis.js';
import { matVec, formatMillerIndices } from '../web/crystal-math.js';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const cubic = atoms => ({ basis: [[4,0,0],[0,4,0],[0,0,4]], atoms });

test('quarter-cell phases, occupancy and negative reflections match explicit complex sums', () => {
  const structure = cubic([{ element:'C', frac:[0,0,0] }, { element:'O', frac:[0.25,0,0], occupancy:0.5 }]);
  const positive = reflection(structure, [1,0,0]);
  close(positive.re, xrayFormFactor('C', 0.125));
  close(positive.im, 0.5 * xrayFormFactor('O', 0.125));
  const negative = reflection(structure, [-1,0,0]);
  close(positive.re, negative.re);
  close(positive.im, -negative.im);
  close(positive.f2, negative.f2);
  assert.equal(positive.atoms[1].cycles, 0.25);
  const second = reflection(structure, [2,0,0]);
  close(second.im, 0);
  close(second.re, xrayFormFactor('C', 0.25) - 0.5 * xrayFormFactor('O', 0.25));
});

test('skew-cell normal and path projections agree with Cartesian geometry', () => {
  const structure = { basis:[[4,1,0.5],[0,5,0.8],[0,0,6]], atoms:[{element:'C',frac:[0.1,0.2,0.3]},{element:'O',frac:[0.4,0.1,0.7]}] };
  const hkl=[2,-1,1], result=reflection(structure,hkl);
  const delta=matVec(structure.basis, [0.3,-0.1,0.4]);
  const depth=delta.reduce((sum,v,i)=>sum+v*result.normal[i],0);
  close(depth, 1.1*result.d);
  close(2*depth*Math.sin(result.theta),1.1*result.wavelength);
  const tangent=matVec(structure.basis,[1,2,0]);
  close(tangent.reduce((sum,v,i)=>sum+v*result.normal[i],0),0);
  for(const indices of [hkl,[-2,1,-1],[2,2,2]]) {
    const r=reflection(structure,indices);
    const diagram=rayLayers(r,0,1);
    const translationM=diagram.translation.reduce((sum,v,i)=>sum+v*indices[i],0);
    assert.ok(Number.isInteger(translationM) && translationM!==0);
    for(const layer of diagram.layers) close(2*layer.depth*Math.sin(r.theta),layer.path);
    assert.ok(diagram.layers.every(layer=>layer.cycles>=0));
  }
});

test('unreachable reflections keep their structure factor and harmonics retain signed direction', () => {
  const result=reflection(cubic([{element:'C',frac:[0,0,0]}]),[2,0,0],5);
  assert.equal(result.theta,null);
  assert.ok(result.f2>0);
  assert.deepEqual(harmonicIndices([-2,4,0],1),[-3,6,0]);
  assert.deepEqual(harmonicIndices([-2,4,0],-1),[-1,2,0]);
  assert.deepEqual(harmonicIndices([-1,2,0],-1),[-1,2,0]);
  assert.throws(()=>reflection(cubic([]),[0,0,0]));
  assert.throws(()=>reflection(cubic([]),[1,0,0],0));
});

test('library MgO and quartz give the expected phase groups and extinction behavior', async () => {
  const {instance}=await WebAssembly.instantiate(fs.readFileSync(new URL('../public/engine.wasm',import.meta.url)),{});
  const wasm=instance.exports;
  const read=name=>{
    const text=fs.readFileSync(new URL(`../public/structures/${name}.cif`,import.meta.url),'utf8');
    const bytes=new TextEncoder().encode(JSON.stringify({text,block:null}));
    const p=wasm.input_buffer(bytes.length);
    new Uint8Array(wasm.memory.buffer,p,bytes.length).set(bytes);
    const length=wasm.import_cif();
    return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.output_buffer(),length)));
  };
  const mgo=read('periclase');
  const first=reflection(mgo,[1,1,1]), second=reflection(mgo,[2,2,2]);
  assert.equal(first.atoms.length,8);
  for (const r of [first, second]) {
    assert.deepEqual(r.groups.map(g => g.members.length), [4, 4]);
    close(r.groups.at(-1).end[0], r.re);
    close(r.groups.at(-1).end[1], r.im);
  }
  const extinct = reflection(mgo, [1,0,0]);
  assert.deepEqual(extinct.groups.map(g => g.members.length), [2, 2, 2, 2]);
  for (const group of extinct.groups) for (const index of group.members) {
    assert.equal(extinct.atoms[index].groupIndex, group.index);
    close(extinct.atoms[index].cycles, group.cycles);
  }
  // A click on a translated boundary copy keeps its actual depth for ray paths.
  const boundary = rayLayers(first, 0, 0, 2);
  assert.deepEqual(boundary.layers.map(l => l.m), [2, 0]);
  assert.ok(boundary.layers[0].names.includes("Selected"));
  assert.ok(first.atoms.filter(a=>a.element==='Mg').every(a=>a.cycles===0));
  assert.ok(first.atoms.filter(a=>a.element==='O').every(a=>a.cycles===0.5));
  assert.ok(second.atoms.every(a=>a.cycles===0));
  const firstLayers = crystalRayLayers(first, 0, 4);
  const secondLayers = crystalRayLayers(second, 0, 4);
  assert.deepEqual(firstLayers.layers.map(l => l.m), [2, 1.5, 1]);
  assert.deepEqual(firstLayers.layers.map(l => l.element), ['Mg', 'O', 'Mg']);
  assert.deepEqual(secondLayers.layers.map(l => l.m), [4, 3, 2]);
  firstLayers.layers.forEach((layer, i) => close(layer.m * first.d, secondLayers.layers[i].m * second.d));
  assert.deepEqual(firstLayers.layers.map(l => l.cycles), [0, 0.5, 1]);
  assert.deepEqual(secondLayers.layers.map(l => l.cycles), [0, 1, 2]);
  assert.deepEqual(firstLayers.layers.map(l => l.elements), [['Mg'], ['O'], ['Mg']]);
  assert.ok(crystalRayLayers(reflection(mgo, [1,0,0]), 0, 4).layers.every(l => l.elements.includes('Mg') && l.elements.includes('O')));
  close(first.re,4*(xrayFormFactor('Mg',1/(2*first.d))-xrayFormFactor('O',1/(2*first.d))));
  close(second.re,4*(xrayFormFactor('Mg',1/(2*second.d))+xrayFormFactor('O',1/(2*second.d))));
  assert.ok(reflection(mgo,[1,1,0]).f2<1e-20);
  const quartz=reflection(read('quartz'),[1,0,1]);
  assert.deepEqual(quartz.groups.map(g => g.members.length), Array(9).fill(1));
  assert.ok(quartz.atoms.some(a=>Math.abs(a.imaginary)>0.1));
  assert.ok(new Set(quartz.atoms.map(a=>a.cycles.toFixed(4))).size>3);
});

test('sites keep distinct identities for equal phases, and phases wrap across zero', () => {
  const atom = (siteIndex, x) => ({siteIndex, element: "C", label: "C", frac: [x, 0, 0]});
  const r = reflection(cubic([atom(0, 2e-10), atom(0, 1 - 2e-10), atom(1, 0), atom(undefined, 0)]), [1,0,0]);
  assert.deepEqual(r.groups.map(g => g.members), [[0, 1], [2], [3]]);
  close(r.groups.at(-1).end[0], r.re);
  close(r.groups.at(-1).end[1], r.im);
});

test('generated Miller indices overbar each digit of a negative index', () => {
  assert.equal(formatMillerIndices([-12, 0, -3]), "1\u03052\u0305 0 3\u0305");
});
