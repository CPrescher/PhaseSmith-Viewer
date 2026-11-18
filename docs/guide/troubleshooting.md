# Troubleshooting

## The page is blank or the structure does not load

Use a current browser with **WebGL 2** and WebAssembly support. If graphics acceleration is disabled, enable it and reload. Try a small bundled library structure to distinguish a browser problem from an input-file problem.

For a local build, serve the files through an HTTP server. Opening `index.html` directly from the filesystem does not reliably load the worker and WebAssembly files. See [Development](./development.md).

## My CIF fails to import

Read the error message first. Check that the file contains a cell and atomic coordinates, not only diffraction observations. For a multiblock file, select a block containing a structure. Very large files may exceed the [import limits](./structures.md#limits-and-local-processing).

If you report an import problem, include a small reproducible CIF when you are permitted to share it, the error text, and the browser name and version.

## A bond or polyhedron is missing

Check the central and neighbor elements, the pair's cutoff, and its **Bonds** or **Polyhedra** switch. Also check the global **Polyhedra** visibility toggle. At 0% opacity only outlines remain.

A cutoff below part of a distorted first shell excludes those neighbors. Inspect the distances before increasing it. If **Asymmetric unit** is enabled under **Sites**, pair geometry is paused; switch it off for the expanded structure.

## Atoms seem to have disappeared

Check the global **Atoms** toggle, the element legend, and **Hide atoms outside polyhedra**. The last option displays only centers and vertices belonging to enabled polyhedra. Check the plotting extent if only part of the cell appears.

Hiding a sphere does not remove its atomic position from coordination or plot calculations.

## The distance is larger than expected

The measurement uses the exact displayed copies you selected. Two atoms with the same site label can be separated by a full lattice translation. Rotate the structure or reduce its extent to distinguish overlapping copies, then reselect the intended pair.

## A direction is not perpendicular to its plane

**[uvw]** uses the direct lattice, while a plane's normal uses the reciprocal lattice. Equal index triples describe parallel vectors only for certain metrics, including the usual cubic case. See [Directions and plane normals](./science.md#directions-and-plane-normals).

## A plane is not visible

Check its indices, offset, and the plotting extent. The plane must intersect the clipping box. Increase **Size** to extend the drawn face beyond the plotted range, or choose an offset that crosses the structure. All-zero indices do not define a plane.

## A plot is empty or reports a limit

An empty range can be valid: there may be no pairs or reflections within it. Widen it moderately. If the request exceeds the browser work limit, reduce the distance or angular range, select one pair type, or use a smaller structure. Oversized requests fail explicitly rather than returning a truncated distribution.

For X-ray form factors, **sin(θ)/λ must stay below 2 Å⁻¹**. Reduce the upper 2θ limit or increase the wavelength. Use a peak width of zero for sticks, or at least 0.01° for a Gaussian profile.

## An old structure returns when I reopen the viewer

The browser restores its saved session. To start a particular example, use its direct link. To discard the stored state, use **Export → Session → Start fresh**. Save a `.psv` first if the scene matters to you.

Private browsing, cleared browser data, or storage restrictions can prevent persistence. A project file is the portable backup.

## The model looks different in an export

PNG exports crop to the visible geometry and labels, with a margin; the result need not have the live viewport's aspect ratio. Movies use a fixed frame that fits the whole revolution. A DPI setting changes print metadata, while the resolution multiplier changes output pixel density.

Transparent scenes with deep stacks of overlapping surfaces may show a renderer limit note. Reduce the extent or hide unnecessary geometry if exact transparency ordering matters in a crowded view.

## Report a problem

[Open a GitHub issue](https://github.com/CPrescher/PhaseSmith-Viewer/issues) with the browser and device, steps to reproduce, expected result, and actual result. Include a screenshot and, where appropriate, a shareable CIF or `.psv` project. A project embeds the original CIF, so check its contents before attaching it publicly.
