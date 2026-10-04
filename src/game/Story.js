import { Color, Vector3 } from 'three';
import { K, KY, HOME_FLOOR, floorY } from '../world/World.js';
import { VAN } from '../world/Level.js';
import { v3 } from './Cinematic.js';

/**
 * NOT IN MY HOUSE — the script.
 *
 * 序章 電梯   Power dies with you in the lift at 8F. Pry the doors, clear the lobby.
 * 第一章 我家 They are in your home. Grandfather's katana is in the wardrobe.
 *             Mum's note: the family made it to the rescue van in the plaza.
 *             The balcony: the plaza below is full of them — and they heard you.
 * 第二章 樓梯間 No power, no lift. Eight floors of stairwell, landing by landing.
 * 最終章 樓外 Cut a path across the plaza; the Mother of the Black Tide rises.
 *             Dawn. The shades burn in the light. Get in the van.
 *
 * Each step: enter() sets it up, done() says when it is over. Steps marked
 * `checkpoint` are where a death sends you back to; `spawn` is where you stand.
 */
export function buildSteps(g) {
  const app = g.app;
  const L = app.level;
  const y8 = floorY(HOME_FLOOR);
  const P = (u, w, f = HOME_FLOOR, dy = 0) => g.P(u, w, f, dy);
  const inBalcony = () => {
    const p = app.character.position;
    return p.x < 1.3 * K && p.z > 6.1 * K && p.z < 10.1 * K && p.y > y8 - 1;
  };
  const liftLight = L.lights.find((a) => a.zone === 'lift');
  const liftLightBase = liftLight ? liftLight.intensity : 3;
  const emergency = { zone: 'lift', pos: new Vector3(5.9 * K, y8 + 2.2 * KY, 11.4 * K), color: new Color('#ff2a1a'), intensity: 0, distance: 6, flicker: 0, seed: 1 };
  L.lights.push(emergency);

  const steps = [
    /* ---------------------------------------------------------------- */
    {
      id: 'lift',
      chapter: '序章　電梯',
      checkpoint: true,
      tags: ['lift'],
      spawn: { pos: P(5.85, 11.9), yaw: Math.PI / 2, pitch: 0.15 },
      objective: '電梯卡住了：撬開電梯門 [F]',
      enter(g, { quiet }) {
        L.lift.target = 0.3;
        L.lift.open = 0.3;
        L.carDisplay.userData.draw('8');
        if (liftLight) { liftLight.intensity = liftLightBase * 0.5; liftLight.flicker = 0.9; }
        emergency.intensity = 3.5;
        g.flags.pried = false;
        g.spawn('shade', { x: P(7.7, 12.9).x, z: P(7.7, 12.9).z, y: y8, yaw: Math.PI, crouch: true }, 'lift');
        g.lobbyWalker = g.spawn('shade', { x: P(8.6, 11.4).x, z: P(8.6, 11.4).z, y: y8, yaw: -Math.PI / 2 }, 'lift');
        g.addInteract({
          pos: P(6.4, 11.9), r: 1.4, prompt: '撬開電梯門',
          onUse: (g, it) => {
            g.removeInteract(this._it);
            L.lift.target = 1;
            app.sound.metal();
            app.cam.shake(0.12);
            g.flags.pried = true;
          }
        });
        this._it = g.interactables[g.interactables.length - 1];
        if (!quiet) g.say('電梯停在 8 樓，門卡住了。', 3);
      },
      done: (g) => g.flags.pried,
      skipTo() { L.lift.target = 1; L.lift.open = 1; },
      prologue() { prologue(g); }
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'lobby',
      chapter: '序章　電梯',
      objective: (g) => `擊退梯廳的影（剩 ${g.alive('lift')}）`,
      enter(g) {
        app.toast.show(app.isTouch ? '「踢」攻擊　·　「閃」閃避（無敵）　·　敵人身上發出亮橘光＝要出手了' : '右鍵 / E：踢　·　Space：閃避（無敵）　·　敵人身上發出亮橘光＝要出手了', 6500);
        g.later(0.6, () => g.wakeTag('lift'));
      },
      done: (g) => g.alive('lift') === 0
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'door',
      chapter: '序章　電梯',
      checkpoint: true,
      spawn: { pos: P(7.45, 11.8), yaw: Math.PI, pitch: 0.2 },
      objective: '回家：打開大門 [F]',
      enter(g) {
        L.lift.target = 1;
        g.flags.doorOpen = false;
        const it = g.addInteract({
          pos: P(7.3, 10.95), r: 1.5, prompt: '打開家門',
          onUse: (g) => {
            g.removeInteract(it);
            L.frontDoor.toggle(true);
            app.sound.door();
            app.sound.metal();
            g.flags.doorOpen = true;
          }
        });
        g.say('家門……鐵門被抓得都是痕跡。', 3);
      },
      done: (g) => g.flags.doorOpen,
      skipTo() { L.lift.target = 1; L.lift.open = 1; L.frontDoor.toggle(true); }
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'sword',
      chapter: '第一章　我家',
      checkpoint: true,
      tags: ['home1'],
      spawn: { pos: P(7.35, 11.3), yaw: Math.PI, pitch: 0.2 },
      objective: (g) => `找到爺爺的刀（主臥室衣櫃）[F]` + (g.alive('home1') ? `　·　客廳有 ${g.alive('home1')} 隻影` : ''),
      enter(g, { retry } = {}) {
        L.lift.target = 1;
        L.frontDoor.toggle(true);
        if (retry) g.later(0.8, () => g.say('爺爺的刀還在主臥室的衣櫃裡。', 3));
        else g.later(0.05, () => introHome(g));
        g.spawn('shade', { ...xz(P(8.0, 8.4)), y: y8, crouch: true, yaw: 0.4 }, 'home1');
        g.spawn('shade', { ...xz(P(9.8, 9.5)), y: y8, yaw: 3.6 }, 'home1');
        g.spawn('shade', { ...xz(P(5.45, 4.4)), y: y8, yaw: 0 }, 'home1');
        const it = g.addInteract({
          pos: P(4.0, 4.7), r: 1.6, prompt: '取出爺爺的刀',
          onUse: (g) => {
            g.removeInteract(it);
            g.giveSword();
            swordScene(g);
          }
        });
        g.addPickup(P(2.5, 1.2).x, y8, P(2.5, 1.2).z, 35);
      },
      done: (g) => g.hasSword,
      skipTo(g) { g.hasSword = true; }
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'clear',
      chapter: '第一章　我家',
      tags: ['home2'],
      objective: (g) => `把影趕出我家（剩 ${g.alive('home1') + g.alive('home2')}）`,
      enter(g) {
        g.wakeTag('home1');
        const rise = (kind, u, w, dy = 0, delay = 0) =>
          g.later(delay, () => g.spawn(kind, { ...xz(P(u, w)), y: y8 + dy, spawn: 'rise' }, 'home2'));
        rise('shade', 3.3, 7.0, 0, 0.8);
        rise('runner', 2.2, 11.3, 0, 1.6);
        rise('shade', 8.5, 2.2, 0, 2.4);
        rise('shade', 8.6, 5.3, 0.075, 3.0);
        rise('brute', 8.4, 8.0, 0, 4.2);
        g.flags.clearSpawned = false;
        g.later(4.4, () => { g.flags.clearSpawned = true; });
        g.later(1.0, () => g.say('它們聞到刀的味道了。<em>這是我家。</em>', 3.5));
      },
      done: (g) => g.flags.clearSpawned && g.alive('home1') + g.alive('home2') === 0
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'note',
      chapter: '第一章　我家',
      checkpoint: true,
      spawn: { pos: P(4.4, 8.3), yaw: -Math.PI / 2, pitch: 0.3 },
      objective: '餐桌上有一張紙條 [F]',
      enter(g) {
        g.flags.noteRead = false;
        g.later(0.8, () => g.say('家裡安靜下來了。……媽她們呢？', 3));
        const it = g.addInteract({
          pos: P(2.9, 8.2), r: 1.9, prompt: '看紙條',
          onUse: (g) => {
            g.removeInteract(it);
            g.ui.note(true);
            app.sound.chime();
          }
        });
      },
      onNoteClosed(g) {
        g.flags.noteRead = true;
        g.say('她們先走了，在樓下的救援車。……去陽台看看。', 4);
      },
      done: (g) => g.flags.noteRead
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'balcony',
      chapter: '第一章　我家',
      objective: '到陽台看看外面',
      done: () => inBalcony()
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'climbers',
      chapter: '第一章　我家',
      tags: ['climb'],
      objective: (g) => `它們爬上來了！守住（剩 ${g.alive('climb')}）`,
      enter(g) {
        g.flags.climbDone = false;
        L.van.on = true;
        const climber = (w, delay) => g.later(delay, () => {
          const to = P(0.7, w);
          g.spawn('shade', { x: to.x, z: to.z, y: y8, yaw: Math.PI / 2, spawn: 'climb', from: new Vector3(-0.7, y8 - 1.9, to.z) }, 'climb');
        });
        const rush = (kind, delay) => g.later(delay, () => g.spawn(kind, { ...xz(P(7.4, 12.4)), y: y8, awake: true }, 'climb'));
        g.cinematic([
          {
            dur: 4.2, from: [v3(-0.5, y8 + 2.6, 11.6), v3(-10, 2, 13)], to: [v3(-1.2, y8 + 3.0, 12.4), v3(-18, 0, 18)],
            sub: '樓下的廣場……救援車還在，在另一頭。',
            enter: () => { g.showOutside = true; g.cullY = 0; app.sound.siren(); }
          },
          {
            dur: 3.6, from: [v3(-1.2, y8 + 3.0, 12.4), v3(-18, 0, 18)], to: [v3(-1.6, y8 + 3.1, 13.2), v3(VAN.x, 1, VAN.z)],
            sub: '中間——全是影。', enter: () => app.sound.siren()
          },
          {
            dur: 3.4, from: [v3(-3.2, y8 + 0.6, 14.6), v3(-0.6, y8 - 1.6, 12.2)], to: [v3(-2.9, y8 + 1.0, 14.2), v3(-0.4, y8 - 0.4, 12.2)],
            sub: '……它們聽到了。', enter: () => { g.showOutside = false; g.cullY = null; app.sound.growl(); climber(8.1, 0.6); }
          }
        ], (skipped) => {
          g.showOutside = false;
          g.cullY = null;
          if (skipped && !g.alive('climb')) climber(8.1, 0);
          climber(6.8, 1.2);
          climber(9.5, 2.6);
          climber(7.4, 5.5);
          rush('runner', 3.5);
          rush('runner', 4.5);
          rush('brute', 7.0);
          g.later(7.2, () => { g.flags.climbDone = true; });
          g.say('從陽台和大門兩邊都來了！', 3);
        });
      },
      done: (g) => g.flags.climbDone && g.alive('climb') === 0
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'stairs',
      chapter: '第二章　樓梯間',
      checkpoint: true,
      tags: ['stairs'],
      spawn: { pos: P(7.6, 11.9), yaw: Math.PI / 2, pitch: 0.25 },
      objective: (g) => `從樓梯間下樓：${g.floorLabel()} → 1F`,
      enter(g, { retry } = {}) {
        L.lift.target = 1;
        L.frontDoor.toggle(true);
        if (retry) g.later(0.8, () => g.say('一層一層殺下去。', 3));
        else g.later(0.05, () => introStairs(g));
        const S = (kind, u, w, f, dy, extra = {}) => g.spawn(kind, { ...xz(P(u, w, f)), y: floorY(f) + dy * KY, ...extra }, 'stairs');
        S('shade', 7.5, 12.6, 7, 0);
        S('shade', 11.1, 11.5, 6, 1.5);
        S('shade', 11.2, 12.6, 6, 1.5, { crouch: true });
        S('brute', 7.5, 12.1, 5, 0);
        S('runner', 9.6, 11.4, 4, 2.2);
        S('shade', 7.4, 12.7, 4, 0);
        S('shade', 11.1, 11.6, 3, 1.5, { crouch: true });
        S('shade', 11.2, 12.5, 3, 1.5);
        S('runner', 7.5, 11.6, 2, 0);
        S('runner', 7.6, 12.8, 2, 0);
        for (const f of [6, 3]) { const p = P(7.0, 11.3, f); g.addPickup(p.x, p.y, p.z, 30); }
      },
      done: () => app.enemies.player.zone === 'outside'
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'exit',
      chapter: '第二章　樓梯間',
      checkpoint: true,
      spawn: { pos: P(7.45, 12.0, 1), yaw: 0, pitch: 0.2 },
      objective: '衝出大樓',
      enter(g, { retry } = {}) {
        L.van.on = true;
        if (retry) g.say('外面就是廣場。', 3);
        else g.later(0.05, () => introOutside(g));
      },
      done: () => app.character.position.z > 13.7 * K
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'plaza',
      chapter: '最終章　樓外',
      tags: ['wave2'],
      objective: (g) => `殺出一條血路到救援車（剩 ${g.alive('crowd') + g.alive('wave2')}）`,
      enter(g) {
        L.van.on = true;
        g.later(0.6, () => g.say('救援車還在等！撐過去！', 3));
        g.flags.wave2 = false;
        for (const [x, z] of [[-6, 8], [-20, 26], [8, 38], [-30, 40], [-12, 50]]) g.addPickup(x, 0, z, 30);
      },
      update(g) {
        if (!g.flags.wave2 && g.alive('crowd') <= 4) {
          g.flags.wave2 = true;
          app.toast.show('更多的影從黑雨裡站起來了', 3000);
          const rise = (kind, x, z, d) => g.later(d, () => g.spawn(kind, { x, z, y: 0, spawn: 'rise' }, 'wave2'));
          rise('runner', -14, 30, 0.2);
          rise('runner', -6, 36, 0.8);
          rise('runner', -22, 34, 1.4);
          rise('brute', -12, 40, 2.0);
          rise('brute', 4, 44, 3.0);
          rise('shade', -26, 44, 3.4);
          g.later(3.6, () => { g.flags.wave2Ready = true; });
        }
      },
      done: (g) => g.flags.wave2Ready && g.alive('crowd') + g.alive('wave2') === 0
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'boss',
      chapter: '最終章　樓外',
      checkpoint: true,
      tags: ['boss'],
      spawn: { pos: new Vector3(-8, 0, 30), yaw: Math.PI * 0.85, pitch: 0.25 },
      objective: '擊倒黑潮之母',
      enter(g) {
        g.flags.phase2 = false;
        const B = new Vector3(-14, 0, 42);
        const spawnBoss = () => {
          const boss = g.spawn('boss', { x: B.x, z: B.z, y: 0, spawn: 'rise' }, 'boss');
          g.setBoss(boss);
          app.sound.roar();
          app.cam.shake(0.5);
          return boss;
        };
        if (g.flags.bossSeen) {
          spawnBoss();
          return;
        }
        g.flags.bossSeen = true;
        g.cinematic([
          {
            dur: 3.0, from: [v3(B.x + 10, 1.6, B.z - 10), v3(B.x, 1, B.z)], to: [v3(B.x + 8, 1.8, B.z - 8), v3(B.x, 2, B.z)],
            sub: '地面在震動……', enter: () => { app.cam.shake(0.3); app.sound.slam(); }
          },
          {
            dur: 4.2, from: [v3(B.x + 6, 0.8, B.z - 5), v3(B.x, 2.5, B.z)], to: [v3(B.x + 5, 0.6, B.z - 4), v3(B.x, 4.2, B.z)],
            sub: '<em>黑潮之母</em>——所有影的源頭。', subAt: 1.2, enter: () => spawnBoss()
          },
          {
            dur: 4.5,
            follow: (k) => {
              const p = app.character.position;
              return [v3(p.x + 3.5 - k, p.y + 2.6 + k * 0.6, p.z - 4.5), v3((p.x + B.x) / 2, 2.2, (p.z + B.z) / 2)];
            },
            subs: [[0.3, '黑雨是從它身上落下來的。'], [2.4, '殺了它——<em>天就會亮</em>。']]
          }
        ], (skipped) => {
          if (!g.boss) spawnBoss();
          g.boss.wake();
        });
      },
      onBossHit(g, boss) {
        if (!g.flags.phase2 && boss.hp < boss.maxHp * 0.5) {
          g.flags.phase2 = true;
          app.sound.roar();
          app.cam.shake(0.4);
          g.say('它在召喚更多的影！', 3);
          boss.type = { ...boss.type, windup: 0.7, cooldown: [0.8, 1.4], run: 4.2 };
          const p = app.character.position;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            g.later(i * 0.4, () => g.spawn('shade', { x: p.x + Math.cos(a) * 6, z: p.z + Math.sin(a) * 6, y: 0, spawn: 'rise' }, 'boss'));
          }
        }
      },
      done: (g) => g.boss && !g.boss.alive
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'dawn',
      chapter: '尾聲',
      objective: '天亮了。上救援車',
      enter(g) {
        g.startDawn();
        L.van.on = true;
        g.later(1.5, () => {
          for (const e of app.enemies.enemies) if (e.alive) e.retire();
          g.say('天……亮了。影在光裡燒成了灰。', 4);
        });
        const it = g.addInteract({
          pos: new Vector3(VAN.x + 1.4, 0, VAN.z - 1.2), r: 2.6, prompt: '上救援車',
          onUse: (g) => {
            g.removeInteract(it);
            ending(g);
          }
        });
      },
      done: () => false
    }
  ];
  return steps;

  /* ------------------------------------------------------------------ */

  function xz(v) {
    return { x: v.x, z: v.z };
  }

  /** Grandfather's katana: a short close-up while the blade catches fire. */
  function swordScene(g) {
    const p = app.character.position;
    const f = app.character.facing;
    const fx = Math.sin(f), fz = Math.cos(f);
    g.cinematic([
      {
        dur: 2.6,
        clamp: true,
        follow: (k) => [
          v3(p.x + fx * 1.6 - fz * 0.8 * (1 - k), p.y + 1.5, p.z + fz * 1.6 + fx * 0.8 * (1 - k)),
          v3(p.x, p.y + 1.25, p.z)
        ],
        sub: '爺爺的刀。握住的瞬間，刀身燒了起來。'
      }
    ], () => {
      app.toast.show(app.isTouch ? '取得「爺爺的刀」：「斬」攻擊　·　「滑」滑斬突進　·　連按可以連段' : '取得「爺爺的刀」：左鍵 / R 斬　·　Q 滑斬突進　·　連按可以連段', 6000);
    }, { letterbox: true });
  }

  /** The opening: the city, the rain, the tower, the lift. */
  function prologue(g) {
    const p = app.character.position.clone();
    const walker = g.lobbyWalker;
    const walkFrom = P(8.4, 11.3);
    const walkTo = P(7.3, 13.0);
    const this1 = {};
    g.ui.hud(false);
    g.cinematic([
      {
        dur: 5.2, from: [v3(-36, 52, -22), v3(8, 6, 14)],
        enter: () => { g.ui.fade(true); L.carDisplay.userData.draw('1'); },
        tick: (k) => {
          if (k > 0.08 && !this1.a) { this1.a = 1; g.ui.subtitle('2026 年 10 月 4 日，深夜。'); }
          if (k > 0.5 && !this1.b) { this1.b = 1; g.ui.subtitle('城市下了一場<em>黑色的雨</em>。'); }
        }
      },
      {
        dur: 8, from: [v3(-36, 52, -22), v3(8, 6, 14)], to: [v3(-34, 34, 54), v3(2, 6, 20)], ease: 'linear',
        enter: () => { g.ui.fade(false); g.showOutside = true; g.cullY = 0; },
        sub: '淋到黑雨的人，變成了「影」。', subAt: 1
      },
      {
        dur: 7.5, from: [v3(-31, 2.0, 27), v3(-12, 1.0, 12)], to: [v3(-23, 2.6, 21), v3(-11, 1.3, 8)], ease: 'linear',
        tick: (k) => {
          if (k > 0.06 && !this1.c) { this1.c = 1; g.ui.subtitle('沒有臉，只剩下餘燼一樣的輪廓。'); }
          if (k > 0.52 && !this1.d) { this1.d = 1; g.ui.subtitle('它們會被光、被聲音……被<em>「家」</em>吸引。'); }
        }
      },
      {
        dur: 6, from: [v3(-28, 5, 11), v3(0, 12, 12)], to: [v3(-11, 29.5, 13), v3(1, y8 + 1.2, 12)],
        sub: '我家在 8 樓。', subAt: 1.2,
        exit: () => { g.showOutside = false; g.cullY = null; }
      },
      {
        dur: 8.5,
        from: [v3(p.x + 0.85, y8 + 2.0, p.z + 1.05), v3(p.x, y8 + 1.35, p.z)],
        to: [v3(p.x + 0.8, y8 + 1.7, p.z - 1.0), v3(p.x, y8 + 1.45, p.z)],
        enter: () => { app.sound.hum(8.5); if (liftLight) { liftLight.intensity = liftLightBase; liftLight.flicker = 0; } emergency.intensity = 0; },
        tick: (k) => {
          const n = String(Math.min(8, 1 + Math.floor(k * 8.6)));
          if (n !== this1.floor) { this1.floor = n; L.carDisplay.userData.draw(n); if (n !== '1') app.sound.tone(880, 0.08, { vol: 0.03 }); }
          if (k > 0.05 && !this1.e) { this1.e = 1; g.ui.subtitle('我一直在逃。逃了一整夜。'); }
          if (k > 0.55 && !this1.f) { this1.f = 1; g.ui.subtitle('現在，我只想<em>回家</em>。'); }
        }
      },
      {
        dur: 4.2, from: [v3(p.x - 0.55, y8 + 1.65, p.z + 0.45), v3(p.x + 1.3, y8 + 1.25, p.z)], to: [v3(p.x - 0.5, y8 + 1.6, p.z + 0.4), v3(p.x + 1.3, y8 + 1.3, p.z - 0.1)],
        enter: () => {
          app.sound.powerDown();
          app.cam.shake(0.15);
          if (liftLight) { liftLight.intensity = liftLightBase * 0.5; liftLight.flicker = 0.9; }
          emergency.intensity = 3.5;
          L.carDisplay.userData.draw('8');
        },
        sub: '——停電了。電梯卡在 8 樓。', subAt: 0.5
      },
      {
        dur: 5.2, from: [v3(9.55, y8 + 1.55, 17.95), v3(11.8, y8 + 1.35, 18.2)], to: [v3(9.6, y8 + 1.5, 17.85), v3(11.4, y8 + 1.3, 19.2)],
        enter: () => {
          if (walker?.alive) { walker.position.set(walkFrom.x, y8, walkFrom.z); walker.ai = 'scripted'; walker.scriptTo = walkTo; }
          app.sound.growl();
        },
        sub: '……門外，有東西在走動。', subAt: 1.2,
        exit: () => {
          if (walker?.alive) { walker.ai = 'dormant'; walker.scriptTo = null; walker.position.set(walkTo.x, y8, walkTo.z); }
        }
      },
      {
        dur: 5.2, from: [v3(p.x - 0.5, y8 + 1.6, p.z + 0.4), v3(p.x + 1.3, y8 + 1.3, p.z)],
        enter: () => { g.ui.fade(true); g.ui.titleCard(true); app.sound.sting(); g.ui.subtitle(''); },
        exit: () => { g.ui.titleCard(false); g.ui.fade(false); }
      }
    ], () => {
      g.ui.titleCard(false);
      g.ui.fade(false);
      g.showOutside = false;
      g.cullY = null;
      if (walker?.alive) { walker.ai = 'dormant'; walker.scriptTo = null; }
      L.carDisplay.userData.draw('8');
      if (liftLight) { liftLight.intensity = liftLightBase * 0.5; liftLight.flicker = 0.9; }
      emergency.intensity = 3.5;
      g.placePlayer(steps[0].spawn);
      g.say('電梯停在 8 樓，門卡住了。', 3);
    });
  }

  /** Into the van, up into the morning. */
  function ending(g) {
    const v = new Vector3(VAN.x, 0, VAN.z);
    const van = L.van.group;
    const vanStart = van.position.clone();
    g.hidePlayer = true;
    g.cinematic([
      {
        dur: 4.5, from: [v3(v.x + 6, 2, v.z - 8), v3(v.x, 1.4, v.z)], to: [v3(v.x + 5, 2.4, v.z - 6), v3(v.x, 1.6, v.z)],
        subs: [[0.3, '車門打開。'], [1.8, '「……你回來了。」媽的聲音在發抖。']]
      },
      {
        dur: 5.5, from: [v3(-14, 1.4, 22), v3(0.5, y8 + 1.6, 12)], to: [v3(-12, 1.6, 20), v3(0.5, y8 + 1.2, 12)],
        subs: [[0.4, '回頭看，8 樓的陽台被晨光照亮了。'], [3.0, '晾著的衣服，還在風裡晃。']]
      },
      {
        dur: 6.5, from: [v3(v.x - 9, 2.2, v.z - 10), v3(v.x, 1.2, v.z + 2)], to: [v3(v.x - 7, 2.6, v.z - 4), v3(v.x, 1.2, v.z + 14)],
        enter: () => app.sound.siren(),
        tick: (k) => { van.position.z = vanStart.z + k * k * 22; },
        subs: [[0.6, '救援車駛出廣場。'], [3.2, '家，不只是一間房子。']]
      },
      {
        dur: 7.5, from: [v3(v.x - 4, 4, v.z - 6), v3(v.x, 2, v.z + 10)], to: [v3(5, 52, -12), v3(8, 12, 14)],
        tick: (k) => { van.position.z = vanStart.z + 22 + k * 30; },
        subs: [[0.8, '是值得你<em>殺出一條血路</em>，'], [3.6, '也一定要回去的地方。']]
      },
      {
        dur: 3, from: [v3(5, 52, -12), v3(8, 12, 14)], to: [v3(4, 56, -16), v3(8, 14, 14)],
        enter: () => g.ui.fade(true, true)
      }
    ], () => {
      g.mode = 'ending';
      g.hidePlayer = false;
      van.position.copy(vanStart);
      app.cam.unlock();
      g.ui.fade(false, true);
      g.ui.hud(false);
      g.ui.ending(true, g.stats);
      try { localStorage.removeItem('nimh.save.v1'); } catch { /* ignore */ }
    }, { skippable: true });
  }

  /** 序章 → 第一章: the front door opens on a home that is not empty. */
  function introHome(g) {
    const p = app.character.position.clone();
    const lr = P(8.0, 8.4);
    const glow = P(4.25, 4.7, HOME_FLOOR, 1.05);
    const homeLights = L.lights.filter((a) => a.zone === 'home');
    const base = homeLights.map((a) => a.flicker);
    g.cinematic([
      {
        dur: 4.2, from: [v3(p.x + 0.5, y8 + 1.9, p.z + 1.9), v3(p.x - 0.2, y8 + 1.4, p.z - 2.5)], to: [v3(p.x + 0.3, y8 + 1.8, p.z + 1.2), v3(p.x - 0.3, y8 + 1.3, p.z - 3)],
        enter: () => { app.sound.door(); app.sound.metal(); },
        subs: [[0.4, '鐵門上全是抓痕。'], [2.2, '……門，沒有鎖。']]
      },
      {
        dur: 6, from: [v3(10.9, y8 + 1.7, 16.2), v3(lr.x, y8 + 0.9, lr.z)], to: [v3(11.3, y8 + 1.6, 14.8), v3(lr.x, y8 + 0.7, lr.z)],
        enter: () => { for (const a of homeLights) a.flicker = Math.max(a.flicker, 0.7); },
        subs: [[0.5, '這是我長大的地方。'], [3.0, '……現在，<em>它們在我家</em>。']]
      },
      {
        dur: 4.2, from: [v3(lr.x + 1.8, y8 + 1.1, lr.z + 1.5), v3(lr.x, y8 + 0.6, lr.z)], to: [v3(lr.x + 1.3, y8 + 0.9, lr.z + 1.1), v3(lr.x, y8 + 0.7, lr.z)],
        enter: () => app.sound.growl(),
        subs: [[1.2, '它蹲在客廳的地上，像在吃什麼東西。']]
      },
      {
        dur: 5, from: [v3(8.6, y8 + 1.9, 9.8), v3(glow.x, glow.y, glow.z)], to: [v3(8.0, y8 + 1.7, 8.8), v3(glow.x, glow.y, glow.z)],
        subs: [[0.4, '主臥室的衣櫃縫裡，有光。'], [2.6, '爺爺的刀……還在那裡。']]
      }
    ], () => {
      homeLights.forEach((a, i) => { a.flicker = base[i]; });
      g.chapter('第一章', '我　家');
    });
  }

  /** 第一章 → 第二章: the quiet after, and the long way down. */
  function introStairs(g) {
    const y6 = floorY(6);
    g.cinematic([
      {
        dur: 5.5, from: [v3(11.2, y8 + 1.6, 13.8), v3(12.5, y8 + 2.0, 9.9)], to: [v3(14.2, y8 + 1.6, 13.4), v3(12.5, y8 + 2.0, 9.9)], ease: 'linear',
        enter: () => { g.cullY = y8; },
        subs: [[0.4, '家裡終於安靜了。'], [2.8, '爸爸最喜歡的八駿圖，還好好地掛在牆上。']]
      },
      {
        dur: 4.5, from: [v3(-1.0, y8 + 3.0, 12.0), v3(-16, 0, 16)], to: [v3(-1.6, y8 + 3.2, 13.0), v3(-22, 0, 26)],
        enter: () => { g.showOutside = true; },
        subs: [[0.5, '樓下的廣場，媽她們在等我。']]
      },
      {
        dur: 5.5, from: [v3(12.0, y8 + 2.8, 17.2), v3(16.4, y8 - 2.2, 18.0)], to: [v3(12.6, y8 + 2.2, 17.1), v3(16.6, y8 - 3.2, 18.2)],
        enter: () => { g.showOutside = false; g.cullY = y8 - 3; },
        subs: [[0.4, '電梯沒電。只能走樓梯。'], [2.8, '八層樓，一層一層往下。']]
      },
      {
        dur: 5, from: [v3(13.6, y6 + 1.9, 19.1), v3(16.7, y6 + 2.1, 17.9)], to: [v3(14.1, y6 + 2.0, 19.0), v3(16.7, y6 + 2.3, 17.9)],
        enter: () => { g.cullY = y6 + 1; app.sound.growl(); },
        subs: [[0.6, '每一層，<em>都有東西在等我</em>。']]
      }
    ], () => {
      g.cullY = null;
      g.showOutside = false;
      g.chapter('第二章', '樓 梯 間');
    });
  }

  /** 第二章 → 最終章: out through the broken glass, into all of them. */
  function introOutside(g) {
    const y1 = floorY(1);
    g.cinematic([
      {
        dur: 4.2, from: [v3(11.7, y1 + 1.6, 16.6), v3(11.2, y1 + 1.1, 21.5)], to: [v3(11.5, y1 + 1.4, 17.3), v3(11.2, y1 + 1.0, 22.5)],
        subs: [[0.4, '1 樓。大門的玻璃碎了一地。']]
      },
      {
        dur: 5.5, from: [v3(11.4, 3.3, 22.4), v3(-6, 1, 28)], to: [v3(9.2, 3.8, 23.4), v3(-14, 1, 36)],
        enter: () => { g.showOutside = true; },
        subs: [[0.5, '外面是廣場——還有全部的影。']]
      },
      {
        dur: 4.5, from: [v3(-4, 2.2, 34), v3(VAN.x, 1.4, VAN.z)], to: [v3(-6, 2.0, 37), v3(VAN.x, 1.6, VAN.z)],
        enter: () => app.sound.siren(),
        subs: [[0.4, '救援車的警示燈還在閃。'], [2.4, '她們還在等。']]
      },
      {
        dur: 4.5, from: [v3(-11, 0.9, 17.5), v3(-14, 1.3, 10)], to: [v3(-11.5, 1.0, 16.8), v3(-14, 1.5, 10)],
        enter: () => { app.sound.growl(); app.cam.shake(0.08); },
        subs: [[0.6, '只剩最後一段路。']]
      }
    ], () => {
      g.showOutside = false;
      g.chapter('最終章', '樓　外');
    });
  }
}

/** The chapters the title screen can start from, in order. `step` is where play begins. */
export const CHAPTERS = [
  { id: 'prologue', step: 'lift', small: '序章', title: '電梯', desc: '停電的電梯停在 8 樓。門外有東西在走動。' },
  { id: 'home', step: 'sword', small: '第一章', title: '我家', desc: '家裡被闖進來了。爺爺的刀還在衣櫃裡。' },
  { id: 'stairs', step: 'stairs', small: '第二章', title: '樓梯間', desc: '沒有電梯。八層樓，一層一層殺下去。' },
  { id: 'outside', step: 'exit', small: '最終章', title: '樓外', desc: '廣場另一頭，救援車的燈還亮著。' },
  { id: 'boss', step: 'boss', small: '決戰', title: '黑潮之母', desc: '所有影的源頭。殺了它，天就會亮。' }
];
