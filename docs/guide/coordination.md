# Bonds and coordination polyhedra

Open **Pairs**, the top button on the right-hand tool rail. On a phone, tap **Tools** at the lower right, then **Pairs**. The window contains a row for each central-element / neighbor-element pair.

<ViewerFigure name="pairs" alt="Pairs window showing cutoff fields, Bonds and Polyhedra switches and opacity sliders." />

## Define a pair

Choose the central element, its neighboring element, and their maximum distance in ångströms. Bonds and polyhedra can be switched independently for each pair. A center inside the displayed cell can have neighbors in adjacent cells. The viewer includes these periodic images and measures distances to the actual image selected.

## Choose a cutoff

New pairs start with an estimated cutoff from the structure's periodic first-neighbor distances, including the different independent central sites. Changing either element recalculates this starting value. A gap between distance groups helps separate the first shell; distorted shells get a small margin. These are editable starting estimates, not chemical bond assignments. Very large or extreme searches fall back to an element-specific covalent-radius estimate. Typed cutoffs and restored session values stay as entered.

Tap or click a pair’s cutoff to open its speed slider. It opens in place of the pair's Bonds, Polyhedra and Opacity row, so nothing below moves and the pair's counts stay visible while the polyhedra change. Hold the knob a little left or right for fine changes in 0.01 Å increments. Drag farther to change the cutoff faster and release to stop. The − and + buttons change it by 0.1 Å. On touch screens, tap the field again to type an exact cutoff; Enter, ✓, Escape or a tap outside the pair closes the slider.

## Visibility and opacity

The **Opacity** slider controls each pair’s polyhedron faces. At 0% only the outlines remain visible. At 100% the faces are opaque. Turn off **Atoms** to remove the spheres from the view, or toggle an element in the legend to hide only its spheres. Bonds, polyhedra, and their coordination counts are independent of sphere visibility.

## Transparent surfaces

Transparent faces from all pairs and lattice planes are composed in depth order at each pixel, including intersecting polyhedra. The renderer adapts up to 24 surface layers. Deeper stacks use an approximate remainder and show a status note: next to the atom count below the view, or on a phone at the end of the Pairs tool. The note clears once the view needs 24 layers or fewer. Exactly coincident faces share one layer. A small depth tolerance prevents surfaces from being drawn repeatedly because of floating-point rounding. PNG and movie exports use the same renderer with the full layer budget.

Use **Hide atoms outside polyhedra** to show only the centers and vertices of enabled polyhedra. Turn it off to see the surrounding structure. Changing the cutoff changes which neighbors qualify for the display; the imported atom positions stay fixed.

## Inspect all neighbors of one site

Select an independent site in **Sites**, or pick an atom in the crystal and choose **Site neighbors**. The table groups periodic neighbors by ligand site and distance across all elements. Leave the cutoff blank for an estimated first shell, or enter a distance in Å. The outline follows the selected shell, including planar carbonate triangles.

For fluorapatite, select **Ca2** and enter **2.8 Å** to see seven neighbors, including both O and F. The summary gives the mean distance and Baur distortion index D, the mean absolute deviation in bond length divided by the mean bond length. A three-dimensional shell also has a convex-hull volume. Partially occupied neighbors contribute whole positions to the geometric count.

## Try a worked example

Open [the forsterite example](https://cprescher.github.io/PhaseSmith-Viewer/?example=forsterite) for a worked example using the Mg end member of olivine (Boström, 1987, *American Mineralogist* 72, 965–972, AMCSD 0001118). The Si–O and Mg–O cutoffs of 1.80 Å and 2.30 Å include the complete first coordination shells. Hide one rule to examine the other. Lower the Mg–O cutoff to 2.15 Å to retain all six neighbors around Mg1 and three around Mg2.

Each pair shows the coordination number and convex-hull volume for its central sites. Open **Sites** for the table across all pairs. See [Measurements and sites](./measurements.md) and [Scientific conventions](./science.md#coordination-and-polyhedron-volume) for their interpretation.
