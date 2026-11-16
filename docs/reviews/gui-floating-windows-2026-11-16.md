> Historical review of the first floating-window version. The stationary, single-window revision below supersedes its automatic framing, Pin and Minimize behavior. See [the revised workflow review](gui-stationary-tools-2026-11-16.md).

# Floating tools: validation and review

The GUI uses small labeled launchers at the right edge on desktop/tablet and a round Tools launcher with labeled choices on phones. Choosing a tool reuses a stable palette; Keep open is explicit and limited to one extra window. Narrow viewports park the extra window without discarding its state or saved desktop position. Phone Tune keeps the chosen pair, plane or arrow visible beside the structure. Existing direction, Turn, measurement, rotation, pan and zoom controls remain in the canvas.

## Measured checks

- Native Chrome and Playwright WebKit: 1440×900, 1920×1080, 1024×768, 768×1024, 390×844, 375×667 and 844×390. Workflow checks include both light and dark themes.
- Tool switching and exact cutoff editing: **0 CSS px** change in palette outline, active field position and atom positions in the independent seven-size/two-browser audit.
- Original right-drag pan and cursor-anchored wheel zoom: maximum observed anchor error **0.17 CSS px** (acceptance <0.5 px).
- Committed cutoff to updated rendered frame: approximately **22–25 ms** for the forsterite fixture on the development computer. This is a small-fixture measurement, not a guarantee for arbitrary structures or hardware.
- Atom coordinates, radii, colors, coordination, physical polyhedron volumes, plotting ranges and a/b/c view directions exactly match the original two-structure baseline (forsterite and wollastonite).
- Exporting the same manual view with the editor in two different places produces identical PNG bytes, including lattice labels. PNG/movie decode, metadata, cancellation and live-view restoration are checked separately.
- Keep open now has a projected-size retention test (at least 80% in the tested desktop/tablet fixtures). Smaller viewports must disable it when two palettes would cover the structure. Existing kept windows park and restore on resize.
- Phone checks cover Tune immediately after load, a desktop-kept tool in Tune, exact input, updated hkl captions, 16 px editable field text, reachable Details/Hide, atom-to-atom inspection, Escape/outside dismissal, focus return and state across orientation.

The 28 other browser regression scripts passed after integration, in addition to the expanded window workflow and the desktop/phone library test. JavaScript geometry/state tests and the GitHub Pages build/path checks also pass. CI runs the importer tests and rebuild, JavaScript suite, hosted-path examples, library, pair defaults, stable layout and floating-window workflow before deployment.

## Independent Claude Opus review

The actual Claude Opus CLI reviewed the implementation in a fresh session, then independently rechecked corrections. It compared the prior main build, inspected the code/test changes and used native Chrome and Playwright WebKit.

The first review blocked publication because opening a second tool at 1024×768 reduced the structure to about 35% of its original size. Choosing a balanced clear area corrected that to about 93%. The follow-up found that a 960×1050 split-screen desktop could center the structure under both windows. Keep open now checks usable scene space, and resizing an existing two-window session into insufficient space parks the other tool. The review also prompted continuous Details inspection and keyboard navigation for the phone Tools list.

Final Opus verdict: **ready to publish, within the tested limits**. Independent Chrome/WebKit sweeps confirmed all formerly failing narrow sizes, 93% size retention at 1024×768, full retention at 1440×900, exact saved-position restoration on widening, and native dragging on spacious desktops. A final recommended guard disables dragging/resizing/double-click reset while parked; its browser regression preserves the saved desktop rectangles.

## Scope of the evidence

The requested 9.5/10 usability is a design target. Automated checks and expert review do not establish a measured user-experience score. No physical phone/tablet, real iOS/Android software keyboard or user study was available. Touch input was emulated; Playwright WebKit is not a Safari-device test.

Fixed palette height intentionally preserves bounds even when a tool has little content. Tune currently covers pairs, planes and arrows. Escape can close a focused tool window while retaining its values and returning focus to the launcher. The original short-landscape element legend uses horizontal scrolling.
