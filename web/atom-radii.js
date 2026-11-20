import { covalentRadius } from "./elements.js";

// Selected effective ionic radii in Å from R. D. Shannon (1976), Table 1.
// https://doi.org/10.1107/S0567739476001551
// Each row starts with the display preset for that charge. Coordination and
// spin are choices for drawing the structure, independent of active pair rules.
const ionRows = [
  ["Li", 1, { VI: 0.76, IV: 0.59, VIII: 0.92 }],
  ["Be", 2, { IV: 0.27, VI: 0.45 }],
  ["B", 3, { IV: 0.11, III: 0.01, VI: 0.27 }],
  ["O", -2, { VI: 1.40, II: 1.35, III: 1.36, IV: 1.38, VIII: 1.42 }],
  ["F", -1, { VI: 1.33, II: 1.285, III: 1.30, IV: 1.31 }],
  ["Na", 1, { VI: 1.02, IV: 0.99, V: 1.00, VII: 1.12, VIII: 1.18, IX: 1.24, XII: 1.39 }],
  ["Mg", 2, { VI: 0.72, IV: 0.57, V: 0.66, VIII: 0.89 }],
  ["Al", 3, { VI: 0.535, IV: 0.39, V: 0.48 }],
  ["Si", 4, { IV: 0.26, VI: 0.40 }],
  ["P", 5, { IV: 0.17, V: 0.29, VI: 0.38 }],
  ["S", -2, { VI: 1.84 }],
  ["S", 6, { IV: 0.12, VI: 0.29 }],
  ["Cl", -1, { VI: 1.81 }],
  ["K", 1, { VI: 1.38, IV: 1.37, VII: 1.46, VIII: 1.51, IX: 1.55, X: 1.59, XII: 1.64 }],
  ["Ca", 2, { VI: 1.00, VII: 1.06, VIII: 1.12, IX: 1.18, X: 1.23, XII: 1.34 }],
  ["Ti", 3, { VI: 0.67 }],
  ["Ti", 4, { VI: 0.605, IV: 0.42, V: 0.51, VIII: 0.74 }],
  ["Cr", 3, { VI: 0.615 }],
  ["Mn", 2, { VI_HS: 0.83, VI_LS: 0.67, IV_HS: 0.66, VIII: 0.96 }],
  ["Mn", 3, { VI_HS: 0.645, VI_LS: 0.58 }],
  ["Mn", 4, { VI: 0.53, IV: 0.39 }],
  ["Fe", 2, { VI_HS: 0.78, VI_LS: 0.61, IV_HS: 0.63, VIII_HS: 0.92 }],
  ["Fe", 3, { VI_HS: 0.645, VI_LS: 0.55, IV_HS: 0.49, V: 0.58, VIII_HS: 0.78 }],
  ["Co", 2, { VI_HS: 0.745, VI_LS: 0.65, IV_HS: 0.58 }],
  ["Ni", 2, { VI: 0.69, IV: 0.55, V: 0.63 }],
  ["Cu", 1, { VI: 0.77, II: 0.46, IV: 0.60 }],
  ["Cu", 2, { VI: 0.73, IV: 0.57, V: 0.65 }],
  ["Zn", 2, { IV: 0.60, VI: 0.74, V: 0.68, VIII: 0.90 }],
  ["Br", -1, { VI: 1.96 }],
  ["Rb", 1, { VI: 1.52, VIII: 1.61, XII: 1.72 }],
  ["Sr", 2, { VI: 1.18, VIII: 1.26, XII: 1.44 }],
  ["Zr", 4, { VIII: 0.84, IV: 0.59, VI: 0.72, VII: 0.78, IX: 0.89 }],
  ["I", -1, { VI: 2.20 }],
  ["Cs", 1, { VIII: 1.74, VI: 1.67, XII: 1.88 }],
  ["Ba", 2, { VIII: 1.42, VI: 1.35, XII: 1.61 }],
];

const entries = new Map();
for (const [element, charge, values] of ionRows) {
  if (!entries.has(element)) entries.set(element, []);
  for (const [environment, radius] of Object.entries(values)) {
    const [cn, spin] = environment.split("_");
    const ion = element + Math.abs(charge) + (charge > 0 ? "+" : "−");
    const spinText = spin === "HS" ? " high spin" : spin === "LS" ? " low spin" : "";
    entries.get(element).push({
      key: charge + "/" + environment, charge, radius,
      label: ion + " · CN " + cn + spinText + " · " + radius + " Å",
    });
  }
}

export const ionicEntries = (element) => entries.get(element) ?? [];

const classic = new Map(Object.entries({
  H: 0.22, C: 0.37, N: 0.36, O: 0.34, Na: 0.52, Mg: 0.48,
  Al: 0.45, Si: 0.43, K: 0.60, Ca: 0.56, Fe: 0.45,
}));

// Apply uncharged mineral presets only in compounds containing both a likely
// cation and an anion. Leave multivalent ions such as Fe to the site editor.
const anions = new Set(["O", "F", "Cl", "Br", "I", "S"]);
const mineralCharges = new Map(Object.entries({
  Li: 1, Be: 2, B: 3, O: -2, F: -1, Na: 1, Mg: 2, Al: 3, Si: 4, P: 5,
  Cl: -1, K: 1, Ca: 2, Zn: 2, Br: -1, Rb: 1, Sr: 2, Zr: 4, I: -1, Cs: 1, Ba: 2,
}));

export function hasMineralIonPair(sites) {
  return sites.some(s => anions.has(s.element)) &&
    sites.some(s => entries.has(s.element) && !anions.has(s.element));
}

export function radiusReference(site, model, mineral, choice) {
  const { element, charge } = site;
  const covalent = covalentRadius(element);
  const fallback = { radius: covalent, label: "Covalent · " + covalent + " Å" };
  if (model === "classic") return { radius: classic.get(element) ?? 0.42, label: "Classic" };
  if (model === "covalent" || choice === "covalent") return fallback;
  const options = ionicEntries(element);
  const manual = options.find(entry => entry.key === choice);
  if (manual) return manual;
  const displayCharge = charge ?? (mineral ? mineralCharges.get(element) : undefined);
  const automatic = options.find(entry => entry.charge === displayCharge);
  if (!automatic) {
    const reason = charge == null ? "Covalent fallback" : "Covalent fallback (CIF charge " + charge + ")";
    return { radius: covalent, label: reason + " · " + covalent + " Å" };
  }
  const source = charge == null ? "Mineral preset" : "CIF charge, preset environment";
  return { radius: automatic.radius, label: automatic.label, source };
}
