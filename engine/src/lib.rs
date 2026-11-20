mod diffraction;
use phasesmith_io::{parse_cif_text, CifReadLimits};
use serde_json::{json, Value};
use std::cell::RefCell;

thread_local! {
    static INPUT: RefCell<Vec<u8>> = RefCell::default();
    static OUTPUT: RefCell<Vec<u8>> = RefCell::default();
}

#[no_mangle]
pub extern "C" fn input_buffer(len: usize) -> *mut u8 {
    INPUT.with_borrow_mut(|bytes| {
        bytes.resize(len, 0);
        bytes.as_mut_ptr()
    })
}

// Only discover headings here; all syntax and structure validation belongs to
// PhaseSmith. Quoted strings, comments and semicolon text cannot create blocks.
fn lexical_tokens(text: &str, include_quoted: bool) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut i = 0;
    let mut tokens = Vec::new();
    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i] == b'#' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i] == b';' && (i == 0 || b[i - 1] == b'\n') {
            let start = i;
            i += 1;
            while i < b.len() && !(b[i] == b';' && b[i - 1] == b'\n') {
                i += 1;
            }
            if i < b.len() {
                i += 1;
            }
            if include_quoted {
                tokens.push((start, i));
            }
            continue;
        }
        if b[i] == b'\'' || b[i] == b'"' {
            let start = i;
            let quote = b[i];
            i += 1;
            while i < b.len() {
                if b[i] == quote && (i + 1 == b.len() || b[i + 1].is_ascii_whitespace()) {
                    i += 1;
                    break;
                }
                i += 1;
            }
            if include_quoted {
                tokens.push((start, i));
            }
            continue;
        }
        let start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() {
            i += 1;
        }
        tokens.push((start, i));
    }
    tokens
}

fn bare_tokens(text: &str) -> Vec<(usize, usize)> {
    lexical_tokens(text, false)
}

fn block_names(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for (start, end) in bare_tokens(text) {
        let token = &text[start..end];
        if token
            .get(..5)
            .is_some_and(|s| s.eq_ignore_ascii_case("data_"))
        {
            names.push(if token.len() == 5 {
                format!("unnamed_{}", names.len() + 1)
            } else {
                token[5..].to_owned()
            });
        }
    }
    names
}

// PDBx uses id / label_atom_id instead of the small-molecule label tag.
// Rename only a bare tag token, once per block, keeping PhaseSmith responsible
// for loop parsing, numerical conversion and all scientific validation.
fn normalize_atom_labels(text: &str) -> (String, bool) {
    let tokens = bare_tokens(text);
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut block_start = 0;
    let mut boundaries = tokens
        .iter()
        .enumerate()
        .filter_map(|(i, &(start, end))| {
            text[start..end]
                .get(..5)
                .filter(|s| s.eq_ignore_ascii_case("data_"))
                .map(|_| i)
        })
        .skip(1)
        .collect::<Vec<_>>();
    boundaries.push(tokens.len());
    for block_end in boundaries {
        let block = &tokens[block_start..block_end];
        let has_label = block.iter().any(|&(start, end)| {
            matches!(
                text[start..end].to_ascii_lowercase().as_str(),
                "_atom_site.label" | "_atom_site_label"
            )
        });
        if !has_label {
            let candidate = ["_atom_site.id", "_atom_site.label_atom_id"]
                .iter()
                .find_map(|tag| {
                    block
                        .iter()
                        .find(|&&(start, end)| text[start..end].eq_ignore_ascii_case(tag))
                        .copied()
                });
            if let Some(span) = candidate {
                replacements.push((span.0, span.1, "_atom_site.label".into()));
            }
        }
        block_start = block_end;
    }
    let changed = !replacements.is_empty();
    for &(start, end) in &tokens {
        let alias = match text[start..end].to_ascii_lowercase().as_str() {
            "_symmetry.space_group_name_h-m" => Some("_symmetry_space_group_name_h-m"),
            "_symmetry.int_tables_number" => Some("_symmetry_int_tables_number"),
            "_symmetry.space_group_name_hall" => Some("_symmetry_space_group_name_hall"),
            _ => None,
        };
        if let Some(alias) = alias {
            replacements.push((start, end, alias.into()));
        }
    }
    // Preserve recognizable atom names alongside unique PDBx IDs. This is
    // only a label adapter over token spans; the backend still parses loops.
    let all = lexical_tokens(text, true);
    let mut i = 0;
    while i < all.len() {
        let (start, end) = all[i];
        if !text[start..end].eq_ignore_ascii_case("loop_") {
            i += 1;
            continue;
        }
        i += 1;
        let header_start = i;
        while i < all.len() && text[all[i].0..all[i].1].starts_with('_') {
            i += 1;
        }
        let headers = &all[header_start..i];
        let id_col = headers
            .iter()
            .position(|&(s, e)| text[s..e].eq_ignore_ascii_case("_atom_site.id"));
        let name_col = headers
            .iter()
            .position(|&(s, e)| text[s..e].eq_ignore_ascii_case("_atom_site.label_atom_id"));
        if let (Some(id), Some(name)) = (id_col, name_col) {
            let adapted = replacements
                .iter()
                .any(|&(s, e, _)| s == headers[id].0 && e == headers[id].1);
            if !adapted {
                continue;
            }
            while i + headers.len() <= all.len() {
                let (s, e) = all[i];
                let token = &text[s..e];
                if token.starts_with('_')
                    || token.eq_ignore_ascii_case("loop_")
                    || token.to_ascii_lowercase().starts_with("data_")
                {
                    break;
                }
                let (a, b) = all[i + id];
                let (c, d) = all[i + name];
                let clean = |s: &str| {
                    s.trim_matches(['\'', '"'])
                        .replace(['\'', '"', '\n', '\r'], "_")
                };
                replacements.push((
                    a,
                    b,
                    format!("\"{} [{}]\"", clean(&text[c..d]), clean(&text[a..b])),
                ));
                i += headers.len();
            }
        }
    }
    replacements.sort_by_key(|r| r.0);
    let mut normalized = text.to_owned();
    for (start, end, replacement) in replacements.into_iter().rev() {
        normalized.replace_range(start..end, &replacement);
    }
    (normalized, changed)
}

fn structure(text: &str, requested: Option<&str>) -> Result<Value, String> {
    let limits = CifReadLimits::default();
    if text.len() > limits.max_bytes {
        return Err("CIF exceeds the 16 MiB import limit".into());
    }
    let names = block_names(text);
    let (normalized, labels_adapted) = normalize_atom_labels(text);
    let text = normalized.as_str();
    if names.len() > limits.max_blocks {
        return Err("CIF exceeds the 100-block import limit".into());
    }
    let mut skipped = Vec::new();
    let result = if let Some(block) = requested {
        parse_cif_text(text, Some(block), false, limits).map_err(|err| err.to_string())?
    } else {
        let mut selected = None;
        for name in &names {
            match parse_cif_text(text, Some(name), false, limits) {
                Ok(result) if !result.structure.sites.is_empty() => {
                    selected = Some(result);
                    break;
                }
                Ok(_) => skipped.push(format!("{name}: no atom sites")),
                Err(error) => skipped.push(format!("{name}: {error}")),
            }
        }
        selected.ok_or_else(|| {
            if skipped.is_empty() {
                "No CIF data blocks found".into()
            } else {
                format!("No importable structural block. {}", skipped.join("; "))
            }
        })?
    };
    let structure = result.structure;
    if structure.sites.is_empty() {
        return Err("Selected block contains no atom sites".into());
    }
    let geometry = structure.cell.geometry().map_err(|err| err.to_string())?;
    let coords = structure
        .sites
        .iter()
        .map(|s| s.fractional_xyz)
        .collect::<Vec<_>>();
    // Guard expansion before allocation; this conservative bound also prevents
    // adversarial sites × operations from exhausting a browser's WASM memory.
    let operation_count = structure.space_group.operations().len();
    if coords.len().saturating_mul(operation_count) > 200_000 {
        return Err(
            "This browser viewer limits symmetry expansion to 200,000 candidate atoms to bound memory and rendering work; use a smaller structure or a desktop viewer (this is not a CIF format limit)".into(),
        );
    }
    // Published CIFs commonly round symmetry-constrained thirds to 0.3333.
    // A numerical tolerance of 1e-8 then treats equivalent special-position
    // images as separate atoms (e.g. six O instead of two in brucite).
    // Deduplication is per independent source site, so coincident mixed or
    // split sites keep their labels and occupancies. Original coordinates
    // remain unchanged; only nearly identical symmetry images are merged.
    let expanded = structure
        .space_group
        .expand_sites(&coords, 1e-4)
        .map_err(|err| err.to_string())?;
    // The CIF tensor uses reciprocal-axis lengths. Store U* in fractional
    // coordinates so both diffraction and Cartesian ellipsoids use the same
    // rotated displacement tensor for each symmetry mate.
    let reciprocal_lengths: [f64; 3] = std::array::from_fn(|i| {
        geometry
            .reciprocal_basis
            .iter()
            .map(|row| row[i].powi(2))
            .sum::<f64>()
            .sqrt()
    });
    let basis = nalgebra::Matrix3::from_fn(|i, j| geometry.direct_basis[i][j]);
    let mut invalid_displacements = std::collections::BTreeSet::new();
    let mut atom_record = |index: usize, xyz: [f64; 3], rotation: [[i32; 3]; 3]| {
        let site = &structure.sites[index];
        let mut atom = json!({"label":site.site_id, "element":site.element_symbol,
            "charge":site.charge, "frac":xyz, "occupancy":site.occupancy, "siteIndex":index});
        if let Some(u) = site.u_iso_angstrom2 {
            if u >= 0. {
                atom["uIso"] = json!(u);
            } else {
                invalid_displacements.insert(site.site_id.as_str());
            }
        }
        if let Some(adp) = &site.anisotropic_displacement {
            let [xx, yy, zz, yz, xz, xy] = adp.u_cif_angstrom2;
            let cif = nalgebra::Matrix3::new(xx, xy, xz, xy, yy, yz, xz, yz, zz);
            let transform = nalgebra::Matrix3::from_fn(|i, j| {
                f64::from(rotation[i][j]) * reciprocal_lengths[j]
            });
            let u = transform * cif * transform.transpose();
            let cartesian = basis * u * basis.transpose();
            let eigen = cartesian.symmetric_eigen();
            if eigen.eigenvalues.iter().all(|v| v.is_finite() && *v > 0.) {
                atom["uStar"] = json!([
                    u[(0, 0)],
                    u[(1, 1)],
                    u[(2, 2)],
                    u[(1, 2)],
                    u[(0, 2)],
                    u[(0, 1)]
                ]);
                let mut axes = eigen.eigenvectors;
                // A sphere is invariant under axis reversal. Keep the instance
                // right-handed for correct front-face culling.
                if axes.determinant() < 0. {
                    axes.column_mut(0).neg_mut();
                }
                let axes =
                    axes * nalgebra::Matrix3::from_diagonal(&eigen.eigenvalues.map(f64::sqrt));
                let rows: [[f64; 3]; 3] =
                    std::array::from_fn(|i| std::array::from_fn(|j| axes[(i, j)]));
                atom["displacementAxes"] = json!(rows);
            } else {
                invalid_displacements.insert(site.site_id.as_str());
            }
        }
        atom
    };
    let atoms = expanded
        .fractional_xyz
        .iter()
        .zip(expanded.source_site)
        .zip(expanded.representative_rotation)
        .map(|((xyz, index), rotation)| atom_record(index, *xyz, rotation))
        .collect::<Vec<_>>();
    let independent_sites = structure
        .sites
        .iter()
        .enumerate()
        .map(|(index, s)| atom_record(index, s.fractional_xyz, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
        .collect::<Vec<_>>();
    let symmetry_operations = structure
        .space_group
        .operations()
        .iter()
        .map(|operation| {
            json!({"rotation":operation.rotation(),
                "translation":operation.translation().map(|value| value.as_f64())})
        })
        .collect::<Vec<_>>();
    let mut warnings = result
        .diagnostics
        .iter()
        .map(|d| d.message.clone())
        .collect::<Vec<_>>();
    if !invalid_displacements.is_empty() {
        warnings.push(format!("Unusable displacement parameters for {} site(s). Using valid isotropic values where available and zero displacement otherwise.", invalid_displacements.len()));
    }
    if labels_adapted {
        warnings.push("PDBx atom IDs or atom names were used as site labels. This viewer shows crystallographic positions only; molecular assemblies are not constructed. All alternate conformers and all models are overlaid, not selected or combined.".into());
    }
    if !skipped.is_empty() {
        warnings.push(format!("Skipped earlier blocks: {}", skipped.join("; ")));
    }
    let cell = &structure.cell;
    // Fill missing identifiers only when the reference setting has exactly the
    // operations used to expand this block. Keep the reported CIF tags intact.
    let meta = &structure.metadata;
    let matched_group = meta
        .get("space_group_hall")
        .and_then(|value| phasesmith_io::space_group_by_hall_symbol(value).ok())
        .filter(|info| info.space_group == structure.space_group)
        .or_else(|| {
            meta.get("space_group_hm")
                .and_then(|value| phasesmith_io::space_group_by_symbol(value).ok())
                .filter(|info| info.space_group == structure.space_group)
        })
        .or_else(|| {
            meta.get("space_group_number")
                .and_then(|value| value.parse().ok())
                .and_then(|number| phasesmith_io::space_group_by_number(number).ok())
                .filter(|info| info.space_group == structure.space_group)
        });
    Ok(
        json!({"name":structure.name,"block":result.selected_block,"blocks":result.available_blocks,
        "cellParameters":[cell.a_angstrom,cell.b_angstrom,cell.c_angstrom,cell.alpha_deg,cell.beta_deg,cell.gamma_deg],
        "cellUncertainties":structure.cell_standard_uncertainties,
        "crystalSystem":format!("{:?}", structure.space_group.crystal_system()),
        "matchedGroup":matched_group.map(|info| json!({"number":info.number,"symbol":info.hm_symbol})),
        "basis":geometry.direct_basis,"volume":geometry.volume_angstrom3,"atoms":atoms,
        "independentSites":independent_sites,"symmetryOperations":symmetry_operations,
        "metadata":structure.metadata,"warnings":warnings}),
    )
}

fn import_request(input: &str) -> Value {
    let request = match serde_json::from_str::<Value>(input) {
        Ok(request) => request,
        Err(error) => return json!({"error":format!("Invalid import request: {error}")}),
    };
    let Some(text) = request.get("text").and_then(Value::as_str) else {
        return json!({"error":"Import request requires CIF text"});
    };
    let block = request
        .get("block")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    structure(text, block).unwrap_or_else(|error| json!({"error":error,"blocks":block_names(text)}))
}

#[no_mangle]
pub extern "C" fn import_cif() -> usize {
    let value = INPUT.with_borrow(|bytes| {
        std::str::from_utf8(bytes)
            .map(import_request)
            .unwrap_or_else(|error| json!({"error":error.to_string()}))
    });
    OUTPUT.with_borrow_mut(|bytes| {
        *bytes = value.to_string().into_bytes();
        bytes.len()
    })
}

#[no_mangle]
pub extern "C" fn xray_reflections() -> usize {
    let value = INPUT.with_borrow(|bytes| {
        diffraction::calculate(bytes).unwrap_or_else(|err| json!({"error":err.to_string()}))
    });
    OUTPUT.with_borrow_mut(|bytes| {
        *bytes = value.to_string().into_bytes();
        bytes.len()
    })
}

#[no_mangle]
pub extern "C" fn output_buffer() -> *const u8 {
    OUTPUT.with_borrow(|bytes| bytes.as_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;
    const CELL: &str = "_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_name_H-M_alt 'P 1'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1 Si 0.25(2) 0 0\n";
    #[test]
    fn skips_metadata_and_selects_blocks() {
        let text = format!("data_metadata\n_a 'data_false'\n_b\n;\ndata_false2\n;\ndata_first\n{CELL}data_second\n{CELL}");
        assert_eq!(block_names(&text), vec!["metadata", "first", "second"]);
        let result = structure(&text, None).unwrap();
        assert_eq!(result["block"], "first");
        assert_eq!(result["blocks"].as_array().unwrap().len(), 3);
        assert_eq!(structure(&text, Some("second")).unwrap()["block"], "second");
        assert!(structure(&text, Some("metadata")).is_err());
        assert!(structure(&text, Some("absent")).is_err());
    }
    #[test]
    fn exposes_type_symbol_charge_on_independent_sites() {
        let cif = format!("data_test\n{}", CELL.replace("Si1 Si ", "Si1 Si4+ "));
        let data = structure(&cif, None).unwrap();
        assert_eq!(data["independentSites"][0]["charge"], 4);
    }
    #[test]
    fn dotted_cartesian_single_crystal() {
        let text = format!(
            "data_cart\n{}",
            CELL.replace("_cell_", "_cell.")
                .replace("_atom_site_", "_atom_site.")
                .replace("fract_", "Cartn_")
                .replace("0.25(2)", "1.0(2)")
        );
        let value = structure(&text, None).unwrap();
        assert_eq!(value["atoms"][0]["frac"][0], 0.25);
        assert_eq!(value["atoms"][0]["element"], "Si");
    }
    #[test]
    fn expands_single_crystal_symmetry_and_preserves_occupancy() {
        let text = format!(
            "data_inversion\n{}",
            CELL.replace("'P 1'", "'P -1'")
                .replace(
                    "_atom_site_fract_z\n",
                    "_atom_site_fract_z\n_atom_site_occupancy\n"
                )
                .replace("0.25(2) 0 0", "0.25(2) 0 0 0.5")
        );
        let value = structure(&text, None).unwrap();
        let atoms = value["atoms"].as_array().unwrap();
        assert_eq!(atoms.len(), 2);
        assert_eq!(value["independentSites"].as_array().unwrap().len(), 1);
        assert_eq!(value["independentSites"][0]["frac"][0], 0.25);
        assert_eq!(value["independentSites"][0]["occupancy"], 0.5);
        assert_eq!(value["symmetryOperations"].as_array().unwrap().len(), 2);
        assert_eq!(atoms[0]["siteIndex"], 0);
        assert_eq!(atoms[1]["siteIndex"], 0);
        let operations = value["symmetryOperations"].as_array().unwrap();
        assert!(operations
            .iter()
            .any(|op| op["rotation"] == json!([[-1, 0, 0], [0, -1, 0], [0, 0, -1]])));
        assert_eq!(atoms[0]["occupancy"], 0.5);
        assert_eq!(atoms[1]["occupancy"], 0.5);
        assert_eq!(atoms[0]["frac"][0], 0.25);
        assert_eq!(atoms[1]["frac"][0], 0.75);
    }

    #[test]
    fn rounded_special_positions_keep_the_correct_multiplicity() {
        for (cif, expected) in [
            (include_str!("../../public/structures/brucite.cif"), 5),
            (include_str!("../../public/structures/quartz.cif"), 9),
            (include_str!("../../public/structures/wurtzite.cif"), 4),
            (include_str!("../../public/structures/fluorapatite.cif"), 42),
            (include_str!("../../public/structures/graphite.cif"), 4),
        ] {
            let value = structure(cif, None).unwrap();
            assert_eq!(value["atoms"].as_array().unwrap().len(), expected);
        }
        let text = format!(
            "data_mixed\n{}",
            CELL.replace("'P 1'", "'P -1'")
                .replace("Si1 Si 0.25(2) 0 0", "Si1 Si 0 0 0\nAl1 Al 0.00001 0 0")
        );
        let value = structure(&text, None).unwrap();
        let atoms = value["atoms"].as_array().unwrap();
        assert_eq!(atoms.len(), 2);
        assert_ne!(atoms[0]["siteIndex"], atoms[1]["siteIndex"]);
        assert_eq!(value["independentSites"][1]["frac"][0], 0.00001);
    }

    #[test]
    fn pdbx_real_crambin_and_unsupported_warnings() {
        // Public RCSB PDB archive entry, downloaded 2026-11-16.
        let value = structure(include_str!("../tests/fixtures/1CRN.cif"), None).unwrap();
        assert_eq!(value["block"], "1CRN");
        assert_eq!(value["atoms"][0]["label"], "N [1]");
        assert_eq!(value["metadata"]["space_group_number"], "4");
        assert_eq!(value["atoms"].as_array().unwrap().len(), 654);
        assert!(value["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s.as_str().unwrap().contains("macromolecular")));
        let text = format!(
            "data_features\n_atom_site_moment_label Si1\n_cell_wave_vector_seq_id 1\n{CELL}"
        );
        let value = structure(&text, None).unwrap();
        let warnings = value["warnings"].to_string();
        assert!(warnings.contains("magnetic CIF features are not supported"));
        assert!(warnings.contains("modulated CIF features are not supported"));
    }

    #[test]
    fn pdbx_labels_and_model_overlay_are_explicit() {
        let text = format!(
            "data_models\n{}",
            CELL.replace(
                "_atom_site_label",
                "_atom_site.id\n_atom_site.label_atom_id\n_atom_site.pdbx_PDB_model_num"
            )
            .replace(
                "Si1 Si 0.25(2) 0 0",
                "1 SiA 1 Si 0.25(2) 0 0\n2 SiA 2 Si 0.5 0 0"
            )
        );
        let value = structure(&text, None).unwrap();
        assert_eq!(value["atoms"].as_array().unwrap().len(), 2);
        assert_eq!(value["atoms"][0]["label"], "SiA [1]");
        assert_eq!(value["atoms"][1]["label"], "SiA [2]");
        assert!(value["warnings"]
            .to_string()
            .contains("all models are overlaid"));
        assert!(
            normalize_atom_labels("data_x\n_a '_atom_site.id'\n_b\n;\n_atom_site.id\n;\n")
                .0
                .contains("'_atom_site.id'")
        );
    }

    #[test]
    fn malformed_is_reported() {
        let result = import_request(&json!({"text":"data_bad\nloop_\n_x\n_y\n1"}).to_string());
        assert!(result["error"].is_string());
        assert_eq!(result["blocks"], json!(["bad"]));
    }
}
