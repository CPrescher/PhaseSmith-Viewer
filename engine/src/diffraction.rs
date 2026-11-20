use phasesmith_crystallography::{
    calculate_p1_values, IntegratedIntensityCorrectionModel, P1BatchView, PreparedXrayScattering,
    UnitCell,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Atom {
    frac: [f64; 3],
    element: String,
    occupancy: f64,
}

#[derive(Deserialize)]
struct Reflections {
    cell: [f64; 6],
    atoms: Vec<Atom>,
    hkl: Vec<[i32; 3]>,
    detail: bool,
    powder_wavelength: Option<f64>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Request {
    Reflections(Reflections),
    Factor { element: String, s: f64 },
}

fn species(element: &str) -> &str {
    if element == "D" {
        "H"
    } else {
        element
    }
}

pub fn calculate(input: &[u8]) -> Result<Value, Box<dyn std::error::Error>> {
    let request = serde_json::from_slice::<Request>(input)?;
    let request = match request {
        Request::Reflections(batch) => batch,
        Request::Factor { element, s } => {
            let scattering = PreparedXrayScattering::new([species(&element)])?;
            return Ok(json!(scattering.evaluate(&[s])?.real[0]));
        }
    };
    let [a_angstrom, b_angstrom, c_angstrom, alpha_deg, beta_deg, gamma_deg] = request.cell;
    let cell = UnitCell {
        a_angstrom,
        b_angstrom,
        c_angstrom,
        alpha_deg,
        beta_deg,
        gamma_deg,
    };
    let geometry = cell.geometry()?;
    let count = request.atoms.len();
    if count == 0 || (request.detail && request.hkl.len() != 1) {
        return Err("Expected occupied atoms and one reflection for a detailed result".into());
    }
    // CIF import has already expanded the sites, including special positions.
    let xyz: Vec<_> = request.atoms.iter().map(|a| a.frac).collect();
    let occupancy: Vec<_> = request.atoms.iter().map(|a| a.occupancy).collect();
    let u_iso = vec![0.; count];
    let scattering =
        PreparedXrayScattering::new(request.atoms.iter().map(|a| species(&a.element)))?;
    let mut strengths = Vec::with_capacity(request.hkl.len());
    // Bound reflection × site arrays for large unit cells.
    for hkls in request.hkl.chunks((131_072 / count).max(1)) {
        let q2: Vec<_> = hkls.iter().map(|h| geometry.q_squared(*h)).collect();
        let s: Vec<_> = q2.iter().map(|q| q.sqrt() / 2.).collect();
        let factors = scattering.evaluate(&s)?;
        let values = calculate_p1_values(
            cell,
            P1BatchView {
                hkl: hkls,
                fractional_xyz: &xyz,
                occupancy: &occupancy,
                u_iso_angstrom2: &u_iso,
                scattering_real: &factors.real,
                scattering_imag: &factors.imag,
                scale: 1.,
            },
        )?;
        let correction = request
            .powder_wavelength
            .map(|wavelength_angstrom| {
                IntegratedIntensityCorrectionModel::BraggBrentanoUnpolarizedLp {
                    wavelength_angstrom,
                }
                .evaluate(&q2)
            })
            .transpose()?;
        for (i, f) in factors.real.chunks_exact(count).enumerate() {
            let scale: f64 = f
                .iter()
                .zip(&occupancy)
                .map(|(f, occ)| (f * occ).abs())
                .sum();
            let f2 = if values.intensity[i] <= scale * scale * 1e-12 {
                0.
            } else {
                values.intensity[i]
            };
            if request.detail {
                return Ok(
                    json!({"f2": f2, "re":values.f_real[i], "im":values.f_imag[i],
                    "factors": f, "d":1./q2[i].sqrt()}),
                );
            }
            strengths.push(f2 * correction.as_ref().map_or(1., |c| c.values[i]));
        }
    }
    Ok(json!(strengths))
}
