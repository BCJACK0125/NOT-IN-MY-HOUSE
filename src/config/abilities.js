/**
 * Every move the player has, one line each. `Input` builds its key map from
 * this, and the action bar along the bottom draws one panel per entry.
 */
export const CATEGORIES = {
  movement: { id: 'movement', label: '移動', kanji: '歩', row: 'top' },
  technique: { id: 'technique', label: '招式', kanji: '技', row: 'main' },
  ability: { id: 'ability', label: '奧義', kanji: '術', row: 'main' }
};

export const ABILITIES = [
  {
    id: 'leap',
    category: 'movement',
    label: '閃避',
    hotkey: 'Space',
    code: 'Space',
    note: '短距離衝刺，期間無敵。在敵人出手的瞬間閃開會觸發「見切」慢動作。'
  },
  {
    id: 'kick',
    category: 'technique',
    label: '踢',
    hotkey: 'E / 右鍵',
    code: 'KeyE',
    alt: ['Mouse2'],
    note: '踏步上前一腳踢飛。不需要刀也能用。',
    attack: true
  },
  {
    id: 'slashHit',
    category: 'technique',
    label: '斬',
    hotkey: 'R / 左鍵',
    code: 'KeyR',
    alt: ['Mouse0'],
    note: '踏步橫斬，範圍內全部砍到。需要爺爺的刀。',
    attack: true
  },
  {
    id: 'crouchSlash',
    category: 'technique',
    label: '滑斬',
    hotkey: 'Q',
    code: 'KeyQ',
    alt: ['KeyT'],
    note: '遠距離滑步貫穿斬，用來突進。需要刀。',
    attack: true
  },
  {
    id: 'shadows',
    category: 'ability',
    label: '影分身',
    hotkey: 'V',
    code: 'KeyV',
    note: '消耗 60 氣：看著兩個敵人點左鍵標記，兩個影子會替你出手。'
  },
  {
    id: 'judgement',
    category: 'ability',
    label: '天罰',
    hotkey: 'C',
    code: 'KeyC',
    note: '消耗 40 氣：標記一個敵人，巨拳從封印中砸下。'
  },
  {
    id: 'flight',
    category: 'ability',
    label: '萬劍',
    hotkey: 'X',
    code: 'KeyX',
    note: '消耗 100 氣，只能在戶外：騰空，點選敵人鍛出飛劍，Space 齊射。'
  }
];

export const ATTACK_ABILITIES = ABILITIES.filter((ability) => ability.attack);
