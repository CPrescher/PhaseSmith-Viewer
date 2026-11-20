const symmetrySources = {
  explicit_operations: "Operations listed in the CIF",
  hermann_mauguin: "Hermann–Mauguin symbol",
  hall: "Hall symbol",
  international_number: "International Tables number",
  assumed_p1: "P 1 assumed during import",
};

function rows(id, entries) {
  const list = document.getElementById(id);
  list.replaceChildren();
  for (const [label, value] of entries) {
    if (value == null || value === "") continue;
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.append(value);
    list.append(term, detail);
  }
}

export function createStructureInfo() {
  const $ = id => document.getElementById(id);
  const button = $("structure-info-open");
  const dialog = $("structure-info");
  button.addEventListener("click", () => dialog.showModal());
  $("structure-info-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  return (structure, name, filename, reference) => {
    const meta = structure.metadata;
    const assumed = meta.symmetry_source === "assumed_p1";
    const symbol = assumed ? "P 1 (assumed)" : meta.space_group_hm || structure.matchedGroup?.symbol;
    const number = meta.space_group_number || structure.matchedGroup?.number;
    const operations = structure.symmetryOperations.length;
    const group = symbol || (number ? `No. ${number}` : meta.space_group_hall || `${operations} sym. op.`);
    $("space-group-symbol").textContent = group;
    button.setAttribute("aria-label", `Structure info for ${name}, ${group}`);
    button.disabled = false;
    $("info-name").textContent = name;
    const parameters = ["a", "b", "c", "α", "β", "γ"].map((label, i) => {
      const uncertainty = structure.cellUncertainties[i];
      const unit = i < 3 ? " Å" : "°";
      const value = structure.cellParameters[i];
      return [label, (uncertainty == null ? String(value) : `${value} ± ${Number(uncertainty.toPrecision(12))}`) + unit];
    });
    rows("info-cell", [...parameters, ["Volume", structure.volume.toFixed(3) + " Å³"]]);
    rows("info-symmetry", [
      ["Space group", symbol || (number || meta.space_group_hall ? null : "Symbol not reported")],
      ["International Tables No.", number],
      ["Hall symbol", meta.space_group_hall],
      ["Crystal system", structure.crystalSystem],
      ["Symmetry taken from", symmetrySources[meta.symmetry_source]],
      ["Symmetry operations", operations],
      ["Formula in CIF", meta.chemical_formula_sum || meta.chemical_formula_structural],
      ["Formula units per cell (Z)", meta.formula_units_per_cell],
      ["Independent sites", structure.independentSites.length],
      ["Positions in unit cell", structure.atoms.length],
    ]);
    let citation;
    if (reference) {
      citation = document.createElement("a");
      citation.href = reference.source.url;
      citation.target = "_blank";
      citation.rel = "noopener noreferrer";
      citation.textContent = reference.source.citation;
    }
    rows("info-source", [["File", reference?.file.split("/").pop() || filename], ["CIF data block", structure.block], ["Reference", citation]]);
    $("info-warnings").textContent = structure.warnings.join(" ");
    $("info-warnings").hidden = !structure.warnings.length;
  };
}
