# Saving and exporting

Choose **Export**, near the bottom of the right-hand tool rail. On a phone, choose **Tools → Export**. The window opens at the image controls; scroll down inside it to reach movies, **Project file**, and **Session**.

<ViewerFigure name="export" alt="Top of the Export window with image resolution, transparency and Save PNG controls." />

## Portable project files

Scroll inside Export until **Project file** is visible.

<ViewerFigure name="project" alt="Export window scrolled to Project file, showing the Save project and Open project buttons." />

Choose **Export → Project file → Save project** to download a `.psv` file. It embeds the complete original CIF (including all data blocks) and the current viewer settings: extent, pairs, styles, atom visibility, planes, directions, symmetry, labels, camera, measurement picks, tool windows, export preferences, and light/dark theme. Reopen it with **Open file** in the header or **Export → Project file → Open project**. The file works in a fresh browser or on another computer without the original CIF. Saving downloads a new file; it does not overwrite an earlier download automatically. Undo/redo history starts fresh when a project is opened.

In **X-ray** or **Detector**, choose **Save exercise** to save a project at the current step. On reopening, the reflection exercise restores its indices, wavelength, phase-sum step, selection, and view. The detector restores its geometry (including an imported PONI), orientation, scan angle, and selected reflection. A measured powder trace is embedded with the project.

The format is readable JSON with a format identifier and version, independent of the local browser session format. Unsupported versions and unreadable structures report an error and keep the current scene. Project contents stay local; nothing is uploaded.

## Browser autosave

The viewer saves its state on this device and restores it when you open the same page again, also after restarting the browser. This covers the loaded CIF and data block, the plotting extent, pairs and their cutoffs, colors and opacities, element and individual styles, atom visibility, size and labels, the asymmetric-unit view, planes, directions, symmetry and label settings, the camera, the turn angle, the measurement with its picked atoms in order, and the open tool windows with their places. Nothing is uploaded. Opening a different example address starts that example instead. **Export → Session** shows the save status; **Start fresh** discards the saved session and reloads this page's structure.

## Images, movies and themes

Choose **Export** from the tools to save a PNG at 1×, 2× or 4× resolution, with an optional transparent background. Exports crop to the drawn structure, including visible cell edges, planes, arrows and labels, with a small margin. The lattice-axis compass sits beside the structure at the lower right; selected-atom or measurement details have their own space above it. The DPI field writes print-resolution metadata and reports the approximate physical print size. Pixel dimensions follow the cropped frame and resolution setting.

The movie control records a full turntable revolution at the selected duration and frame rate. Its fixed frame fits the structure throughout the entire turn, including geometry that rotates beyond the live viewport, so the crop stays steady. The browser selects a supported MP4 or WebM encoder. Visible planes, arrows, symmetry elements, labels, measurements and the lattice-axis compass are included in exports. Cancel stops a movie recording and restores the view.

The header theme button switches between light and dark. An explicit choice is remembered. The initial theme follows the device preference.

The **Full screen** button beside the theme button expands the entire viewer, keeping its controls and structure library available. Tap it again to exit, or use the browser’s exit control (Escape on desktop). It appears only when the browser supports fullscreen; older iPad Safari’s prefixed API is supported too. The crystal resizes automatically when entering, leaving, or rotating the tablet. Fullscreen starts only from a tap or click and is not restored with saved sessions or projects.
