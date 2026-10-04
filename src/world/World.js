/**
 * The playable space: what you can stand on, what you bump into, what the camera
 * and the enemies can see through.
 *
 * Everything the level builds registers here in *world* metres. The apartment is
 * modelled in Mi-Casa's original plan coordinates and scaled up (K horizontally,
 * KY vertically) so a sword fight fits in a living room; `toWorld*` helpers do
 * that conversion in one place.
 *
 * Three kinds of record:
 *  - **boxes**   axis-aligned solids. `solid` ones stop bodies, `cam` ones only
 *                stop the camera (ceilings), `sight` ones block line of sight.
 *  - **regions** walkable surfaces: a rectangle plus a height function (flat,
 *                or a ramp for stairs). `heightAt` picks the highest surface at
 *                or a step below the body, which is what makes stacked floors and
 *                stairs work with no physics engine.
 *  - **segments** thin dynamic walls (door leaves) re-read every frame.
 */

export const K = 1.5; // horizontal scale of the apartment plan
export const KY = 1.25; // vertical scale
export const FH = 3.0 * KY; // floor-to-floor height
export const PLINTH = 0.45; // the 1F floor sits a few steps above the street
export const HOME_FLOOR = 8;
export const STEP = 0.55;

export const floorY = (n) => PLINTH + (n - 1) * FH;

const CELL = 2; // spatial hash cell, metres

export class World {
  constructor() {
    this.boxes = [];
    this.regions = [];
    /** () => Array<[x0,z0,x1,z1,y0,y1]> */
    this.segmentSources = [];
    this._grid = new Map();
    this._rgrid = new Map();
    this._stamp = 0;
    this._stamps = null;
  }

  /* ------------------------------------------------------------------ */
  /* registration                                                        */
  /* ------------------------------------------------------------------ */

  addBox(x0, x1, y0, y1, z0, z1, { solid = true, cam = true, sight = true, tag = null } = {}) {
    const b = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      y0: Math.min(y0, y1), y1: Math.max(y0, y1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      solid, cam, sight, tag, id: this.boxes.length, enabled: true
    };
    this.boxes.push(b);
    this._insert(this._grid, b, b.id);
    return b;
  }

  /** A walkable surface. `h(x, z)` in world metres. */
  addRegion(x0, x1, z0, z1, h, tag = null) {
    const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), h, tag };
    r.id = this.regions.length;
    this.regions.push(r);
    this._insert(this._rgrid, r, r.id);
    return r;
  }

  addFlat(x0, x1, z0, z1, y, tag) {
    return this.addRegion(x0, x1, z0, z1, () => y, tag);
  }

  _insert(grid, b, id) {
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    // Huge records (the street) go in a shared overflow list instead of
    // thousands of cells.
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 400) {
      if (!grid.has('big')) grid.set('big', []);
      grid.get('big').push(id);
      return;
    }
    for (let x = cx0; x <= cx1; x++) {
      for (let z = cz0; z <= cz1; z++) {
        const key = x * 73856093 ^ z * 19349663;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(id);
      }
    }
  }

  _cellList(grid, x, z) {
    return grid.get(Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663);
  }

  /* ------------------------------------------------------------------ */
  /* surfaces                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The surface a body at height `y` is standing on: the highest one that is
   * no more than a step above its feet. With nothing under it, the lowest.
   */
  heightAt(x, z, y = Infinity) {
    let best = -Infinity;
    let low = Infinity;
    const visit = (ids) => {
      if (!ids) return;
      for (const id of ids) {
        const r = this.regions[id];
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
        const h = r.h(x, z);
        if (h <= y + STEP && h > best) best = h;
        if (h < low) low = h;
      }
    };
    visit(this._cellList(this._rgrid, x, z));
    visit(this._rgrid.get('big'));
    if (best > -Infinity) return best;
    return low < Infinity ? low : 0;
  }

  /** Region tag under a body, for footstep sounds and zone logic. */
  regionAt(x, z, y) {
    let best = null;
    let bestH = -Infinity;
    const visit = (ids) => {
      if (!ids) return;
      for (const id of ids) {
        const r = this.regions[id];
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
        const h = r.h(x, z);
        if (h <= y + STEP && h > bestH) { bestH = h; best = r; }
      }
    };
    visit(this._cellList(this._rgrid, x, z));
    visit(this._rgrid.get('big'));
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* bodies                                                              */
  /* ------------------------------------------------------------------ */

  _nearBoxes(x0, z0, x1, z1, fn) {
    const stamp = ++this._stamp;
    if (!this._stamps || this._stamps.length < this.boxes.length) this._stamps = new Uint32Array(this.boxes.length + 256);
    const st = this._stamps;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const ids = this._grid.get(cx * 73856093 ^ cz * 19349663);
        if (!ids) continue;
        for (const id of ids) {
          if (st[id] === stamp) continue;
          st[id] = stamp;
          const b = this.boxes[id];
          if (b.enabled) fn(b);
        }
      }
    }
    const big = this._grid.get('big');
    if (big) for (const id of big) { const b = this.boxes[id]; if (b.enabled) fn(b); }
  }

  /**
   * Push a vertical capsule (radius r, from foot to foot+height) out of every
   * solid box and door leaf. XZ only — heights are `heightAt`'s job.
   * @returns {boolean} whether anything was touched
   */
  collide(p, r, foot, height = 1.7) {
    let hit = false;
    const lo = foot + 0.32;
    const hi = foot + height;
    for (let iter = 0; iter < 2; iter++) {
      this._nearBoxes(p.x - r, p.z - r, p.x + r, p.z + r, (b) => {
        if (!b.solid || b.y1 <= lo || b.y0 >= hi) return;
        const cx = Math.max(b.x0, Math.min(p.x, b.x1));
        const cz = Math.max(b.z0, Math.min(p.z, b.z1));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        hit = true;
        if (d2 < 1e-9) {
          const ex = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
          const m = Math.min(...ex);
          const i = ex.indexOf(m);
          if (i === 0) p.x = b.x0 - r;
          else if (i === 1) p.x = b.x1 + r;
          else if (i === 2) p.z = b.z0 - r;
          else p.z = b.z1 + r;
          return;
        }
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      });
      for (const source of this.segmentSources) {
        for (const s of source()) {
          const [x0, z0, x1, z1, y0 = -1e9, y1 = 1e9] = s;
          if (y1 <= lo || y0 >= hi) continue;
          const vx = x1 - x0, vz = z1 - z0, l2 = vx * vx + vz * vz || 1e-9;
          const t = Math.max(0, Math.min(1, ((p.x - x0) * vx + (p.z - z0) * vz) / l2));
          const dx = p.x - (x0 + vx * t), dz = p.z - (z0 + vz * t);
          const d = Math.hypot(dx, dz), rr = r + 0.04;
          if (d < rr && d > 1e-6) { p.x += (dx / d) * (rr - d); p.z += (dz / d) * (rr - d); hit = true; }
        }
      }
    }
    return hit;
  }

  /** Whether a capsule would overlap any solid here. Used by nav and spawns. */
  blocked(x, z, r, foot, height = 1.6) {
    let hit = false;
    const lo = foot + 0.32;
    const hi = foot + height;
    this._nearBoxes(x - r, z - r, x + r, z + r, (b) => {
      if (hit || !b.solid || b.y1 <= lo || b.y0 >= hi) return;
      const cx = Math.max(b.x0, Math.min(x, b.x1));
      const cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) hit = true;
    });
    return hit;
  }

  /* ------------------------------------------------------------------ */
  /* rays                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Distance along a ray to the first box that matches `filter`, or `max`.
   * @param {'cam'|'sight'|'solid'} kind
   */
  raycast(ox, oy, oz, dx, dy, dz, max, kind = 'cam') {
    let best = max;
    const ex = ox + dx * max, ez = oz + dz * max;
    this._nearBoxes(Math.min(ox, ex) - 0.1, Math.min(oz, ez) - 0.1, Math.max(ox, ex) + 0.1, Math.max(oz, ez) + 0.1, (b) => {
      if (!b[kind]) return;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t !== null && t < best) best = t;
    });
    return best;
  }

  /** Clear sight between two points (used by AI). */
  sight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, 'sight') >= len - 0.05;
  }
}

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let c = (hi - o) / d;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}

/* -------------------------------------------------------------------- */
/* navigation                                                            */
/* -------------------------------------------------------------------- */

/**
 * A walkability grid over one storey, and a distance field toward a goal.
 *
 * Enemies don't plan paths; they roll downhill on a field that is rebuilt
 * (Dijkstra, 8-connected) only when the goal moves to another cell. One field
 * serves every enemy in the zone, which is what makes a crowd of twenty cheap.
 */
export class NavGrid {
  constructor(world, { x0, x1, z0, z1, cell = 0.4, floor, radius = 0.32, include = null }) {
    this.world = world;
    this.x0 = x0; this.z0 = z0; this.cell = cell; this.floor = floor;
    this.nx = Math.ceil((x1 - x0) / cell);
    this.nz = Math.ceil((z1 - z0) / cell);
    const n = this.nx * this.nz;
    this.open = new Uint8Array(n);
    this.dist = new Float32Array(n).fill(Infinity);
    this.goal = -1;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = x0 + (ix + 0.5) * cell;
        const z = z0 + (iz + 0.5) * cell;
        if (include && !include(x, z)) continue;
        const h = world.heightAt(x, z, floor + 0.4);
        if (Math.abs(h - floor) > 0.7) continue;
        if (world.blocked(x, z, radius, h)) continue;
        this.open[iz * this.nx + ix] = 1;
      }
    }
    this._heap = new MinHeap(n);
  }

  index(x, z) {
    const ix = Math.floor((x - this.x0) / this.cell);
    const iz = Math.floor((z - this.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }

  /** The nearest open cell to a point (a body pressed against a wall is in a closed one). */
  nearestOpen(x, z) {
    const i = this.index(x, z);
    if (i >= 0 && this.open[i]) return i;
    const ix = Math.floor((x - this.x0) / this.cell);
    const iz = Math.floor((z - this.z0) / this.cell);
    for (let r = 1; r < 6; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          const j = jz * this.nx + jx;
          if (!this.open[j]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = j; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  setGoal(x, z) {
    const g = this.nearestOpen(x, z);
    if (g < 0 || g === this.goal) return;
    this.goal = g;
    const { nx, nz, open, dist } = this;
    dist.fill(Infinity);
    const heap = this._heap;
    heap.clear();
    dist[g] = 0;
    heap.push(g, 0);
    const D = Math.SQRT2;
    while (heap.size) {
      const i = heap.pop();
      const di = dist[i];
      const ix = i % nx, iz = (i / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (!open[j]) continue;
          // No corner cutting: a diagonal needs both orthogonal cells open.
          if (dx && dz && (!open[iz * nx + jx] || !open[jz * nx + ix])) continue;
          const nd = di + (dx && dz ? D : 1);
          if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
        }
      }
    }
  }

  /**
   * Which way to walk from (x, z) to go downhill, as a unit vector into `out`.
   * @returns {boolean} false if there is no path
   */
  direction(x, z, out) {
    const i = this.nearestOpen(x, z);
    if (i < 0 || !Number.isFinite(this.dist[i])) return false;
    const { nx, nz, dist, open } = this;
    const ix = i % nx, iz = (i / nx) | 0;
    // Look two rings out for a smoother heading than the 8 neighbours give.
    let best = dist[i], bx = 0, bz = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (!open[j]) continue;
        // ring-2 cells only if the cell between is open too
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
          const mx = ix + Math.sign(dx), mz = iz + Math.sign(dz);
          if (!open[mz * nx + mx]) continue;
        }
        const d = dist[j] + Math.hypot(dx, dz) * 0.0;
        const score = d / 1 - 0.001 * Math.hypot(dx, dz);
        if (score < best) { best = score; bx = dx; bz = dz; }
      }
    }
    if (!bx && !bz) {
      // At the goal cell: head for its centre.
      const cx = this.x0 + (ix + 0.5) * this.cell;
      const cz = this.z0 + (iz + 0.5) * this.cell;
      const l = Math.hypot(cx - x, cz - z);
      if (l < 1e-3) return false;
      out.x = (cx - x) / l; out.z = (cz - z) / l;
      return true;
    }
    const tx = this.x0 + (ix + bx + 0.5) * this.cell;
    const tz = this.z0 + (iz + bz + 0.5) * this.cell;
    const l = Math.hypot(tx - x, tz - z) || 1;
    out.x = (tx - x) / l; out.z = (tz - z) / l;
    return true;
  }

  distanceAt(x, z) {
    const i = this.nearestOpen(x, z);
    return i < 0 ? Infinity : this.dist[i] * this.cell;
  }

  isOpen(x, z) {
    const i = this.index(x, z);
    return i >= 0 && this.open[i] === 1;
  }
}

class MinHeap {
  constructor(n) {
    this.ids = new Int32Array(n * 4 + 16);
    this.keys = new Float32Array(n * 4 + 16);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(id, key) {
    if (this.size >= this.ids.length) return;
    let i = this.size++;
    const ids = this.ids, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const last = --this.size;
    const id = ids[last], key = keys[last];
    let i = 0;
    while (true) {
      let c = 2 * i + 1;
      if (c >= last) break;
      if (c + 1 < last && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= key) break;
      ids[i] = ids[c]; keys[i] = keys[c]; i = c;
    }
    ids[i] = id; keys[i] = key;
    return top;
  }
}

/**
 * The stairwell as what it really is to a body walking it: a line.
 *
 * A polyline from the top lobby down to the bottom one; anything on the stairs
 * is projected to its arc length `s`, and chasing is "walk toward the player's
 * s". Switchbacks, landings and the centre wall all come for free.
 */
export class PathLine {
  constructor(points) {
    this.p = points; // [{x,y,z}]
    this.s = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      this.s.push(this.s[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    this.length = this.s[this.s.length - 1];
  }

  /** Arc length of the closest point on the line to (x,y,z). */
  project(x, y, z) {
    let best = Infinity, bs = 0;
    for (let i = 1; i < this.p.length; i++) {
      const a = this.p[i - 1], b = this.p[i];
      const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
      const l2 = vx * vx + vy * vy + vz * vz || 1e-9;
      let t = ((x - a.x) * vx + (y - a.y) * vy + (z - a.z) * vz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + vx * t, py = a.y + vy * t, pz = a.z + vz * t;
      // Height errors weigh triple: a point a flight above is not "close".
      const d = (x - px) ** 2 + 9 * (y - py) ** 2 + (z - pz) ** 2;
      if (d < best) { best = d; bs = this.s[i - 1] + Math.sqrt(l2) * t; }
    }
    return bs;
  }

  pointAt(s, out) {
    s = Math.max(0, Math.min(this.length, s));
    for (let i = 1; i < this.p.length; i++) {
      if (s <= this.s[i] || i === this.p.length - 1) {
        const a = this.p[i - 1], b = this.p[i];
        const seg = this.s[i] - this.s[i - 1] || 1;
        const t = Math.max(0, Math.min(1, (s - this.s[i - 1]) / seg));
        out.x = a.x + (b.x - a.x) * t;
        out.y = a.y + (b.y - a.y) * t;
        out.z = a.z + (b.z - a.z) * t;
        return out;
      }
    }
    return out;
  }
}
