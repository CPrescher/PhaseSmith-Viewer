// Light/dark theme switch. The initial theme is applied by an inline script
// in index.html before first paint (explicit choice, else system). Here:
// the header toggle, persistence, and following the OS theme live only
// while the user has not chosen explicitly.
const KEY = "psv-theme";

function readChoice() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage blocked: behave as "no explicit choice"
  }
}
function writeChoice(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked: the choice still applies for this session */
  }
}

export function createThemeSwitch({ button, onChange }) {
  const root = document.documentElement;
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  const system = () => (media?.matches ? "light" : "dark");
  let explicit = readChoice();
  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#eef2f5" : "#0b1622");
    const light = theme === "light";
    // Accessible name stays "Light mode"; the pressed state says if it's on.
    button.setAttribute("aria-pressed", String(light));
    button.title = light ? "Switch to dark mode" : "Switch to light mode";
    if (button.firstElementChild) button.firstElementChild.textContent = light ? "☾" : "☀";
    onChange?.(theme);
  }
  button.addEventListener("click", () => {
    explicit = root.dataset.theme === "light" ? "dark" : "light";
    writeChoice(explicit);
    apply(explicit);
  });
  media?.addEventListener?.("change", () => {
    if (!explicit) apply(system());
  });
  apply(explicit ?? (root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : system()));
  return {
    get theme() {
      return root.dataset.theme;
    },
    get explicit() {
      return explicit;
    },
  };
}
