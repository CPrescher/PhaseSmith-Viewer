# Atomic and ionic radii

Open **Style → Sphere radii** to choose how large the viewer draws each atom. On a phone, open **Tools → Style**. The default is **Crystal (Shannon 1976)**. Changes affect the spheres you see and pick. Distance, angle, coordination, and polyhedron volume use the atomic coordinates.

<ViewerFigure name="appearance" alt="Appearance window with Crystal (Shannon 1976) selected under Sphere radii." />

## Compare the four models

The values below are reference radii in ångströms (Å). The two Shannon rows use six-coordinate Mg²⁺, four-coordinate Si⁴⁺, and six-coordinate O²⁻. These are the viewer's presets for forsterite.

| Sphere radii | What sets the size | Mg (Å) | Si (Å) | O (Å) |
|---|---|---:|---:|---:|
| **Crystal (Shannon 1976)** | Ion, coordination, and spin on the crystal-radius scale | 0.86 | 0.40 | 1.26 |
| **Effective ionic (Shannon 1976)** | Same site environment on the effective ionic scale | 0.72 | 0.26 | 1.40 |
| **Atomic (neutral atoms)** | Electron density of an isolated neutral atom | 2.40 | 2.32 | 1.71 |
| **Single-bond covalent (Pyykkö–Atsumi)** | Each element’s fitted contribution to a molecular single-bond length | 1.39 | 1.16 | 0.63 |

### Shannon and Prewitt or Shannon?

R. D. Shannon and C. T. Prewitt published the original work on effective ionic radii in oxides and fluorides in 1969. Shannon revised and expanded the tabulation in 1976. The viewer uses selected entries from the **crystal radius (CR)** and **effective ionic radius (IR)** columns of Table 1 in the 1976 paper. Both columns describe ions in specified environments. [Shannon & Prewitt (1969)](https://doi.org/10.1107/S0567740869003220) · [Shannon (1976), Table 1](https://doi.org/10.1107/S0567739476001551)

**Try periclase (MgO).** Open Periclase from the structure library. Under **Style → Shannon radii by site**, inspect the six-coordinate Mg²⁺ and O²⁻ entries. With **Crystal**, the two reference radii sum to 0.86 + 1.26 = **2.12 Å**. Switch to **Effective ionic** and the sum is 0.72 + 1.40 = **2.12 Å**. The Mg sphere shrinks and the O sphere grows. Use **Distance** on adjacent Mg and O atoms to measure their actual separation in the CIF.

### Neutral atoms and single bonds

**Atomic** gives every site of an element the same reference size. Rahm, Hoffmann, and Ashcroft calculated the average distance from the nucleus of an isolated neutral atom at which the electron density falls to 0.001 electrons per bohr³. The viewer uses their corrected neutral-atom values for H through Cm. For elements beyond Cm, Appearance identifies the missing entries and uses a schematic 0.42 Å radius. [Neutral-atom dataset](https://rahmlab.com/radii-of-the-elements/) · [2017 corrections](https://doi.org/10.1002/chem.201700610)

**Single-bond covalent** also gives each element one reference size. Pyykkö and Atsumi fitted radii for elements 1–118 so that adding two radii approximates a molecular single-bond length. The viewer takes this table from the Blue Obelisk Data Repository. [Pyykkö & Atsumi (2009)](https://doi.org/10.1002/chem.200800987) · [Blue Obelisk data update](https://github.com/BlueObelisk/bodr/commit/c7917225cad8)

## Site choices and display scale

- **Inspect a Shannon entry.** Expand **Shannon radii by site**, choose a **Crystal site**, and read the charge, coordination number (CN), spin where applicable, and radius in Å. A charge in the CIF atom-type symbol, such as Fe3+, takes precedence over a mineral preset. The initial CN and spin come from the viewer’s preset for that charge. Changing a pair cutoff does not assign a new Shannon entry.
- **Change one site.** Choose a **Reference radius** to apply it to every symmetry and periodic copy of that site. Switching between the two Shannon scales keeps the selected site environment. **Auto** restores the automatic choice. If the viewer lacks a suitable ionic entry, it displays the covalent fallback in the site menu.
- **Draw the tabulated size.** Set the global **Size** slider and the element or atom **Radius** control to 100%. The drawn radius is the reference radius multiplied by both scale factors. At the initial global size of 50%, six-coordinate Mg²⁺ on the crystal scale is drawn at 0.43 Å.
- **Reopen a project.** Saved projects keep their selected model, site overrides, and size settings. Projects saved with the retired Classic model, or before the selector existed, reopen with **Crystal (Shannon 1976)** at their saved display scale.
