# Measurements and sites

Look at the **upper right of the crystal area, below the header**. The measurement toolbar is separate from the right-hand tool rail. On a phone, these buttons form a vertical column in the same corner; you do not need to open Tools.

<ViewerFigure name="measurements" alt="Actual measurement buttons with leader lines labeling Info, Distance, Angle and Clear." />

## Inspect one atom

Click **Info**, the **i** button at the start of the measurement toolbar, to inspect one atom at a time, including its CIF label, element, occupancy, displayed coordinates and configured coordination information.

Clicking a sphere selects only that displayed atom, even while **Sites** is open, and clears any site-wide highlight. Selecting a table row in **Sites** highlights all equivalent copies instead and clears the individual Info selection.

The left-click action buttons stay fixed at the top right of the crystal view. Switching between **Info**, **Distance**, and **Angle** clears the current selection so the new mode starts fresh. Atom details and measurement results appear in a separate card below them, beside the tool rail; long details scroll inside the card. **Clear** keeps its place and is dimmed until an atom is selected. On phones, the buttons stay in a vertical column with the value (or the atom's label) below them; **Details** opens the full lines in a small panel that closes again with **Hide**.

## Measure a distance or angle

Click **Distance**, the **↔** button beside Info, and then pick two atoms in the crystal. The result is the Cartesian separation between those selected images in Å, including any lattice translation between them. It is not automatically the shortest periodic separation.

Click **Angle**, the **∠** button beside Distance, and pick three atoms in A–B–C order. The second atom is the angle vertex. Select **↔** (Distance) to return to two-atom distance measurements.

## Site labels and polyhedron volumes

<ViewerFigure name="sites" alt="Sites and volumes window showing original CIF sites and the coordination table." />

Choose **Sites**, the second button on the right-hand tool rail (or **Tools → Sites** on a phone), to see the original CIF site labels, fractional coordinates and occupancies. **Site labels** annotates visible spheres. Tap a table row to highlight visible copies of that site. The polyhedron table reports coordination numbers and convex-hull volumes in Å³ by central site. These volumes use the physical atomic coordinates.

**Show coordination shell** draws the neighbor hull around one equivalent atom: the visible copy closest to the center of the plotted structure. Rotating or panning the view keeps that choice fixed; changing the plotted extent or atom visibility chooses the closest available copy again. All equivalent site copies remain highlighted. The hull includes periodic neighbors within the site cutoff, so a large cutoff can encompass several neighbor layers and extend beyond the plotted atoms.

## Asymmetric unit

**Asymmetric unit** displays each original independent site once before symmetry expansion. Pair geometry pauses in this view. Switching it off restores the full expanded structure and its pair settings.
