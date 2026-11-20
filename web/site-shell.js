import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
import { Vector3 } from "three";
import { firstShellSize } from "./pair-defaults.js";
import { hullVolume } from "./crystal-math.js";

// Project a flat shell onto its plane and trace the 2D convex hull. A
// carbonate triangle and a square-planar shell both have zero enclosed volume.
function planarEdges(points) {
  if (points.length < 3) return [];
  const origin = new Vector3(...points[0]);
  const offsets = points.map(p => new Vector3(...p).sub(origin));
  const x = offsets.find(p => p.lengthSq() > 1e-16)?.clone().normalize();
  if (!x) return [];
  const normal = new Vector3();
  if (!offsets.some(p => normal.crossVectors(x, p).lengthSq() > 1e-16)) return [];
  const y = normal.normalize().cross(x);
  const projected = offsets.map((p, index) => ({ x: p.dot(x), y: p.dot(y), index }));
  projected.sort((a, b) => a.x - b.x || a.y - b.y);
  const halfHull = sequence => {
    const chain = [];
    for (const p of sequence) {
      while (chain.length >= 2) {
        const a = chain.at(-2), b = chain.at(-1);
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 1e-10) break;
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  const outline = [...halfHull(projected), ...halfHull(projected.reverse())];
  return outline.map((p, i) => [p.index, outline[(i + 1) % outline.length].index]);
}

// A radial shell includes every species, independently of element-pair drawing rules.
export function siteShell(structure, center, cutoff) {
  const [{ neighbors }] = buildCoordinationEnvironments({
    basis: structure.basis, atoms: structure.atoms.filter(a => (a.occupancy ?? 1) > 0),
    centres: [center], cutoff: cutoff ?? 6, maxNeighbors: 10000,
  });
  const shell = cutoff == null
    ? neighbors.slice(0, firstShellSize(neighbors.map(n => n.distance))) : neighbors;
  const points = shell.map(n => n.cartesian);
  const hull = convexHull(points);
  const edges = hull?.edges ?? planarEdges(points);
  const mean = shell.length ? shell.reduce((n, v) => n + v.distance, 0) / shell.length : null;
  const distortion = mean ? shell.reduce((n, v) => n + Math.abs(v.distance - mean), 0) / (mean * shell.length) : null;
  const groups = [];
  for (const n of shell) {
    const last = groups.find(g => g.atom.siteIndex === n.atom.siteIndex && g.atom.label === n.atom.label && Math.abs(g.distance - n.distance) < 0.00005);
    if (last) last.count++;
    else groups.push({atom: n.atom, distance: n.distance, count: 1});
  }
  return { groups, count: shell.length, mean, distortion, points, edges,
    volume: hull ? hullVolume(points, hull.faces) : null,
    partial: shell.some(n => (n.atom.occupancy ?? 1) !== 1) };
}
