# PhaseSmith Viewer

Explore crystal structures in your browser: atomic distances and angles, coordination polyhedra, lattice planes and directions, symmetry elements, pair-distance distributions, ideal X-ray powder patterns, and single-crystal diffraction on an interactive Ewald sphere and detector. CIF parsing and symmetry expansion run locally with the PhaseSmith WebAssembly engine; Three.js renders the structure using WebGL.

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
npm run preview
```

Open the viewer at `http://127.0.0.1:4216/` and the guide at `http://127.0.0.1:4216/docs/`. Use these server URLs for previews; opening `index.html` directly does not load the application correctly.

## Desktop app

On macOS and Windows the Tauri app bundles the complete viewer, library and searchable guide. Opening a CIF or PSV from Finder or Explorer uses the same importer as **Open file**. Exports use native Save dialogs. The app restores the current scene and its undo/redo history when launched again.

With the web dependencies installed, a Rust toolchain and the platform’s [Tauri build prerequisites](https://v2.tauri.app/start/prerequisites/), build the installers with:

```sh
# macOS (Apple silicon and Intel)
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:build -- --target universal-apple-darwin --bundles app,dmg

# Windows (run on the desired architecture)
npm run desktop:build -- --bundles nsis
```

Installers are written beneath `src-tauri/target/` in the release bundle directory. The Windows setup includes the WebView2 offline installer.

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

## Versioned releases

Open **Actions → Release → Run workflow** and select `main`. Leave **Publish a GitHub Release** unchecked for a rehearsal. The run builds the downloads, tests them and records their SHA-256 checksums. On each Windows architecture, it installs the viewer, opens an associated CIF, saves a project with the native Windows dialog and reopens the PSV in a fresh profile. Check **Publish** to also create the version tag on the tested commit and publish the downloads with generated release notes. Pushing a matching tag such as `v1.0.0` also triggers publication.

Each release includes a universal macOS DMG, offline Windows installers for x64 and ARM64, a ZIP containing the web viewer and guide, and `SHA256SUMS`. The web ZIP can be served from the root of a local HTTP server. GitHub Pages continues to deploy from successful builds of `main`.

For the next version, update `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` together. The workflow checks that their versions agree before starting the builds.

For Mac Developer ID signing, set the repository Actions secrets `APPLE_CERTIFICATE` (base64-encoded P12), `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`. For notarization, also set `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`. The release workflow checks the Developer ID signatures, stapled notarization tickets, and Gatekeeper acceptance of both the downloaded DMG and the app inside it. The Windows installers are unsigned. The release notes identify the signing status of each platform. [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/)

## Sources and attribution

Library entries retain original structure citations and source links in `web/structure-library.json`. Idealized teaching models are labeled separately. The powder plot, reflection explorer, and detector use PhaseSmith’s Waasmaier–Kirfel neutral-atom X-ray form factors. Element colors and fallback covalent radii are adapted from the [Blue Obelisk Data Repository](https://github.com/BlueObelisk/bodr/blob/master/bodr/elements/elements.xml).
