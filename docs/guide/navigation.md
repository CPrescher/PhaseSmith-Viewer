# Navigation and display

Use the [desktop and phone control map](./interface.md) to locate the tool rail, measurement buttons, and visibility controls.

## Using the tool windows

Settings start closed. On desktop and tablet, choose **Pairs**, **Style**, **Lattice**, **Sites**, **Extent** or **Export** from the right-hand bar. Click the active item again to close it; choosing another replaces its content in the same palette. Each tool keeps its values and scroll position. There is one settings window, with a Close button and no Pin or Minimize controls. Desktop palettes can be dragged and resized; double-clicking the title restores the default position.

At phone width, the round **Tools** button is at the lower right and opens a labeled list above it. Phone and portrait-tablet settings use a sheet above the persistent bottom controls. Short landscape phones put the editor under the direction toolbar at the left, leaving the measurement modes and aligned info readout at the right. **Tune** shows just the last-touched pair, plane or arrow; **All settings** restores the full editor and its scroll position.

Settings are overlays: opening, switching, moving, resizing or closing them never moves, zooms or refits the structure. Use the original rotation, pan, wheel/pinch zoom, axis directions, Turn pad and explicit Fit controls to place the structure. Picking atoms updates the info readout beneath the measurement modes without changing the active editor.

<ViewerFigure name="visibility" alt="The lower-left visibility strip with labels pointing to Atoms, Polyhedra, element controls and Size." />

The icon toggles at the lower left independently show/hide **Atoms** and **Polyhedra**. Hiding polyhedra hides both faces and outlines, preserving every pair's cutoff, opacity, colors and enabled state; planes and arrows are unaffected. The Pairs filter **Hide atoms outside polyhedra** is different: it limits the atoms to centers and vertices belonging to enabled polyhedra.

## Mouse and touch navigation

The **view toolbar is at the upper left inside the crystal area**, below the header.

<ViewerFigure name="view-controls" alt="Actual view toolbar with axis directions a, b, c, uvw, Turn and Reset." />

Left-drag continuously in any direction to turn the model over its poles around the current view center. The wheel zooms about the cursor. Right-drag pans with the point you grab held under the cursor. A right-click zooms out one step, and a double right-click fits the displayed structure while preserving its orientation. Use the **a**, **b**, or **c** views to align the camera with a direct lattice axis. For a custom direction, enter the three indices of [uvw]. The camera looks toward the structure from the positive side of the vector u**a** + v**b** + w**c**. The parallel projection aligns rows of atoms along that direction. These are direct lattice directions. In a nonorthogonal cell a direct direction and the normal to the plane with the same indices generally differ.

**Turn** opens step controls for exact rotations. Choose 90°, 60°, 45°, 30°, 10° or 5°, or type a custom angle greater than 0° and at most 360° (decimals allowed). The arrow pad turns the crystal left, right, up, down or along one of the four diagonals by exactly that angle. **⟲** and **⟳** roll it counterclockwise or clockwise in the screen plane. Directions describe how the crystal appears to move. Every turn is about the current view center and keeps the zoom, atom coordinates, selections and measurements. The crystal stops exactly at the new orientation. The controls stay open for repeated turns and close with ✕, Escape or a tap elsewhere; Escape or ✕ returns keyboard focus to **Turn**. On a phone they open along the bottom edge, over the tool sheet, so the middle of the crystal stays uncovered. Turns are unavailable while an image or movie is exported.

On a touchscreen, one finger rotates the crystal. Two fingers can also twist to rotate in the screen plane; holding one still while moving the other rotates about that finger. Two fingers drag it by the same screen distance, and pinching zooms about the point between your fingers. Drag and pinch can be combined; the grabbed point follows the midpoint without pan inertia.

## Plotting extent

Open **Extent** on the right-hand tool rail, or **Tools → Extent** on a phone. Edit the lower and upper coordinate fields, then click **Apply** below the fields.

<ViewerFigure name="extent" alt="Extent window with a, b and c plotting-range fields and the Apply button." />

Set the lower and upper fractional coordinates independently along **a**, **b**, and **c**. A range of 0 to 1 spans one cell, −1 to 1 spans two cells, and fractional limits select part of a cell. Applying the range repeats the structure by lattice translations and fits the new extent in the current orientation. Each translated atom remains individually selectable for distance measurements.

Open [the wollastonite example](https://cprescher.github.io/PhaseSmith-Viewer/?example=wollastonite) to follow the Si–O chains through three cells along **b**. The example opens looking along **c** and uses the triclinic structure from the Freiburg exercise, with **a** and **c** each spanning one cell. Shared oxygen vertices connect successive tetrahedra across both internal cell boundaries. Increasing the upper b limit extends the chains. For a shorter view, change it back to 1.

## Appearance

Open **Style**, the palette icon near the bottom of the tool rail, or **Tools → Style** on a phone.

<ViewerFigure name="appearance" alt="Appearance window showing the style target selector, colors and size controls." />

Every element from H to Og has a defined default color. Common mineral elements use contrasting colors: O red, Si blue, Mg green, Al violet, Ca gold and Fe orange. Polyhedra inherit their central element's default color, so their colors stay consistent when pairs are added or deleted. Colors stay the same in both themes. Other element colors and the fallback covalent radii are adapted from the [Blue Obelisk Data Repository](https://github.com/BlueObelisk/bodr/blob/master/bodr/elements/elements.xml).

Choose **Style** from the tools; the Appearance window opens. Choose an element to change its spheres' color and **Radius**, or a pair to change its polyhedra's color and **Opacity**. Polyhedron faces and edges always use the actual coordinating atom positions; saved display scales from earlier versions are ignored. Atom radius changes only the spheres drawn on screen.

**Sphere radii** changes the reference for the whole structure. **Ionic (Shannon)** starts with effective ionic radii. Open **Ionic radii by site** to see the value in Å, the assumed coordination number (CN), and the spin state where applicable. A charge written in the CIF atom type, such as Fe3+, takes precedence over mineral presets. With no charge specified, common ions in mineral compounds use labeled presets. Sites without a suitable entry use the covalent radius. Choose an entry for a site to apply it to all its symmetry and periodic copies. **Auto** restores its default. [Shannon (1976), Table 1](https://doi.org/10.1107/S0567739476001551)

For example, open forsterite and compare the default reference radii for Mg (0.72 Å, CN VI), Si (0.26 Å, CN IV), and O (1.40 Å, CN VI). The global **Size** slider starts at 50% so the polyhedra remain visible. At 100%, spheres with their Appearance radius at 100% use the tabulated values in Å. **Covalent** uses the element's covalent radius. **Classic** uses the original schematic sizes, also used when reopening projects saved before the radius selector was added.

To highlight one copy, enable **Pick one** and tap a sphere or a polyhedron face. Individually styled copies stay in the target list, also after a restart. The reset button names its target. **Reset atom** or **Reset polyhedron** removes only that copy's own style, so it follows the current element or pair style again. **Reset element** or **Reset pair** restores the defaults of the whole element or pair, including its individually styled copies. **Reset all … individual styles** removes every individual override at once. Resets never change coordinates. Close Appearance or choose another tool to return to measuring.

The **View** readout above the atom legend shows the current viewing direction as a direct-lattice vector [u v w], pointing from the crystal toward you, like the **a**, **b** and **c** buttons. Exact small-integer directions are shown as they are. Other directions are marked with ≈.

## Undo and redo

**Undo** and **Redo** stay below the view controls, beside **Turn** on phones. In short landscape views, they use 44 px icon buttons on the direction-toolbar row, clear of the settings editor. They cover pairs and cutoffs, styles and resets, visibility, plotting extent, lattice overlays, symmetry, measurements, site highlighting, and camera changes. A slider drag, held slider key, camera drag (including its settling motion), pinch, or burst of wheel zoom is one step. Axis views, exact turns and Reset are individual steps. Hover over either button to see its next action.

Use **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+Shift+Z** to redo, or **Ctrl+Y** to redo. Text fields retain their normal text undo. Switching tabs, selecting a style target, and changing export preferences do not create steps. New edits after undo discard redo. The last 100 actions are kept in memory; successfully opening another structure or data block, or reloading the page, starts a fresh history. Autosave saves the current result after undo or redo. Undo and redo pause during image/movie export.
