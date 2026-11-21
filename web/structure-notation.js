import { formatMillerIndices } from "./crystal-math.js";

const subscripts = "₀₁₂₃₄₅₆₇₈₉";

export function formatSpaceGroup(symbol, matchedSymbol) {
  // Only use the reference token boundaries when the reported setting agrees.
  // For example, P 3 2 1 and P 32 2 1 have different symmetry axes.
  let [axes, setting] = symbol.trim().split(/\s*:\s*/, 2);
  const reported = axes.replace(/^([PABCIFRH])\s+/, "$1");
  if (matchedSymbol && reported === matchedSymbol.replace(/\s/g, "")) {
    axes = matchedSymbol;
  }
  const compact = axes
    .replace(/[-−]([1346])/g, (_, axis) => formatMillerIndices([-Number(axis)]))
    .replace(/(?<![\d\u0305])(2_?1|3_?[12]|4_?[123]|6_?[1-5])(?=[\s/a-z]|$)/g, screw =>
      screw[0] + subscripts[screw.at(-1)])
    .replace(/\s+/g, "");
  return setting ? `${compact}:${setting}` : compact;
}

// Preserve the reported composition, including fractional occupancies and
// hydrate coefficients. Leave unfamiliar CIF notation intact.
export function formulaLabel(formula) {
  const label = document.createDocumentFragment();
  for (const [index, component] of formula.split("·").entries()) {
    if (index) label.append("·");
    const text = component.trim();
    const coefficient = text.match(/^\d+(?:\.\d+)?/)?.[0] || "";
    label.append(coefficient);

    // Subscript a count only after an element or a closing bracket.
    const terms = /\s*(?:([A-Z][a-z]?|[)\]])(\d+(?:\.\d+)?)?|([(\[,]))/gy;
    terms.lastIndex = coefficient.length;
    while (terms.lastIndex < text.length) {
      const term = terms.exec(text);
      if (!term) return document.createTextNode(formula);
      const [, atomOrBracket, count, punctuation] = term;
      label.append(atomOrBracket || punctuation);
      if (count) {
        const sub = document.createElement("sub");
        sub.textContent = count;
        label.append(sub);
      }
    }
  }
  return label;
}
