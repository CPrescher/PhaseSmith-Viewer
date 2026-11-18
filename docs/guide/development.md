# Development and documentation

The [GitHub repository](https://github.com/CPrescher/PhaseSmith-Viewer) contains the application, the bundled crystal reader, tests, and this guide. The viewer is a static Vite application using Three.js; CIF parsing runs in a Web Worker with the PhaseSmith engine compiled to WebAssembly. The documentation uses VitePress and Markdown.

## Run the viewer locally

Use Node.js **22.12 or newer**:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. The compiled importer is already included as `public/engine.wasm`.

To serve the production build locally:

```sh
npm run build
npm run docs:build
python3 -m http.server 4179 --bind 127.0.0.1 --directory dist
```

The viewer is at `http://127.0.0.1:4179/` and the guide at `http://127.0.0.1:4179/docs/`. A static local build can run without an internet connection.

To use it on a tablet on the same network, bind the server to `0.0.0.0` and open the computer's local IP address at port 4179 on the tablet.

## Edit this guide

Edit pages in `docs/guide/`. Navigation and search are configured in `docs/.vitepress/config.mjs`; shared styles are in `docs/.vitepress/theme/`. Screenshots are in `docs/guide/public/images/`. The shared `ViewerFigure` component chooses the image matching the documentation theme; its labels and outlines are defined in `docs/.vitepress/theme/figures.json`. Internal design reviews in `docs/reviews/` are outside the published source directory.

```sh
npm run docs:dev
```

The guide includes local full-text search, a page outline, light and dark themes, and a mobile navigation menu. Build it before publishing:

```sh
npm run docs:build
```

VitePress checks internal page links during the build. Match documented control names and behavior to the version being released. Keep unfinished features out of the public guide until that version ships. Update the relevant page when changing a feature, and add a worked example when a task is easier to understand by trying it.

## Capture screenshots

With the production viewer served locally and Playwright installed, run:

```sh
VIEWER_URL=http://127.0.0.1:4179 python3 scripts/capture-docs.py
```

Set `BROWSER_CHANNEL=chrome` to use an installed Chrome. The script captures each scene in both themes on the same page, preserving camera, selections, and panel scroll. It measures the real button positions for the callout labels. Commit both theme images and the generated figure metadata together.

When documenting a control, explain **where it is**, show its actual icon or panel, and state **what opens or changes**. Include the phone route when it differs. Keep small icon controls large enough to recognize; a full-window screenshot alone is not enough. Use a `ViewerFigure` for every screenshot so manual theme switching also switches its image.

## GitHub Pages

The existing GitHub Actions workflow builds the viewer first, then builds the documentation into `dist/docs/`. Both are uploaded in a single Pages artifact. A successful `main` workflow deploys them together; a pull request runs checks without deploying.

For the repository's hosted prefix, reproduce the build with:

```sh
npm run build -- --base /PhaseSmith-Viewer/
VITE_BASE_PATH=/PhaseSmith-Viewer/ npm run docs:build
```

The guide's base path and image paths then live under `/PhaseSmith-Viewer/docs/`. Keep the viewer and guide base settings consistent when deploying to another path. Do not rebuild the viewer after building the guide: Vite cleans `dist/` before creating the viewer output.

Deployment follows [VitePress's static-hosting guidance](https://vuejs.github.io/vitepress/v1/guide/deploy), using the application's existing Pages workflow.

## Tests

Run the JavaScript geometry and state tests with:

```sh
node --test tests/*.test.mjs
```

Browser checks use Python Playwright. Install `tests/requirements-browser.txt` and Chromium, then serve the production build and point `VIEWER_URL` at it. `tests/pages_smoke.py` exercises the hosted viewer, bundled examples, WebAssembly reader, and plot workers. `tests/docs_smoke.py` checks documentation navigation, search, deep links, mobile layout, and the viewer's Help link.

```sh
python3 -m pip install -r tests/requirements-browser.txt
python3 -m playwright install chromium
VIEWER_URL=http://127.0.0.1:4179 python3 tests/pages_smoke.py
VIEWER_URL=http://127.0.0.1:4179 python3 tests/docs_smoke.py
```

Use the individual browser checks in `tests/` when changing the corresponding feature. The workflow's **full_browser_matrix** option runs the extended screen, theme, and pixel-density checks.

## Rebuild the crystal reader

After changing the Rust adapter or its pinned PhaseSmith revision:

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --manifest-path engine/Cargo.toml
npm run build:engine
```

Commit the rebuilt WebAssembly file together with the adapter change. CI rebuilds and tests the reader when its sources change.

## Maintain the structure library

The catalog is `web/structure-library.json`, and reference CIFs are in `public/structures/`. Keep reference data unchanged. Every entry records its citation, source, collection, search aliases, and file SHA-256; identify constructed teaching models explicitly. `tests/structure-library.test.mjs` imports the whole catalog through the bundled reader.
