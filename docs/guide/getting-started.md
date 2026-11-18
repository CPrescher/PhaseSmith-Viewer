# Your first structure

This short walkthrough uses forsterite, Mg₂SiO₄, to introduce the main controls. The pictures below show the actual buttons and panels. For a full desktop and phone overview, see [Find the controls](./interface.md).

## 1. Open the worked example

[Open forsterite in the viewer](https://cprescher.github.io/PhaseSmith-Viewer/?example=forsterite). This address loads the bundled structure with Si–O and Mg–O pairs already configured. It starts the example even if the browser has a different saved session.

The **Library** and **Open file** buttons are in the **header at the upper right**, above the crystal. Library browses the bundled structures; Open file loads your own CIF or a `.psv` project. On a narrow screen, Open file is shortened to **Open**.

<ViewerFigure name="file-controls" alt="The Library and Open file buttons in the upper-right header, with labels pointing to each button." />

## 2. Look around

Drag with the left mouse button or one finger to rotate. Use the wheel or pinch to zoom. Right-drag or drag with two fingers to pan.

Choose **a**, **b**, or **c** near the upper left to look along a lattice axis. **Turn** gives exact rotation steps. On a computer, double right-click to fit the displayed structure.

<ViewerFigure name="view-controls" alt="The upper-left view toolbar showing a, b, c, custom uvw direction, Turn and Reset." caption="The view toolbar sits inside the crystal area at the upper left, below the header." />

## 3. Explore the coordination

Find **Pairs**, the top button in the **vertical tool rail on the right edge of the crystal**. Click it to open the Pairs window shown below. On a phone, tap the round **Tools** button at the lower right, then choose **Pairs** from the menu.

<ViewerFigure name="pairs" alt="The Pairs window with Si–O and Mg–O cutoff fields, Bonds and Polyhedra toggles, and opacity sliders." caption="Each pair has its own cutoff, Bonds and Polyhedra switches, and opacity slider. Scroll inside the window if a row is below its edge." />

The forsterite example uses **Si–O = 1.80 Å** and **Mg–O = 2.30 Å**. These cutoffs include the first coordination shells. Toggle one pair's **Polyhedra** off to examine the other, or adjust **Opacity** to see atoms through the faces.

The **Atoms** and **Polyhedra** controls at the lower left hide either representation independently. Hiding spheres does not remove the atoms from the geometry calculations.

## 4. Measure the structure

The measurement buttons are **inside the crystal view at the upper right, directly below the header and just left of the tool rail**. They are small icon buttons, separate from the Pairs window.

<ViewerFigure name="measurements" alt="The measurement toolbar, with leader lines labeling the actual Info i, Distance double arrow, Angle angle symbol, and Clear cross buttons." caption="Desktop measurement toolbar. On phones, the same buttons form a vertical column at the upper right of the crystal; they are not inside the Tools menu." />

1. Click **Distance**, the **↔** button, then click two visible atoms. Read their separation in the card below the buttons.
2. Click **Angle**, the **∠** button immediately after Distance, then click three atoms in A–B–C order. **B, the second atom, is the vertex.**
3. Click **Info**, the **i** button, to return to inspecting one atom.

The measurement uses the particular displayed copies you select. Rotate the crystal first if the intended atom is hidden behind another.

**Clear**, the **×** button at the end of the toolbar, removes the selection; it is gray when nothing is selected. On phones, **Details** beneath the buttons opens the full readout. [See the phone control map](./interface.md#on-a-phone).

## 5. Save your work

Find **Export** near the bottom of the right-hand tool rail (or in the phone's **Tools** menu). Open it, then **scroll inside the Export window** to the **Project file** section. Click **Save project**.

<ViewerFigure name="project" alt="The scrolled Export window showing the Project file section and its Save project and Open project buttons." caption="Project file is below the image and movie export controls. Scroll the window, not the crystal view." />

 Keep the downloaded `.psv` file: it contains the original CIF and the viewer settings. Open it later with **Open file**, including on another device.

For an image, use the PNG controls in **Export**. A picture preserves the appearance; a project preserves the interactive scene.

## Where to go next

- [Worked examples](./tutorials.md) explain what to look for in the structures.
- [Navigation and display](./navigation.md) covers touch controls, plotting extent, and appearance.
- [Scientific conventions](./science.md) explains periodic copies, Miller indices, and calculated quantities.
