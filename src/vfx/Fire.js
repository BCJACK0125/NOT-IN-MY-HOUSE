import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { LAYER } from '../core/Layers.js';

/**
 * Burning cars and barrels: soft additive flame sprites rising, shrinking and
 * cooling from white-yellow to a red smoky edge. One draw call for every fire
 * on the street. The trajectory is closed-form in the vertex shader — the CPU
 * writes nothing after construction.
 */
export class Fire {
  constructor(spots, perFire = 46) {
    const n = spots.length * perFire;
    const seed = new Float32Array(n * 4);
    const origin = new Float32Array(n * 3);
    let i = 0;
    for (const s of spots) {
      for (let k = 0; k < perFire; k++, i++) {
        origin[i * 3] = s.x;
        origin[i * 3 + 1] = s.y;
        origin[i * 3 + 2] = s.z;
        seed[i * 4] = Math.random();
        seed[i * 4 + 1] = Math.random();
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = s.size;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(origin, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 4));
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uScale;
        attribute vec4 aSeed;
        varying float vLife;
        varying float vSeed;
        void main() {
          float life = fract(uTime * (0.55 + aSeed.x * 0.5) + aSeed.y);
          float size = aSeed.w;
          vec3 p = position;
          float a = aSeed.z * 6.2831;
          float r = size * (0.35 + 0.25 * aSeed.x) * (1.0 - life * 0.6);
          p.x += cos(a + life * 2.0) * r + sin(uTime * 3.0 + aSeed.y * 9.0) * 0.08 * life;
          p.z += sin(a + life * 2.0) * r;
          p.y += life * life * size * 2.2 + life * size * 0.4;
          vLife = life;
          vSeed = aSeed.x;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * size * (1.1 - life * 0.7) * (0.7 + aSeed.y * 0.6) / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float d = dot(c, c);
          if (d > 1.0) discard;
          float soft = (1.0 - d) * (1.0 - d);
          vec3 hot = vec3(1.0, 0.85, 0.45);
          vec3 mid = vec3(1.0, 0.42, 0.08);
          vec3 cool = vec3(0.35, 0.06, 0.02);
          vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, vLife));
          col = mix(col, cool, smoothstep(0.45, 1.0, vLife));
          float a = soft * (1.0 - smoothstep(0.6, 1.0, vLife)) * smoothstep(0.0, 0.08, vLife);
          gl_FragColor = vec4(col * a * 1.6, a);
        }`
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER.VFX);
    this.points.renderOrder = 3;
  }

  update(t) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uScale.value = window.innerHeight * 0.55;
  }
}
