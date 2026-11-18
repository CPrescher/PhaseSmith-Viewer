# Worked examples

If you are not sure where a button is, keep [Find the controls](./interface.md) open beside the viewer. It shows the desktop tool rail and the phone Tools menu, with labeled close-ups of the measurement buttons.

Each example uses a bundled structure. Save a project before opening an example link if you want to keep your current scene.

## Coordination in forsterite

**Aim:** distinguish silicon tetrahedra from magnesium octahedra, and understand why a cutoff changes the displayed coordination.

1. [Open the forsterite example](https://cprescher.github.io/PhaseSmith-Viewer/?example=forsterite).
2. Open **Pairs**. Keep **Si–O = 1.80 Å** and **Mg–O = 2.30 Å**.
3. Hide the Mg–O polyhedra to examine isolated SiO₄ tetrahedra. Then restore Mg–O and hide Si–O to examine magnesium coordination.
4. Open **Sites** and inspect the coordination numbers and polyhedron volumes for the independent central sites.
5. Return to **Pairs** and lower the Mg–O cutoff to **2.15 Å**. This retains six neighbors around Mg1 but only three around Mg2.
6. Restore **2.30 Å** before comparing the complete Mg coordination polyhedra.

**What this shows:** different independent sites can have different distance distributions. A small cutoff change can exclude part of a distorted shell. The atoms have not moved, and the displayed coordination is conditional on the cutoff.

<ViewerFigure name="forsterite" alt="Forsterite with silicon and magnesium coordination polyhedra and their pair controls." />

## Follow a silicate chain in wollastonite

**Aim:** follow periodic connectivity beyond a single unit cell.

1. [Open the wollastonite example](https://cprescher.github.io/PhaseSmith-Viewer/?example=wollastonite). It starts looking along **c**, with three cells along **b**.
2. Follow the Si–O tetrahedra across the internal cell boundaries. Shared oxygen vertices connect neighboring tetrahedra.
3. In **Extent**, change the upper **b** limit from **3** to **1** and apply the range.
4. Restore the upper limit to **3**, then rotate slightly to separate overlapping atoms.

**What this shows:** the chain continues through lattice translations. A one-cell view can hide that continuity. Repeating the display does not create new independent crystallographic sites.

## Compare (111) and (222) planes

**Aim:** separate plane orientation from interplanar spacing.

1. Download the [ideal rock-salt CIF](https://cprescher.github.io/PhaseSmith-Viewer/example.cif), then load it with **Open file** in the [viewer](https://cprescher.github.io/PhaseSmith-Viewer/).
2. In **Lattice**, choose **＋ Plane**, enter `1 1 1`, and enable **Parallel planes**.
3. Set the offset **m = 0** so the two comparisons share a plane through the origin. Rotate to see the separation between planes.
4. Change the indices to `2 2 2`. Keep **m = 0** and **Parallel planes** enabled.
5. Compare the reported spacing: **d₂₂₂ = d₁₁₁ / 2**. The normals remain parallel and the planes become twice as closely spaced.

**Why:** (111) uses `x + y + z = m`; (222) uses `2x + 2y + 2z = m`. Successive integer values of *m* therefore produce half the separation in the second case.

In the ideal 5.64 Å cubic rock-salt model, d₁₁₁ is about **3.256 Å** and d₂₂₂ about **1.628 Å**. Drawing a plane family does not by itself establish the intensity of a diffraction reflection; intensity also depends on atomic scattering and interference.

## Inspect an X-ray powder pattern

**Aim:** compare reflection positions and relative intensities in an ideal structure calculation.

1. Keep rock salt open and choose **Plots**.
2. Change **Plot** to **Powder diffraction (X-ray)**.
3. Use **Wavelength = 1.5406 Å** and the default **5–90°** 2θ range.
4. Set **Peak FWHM = 0** to see discrete sticks. Select a line or table row to inspect its 2θ, d spacing, intensity, indices, and multiplicity.
5. Set **Peak FWHM = 0.15°** for a broadened illustration.
6. Choose **Save CSV** to export the integrated line values.

**What this shows:** reflection positions are set by the lattice and wavelength. Relative intensities also depend on the atoms, their positions and occupancies, reflection multiplicity, and the applied powder correction. The Gaussian width is an illustration, not a refined instrumental resolution.

Continue with [Pair distances and diffraction](./plots.md) for the normalization and model limitations.
