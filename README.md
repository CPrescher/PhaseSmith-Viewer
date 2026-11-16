# PhaseSmith Viewer

A standalone browser application for exploring crystal structures and measuring the distance between atomic sites. CIF parsing and symmetry expansion run locally in a Web Worker using PhaseSmith compiled to WebAssembly. Three.js renders the resulting structure using WebGL.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Pick **Open CIF** to load a file from the device. Drag to rotate, use the wheel or pinch to zoom, then click or tap two atoms. The result is the Cartesian distance in ångströms between the selected images. This distinction matters across cell faces: two periodic copies of the same crystallographic site can be a lattice translation apart.

## Try on a tablet

Build the application, then serve the compiled directory over your local network.

```sh
npm run build
python3 -m http.server 4179 --bind 0.0.0.0 --directory dist
```

Open `http://<computer-local-IP>:4179/` on a tablet connected to the same network. The server supplies static application files. Opening a CIF reads it on the tablet. A current WebGL 2 browser is required.

## Engine development

The compiled importer ships in `public/engine.wasm`. Rebuilding the web interface uses this file directly. To rebuild the importer after changing the Rust adapter, install the Rust WebAssembly target and run:

```sh
rustup target add wasm32-unknown-unknown
npm run build:engine
```

The importer uses PhaseSmith’s conventional crystal-structure CIF reader. Inspect the reported warnings when the source contains conflicting symmetry definitions. It supports fractional and Cartesian atom coordinates, multiblock files, and common PDBx/mmCIF atom records. In macromolecular files, models and alternate conformers are displayed together. Magnetic moments, modulations and biological assemblies require additional interpretation. A CIF containing only diffraction observations has no atomic structure to draw. Browser import limits are 16 MiB, 100 data blocks, 100,000 asymmetric sites and 200,000 candidate positions before expansion.

The initial NaCl example is an idealized rock-salt structure with a rounded 5.64 Å unit-cell edge.

## Verification

```sh
cargo test --locked --manifest-path engine/Cargo.toml
```

The browser smoke test needs Python Playwright and its Chromium and WebKit browsers. It uploads a known CIF through the file picker, selects two periodic images, and exercises navigation using mouse and touch events. With the viewer running, set `VIEWER_URL` to its address and run `python tests/smoke.py`.
