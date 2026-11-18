# PhaseSmith Viewer

Explore crystal structures in your browser: atomic distances and angles, coordination polyhedra, lattice planes and directions, symmetry elements, pair-distance distributions, and ideal X-ray powder patterns. CIF parsing and symmetry expansion run locally with the PhaseSmith WebAssembly engine; Three.js renders the structure using WebGL.

**[Open the viewer](https://cprescher.github.io/PhaseSmith-Viewer/)** · **[Documentation](https://cprescher.github.io/PhaseSmith-Viewer/docs/)** · **[Worked examples](https://cprescher.github.io/PhaseSmith-Viewer/docs/tutorials.html)**

## User guide

The documentation includes a [five-minute introduction](docs/guide/getting-started.md), [structure library and file formats](docs/guide/structures.md), [navigation](docs/guide/navigation.md), [measurements](docs/guide/measurements.md), [coordination](docs/guide/coordination.md), [lattice tools](docs/guide/lattice.md), [plots](docs/guide/plots.md), [saving and exporting](docs/guide/saving.md), and [scientific conventions](docs/guide/science.md).

Choose **Help** in the viewer's tool rail (or the phone's **Tools** menu) to open the guide. A current WebGL 2 browser is required. Structure and project files stay on the device; save a `.psv` project to transfer the CIF and scene settings between devices.

## Run locally

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

The compiled crystal reader ships in `public/engine.wasm`. To build and serve the viewer and documentation:

```sh
npm run build
npm run docs:build
python3 -m http.server 4179 --bind 127.0.0.1 --directory dist
```

Open the viewer at `http://127.0.0.1:4179/` and the guide at `http://127.0.0.1:4179/docs/`.

## Documentation

Edit Markdown in `docs/guide/`. Run `npm run docs:dev` for a live preview. The VitePress configuration, sidebar, and local search are in `docs/.vitepress/config.mjs`. Design review notes in `docs/reviews/` are not published.

Keep documentation changes with the feature they describe, including scientific assumptions and limitations. See the [development guide](docs/guide/development.md) for builds, screenshots, browser checks, and library maintenance.

## Checks and deployment

```sh
node --test tests/*.test.mjs
npm run build -- --base /PhaseSmith-Viewer/
VITE_BASE_PATH=/PhaseSmith-Viewer/ npm run docs:build
```

GitHub Actions checks the viewer, builds the guide into `dist/docs/`, and publishes the combined `dist/` artifact to GitHub Pages after a successful `main` run. Pull requests run checks without deploying. Rebuild the viewer before the guide, because the viewer build clears `dist/`.

To rebuild the Rust adapter after changing it:

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --manifest-path engine/Cargo.toml
npm run build:engine
```

## Sources and attribution

Library entries retain original structure citations and source links in `web/structure-library.json`. Idealized teaching models are labeled separately. The X-ray coefficient table is adapted from Gemmi's ITC 1992 table; its MPL 2.0 notice is in `public/notices/gemmi.txt`. Element colors and fallback covalent radii are adapted from the [Blue Obelisk Data Repository](https://github.com/BlueObelisk/bodr/blob/master/bodr/elements/elements.xml).
