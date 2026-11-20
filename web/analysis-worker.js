import { distanceDistribution, powderPattern } from "./structure-analysis.js";

self.onmessage = ({ data: { structure, mode, options } }) => {
  try {
    const result = mode === "distances" ? distanceDistribution(structure, options) : powderPattern(structure, options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
