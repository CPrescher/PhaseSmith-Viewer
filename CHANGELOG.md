# Changelog

## Unreleased

- In the two-column diffraction detector, the Ewald sphere and detector spots share a drawing row that scales with the panel width.
- Touch numeric keypads use a three-column digit grid with a one-cell Backspace and a three-row Enter key. The keypad follows its field when a panel moves and stays open during repeated Backspace taps.

## [v1.0.1](https://github.com/CPrescher/PhaseSmith-Viewer/releases/tag/v1.0.1) · 2026-11-22

### Changed

- Distance dashes, angle legs, and angle arcs are now 2.5 pixels wide on screen and keep that width as you zoom.
- A dashed gold ring highlights each selected atom in both themes.

### Fixed

- Aragonite now shows the triangular O–O–O face around carbon when C–O coordination is enabled, even though the carbon atom sits slightly outside the oxygen plane.
- On iPad and other touch devices, the **Overlays** and **Analysis** menus fit their contents, and opening the structure library leaves the keyboard closed until you tap the search field.
- Touch editors keep the active field visible above the on-screen keyboard. Plane (hkl) and direction [uvw] keypads have a wide Space key beside the first row of digits. The direction keypad shows one decimal separator for the browser locale. Typed and pasted directions accept either decimal commas or points. Devices without a floating keypad use the native text keyboard for these fields.
- On high-density touchscreens, the crystal view uses a lower resolution during rotation, panning, and pinching. Full detail returns when motion settles.
- The Reflection Explorer stops requesting frames when idle. During wave animation, only the curves and their markers move.

## [v1.0.0](https://github.com/CPrescher/PhaseSmith-Viewer/releases/tag/v1.0.0)

- Open a CIF or choose a structure from the built-in library. Measure atomic distances and angles, inspect coordination polyhedra, and display lattice planes, directions, and symmetry elements.
- Explore pair-distance distributions, simulate powder diffraction, and inspect single-crystal reflections on the Ewald sphere and detector.
- Save a scene as a portable `.psv` project, export an image or rotation movie, and use the viewer and guide offline with the macOS or Windows app.
- After a pan, rotating the crystal keeps its center at the chosen screen position.
- Switching settings panels keeps the Detector and other analysis windows open. The Detector uses the sample name from the viewer header for exports and omits the duplicate label in the panel.
