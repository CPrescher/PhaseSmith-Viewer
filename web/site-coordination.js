import { buildCoordinationEnvironments } from "./coordination.js";
import { firstShellSize } from "./pair-defaults.js";
import { shellPolarity } from "./atom-radii.js";

// Assess cation shells once in the periodic crystal. Count the same contacts
// back onto anions; each independent site represents its full multiplicity.
export function createSiteCoordination(structure, sites) {
  let counts = new Map();
  const hasOxygen = sites.some(site => site.element === "O");
  // Bare sulfur can occur as sulfide or as a cation in an oxyanion.
  const ambiguousSulfur = hasOxygen && sites.some(site => site.element === "S" && site.charge == null);
  const positive = sites.filter(site => shellPolarity(site) > 0);
  const negative = new Set(sites.filter(site => shellPolarity(site) < 0).map(site => site.label));
  // Unclassified or partially occupied sites can give incomplete or
  // mutually exclusive neighbors. Keep these structures on labeled presets.
  if (ambiguousSulfur || !positive.length || !negative.size || positive.length + negative.size !== sites.length ||
      sites.some(site => (site.occupancy ?? 1) !== 1)) return () => counts;

  const cations = new Set(positive.map(site => site.element));
  const anions = new Set(sites.filter(site => negative.has(site.label)).map(site => site.element));
  const ligands = structure.atoms.filter(atom => negative.has(atom.label));
  const multiplicity = new Map();
  for (const atom of structure.atoms)
    multiplicity.set(atom.label, (multiplicity.get(atom.label) ?? 0) + 1);

  let searchRadius = 0, shells = [], lastRules;
  return rules => {
    const cutoffs = new Map();
    for (const {center, neighbor, cutoff} of rules) {
      let key;
      if (cations.has(center) && anions.has(neighbor)) key = center + "|" + neighbor;
      else if (anions.has(center) && cations.has(neighbor)) key = neighbor + "|" + center;
      else continue;
      // Repeated or reversed rules describe the union of the same contacts.
      cutoffs.set(key, Math.max(cutoffs.get(key) ?? 0, cutoff));
    }
    const signature = JSON.stringify([...cutoffs]);
    if (signature === lastRules) return counts;
    lastRules = signature;
    counts = new Map();
    const reach = Math.max(6, ...cutoffs.values());
    if (reach > searchRadius || (!shells && reach < searchRadius)) {
      searchRadius = reach;
      try {
        shells = buildCoordinationEnvironments({
          basis: structure.basis, atoms: ligands, centres: positive, cutoff: reach,
          maxImages: 150000, maxNeighbors: 100000,
        });
      } catch {
        shells = null;
      }
    }
    if (!shells) return counts;
    const incoming = new Map();
    for (const {center, neighbors} of shells) {
      // Keep the automatic first-shell search independent of other pairs'
      // explicit cutoff distances and of the largest previously cached reach.
      const distances = neighbors.filter(n => n.distance >= 0.3 && n.distance <= 6).map(n => n.distance);
      const edge = distances[firstShellSize(distances) - 1] ?? 0;
      let count = 0;
      for (const {atom, distance} of neighbors) {
        const limit = cutoffs.get(center.element + "|" + atom.element) ?? edge;
        if (distance < 0.3 || distance > limit + 1e-10) continue;
        count++;
        incoming.set(atom.label, (incoming.get(atom.label) ?? 0) + multiplicity.get(center.label));
      }
      counts.set(center.label, count);
    }
    for (const label of negative) {
      const count = (incoming.get(label) ?? 0) / multiplicity.get(label);
      if (Number.isInteger(count)) counts.set(label, count);
    }
    return counts;
  };
}
