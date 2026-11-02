// Stands in for three/webgpu: three-render-objects only builds a WebGPURenderer when asked to, and the Memory view never asks.
// Without this the WebGPU renderer and its node materials add about 1 MB to the bundle.
export class WebGPURenderer {
  constructor() { throw new Error('WebGPU is not bundled') }
}
