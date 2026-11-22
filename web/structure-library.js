import { desktop, saveBlob } from "./desktop.js";
import entries from './structure-library.json' with { type: 'json' };
import { formatSpaceGroup, formulaLabel } from './structure-notation.js';

export const structureLibrary = entries;
export const libraryEntry = (id) => entries.find((entry) => entry.id === id);
export const libraryFilename = (entry) => `Library · ${entry.name} · ${entry.source.label}`;
export const entryForFilename = (filename) => entries.find((entry) => libraryFilename(entry) === filename);

const normalize = (text) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function searchLibrary(query = '', collection = '') {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => (!collection || entry.collections.includes(collection)) &&
    terms.every((term) => normalize([
      entry.name, entry.formula, entry.family, entry.description, entry.spaceGroup, formatSpaceGroup(entry.spaceGroup),
      ...entry.aliases, entry.source.label,
    ].join(' ')).includes(term)));
}

export function createStructureLibrary({ onSelect, isBusy }) {
  const dialog = document.getElementById('structure-library');
  const opener = document.getElementById('library-open');
  const search = document.getElementById('library-search');
  const close = document.getElementById('library-close');
  const collection = document.getElementById('library-collection');
  const results = document.getElementById('library-results');
  const count = document.getElementById('library-count');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  function render() {
    const matches = searchLibrary(search.value, collection.value);
    count.textContent = `${matches.length} of ${entries.length} structures`;
    results.replaceChildren(...matches.map((entry) => {
      const card = el('article', 'library-card');
      const button = el('button', 'library-select');
      button.type = 'button';
      button.dataset.structure = entry.id;
      button.setAttribute('aria-label', `Open ${entry.name}`);
      const formula = el('span', 'library-formula');
      formula.append(formulaLabel(entry.formula));
      button.append(el('strong', '', entry.name), formula);
      button.onclick = () => {
        if (isBusy()) return;
        dialog.close();
        onSelect(entry);
      };
      card.append(button, el('p', 'library-meta', `${entry.family} · ${formatSpaceGroup(entry.spaceGroup)}`),
        el('p', 'library-description', entry.description));
      const details = el('details', 'library-reference');
      details.append(el('summary', '', `${entry.kind} · ${entry.source.label}`));
      details.append(el('p', '', entry.source.citation));
      const link = el('a', '', 'Source record ↗');
      link.href = entry.source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const download = el('a', '', 'CIF ↓');
      download.href = `${import.meta.env.BASE_URL}${entry.file}`;
      download.download = `${entry.id}.cif`;
      if (desktop) download.onclick = async event => {
        event.preventDefault();
        try {
          const response = await fetch(download.href);
          if (!response.ok) throw Error("The bundled CIF could not be read.");
          await saveBlob(await response.blob(), download.download);
        } catch (error) { count.textContent = error.message; }
      };
      details.append(link, document.createTextNode(' · '), download);
      card.append(details);
      return card;
    }));
    if (!matches.length) results.append(el('p', 'library-empty', 'No matches. Try a mineral name, formula, structure type, or family.'));
  }
  search.addEventListener('input', render);
  collection.addEventListener('change', render);
  opener.onclick = event => {
    if (isBusy()) return;
    render();
    // Choose initial focus before opening so touch browsers never focus a
    // text field until the user taps Search.
    close.autofocus = matchMedia('(pointer: coarse)').matches ||
      event.pointerType === 'touch' || event.pointerType === 'pen';
    search.autofocus = !close.autofocus;
    dialog.showModal();
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => opener.focus());
}
