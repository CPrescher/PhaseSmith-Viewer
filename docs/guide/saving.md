# Saving and exporting

Choose **Export**, near the bottom of the right-hand tool rail. On a phone, choose **Tools → Export**. The window contains PNG and movie controls. Projects and local-session controls live in the **⋯** menu beside **Open file** in the header.

<ViewerFigure name="export" alt="Top of the Export window with image resolution, transparency and Save PNG controls." />

## Portable project files

Open the **⋯** menu beside **Open file** in the upper-right header.

<ViewerFigure name="project" alt="Header project menu showing Save project, Open project and local-device controls." />

Choose **⋯ → Save project** to download a `.psv` file. It embeds the complete original CIF (including all data blocks) and the current viewer settings: extent, pairs, styles, atom visibility, planes, directions, symmetry, labels, camera, measurement picks, tool windows, export preferences, and light/dark theme. Reopen it with **Open file** in the header or **⋯ → Open project**. The file works in a fresh browser or on another computer without the original CIF. Saving downloads a new file; it does not overwrite an earlier download automatically. Undo/redo history starts fresh when a project is opened.

In **Reflection** or **Detector**, choose **Save exercise** to save a project at the current step. On reopening, the reflection exercise restores its indices, wavelength, phase-sum step, selection, and view. The detector restores its geometry (including an imported PONI), orientation, scan angle, and selected reflection. A measured powder trace is embedded with the project.

The format is readable JSON with a format identifier and version, independent of the local browser session format. Unsupported versions and unreadable structures report an error and keep the current scene. Project contents stay local; nothing is uploaded.

## Installed desktop app

Double-click a CIF or a `.psv` project in Finder or Explorer to open it in the viewer. If another app handles the file, choose **Open With → PhaseSmith Viewer**. The bundled structure library, calculations and Help work offline. Links to external reference databases need a connection.

**Save project**, image and movie exports, CSV exports and library CIF downloads open the system Save dialog. Choose the folder and filename there. Canceling leaves the destination untouched.

Launching the app by itself restores the last structure, view, and up to 100 undo/redo steps. If you quit just after undoing an edit, **Redo** is available when you return. Opening another structure or project starts its own editing session. Use a project file to move your scene between the app and browser.

## Browser autosave

The viewer saves its state on this device and restores it when you open the same page again, also after restarting the browser. This covers the loaded CIF and data block, the plotting extent, pairs and their cutoffs, colors and opacities, element and individual styles, atom visibility, size and labels, the asymmetric-unit view, planes, directions, symmetry and label settings, the camera, the turn angle, the measurement with its picked atoms in order, and the open tool windows with their places. Nothing is uploaded. Opening a different example address starts that example instead. **⋯ → This device** shows the save status; **Start fresh** asks for confirmation before discarding the saved session and reloads this page's structure.

## Images, movies and themes

Choose **Export** from the tools to save a PNG at 1×, 2× or 4× resolution, with an optional transparent background. Exports crop to the drawn structure, including visible cell edges, planes, arrows and labels, with a small margin. The lattice-axis compass sits beside the structure at the lower right; selected-atom or measurement details have their own space above it. The DPI field writes print-resolution metadata and reports the approximate physical print size. Pixel dimensions follow the cropped frame and resolution setting. The live view smooths edges with antialiasing and retains native display detail within a rendering budget. Large interactive views may use fewer pixels to keep rotation responsive; this does not limit exported resolution.

The movie control records a full turntable revolution, aiming for the selected duration and frame rate. Its fixed frame fits the structure throughout the entire turn, including geometry that rotates beyond the live viewport, so the crop stays steady. If rendering cannot keep up, the movie will play more slowly: the viewer warns during recording and reports the finished file's duration when the browser provides it. Lower the export size or frame rate to improve timing. The browser selects a supported MP4 or WebM encoder. Visible planes, arrows, symmetry elements, labels, measurements and the lattice-axis compass are included in exports. Cancel stops a movie recording and restores the view.

The header theme button switches between light and dark. An explicit choice is remembered. The initial theme follows the device preference.

The **Full screen** button beside the theme button expands the entire viewer, keeping its controls and structure library available. Tap it again to exit, or use the browser’s exit control (Escape on desktop). It appears only when the browser supports fullscreen; older iPad Safari’s prefixed API is supported too. The crystal resizes automatically when entering, leaving, or rotating the tablet. Fullscreen starts only from a tap or click and is not restored with saved sessions or projects.
