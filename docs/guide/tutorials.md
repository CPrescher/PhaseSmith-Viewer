# Worked examples

If you are not sure where a button is, keep [Find the controls](./interface.md) open beside the viewer. It shows the desktop tool rail and the phone Tools menu, with labeled close-ups of the measurement buttons.

Each example uses a bundled structure. Save a project before opening an example link if you want to keep your current scene. After each main step, compare your result with the screenshot and its caption. Screenshots follow the guide's light or dark theme; select one to open it at full resolution. Your window size and camera angle can change the appearance; compare the features and values described below.

## Coordination in forsterite

**Aim:** distinguish silicon tetrahedra from magnesium octahedra, and understand why a cutoff changes the displayed coordination.

### 1. Open the example and check the pairs

<a href="../?example=forsterite" target="_blank" rel="noopener">Open the forsterite example</a>. Choose **Bonds & polyhedra** on the right-hand tool rail (on a phone, open **Tools → Bonds & polyhedra**). Keep **Si–O = 1.80 Å** and **Mg–O = 2.30 Å**, with **Polyhedra** enabled in both pair cards.

<ViewerFigure name="tutorial-forsterite-start" alt="Forsterite with blue silicon tetrahedra, green magnesium octahedra, and both pair controls enabled." caption="Starting point: blue Si–O tetrahedra and green Mg–O octahedra appear together. The two pair cards control them separately." />

### 2. Show only the silicon tetrahedra

In the **Mg–O** card, clear **Polyhedra**. Keep it enabled for **Si–O**. Enable **Hide atoms outside polyhedra** to isolate the Si–O tetrahedra.

<ViewerFigure name="tutorial-forsterite-silicon" alt="Forsterite with only the blue SiO4 tetrahedra visible and the Mg–O polyhedra checkbox cleared." caption="Four blue SiO₄ tetrahedra remain. The Si–O card reports CN 4: each silicon has four oxygen neighbors within 1.80 Å." />

### 3. Show only the magnesium octahedra

Enable **Polyhedra** for **Mg–O**, then clear it for **Si–O**.

<ViewerFigure name="tutorial-forsterite-magnesium" alt="Forsterite with green MgO6 octahedra visible and silicon polyhedra hidden." caption="The green magnesium octahedra replace the blue tetrahedra. At 2.30 Å, both independent magnesium sites have six oxygen neighbors." />

### 4. Compare the independent sites

Re-enable **Si–O Polyhedra** so both pairs are active. Choose **Sites** on the tool rail and scroll to the polyhedron table.

<ViewerFigure name="tutorial-forsterite-sites" alt="Sites table showing Mg1 and Mg2 with coordination six and Si with coordination four, alongside their polyhedron volumes." caption="Check the table: Mg1 and Mg2 both have CN 6, but their volumes differ—about 11.787 and 12.392 Å³. Si has CN 4 and a volume of about 2.208 Å³." />

### 5. Shorten the magnesium cutoff

Return to **Bonds & polyhedra**. In the **Mg–O** card, enter **2.15 Å** in the cutoff field and press **Enter**.

<ViewerFigure name="tutorial-forsterite-short-cutoff" alt="Forsterite after reducing the Mg–O cutoff to 2.15 angstroms, with fewer complete green polyhedra." caption="Some green octahedra disappear. Mg1 still has six neighbors, but Mg2 now has only three inside the cutoff, so its complete octahedron is no longer drawn. The blue silicon tetrahedra remain." />

### 6. Restore the complete shells

Set the **Mg–O** cutoff back to **2.30 Å** and press **Enter**.

<ViewerFigure name="tutorial-forsterite-restored" alt="Forsterite with all magnesium octahedra restored at a 2.30 angstrom cutoff." caption="The missing green octahedra return. Both magnesium sites again have six neighbors; the atom positions have not changed." />

**What this shows:** different independent sites can have different distance distributions. A small cutoff change can exclude part of a distorted shell. The displayed coordination is conditional on the cutoff.

## Follow a silicate chain in wollastonite

**Aim:** follow periodic connectivity beyond a single unit cell.

### 1. Follow the chain through three cells

<a href="../?example=wollastonite" target="_blank" rel="noopener">Open the wollastonite example</a>. It starts looking along **c**, with three cells along **b**. Choose **Extent** on the tool rail (on a phone, **Tools → Extent**) to see the ranges. Follow the Si–O tetrahedra across the internal cell boundaries.

<ViewerFigure name="tutorial-wollastonite-three-cells" alt="Wollastonite viewed along c with connected silicon tetrahedra spanning three cells along b and Extent set from zero to three." caption="The b range is 0–3. Shared oxygen vertices connect neighboring tetrahedra across the internal cell boundaries; the chain continues beyond one unit cell." />

### 2. Reduce the view to one cell

In **Extent**, tap **−** twice beside **b Max** to reduce it from **3** to **1**. You can also type **1** and press **Enter**.

<ViewerFigure name="tutorial-wollastonite-one-cell" alt="Wollastonite with the b range reduced to zero to one, showing a shorter segment of the silicate chain." caption="The b range is now 0–1, and fewer repeats are visible. The viewer refits the scene, so compare the cell boundaries and number of repeats rather than their size on screen." />

### 3. Restore the repeats and tilt the view

Restore the upper **b** limit to **3** and press **Enter**. Choose **Turn** in the upper-left view controls, select **10°**, and click the upward arrow once. Close the Turn popover by pressing **Escape** or tapping outside it.

<ViewerFigure name="tutorial-wollastonite-tilted" alt="Three wollastonite cells after a small upward tilt, revealing the depth of the connected tetrahedra." caption="Three repeats are visible again. The slight tilt separates some overlapping atoms and exposes the depth of the tetrahedra without changing their connectivity." />

**What this shows:** the chain continues through lattice translations. A one-cell view can hide that continuity. Repeating the display does not create new independent crystallographic sites.

## Compare (111) and (222) planes

**Aim:** separate plane orientation from interplanar spacing.

<a href="../?example=halite-222" target="_blank" rel="noopener">Open rock salt with the (222) planes already visible</a>. Rotate the crystal, then change the existing plane to (111) to compare the spacing.

### 1. Load the rock-salt model

Download the <a href="../example.cif" target="_blank" rel="noopener">ideal rock-salt CIF</a>, then load it with **Open file** in the upper-right header of the <a href="../" target="_blank" rel="noopener">viewer</a>.

<ViewerFigure name="tutorial-rock-salt-start" alt="The ideal sodium chloride structure loaded in the viewer before adding lattice planes." caption="Start with the NaCl model and its cubic unit-cell outline. No plane family has been added yet." />

### 2. Display the (111) family

Choose **Planes** in the launcher (under **Overlays** if space is tight), then **＋ Plane**. Enter `1 1 1` in **h k l**, set the offset **m = 0**, and enable **Parallel planes**. Press **Enter** after editing a field. Keep the oblique view so you can see the separation between planes.

<ViewerFigure name="tutorial-planes-111" alt="Rock salt with the parallel 111 planes enabled at offset zero and a spacing of approximately 3.256 angstroms." caption="Parallel (111) sheets cross the cubic cell. With m = 0, one plane passes through the origin. The Planes panel reports d ≈ 3.256 Å." />

### 3. Change to (222) and compare

Change **h k l** to `2 2 2` and press **Enter**. Keep **m = 0**, **Parallel planes**, and the camera orientation unchanged.

<ViewerFigure name="tutorial-planes-222" alt="The same rock-salt view with parallel 222 planes, spaced half as far apart as the 111 planes." caption="The sheets keep the same orientation but become twice as closely spaced. The reported spacing is now d ≈ 1.628 Å: d₂₂₂ = d₁₁₁ / 2." />

**Why:** (111) uses `x + y + z = m`; (222) uses `2x + 2y + 2z = m`. Successive integer values of *m* therefore produce half the separation in the second case.

These values apply to the ideal 5.64 Å cubic rock-salt model. Drawing a plane family does not by itself establish the intensity of a diffraction reflection; intensity also depends on atomic scattering and interference.

## Inspect an X-ray powder pattern

**Aim:** compare reflection positions and relative intensities in an ideal structure calculation.

### 1. Open the powder calculation

Keep the rock-salt model open, or load it as described above. Choose **Powder** on the tool rail (on a phone, **Tools → Powder**). Use **Wavelength = 1.5406 Å** and the default **5–90°** 2θ range.

<ViewerFigure name="tutorial-powder-settings" alt="Rock-salt powder diffraction plot with wavelength 1.5406 angstroms, a 5 to 90 degree range, and the calculated reflection table." caption="Nine powder lines appear in this range. The strongest line is near 31.704° 2θ, with its relative integrated intensity set to 100. The table lists individual line values below the graph." />

### 2. Inspect a discrete reflection

Set **Peak FWHM = 0** to show discrete sticks. Select the first table row, **1 1 1**, or its stick near **27.367°**.

<ViewerFigure name="tutorial-powder-sticks" alt="Discrete powder sticks with the 111 reflection selected in the graph and table." caption="The selected (111) line is highlighted in the graph and table. Its details show 2θ ≈ 27.367°, d ≈ 3.256 Å, relative intensity ≈ 8.13, and multiplicity 8." />

### 3. Broaden the pattern and export the lines

Set **Peak FWHM = 0.15°**. Keep the same reflection selected to compare its position and table values. Choose **Save CSV** at the bottom of the window to download the integrated line values.

<ViewerFigure name="tutorial-powder-broadened" alt="The same selected 111 reflection in a Gaussian-broadened powder pattern with peak FWHM 0.15 degrees." caption="The sticks become narrow Gaussian peaks. Their positions and integrated line values are unchanged. Save CSV exports the line table, rather than the sampled broadened curve." />

**What this shows:** reflection positions are set by the lattice and wavelength. Relative intensities also depend on the atoms, their positions and occupancies, reflection multiplicity, and the applied powder correction. The Gaussian width is an illustration, not a refined instrumental resolution.

Continue with [Pair distances and diffraction](./plots.md) for the normalization and model limitations.
