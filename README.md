# PhaseSmith Viewer

A standalone browser application for exploring crystal structures and measuring the distance between atomic sites. CIF parsing and symmetry expansion run locally in a Web Worker using PhaseSmith compiled to WebAssembly. Three.js renders the resulting structure using WebGL.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Pick **Open CIF** to load a file from the device. Drag to rotate, use the wheel or pinch to zoom, then click or tap two atoms. The result is the Cartesian distance in ångströms between the selected images. This distinction matters across cell faces: two periodic copies of the same crystallographic site can be a lattice translation apart.

## Orientation

Left-drag continuously in any direction to turn the model over its poles around the current view center. The wheel zooms about the cursor. Right-drag pans with the point you grab held under the cursor. A right-click zooms out one step, and a double right-click fits the displayed structure while preserving its orientation. Use the **a**, **b**, or **c** views to align the camera with a direct lattice axis. For a custom direction, enter the three indices of [uvw]. The camera looks toward the structure from the positive side of the vector u**a** + v**b** + w**c**. The parallel projection aligns rows of atoms along that direction. These are direct lattice directions. In a nonorthogonal cell a direct direction and the normal to the plane with the same indices generally differ.

## Displaying more than one unit cell

Set the lower and upper fractional coordinates independently along **a**, **b**, and **c**. A range of 0 to 1 spans one cell, −1 to 1 spans two cells, and fractional limits select part of a cell. Applying the range repeats the structure by lattice translations and fits the new extent in the current orientation. Each translated atom remains individually selectable for distance measurements.

Open `/?example=wollastonite` to follow the Si–O chains through three cells along **b**. The example opens looking along **c** and uses the triclinic structure from the Freiburg exercise, with **a** and **c** each spanning one cell. Shared oxygen vertices connect successive tetrahedra across both internal cell boundaries. Increasing the upper b limit extends the chains. For a shorter view, change it back to 1.

## Bonds and coordination polyhedra

Choose the central element, its neighboring element, and their maximum distance in ångströms. Bonds and polyhedra can be switched independently for each pair. A center inside the displayed cell can have neighbors in adjacent cells. The viewer includes these periodic images and measures distances to the actual image selected.

Tap or click a pair’s cutoff to open its speed slider. Hold the knob a little left or right for fine changes in 0.01 Å increments. Drag farther to change the cutoff faster and release to stop. The − and + buttons change it by 0.1 Å. On touch screens, tap the field again to type an exact cutoff.

The **Opacity** slider controls each pair’s polyhedron faces. At 0% only the outlines remain visible. At 100% the faces are opaque. Turn off **Atoms** to remove the spheres from the view, or toggle an element in the legend to hide only its spheres. Bonds, polyhedra, and their coordination counts are independent of sphere visibility.

Transparent faces from all pairs and lattice planes are composed in depth order at each pixel, including intersecting polyhedra. The renderer adapts up to 24 surface layers. Deeper stacks use an approximate remainder and show a status note: next to the atom count below the view, or on a phone at the top of the lower panel. The note clears once the view needs 24 layers or fewer. Exactly coincident faces share one layer. A small depth tolerance prevents surfaces from being drawn repeatedly because of floating-point rounding. PNG and movie exports use the same renderer with the full layer budget.

Use **Polyhedra only** to show the centers and vertices of visible polyhedra. Turn it off to see the surrounding structure. Changing the cutoff changes which neighbors qualify for the display; the imported atom positions stay fixed.

Open `/?example=forsterite` for a worked example using the Mg end member of olivine (Boström, 1987, *American Mineralogist* 72, 965–972, AMCSD 0001118). The Si–O and Mg–O cutoffs of 1.80 Å and 2.30 Å include the complete first coordination shells. Hide one rule to examine the other. Lower the Mg–O cutoff to 2.15 Å to retain all six neighbors around Mg1 and three around Mg2.

## Planes, directions and symmetry

Choose **Lattice** in the sidebar. **＋ Plane** adds a Miller-index plane with integer indices and a fractional offset m in hx + ky + lz = m. **Family** draws the parallel planes at m + n for integer n intersecting the displayed extent. Changing m moves the whole family. Each plane reports its interplanar spacing in ångströms. The Lattice **Labels** toggle annotates added planes and directions. **＋ Arrow** adds a direct-lattice [uvw] vector with a fractional origin and a length multiplier.

**Elements** shows symmetry axes, planes and inversion centers derived from the imported CIF operations. Use the type filters to examine rotation, screw, rotoinversion, inversion, mirror or glide elements. The **Operations** list shows their fractional-coordinate equations. Generated overlays are clipped to the plotting extent. A status note identifies any generation limit.

## Angles, sites and volumes

Choose **Info** to inspect one atom at a time, including its CIF label, element, occupancy, displayed coordinates and configured coordination information.

Use **∠** in the measurement control and pick three atoms in A–B–C order. The second atom is the angle vertex. Select **Å** to return to two-atom distance measurements.

Choose **Sites** in the sidebar to see the original CIF site labels, fractional coordinates and occupancies. **Labels** annotates visible spheres. Tap a table row to highlight visible copies of that site. The polyhedron table reports coordination numbers and convex-hull volumes in Å³ by central site. These volumes use the physical atomic coordinates.

**Asymmetric unit** displays each original independent site once before symmetry expansion. Pair geometry pauses in this view. Switching it off restores the full expanded structure and its pair settings.

## Changing colors and sizes

Choose **Style** in the sidebar's mode bar (**Pairs · Style · Lattice · Sites · Extent**); **‹ Pairs** returns. Choose an element to change all its spheres, or choose a pair to change all its polyhedra. Choose a swatch or a custom color, then adjust **Radius** or **Scale**. A polyhedron at 100% has its vertices at the coordinating atoms. Changing the display scale moves its faces and edges about the central atom. Distances use the original coordinates at every scale.

To highlight one copy, enable **Pick one** and tap a sphere or a polyhedron face. **Reset** restores the inherited style for the selected target. Close the editor to return to measuring distances.

## Images, movies and themes

Choose **Export** in the sidebar to save a PNG at 1×, 2× or 4× resolution, with an optional transparent background. The DPI field writes print-resolution metadata and reports the physical print size. Pixel dimensions follow the resolution setting.

The movie control records a full turntable revolution at the selected duration and frame rate. The browser selects a supported MP4 or WebM encoder. Visible planes, arrows, symmetry elements, labels, measurements and the lattice-axis compass are included in exports. Cancel stops a movie recording and restores the view.

The header theme button switches between light and dark. An explicit choice is remembered. The initial theme follows the device preference.

## Try on a tablet or phone

The crystal stays in view while you edit the structure. The controls sit beside it on a landscape tablet and below it in portrait. On a phone, scroll the lower panel to reach the extent controls.

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

Run the JavaScript geometry tests with `node --test tests/*.test.mjs`. The coordination browser test uses the packaged forsterite CIF (`python tests/coordination_smoke.py`). Run `python tests/steering_smoke.py` to check unrestricted rotation, axis views and custom directions in a triclinic cell. The plotting-range and display tests are `tests/ranges_smoke.py` and `tests/visibility_smoke.py`.

```sh
cargo test --locked --manifest-path engine/Cargo.toml
```

The browser smoke test needs Python Playwright and its Chromium and WebKit browsers. It uploads a known CIF through the file picker, selects two periodic images, and exercises navigation using mouse and touch events. With the viewer running, set `VIEWER_URL` to its address and run `python tests/smoke.py`. Run `python tests/workbench_smoke.py` to check control placement on desktop and tablet and distance measurement on a phone-sized touch screen.

`python tests/transparency_pixels_smoke.py` compares actual GPU pixels against known alpha-composition results for crossing and disjoint faces, reversed pair order, different opacities, nearby surfaces, and opaque obstruction. `python tests/face_order_smoke.py` checks the integrated forsterite renderer and picking. `python tests/export_smoke.py` decodes downloaded PNGs and movies and checks DPI metadata, cancellation, and recording interrupted by resizing.
