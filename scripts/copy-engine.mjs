import { copyFile } from 'node:fs/promises';

const source = new URL('../engine/target/wasm32-unknown-unknown/release/phasesmith_viewer_engine.wasm', import.meta.url);
const destination = new URL('../public/engine.wasm', import.meta.url);
await copyFile(source, destination);
