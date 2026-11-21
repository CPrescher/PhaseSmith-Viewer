import { FramebufferTexture, LinearFilter, NoBlending, ShaderMaterial, Vector2 } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Smooth the completed live image, including peeled translucent edges. Copy
// on the GPU after compositing: this preserves the existing sRGB blending and
// premultiplied alpha, without adding a high-resolution pass for every layer.
// Exports bypass this filter and render at their independently requested size.
export function createLiveAntialias(renderer) {
  const size = new Vector2();
  let texture;
  const material = new ShaderMaterial({
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: FXAAShader.fragmentShader,
    uniforms: { tDiffuse: { value: null }, resolution: { value: new Vector2() } },
    blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(material);
  return {
    render() {
      renderer.getDrawingBufferSize(size);
      if (!texture || texture.image.width !== size.x || texture.image.height !== size.y) {
        texture?.dispose();
        texture = new FramebufferTexture(size.x, size.y);
        texture.minFilter = texture.magFilter = LinearFilter;
        material.uniforms.tDiffuse.value = texture;
        material.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
      }
      renderer.copyFramebufferToTexture(texture);
      quad.render(renderer);
    },
    dispose() { texture?.dispose(); material.dispose(); quad.dispose(); },
  };
}
