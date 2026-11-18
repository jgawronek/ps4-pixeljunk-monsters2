// src/view/stage/TextureUploadQueue.ts
// Spreads GPU texture uploads across frames. Streaming textures used to be
// uploaded implicitly by the first render after each decode, so N textures
// finishing between two frames meant N uploads (+ mipmap generation) in ONE
// frame — a multi-hundred-ms stall on the loading screen / right after START.
// This queue uploads (renderer.initTexture) at most `budgetBytes` of RGBA
// pixels per animation frame (always >= 1 texture so it makes progress), and
// resolves each enqueue() when that texture is resident on the GPU.
// A timer fallback keeps it moving in background tabs (rAF paused).

export interface UploadRenderer {
  initTexture(texture: unknown): void;
}

interface Job {
  texture: unknown;
  bytes: number;
  done: () => void;
}

export class TextureUploadQueue {
  private readonly jobs: Job[] = [];
  private scheduled = false;

  constructor(
    private readonly renderer: UploadRenderer,
    private readonly budgetBytes = 24 * 1024 * 1024,
    private readonly raf: ((cb: () => void) => unknown) | null =
      typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : null,
  ) {}

  /** Queue an upload; resolves after the frame in which it was uploaded. */
  enqueue(texture: unknown, width: number, height: number): Promise<void> {
    return new Promise((resolve) => {
      this.jobs.push({ texture, bytes: Math.max(1, width * height * 4), done: resolve });
      this.schedule();
    });
  }

  /** Drop queued uploads (stage teardown): pending enqueue() promises resolve without uploading. */
  cancel(): void {
    const jobs = this.jobs.splice(0);
    for (const j of jobs) j.done();
  }

  get pending(): number {
    return this.jobs.length;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      this.scheduled = false;
      this.drain();
    };
    if (this.raf) this.raf(run);
    setTimeout(run, 100); // background-tab fallback
  }

  private drain(): void {
    let spent = 0;
    while (this.jobs.length > 0) {
      const job = this.jobs[0];
      if (spent > 0 && spent + job.bytes > this.budgetBytes) break;
      this.jobs.shift();
      try {
        this.renderer.initTexture(job.texture);
      } catch { /* the first real render retries the upload */ }
      spent += job.bytes;
      job.done();
    }
    if (this.jobs.length > 0) this.schedule();
  }
}
