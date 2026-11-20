import { hasMineralIonPair, ionicEntries, radiusReference } from "./atom-radii.js";

// One radius per independent CIF site. Symmetry mates and translated images
// share the lookup, while existing element/copy appearance scales stay local.
export function createRadiusControls(onChange) {
  const model = document.getElementById("radius-model");
  const details = document.getElementById("radius-details");
  const siteMenu = document.getElementById("radius-site");
  const entryMenu = document.getElementById("radius-entry");
  let sites = [], mineral = false;
  const overrides = new Map();
  const radii = new Map();

  function updateRadii() {
    radii.clear();
    for (const site of sites) {
      const reference = radiusReference(site, model.value, mineral, overrides.get(site.label));
      radii.set(site.label, reference.radius);
    }
    details.hidden = model.value !== "ionic" || !sites.length;
    if (!details.hidden && details.open) updateEntries();
  }

  function updateEntries() {
    const site = sites[siteMenu.selectedIndex];
    if (!site) return;
    const automatic = radiusReference(site, "ionic", mineral);
    const covalent = radiusReference(site, "covalent", mineral);
    const choices = [
      new Option("Auto · " + automatic.label, ""),
      new Option(covalent.label, "covalent"),
      ...ionicEntries(site.element).map(entry => new Option(entry.label, entry.key)),
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
    setSites(nextSites) {
      sites = nextSites;
      mineral = hasMineralIonPair(sites);
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
      // Projects written before radius models used the original sphere table.
      model.value = ["ionic", "covalent"].includes(state.radiusModel) ? state.radiusModel : "classic";
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
