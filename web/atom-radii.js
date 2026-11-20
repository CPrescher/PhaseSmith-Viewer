import { covalentRadius } from "./elements.js";

// Selected effective ionic radii in Å from R. D. Shannon (1976), Table 1.
// https://doi.org/10.1107/S0567739476001551
// Each row starts with the display preset for that charge. Coordination and
// spin presets are retained when the site has no supported exact CN match.
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

const coordinationNumbers = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const entries = new Map();
const crystalEntries = new Map();
for (const [element, charge, values] of ionRows) {
  if (!entries.has(element)) {
    entries.set(element, []);
    crystalEntries.set(element, []);
  }
  for (const [environment, radius] of Object.entries(values)) {
    const [cn, spin] = environment.split("_");
    const ion = element + Math.abs(charge) + (charge > 0 ? "+" : "−");
    const spinText = spin === "HS" ? " high spin" : spin === "LS" ? " low spin" : "";
    // Shannon (1976), Table 1: moving the anion reference by −0.14 Å
    // adds the same distance to each cation on the crystal-radius scale.
    const crystalRadius = Number((radius + Math.sign(charge) * 0.14).toFixed(3));
    for (const [table, value] of [[entries, radius], [crystalEntries, crystalRadius]]) {
      table.get(element).push({
        key: charge + "/" + environment, charge, cn: coordinationNumbers.indexOf(cn), spin, radius: value,
        label: ion + " · CN " + cn + spinText + " · " + value + " Å",
      });
    }
  }
}

export const ionicEntries = (element, model = "ionic") =>
  (model === "crystal" ? crystalEntries : entries).get(element) ?? [];

// Neutral free-atom radii (Å) at an electron density of 0.001 e/bohr³.
// Rahm, Hoffmann & Ashcroft (2016), Table S1, with the 2017 corrections.
// https://rahmlab.com/radii-of-the-elements/ · doi:10.1002/chem.201700610
const freeAtoms = new Map(Object.entries({
  H: 1.54, He: 1.34, Li: 2.20, Be: 2.19, B: 2.05, C: 1.90, N: 1.79,
  O: 1.71, F: 1.63, Ne: 1.56, Na: 2.25, Mg: 2.40, Al: 2.39, Si: 2.32,
  P: 2.23, S: 2.14, Cl: 2.06, Ar: 1.97, K: 2.34, Ca: 2.70, Sc: 2.63,
  Ti: 2.57, V: 2.52, Cr: 2.33, Mn: 2.42, Fe: 2.37, Co: 2.33, Ni: 2.29,
  Cu: 2.17, Zn: 2.22, Ga: 2.33, Ge: 2.34, As: 2.31, Se: 2.24, Br: 2.19,
  Kr: 2.12, Rb: 2.40, Sr: 2.79, Y: 2.74, Zr: 2.69, Nb: 2.51, Mo: 2.44,
  Tc: 2.52, Ru: 2.37, Rh: 2.33, Pd: 2.15, Ag: 2.25, Cd: 2.38, In: 2.46,
  Sn: 2.48, Sb: 2.46, Te: 2.42, I: 2.38, Xe: 2.32, Cs: 2.49, Ba: 2.93,
  La: 2.84, Ce: 2.82, Pr: 2.86, Nd: 2.84, Pm: 2.83, Sm: 2.80, Eu: 2.80,
  Gd: 2.77, Tb: 2.76, Dy: 2.75, Ho: 2.73, Er: 2.72, Tm: 2.71, Yb: 2.77,
  Lu: 2.70, Hf: 2.64, Ta: 2.58, W: 2.53, Re: 2.49, Os: 2.44, Ir: 2.40,
  Pt: 2.30, Au: 2.26, Hg: 2.29, Tl: 2.42, Pb: 2.49, Bi: 2.50, Po: 2.50,
  At: 2.47, Rn: 2.43, Fr: 2.58, Ra: 2.92, Ac: 2.93, Th: 2.88, Pa: 2.85,
  U: 2.83, Np: 2.81, Pu: 2.78, Am: 2.76, Cm: 2.76,
}));

export const neutralAtomRadius = element => freeAtoms.get(element);

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

// Only the sign is needed to assess shells. An uncharged multivalent metal
// can contribute to an anion's CN without assigning that metal a valence.
export function shellPolarity(site) {
  if (site.charge != null) return Math.sign(site.charge);
  if (anions.has(site.element)) return -1;
  if (ionicEntries(site.element).some(entry => entry.charge > 0)) return 1;
  return 0;
}

export function radiusReference(site, model, mineral, choice, coordination) {
  const { element, charge } = site;
  const covalent = covalentRadius(element);
  const fallback = { radius: covalent, label: "Covalent · " + covalent + " Å" };
  if (model === "atomic") {
    const radius = neutralAtomRadius(element);
    return radius === undefined
      ? { radius: 0.42, label: "Schematic · 0.42 Å" }
      : { radius, label: "Neutral atom · " + radius + " Å" };
  }
  if (model === "covalent" || choice === "covalent") return fallback;
  const options = ionicEntries(element, model);
  const manual = options.find(entry => entry.key === choice);
  if (manual) return manual;
  const displayCharge = charge ?? (mineral ? mineralCharges.get(element) : undefined);
  const byCharge = options.filter(entry => entry.charge === displayCharge);
  const match = byCharge.find(entry => entry.cn === coordination);
  const automatic = match ?? byCharge[0];
  const assessed = coordination != null;
  const assessment = assessed ? "Assessed CN " + coordination : "Coordination unavailable";
  if (!automatic) {
    const reason = charge == null ? "Covalent fallback" : "Covalent fallback (CIF charge " + charge + ")";
    return { radius: covalent, label: reason + " · " + covalent + " Å", source: assessment };
  }
  const chargeSource = charge == null ? "Assumed charge" : "CIF charge";
  const environment = match ? assessment : assessment + (assessed ? " unavailable in table" : "") +
    " · Using preset CN " + automatic.cn;
  const spinSource = automatic.spin ? " · Spin preset" : "";
  return { radius: automatic.radius, label: automatic.label, source: chargeSource + " · " + environment + spinSource };
}
