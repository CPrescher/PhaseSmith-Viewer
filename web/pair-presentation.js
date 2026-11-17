// Display conventions only: favor common anion partners on the right,
// always putting oxygen last. No oxidation states are inferred from a CIF.
const ANION_ORDER = { N: 1, Te: 2, Se: 3, S: 4, At: 5, I: 6, Br: 7, Cl: 8, F: 9, O: 10 };
export function pairName(a, b) {
  return [a, b].sort((x, y) => (ANION_ORDER[x] ?? 0) - (ANION_ORDER[y] ?? 0) || x.localeCompare(y)).join("–");
}

// Accept the old alphabetical filter names in saved sessions/projects too.
export function normalizePair(name) {
  if (typeof name !== "string" || name === "all") return name;
  const elements = name.split(/[–-]/);
  return elements.length === 2 ? pairName(...elements) : name;
}

/** Assign colors from the complete structure's pair list, not the current
 * range/filter, so recalculating or selecting one pair never changes colors.
 * The first twelve use theme-adjusted categorical colors; extra pairs get
 * additional deterministic hues instead of reusing the same twelve colors.
 */
export function pairColors(names) {
  return new Map([...new Set(names.map(normalizePair))].sort().map((name, index) => [
    name, index < 12 ? `var(--analysis-pair-${index})` : `hsl(${(index * 137.508) % 360} 58% 48%)`,
  ]));
}

/** Mixed-pair distance groups retain one total-height stick, with a colored
 * segment for each contribution. Neither x positions nor totals change. */
export function pairSegments(row) {
  let from = 0;
  return Object.entries(row.pairs).sort(([a], [b]) => a.localeCompare(b)).map(([pair, count]) => {
    const segment = { pair, count, from, to: from + count };
    from += count;
    return segment;
  });
}
