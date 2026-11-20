import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import "./load-diffraction-engine.mjs";
import { diffractionModule } from "../web/diffraction-engine.js";
import { powderPattern } from "../web/structure-analysis.js";
import { reflection } from "../web/reflection-model.js";
import { detectorModel } from "../web/detector-model.js";
import { siteShell } from "../web/site-shell.js";
import { powderFamilies, readPowderTrace } from "../web/powder-comparison.js";

const wasm = new WebAssembly.Instance(diffractionModule).exports;
function readCif(text) {
  const bytes = new TextEncoder().encode(JSON.stringify({ text }));
  const address = wasm.input_buffer(bytes.length);
  new Uint8Array(wasm.memory.buffer, address, bytes.length).set(bytes);
  const size = wasm.import_cif();
  const structure = JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), size)));
  assert.equal(structure.error, undefined);
  return structure;
}
const load = file => readCif(fs.readFileSync(new URL("../public/" + file, import.meta.url), "utf8"));
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual-expected) < tolerance, actual + " vs " + expected);

test("site shells keep mixed ligands, planar groups and distinct distortions", () => {
  const inspect = (file, label, cutoff) => {
    const s = load(file);
    return siteShell(s, s.independentSites.find(a => a.label === label), cutoff);
  };
  const mixed = inspect("structures/fluorapatite.cif","Ca2",2.8);
  assert.equal(mixed.count,7);
  assert.equal(mixed.groups[0].atom.element,"F");
  assert.ok(mixed.volume > 0 && mixed.edges.length > 0);
  const carbonate = inspect("structures/calcite.cif","C",1.5);
  assert.equal(carbonate.count,3);
  assert.equal(carbonate.edges.length,3);
  assert.equal(carbonate.volume,null);
  close(inspect("examples/forsterite.cif","Mg1",2.3).distortion,0.011175,1e-5);
  close(inspect("examples/forsterite.cif","Mg2",2.3).distortion,0.03289,1e-5);
});

test("square-planar and empty shells have no three-dimensional volume", () => {
  const center = {element:"Cu", label:"Cu1", frac:[0.5,0.5,0.5]};
  const ligands = [[0.4,0.5],[0.6,0.5],[0.5,0.4],[0.5,0.6]].map(([x,y]) =>
    ({element:"O", label:"O", frac:[x,y,0.5]}));
  const structure = {basis:[[10,0,0],[0,10,0],[0,0,10]], atoms:[center,...ligands]};
  const shell = siteShell(structure,center,1.1);
  assert.equal(shell.edges.length,4);
  assert.equal(shell.volume,null);
  assert.equal(siteShell(structure,center,0.5).mean,null);
});

const copper = b => readCif(`data_cu
_cell_length_a 3.615
_cell_length_b 3.615
_cell_length_c 3.615
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'F m -3 m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_B_iso_or_equiv
Cu1 Cu 0 0 0 ${b}
`);

test("CIF B factors attenuate the powder pattern and the detailed phase sum identically", () => {
  const ratio = s => {
    const {rows} = powderPattern(s);
    const intensity = hkl => rows.find(row => row.hkls.some(h => h.join() === hkl)).intensity;
    return intensity("3,1,1") / intensity("1,1,1");
  };
  const cold = copper(0), warm = copper(2);
  close(ratio(warm)/ratio(cold), Math.exp(-2*2*(11-3)/(4*3.615**2)), 1e-7);
  const detail = reflection(warm,[3,1,1]);
  close(detail.re,detail.groups.at(-1).end[0],1e-8);
  assert.ok(detail.f2 < reflection(cold,[3,1,1]).f2);
});

test("rotated anisotropic ellipsoids reproduce hᵀU*h in a non-orthogonal cell", () => {
  const s = load("structures/fluorapatite.cif");
  const h = [2,1,3], normal = reflection(s,h).normal, d = reflection(s,h).d;
  const mates = s.atoms.filter(a => a.label === "O3");
  assert.ok(mates.length > 1 && new Set(mates.map(a=>JSON.stringify(a.uStar))).size > 1);
  for (const atom of mates) {
    const [xx,yy,zz,yz,xz,xy] = atom.uStar;
    const variance = 4*xx + yy + 9*zz + 6*yz + 12*xz + 4*xy;
    const axes = atom.displacementAxes;
    const projection = [0,1,2].map(i => normal.reduce((sum,v,j) => sum + v*axes[j][i]/d,0));
    close(projection.reduce((sum,v) => sum + v*v,0),variance,1e-10);
    const single = {...s, atoms:[atom]};
    const undamped = {...s, atoms:[{...atom,uStar:null,uIso:0}]};
    close(reflection(single,h).f2/reflection(undamped,h).f2,Math.exp(-4*Math.PI**2*variance),1e-8);
  }
});

test("measured traces preserve intensities and accidental powder overlaps remain selectable", () => {
  assert.deepEqual(readPowderTrace("two_theta_deg,intensity_counts\n20,120\n# sample\n10,-3"),[[10,-3],[20,120]]);
  assert.throws(()=>readPowderTrace("20,120\ninvalid line"),/line 2/);
  assert.deepEqual(readPowderTrace("2theta,counts\n4,-1\n8,2"), [[4,-1],[8,2]]);
  assert.throws(() => readPowderTrace("10,0\n20,"), /line 2/);
  const s = copper(0);
  const row = powderPattern(s,{twoThetaMax:160}).rows.find(r=>r.hkls.some(h=>h.join()==="5,1,1"));
  // Extend the wavelength range to reach 511/333 if necessary.
  const overlapping = row ?? powderPattern(s,{wavelength:0.5}).rows.find(r=>r.hkls.some(h=>h.join()==="5,1,1"));
  assert.deepEqual(powderFamilies(overlapping.hkls,s.symmetryOperations),[[5,1,1],[3,3,3]]);
});

test("wedge CSV events follow signed angles, DAC openings and detector crossings", () => {
  const model = detectorModel(copper(0),0.5,100);
  const full = model.wedge(-180,180,null,0).events;
  const range = model.wedge(-11,11,null,0).events;
  assert.ok(range.length > 0 && range.length < full.length);
  assert.ok(range.every(e => Math.abs(e.omega) <= 11 && model.hit(e.point,e.omega,0)));
  assert.ok(model.wedge(-11,11,5,0).events.length < range.length);
  assert.throws(()=>model.wedge(11,-11,null,0));
});
