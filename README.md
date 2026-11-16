# PhaseSmith Viewer

A standalone browser application for exploring crystal structures and measuring the distance between atomic sites. CIF parsing and symmetry expansion run locally in a Web Worker using PhaseSmith compiled to WebAssembly. Three.js renders the resulting structure using WebGL.

[Open the viewer](https://cprescher.github.io/PhaseSmith-Viewer/) · [Source on GitHub](https://github.com/CPrescher/PhaseSmith-Viewer) · [CI and deployments](https://github.com/CPrescher/PhaseSmith-Viewer/actions)

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Pick **Open CIF** to load a file from the device. Drag to rotate and use the wheel or pinch to zoom. **Info** is active by default: click or tap an atom to inspect it. To measure, choose **Distance** (↔) and select two atoms, or **Angle** (∠) and select three. Distances are Cartesian separations in ångströms between the selected images. This distinction matters across cell faces: two periodic copies of the same crystallographic site can be a lattice translation apart.

## Orientation

Left-drag continuously in any direction to turn the model over its poles around the current view center. The wheel zooms about the cursor. Right-drag pans with the point you grab held under the cursor. A right-click zooms out one step, and a double right-click fits the displayed structure while preserving its orientation. Use the **a**, **b**, or **c** views to align the camera with a direct lattice axis. For a custom direction, enter the three indices of [uvw]. The camera looks toward the structure from the positive side of the vector u**a** + v**b** + w**c**. The parallel projection aligns rows of atoms along that direction. These are direct lattice directions. In a nonorthogonal cell a direct direction and the normal to the plane with the same indices generally differ.

**Turn** opens step controls for exact rotations. Choose 90°, 60°, 45°, 30°, 10° or 5°, or type a custom angle greater than 0° and at most 360° (decimals allowed). The arrow pad turns the crystal left, right, up, down or along one of the four diagonals by exactly that angle. **⟲** and **⟳** roll it counterclockwise or clockwise in the screen plane. Directions describe how the crystal appears to move. Every turn is about the current view center and keeps the zoom, atom coordinates, selections and measurements. The crystal stops exactly at the new orientation. The controls stay open for repeated turns and close with ✕, Escape or a tap elsewhere; Escape or ✕ returns keyboard focus to **Turn**. On a phone they open in the lower panel, directly below the selection details, so the crystal stays uncovered. Turns are unavailable while an image or movie is exported.

## Displaying more than one unit cell

Set the lower and upper fractional coordinates independently along **a**, **b**, and **c**. A range of 0 to 1 spans one cell, −1 to 1 spans two cells, and fractional limits select part of a cell. Applying the range repeats the structure by lattice translations and fits the new extent in the current orientation. Each translated atom remains individually selectable for distance measurements.

Open `/?example=wollastonite` to follow the Si–O chains through three cells along **b**. The example opens looking along **c** and uses the triclinic structure from the Freiburg exercise, with **a** and **c** each spanning one cell. Shared oxygen vertices connect successive tetrahedra across both internal cell boundaries. Increasing the upper b limit extends the chains. For a shorter view, change it back to 1.

## Bonds and coordination polyhedra

Choose the central element, its neighboring element, and their maximum distance in ångströms. Bonds and polyhedra can be switched independently for each pair. A center inside the displayed cell can have neighbors in adjacent cells. The viewer includes these periodic images and measures distances to the actual image selected.

New pairs start with an estimated cutoff from the structure's periodic first-neighbor distances, including the different independent central sites. Changing either element recalculates this starting value. A gap between distance groups helps separate the first shell; distorted shells get a small margin. These are editable starting estimates, not chemical bond assignments. Very large or extreme searches fall back to an element-specific covalent-radius estimate. Typed cutoffs and restored session values stay as entered.

Tap or click a pair’s cutoff to open its speed slider. Hold the knob a little left or right for fine changes in 0.01 Å increments. Drag farther to change the cutoff faster and release to stop. The − and + buttons change it by 0.1 Å. On touch screens, tap the field again to type an exact cutoff.

The **Opacity** slider controls each pair’s polyhedron faces. At 0% only the outlines remain visible. At 100% the faces are opaque. Turn off **Atoms** to remove the spheres from the view, or toggle an element in the legend to hide only its spheres. Bonds, polyhedra, and their coordination counts are independent of sphere visibility.

Transparent faces from all pairs and lattice planes are composed in depth order at each pixel, including intersecting polyhedra. The renderer adapts up to 24 surface layers. Deeper stacks use an approximate remainder and show a status note: next to the atom count below the view, or on a phone at the top of the lower panel. The note clears once the view needs 24 layers or fewer. Exactly coincident faces share one layer. A small depth tolerance prevents surfaces from being drawn repeatedly because of floating-point rounding. PNG and movie exports use the same renderer with the full layer budget.

Use **Polyhedra only** to show the centers and vertices of visible polyhedra. Turn it off to see the surrounding structure. Changing the cutoff changes which neighbors qualify for the display; the imported atom positions stay fixed.

Open `/?example=forsterite` for a worked example using the Mg end member of olivine (Boström, 1987, *American Mineralogist* 72, 965–972, AMCSD 0001118). The Si–O and Mg–O cutoffs of 1.80 Å and 2.30 Å include the complete first coordination shells. Hide one rule to examine the other. Lower the Mg–O cutoff to 2.15 Å to retain all six neighbors around Mg1 and three around Mg2.

## Planes, directions and symmetry

Choose **Lattice** in the sidebar. **＋ Plane** adds a Miller-index plane with integer indices and an editable fractional offset m in hx + ky + lz = m. A new plane starts at a whole-number m: the integer closest to the center of the displayed extent among those whose plane crosses its interior (ties go toward 0), otherwise the nearest integer on its boundary. In one cell, (100) starts at m = 1, (1̄00) at −1 and (11̄0) at 0. A very narrow fractional extent may contain no plane with an integer m; the plane's readout then says so, and you can type a fractional m, widen the extent or raise Size. While m has not been typed in, it follows changes to the indices. Once you enter m yourself it stays fixed, also when the indices or the extent change.

**Family** draws the parallel planes at m + n for integer n intersecting the displayed extent. Changing m moves the whole family.

**Size** (100–200%) draws a plane's faces beyond the plotted range, enlarging the clipping box about its center. The plane equation, m, the spacing and the family offsets stay the same.

**Opacity** (0–100%, default 28%) sets how strongly each plane entry's faces are drawn. At 0% only the outline and the label remain. At 100% the faces are opaque and hide what lies behind them. Each plane reports its interplanar spacing in ångströms.

The Lattice **Labels** toggle annotates added planes and directions. **Show m in labels** adds the offset to plane labels ("(100) · m=0.5"); turned off, labels show only the indices. It changes label text only, and in exports too.

**Position** places plane labels **Outside** a projected edge of the drawn plane with a short leader line in the plane's color (default), against an **Edge** without a leader, or at the **Center** of the plane. Outside and Edge labels avoid the view controls, the legend, other labels and, where possible, the structure itself. In tight views a label falls back to sitting on the edge, and further members of a family are left unlabeled rather than placed over the middle of the structure. Exported images and movies show the same label positions and leaders. Direction labels stay beside the arrow tip.

**＋ Arrow** adds a direct-lattice [uvw] vector with a fractional origin and a length multiplier.

**Elements** shows symmetry axes, planes and inversion centers derived from the imported CIF operations. Use the type filters to examine rotation, screw, rotoinversion, inversion, mirror or glide elements. The **Operations** list shows their fractional-coordinate equations. Generated overlays are clipped to the plotting extent. A status note identifies any generation limit.

## Angles, sites and volumes

Choose **Info** to inspect one atom at a time, including its CIF label, element, occupancy, displayed coordinates and configured coordination information.

The left-click action buttons stay fixed at the top right of the crystal view. Switching between **Info**, **Distance**, and **Angle** clears the current selection so the new mode starts fresh. Atom details and measurement results appear in a separate card below them; **Clear** keeps its place and is dimmed until an atom is selected. On phones, the buttons stay in a vertical column and the full details remain in the lower panel.

Use **∠** in the measurement control and pick three atoms in A–B–C order. The second atom is the angle vertex. Select **↔** (Distance) to return to two-atom distance measurements.

Choose **Sites** in the sidebar to see the original CIF site labels, fractional coordinates and occupancies. **Labels** annotates visible spheres. Tap a table row to highlight visible copies of that site. The polyhedron table reports coordination numbers and convex-hull volumes in Å³ by central site. These volumes use the physical atomic coordinates.

**Asymmetric unit** displays each original independent site once before symmetry expansion. Pair geometry pauses in this view. Switching it off restores the full expanded structure and its pair settings.

## Changing colors and sizes

Every element from H to Og has a defined default color. Common mineral elements use contrasting colors: O red, Si blue, Mg green, Al violet, Ca gold and Fe orange. Polyhedra inherit their central element's default color, so their colors stay consistent when pairs are added or deleted. Colors stay the same in both themes. Other element colors and the fallback covalent radii are adapted from the [Blue Obelisk Data Repository](https://github.com/BlueObelisk/bodr/blob/master/bodr/elements/elements.xml).

Choose **Style** in the sidebar's mode bar (**Pairs · Style · Lattice · Sites · Extent**); the other tabs switch back. Choose an element to change its spheres' color and **Radius**, or a pair to change its polyhedra's color and **Opacity**. Polyhedron faces and edges always use the actual coordinating atom positions; saved display scales from earlier versions are ignored. Atom radius changes only the spheres drawn on screen.

To highlight one copy, enable **Pick one** and tap a sphere or a polyhedron face. Individually styled copies stay in the target list, also after a restart. The reset button names its target. **Reset atom** or **Reset polyhedron** removes only that copy's own style, so it follows the current element or pair style again. **Reset element** or **Reset pair** restores the defaults of the whole element or pair, including its individually styled copies. **Reset all … individual styles** removes every individual override at once. Resets never change coordinates. Leave the Style tab to return to measuring.

The **View** readout above the atom legend shows the current viewing direction as a direct-lattice vector [u v w], pointing from the crystal toward you, like the **a**, **b** and **c** buttons. Exact small-integer directions are shown as they are. Other directions are marked with ≈.

## Saved session

The viewer saves its state on this device and restores it when you open the same page again, also after restarting the browser. This covers the loaded CIF and data block, the plotting extent, pairs and their cutoffs, colors and opacities, element and individual styles, atom visibility, size and labels, the asymmetric-unit view, planes, directions, symmetry and label settings, the camera, the turn angle, the measurement with its picked atoms in order, and the open sidebar panels. Nothing is uploaded. Opening a different example address starts that example instead. **Export → Session** shows the save status; **Start fresh** discards the saved session and reloads this page's structure.

## Images, movies and themes

Choose **Export** in the sidebar to save a PNG at 1×, 2× or 4× resolution, with an optional transparent background. The DPI field writes print-resolution metadata and reports the physical print size. Pixel dimensions follow the resolution setting.

The movie control records a full turntable revolution at the selected duration and frame rate. The browser selects a supported MP4 or WebM encoder. Visible planes, arrows, symmetry elements, labels, measurements and the lattice-axis compass are included in exports. Cancel stops a movie recording and restores the view.

The header theme button switches between light and dark. An explicit choice is remembered. The initial theme follows the device preference.

## Try on a tablet or phone

The crystal stays in view while you edit the structure. The controls sit beside it on a landscape tablet and below it in portrait. In portrait the crystal and the lower panel split the screen at a fixed ratio: picking atoms, switching measurement modes or tabs, adding pairs, planes or arrows, and opening editors change what the panel shows, never the size of the crystal view. Longer content scrolls inside the panel, under a tab bar that stays in place; each tab opens at its top. Picking an atom never scrolls the panel.

On a phone, the details of the picked atom, distance or angle appear in a fixed strip under the tab bar, which stays visible while the panel scrolls. Before anything is picked it shows a short hint. A polyhedron center's CN and volume line follows its coordinates; with several pairs, scroll the strip itself. The full site and polyhedron tables are under **Sites**. The tabs and strip share an opaque sticky header, so scrolled controls cannot receive taps through the gaps. If the element legend is too long, its fading edge indicates that it can be scrolled horizontally; the Size slider stays beside it.

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

GitHub Actions runs the Rust importer tests, rebuilds its WebAssembly module from the pinned PhaseSmith revision, runs the JavaScript tests, and builds the application for its GitHub Pages path. A Chromium smoke test then checks all three examples, WebAssembly loading, plane placement, saved-session restoration, and the phone layout. Passing changes on `main` deploy automatically to GitHub Pages; pull requests run the same checks without deploying.

To run the portable production browser check, install `tests/requirements-browser.txt` and Chromium (`python -m playwright install chromium`), serve the built app, then run `VIEWER_URL=http://localhost:4179 python tests/pages_smoke.py`. `BROWSER_CHANNEL=chrome` uses an installed Chrome instead of Playwright's bundled Chromium.

`python tests/layout_smoke.py` checks that the canvas, the control panel and its tab bar keep their bounds in every animation frame on a phone, a portrait tablet, a narrow desktop window and a desktop, in both themes. It picks atoms, measures a known distance and angle, switches modes and tabs, adds and edits pairs, planes and arrows, scrolls the panel with a real touch gesture (the wheel with a mouse), opens Style and Turn, checks Escape and outside dismissal with focus return, and rotates the window and back. CI runs it with the bundled Chromium. Use `BROWSER_CHANNEL=chrome` or `CHROMIUM_EXECUTABLE` to pick another Chromium, and set `WEBKIT_EXECUTABLE` to the path of Playwright's WebKit `pw_run.sh` to also run WebKit.

Run the JavaScript geometry tests with `node --test tests/*.test.mjs`. The coordination browser test uses the packaged forsterite CIF (`python tests/coordination_smoke.py`). `python tests/pair_defaults_smoke.py` checks estimated cutoffs, element changes, stable pair colors and manual-cutoff restoration on desktop and phone. Run `python tests/steering_smoke.py` to check unrestricted rotation, axis views and custom directions in a triclinic cell. The plotting-range and display tests are `tests/ranges_smoke.py` and `tests/visibility_smoke.py`.

```sh
cargo test --locked --manifest-path engine/Cargo.toml
```

The browser smoke test needs Python Playwright and its Chromium and WebKit browsers. It uploads a known CIF through the file picker, selects two periodic images, and exercises navigation using mouse and touch events. With the viewer running, set `VIEWER_URL` to its address and run `python tests/smoke.py`. Run `python tests/workbench_smoke.py` to check control placement on desktop and tablet and distance measurement on a phone-sized touch screen.

`python tests/transparency_pixels_smoke.py` compares actual GPU pixels against known alpha-composition results for crossing and disjoint faces, reversed pair order, different opacities, nearby surfaces, and opaque obstruction. `python tests/face_order_smoke.py` checks the integrated forsterite renderer and picking. `python tests/export_smoke.py` decodes downloaded PNGs and movies and checks DPI metadata, cancellation, and recording interrupted by resizing.
