import { readFile } from "node:fs/promises";
import { setDiffractionModule } from "../web/diffraction-engine.js";

const wasm = await readFile(new URL("../public/engine.wasm", import.meta.url));
setDiffractionModule(await WebAssembly.compile(wasm));
