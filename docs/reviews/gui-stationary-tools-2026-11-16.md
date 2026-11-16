# Stationary structure and toggleable settings

This revision follows the user's corrections to the original floating-window design:

- Settings overlay the structure. Menu opening, switching, closing, moving and resizing preserve the camera and projected atom positions; explicit view controls remain available.
- One settings window opens from the right-hand bar. Selecting its item again closes it. Pin and Minimize are removed, including their state transitions. Older sessions restore only their last active tool and preserve scientific settings.
- The info readout and its Info/Distance/Angle modes share an aligned right edge.
- Icon visibility toggles for Atoms and Polyhedra stay at the lower left. The phone Tools launcher is at the lower right and opens its list upward.
- Polyhedron visibility affects faces and outlines without changing pair enablement, cutoff, opacity, color, coordination or physical volumes. Planes and arrows remain independent.
- The former “Polyhedra only” filter is named “Hide atoms outside polyhedra” and explains that it keeps centers and vertices of enabled polyhedra.

## Checks

The native workflow test covers 1440×900, 1920×1080, 1024×768, 768×1024, 390×844, 375×667, 844×390 and 960×1050, in light and dark themes. It compares both camera values and projected atom coordinates before/after menu actions; matching camera values alone would miss the previous off-axis projection shift. It also checks toggle/replace behavior, palette bounds, info alignment, bottom control placement, visibility independence, unchanged physical data and session persistence. Sheets reserve measured space above the footer, compass and Tools button; the narrow phone footer has two rows so all three default element chips remain visible.

Parameter drags are checked frame by frame (under 0.6 px control movement). Further assertions cover the unchanged scene during desktop move/resize, per-tool scroll and values, picking without changing the active editor, Tune/All settings scroll restoration, 44 px phone window controls, Details above the sheet, active-tool retention across orientation changes, invalid (hkl) row stability, and a usable editor body height. Native slider thumb sizes differ between engines; the test verifies the exact resulting opacity in the renderer.

Scientific and navigation regression assertions are retained. Tests now explicitly open an editor rather than depending on an initially open Pairs panel. Measurement fixtures are positioned with native pan input where a sheet would cover them; the application deliberately does not pan automatically. Opening the Turn pad checks that the scene stays stationary rather than requiring every atom to remain outside the overlay. Scrollable editors are tested through reachable controls.

## Independent review

Claude Opus independently reviewed the implementation in the actual Claude CLI on November 16–17. Its final verdict was **ready to publish**, for the final 00:11 build. The review used native Chrome and WebKit inputs, screenshots and rendered-pixel checks. Initial findings about footer overlap, menu scrolling, hidden element chips and missing regression guards were fixed and rechecked. A phone readout layering defect was also fixed and guarded with an actual hit test.

The review additionally found a pre-existing landscape Turn overflow. The original pad and presets now fit beside one another in short landscape views, with all 18 controls reachable. Desktop/tablet popovers retain their original layout; the portrait dock reserves measured footer space. Closing an editor in landscape and rotating to portrait refreshes that reserve, and the native workflow test covers this sequence. The final Chrome/WebKit suite ran on the same 00:11 build, including the rotation fix.

Measured checks include less than 0.01 px projected-atom displacement from menu actions, less than 0.6 px control movement during parameter drags, 8 px sheet-to-footer clearance, and 44 px targets on phone window buttons and landscape Turn controls. The six existing portrait Turn presets remain about 42 px wide at 375 px; they remain reachable. Mouse-only desktop controls retain the original compact 36 px size.

All 62 JavaScript tests passed. Browser regressions retain known distances, angles, coordination and physical forsterite volumes (Mg1 11.787, Mg2 12.392 and Si 2.208 Å³). Production-path assets, the WASM importer, the library and saved pair defaults passed. CI also runs the expanded Turn checks with portable Chromium and software WebGL.

These are browser-emulation checks in native Chrome and Playwright WebKit. Physical phones/tablets, real software keyboards and a user study remain outside the available validation. The 9.5/10 usability request is a quality target, not a measured score.
