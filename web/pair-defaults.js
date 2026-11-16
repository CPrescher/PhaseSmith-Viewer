import { buildCoordinationEnvironments } from "./coordination.js";
import { covalentRadius } from "./elements.js";

// A display starting point, not a bond assignment. Prefer the actual periodic
// first shell over tabulated radii, which cannot account for pressure or valence.
export function estimatePairCutoff(structure, center, neighbor) {
  const fallback = Math.ceil((1.2 * (covalentRadius(center) + covalentRadius(neighbor)) + 0.1) * 100) / 100;
  if (!structure?.atoms?.length) return fallback;

  // Symmetry copies normally share a CIF label. Include each independent site
  // before sampling unusually large structures, regardless of plotted extent.
  const sites = new Map();
  for (const [index, atom] of structure.atoms.entries())
    if (atom.element === center && !sites.has(atom.label ?? index))
      sites.set(atom.label ?? index, atom);
  const unique = [...sites.values()];
  const centres = unique.length <= 64 ? unique : Array.from(
    { length: 64 }, (_, i) => unique[Math.floor(i * unique.length / 64)],
  );
  if (!centres.length) return fallback;

  try {
    const search = (cutoff) => buildCoordinationEnvironments({
      basis: structure.basis, atoms: structure.atoms, centres,
      centerElement: center, neighborElement: neighbor, cutoff,
      maxImages: 150000, maxNeighbors: 100000,
    });
    const reach = Math.min(10, Math.max(6, fallback * 1.7));
    let environments = search(reach);
    if (reach < 12 && environments.some((e) => !e.neighbors.length))
      environments = search(12);
    let outer = 0, next = Infinity;
    for (const environment of environments) {
      // Ignore near-coincident split/disordered sites rather than interpreting
      // them as an extremely short first coordination shell.
      const distances = environment.neighbors.map((n) => n.distance).filter((d) => d >= 0.3);
      if (!distances.length) continue;
      let end = distances[0];
      for (const distance of distances.slice(1)) {
        const gap = distance - end;
        if (distance > distances[0] * 1.4 || gap > Math.max(0.2, end * 0.18)) {
          next = Math.min(next, distance);
          break;
        }
        end = distance;
      }
      outer = Math.max(outer, end);
    }
    if (!outer) return fallback;
    // Include the most extended site's shell with a small margin, staying
    // below the next shell when one cutoff can separate every sampled site.
    let margin = Math.max(0.08, outer * 0.05);
    if (next > outer) margin = Math.min(margin, (next - outer) * 0.4);
    return Math.max(0.1, Math.ceil((outer + margin) * 100) / 100);
  } catch {
    // Pathological/dense lattices still get a cheap, element-specific default;
    // the bounded coordination search must not prevent editing a pair.
    return fallback;
  }
}
