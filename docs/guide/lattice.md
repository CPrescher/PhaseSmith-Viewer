# Planes, directions and symmetry

Choose **Planes**, **Directions**, or **Symmetry** in the launcher. When the entries don’t all fit, open **Overlays** to find them. On a phone, open **Tools** first. The screenshot shows the controls after adding a plane.

<ViewerFigure name="lattice" alt="Lattice window with an added Miller-index plane, offset, parallel planes and appearance controls." />

## Add a plane

Choose **Planes** from the tools. **＋ Plane** adds a Miller-index plane with integer indices and an editable fractional offset m in hx + ky + lz = m. A new plane starts at a whole-number m: the integer closest to the center of the displayed extent among those whose plane crosses its interior (ties go toward 0), otherwise the nearest integer on its boundary. In one cell, (100) starts at m = 1, (1̄00) at −1 and (11̄0) at 0. A very narrow fractional extent may contain no plane with an integer m; the plane's readout then says so, and you can type a fractional m, widen the extent or raise Size. While m has not been typed in, it follows changes to the indices. Once you enter m yourself it stays fixed, also when the indices or the extent change.

## Parallel planes and appearance

**Parallel planes** draws planes with the same (hkl) at m + n for integer n intersecting the displayed extent. Changing m moves all parallel planes together.

**Size** (100–200%) draws a plane's faces beyond the plotted range, enlarging the clipping box about its center. The plane equation, m, the spacing and the parallel-plane offsets stay the same.

**Opacity** (0–100%, default 28%) sets how strongly each plane entry's faces are drawn. At 0% only the outline and the label remain. At 100% the faces are opaque and hide what lies behind them. Each plane reports its interplanar spacing in ångströms.

## Plane labels

The shared **Labels** toggle annotates added planes and directions. **Show m in labels** adds the offset to plane labels ("(100) · m=0.5"); turned off, labels show only the indices. It changes label text only, and in exports too.

**Position** places plane labels **Outside** a projected edge of the drawn plane with a short leader line in the plane's color (default), against an **Edge** without a leader, or at the **Center** of the plane. Outside and Edge labels avoid the view controls, the legend, other labels and, where possible, the structure itself. In tight views a label falls back to sitting on the edge, and additional parallel planes are left unlabeled rather than placed over the middle of the structure. Exported images and movies show the same label positions and leaders. Direction labels stay beside the arrow tip.

## Direct-lattice arrows

In **Directions**, **＋ Arrow** adds a direct-lattice [uvw] vector with a fractional origin and a length multiplier.

## Symmetry elements and operations

In **Symmetry**, **Elements** shows symmetry axes, planes and inversion centers derived from the imported CIF operations. Use the type filters to examine rotation, screw, rotoinversion, inversion, mirror or glide elements. Click **Ops** beside Elements to open the operations list and inspect their fractional-coordinate equations. Generated overlays are clipped to the plotting extent. A status note identifies any generation limit.

**Choose axis types** selects exact symbols independently, such as 2, 3, 4, 2₁, 3₁, 3₂ or 3̅. Counts include coincident lower-order rotations: a fourfold line also remains visible when only its twofold rotation is selected. **Axes only** hides planes and standalone inversion centers; **Clear axis types** followed by selecting **3** isolates pure threefold axes. Category switches still apply.

Axis selections are saved with the session. All elements use the actual space-group locations from the CIF.

For the distinction between a direct-lattice direction and a plane normal, see [Scientific conventions](./science.md#directions-and-plane-normals). The [plane tutorial](./tutorials.md#compare-111-and-222-planes) compares first and second harmonics.
