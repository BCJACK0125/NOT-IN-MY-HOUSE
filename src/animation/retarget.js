import { AnimationClip, PropertyBinding } from 'three';

/**
 * Lift a skeleton-only clip onto another Mixamo rig — the enemies' — the same
 * way `CharacterController#_retarget` does it for the player: drop tracks for
 * joints the rig lacks, bring translations into the rig's units, and freeze
 * the hips' horizontal travel so the controller owns where the body is.
 *
 * @param {import('three').AnimationClip} clip
 * @param {Map<string, import('three').Bone>} bones raw + namespace-stripped names
 * @param {string} name
 */
export function retargetClip(clip, bones, name) {
  if (!clip) return null;
  const hips = bones.get('Hips');
  const hipsName = hips?.name ?? null;

  // Units, off bone lengths below the hips (median of the ratios).
  const ratios = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position') || track.values.length < 3) continue;
    const node = PropertyBinding.parseTrackName(track.name).nodeName;
    if (node === hipsName) continue;
    const bone = bones.get(node);
    if (!bone) continue;
    const a = Math.hypot(track.values[0], track.values[1], track.values[2]);
    const b = bone.position.length();
    if (a > 1e-6 && b > 1e-6) ratios.push(b / a);
  }
  ratios.sort((a, b) => a - b);
  const r = ratios.length ? ratios[ratios.length >> 1] : 1;
  const unit = r > 0.5 && r < 2 ? 1 : r;

  const tracks = [];
  for (const original of clip.tracks) {
    const node = PropertyBinding.parseTrackName(original.name).nodeName;
    if (!bones.has(node)) continue;
    const track = original.clone();
    if (track.name.endsWith('.position')) {
      const v = track.values;
      if (unit !== 1) for (let i = 0; i < v.length; i++) v[i] *= unit;
      if (node === hipsName) {
        const x = hips.position.x;
        const z = hips.position.z;
        for (let i = 0; i < v.length; i += 3) { v[i] = x; v[i + 2] = z; }
      }
    }
    tracks.push(track);
  }
  return tracks.length ? new AnimationClip(name, clip.duration, tracks) : null;
}

/** Index a rig's bones under raw and namespace-stripped names. */
export function indexBones(root) {
  const bones = new Map();
  root.traverse((node) => {
    if (!node.isBone) return;
    bones.set(node.name, node);
    const short = node.name.split(':').pop().replace(/^mixamorig/i, '');
    if (short && !bones.has(short)) bones.set(short, node);
  });
  return bones;
}
