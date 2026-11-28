// Command palette (⌘K / Ctrl+K), keyboard shortcut sheet (?) and global
// single-key crystallographic shortcuts. Single keys never fire while typing
// in a field or while a modal dialog is open.

function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  if (target.closest?.('textarea, select, [role="textbox"], [contenteditable="true"]')) return true;
  if (target.tagName === "INPUT") {
    return !["range", "checkbox", "radio", "button", "submit", "color", "file"].includes(target.type);
  }
  return false;
}

/** Simple subsequence + token fuzzy matcher; returns higher score for better matches, -1 if no match. */
export function fuzzyScore(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = text.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const term of terms) {
    const exactIdx = hay.indexOf(term);
    if (exactIdx >= 0) {
      total += 100 - Math.min(exactIdx, 60) + (exactIdx === 0 || /\W/.test(hay[exactIdx - 1]) ? 25 : 0);
      continue;
    }
    // Subsequence fallback
    let hi = 0;
    let consecutive = 0;
    let score = 0;
    for (let qi = 0; qi < term.length; qi++) {
      const found = hay.indexOf(term[qi], hi);
      if (found < 0) return -1;
      consecutive = found === hi ? consecutive + 1 : 0;
      score += 10 + consecutive * 5;
      hi = found + 1;
    }
    total += score;
  }
  return total;
}

export function createCommandPalette({
  dialog = document.getElementById("command-palette"),
  input = document.getElementById("command-input"),
  list = document.getElementById("command-list"),
  shortcutDialog = document.getElementById("shortcut-sheet"),
  shortcutClose = document.getElementById("shortcut-close"),
  commands = [],
  getLibrary = () => [],
  onOpenLibraryEntry = () => {},
  onAxis = () => {},
  onFit = () => {},
  onReset = () => {},
  onMeasureMode = () => {},
  onEscape = null,
  isBusy = () => false,
} = {}) {
  let registeredCommands = [...commands];
  let filtered = [];
  let activeIndex = 0;

  function buildItems(query) {
    const out = [];
    for (const cmd of registeredCommands) {
      if (cmd.enabled && !cmd.enabled()) continue;
      const searchText = [cmd.label, cmd.group || "", ...(cmd.keywords || [])].join(" ");
      const score = fuzzyScore(query, searchText);
      if (score >= 0) {
        out.push({
          score: score + 20, // Slight boost for direct actions over library items
          label: cmd.label,
          meta: cmd.group || "Action",
          shortcut: cmd.shortcut || "",
          run: cmd.run,
        });
      }
    }
    const lib = getLibrary() || [];
    for (const entry of lib) {
      const searchText = [
        entry.name,
        entry.formula || "",
        entry.family || "",
        entry.spaceGroup || "",
        ...(entry.aliases || []),
      ].join(" ");
      const score = fuzzyScore(query, searchText);
      if (score >= 0) {
        out.push({
          score,
          label: entry.name,
          meta: `${entry.formula || ""}${entry.family ? ` · ${entry.family}` : ""}`.trim(),
          shortcut: "Library",
          run: () => onOpenLibraryEntry(entry),
        });
      }
    }
    out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return out.slice(0, 40);
  }

  function renderList() {
    if (!list) return;
    filtered = buildItems(input?.value || "");
    activeIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    if (!filtered.length) {
      input?.removeAttribute("aria-activedescendant");
      const empty = document.createElement("p");
      empty.className = "command-empty";
      empty.textContent = "No matching commands or structures.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...filtered.map((item, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = `command-option-${idx}`;
        btn.tabIndex = -1;
        btn.className = "command-item";
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", String(idx === activeIndex));
        btn.dataset.index = String(idx);
        const title = document.createElement("span");
        title.className = "command-label";
        title.textContent = item.label;
        const meta = document.createElement("span");
        meta.className = "command-meta";
        meta.textContent = item.meta;
        btn.append(title, meta);
        if (item.shortcut) {
          const kbd = document.createElement("kbd");
          kbd.textContent = item.shortcut;
          btn.append(kbd);
        }
        btn.addEventListener("pointerenter", () => setActiveIndex(idx, false));
        btn.addEventListener("click", () => execute(idx));
        return btn;
      }),
    );
    input?.setAttribute("aria-activedescendant", `command-option-${activeIndex}`);
  }

  function setActiveIndex(next, scroll = true) {
    if (!filtered.length) return;
    activeIndex = (next + filtered.length) % filtered.length;
    const rows = list?.querySelectorAll(".command-item") ?? [];
    rows.forEach((row, idx) => {
      const isSelected = idx === activeIndex;
      row.setAttribute("aria-selected", String(isSelected));
      if (isSelected && scroll) row.scrollIntoView({ block: "nearest" });
    });
    input?.setAttribute("aria-activedescendant", `command-option-${activeIndex}`);
  }

  function execute(index) {
    const item = filtered[index];
    if (!item) return;
    close();
    item.run?.();
  }

  function open() {
    if (!dialog || isBusy()) return;
    if (shortcutDialog?.open) shortcutDialog.close();
    if (input) input.value = "";
    activeIndex = 0;
    renderList();
    if (!dialog.open) dialog.showModal();
    input?.focus({ preventScroll: true });
  }

  function close() {
    input?.removeAttribute("aria-activedescendant");
    input?.blur();
    if (dialog?.open) dialog.close();
  }

  dialog?.addEventListener("close", () => {
    input?.blur();
  });

  function openShortcuts() {
    if (!shortcutDialog) return;
    if (dialog?.open) dialog.close();
    if (!shortcutDialog.open) shortcutDialog.showModal();
  }

  function closeShortcuts() {
    if (shortcutDialog?.open) shortcutDialog.close();
  }

  input?.addEventListener("input", () => {
    activeIndex = 0;
    renderList();
  });

  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter") {
      if (event.isComposing) return;
      event.preventDefault();
      execute(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  function closeOnBackdrop(dlg) {
    dlg?.addEventListener("click", (event) => {
      if (event.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      ) {
        dlg.close();
      }
    });
  }
  closeOnBackdrop(dialog);
  closeOnBackdrop(shortcutDialog);
  shortcutClose?.addEventListener("click", closeShortcuts);

  function onGlobalKeyDown(event) {
    const key = event.key;
    const lower = key.toLowerCase();

    // ⌘K / Ctrl+K works anywhere (even from inputs) to toggle command palette.
    if ((event.metaKey || event.ctrlKey) && !event.altKey && lower === "k") {
      event.preventDefault();
      if (dialog?.open) close();
      else open();
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;

    // Ignore single-key shortcuts while any modal dialog is open (except ? / Esc).
    const openModal = document.querySelector("dialog:modal");
    if (openModal) {
      if (key === "?" && openModal === shortcutDialog) {
        event.preventDefault();
        closeShortcuts();
      }
      return;
    }

    if (key === "?") {
      event.preventDefault();
      openShortcuts();
    } else if (lower === "a" || lower === "b" || lower === "c") {
      if (isBusy()) return;
      event.preventDefault();
      onAxis(lower, { opposite: event.shiftKey });
    } else if (lower === "f") {
      if (isBusy()) return;
      event.preventDefault();
      onFit();
    } else if (lower === "r") {
      if (isBusy()) return;
      event.preventDefault();
      onReset();
    } else if (key === "1" && !event.shiftKey) {
      event.preventDefault();
      onMeasureMode("info");
    } else if (key === "2") {
      event.preventDefault();
      onMeasureMode("distance");
    } else if (key === "3") {
      event.preventDefault();
      onMeasureMode("angle");
    } else if (key === "Escape" && !event.defaultPrevented && typeof onEscape === "function") {
      onEscape(event);
    }
  }

  document.addEventListener("keydown", onGlobalKeyDown);

  return {
    open,
    close,
    openShortcuts,
    closeShortcuts,
    setCommands(next) {
      registeredCommands = [...next];
    },
    destroy() {
      document.removeEventListener("keydown", onGlobalKeyDown);
    },
  };
}
