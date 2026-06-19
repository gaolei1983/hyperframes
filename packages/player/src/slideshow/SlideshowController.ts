import type { ResolvedSlideshow, ResolvedSlide } from "@hyperframes/core/slideshow";

export interface PlayerPort {
  seek(t: number): void;
  play(): void;
  pause(): void;
  readonly currentTime: number;
  onTimeUpdate(cb: (t: number) => void): () => void;
}

interface StackFrame {
  sequenceId: string;
  slideIndex: number;
  fragmentIndex: number; // -1 = before first fragment / at slide start
}

const MAIN = "main";
const EPS = 0.001;

export class SlideshowController {
  private stack: StackFrame[] = [{ sequenceId: MAIN, slideIndex: 0, fragmentIndex: -1 }];
  private holdAt: number | null = null;
  // The logical hold (a fragment time / slide point). playTo() plays a short way
  // PAST it (to holdAt) so the composition repaints; holdTarget is what onTime
  // matches against fragments to advance fragmentIndex.
  private holdTarget: number | null = null;
  private changeCbs = new Set<() => void>();
  private unsub: () => void;

  constructor(
    private player: PlayerPort,
    private show: ResolvedSlideshow,
  ) {
    this.unsub = player.onTimeUpdate((t) => this.onTime(t));
    this.enterSlide(0);
  }

  // fallow-ignore-next-line unused-class-member
  dispose(): void {
    this.unsub();
  }

  private slidesOf(sequenceId: string): ResolvedSlide[] {
    if (sequenceId === MAIN) return this.show.slides;
    return this.show.sequences[sequenceId]?.slides ?? [];
  }

  private get frame(): StackFrame {
    return this.stack[this.stack.length - 1];
  }

  get currentSlide(): ResolvedSlide | undefined {
    return this.slidesOf(this.frame.sequenceId)[this.frame.slideIndex];
  }

  get nextSlide(): ResolvedSlide | null {
    const slides = this.slidesOf(this.frame.sequenceId);
    const next = slides[this.frame.slideIndex + 1];
    return next ?? null;
  }

  get position(): { sequenceId: string; slideIndex: number; fragmentIndex: number } {
    return { ...this.frame };
  }

  get counter(): { index: number; total: number } {
    return {
      index: this.frame.slideIndex + 1,
      total: this.slidesOf(this.frame.sequenceId).length,
    };
  }

  get canPrev(): boolean {
    // prev has a destination: an earlier slide in this sequence, OR (in a branch) the parent.
    return this.frame.slideIndex > 0 || this.stack.length > 1;
  }

  get canNext(): boolean {
    // next has a destination: a later slide in this sequence, OR (in a branch) the parent.
    const slides = this.slidesOf(this.frame.sequenceId);
    return this.frame.slideIndex + 1 < slides.length || this.stack.length > 1;
  }

  get breadcrumb(): { id: string; label: string }[] {
    return this.stack.map((f) =>
      f.sequenceId === MAIN
        ? { id: MAIN, label: "Main deck" }
        : { id: f.sequenceId, label: this.show.sequences[f.sequenceId]?.label ?? f.sequenceId },
    );
  }

  // fallow-ignore-next-line unused-class-member
  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeCbs) cb();
  }

  private enterSlide(index: number): void {
    this.frame.slideIndex = index;
    this.frame.fragmentIndex = -1;
    this.holdAt = null;
    const slide = this.currentSlide;
    if (!slide) return;
    // Jump to the slide's first hold and stay there (no auto-progress). With
    // fragments that's the first fragment; without, a settled frame INSIDE the
    // slide (its midpoint) — NOT slide.end, which is the boundary where the next
    // scene begins (else slide 1 would render slide 2's content).
    const firstHold =
      slide.fragments.length > 0 ? (slide.fragments[0] ?? slide.end) : this.restFrame(slide);
    this.playTo(firstHold);
    this.emitChange();
  }

  /** A representative, non-boundary frame for a slide with no fragments. */
  private restFrame(slide: ResolvedSlide): number {
    return slide.start + (slide.end - slide.start) * 0.5;
  }

  /**
   * Resumes a slide at a saved fragmentIndex without resetting to slide start.
   * Used by back()/backToMain()/syncTo() to restore an exact position.
   */
  private resumeSlide(index: number, fragmentIndex: number): void {
    this.frame.slideIndex = index;
    this.frame.fragmentIndex = fragmentIndex;
    const slide = this.currentSlide;
    if (!slide) return;
    // Resume position, mirroring enterSlide so going back to a slide lands where
    // entering it forward does:
    //   - at a saved fragment   → that fragment's hold time
    //   - fragmented, pre-first → slide.start (before the first reveal)
    //   - no fragments          → restFrame (midpoint), NOT slide.start, so the
    //     slide is visible at rest instead of frozen at its frame-0 (pre-entrance).
    const seekTime =
      fragmentIndex >= 0 && fragmentIndex < slide.fragments.length
        ? (slide.fragments[fragmentIndex] ?? slide.start)
        : slide.fragments.length > 0
          ? slide.start
          : this.restFrame(slide);
    this.holdAt = null;
    this.playTo(seekTime);
    this.emitChange();
  }

  private nextStop(slide: ResolvedSlide, fragmentIndex: number): number {
    const next = slide.fragments[fragmentIndex + 1];
    return next ?? slide.end;
  }

  /**
   * Jump to hold time `t` and hold there — deterministically, with NO sustained
   * playback so a slide can never auto-progress.
   *
   * Seek to the EXACT target (so the first repainted frame is the correct one —
   * seeking before it would flash a pre-target frame / the previous scene), then
   * play and pause on the VERY FIRST timeupdate at-or-after `t`. A bare paused
   * seek doesn't repaint some compositions, so one frame of playback is needed to
   * force a paint — and `timeupdate` only fires from the playback clock (never on
   * seek), so the first tick is guaranteed to be a painted frame. Bounding the
   * hold to that single tick (rather than a fixed time window) means a missed or
   * coarse timeupdate can't overrun the hold into the next fragment or scene.
   * This is the determinism fix for the auto-progress flakiness.
   */
  private playTo(t: number): void {
    this.holdTarget = t;
    this.holdAt = t; // pause on the first tick at/after the exact target
    this.player.seek(t);
    this.player.play();
  }

  private onTime(tt: number): void {
    if (this.holdAt === null) return;
    // First timeupdate at/after the seeked target → one frame has painted; pause.
    if (tt < this.holdAt - EPS) return;
    const target = this.holdTarget;
    this.holdAt = null;
    this.holdTarget = null;
    // Pause FIRST so playback stops on this tick, before any change handlers run —
    // leaving no window for a second timeupdate to advance the playhead.
    this.player.pause();
    // Advance fragmentIndex if the logical target is a fragment boundary.
    const slide = this.currentSlide;
    if (slide && target !== null) {
      const fragIdx = slide.fragments.indexOf(target);
      if (fragIdx !== -1) {
        this.frame.fragmentIndex = fragIdx;
        this.emitChange();
      }
    }
  }

  next(): void {
    const slide = this.currentSlide;
    if (!slide) return;
    const hasMoreFragments = this.frame.fragmentIndex + 1 < slide.fragments.length;
    if (hasMoreFragments) {
      // Reveal the next fragment. onTime() advances fragmentIndex at the hold.
      const nextTarget = this.nextStop(slide, this.frame.fragmentIndex);
      this.playTo(nextTarget);
      this.emitChange();
      return;
    }
    // No more fragments to reveal — advance to the next slide immediately instead of
    // playing the current slide out to its end.
    const slides = this.slidesOf(this.frame.sequenceId);
    if (this.frame.slideIndex + 1 < slides.length) {
      this.enterSlide(this.frame.slideIndex + 1);
    } else if (this.stack.length > 1) {
      // End of a branch → return to the parent timeline.
      this.back();
    }
  }

  prev(): void {
    if (this.frame.slideIndex > 0) {
      this.enterSlide(this.frame.slideIndex - 1);
      return;
    }
    if (this.stack.length > 1) {
      // First slide of a branch → return to the parent timeline.
      this.back();
    }
  }

  goToSlide(index: number): void {
    const slides = this.slidesOf(this.frame.sequenceId);
    if (index >= 0 && index < slides.length) this.enterSlide(index);
  }

  enterBranch(sequenceId: string): void {
    const seq = this.show.sequences[sequenceId];
    if (!seq || seq.slides.length === 0) return;
    this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
    this.enterSlide(0);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    // Restore the saved fragmentIndex from the parent frame rather than
    // resetting to -1 (which enterSlide would do). This preserves the exact
    // position the presenter was at before entering the branch.
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  backToMain(): void {
    if (this.stack.length <= 1) return;
    this.stack = [this.stack[0]];
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  /**
   * Jump to an absolute position without animation (audience mirroring).
   * Re-roots the stack to the target sequence, then restores slide+fragment
   * statically via resumeSlide.
   */
  syncTo(sequenceId: string, slideIndex: number, fragmentIndex: number): void {
    const base = this.stack[0];
    if (!base) return;
    if (this.frame.sequenceId !== sequenceId) {
      this.stack = [base];
      if (sequenceId !== MAIN) {
        const seq = this.show.sequences[sequenceId];
        if (!seq || seq.slides.length === 0) return;
        this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
      }
    }
    const slides = this.slidesOf(this.frame.sequenceId);
    if (slideIndex < 0 || slideIndex >= slides.length) return;
    this.resumeSlide(slideIndex, fragmentIndex);
  }
}
