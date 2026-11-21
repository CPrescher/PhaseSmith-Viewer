# Pair distances and diffraction

Choose **Distances** or **Powder** in the analysis group of the right-hand rail (on a phone, open **Tools**). Each entry opens the corresponding plot directly. They share a floating window and retain their settings when you switch. **Reflection** explains one indexed reflection; **Detector** predicts where reflections land. The main crystal remains stationary when opening any of these tools. Drag a window’s title to move it; close it with its active launcher, **×**, or **Escape**.

Both calculations use the **full symmetry-expanded unit cell**. The displayed extent, hidden spheres, boundary copies, and asymmetric-unit view do not change their results. Plot preferences are saved in the browser session and in `.psv` projects.

## Pair distances

Choose **Distances** from the tools, set the lower and upper distance limits, and optionally select an element pair. On compact screens, expand **Plot settings · range and appearance** to edit the limits. The defaults are **0–6 Å**, all atom pairs, and a grouping tolerance of **0.001 Å**.

Each line represents a distance group. Its position is the mean distance, and its height counts **unordered geometric pairs per unit cell**. Periodic neighbors are included automatically, including pairs across cell faces and nonzero translations of a site onto itself.

<ViewerFigure name="pair-distances" alt="Pair-distance plot for rock salt with separate colors for Na–Cl, Na–Na and Cl–Cl contributions." />

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

Choose **Powder** from the tools, then set:

| Setting | Default | Meaning |
| --- | --- | --- |
| Wavelength | 1.5406 Å | Incident X-ray wavelength |
| From / To 2θ | 5–90° | Scattering-angle range |
| Peak FWHM | 0.15° 2θ | Gaussian width for the illustrated profile |

Use **FWHM = 0** for sticks. A nonzero width must be at least **0.01°** and at most **2°**. Wavelengths can range from **0.1 to 3 Å**, and 2θ limits from **0.1 to 170°**, subject to the form-factor range below.

<ViewerFigure name="powder" alt="Calculated rock-salt powder pattern with wavelength, angular range, and peak-width controls." />

### What is calculated?

The viewer calculates reciprocal-lattice positions and occupancy-weighted structure factors using PhaseSmith’s neutral-atom Waasmaier–Kirfel X-ray form factors. Reflections with the same spacing are summed, including multiplicity and Friedel mates. A conventional unpolarized powder Lorentz–polarization correction is applied.

The table and CSV give **integrated line intensities**, scaled so the strongest line is 100. The Gaussian display is separately scaled so its highest profile value is 100. Consequently, profile heights and table intensities are not interchangeable when peaks overlap.

The table shows a representative Miller index for each line. The CSV retains the enumerated indices with opposite-sign Friedel mates implied. Select a line or row to see its d spacing, 2θ, relative intensity, and multiplicity.

### Compare a measured trace

Under **Measured powder trace**, open an XY, DAT, XYE, TXT, or CSV file with 2θ in degrees in the first column and intensity in the second. Separate columns with whitespace or commas. The viewer draws the measured trace in orange and scales its visible range independently. Select a position on the plot to read the nearest measured sample in its original units and the angular difference from the nearest calculated line.

Select a calculated line, choose a **Reflection family**, and select **Explain this peak** to open the phase sum at the same wavelength. A line can contain distinct families with coincident spacings, such as cubic (511) and (333).

### Model limitations

The calculation includes isotropic or anisotropic displacement parameters supplied by the CIF. It omits anomalous scattering, texture, absorption, and instrument-specific effects. The profile width is an illustrative Gaussian broadening. It is not a fit to measured data and does not represent crystallite size or strain.

Form factors require **sin(θ)/λ ≤ 6 Å⁻¹**. If that limit is exceeded, decrease the maximum 2θ or increase the wavelength. If the browser work limit is reached, narrowing the angular range can help.

See [Scientific conventions](./science.md#diffraction) for the structure-factor calculation.

## Explore a single reflection

Open **Reflection** and enter the Miller indices and wavelength to inspect how the atomic layers contribute to the reflection. Like the plot windows and Detector, it is a movable window: its title bar moves it, and its launcher, ×, or Escape closes it without changing the main view. On compact screens, use **Crystal**, **Phase sum**, and **Ray paths** to choose the explanation, and expand **Wavelength / detector** for the wavelength, detector link, or exercise export. Choose **Show on detector** to follow that same reflection to its predicted spot. The **(hkl)** field here and in Detector accepts compact entries such as `200` for `2 0 0`. Use spaces for multi-digit indices.

<ViewerFigure name="reflection" alt="Reflection explorer showing the selected Miller indices, crystal layers and contributions to the structure factor." />

## Diffraction detector

<ViewerFigure name="detector" alt="Diffraction detector showing the Ewald sphere, the Detector spots tab and crystal rotation controls." />

The Ewald sphere shows the reciprocal lattice, the incident beam and the diffracted beam.

In **Detector**, enter **2 0 0** for periclase and press **Enter** to rotate to the reflection. Step through other crossings with **Previous reflection** and **Next reflection**. Choose **Link main view** to turn the specimen from the crystal view. **Show crystal** reduces the detector to a control dock; **Show detector** restores the diagrams. On phones, switch between **Ewald sphere** and **Detector spots**. In landscape, the controls and diagrams scroll independently. With Powder open, selecting a detector reflection synchronizes the wavelength and extends the plot range if needed to include its powder line.

Geometry edits apply immediately; mounting matrices use **Apply orientation**. Open **Options**, a movable window beside the detector on a wide screen, to change the wavelength, detector distance, or detector shape, import a PONI calibration, or set the specimen orientation and rotation axis.

Under **Options → Rotation-wedge coverage**, set the start and end ω to count discrete crossings on the active detector and export their indices and angles. An optional DAC half-opening filters both incident and outgoing rays through a symmetric double cone aligned with the beam at ω = 0° and rotating with the spindle. Continuously excited indices are excluded from the discrete count.
