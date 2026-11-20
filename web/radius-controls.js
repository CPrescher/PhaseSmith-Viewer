import { hasMineralIonPair, ionicEntries, neutralAtomRadius, radiusReference } from "./atom-radii.js";

import { createSiteCoordination } from "./site-coordination.js";

// One radius per independent CIF site. Symmetry mates and translated images
// share the lookup, while existing element/copy appearance scales stay local.
export function createRadiusControls(onChange) {
  const model = document.getElementById("radius-model");
  const atomicNote = document.getElementById("atomic-radius-note");
  const details = document.getElementById("radius-details");
  const siteMenu = document.getElementById("radius-site");
  const entryMenu = document.getElementById("radius-entry");
  let sites = [], mineral = false;
  let assessCoordination, coordination = new Map();
  let missingAtomicRadii = [];
  const overrides = new Map();
  const radii = new Map();

  function updateRadii() {
    radii.clear();
    for (const site of sites) {
      const reference = radiusReference(site, model.value, mineral, overrides.get(site.label), coordination.get(site.label));
      radii.set(site.label, reference.radius);
    }
    atomicNote.hidden = model.value !== "atomic" || !missingAtomicRadii.length;
    if (!atomicNote.hidden)
      atomicNote.textContent = "Neutral-atom data unavailable for " + missingAtomicRadii.join(", ") +
        ". These elements use a schematic radius of 0.42 Å.";
    details.hidden = !["ionic", "crystal"].includes(model.value) || !sites.length;
    if (!details.hidden && details.open) updateEntries();
  }

  function updateEntries() {
    const site = sites[siteMenu.selectedIndex];
    if (!site) return;
    const automatic = radiusReference(site, model.value, mineral, undefined, coordination.get(site.label));
    const covalent = radiusReference(site, "covalent", mineral);
    const choices = [
      new Option("Auto · " + automatic.label, ""),
      new Option(covalent.label, "covalent"),
      ...ionicEntries(site.element, model.value).map(entry => new Option(entry.label, entry.key)),
    ];
    entryMenu.replaceChildren(...choices);
    entryMenu.value = overrides.get(site.label) ?? "";
    const source = document.getElementById("radius-source");
    source.textContent = !entryMenu.value && automatic.source ? automatic.source : "";
    source.hidden = !source.textContent;
  }

  function updateSites() {
    const options = document.createDocumentFragment();
    for (const site of sites) options.append(new Option(site.label + " (" + site.element + ")", site.label));
    siteMenu.replaceChildren(options);
    updateEntries();
  }

  details.ontoggle = () => {
    if (details.open && !siteMenu.options.length) updateSites();
  };
  siteMenu.onchange = updateEntries;
  entryMenu.onchange = () => {
    const site = sites[siteMenu.selectedIndex];
    if (!site) return;
    if (entryMenu.value) overrides.set(site.label, entryMenu.value);
    else overrides.delete(site.label);
    updateRadii();
    onChange();
  };
  model.onchange = () => {
    updateRadii();
    onChange();
  };

  return {
    radius: atom => radii.get(atom.label),
    updateCoordination(rules) {
      const assessed = assessCoordination(rules);
      if (assessed !== coordination) {
        coordination = assessed;
        updateRadii();
      }
    },
    setSites(nextSites, structure) {
      sites = nextSites;
      mineral = hasMineralIonPair(sites);
      assessCoordination = createSiteCoordination(structure, sites);
      coordination = new Map();
      missingAtomicRadii = [...new Set(sites.map(site => site.element))].filter(e => neutralAtomRadius(e) === undefined);
      overrides.clear();
      siteMenu.replaceChildren();
      if (details.open) updateSites();
      updateRadii();
    },
    snapshot() {
      return {
        radiusModel: model.value,
        siteRadii: [...overrides].sort(([a], [b]) => a.localeCompare(b)),
      };
    },
    restore(state) {
      // A missing or retired model opens with the same default as a new project.
      const index = Array.from(model.options).findIndex(option => option.value === state.radiusModel);
      model.selectedIndex = Math.max(0, index);
      overrides.clear();
      const saved = new Map(Array.isArray(state.siteRadii)
        ? state.siteRadii.filter(pair => Array.isArray(pair) && pair.length === 2) : []);
      for (const site of sites) {
        const key = saved.get(site.label);
        if (key === "covalent" || ionicEntries(site.element).some(entry => entry.key === key))
          overrides.set(site.label, key);
      }
      updateRadii();
    },
  };
}
