// Vite emits this module into assets/, while development serves it from web/.
// Resolve relative BASE_URL from that directory's parent, never from assets/.
const appRoot = new URL(import.meta.env.BASE_URL, new URL('../', self.location.href));
const engineURL = new URL('engine.wasm', appRoot);
let enginePromise;

async function engine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const response = await fetch(engineURL);
      if (!response.ok) throw new Error(`Cannot load structure engine (${response.status})`);
      const bytes = await response.arrayBuffer();
      const { instance, module } = await WebAssembly.instantiate(bytes, {});
      self.postMessage({ diffractionModule: module });
      return instance.exports;
    })().catch(error => { enginePromise = undefined; throw error; });
  }
  return enginePromise;
}

// Serialize imports because a WASM instance has one input/output buffer.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (!data || typeof data.text !== 'string') throw new Error('Import requires CIF text');
      if (new TextEncoder().encode(data.text).byteLength > 16 * 1024 * 1024) {
        throw new Error('CIF exceeds the 16 MiB import limit');
      }
      const wasm = await engine();
      const input = new TextEncoder().encode(JSON.stringify({ text: data.text, block: data.block ?? null }));
      const pointer = wasm.input_buffer(input.length);
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      const length = wasm.import_cif();
      // import_cif may grow memory, so create a fresh view only afterward.
      const output = new Uint8Array(wasm.memory.buffer, wasm.output_buffer(), length);
      self.postMessage(JSON.parse(new TextDecoder().decode(output)));
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
