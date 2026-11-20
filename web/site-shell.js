import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
import { firstShellSize } from "./pair-defaults.js";
import { hullVolume, toCartesian } from "./crystal-math.js";

// A radial shell includes every species, independently of element-pair drawing rules.
export function siteShell(structure, center, cutoff) {
  const [{ neighbors }] = buildCoordinationEnvironments({
    basis: structure.basis, atoms: structure.atoms.filter(a => (a.occupancy ?? 1) > 0),
    centres: [center], cutoff: cutoff ?? 6, maxNeighbors: 10000,
  });
  const shell = cutoff == null
    ? neighbors.slice(0, firstShellSize(neighbors.map(n => n.distance))) : neighbors;
  const points = shell.map(n => n.cartesian);
  const hull = convexHull(points, toCartesian(structure.basis, center.frac));
  const edges = hull?.edges ?? [];
  const mean = shell.length ? shell.reduce((n, v) => n + v.distance, 0) / shell.length : null;
  const distortion = mean ? shell.reduce((n, v) => n + Math.abs(v.distance - mean), 0) / (mean * shell.length) : null;
  const groups = [];
  for (const n of shell) {
    const last = groups.find(g => g.atom.siteIndex === n.atom.siteIndex && g.atom.label === n.atom.label && Math.abs(g.distance - n.distance) < 0.00005);
    if (last) last.count++;
    else groups.push({atom: n.atom, distance: n.distance, count: 1});
  }
  return { groups, count: shell.length, mean, distortion, points, edges,
    volume: hull && !hull.planar ? hullVolume(points, hull.faces) : null,
    partial: shell.some(n => (n.atom.occupancy ?? 1) !== 1) };
}
