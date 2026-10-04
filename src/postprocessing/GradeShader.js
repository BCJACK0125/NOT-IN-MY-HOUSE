import { Color, Vector2 } from 'three';

/**
 * Final look pass (runs after tone mapping, in display space).
 *
 * Combines the cheap-but-high-impact grading operations into one pass so the
 * frame is only resampled once: chromatic aberration, lift/gain/contrast/
 * saturation/temperature grading, vignette and film grain.
 */
export const GradeShader = {
  name: 'GradeShader',

  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.35 },
    uVignette: { value: 0.4 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.1 },
    uTemperature: { value: 0.05 },
    uLift: { value: 0.0 },
    uGain: { value: 1.0 },
    uGrain: { value: 0.03 },
    // Combat pulses, driven by vfx/CombatFX.js. All zero at rest, and each one
    // is a branch that costs nothing until it is not.
    /** Radial smear towards `uImpactCenter`, and a kick of aberration. */
    uImpact: { value: 0 },
    uImpactCenter: { value: new Vector2(0.5, 0.5) },
    /** 見切: the world goes cold and grey, but blood, fire and the rim glow keep their red. */
    uDesat: { value: 0 },
    /** Additive full-frame flash. */
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 0.9, 0.8) }
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uTemperature;
    uniform float uLift;
    uniform float uGain;
    uniform float uGrain;
    uniform float uImpact;
    uniform vec2 uImpactCenter;
    uniform float uDesat;
    uniform float uFlash;
    uniform vec3 uFlashColor;

    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);

      // ---- chromatic aberration (radial, strongest at the corners) ------
      vec3 color;
      float aberration = uAberration + uImpact * 6.0;
      if (aberration > 0.001) {
        vec2 offset = centered * r2 * aberration * 0.02;
        color.r = texture2D(tDiffuse, uv + offset).r;
        color.g = texture2D(tDiffuse, uv).g;
        color.b = texture2D(tDiffuse, uv - offset).b;
      } else {
        color = texture2D(tDiffuse, uv).rgb;
      }

      // ---- impact smear --------------------------------------------------
      if (uImpact > 0.002) {
        vec2 toward = uv - uImpactCenter;
        vec3 sum = color;
        for (int i = 1; i < 6; i++) {
          sum += texture2D(tDiffuse, uv - toward * (float(i) * 0.012 * uImpact)).rgb;
        }
        color = sum / 6.0;
      }

      // ---- grading -------------------------------------------------------
      color = (color - 0.5) * uContrast + 0.5;          // contrast
      color = color * uGain + uLift;                     // lift / gain

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);       // saturation

      if (uDesat > 0.001) {
        float red = smoothstep(0.04, 0.22, color.r - max(color.g, color.b));
        vec3 cold = vec3(luma) * vec3(0.86, 0.95, 1.12);
        color = mix(color, mix(cold, color * 1.15, red), uDesat);
      }

      // Temperature: push warm into R/B, cool the other way.
      color.r += uTemperature * 0.12;
      color.b -= uTemperature * 0.12;

      // ---- vignette ------------------------------------------------------
      // Falls off from the centre and reaches (1 - uVignette) in the corners,
      // so the control maps directly onto "how much darker the corners are".
      color *= 1.0 - uVignette * smoothstep(0.15, 0.72, r2 * 1.9);

      color += uFlashColor * uFlash;

      // ---- grain ---------------------------------------------------------
      if (uGrain > 0.0005) {
        float grain = hash12(uv * vec2(1920.0, 1080.0) + fract(uTime) * 137.0) - 0.5;
        color += grain * uGrain;
      }

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `
};
