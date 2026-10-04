import { PointLight, Vector3 } from 'three';

/**
 * A fixed handful of real point lights, re-assigned every frame to the light
 * fittings nearest the camera. Three.js recompiles every material when the
 * light count changes, so the count never does — only where they are.
 *
 * Anchors are plain records ({pos, color, intensity, distance, flicker}), so a
 * story beat can black out a room by writing `intensity = 0`.
 */
export class LightPool {
  constructor(scene, anchors, count = 10) {
    this.anchors = anchors;
    this.lights = [];
    this.master = 1;
    for (let i = 0; i < count; i++) {
      const l = new PointLight('#ffffff', 0, 8, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this._sorted = [];
    this._focus = new Vector3();
  }

  update(focus, t) {
    this._focus.copy(focus);
    const f = this._focus;
    const sorted = this._sorted;
    sorted.length = 0;
    for (const a of this.anchors) {
      if (a.intensity <= 0 && !a.always) continue;
      const dy = Math.abs(a.pos.y - f.y);
      const d = a.pos.distanceToSquared(f) + (dy > 3 ? 400 : 0);
      a._d = d;
      sorted.push(a);
    }
    sorted.sort((p, q) => p._d - q._d);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const a = sorted[i];
      if (!a) { l.intensity = 0; continue; }
      l.position.copy(a.pos);
      l.color.copy(a.color);
      l.distance = a.distance;
      let k = 1;
      if (a.flicker > 0) {
        const s = Math.sin(t * 13 + a.seed) * Math.sin(t * 7.3 + a.seed * 2) + Math.sin(t * 31 + a.seed);
        const blink = Math.sin(t * 1.7 + a.seed * 3) > 0.92 ? 0.1 : 1;
        k = (1 - a.flicker * 0.35 + s * 0.12 * a.flicker) * (a.flicker > 0.5 ? blink : 1);
      }
      l.intensity = a.intensity * k * this.master;
    }
  }
}
