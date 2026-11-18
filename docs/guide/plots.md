# Pair distances and diffraction

Choose **Plots** to open the floating **Structure plots** window. It stays independent of the active settings palette and does not change the camera. Drag its title to move it; resize it on desktop. Close it with **×** or **Escape**.

Both calculations use the **full symmetry-expanded unit cell**. The displayed extent, hidden spheres, boundary copies, and asymmetric-unit view do not change their results. Plot preferences are saved in the browser session and in `.psv` projects.

## Pair distances

Choose **Pair distances**, set the lower and upper distance limits, and optionally select an element pair. The defaults are **0–6 Å**, all atom pairs, and a grouping tolerance of **0.001 Å**.

Each line represents a distance group. Its position is the mean distance, and its height counts **unordered geometric pairs per unit cell**. Periodic neighbors are included automatically, including pairs across cell faces and nonzero translations of a site onto itself.

![Pair-distance plot for rock salt with separate colors for Na–Cl, Na–Na and Cl–Cl contributions.](/images/pair-distances.png)

### Read the counts

A simple cubic cell containing one atom has six nearest neighbors around each atom but only **three unordered nearest-neighbor pairs per cell**: each shared pair is counted once. A peak height is therefore not generally a coordination number.

Nearly equal distances are grouped only when their full spread fits inside the tolerance. Increasing the tolerance combines close distances; it does not move atoms. Pair types have consistent colors across the plot, legend, and table. Overlapping types contribute colored segments to the same line.

Pair labels usually put the common anion on the right, such as Si–O or Na–Cl. This is a naming convention, not an assigned oxidation state.

### Inspect and export

Select a line or table row for its distance and counts. **Show all** expands the table, and **Save CSV** exports all values, including rows not currently displayed.

::: warning Geometric distribution, not an experimental PDF
Zero-occupancy sites are omitted. Partially occupied sites count as whole geometric sites; disorder correlations are not modeled. The plot is neither scattering weighted nor normalized as an experimental pair distribution function.
:::

The maximum distance is **30 Å**. A large structure or range can exceed the work limit sooner. Reduce the upper limit or choose one element pair when the calculation reports that the request is too large.

## Powder diffraction (X-ray)

Choose **Powder diffraction (X-ray)** and set:

| Setting | Default | Meaning |
| --- | --- | --- |
| Wavelength | 1.5406 Å | Incident X-ray wavelength |
| From / To 2θ | 5–90° | Scattering-angle range |
| Peak FWHM | 0.15° 2θ | Gaussian width for the illustrated profile |

Use **FWHM = 0** for sticks. A nonzero width must be at least **0.01°** and at most **2°**. Wavelengths can range from **0.1 to 3 Å**, and 2θ limits from **0.1 to 170°**, subject to the form-factor range below.

![Calculated rock-salt powder pattern with wavelength, angular range, and peak-width controls.](/images/powder.png)

### What is calculated?

The viewer calculates reciprocal-lattice positions and occupancy-weighted structure factors using neutral-atom Cromer–Mann X-ray form factors. Reflections with the same spacing are summed, including multiplicity and Friedel mates. A conventional unpolarized powder Lorentz–polarization correction is applied.

The table and CSV give **integrated line intensities**, scaled so the strongest line is 100. The Gaussian display is separately scaled so its highest profile value is 100. Consequently, profile heights and table intensities are not interchangeable when peaks overlap.

The table shows a representative Miller index for each line. The CSV retains the enumerated indices with opposite-sign Friedel mates implied. Select a line or row to see its d spacing, 2θ, relative intensity, and multiplicity.

### Model limitations

The calculation omits thermal motion, anomalous scattering, texture, absorption, and instrument-specific effects. The profile width is an illustrative Gaussian broadening. It is not a fit to measured data and does not represent crystallite size or strain.

Form factors require **sin(θ)/λ < 2 Å⁻¹**. If that limit is exceeded, decrease the maximum 2θ or increase the wavelength. If the browser work limit is reached, narrowing the angular range can help.

The coefficient table is adapted from [Gemmi's ITC 1992 neutral-atom table](https://gemmi.readthedocs.io/en/stable/scattering.html#x-ray-form-factors). See [Scientific conventions](./science.md#diffraction) for the equations and [the source notice](https://github.com/CPrescher/PhaseSmith-Viewer/blob/main/public/notices/gemmi.txt) for attribution.
