import { analysisCell, xrayFormFactor } from "./structure-analysis.js";

export function reflection(structure, hkl, wavelength = 1.5406) {
  if (hkl.length !== 3 || !hkl.every(Number.isSafeInteger) || hkl.every(v => v === 0))
    throw Error("Enter three integer Miller indices, with at least one nonzero value.");
  if (!Number.isFinite(wavelength) || wavelength <= 0) throw Error("Enter a positive wavelength in Å.");
  const { atoms, basis, inverse } = analysisCell(structure);
  const g = [0, 1, 2].map(i => inverse[0][i] * hkl[0] + inverse[1][i] * hkl[1] + inverse[2][i] * hkl[2]);
  const length = Math.hypot(...g), d = 1 / length;
  const factors = Object.fromEntries([...new Set(atoms.map(atom => atom.element))].map(element => [element, xrayFormFactor(element, length / 2)]));
  let re = 0, im = 0, scale = 0;
  const contributions = atoms.map((atom, index) => {
    const m = atom.frac.reduce((sum, v, i) => sum + v * hkl[i], 0);
    let cycles = m - Math.floor(m);
    if (cycles < 1e-10 || cycles > 1 - 1e-10) cycles = 0;
    const phase = 2 * Math.PI * cycles;
    const amplitude = factors[atom.element] * (atom.occupancy ?? 1);
    const real = amplitude * Math.cos(phase), imaginary = amplitude * Math.sin(phase);
    const start = [re, im];
    re += real;
    im += imaginary;
    scale += Math.abs(amplitude);
    return { ...atom, index, m, cycles, phase, amplitude, real, imaginary, start, end: [re, im] };
  });
  const sinTheta = wavelength / (2 * d);
  return {
    atoms: contributions, groups: phaseGroups(contributions), basis, hkl: [...hkl], order: hkl.reduce(gcd, 0), wavelength, d, normal: g.map(v => v / length),
    theta: sinTheta <= 1 + 1e-12 ? Math.asin(Math.min(1, sinTheta)) : null,
    re, im, f2: re * re + im * im, scale,
  };
}

// A site may occupy several phases of one reflection. Keep its individual
// positions for ray paths and add their actual complex amplitudes for the plot.
function phaseGroups(atoms) {
  const bySite = new Map(), groups = [];
  for (const atom of atoms) {
    // Older structures without orbit identifiers retain independent atoms.
    const site = atom.siteIndex ?? atom;
    if (!bySite.has(site)) bySite.set(site, []);
    const orbit = bySite.get(site);
    let group = orbit.find(candidate => {
      const distance = Math.abs(candidate.cycles - atom.cycles);
      return Math.min(distance, 1 - distance) <= 1e-9;
    });
    if (!group) {
      group = { index: groups.length, label: atom.label, element: atom.element,
        cycles: atom.cycles, members: [], real: 0, imaginary: 0 };
      orbit.push(group);
      groups.push(group);
    }
    atom.groupIndex = group.index;
    group.members.push(atom.index);
    group.real += atom.real;
    group.imaginary += atom.imaginary;
  }
  let re = 0, im = 0;
  for (const group of groups) {
    group.start = [re, im];
    re += group.real;
    im += group.imaginary;
    group.end = [re, im];
  }
  return groups;
}

const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);

// A common lattice translation centers the layers without changing their
// distances or relative phases, including across harmonics.
export function crystalRayLayers(result, referenceIndex, selectedIndex, selectedM) {
  const diagram = rayLayers(result, referenceIndex, selectedIndex, selectedM);
  const axis = result.hkl.findIndex(v => Math.abs(v) === Math.min(...result.hkl.filter(Boolean).map(Math.abs)));
  const midpoint = (diagram.layers[0].m + diagram.layers.at(-1).m) / 2;
  const cellMidpoint = result.hkl.reduce((sum, v) => sum + v / 2, 0);
  const shift = [0, 0, 0];
  shift[axis] = Math.round((cellMidpoint - midpoint) / result.hkl[axis]);
  const offset = shift[axis] * result.hkl[axis];
  return { ...diagram, shift, layers: diagram.layers.map((layer, index) => {
    const m = layer.m + offset;
    // Include every species that has a periodic image on this layer, so a
    // mixed layer is not misleadingly labeled as the reference species only.
    const elements = [...new Set(result.atoms.filter(atom => {
      const periods = (m - atom.m) / result.order;
      return Math.abs(periods - Math.round(periods)) < 1e-8;
    }).map(atom => atom.element))];
    return { ...layer, m, elements, id: String.fromCharCode(65 + index) };
  }) };
}
export function harmonicIndices(hkl, step) {
  const order = hkl.reduce(gcd, 0);
  const next = Math.max(1, order + step);
  return hkl.map(v => v / order * next);
}

// A real periodic image of the reference atom brackets the selected depth.
// Using a direct-cell translation preserves the chemical identity even for
// nonprimitive indices. Equal projected depths share one drawn layer.
export function rayLayers(result, referenceIndex, selectedIndex, selectedM = result.atoms[selectedIndex].m) {
  const reference = result.atoms[referenceIndex], selected = result.atoms[selectedIndex];
  const axis = result.hkl.findIndex(value => Math.abs(value) === Math.min(...result.hkl.filter(Boolean).map(Math.abs)));
  const repeat = Math.abs(result.hkl[axis]);
  const direction = selectedM < reference.m ? -1 : 1;
  const steps = Math.max(1, Math.ceil(Math.abs(selectedM - reference.m) / repeat - 1e-10));
  const translation = [0, 0, 0];
  translation[axis] = direction * Math.sign(result.hkl[axis]) * steps;
  const points = [
    { m: reference.m, names: ["Reference"], element: reference.element },
    { m: reference.m + direction * steps * repeat, names: ["Reference + t"], element: reference.element },
  ];
  if (selectedIndex !== referenceIndex || selectedM !== reference.m) points.push({ m: selectedM, names: ["Selected"], element: selected.element });
  points.sort((a, b) => b.m - a.m);
  const layers = [];
  for (const point of points) {
    const previous = layers.at(-1);
    if (previous && Math.abs(previous.m - point.m) < 1e-8) previous.names.push(...point.names);
    else layers.push({ ...point });
  }
  const top = layers[0].m;
  return { translation, layers: layers.map(layer => ({ ...layer, cycles: top - layer.m, depth: (top - layer.m) * result.d, path: (top - layer.m) * result.wavelength })) };
}
