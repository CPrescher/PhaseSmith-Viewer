# PhaseSmith Viewer

A standalone browser application for exploring crystal structures and measuring the distance between atomic sites. CIF parsing and symmetry expansion run locally in a Web Worker using PhaseSmith compiled to WebAssembly. Three.js renders the resulting structure using WebGL.

[Open the viewer](https://cprescher.github.io/PhaseSmith-Viewer/) · [Source on GitHub](https://github.com/CPrescher/PhaseSmith-Viewer) · [CI and deployments](https://github.com/CPrescher/PhaseSmith-Viewer/actions)

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Pick **Open file** to load a CIF structure or a saved `.psv` project from the device. Drag to rotate and use the wheel or pinch to zoom. The editing tools open in windows over the crystal; see [Tool windows](#tool-windows). **Info** is active by default: click or tap an atom to inspect it. To measure, choose **Distance** (↔) and select two atoms, or **Angle** (∠) and select three. Distances are Cartesian separations in ångströms between the selected images. This distinction matters across cell faces: two periodic copies of the same crystallographic site can be a lattice translation apart.

## Tool windows

Settings start closed. On desktop and tablet, choose **Pairs**, **Style**, **Lattice**, **Sites**, **Extent** or **Export** from the right-hand bar. Click the active item again to close it; choosing another replaces its content in the same palette. Each tool keeps its values and scroll position. There is one settings window, with a Close button and no Pin or Minimize controls. Desktop palettes can be dragged and resized; double-clicking the title restores the default position.

At phone width, the round **Tools** button is at the lower right and opens a labeled list above it. Phone and portrait-tablet settings use a sheet above the persistent bottom controls. Short landscape phones put the editor under the direction toolbar at the left, leaving the measurement modes and aligned info readout at the right. **Tune** shows just the last-touched pair, plane or arrow; **All settings** restores the full editor and its scroll position.

Settings are overlays: opening, switching, moving, resizing or closing them never moves, zooms or refits the structure. Use the original rotation, pan, wheel/pinch zoom, axis directions, Turn pad and explicit Fit controls to place the structure. Picking atoms updates the info readout beneath the measurement modes without changing the active editor.

The icon toggles at the lower left independently show/hide **Atoms** and **Polyhedra**. Hiding polyhedra hides both faces and outlines, preserving every pair's cutoff, opacity, colors and enabled state; planes and arrows are unaffected. The Pairs filter **Hide atoms outside polyhedra** is different: it limits the atoms to centers and vertices belonging to enabled polyhedra.

## Built-in structure library

Choose **Library** beside **Open file** to browse 52 bundled structures. Search by name, formula, mineral family, or structure-type alias (for example, “B1”, “zinc blende”, “biotite”, or “feldspar”), and filter to **Structure types** or **Rock-forming & common minerals**. Click a structure's name to load it. The library fits phones and supports keyboard navigation and Escape to close.

The collection includes rock salt, CsCl, zinc blende, wurtzite, fluorite, rutile, corundum, spinel, perovskite, diamond, graphite, fcc/bcc/hcp metals, and representatives of olivines, pyroxenes, amphiboles, feldspars, micas, chlorites, clays, garnets, carbonates, sulfates, phosphates, and common accessory minerals. These are selected reference structures, not an exhaustive mineral database. Solid-solution families are represented by named members; the card formula identifies the mineral/type while the CIF retains its reported composition and occupancies. Missing H coordinates are noted on the relevant cards.

Most entries are unchanged public-domain CIFs from the [Crystallography Open Database](https://www.crystallography.net/cod/), with the original authors' references retained. Five explicitly labeled **Idealized models** use [AFLOW structure topologies](https://aflow.org/prototype-encyclopedia/) and rounded illustrative cell lengths. The ideal cubic perovskite is a teaching parent structure; the separate orthorhombic CaTiO3 entry is the mineral reference. Forsterite and wollastonite reuse the existing example files. Every card expands to show its reference, source link, and CIF download. The loaded structure's source stays available in the header and after session restoration.

Open `/?structure=quartz` or `/?structure=cubic-perovskite` for a direct library entry. Existing `?example=forsterite` and `?example=wollastonite` addresses retain their worked-example settings. Library CIFs are served with the app (about 160 KB total); loading them needs no external database service. This does not add an offline app cache.

The catalog is maintained in `web/structure-library.json`, and new reference CIFs go in `public/structures/`. Each catalog entry records its source, citation, collection, search aliases, and file SHA-256. Keep downloaded reference data unchanged and identify constructed teaching models explicitly. `tests/structure-library.test.mjs` imports the entire catalog through the shipped WebAssembly reader and checks selected chemical multiplicities. The reader merges symmetry images of the same independent site within 0.0001 fractional coordinates to accommodate rounded special positions such as 0.3333; different independent sites retain their own labels and occupancies.

## Orientation

Left-drag continuously in any direction to turn the model over its poles around the current view center. The wheel zooms about the cursor. Right-drag pans with the point you grab held under the cursor. A right-click zooms out one step, and a double right-click fits the displayed structure while preserving its orientation. Use the **a**, **b**, or **c** views to align the camera with a direct lattice axis. For a custom direction, enter the three indices of [uvw]. The camera looks toward the structure from the positive side of the vector u**a** + v**b** + w**c**. The parallel projection aligns rows of atoms along that direction. These are direct lattice directions. In a nonorthogonal cell a direct direction and the normal to the plane with the same indices generally differ.

**Turn** opens step controls for exact rotations. Choose 90°, 60°, 45°, 30°, 10° or 5°, or type a custom angle greater than 0° and at most 360° (decimals allowed). The arrow pad turns the crystal left, right, up, down or along one of the four diagonals by exactly that angle. **⟲** and **⟳** roll it counterclockwise or clockwise in the screen plane. Directions describe how the crystal appears to move. Every turn is about the current view center and keeps the zoom, atom coordinates, selections and measurements. The crystal stops exactly at the new orientation. The controls stay open for repeated turns and close with ✕, Escape or a tap elsewhere; Escape or ✕ returns keyboard focus to **Turn**. On a phone they open along the bottom edge, over the tool sheet, so the middle of the crystal stays uncovered. Turns are unavailable while an image or movie is exported.

On a touchscreen, one finger rotates the crystal. Two fingers drag it by the same screen distance, and pinching zooms about the point between your fingers. Drag and pinch can be combined; the grabbed point follows the midpoint without pan inertia.

## Displaying more than one unit cell

Set the lower and upper fractional coordinates independently along **a**, **b**, and **c**. A range of 0 to 1 spans one cell, −1 to 1 spans two cells, and fractional limits select part of a cell. Applying the range repeats the structure by lattice translations and fits the new extent in the current orientation. Each translated atom remains individually selectable for distance measurements.

Open `/?example=wollastonite` to follow the Si–O chains through three cells along **b**. The example opens looking along **c** and uses the triclinic structure from the Freiburg exercise, with **a** and **c** each spanning one cell. Shared oxygen vertices connect successive tetrahedra across both internal cell boundaries. Increasing the upper b limit extends the chains. For a shorter view, change it back to 1.

## Bonds and coordination polyhedra

Choose the central element, its neighboring element, and their maximum distance in ångströms. Bonds and polyhedra can be switched independently for each pair. A center inside the displayed cell can have neighbors in adjacent cells. The viewer includes these periodic images and measures distances to the actual image selected.

New pairs start with an estimated cutoff from the structure's periodic first-neighbor distances, including the different independent central sites. Changing either element recalculates this starting value. A gap between distance groups helps separate the first shell; distorted shells get a small margin. These are editable starting estimates, not chemical bond assignments. Very large or extreme searches fall back to an element-specific covalent-radius estimate. Typed cutoffs and restored session values stay as entered.

Tap or click a pair’s cutoff to open its speed slider. It opens in place of the pair's Bonds, Polyhedra and Opacity row, so nothing below moves and the pair's counts stay visible while the polyhedra change. Hold the knob a little left or right for fine changes in 0.01 Å increments. Drag farther to change the cutoff faster and release to stop. The − and + buttons change it by 0.1 Å. On touch screens, tap the field again to type an exact cutoff; Enter, ✓, Escape or a tap outside the pair closes the slider.

The **Opacity** slider controls each pair’s polyhedron faces. At 0% only the outlines remain visible. At 100% the faces are opaque. Turn off **Atoms** to remove the spheres from the view, or toggle an element in the legend to hide only its spheres. Bonds, polyhedra, and their coordination counts are independent of sphere visibility.

Transparent faces from all pairs and lattice planes are composed in depth order at each pixel, including intersecting polyhedra. The renderer adapts up to 24 surface layers. Deeper stacks use an approximate remainder and show a status note: next to the atom count below the view, or on a phone at the end of the Pairs tool. The note clears once the view needs 24 layers or fewer. Exactly coincident faces share one layer. A small depth tolerance prevents surfaces from being drawn repeatedly because of floating-point rounding. PNG and movie exports use the same renderer with the full layer budget.

Use **Hide atoms outside polyhedra** to show only the centers and vertices of enabled polyhedra. Turn it off to see the surrounding structure. Changing the cutoff changes which neighbors qualify for the display; the imported atom positions stay fixed.

Open `/?example=forsterite` for a worked example using the Mg end member of olivine (Boström, 1987, *American Mineralogist* 72, 965–972, AMCSD 0001118). The Si–O and Mg–O cutoffs of 1.80 Å and 2.30 Å include the complete first coordination shells. Hide one rule to examine the other. Lower the Mg–O cutoff to 2.15 Å to retain all six neighbors around Mg1 and three around Mg2.

## Planes, directions and symmetry

Choose **Lattice** from the tools. **＋ Plane** adds a Miller-index plane with integer indices and an editable fractional offset m in hx + ky + lz = m. A new plane starts at a whole-number m: the integer closest to the center of the displayed extent among those whose plane crosses its interior (ties go toward 0), otherwise the nearest integer on its boundary. In one cell, (100) starts at m = 1, (1̄00) at −1 and (11̄0) at 0. A very narrow fractional extent may contain no plane with an integer m; the plane's readout then says so, and you can type a fractional m, widen the extent or raise Size. While m has not been typed in, it follows changes to the indices. Once you enter m yourself it stays fixed, also when the indices or the extent change.

**Family** draws the parallel planes at m + n for integer n intersecting the displayed extent. Changing m moves the whole family.

**Size** (100–200%) draws a plane's faces beyond the plotted range, enlarging the clipping box about its center. The plane equation, m, the spacing and the family offsets stay the same.

**Opacity** (0–100%, default 28%) sets how strongly each plane entry's faces are drawn. At 0% only the outline and the label remain. At 100% the faces are opaque and hide what lies behind them. Each plane reports its interplanar spacing in ångströms.

The Lattice **Labels** toggle annotates added planes and directions. **Show m in labels** adds the offset to plane labels ("(100) · m=0.5"); turned off, labels show only the indices. It changes label text only, and in exports too.

**Position** places plane labels **Outside** a projected edge of the drawn plane with a short leader line in the plane's color (default), against an **Edge** without a leader, or at the **Center** of the plane. Outside and Edge labels avoid the view controls, the legend, other labels and, where possible, the structure itself. In tight views a label falls back to sitting on the edge, and further members of a family are left unlabeled rather than placed over the middle of the structure. Exported images and movies show the same label positions and leaders. Direction labels stay beside the arrow tip.

**＋ Arrow** adds a direct-lattice [uvw] vector with a fractional origin and a length multiplier.

**Elements** shows symmetry axes, planes and inversion centers derived from the imported CIF operations. Use the type filters to examine rotation, screw, rotoinversion, inversion, mirror or glide elements. The **Operations** list shows their fractional-coordinate equations. Generated overlays are clipped to the plotting extent. A status note identifies any generation limit.

**Choose axis types** selects exact symbols independently, such as 2, 3, 4, 2₁, 3₁, 3₂ or 3̅. Counts include coincident lower-order rotations: a fourfold line also remains visible when only its twofold rotation is selected. **Axes only** hides planes and standalone inversion centers; **Clear axis types** followed by selecting **3** isolates pure threefold axes. Category switches still apply.

Axis selections are saved with the session. All elements use the actual space-group locations from the CIF.

## Angles, sites and volumes

Choose **Info** to inspect one atom at a time, including its CIF label, element, occupancy, displayed coordinates and configured coordination information.

The left-click action buttons stay fixed at the top right of the crystal view. Switching between **Info**, **Distance**, and **Angle** clears the current selection so the new mode starts fresh. Atom details and measurement results appear in a separate card below them, beside the tool rail; long details scroll inside the card. **Clear** keeps its place and is dimmed until an atom is selected. On phones, the buttons stay in a vertical column with the value (or the atom's label) below them; **Details** opens the full lines in a small panel that closes again with **Hide**.

Use **∠** in the measurement control and pick three atoms in A–B–C order. The second atom is the angle vertex. Select **↔** (Distance) to return to two-atom distance measurements.

Choose **Sites** from the tools to see the original CIF site labels, fractional coordinates and occupancies. **Labels** annotates visible spheres. Tap a table row to highlight visible copies of that site. The polyhedron table reports coordination numbers and convex-hull volumes in Å³ by central site. These volumes use the physical atomic coordinates.

**Asymmetric unit** displays each original independent site once before symmetry expansion. Pair geometry pauses in this view. Switching it off restores the full expanded structure and its pair settings.

## Changing colors and sizes

Every element from H to Og has a defined default color. Common mineral elements use contrasting colors: O red, Si blue, Mg green, Al violet, Ca gold and Fe orange. Polyhedra inherit their central element's default color, so their colors stay consistent when pairs are added or deleted. Colors stay the same in both themes. Other element colors and the fallback covalent radii are adapted from the [Blue Obelisk Data Repository](https://github.com/BlueObelisk/bodr/blob/master/bodr/elements/elements.xml).

Choose **Style** from the tools; the Appearance window opens. Choose an element to change its spheres' color and **Radius**, or a pair to change its polyhedra's color and **Opacity**. Polyhedron faces and edges always use the actual coordinating atom positions; saved display scales from earlier versions are ignored. Atom radius changes only the spheres drawn on screen.

To highlight one copy, enable **Pick one** and tap a sphere or a polyhedron face. Individually styled copies stay in the target list, also after a restart. The reset button names its target. **Reset atom** or **Reset polyhedron** removes only that copy's own style, so it follows the current element or pair style again. **Reset element** or **Reset pair** restores the defaults of the whole element or pair, including its individually styled copies. **Reset all … individual styles** removes every individual override at once. Resets never change coordinates. Close Appearance or choose another tool to return to measuring.

The **View** readout above the atom legend shows the current viewing direction as a direct-lattice vector [u v w], pointing from the crystal toward you, like the **a**, **b** and **c** buttons. Exact small-integer directions are shown as they are. Other directions are marked with ≈.

## Undo and redo

**Undo** and **Redo** stay below the view controls, beside **Turn** on phones. In short landscape views, they use 44 px icon buttons on the direction-toolbar row, clear of the settings editor. They cover pairs and cutoffs, styles and resets, visibility, plotting extent, lattice overlays, symmetry, measurements, site highlighting, and camera changes. A slider drag, held slider key, camera drag (including its settling motion), pinch, or burst of wheel zoom is one step. Axis views, exact turns and Reset are individual steps. Hover over either button to see its next action.

Use **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+Shift+Z** to redo, or **Ctrl+Y** to redo. Text fields retain their normal text undo. Switching tabs, selecting a style target, and changing export preferences do not create steps. New edits after undo discard redo. The last 100 actions are kept in memory; successfully opening another structure or data block, or reloading the page, starts a fresh history. Autosave saves the current result after undo or redo. Undo and redo pause during image/movie export.

## Project files

Choose **Export → Project file → Save project** to download a `.psv` file. It embeds the complete original CIF (including all data blocks) and the current viewer settings: extent, pairs, styles, atom visibility, planes, directions, symmetry, labels, camera, measurement picks, tool windows, export preferences, and light/dark theme. Reopen it with **Open file** in the header or **Export → Project file → Open project**. The file works in a fresh browser or on another computer without the original CIF. Saving downloads a new file; it does not overwrite an earlier download automatically. Undo/redo history starts fresh when a project is opened.

The format is readable JSON with a format identifier and version, independent of the local browser session format. Unsupported versions and unreadable structures report an error and keep the current scene. Project contents stay local; nothing is uploaded.

## Saved session

The viewer saves its state on this device and restores it when you open the same page again, also after restarting the browser. This covers the loaded CIF and data block, the plotting extent, pairs and their cutoffs, colors and opacities, element and individual styles, atom visibility, size and labels, the asymmetric-unit view, planes, directions, symmetry and label settings, the camera, the turn angle, the measurement with its picked atoms in order, and the open tool windows with their places. Nothing is uploaded. Opening a different example address starts that example instead. **Export → Session** shows the save status; **Start fresh** discards the saved session and reloads this page's structure.

## Images, movies and themes

Choose **Export** from the tools to save a PNG at 1×, 2× or 4× resolution, with an optional transparent background. Exports crop to the drawn structure, including visible cell edges, planes, arrows and labels, with a small margin. The lattice-axis compass sits beside the structure at the lower right; selected-atom or measurement details have their own space above it. The DPI field writes print-resolution metadata and reports the approximate physical print size. Pixel dimensions follow the cropped frame and resolution setting.

The movie control records a full turntable revolution at the selected duration and frame rate. Its fixed frame fits the structure throughout the entire turn, including geometry that rotates beyond the live viewport, so the crop stays steady. The browser selects a supported MP4 or WebM encoder. Visible planes, arrows, symmetry elements, labels, measurements and the lattice-axis compass are included in exports. Cancel stops a movie recording and restores the view.

The header theme button switches between light and dark. An explicit choice is remembered. The initial theme follows the device preference.

The **Full screen** button beside the theme button expands the entire viewer, keeping its controls and structure library available. Tap it again to exit, or use the browser’s exit control (Escape on desktop). It appears only when the browser supports fullscreen; older iPad Safari’s prefixed API is supported too. The crystal resizes automatically when entering, leaving, or rotating the tablet. Fullscreen starts only from a tap or click and is not restored with saved sessions or projects.

## Try on a tablet or phone

Drag with one finger to rotate around the current view center, just like a left mouse drag. Use two fingers to move the structure, pinch to zoom, or twist to rotate in the screen plane. Hold one finger still and move the other around it to rotate around that fixed finger. These gestures can be combined. Lifting one finger resumes rotation around a fixed center without changing the zoom.

The crystal stays in view while you edit the structure. A landscape tablet shows the floating palette beside the crystal; in portrait, and on phones, the tool opens as a sheet along the bottom (along the right edge in landscape on a phone), and the crystal is centered in the space above or beside it. Picking atoms, switching measurement modes or tools, adding pairs, planes or arrows, and opening editors never change the size of the crystal view or of the tool window. Longer content scrolls inside the tool window; each tool keeps its own scroll position, and picking an atom never scrolls it. **Tune** gives the crystal more room while you adjust one pair, plane or arrow.

Controls are at least 44 px on touch screens. If the element legend is too long, its fading edge indicates that it can be scrolled horizontally; the Size slider stays beside it.

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

Routine releases run the JavaScript tests, build the app for its GitHub Pages path, and run a short Chromium smoke check against the production build. It opens all three examples, checks WebAssembly loading, plane placement and saved-session restoration. Rust tests and WebAssembly recompilation run when `engine/` or `scripts/copy-engine.mjs` changed; ordinary interface fixes reuse the checked-in importer. Passing changes on `main` deploy automatically; pull requests run the same release checks without deploying.

The longer interaction suite is optional, not a routine release gate. Choose **Run workflow → full_browser_matrix** on GitHub for all eleven browser scripts and exhaustive screen/theme/DPI combinations, plus a fresh Rust build. Run it locally with:

```sh
VIEWER_URL=http://localhost:4179 VIEWER_TEST_PROFILE=ci python tests/run_browser_checks.py
```

The `ci` profile uses one low-DPI touch case, compact nonorthogonal crystals for touch/turn correctness, and representative desktop, tablet, portrait-phone and landscape-phone layouts across both themes. It passed locally in 144 seconds, but software rendering on GitHub is substantially slower. The default local profile is `full`, which retains all display/DPI combinations.

The runner prints live progress and per-script timings, runs two independent scripts at a time, and stops timed-out scripts with their browser children. `--workers 1` runs checks serially; optional script names select a subset; `--timeout` sets the per-script limit. Routine deployment uses only `pages_smoke`, with a two-minute script limit and a three-minute browser-step limit.

To run the portable production browser check, install `tests/requirements-browser.txt` and Chromium (`python -m playwright install chromium`), serve the built app, then run `VIEWER_URL=http://localhost:4179 python tests/pages_smoke.py`. Run `tests/library_smoke.py` with the same environment for library search, filtering, loading, source links, session restoration, failed downloads and direct entry links on desktop and phone. `BROWSER_CHANNEL=chrome` uses an installed Chrome instead of Playwright's bundled Chromium.

`python tests/layout_smoke.py` checks that the canvas, the tool launcher, the open tool window's outline and the measurement buttons keep their bounds in every animation frame on a phone, a portrait tablet, a narrow desktop window and a desktop, in both themes. It picks atoms, measures a known distance and angle, switches measurement modes and tools, adds and edits pairs, planes and arrows, scrolls a tool window with a real touch gesture (the wheel with a mouse), checks that picking neither scrolls nor replaces the tool and that each tool keeps its scroll position, opens Style and Turn, checks Escape and outside dismissal with focus return, and rotates the window and back.

`python tests/tool_windows_smoke.py` checks the stationary-scene workflow across desktop, tablet, portrait phone and landscape phone, in both themes: tool buttons toggle one editor, switching preserves its bounds, opening the phone list also leaves projected atom coordinates unchanged, the info readout aligns with its modes, visibility shortcuts and the lower-right phone launcher stay fixed and reachable, and global polyhedron visibility remains independent of atoms and preserves scientific data through rebuilds, edits and session restoration. It also checks parameter drags frame by frame, moving/resizing a window, per-tool values and scroll, Tune, picking, Details, orientation changes, invalid plane input and measured clearance above the footer. `node --test tests/tool-windows.test.mjs` covers responsive bounds, single-tool state and migration of older multi-window sessions. CI runs these with bundled Chromium; `BROWSER_CHANNEL=chrome` selects an installed Chrome, and `WEBKIT_EXECUTABLE` optionally adds Playwright WebKit (native mouse slider drags in a touch-capable narrow viewport).

`python tests/history_smoke.py` checks undo/redo for scene edits, grouped mouse/touch camera gestures, sliders, shortcuts, saved sessions and document changes on desktop and phone.

`python tests/project_smoke.py` checks portable downloads and reopening in a fresh browser, multiblock CIFs, styles, lattice objects, camera and measurement restoration, invalid files, and autosave on desktop and phone.

`python tests/history_smoke.py` checks undo/redo for scene edits, grouped mouse/touch camera gestures, sliders, shortcuts, saved sessions and document changes on desktop and phone.

`python tests/touch_pan_smoke.py` checks native two-finger dragging and combined drag/pinch in landscape and portrait tablet and phone layouts at several pixel densities. It checks projected atom positions during movement, while held and after release, plus transitions between one and two fingers.

Run the JavaScript geometry tests with `node --test tests/*.test.mjs`. The coordination browser test uses the packaged forsterite CIF (`python tests/coordination_smoke.py`). `python tests/pair_defaults_smoke.py` checks estimated cutoffs, element changes, stable pair colors and manual-cutoff restoration on desktop and phone. Run `python tests/steering_smoke.py` to check unrestricted rotation, axis views and custom directions in a triclinic cell. The plotting-range and display tests are `tests/ranges_smoke.py` and `tests/visibility_smoke.py`.

```sh
cargo test --locked --manifest-path engine/Cargo.toml
```

The browser smoke test needs Python Playwright and its Chromium and WebKit browsers. It uploads a known CIF through the file picker, selects two periodic images, and exercises navigation using mouse and touch events. With the viewer running, set `VIEWER_URL` to its address and run `python tests/smoke.py`. Run `python tests/workbench_smoke.py` to check control placement on desktop and tablet and distance measurement on a phone-sized touch screen.

`python tests/transparency_pixels_smoke.py` compares actual GPU pixels against known alpha-composition results for crossing and disjoint faces, reversed pair order, different opacities, nearby surfaces, and opaque obstruction. `python tests/face_order_smoke.py` checks the integrated forsterite renderer and picking. `python tests/export_smoke.py` decodes downloaded PNGs and movies and checks DPI metadata, cancellation, and recording interrupted by resizing.
