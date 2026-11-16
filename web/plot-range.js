export const defaultRanges = () => [
  [0, 1],
  [0, 1],
  [0, 1],
];
export function validateRanges(ranges) {
  if (
    ranges.length !== 3 ||
    ranges.some(
      (r) =>
        r.length !== 2 ||
        r.some(
          (v) =>
            !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER / 1e9,
        ) ||
        r[0] >= r[1],
    )
  )
    throw Error(
      "Each minimum must be less than its maximum; use finite values with magnitude below 9 million to preserve coordinate precision.",
    );
  if (
    ranges.reduce((n, [lo, hi]) => n * (Math.ceil(hi) - Math.floor(lo)), 1) >
    10000
  )
    throw Error(
      "This range spans too many cells. Reduce the plotting range (limit 10,000 cells).",
    );
  return ranges.map((r) => [...r]);
}
export function translatedSites(
  atoms,
  ranges,
  boundary,
  limit = Math.max(50000, atoms.length * 8),
) {
  validateRanges(ranges);
  const plans = atoms.map((atom, sourceIndex) => {
    const spans = atom.frac.map((f, i) => {
      const [lo, hi] = ranges[i];
      // Compare the translated position itself: 2.01 - 0.01 can round
      // just below 2 even when the displayed image lies exactly on 2.01.
      let first = Math.floor(lo - f);
      if (f + first < lo) first++;
      let last = Math.ceil(hi - f);
      const lastPosition = f + last;
      if (boundary ? lastPosition > hi : lastPosition >= hi) last--;
      return [first, last];
    });
    return { atom, sourceIndex, spans };
  });
  const total = plans.reduce(
    (n, p) =>
      n + p.spans.reduce((m, [lo, hi]) => m * Math.max(0, hi - lo + 1), 1),
    0,
  );
  if (total > limit)
    throw Error(
      `This range contains too many atoms (limit ${limit.toLocaleString()}). Reduce the plotting range.`,
    );
  const result = [];
  for (const {
    atom,
    sourceIndex,
    spans: [a, b, c],
  } of plans) {
    if (a[0] > a[1] || b[0] > b[1] || c[0] > c[1]) continue;
    for (let x = a[0]; x <= a[1]; x++)
      for (let y = b[0]; y <= b[1]; y++)
        for (let z = c[0]; z <= c[1]; z++)
          result.push({
            ...atom,
            sourceIndex,
            frac: atom.frac.map((v, i) => v + [x, y, z][i]),
          });
  }
  return result;
}
// All cell edges inside the requested fractional box; boundary planes clip partial cells.
export function rangeEdges(ranges) {
  const levels = ranges.map(([lo, hi]) => [
    lo,
    ...Array.from(
      { length: Math.max(0, Math.ceil(hi) - Math.floor(lo) - 1) },
      (_, i) => Math.floor(lo) + 1 + i,
    ).filter((v) => v > lo && v < hi),
    hi,
  ]);
  const edges = [];
  for (let axis = 0; axis < 3; axis++) {
    const others = [0, 1, 2].filter((i) => i !== axis);
    for (const u of levels[others[0]])
      for (const v of levels[others[1]]) {
        const start = [0, 0, 0],
          end = [0, 0, 0];
        start[axis] = ranges[axis][0];
        end[axis] = ranges[axis][1];
        start[others[0]] = end[others[0]] = u;
        start[others[1]] = end[others[1]] = v;
        edges.push(start, end);
      }
  }
  return edges;
}
