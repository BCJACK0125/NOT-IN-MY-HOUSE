/**
 * The four kinds of 影 (shades). Everything that differs between them is here.
 *
 *  hp        hits to fell: kick 1, slash 2, slide cut 3, specials more
 *  scale     × the base 1.78 m body
 *  walk/run  m/s
 *  range     how close it gets before it swings
 *  windup    seconds of glowing tell before the swing starts — the player's window
 *  attacks   clip names (retargeted from the player's own moves) with damage,
 *            the clip phase the blow lands at, reach and recover point
 *  poise     hits it takes before it flinches is 1/poise (1 = always flinches)
 */
export const ENEMY_TYPES = {
  shade: {
    name: '影',
    hp: 3,
    scale: 1.0,
    walk: 1.4,
    run: 3.3,
    turn: 9,
    range: 1.7,
    windup: 0.45,
    cooldown: [1.1, 2.0],
    attacks: [
      { clip: 'slashHit', damage: 11, hitAt: 0.38, reach: 2.0, recoverAt: 0.72, timeScale: 1.0, lunge: 1.2 },
      { clip: 'kick', damage: 9, hitAt: 0.42, reach: 1.9, recoverAt: 0.74, timeScale: 1.0, lunge: 0.8 }
    ],
    poise: 1,
    look: { color: '#191c24', rimColor: '#ff5a1e', rimEmissive: 1.5 },
    drop: 0.18,
    score: 100
  },
  runner: {
    name: '疾影',
    hp: 2,
    scale: 0.92,
    walk: 2.2,
    run: 5.2,
    turn: 14,
    range: 1.6,
    windup: 0.32,
    cooldown: [0.8, 1.5],
    attacks: [
      { clip: 'crouchSlash', damage: 9, hitAt: 0.62, reach: 2.2, recoverAt: 0.84, timeScale: 1.35, lunge: 2.2 },
      { clip: 'kick', damage: 7, hitAt: 0.42, reach: 1.8, recoverAt: 0.72, timeScale: 1.25, lunge: 0.8 }
    ],
    poise: 1,
    look: { color: '#1d1214', rimColor: '#ff2a3a', rimEmissive: 2.2 },
    drop: 0.15,
    score: 120
  },
  brute: {
    name: '巨影',
    hp: 9,
    scale: 1.32,
    walk: 1.2,
    run: 2.5,
    turn: 6,
    range: 2.3,
    windup: 0.8,
    cooldown: [1.6, 2.6],
    attacks: [
      { clip: 'jumpHit', damage: 24, hitAt: 0.5, reach: 2.8, recoverAt: 0.85, timeScale: 0.95, lunge: 1.6, aoe: 2.6 },
      { clip: 'slashHit', damage: 18, hitAt: 0.38, reach: 2.6, recoverAt: 0.75, timeScale: 0.85, lunge: 1.0 }
    ],
    poise: 0.34,
    look: { color: '#14121c', rimColor: '#b45cff', rimEmissive: 2.0 },
    drop: 0.6,
    score: 400
  },
  boss: {
    name: '黑潮之母',
    hp: 46,
    scale: 2.25,
    walk: 1.5,
    run: 3.4,
    turn: 4.5,
    range: 3.6,
    windup: 0.95,
    cooldown: [1.2, 2.0],
    attacks: [
      { clip: 'jumpHit', damage: 30, hitAt: 0.5, reach: 4.6, recoverAt: 0.86, timeScale: 0.8, lunge: 2.4, aoe: 4.2 },
      { clip: 'slashHit', damage: 22, hitAt: 0.38, reach: 4.2, recoverAt: 0.74, timeScale: 0.75, lunge: 1.4 },
      { clip: 'kick', damage: 18, hitAt: 0.42, reach: 3.8, recoverAt: 0.74, timeScale: 0.8, lunge: 1.0 }
    ],
    poise: 0.12,
    look: { color: '#0b0a10', rimColor: '#ff3b1a', rimEmissive: 3.0 },
    drop: 1,
    score: 5000,
    boss: true
  }
};
