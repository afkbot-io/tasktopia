/** Sustained visible-frame pressure only. Loading and background gaps restart
 * observation; one slow frame never changes quality. No simulation clock input. */
export class AdaptiveWorldQuality {
  economy = false;
  private elapsed = 0;
  private slow = 0;
  private frames = 0;
  private badWindows = 0;
  private goodWindows = 0;
  private warmup = 10_000;
  sample(deltaMs: number, eligible: boolean): boolean {
    if (!eligible || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 250) {
      this.elapsed = this.slow = this.frames = this.badWindows = this.goodWindows = 0;
      this.warmup = 10_000;
      return this.economy;
    }
    if (this.warmup > 0) { this.warmup -= deltaMs; return this.economy; }
    this.elapsed += deltaMs; this.frames++;
    if (deltaMs > 28) this.slow++;
    if (this.elapsed < 5000) return this.economy;
    const ratio = this.slow / this.frames;
    this.badWindows = ratio > .2 ? this.badWindows + 1 : 0;
    this.goodWindows = ratio < .02 ? this.goodWindows + 1 : 0;
    if (!this.economy && this.badWindows >= 3) this.economy = true;
    if (this.economy && this.goodWindows >= 12) this.economy = false;
    this.elapsed = this.slow = this.frames = 0;
    return this.economy;
  }
}
