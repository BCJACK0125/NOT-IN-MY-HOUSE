import { Vector3 } from 'three';

const _p = new Vector3();
const _l = new Vector3();
const _d = new Vector3();

const ease = {
  linear: (t) => t,
  inOut: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - (1 - t) * (1 - t),
  in: (t) => t * t
};

/**
 * In-engine cutscenes: a list of shots, each a camera move between two framings
 * over a duration, with optional subtitle and hooks. Rendered live with the
 * real scene, so the prologue is the game itself — the same tower, the same
 * shades, the same lights.
 *
 * shot = {
 *   dur, from: [pos, look], to: [pos, look] (or follow: () => [pos, look]),
 *   fov, ease, sub: '...', subAt, enter(), tick(k, dt), exit()
 * }
 */
export class Cinematic {
  constructor(cam, ui) {
    this.cam = cam;
    this.ui = ui;
    this.shots = null;
    this.index = 0;
    this.t = 0;
    this.onDone = null;
    this.skippable = true;
    this._hold = 0;
  }

  get active() {
    return !!this.shots;
  }

  play(shots, onDone, { skippable = true, letterbox = true } = {}) {
    this.shots = shots;
    this.index = -1;
    this.t = 0;
    this.onDone = onDone;
    this.skippable = skippable;
    this.letterbox = letterbox;
    document.body.classList.add('cinematic');
    if (letterbox) this.ui.letterbox(true);
    this.ui.skipHint(skippable);
    this._next();
  }

  _next() {
    const prev = this.shots[this.index];
    prev?.exit?.();
    this.index++;
    this.t = 0;
    const shot = this.shots[this.index];
    if (!shot) return this._finish();
    shot.enter?.();
    if (shot.sub !== undefined && !shot.subAt) this.ui.subtitle(shot.sub);
    shot._subbed = !shot.subAt;
  }

  _finish(skipped = false) {
    const done = this.onDone;
    this.shots = null;
    this.onDone = null;
    this.cam.clearShot();
    document.body.classList.remove('cinematic');
    this.ui.letterbox(false);
    this.ui.skipHint(false);
    this.ui.subtitle('');
    done?.(skipped);
  }

  skip() {
    if (!this.active || !this.skippable) return;
    // Shots only do presentation; anything the world must keep happens in the
    // scene's onDone, which is told it was skipped.
    this.shots[this.index]?.exit?.();
    this._finish(true);
  }

  /** Hold-to-skip, so a stray key does not throw the scene away. */
  holdSkip(down, dt) {
    if (!this.active || !this.skippable) return;
    this._hold = down ? this._hold + dt : 0;
    if (this._hold > 0.55) {
      this._hold = 0;
      this.skip();
    }
  }

  update(dt) {
    if (!this.active) return;
    const shot = this.shots[this.index];
    if (!shot) return;
    this.t += dt;
    const k = Math.min(1, this.t / shot.dur);
    if (!shot._subbed && shot.subAt !== undefined && this.t >= shot.subAt) {
      shot._subbed = true;
      this.ui.subtitle(shot.sub);
    }
    shot.tick?.(k, dt);
    if (shot.follow) {
      const [pos, look] = shot.follow(k);
      if (shot.clamp && this.cam.world) {
        // Keep a hand-placed shot out of walls: pull it toward what it looks at.
        _d.copy(pos).sub(look);
        const len = _d.length();
        _d.multiplyScalar(1 / (len || 1));
        const hit = this.cam.world.raycast(look.x, look.y, look.z, _d.x, _d.y, _d.z, len, 'cam');
        if (hit < len) pos.copy(look).addScaledVector(_d, Math.max(0.4, hit - 0.25));
      }
      this.cam.setShot(pos, look, shot.fov ?? null);
    } else if (shot.from) {
      const e = (ease[shot.ease] ?? ease.inOut)(k);
      const to = shot.to ?? shot.from;
      _p.lerpVectors(shot.from[0], to[0], e);
      _l.lerpVectors(shot.from[1], to[1], e);
      this.cam.setShot(_p, _l, shot.fov ?? null);
    }
    if (k >= 1) this._next();
  }
}

export const v3 = (x, y, z) => new Vector3(x, y, z);
