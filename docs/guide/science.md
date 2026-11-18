# Scientific conventions

The viewer helps inspect and illustrate a supplied structure. Display choices such as sphere size, color, plotting extent, and polyhedron opacity do not refine or relax its atomic coordinates.

## Coordinates and periodic images

A fractional position *(x, y, z)* is expressed in the direct lattice basis:

<div class="equation">r = x a + y b + z c</div>

Integer translations generate periodic copies. Symmetry-related atoms can share an independent CIF site label; translated copies can also share that label while occupying different displayed positions.

**Distance** measures the Cartesian separation between the two images you select. It does not automatically replace your selection with the closest periodic image. **Angle** measures A–B–C with B as its vertex. Both calculations use the physical positions, regardless of sphere radius.

## Directions and plane normals

A direction **[uvw]** represents **u a + v b + w c**. A view along [uvw] looks toward the crystal from the positive side of that vector.

A plane **(hkl)** at offset *m* satisfies:

<div class="equation">hx + ky + lz = m</div>

Its normal is the reciprocal-lattice vector <strong>g = h a<sup>∗</sup> + k b<sup>∗</sup> + l c<sup>∗</sup></strong>, using reciprocal basis vectors without a 2π factor. The spacing between successive integer offsets is:

<div class="equation">d<sub>hkl</sub> = 1 / |g|</div>

In a cubic cell, **d = a / √(h² + k² + l²)**. For nonorthogonal cells, [hkl] is generally **not** perpendicular to (hkl); the viewer uses the full lattice metric.

Changing (111) to (222) keeps the same normal direction but halves the spacing. The indices must not be reduced to their smallest integer ratio when describing that spacing or a diffraction reflection. **Parallel planes** draws the same indexed plane at offsets *m + n* for integer *n*.

## Coordination and polyhedron volume

A pair rule selects a central element, a neighbor element, and a maximum distance. Its **coordination number (CN)** counts the neighbors within that cutoff, including periodic neighbors beyond the displayed cell boundary. The automatically estimated cutoff is a starting point to inspect, not a chemical bond determination.

A reported polyhedron volume is the **convex-hull volume of its coordinating atomic positions**, in Å³. It is not an ionic volume, an atomic sphere volume, or a measurement derived from how large the model appears on screen. Degenerate arrangements cannot form a three-dimensional hull.

The **Sites** table distinguishes original independent CIF sites. Showing the **Asymmetric unit** displays those sites once and pauses pair geometry; it is a different representation from the full expanded crystal.

## Pair-distance multiplicities

The distance plot counts each unordered geometric pair once per unit cell over the requested radial interval. It includes periodic translations, rather than restricting the calculation to the nearest image or to the displayed supercell.

Partially occupied sites are treated as whole geometric sites for this plot. Their counts do not describe the probabilities of simultaneous occupation in a disordered structure.

## Diffraction

For fractional coordinates *(xⱼ, yⱼ, zⱼ)* and occupancy *oⱼ*, the X-ray structure factor is:

<div class="equation">F(hkl) = Σⱼ oⱼ fⱼ(s) exp[2πi(hxⱼ + kyⱼ + lzⱼ)]</div>

Here **s = sin(θ)/λ = 1/(2d)**. Neutral-atom Cromer–Mann form factors depend on *s*. The structure-factor intensity contribution is |F|², and Bragg's law gives the scattering angle:

<div class="equation">2d sin θ = λ</div>

The powder calculation sums contributions at the same spacing and includes Friedel mates and multiplicity. Its unpolarized Lorentz–polarization factor is:

<div class="equation">LP = (1 + cos² 2θ) / (sin² θ cos θ)</div>

Thermal motion, anomalous scattering, preferred orientation, absorption, and instrumental effects are omitted. Integrated line intensities are normalized to a maximum of 100; the displayed Gaussian profile is normalized separately. These are model values, not absolute measured intensities.

## Symmetry and source data

Symmetry overlays are derived from the imported CIF operations. They reflect the source's cell setting and origin. An apparently unusual axis location can result from a different setting; inspect the operations and source before interpreting it as a rendering error.

Reference structures retain the cited authors' coordinates and occupancies. Idealized teaching structures are explicitly labeled in the library. For scientific work, cite the original structure source and record which CIF and viewer settings were used. A saved `.psv` project preserves that CIF together with the scene settings.
