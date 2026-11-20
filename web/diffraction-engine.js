// Share the module compiled by the CIF importer. Each execution context uses
// its own instance and buffers, including cancellable powder-plot workers.
export let diffractionModule;
let wasm;
export function setDiffractionModule(module) {
  diffractionModule = module;
  wasm = null;
}

function calculate(request) {
  if (!diffractionModule) throw Error("Load a crystal structure first.");
  wasm ??= new WebAssembly.Instance(diffractionModule).exports;
  const input = new TextEncoder().encode(JSON.stringify(request));
  const pointer = wasm.input_buffer(input.length);
  new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
  const length = wasm.xray_reflections();
  const result = JSON.parse(
    new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length)),
  );
  if (result.error) throw Error(result.error);
  return result;
}

export const maxScatteringVector = 6; // PhaseSmith Waasmaier–Kirfel range for sin(θ)/λ.
export const xrayFormFactor = (element, s) => calculate({ element, s });

export function structureFactors({ basis, atoms }, hkl, options = {}) {
  const axes = basis[0].map((_, i) => basis.map((row) => row[i]));
  const lengths = axes.map((v) => Math.hypot(...v));
  const angle = (a, b) => {
    const cosine = axes[a].reduce((sum, x, i) => sum + x * axes[b][i], 0) / (lengths[a] * lengths[b]);
    return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  };
  return calculate({
    cell: [...lengths, angle(1, 2), angle(2, 0), angle(0, 1)],
    atoms: atoms.map(({ frac, element, occupancy = 1, uStar, uIso }) => ({ frac, element, occupancy, uStar, uIso })),
    hkl,
    detail: false,
    ...options,
  });
}
