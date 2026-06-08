/**
 * Maps the current playhead to the keyframe percentage used when a drag commit
 * writes a keyframe. Keyframes live on the TWEEN, so the playhead must be
 * measured against the tween's own start/duration — measuring against the clip
 * is wrong (child elements usually have no data-start/duration, so that calc
 * defaulted and saturated, dropping keyframes at the wrong percentage: the
 * few-pixel "snap" and junk-keyframe accumulation on repeated drags).
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

// anim.position is the tween's absolute start on the timeline; returns null
// when the tween timing isn't statically resolvable.
function tweenRelativePercentage(
  anim: GsapAnimation | undefined,
  currentTime: number,
): number | null {
  const start = typeof anim?.position === "number" ? anim.position : Number.NaN;
  const duration = anim?.duration ?? Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
  return clampPercentage(((currentTime - start) / duration) * 100);
}

function clipRelativePercentage(selection: DomEditSelection, currentTime: number): number {
  const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
  return elDuration > 0 ? clampPercentage(((currentTime - elStart) / elDuration) * 100) : 0;
}

export function computeCurrentPercentage(
  selection: DomEditSelection,
  anim?: GsapAnimation,
): number {
  const currentTime = usePlayerStore.getState().currentTime;
  return (
    tweenRelativePercentage(anim, currentTime) ?? clipRelativePercentage(selection, currentTime)
  );
}
