---
title: User guide
description: Learn to explore crystal structures, measure atomic geometry, and illustrate coordination and diffraction with PhaseSmith Viewer.
---
<script setup>
import { version } from "../../package.json"
</script>

# PhaseSmith Viewer user guide

Explore a crystal structure from its atoms to its coordination polyhedra, lattice planes, and powder diffraction pattern. PhaseSmith Viewer runs in your browser on a computer, tablet, or phone. Open a CIF or choose a structure from the built-in library to begin.

**<a href="../" target="_blank" rel="noopener">Open the viewer ↗</a>** · **[Start the five-minute guide](./getting-started.md)** · [Impressum & privacy](#impressum)

<ViewerFigure name="forsterite" alt="Forsterite in PhaseSmith Viewer, showing Si–O tetrahedra and Mg–O octahedra with the Bonds & polyhedra controls." />
<p class="caption">Forsterite: use pair cutoffs to explore the coordination around silicon and magnesium.</p>

## What would you like to do?

| Task | Where to start |
| --- | --- |
| Find a button or tool on desktop or phone | [Find the controls](./interface.md) |
| Open a CIF or find a reference mineral | [Files and structure library](./structures.md) |
| Rotate, orient, or repeat the crystal | [Navigation and display](./navigation.md) |
| Measure a distance, angle, or polyhedron volume | [Measurements and sites](./measurements.md) |
| Build coordination polyhedra | [Bonds and polyhedra](./coordination.md) |
| Show a plane, direction, or symmetry element | [Lattice tools](./lattice.md) |
| Calculate distance groups or an X-ray powder pattern | [Distances and Powder](./plots.md) |
| Save a reusable project, image, or movie | [Saving and exporting](./saving.md) |
| Understand the calculations and their limits | [Scientific conventions](./science.md) |

## Learn by doing

The [worked examples](./tutorials.md) walk through coordination in forsterite, silicate chains in wollastonite, parallel lattice planes, and a powder pattern. Each starts from a bundled structure, so no data preparation is needed.

## About this guide

This guide accompanies PhaseSmith Viewer **{{ version }}**. To check the version in the viewer, open the **⋯** menu beside **Open file**. The version appears at the bottom. Labels in **bold** match controls in the application. Lengths are in ångströms (Å), angles in degrees, and volumes in Å³ unless stated otherwise.

Structure files are parsed and analyzed locally in the browser. Save a `.psv` project when you need a portable copy of your work; browser autosave alone is not a backup. For source code, issues, and contributions, visit [GitHub](https://github.com/CPrescher/PhaseSmith-Viewer).

## Impressum & privacy {#impressum}

### Operator and contact

Prof. Dr. Clemens Prescher operates PhaseSmith Viewer in a personal capacity. Correspondence can be sent to his university office.

<address>
<strong>Prof. Dr. Clemens Prescher</strong><br>
<span lang="de">Albert-Ludwigs-Universität Freiburg<br>
Professur für Geomaterialien und kristalline Werkstoffe<br>
Hermann-Herder-Straße 5<br>
79104 Freiburg im Breisgau</span><br>
Germany
</address>

[clemens.prescher@geomat.uni-freiburg.de](mailto:clemens.prescher@geomat.uni-freiburg.de)<br>
[+49 761 203 6436](tel:+497612036436)

### Privacy · Datenschutz

**Files and settings.** The viewer reads structure files, projects, powder patterns and detector calibrations on your device. Calculations run in your browser. To restore a session, the viewer stores its data in your browser’s IndexedDB and saves preferences such as the colour theme locally. You can remove these records by clearing this site’s data in your browser.

**Hosting.** GitHub Pages serves the public viewer and guide. When you visit, GitHub receives your IP address and logs it for security purposes. GitHub describes its handling of this data, including retention and international transfers, in its privacy statement. [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection) · [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)

**Contact and your rights.** If you email the operator, your address and message are used to answer your enquiry. You can use the contact above to request access, correction, restriction or deletion of personal data concerning you, or to object to processing, as applicable. You can also [lodge a complaint with the Baden-Württemberg data protection authority](https://www.baden-wuerttemberg.datenschutz.de/beschwerde/).

### Scientific use

Coordination numbers depend on the selected distance cutoff. Simulated diffraction intensities depend on the supplied structure and the scattering model. Before using a result in a publication, check the input structure, calculation settings and model assumptions, and cite the original structure determination. [Scientific conventions](./science.md)

### Sources and licences

Each reference structure in the library links to its source. The bundled software and data carry their respective notices. [Structure library](../notices/structure-library.txt) · [PhaseSmith](../notices/PhaseSmith.txt) · [Three.js](../notices/Three.txt) · [Blue Obelisk](../notices/blue-obelisk.txt) · [Gemmi](../notices/gemmi.txt)
