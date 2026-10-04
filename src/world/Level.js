import * as THREE from 'three';
import {
  initMaterials, initFinishes, colliders, M, F, H, Layer, box, wall, windowUnit, plane, place, cbox, cyl,
  colorMat as cm
} from '../house/kit.js';
import * as T from '../house/tex.js';
import * as Fu from '../house/furn.js';
import { buildHouse } from '../house/house.js';
import { Door } from '../house/door.js';
import { K, KY, FH, PLINTH, HOME_FLOOR, floorY, PathLine, NavGrid } from './World.js';

/**
 * Builds the whole stage and registers it with the World:
 *
 *  - 8F: the apartment (Mi-Casa's plan, scaled up for a sword fight), the lift
 *    lobby, the lift car the game starts in, the front door.
 *  - 1F–8F: the stairwell, one lobby + switch-back module per storey.
 *  - 1F: a glass exit onto the street.
 *  - Outside: an L-shaped plaza wrapped around the tower, walled in by the city,
 *    with cars, barriers, street lamps, fires — and the rescue van.
 *
 * Plan coordinates (u, w) are Mi-Casa's metres; world = (u·K, floorY + y·KY, w·K).
 */

// Mi-Casa stairwell constants (plan metres).
const ST = { x0: 8.3, x1: 11.7, xl: 10.6, z0: 10.775, z1: 13.3, zm: 12.05 };
const RISE = 1.5;
const RUN = ST.xl - ST.x0;

export const PLAZA = { x0: -40, x1: 32, z0: -26, z1: 60 };
export const VAN = { x: -24, z: 51 };

/** world box from plan coords at a storey base */
const W = {
  x: (u) => u * K,
  z: (w) => w * K
};

export class Level {
  constructor(world, scene, loader) {
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'Level';
    scene.add(this.root);
    /** Light anchors for the pool: {pos, color, intensity, distance, zone, flicker} */
    this.lights = [];
    /** Things the player can use: {x,y,z, r, prompt, enabled, onUse} */
    this.interactables = [];
    this.modules = new Map(); // floor -> group
    this.worldMaterials = new Set();

    initMaterials(loader);
    initFinishes();
    this._buildHome();
    for (let n = 1; n <= HOME_FLOOR; n++) this._buildModule(n);
    this._buildShell();
    this._buildOutside();
    this._buildPaths();
    this._collectMaterials();
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  /** A group in plan space, placed at storey `n`. */
  _planGroup(n, name) {
    const g = new THREE.Group();
    g.name = name;
    g.scale.set(K, KY, K);
    g.position.y = floorY(n);
    this.root.add(g);
    return g;
  }

  /** Move kit colliders made since `mark` into the world, at storey base y. */
  _flushColliders(mark, baseY, opts = {}) {
    const list = colliders.splice(mark);
    for (const c of list) {
      const special = opts.filter ? opts.filter(c) : null;
      this.world.addBox(c.x0 * K, c.x1 * K, baseY + c.y0 * KY, baseY + c.y1 * KY, c.z0 * K, c.z1 * K, special ?? opts);
    }
  }

  _light(zone, x, y, z, { color = '#ffe2b8', intensity = 6, distance = 7, flicker = 0 } = {}) {
    const a = { zone, pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, flicker, seed: Math.random() * 100 };
    this.lights.push(a);
    return a;
  }

  interact(def) {
    const it = { r: 1.6, enabled: true, ...def };
    this.interactables.push(it);
    return it;
  }

  /* ------------------------------------------------------------------ */
  /* 8F: home                                                            */
  /* ------------------------------------------------------------------ */

  _buildHome() {
    const y8 = floorY(HOME_FLOOR);
    const mark = colliders.length;
    const house = buildHouse();
    const g = this._planGroup(HOME_FLOOR, 'Home');
    g.add(house.houseGroup, house.ceilings, house.dyn);
    this.home = { group: g, ...house };
    // The balcony's tall invisible barrier stops bodies, not the camera.
    this._flushColliders(mark, y8, {
      filter: (c) => (c.x1 <= 0.15 && c.y1 >= 2.4 ? { solid: true, cam: false, sight: false } : null)
    });
    for (const a of house.lights) {
      this._light('home', a.pos.x * K, y8 + a.pos.y * KY, a.pos.z * K, {
        color: a.color, intensity: a.intensity * 1.6, distance: a.distance * K, flicker: a.room === 'hall' || a.room === 'kitchen' ? 0.6 : 0
      });
    }

    // Walkable floors (plan rects from Mi-Casa's room list).
    const flat = (u0, u1, w0, w1, dy = 0, tag = 'home') =>
      this.world.addFlat(u0 * K, u1 * K, w0 * K, w1 * K, y8 + dy * KY, tag);
    flat(0, 5.95, 0, 12.5, 0, 'tile');
    flat(5.95, 11, 0.6, 3.68, 0, 'tile');
    flat(5.95, 11, 3.68, 6.52, 0.06, 'wood');
    flat(5.95, 11, 6.52, 10.72, 0, 'tile');
    flat(5.25, 6.62, 11.05, 12.75, 0, 'lift');
    // Camera ceiling over the flat (the visible ceilings are not colliders).
    this.world.addBox(-0.3, 11.2 * K, y8 + 2.38 * KY, y8 + 2.9 * KY, -0.3, 12.6 * K, { solid: false, cam: true, sight: false });

    // Story props ----------------------------------------------------
    // Grandfather's katana, in the master bedroom wardrobe.
    const sword = new THREE.Group();
    const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.05), cm('#1b1414', 0.4, 0.2));
    const tsuka = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), cm('#6b1d1d', 0.8));
    tsuka.position.z = 0.67;
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), M.gold);
    tsuba.rotation.x = Math.PI / 2; tsuba.position.z = 0.52;
    sword.add(sheath, tsuka, tsuba);
    sword.position.set(4.25, 1.05, 4.7);
    sword.rotation.set(-1.15, 0.05, 0);
    g.add(sword);
    this.swordProp = sword;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb36b', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(0.8, 0.8, 1);
    glow.position.set(4.25, 1.05, 4.7);
    g.add(glow);
    this.swordGlow = glow;

    // The note on the dining table.
    const note = plane(new THREE.MeshStandardMaterial({ map: noteTexture(), roughness: 0.9 }), 0.21, 0.297, 2.9, 0.79, 8.1, 0, -Math.PI / 2);
    note.rotation.z = 0.35;
    g.add(note);
    this.noteProp = note;

    // A family photo frame knocked down in the living room — flavour.
    // Blood smears and debris.
    const decals = new Layer('decals');
    for (const [u, w, s, r] of [[7.2, 9.6, 1.1, 0.3], [5.5, 6.0, 0.8, 1.2], [3.0, 7.2, 0.9, 2.2], [8.9, 2.4, 0.7, 0.5], [7.4, 11.9, 1.0, 1.0], [2.0, 4.6, 0.6, 2.8]]) {
      const d = plane(bloodMaterial(), s, s * 0.7, u, 0.012, w, r, -Math.PI / 2);
      decals.add(d);
    }
    g.add(decals.bake());
  }

  /* ------------------------------------------------------------------ */
  /* stairwell modules                                                   */
  /* ------------------------------------------------------------------ */

  _buildModule(n) {
    const base = floorY(n);
    const mark = colliders.length;
    const L = new Layer('module' + n);
    const H3 = 3.0;
    const home = n === HOME_FLOOR;

    // lobby slab (its underside is the ceiling of the storey below)
    box(L, M.terrazzo, 6.6, 8.3, -0.02, 0, 10.7, 13.4);
    box(L, M.ceiling, 6.6, 8.3, -0.2, -0.02, 10.7, 13.4);
    // north wall: the apartment's front door
    wall(L, { axis: 'x', at: 10.7, from: 5.95, to: 11.0, t: 0.15, neg: F.paint, pos: F.lobby, openings: [{ c: 7.3, w: 1.2, y0: 0, y1: 2.1, frameMat: M.frame }] });
    box(L, M.lobbyTile, 5.95, 11.0, 2.8, H3, 10.625, 10.775);
    wall(L, { axis: 'x', at: 10.7, from: 11.0, to: 11.8, t: 0.15, h: H3, neg: F.ext, pos: F.lobby });
    // south wall; on 1F, the way out
    wall(L, {
      axis: 'x', at: 13.4, from: 6.6, to: 11.8, t: 0.2, h: H3, neg: F.lobby, pos: F.ext,
      openings: n === 1 ? [{ c: 7.45, w: 1.5, y0: 0, y1: 2.35, frameMat: M.steel }] : []
    });
    wall(L, { axis: 'z', at: 11.8, from: 10.6, to: 13.5, t: 0.2, h: H3, neg: F.lobby, pos: F.ext, openings: [{ c: 12.05, w: 0.7, y0: 2.25, y1: 2.95, frame: false }] });
    windowUnit(L, { axis: 'z', at: 11.8, c: 12.05, w: 0.7, y0: 2.25, y1: 2.95, glass: M.glassFrost });
    // lift shaft enclosure
    box(L, M.paint, 5.1, 5.95, 0, H3, 10.1, 11.05, { solid: true });
    box(L, M.granite, 5.95, 6.675, 0, H3, 10.775, 11.05, { solid: true });
    box(L, M.granite, 5.1, 6.675, 0, H3, 12.75, 13.4, { solid: true });
    box(L, M.granite, 5.1, 5.25, 0, H3, 11.05, 12.75, { solid: true });
    wall(L, { axis: 'z', at: 6.6, from: 11.05, to: 12.75, t: 0.15, h: H3, neg: { mat: M.steelBrushed }, pos: F.granite, edge: M.steel, openings: [{ c: 11.9, w: 0.8, y0: 0, y1: 2.1, frame: false }] });
    box(L, M.steel, 6.675, 6.7, 0, 2.15, 11.45, 11.5); box(L, M.steel, 6.675, 6.7, 0, 2.15, 12.3, 12.35); box(L, M.steel, 6.675, 6.7, 2.1, 2.15, 11.45, 12.35);
    box(L, M.granite, 5.25, 6.525, H3 - 0.4, H3, 11.05, 12.75);
    box(L, M.steel, 6.675, 6.69, 0.95, 1.35, 11.24, 11.34);
    box(L, M.blackGloss, 6.675, 6.69, 2.2, 2.42, 11.7, 12.1);

    // the flights (module n climbs from storey n to n+1)
    const ang = Math.atan2(RISE, RUN), len = Math.hypot(RISE, RUN);
    const nose = cm('#3f8f7d', 0.5);
    for (let i = 0; i < 10; i++) {
      const tread = RUN / 10;
      let x0 = ST.x0 + i * tread, top = (i + 1) * 0.15;
      box(L, M.white, x0, x0 + tread, top - 0.15, top - 0.02, ST.zm + 0.06, ST.z1);
      box(L, M.stairTread, x0, x0 + tread, top - 0.02, top, ST.zm + 0.06, ST.z1);
      box(L, nose, x0 - 0.01, x0 + 0.03, top - 0.035, top + 0.002, ST.zm + 0.06, ST.z1);
      x0 = ST.xl - (i + 1) * tread; top = RISE + (i + 1) * 0.15;
      box(L, M.white, x0, x0 + tread, top - 0.15, top - 0.02, ST.z0, ST.zm - 0.06);
      box(L, M.stairTread, x0, x0 + tread, top - 0.02, top, ST.z0, ST.zm - 0.06);
      box(L, nose, x0 + tread - 0.03, x0 + tread + 0.01, top - 0.035, top + 0.002, ST.z0, ST.zm - 0.06);
    }
    for (const [zA, zB, sgn, b] of [[ST.zm + 0.06, ST.z1, 1, 0], [ST.z0, ST.zm - 0.06, -1, RISE]]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, zB - zA), M.white);
      s.rotation.z = sgn * ang;
      s.position.set((ST.x0 + ST.xl) / 2, b + RISE / 2 - 0.1, (zA + zB) / 2);
      L.add(s);
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.06), M.honey);
      r.rotation.z = sgn * ang;
      r.position.set((ST.x0 + ST.xl) / 2, b + RISE / 2 + 0.9, sgn > 0 ? ST.zm + 0.13 : ST.zm - 0.13);
      L.add(r);
    }
    box(L, M.white, ST.xl, 11.7, RISE - 0.2, RISE - 0.02, 10.775, 13.3);
    box(L, M.stairTread, ST.xl, 11.7, RISE - 0.02, RISE, 10.775, 13.3);
    wall(L, { axis: 'x', at: ST.zm, from: ST.x0, to: ST.xl, t: 0.12, h: H3, neg: F.lobby, pos: F.lobby });
    L.add(cbox(M.honey, 0.12, 1.0, 0.12, ST.x0, 0, ST.zm));

    // per-storey dressing
    if (!home) {
      // the neighbours' doors, shut tight
      box(L, M.teal, 6.62, 6.66, 0, 2.1, 11.5, 12.3, { solid: true });
      box(L, M.black, 6.66, 6.665, 0, 2.1, 11.895, 11.905);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.08, 0.05), [M.frame, M.frame, M.frame, M.frame, M.frontDoor, M.frontDoor]);
      d.position.set(7.125, 1.04, 10.66); L.add(d);
      box(L, M.narrowLeaf, 7.55, 7.9, 0, 2.08, 10.64, 10.68, { solid: true });
      box(L, M.frontDoor, 6.7, 7.55, 0, 2.08, 10.62, 10.7, { solid: true });
      L.add(plane(M.gate, 1.2, 2.08, 7.3, 1.04, 10.8));
      // claw marks and a smear on the lobby floor of some storeys
      if (n % 2 === 0) L.add(plane(bloodMaterial(), 0.9, 0.6, 7.6, 0.012, 12.3, n, -Math.PI / 2));
      // junk the residents dragged out to block the stairs
      if (n === 5) { place(L, Fu.cardboard(0.6, 0.5, 0.45), 10.9, 12.6, 0.4, { y: RISE }); place(L, Fu.bicycle(), 11.2, 11.4, 0.3, { y: RISE }); }
      if (n === 3) { place(L, Fu.storageBin('#a9c6e3'), 11.2, 12.8, 0.2, { y: RISE }); }
    } else {
      // up the stairs to 9F is a wall of furniture
      box(L, M.walnut, ST.x0 + 0.05, ST.x0 + 0.65, 0, 1.6, ST.zm + 0.1, ST.z1, { solid: true });
      place(L, Fu.cardboard(0.5, 0.45, 0.6), ST.x0 + 0.95, 12.7, 0.3, { y: 0.45 });
      place(L, Fu.storageBin('#f3f3ef'), ST.x0 + 0.4, 12.6, 1.3, { y: 1.6 });
      box(L, M.white, ST.x0 + 0.7, ST.x0 + 1.3, 0.3, 1.25, ST.zm + 0.1, ST.z1, { solid: true });
      const rack = Fu.shoeRack(); rack.scale.set(0.6, 1, 0.85); place(L, rack, 8.1, 10.93, 0, { solid: [0.38, 0.28, 0.8] });
      box(L, cm('#9c2f2a', 0.9), 6.85, 7.75, 0, 0.01, 10.82, 11.35);
    }
    if (n === 1) {
      // nothing goes down to B1: slab over the gap and a locked gate
      box(L, M.terrazzo, ST.x0, 11.7, -0.02, 0, ST.z0, ST.zm);
      L.add(plane(M.gate, ST.zm - ST.z0, 2.1, ST.x0 + 0.1, 1.05, (ST.z0 + ST.zm) / 2, Math.PI / 2));
      box(L, M.steel, ST.x0 + 0.05, ST.x0 + 0.15, 0, 2.1, ST.z0, ST.zm - 0.06, { solid: true });
      // the glass doors lie shattered outside; mat and mailbox
      box(L, M.steel, 6.6, 6.75, 0, 2.35, 13.3, 13.5);
      box(L, cm('#7b8a92', 0.4, 0.6), 9.2, 10.4, 0.9, 1.6, 13.2, 13.3, { solid: true });
    }
    place(L, Fu.domeLight(0.15, M.bulbCool), 7.45, 12.0, 0, { y: 2.8 });
    place(L, Fu.domeLight(0.12, M.bulbCool), 11.2, 12.05, 0, { y: RISE + 2.75 });

    const g = this._planGroup(n, 'Module' + n);
    g.add(L.bake());

    // floor sign by the lift + a big painted number on the stair wall
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), new THREE.MeshStandardMaterial({ map: T.label(`${n}F`, { w: 256, h: 160, bg: '#f7f5ef', fg: '#1f3c66', font: 'bold 110px "Segoe UI", sans-serif' }), roughness: 0.4 }));
    sign.position.set(6.69, 1.62, 12.55); sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const big = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.75), new THREE.MeshBasicMaterial({ map: T.label(`${n}F`, { w: 256, h: 200, fg: '#c0392b', font: 'bold 150px "Segoe UI", sans-serif' }), transparent: true }));
    big.position.set(11.69, 1.5 + RISE, 12.05); big.rotation.y = -Math.PI / 2;
    g.add(big);
    const lantern = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.2), new THREE.MeshBasicMaterial({ map: T.label(home ? '8' : '—', { w: 128, h: 96, bg: '#080808', fg: '#ff3324', font: 'bold 80px "Courier New", monospace', glow: true }), toneMapped: false }));
    lantern.position.set(6.692, 2.31, 11.9); lantern.rotation.y = Math.PI / 2;
    g.add(lantern);

    this.modules.set(n, g);
    this._flushColliders(mark, base);

    // stairwell ceiling for the camera, and the shaft walls already in
    // walkable surfaces
    const world = this.world;
    world.addFlat(6.6 * K, 8.3 * K, 10.7 * K, 13.4 * K, base, n === 1 ? 'lobby1' : 'lobby');
    const flight = (x, z) => {
      const u = x / K, w = z / K;
      if (u >= ST.xl) return base + RISE * KY;
      const t = Math.min(1, Math.max(0, (u - ST.x0) / RUN));
      return w >= ST.zm ? base + RISE * KY * t : base + (3.0 - RISE * t) * KY;
    };
    if (n < HOME_FLOOR) world.addRegion(ST.x0 * K, 11.8 * K, 10.7 * K, 13.4 * K, flight, 'stairs');
    // 8F: only the blocked flight up (south half) belongs to this storey. The
    // north half is the top of 7F's flight down — a flat floor over it would
    // hold the body at 8F height and the stairs could never be walked down.
    else world.addRegion(ST.x0 * K, 11.8 * K, ST.zm * K, 13.4 * K, flight, 'stairs');
    if (n === 1) world.addFlat(ST.x0 * K, 11.8 * K, ST.z0 * K, ST.zm * K, base, 'lobby1');
    // A stair ceiling for the camera at 8F (nothing above is walkable).
    if (home) world.addBox(5.0 * K, 12 * K, base + FH - 0.25, base + FH + 0.2, 10.0 * K, 13.6 * K, { solid: false, cam: true, sight: false });

    // lights
    this._light('stairs' + n, 7.45 * K, base + 2.45 * KY, 12.0 * K, { color: '#e8f0ff', intensity: 5, distance: 7, flicker: n === 6 || n === 3 ? 0.8 : 0.1 });
    this._light('stairs' + n, 11.1 * K, base + (RISE + 2.4) * KY, 12.05 * K, { color: '#e8f0ff', intensity: 5, distance: 7, flicker: n === 4 ? 0.9 : 0.1 });

    if (home) this._buildLiftAndDoor(g, base);
    if (n === 1) {
      // steps down to the street
      world.addRegion(6.0 * K, 9.0 * K, 13.38 * K, 14.6 * K, (x, z) => PLINTH * (1 - Math.min(1, Math.max(0, (z / K - 13.5) / 1.1))), 'steps');
    }
  }

  /** The lift car you start in, and the front door of home. */
  _buildLiftAndDoor(g, base) {
    // car
    const L = new Layer('car');
    const x0 = 5.25, x1 = 6.525, z0 = 11.05, z1 = 12.75, top = 2.35;
    const panelMat = new THREE.MeshStandardMaterial({ map: T.strips({ base: '#e3dccb', line: '#b9b09b', n: 4, meters: 0.9, vertical: true }), roughness: 0.4 });
    panelMat.userData.worldUV = true;
    box(L, M.floorBath, x0, x1, -0.02, 0, z0, z1);
    box(L, panelMat, x0, x0 + 0.01, 0, top, z0, z1);
    box(L, panelMat, x0, x1, 0, top, z0, z0 + 0.01);
    box(L, panelMat, x0, x1, 0, top, z1 - 0.01, z1);
    box(L, M.mirror, x0 + 0.012, x0 + 0.02, 0.95, 2.2, z0 + 0.25, z1 - 0.25);
    box(L, M.steel, x0 + 0.02, x0 + 0.06, 0.88, 0.92, z0 + 0.1, z1 - 0.1);
    box(L, M.ledDots, x0, x1, top, top + 0.02, z0, z1);
    box(L, M.granite, x0, x1, top + 0.02, 2.65, z0, z1);
    box(L, M.steel, 6.5, 6.515, 0.85, 1.75, 12.38, 12.62);
    g.add(L.bake());
    this.carDisplay = T.label('8', { w: 128, h: 96, bg: '#080808', fg: '#ff3324', font: 'bold 80px "Courier New", monospace', glow: true });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshBasicMaterial({ map: this.carDisplay, toneMapped: false }));
    disp.position.set(6.49, 1.85, 12.5); disp.rotation.y = -Math.PI / 2; g.add(disp);
    const geo = new THREE.BoxGeometry(0.04, 2.1, 0.4);
    const mats = [M.teal, M.steelBrushed, M.steel, M.steel, M.steel, M.steel];
    const left = new THREE.Mesh(geo, mats), right = new THREE.Mesh(geo, mats);
    g.add(left, right);
    const lift = { left, right, open: 0.3, target: 0.3 };
    lift.apply = () => { const o = lift.open * 0.4; left.position.set(6.64, 1.05, 11.7 - o); right.position.set(6.64, 1.05, 12.1 + o); };
    lift.apply();
    this.lift = lift;
    this.world.segmentSources.push(() => {
      if (lift.open > 0.85) return [];
      const o = lift.open * 0.4;
      return [[6.64 * K, 11.5 * K, 6.64 * K, (11.9 - o) * K, base, base + 2.6], [6.64 * K, (11.9 + o) * K, 6.64 * K, 12.3 * K, base, base + 2.6]];
    });
    this._light('lift', 5.9 * K, base + 2.15 * KY, 11.9 * K, { color: '#fff7ea', intensity: 3.5, distance: 5, flicker: 0.9 });
    // camera ceiling inside the car
    this.world.addBox(5.2 * K, 6.6 * K, base + 2.3 * KY, base + 2.7 * KY, 11.0 * K, 12.8 * K, { solid: false, cam: true, sight: false });

    // front door + security gate
    const mk = (o) => { const d = new Door(o); g.add(d.group); return d; };
    const front = mk({ hinge: [6.7, 10.66], dir: [1, 0], swing: [0, -1], width: 0.85, height: 2.08, thick: 0.05, mat: M.frontDoor, name: '大門' });
    const gate = mk({ hinge: [6.7, 10.8], dir: [1, 0], swing: [0, 1], width: 0.75, height: 2.08, thick: 0.02, mat: M.gate, edgeMat: M.steel, name: '鐵門', knob: false });
    const fixed = new Layer('fixed');
    box(fixed, M.narrowLeaf, 7.55, 7.9, 0, 2.08, 10.64, 10.68);
    fixed.add(plane(M.gate, 0.45, 2.08, 7.675, 1.04, 10.8));
    g.add(fixed.bake());
    this.world.addBox(7.55 * K, 7.9 * K, base, base + 2.1 * KY, 10.6 * K, 10.85 * K);
    this.frontDoor = { front, gate, open: false };
    this.frontDoor.toggle = (o) => { front.toggle(o); gate.toggle(o); this.frontDoor.open = o; };
    this.world.segmentSources.push(() => {
      const out = [];
      for (const d of [front, gate]) {
        const [a, b, c, e] = d.segment();
        out.push([a * K, b * K, c * K, e * K, base, base + 2.6]);
      }
      return out;
    });
  }

  /* ------------------------------------------------------------------ */
  /* the tower's skin                                                    */
  /* ------------------------------------------------------------------ */

  _buildShell() {
    const facade = new THREE.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.85, emissiveMap: null });
    facade.map.repeat.set(1 / 3.0, 1 / FH);
    facade.map.offset.set(0, -PLINTH / FH);
    facade.userData.worldUV = true;
    const facadeLit = facade.clone();
    facadeLit.map = facade.map;
    const L = new Layer('shell');
    const y8 = floorY(HOME_FLOOR);
    const roof = floorY(14);
    const solid = (x0, x1, y0, y1, z0, z1, mat = facade) => {
      box(L, mat, x0, x1, y0, y1, z0, z1);
      this.world.addBox(x0, x1, y0, y1, z0, z1, { solid: true, cam: true, sight: true });
    };
    const fp = [[-0.12, 11.12, 0.48, 10.62], [1.2, 6.07, -0.12, 0.6], [-0.12, 3.85, 10.1, 12.6], [3.75, 5.1, 10.1, 13.52]];
    for (const [a, b, c, d] of fp) {
      solid(a * K, b * K, 0, y8 - 0.03, c * K, d * K);
      solid(a * K, b * K, y8 + H * KY + 0.02, roof, c * K, d * K);
    }
    // the core above the stairwell, and its plinth
    solid(5.08 * K, 11.95 * K, floorY(HOME_FLOOR + 1) - 0.01, roof, 10.08 * K, 13.55 * K);
    solid(5.08 * K, 11.95 * K, 0, PLINTH - 0.2 * KY - 0.01, 10.08 * K, 13.55 * K);
    // roof parapet and a water tank
    box(L, M.paintWarm, -0.3, 18.2, roof, roof + 1.1, -0.3, 20.6);
    box(L, cm('#8a8f93', 0.5, 0.3), 3, 7, roof + 1.1, roof + 3.5, 3, 6);
    // ground-floor canopy over the exit
    box(L, cm('#30343a', 0.5, 0.4), 6.3 * K, 8.6 * K, PLINTH + 2.45 * KY, PLINTH + 2.6 * KY, 13.4 * K, 14.9 * K);
    this.root.add(L.bake());
    this.facade = facade;
  }

  /* ------------------------------------------------------------------ */
  /* outside                                                             */
  /* ------------------------------------------------------------------ */

  _buildOutside() {
    const world = this.world;
    const P = PLAZA;
    // The street: one big flat surface. (The Ground mesh draws it.)
    world.addFlat(-120, 120, -120, 140, 0, 'street');

    const L = new Layer('outside');
    const concrete = cm('#6d6a66', 0.9);
    const curb = cm('#8d8a84', 0.8);
    const asphaltLine = cm('#d9c36a', 0.7);
    const add = (x0, x1, y0, y1, z0, z1, mat, opts = {}) => {
      box(L, mat, x0, x1, y0, y1, z0, z1);
      if (opts.solid !== false) world.addBox(x0, x1, y0, y1, z0, z1, { solid: true, cam: opts.cam ?? true, sight: opts.sight ?? (y1 - y0 > 1.4) });
    };

    // perimeter: concrete walls with the city right behind them
    const wallH = 3.2;
    add(P.x0 - 1, P.x0, 0, wallH, P.z0, P.z1, concrete);
    add(P.x1, P.x1 + 1, 0, wallH, P.z0, P.z1, concrete);
    add(P.x0, P.x1, 0, wallH, P.z0 - 1, P.z0, concrete);
    // south wall with a gate gap where the van waits
    add(P.x0, VAN.x - 5, 0, wallH, P.z1, P.z1 + 1, concrete);
    add(VAN.x + 5, P.x1, 0, wallH, P.z1, P.z1 + 1, concrete);
    world.addBox(VAN.x - 5, VAN.x + 5, 0, 4, P.z1 + 3, P.z1 + 4); // the van's side of the gate

    // the tower's own plinth and a ring of curb
    add(-0.3, 18.1, 0, PLINTH, -0.3, 20.2, cm('#57534d', 0.85), { cam: true, sight: false, solid: false });
    // road markings
    for (let z = P.z0 + 4; z < P.z1 - 2; z += 6) box(L, asphaltLine, -21.1, -20.9, 0, 0.012, z, z + 3);
    for (let x = 0; x < P.x1 - 2; x += 6) box(L, asphaltLine, x, x + 3, 0, 0.012, 39.9, 40.1);
    // planters with trees
    this.treeSpots = [[-8, 4], [-8, 18], [-32, -10], [-32, 22], [24, 28], [6, 30], [-30, 44], [-6, 46]];
    for (const [x, z] of this.treeSpots) {
      add(x - 1.4, x + 1.4, 0, 0.6, z - 1.4, z + 1.4, curb, { sight: false });
      box(L, cm('#2b2219', 1), x - 1.25, x + 1.25, 0.6, 0.62, z - 1.25, z + 1.25);
    }

    // cars: some burning
    this.fires = [];
    const cars = [
      [-14, -6, 0.3, '#7b1e1e', true], [-26, 8, 1.6, '#c9c9c4', false], [-17, 30, 2.8, '#20334d', false],
      [14, 34, -0.2, '#d2b04a', true], [-34, 34, 1.4, '#3a3a3a', false], [2, 50, 0.1, '#8a8f99', false], [22, 48, 1.9, '#5c2a5a', true]
    ];
    for (const [x, z, ry, color, burning] of cars) this._car(L, x, z, ry, color, burning);
    // jersey barriers
    const barriers = [[-20, 14, 0], [-20, 17.5, 0], [-11, 26, Math.PI / 2], [-6, 26, Math.PI / 2], [8, 42, 0.4], [-28, 28, 0.2], [18, 26, Math.PI / 2], [-30, 3, 1.2]];
    for (const [x, z, ry] of barriers) this._barrier(L, x, z, ry);
    // burning barrels
    for (const [x, z] of [[-4, -12], [-36, 12], [10, 26], [-15, 44], [28, 56]]) {
      const g = new THREE.Group();
      g.add(cyl(cm('#3b2f2a', 0.6, 0.6), 0.32, 0.3, 0.9, 0, 0, 0, 14));
      place(L, g, x, z, 0);
      world.addBox(x - 0.35, x + 0.35, 0, 0.9, z - 0.35, z + 0.35, { sight: false });
      this.fires.push({ x, y: 0.95, z, size: 0.7 });
      this._light('outside', x, 1.6, z, { color: '#ff8a3c', intensity: 9, distance: 9, flicker: 0.5 });
    }
    // street lamps
    for (const [x, z, on] of [[-3, -18, 1], [-3, 10, 0], [-3, 34, 1], [-24, -18, 1], [-24, 22, 1], [-37, 40, 0], [6, 24, 1], [22, 24, 1], [26, 54, 1], [-10, 56, 1]]) {
      add(x - 0.1, x + 0.1, 0, 6, z - 0.1, z + 0.1, cm('#2d3136', 0.5, 0.6), { sight: false });
      box(L, cm('#2d3136', 0.5, 0.6), x - 0.08, x + 0.08, 5.9, 6.0, z - 0.08, z + 1.2);
      box(L, on ? M.bulb : cm('#555', 0.5), x - 0.2, x + 0.2, 5.75, 5.9, z + 0.9, z + 1.3);
      if (on) this._light('outside', x, 5.6, z + 1.1, { color: '#ffd29a', intensity: 22, distance: 18, flicker: Math.random() < 0.4 ? 0.7 : 0 });
    }
    // a bus stop, benches, dumpster
    add(-36, -34.5, 0, 2.6, -2, 6, cm('#3c4650', 0.4, 0.5), { sight: false });
    add(26, 29, 0, 1.6, 4, 6, cm('#2f5d3a', 0.7, 0.2));
    for (const [x, z, ry] of [[-28, 34, 0], [16, 54, 0], [-14, 10, Math.PI / 2]]) {
      const g = new THREE.Group();
      g.add(cbox(M.darkWood, 1.6, 0.06, 0.45, 0, 0.45, 0), cbox(M.black, 0.06, 0.45, 0.4, -0.7, 0, 0), cbox(M.black, 0.06, 0.45, 0.4, 0.7, 0, 0), cbox(M.darkWood, 1.6, 0.4, 0.05, 0, 0.5, -0.2));
      place(L, g, x, z, ry);
      world.addBox(x - 0.85, x + 0.85, 0, 0.5, z - 0.3, z + 0.3, { sight: false });
    }
    // debris + blood on the street
    for (let i = 0; i < 26; i++) {
      const x = P.x0 + 4 + Math.random() * (P.x1 - P.x0 - 8);
      const z = P.z0 + 4 + Math.random() * (P.z1 - P.z0 - 8);
      if (x > -1 && x < 19 && z < 21) continue;
      L.add(plane(bloodMaterial(), 0.8 + Math.random(), 0.6 + Math.random() * 0.6, x, 0.015, z, Math.random() * 6, -Math.PI / 2));
    }

    // the rescue van at the gate
    this._van(L);

    this.root.add(L.bake());
    this._buildCity();
  }

  _car(L, x, z, ry, color, burning) {
    const g = new THREE.Group();
    const paint = cm(color, 0.35, 0.5);
    const dark = cm('#141414', 0.6);
    g.add(cbox(paint, 1.8, 0.7, 4.3, 0, 0.35, 0));
    g.add(cbox(burning ? cm('#1b1714', 0.9) : cm('#1a2129', 0.1, 0.6), 1.6, 0.6, 2.1, 0, 1.05, -0.2));
    for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
      const w = cyl(dark, 0.36, 0.36, 0.25, 0, 0, 0, 14);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.36, wz);
      g.add(w);
    }
    if (!burning) {
      g.add(cbox(M.bulb, 0.3, 0.1, 0.05, -0.6, 0.6, 2.16), cbox(M.bulb, 0.3, 0.1, 0.05, 0.6, 0.6, 2.16));
      g.add(cbox(cm('#8b0000', 0.4), 0.3, 0.1, 0.05, -0.6, 0.65, -2.16), cbox(cm('#8b0000', 0.4), 0.3, 0.1, 0.05, 0.6, 0.65, -2.16));
    }
    place(L, g, x, z, ry);
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = (1.8 * c + 4.3 * s) / 2, ez = (1.8 * s + 4.3 * c) / 2;
    this.world.addBox(x - ex, x + ex, 0, 1.4, z - ez, z + ez, { sight: false });
    if (burning) {
      this.fires.push({ x, y: 1.3, z, size: 1.6 });
      this._light('outside', x, 2.2, z, { color: '#ff7a2a', intensity: 16, distance: 13, flicker: 0.6 });
    }
  }

  _barrier(L, x, z, ry) {
    const g = new THREE.Group();
    const m = cm('#a8a49b', 0.85);
    g.add(cbox(m, 0.6, 0.3, 3.0, 0, 0, 0), cbox(m, 0.3, 0.55, 3.0, 0, 0.3, 0), cbox(cm('#c0392b', 0.6), 0.31, 0.12, 3.02, 0, 0.62, 0));
    place(L, g, x, z, ry);
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = (0.6 * c + 3 * s) / 2, ez = (0.6 * s + 3 * c) / 2;
    this.world.addBox(x - ex, x + ex, 0, 0.85, z - ez, z + ez, { sight: false });
  }

  _van(L) {
    const { x, z } = VAN;
    const g = new THREE.Group();
    const white = cm('#e9e7e1', 0.4, 0.2);
    g.add(cbox(white, 2.2, 2.2, 5.6, 0, 0.45, 0));
    g.add(cbox(cm('#c0392b', 0.5), 2.22, 0.3, 5.62, 0, 1.3, 0));
    g.add(cbox(cm('#1a2129', 0.1, 0.6), 2.0, 0.7, 0.05, 0, 1.6, -2.81));
    const sirenA = cbox(new THREE.MeshStandardMaterial({ color: '#ff2222', emissive: '#ff2222', emissiveIntensity: 3 }), 0.5, 0.18, 0.3, -0.45, 2.65, -1.8);
    const sirenB = cbox(new THREE.MeshStandardMaterial({ color: '#2266ff', emissive: '#2266ff', emissiveIntensity: 3 }), 0.5, 0.18, 0.3, 0.45, 2.65, -1.8);
    for (const [wx, wz] of [[-1.05, 1.9], [1.05, 1.9], [-1.05, -1.9], [1.05, -1.9]]) {
      const w = cyl(cm('#111', 0.6), 0.42, 0.42, 0.3, 0, 0, 0, 14);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz);
      g.add(w);
    }
    // a red cross on the side
    g.add(cbox(cm('#c0392b', 0.5), 0.02, 0.6, 0.18, 1.115, 1.5, 0.6), cbox(cm('#c0392b', 0.5), 0.02, 0.18, 0.6, 1.115, 1.71, 0.6));
    g.position.set(x, 0, z + 1.5);
    g.rotation.y = Math.PI;
    this.root.add(g);
    this.van = { group: g, sirenA, sirenB };
    g.add(sirenA, sirenB);
    this.world.addBox(x - 1.2, x + 1.2, 0, 2.7, z + 1.5 - 2.9, z + 1.5 + 2.9, { sight: false });
    this.vanLightA = this._light('van', x - 0.5, 3.2, z + 0.5, { color: '#ff2a2a', intensity: 0, distance: 14 });
    this.vanLightB = this._light('van', x + 0.5, 3.2, z + 0.5, { color: '#2a6bff', intensity: 0, distance: 14 });
  }

  /** The city past the walls: towers with a few windows still lit. */
  _buildCity() {
    const L = new Layer('city');
    const tex = cityTexture();
    const mats = [0, 1, 2].map((i) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.9, color: ['#5b5f66', '#6d665e', '#4d5560'][i] });
      m.userData.worldUV = true;
      tex.repeat.set(1 / 12, 1 / 15);
      return m;
    });
    const rand = T.rng(42);
    const ring = (x0, x1, z0, z1, side) => {
      let t = 0;
      const along = side === 'x' ? x1 - x0 : z1 - z0;
      while (t < Math.abs(along)) {
        const w = 12 + rand() * 16;
        const h = 18 + rand() * 46;
        const d = 12 + rand() * 14;
        const m = mats[(rand() * 3) | 0];
        if (side === 'x') {
          const za = z0, zb = z0 + d * (z1 > z0 ? 1 : -1);
          box(L, m, x0 + t, x0 + t + w - 1.5, 0, h, Math.min(za, zb), Math.max(za, zb));
        } else {
          const xa = x0, xb = x0 + d * (x1 > x0 ? 1 : -1);
          box(L, m, Math.min(xa, xb), Math.max(xa, xb), 0, h, z0 + t, z0 + t + w - 1.5);
        }
        t += w;
      }
    };
    const P = PLAZA;
    ring(P.x0 - 70, P.x1 + 70, P.z0 - 8, P.z0 - 30, 'x');
    ring(P.x0 - 70, P.x1 + 70, P.z1 + 10, P.z1 + 32, 'x');
    ring(P.x0 - 8, P.x0 - 30, P.z0 - 8, P.z1 + 10, 'z');
    ring(P.x1 + 8, P.x1 + 30, P.z0 - 8, P.z1 + 10, 'z');
    const g = L.bake();
    g.traverse((o) => { if (o.isMesh) o.material.fog = true; });
    this.root.add(g);
    this.city = g;
  }

  /* ------------------------------------------------------------------ */
  /* the stairwell as a line, and the nav grids                          */
  /* ------------------------------------------------------------------ */

  _buildPaths() {
    const pts = [];
    const p = (u, y, w) => pts.push({ x: u * K, y, z: w * K });
    const zN = (ST.z0 + ST.zm) / 2 - 0.05;
    const zS = (ST.zm + ST.z1) / 2;
    p(7.6, floorY(HOME_FLOOR), 11.6);
    for (let n = HOME_FLOOR - 1; n >= 1; n--) {
      const b = floorY(n);
      p(8.35, b + 3.0 * KY, zN);
      p(ST.xl, b + RISE * KY, zN);
      p(11.15, b + RISE * KY, zN + 0.2);
      p(11.15, b + RISE * KY, zS - 0.2);
      p(ST.xl, b + RISE * KY, zS);
      p(8.35, b, zS);
      p(7.6, b, zS);
      if (n > 1) p(7.6, b, zN);
    }
    p(7.45, floorY(1), 13.2);
    this.stairPath = new PathLine(pts);
  }

  buildNav() {
    const y8 = floorY(HOME_FLOOR);
    this.navHome = new NavGrid(this.world, {
      x0: -0.4, x1: 8.4 * K, z0: -0.4, z1: 13.5 * K, cell: 0.35, floor: y8, radius: 0.3,
      include: (x, z) => !(x > 8.32 * K && z > 10.6 * K)
    });
    const P = PLAZA;
    this.navOutside = new NavGrid(this.world, {
      x0: P.x0, x1: P.x1, z0: P.z0, z1: P.z1 + 4, cell: 0.5, floor: 0, radius: 0.4,
      include: (x, z) => !(x > ST.x0 * K && x < 12 * K && z > 10 * K && z < 13.6 * K)
    });
  }

  /* ------------------------------------------------------------------ */

  _collectMaterials() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      for (const m of [].concat(o.material)) if (m) this.worldMaterials.add(m);
    });
  }

  /** Trees in the plaza's planters, from one model, scaled to ~7 m. */
  plantTrees(source) {
    const box = new THREE.Box3().setFromObject(source);
    const size = box.getSize(new THREE.Vector3());
    const k = 7 / Math.max(0.01, size.y);
    source.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      for (const m of [].concat(o.material)) if (m) { m.side = THREE.DoubleSide; this.worldMaterials.add(m); }
    });
    for (const [i, [x, z]] of this.treeSpots.entries()) {
      const t = source.clone();
      const s = k * (0.85 + ((i * 37) % 10) / 30);
      t.scale.setScalar(s);
      t.position.set(x - (box.min.x + size.x / 2) * s, 0.6 - box.min.y * s, z - (box.min.z + size.z / 2) * s);
      this.root.add(t);
      this.world.addBox(x - 0.35, x + 0.35, 0, 4, z - 0.35, z + 0.35, { solid: false, cam: false, sight: false });
    }
  }

  /** Show only the storeys near the player (the rest are behind the shell). */
  cull(playerY, outside) {
    const n = Math.round((playerY - PLINTH) / FH) + 1;
    for (const [f, g] of this.modules) {
      g.visible = outside ? f === 1 : Math.abs(f - n) <= 1 || (f === HOME_FLOOR && n >= HOME_FLOOR - 1);
    }
    this.home.ceilings.visible = true;
  }

  update(dt, t) {
    for (const d of [this.frontDoor?.front, this.frontDoor?.gate]) d?.update(dt);
    if (this.lift) {
      this.lift.open += (this.lift.target - this.lift.open) * Math.min(1, dt * 3);
      this.lift.apply();
    }
    if (this.swordGlow?.visible) {
      const s = 0.7 + Math.sin(t * 3) * 0.12;
      this.swordGlow.scale.set(s, s, 1);
    }
    if (this.van?.on) {
      const a = Math.sin(t * 10) > 0;
      this.van.sirenA.material.emissiveIntensity = a ? 4 : 0.2;
      this.van.sirenB.material.emissiveIntensity = a ? 0.2 : 4;
      this.vanLightA.intensity = a ? 30 : 0;
      this.vanLightB.intensity = a ? 0 : 30;
    }
  }
}

/* -------------------------------------------------------------------- */
/* textures                                                              */
/* -------------------------------------------------------------------- */

let _blood = null;
function bloodMaterial() {
  if (_blood) return _blood;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rand = T.rng(7);
  for (let i = 0; i < 40; i++) {
    const x = 128 + (rand() - 0.5) * 150, y = 128 + (rand() - 0.5) * 110, r = 6 + rand() * 34;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(70,4,6,0.95)'); grad.addColorStop(0.7, 'rgba(60,2,4,0.7)'); grad.addColorStop(1, 'rgba(50,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(60,3,5,0.85)'; g.beginPath(); g.arc(rand() * 256, rand() * 256, 1 + rand() * 4, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _blood = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2 });
  return _blood;
}

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function noteTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 362;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 256, 362);
  g.fillStyle = '#2a2a6a'; g.font = '22px "Microsoft JhengHei", sans-serif';
  ['先走了，', '在樓下廣場的', '救援車等你。', '', '一定要來。', '— 媽'].forEach((s, i) => g.fillText(s, 24, 60 + i * 42));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One storey × 3 m of the tower's face: tiles and a window, most of them dark. */
function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#b9a58c'; g.fillRect(0, 0, 256, 320);
  g.strokeStyle = 'rgba(80,64,48,0.35)'; g.lineWidth = 1;
  for (let y = 0; y < 320; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let y = 0; y < 320; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < 256; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); }
  // a slab band at each floor
  g.fillStyle = '#8c7c69'; g.fillRect(0, 300, 256, 20);
  // window
  g.fillStyle = '#2b2f36'; g.fillRect(56, 70, 144, 150);
  g.fillStyle = '#11151b'; g.fillRect(64, 78, 128, 134);
  g.fillStyle = 'rgba(160,190,220,0.12)'; g.fillRect(64, 78, 60, 134);
  g.fillStyle = '#2b2f36'; g.fillRect(126, 78, 6, 134);
  g.fillStyle = '#6b6156'; g.fillRect(50, 220, 156, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A 12 m × 15 m patch of a city tower: a grid of windows, a few still lit. */
function cityTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0d10'; g.fillRect(0, 0, 256, 320);
  const rand = T.rng(5);
  for (let y = 6; y < 320; y += 21) {
    for (let x = 6; x < 256; x += 21) {
      const r = rand();
      g.fillStyle = r < 0.06 ? '#ffcf7a' : r < 0.08 ? '#ff6a3a' : r < 0.1 ? '#9fc7ff' : '#16181c';
      g.fillRect(x, y, 13, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
