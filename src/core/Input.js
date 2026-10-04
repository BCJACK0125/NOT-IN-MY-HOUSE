import { ATTACK_ABILITIES } from '../config/abilities.js';

const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right'
};

const ATTACK_KEYS = {};
for (const ability of ATTACK_ABILITIES) for (const code of [ability.code, ...(ability.alt ?? [])]) ATTACK_KEYS[code] = ability.id;

/**
 * Keyboard, mouse buttons and the on-screen touch pad, reduced to a stick, a
 * run flag and one-shot presses (attacks, dodge, use).
 */
export class Input {
  constructor(target = window, canvas = null) {
    this.target = target;
    this.canvas = canvas;
    this.pressed = new Set();
    this.axis = { x: 0, y: 0 };
    this.running = false;
    this.enabled = true;
    /** touch stick, -1..1 (y up = forward) */
    this.stick = { x: 0, y: 0, run: false };
    /** while true, a left click marks a body instead of swinging */
    this.marking = () => false;
    this._dodge = false;
    this._use = false;
    this._attacks = {};

    this._onKeyDown = (event) => {
      if (this._isTyping(event.target)) return;
      if (MOVE_KEYS[event.code] || event.code === 'Space') event.preventDefault();
      if (!this.enabled) return;
      if (event.code === 'Space' && !event.repeat) this._dodge = true;
      if (event.code === 'KeyF' && !event.repeat) this._use = true;
      const attack = ATTACK_KEYS[event.code];
      if (attack && !event.repeat) this._attacks[attack] = true;
      this.pressed.add(event.code);
    };
    this._onKeyUp = (event) => this.pressed.delete(event.code);
    this._onBlur = () => {
      this.pressed.clear();
      this._dodge = false;
      this._attacks = {};
    };
    this._onMouseDown = (event) => {
      if (!this.enabled || !document.pointerLockElement) return;
      if (event.button === 0 && !this.marking()) this._attacks[ATTACK_KEYS.Mouse0] = true;
      if (event.button === 2) this._attacks[ATTACK_KEYS.Mouse2] = true;
    };
    this._onContext = (event) => event.preventDefault();
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    target.addEventListener('mousedown', this._onMouseDown);
    target.addEventListener('contextmenu', this._onContext);
  }

  _isTyping(node) {
    return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
  }

  /** For the touch buttons. */
  press(id) {
    if (!this.enabled) return;
    if (id === 'dodge') this._dodge = true;
    else if (id === 'use') this._use = true;
    else this._attacks[id] = true;
  }

  sample() {
    const held = this.pressed;
    let x = 0;
    let y = 0;
    if (this.enabled) {
      for (const [code, direction] of Object.entries(MOVE_KEYS)) {
        if (!held.has(code)) continue;
        if (direction === 'forward') y += 1;
        else if (direction === 'back') y -= 1;
        else if (direction === 'right') x += 1;
        else x -= 1;
      }
      x += this.stick.x;
      y += this.stick.y;
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.axis.x = x;
    this.axis.y = y;
    this.running = this.enabled && (held.has('ShiftLeft') || held.has('ShiftRight') || this.stick.run);
    return this.axis;
  }

  /** Space used to jump; here it dodges, and the jump is never asked for. */
  consumeJump() {
    return false;
  }

  consumeDodge() {
    const pressed = this._dodge;
    this._dodge = false;
    return pressed;
  }

  consumeUse() {
    const pressed = this._use;
    this._use = false;
    return pressed;
  }

  consumeAttack(id) {
    const pressed = this._attacks[id] === true;
    this._attacks[id] = false;
    return pressed;
  }

  clear() {
    this.pressed.clear();
    this._dodge = false;
    this._use = false;
    this._attacks = {};
    this.stick.x = this.stick.y = 0;
  }

  get moving() {
    return this.axis.x !== 0 || this.axis.y !== 0;
  }

  dispose() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('blur', this._onBlur);
    this.target.removeEventListener('mousedown', this._onMouseDown);
    this.target.removeEventListener('contextmenu', this._onContext);
    this.pressed.clear();
  }
}
