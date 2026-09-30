import {
  isTransient,
  type AvatarState,
  type SustainedState,
  type TransientState,
} from "./avatarStates";

export type AvatarStateEvent = {
  at: number;
  from: AvatarState;
  to: AvatarState;
  reason: string;
};

type Listener = (state: AvatarState, event: AvatarStateEvent) => void;

/**
 * Single source of truth for which avatar clip should be visible.
 *
 * - IDLE / THINKING / TALKING are "sustained": they hold until replaced.
 * - UPSET / PERSONAL_BOUNDARY are "transient": they play once (or for a max
 *   duration) and then return to the sustained state that was active before,
 *   so a boundary reaction can never strand the avatar.
 */
export class AvatarVideoStateManager {
  private sustained: SustainedState = "IDLE";
  private transient: TransientState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private disposed = false;

  get state(): AvatarState {
    return this.transient ?? this.sustained;
  }

  get sustainedState(): SustainedState {
    return this.sustained;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Set the holding state. Ignored visually while a transient clip plays. */
  setSustained(next: SustainedState, reason = "sustained") {
    if (this.disposed) return;
    if (this.sustained === next) return;
    const from = this.state;
    this.sustained = next;
    if (!this.transient) this.emit(from, reason);
  }

  /** Play a one-shot reaction, then fall back to the sustained state. */
  playTransient(next: TransientState, maxDurationMs = 8000, reason = "transient") {
    if (this.disposed) return;
    const from = this.state;
    this.clearTimer();
    this.transient = next;
    if (from !== next) this.emit(from, reason);
    this.timer = setTimeout(() => this.endTransient("timeout"), maxDurationMs);
  }

  /** Called when the one-shot clip ends naturally, or as a safety net. */
  endTransient(reason = "ended") {
    if (this.disposed) return;
    if (!this.transient) return;
    const from = this.state;
    this.clearTimer();
    this.transient = null;
    this.emit(from, reason);
  }

  reset(reason = "reset") {
    if (this.disposed) return;
    const from = this.state;
    this.clearTimer();
    this.transient = null;
    this.sustained = "IDLE";
    if (from !== "IDLE") this.emit(from, reason);
  }

  dispose() {
    this.clearTimer();
    this.listeners.clear();
    this.disposed = true;
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(from: AvatarState, reason: string) {
    const event: AvatarStateEvent = { at: Date.now(), from, to: this.state, reason };
    for (const listener of [...this.listeners]) {
      try {
        listener(this.state, event);
      } catch (error) {
        console.error("[avatar-state] listener failed", error);
      }
    }
  }
}

export { isTransient };
export type { AvatarState, SustainedState, TransientState };
