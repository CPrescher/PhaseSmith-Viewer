// Measured intensity stays in source units. Only the overlay is normalized.
export function readPowderTrace(text) {
  const points = [];
  for (const [index, line] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const data = line.split(/[#;]/, 1)[0].trim();
    if (!data || data.startsWith("!")) continue;
    const fields = data.includes(",") ? data.split(",").map(field => field.trim()) : data.split(/\s+/);
    if (!points.length && /[a-zθ]/i.test(fields[0]) && /intens|counts/i.test(fields[1])) continue;
    const [angle, intensity] = fields.map(Number);
    if (!fields[0] || !fields[1] || !Number.isFinite(angle) || !Number.isFinite(intensity) || angle < 0 || angle > 180)
      throw Error("Expected 2θ in degrees and intensity on line " + (index + 1) + ".");
    points.push([angle, intensity]);
    if (points.length > 100000) throw Error("The measured trace exceeds 100,000 points.");
  }
  if (points.length < 2) throw Error("A measured trace needs at least two points.");
  return points.sort((a,b) => a[0] - b[0]);
}

// A powder line may include inequivalent families at the same d spacing.
// The reciprocal orbit uses Rᵀh for each direct-space operation and Friedel mates.
export function powderFamilies(hkls, operations) {
  const seen = new Set(), representatives = [];
  const ordered = hkls.slice().sort((a,b) => a.filter(v => v < 0).length - b.filter(v => v < 0).length || b[0]-a[0] || b[1]-a[1]);
  for (const hkl of ordered) {
    if (seen.has(hkl.join())) continue;
    representatives.push(hkl);
    const add = h => { seen.add(h.join()); seen.add(h.map(v => -v).join()); };
    add(hkl);
    for (const {rotation} of operations ?? [])
      add([0,1,2].map(i => hkl.reduce((sum,v,j) => sum + v * rotation[j][i], 0)));
  }
  return representatives;
}
