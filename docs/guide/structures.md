# Files and structure library

Use **Library** or the **Open file** button in the upper-right header, above the crystal view. Choose **Open file** for a CIF or **⋯ → Open project** for a saved scene.

<ViewerFigure name="file-controls" alt="Library, Open file and project menu controls in the header." />

## Open a structure

Choose **Open file** in the header and select a CIF. The file is read on your device, parsed by the PhaseSmith WebAssembly engine, and expanded using its crystallographic symmetry. If the file contains several data blocks, use the block selector in the header to choose the structure.

A CIF must contain atomic coordinates and a usable cell. A file containing only measured diffraction intensities has no atomic structure to display. Import errors leave the current scene in place.

The reader accepts fractional and Cartesian atom coordinates and common PDBx/mmCIF atom records. Inspect warnings when the CIF contains conflicting symmetry information. Macromolecular models and alternate conformers are shown together; biological assemblies, magnetic moments, and modulations require additional interpretation.

## Choose a library structure

**Library** opens a searchable collection of 52 bundled structures. Search by mineral name, formula, family, or a structure-type alias such as `B1`, `zinc blende`, or `feldspar`. Filter to **Structure types** or **Rock-forming & common minerals**, then select a structure's name to load it.

Each entry provides a reference, source link, and downloadable CIF. The loaded source remains accessible in the viewer header. Formula labels identify the mineral or structure type; the actual CIF retains its reported composition and occupancies.

::: tip Reference structure or teaching model?
Most library entries are reference CIFs from the Crystallography Open Database. Five entries are explicitly labeled **Idealized models**, using AFLOW topologies and rounded cell lengths. The ideal cubic perovskite is a teaching parent structure; orthorhombic CaTiO₃ is a separate mineral reference. Use the entry's source when deciding which is appropriate.
:::

The library is a selected collection, not an exhaustive mineral database. Solid solutions are represented by named members. Some structures lack hydrogen positions; the relevant cards say so.

## Share a starting structure

Direct links open specific entries:

- [Quartz](https://cprescher.github.io/PhaseSmith-Viewer/?structure=quartz)
- [Ideal cubic perovskite](https://cprescher.github.io/PhaseSmith-Viewer/?structure=cubic-perovskite)
- [Forsterite worked example](https://cprescher.github.io/PhaseSmith-Viewer/?example=forsterite)
- [Wollastonite worked example](https://cprescher.github.io/PhaseSmith-Viewer/?example=wollastonite)

A structure link selects a starting structure. It does **not** encode your current camera, colors, or cutoffs. Share a [`.psv` project](./saving.md#portable-project-files) to transfer those settings.

## Limits and local processing

The importer limits files to 16 MiB, 100 data blocks, 100,000 asymmetric sites, and 200,000 candidate positions before expansion. Displaying a large repeated structure can reach browser memory or graphics limits earlier.

Opening a CIF or project does not upload it. Library files are bundled with the application, but the viewer does not install an offline cache. To work without an internet connection, serve a local build as described in [Development](./development.md).
