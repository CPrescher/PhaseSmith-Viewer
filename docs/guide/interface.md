# Find the controls

The viewer has three separate sets of controls: the header above the crystal, small view and measurement buttons inside the crystal area, and a tool rail down its right edge. Opening a tool adds a settings window over the crystal.

The images below are actual screenshots. Numbered outlines locate each group; enlarged views show buttons that are easy to miss. Images follow the guide's light or dark theme.

## Identify the structure

The header shows the structure name and space group. Select either to open **Structure info** on a computer or phone. The panel lists the six unit-cell parameters and their reported standard uncertainties, calculated cell volume, crystal system, symmetry operations count, independent sites, and positions per cell. It also identifies the active CIF block and links to the original reference for library structures. The header, Structure info panel, and library use Hermann–Mauguin notation, including overbars (Fm3̅m) and screw-axis subscripts (P3₂21). If the CIF supplies no symmetry, the header marks the assumed P1 setting.

## On a computer or landscape tablet

The right-hand rail is vertically centered where it fits, shifting upward only to clear the lower controls. Separators group structure tools, analysis, appearance/output and Help.

<ViewerFigure name="interface" alt="The full viewer with numbered outlines identifying the file buttons, view toolbar, measurement toolbar, right-hand tool rail and lower-left visibility strip." />

| Group | Location | What to do there |
| --- | --- | --- |
| **1 · Files** | Upper-right header, above the crystal | Open the Library or use Open file to load a structure and the adjacent three-dot menu to save/open a project. |
| **2 · View** | Upper left inside the crystal | Look along a, b, c or [uvw]; open Turn for exact rotations. |
| **3 · Measurements** | Upper right inside the crystal, below the header | Choose Info, Distance, or Angle, then select atoms. |
| **4 · Tools** | Vertical rail at the right edge | Grouped structure, analysis, appearance/output and Help tools. |
| **5 · Visibility** | Lower left inside the crystal | Show/hide atoms or polyhedra, toggle element spheres, or change sphere size. |

## Recognize the measurement buttons

<ViewerFigure name="measurements" alt="Enlarged actual measurement toolbar with leader lines naming Info, Distance, Angle and Clear." />

The **i** button inspects one atom. **↔** measures between two atoms. **∠** measures the angle formed by three picks, with the second atom at the vertex. **×** clears the selection and stays gray until something is selected. Results appear immediately below the toolbar. These buttons are always separate from the settings window.

See [Measurements and sites](./measurements.md) for the picking order and interpretation.

## On a phone

The header stays at the top. The measurement buttons move into a **vertical column at the upper right**. The desktop tool rail is replaced by the round **Tools button at the lower right**.

<ViewerFigure name="phone" alt="Phone screenshot highlighting the measurement buttons at the upper right and the round Tools button at the lower right." />

Tap **Tools** to reveal the labeled menu shown below, then choose the tool. Its settings open in a sheet over the lower part of the crystal. In short landscape phone views, the placement adapts to the available space. **Details** under the measurement buttons expands the selected-atom or measurement readout.

<ViewerFigure name="phone-tools" alt="The expanded phone Tools menu listing Bonds & polyhedra, Sites, Lattice, Extent, Distances, Powder, Reflection, Detector, Style, Export and Help." caption="The menu contains settings tools. Distance and Angle remain in the separate measurement column." />

## Which tool do I need?

| Tool label | Opens | Guide |
| --- | --- | --- |
| **Bonds & polyhedra** | Bonds, coordination cutoffs and polyhedra | [Bonds and polyhedra](./coordination.md) |
| **Sites** | CIF sites, labels, coordination numbers and volumes | [Measurements and sites](./measurements.md#site-labels-and-polyhedron-volumes) |
| **Planes**, **Directions**, **Symmetry** (under **Overlays** when space is tight) | Planes, arrows and symmetry overlays | [Planes and directions](./lattice.md) |
| **Extent** | Displayed fractional-coordinate range | [Plotting extent](./navigation.md#plotting-extent) |
| **Distances** | Periodic interatomic distance distribution | [Pair distances](./plots.md#pair-distances) |
| **Powder** | Calculated powder diffraction and measured traces | [Powder diffraction](./plots.md#powder-diffraction-x-ray) |
| **Reflection** | Atomic layers, phases, and the structure factor for one reflection | [Explore a single reflection](./plots.md#explore-a-single-reflection) |
| **Detector** | Ewald sphere, specimen rotation, and predicted detector spots | [Diffraction detector](./plots.md#explore-a-single-reflection) |
| **Style** | Colors, sphere sizes and individual overrides | [Appearance](./navigation.md#appearance) |
| **Export** | PNG images and turntable movies | [Saving and exporting](./saving.md) |

## When a control is out of sight

Scroll **inside the open settings window** to see its lower sections. Export, for example, has movie controls below the PNG settings. Project files and local saves are in the header’s three-dot menu. Use **Compact** when a panel has unused space; the **Expand** icon restores its full height. This changes only the panel, not the camera. A **Tune** view shows only the last edited item; choose **All settings** to restore the full editor. Close or switch the tool from the rail/menu to reach another set of settings. Choosing a settings tool closes the science windows while retaining their values, so the selected controls are immediately reachable. Close a panel temporarily to reach atoms behind it, then reopen it to continue editing.

The crystal stays in place while you open and switch tools. Drag on the crystal to rotate it; drag inside a scrollable panel to scroll its settings on touch screens.

Dense panels offer a **Fold** icon to leave only their header visible while you inspect or measure the crystal. The **Expand** icon restores the panel without moving the structure. In a phone science window, **Tools** moves into its header so it cannot cover results.

Floating tool windows can be resized from either bottom corner. Phone sheets adapt to the available space automatically.
