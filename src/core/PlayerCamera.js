import { PerspectiveCamera, Vector3, MathUtils } from 'three';
import { LAYER } from './Layers.js';

const _dir = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _pivot = new Vector3();

/**
 * Third-person camera for tight rooms.
 *
 * Mouse (pointer lock) or touch drags turn it; the wheel sets the distance.
 * Every frame a ray from the character's shoulders back to where the camera
 * wants to be is cast against the World's camera blockers — walls, ceilings,
 * furniture — and the camera stops short of the first one. It snaps in fast and
 * eases back out slowly, so a doorway never makes the view pump.
 *
 * `azimuth` matches OrbitControls' convention (camera offset from the target),
 * which is what the template's movement code expects.
 *
 * A cinematic can take it over with `setShot(pos, look)`.
 */
export class PlayerCamera {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 900);
    this.camera.layers.enable(LAYER.VFX);
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.distance = 3.6;
    this.wantDistance = 3.6;
    this.current = 3.6;
    this.target = new Vector3();
    this.height = 1.45;
    this.sensitivity = 1;
    this.enabled = true;
    this.shot = null;
    this._shake = 0;
    this._seed = Math.random() * 100;
    this.fovKick = 0;
    this.baseFov = 62;
    this.locked = false;
    this.shoulder = 0.42;
    this._off = 0;

    this._onMove = (e) => {
      if (!this.enabled || this.shot) return;
      if (document.pointerLockElement === this.canvas) this.look(e.movementX, e.movementY, 0.0023);
      else if (this.dragLook && e.buttons & 1) this.look(e.movementX, e.movementY, 0.004);
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wantDistance = MathUtils.clamp(this.wantDistance * Math.exp(e.deltaY * 0.001), 1.8, 7);
    };
    this._onLock = () => { this.locked = document.pointerLockElement === this.canvas; };
    document.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onLock);
  }

  look(dx, dy, k) {
    this.yaw -= dx * k * this.sensitivity;
    this.pitch = MathUtils.clamp(this.pitch + dy * k * this.sensitivity, -0.75, 1.25);
  }

  lock() {
    if (!this.canvas.requestPointerLock || matchMedia('(pointer: coarse)').matches) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p?.catch) p.catch(() => { this.dragLook = true; });
    } catch {
      this.dragLook = true;
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get azimuth() {
    return this.yaw;
  }

  /** Face the camera along a heading (0 = +Z), e.g. behind the player. */
  faceHeading(yaw, pitch = 0.3) {
    this.yaw = yaw + Math.PI;
    this.pitch = pitch;
  }

  shake(amount) {
    this._shake = Math.max(this._shake, amount);
  }

  setShot(pos, look, fov = null) {
    this.shot = { pos: pos.clone(), look: look.clone(), fov };
  }

  clearShot() {
    this.shot = null;
  }

  snap(anchor) {
    this.target.set(anchor.x, anchor.y + this.height, anchor.z);
    this.current = this.distance;
  }

  update(dt, anchor) {
    const cam = this.camera;
    this._shake = Math.max(0, this._shake - this._shake * Math.min(1, dt * 9) - dt * 0.02);
    const fov = (this.shot?.fov ?? this.baseFov) + this.fovKick;
    this.fovKick *= Math.exp(-dt * 6);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (this.shot) {
      cam.position.copy(this.shot.pos);
      cam.lookAt(this.shot.look);
    } else {
      this.distance += (this.wantDistance - this.distance) * Math.min(1, dt * 8);
      // Follow: tight vertically (stairs), a touch of lag horizontally.
      const k = 1 - Math.exp(-dt * 18);
      this.target.x += (anchor.x - this.target.x) * k;
      this.target.z += (anchor.z - this.target.z) * k;
      this.target.y += (anchor.y + this.height - this.target.y) * (1 - Math.exp(-dt * 10));
      const cp = Math.cos(this.pitch);
      _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
      // Over the right shoulder: the pivot steps sideways (as far as the walls
      // allow), so in a corridor the body is not a wall in front of the lens.
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const side = this.world.raycast(this.target.x, this.target.y, this.target.z, rx, 0, rz, this.shoulder + 0.3, 'cam');
      const off = Math.max(0, Math.min(this.shoulder, side - 0.3));
      this._off += (off - this._off) * Math.min(1, dt * 6);
      _pivot.set(this.target.x + rx * this._off, this.target.y, this.target.z + rz * this._off);
      const t = _pivot;
      const hit = this.world.raycast(t.x, t.y, t.z, _dir.x, _dir.y, _dir.z, this.distance + 0.35, 'cam');
      const allowed = Math.max(0.35, Math.min(this.distance, hit - 0.3));
      // In fast, out slow.
      this.current = allowed < this.current ? allowed : this.current + (allowed - this.current) * Math.min(1, dt * 3);
      _want.copy(t).addScaledVector(_dir, this.current);
      cam.position.copy(_want);
      _look.copy(t);
      _look.y += 0.05 + Math.max(0, 1.1 - this.current) * 0.25;
      cam.lookAt(_look);
    }

    if (this._shake > 1e-4) {
      const s = (performance.now() * 0.001 + this._seed) * 42;
      cam.position.x += (Math.sin(s) + Math.sin(s * 1.7)) * 0.5 * this._shake;
      cam.position.y += (Math.sin(s * 1.3 + 2.1) + Math.sin(s * 2.3)) * 0.5 * this._shake;
      cam.position.z += (Math.sin(s * 0.9 + 4.2) + Math.sin(s * 1.9)) * 0.5 * this._shake;
    }
  }

  /** How close the lens is to the body — the game hides the body when it is inside it. */
  get closeness() {
    return this.shot ? 99 : this.current;
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    // Keep a sane horizontal FOV on very wide or very tall screens.
    this.baseFov = MathUtils.clamp(2 * Math.atan(Math.tan(MathUtils.degToRad(95) / 2) / this.camera.aspect) * MathUtils.RAD2DEG, 55, 75);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLock);
  }
}
