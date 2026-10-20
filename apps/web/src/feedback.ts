import type { PlayerState } from "@yt-remote/protocol";

export type PendingControls = Partial<Record<"isPlaying" | "volume", {
  value: boolean | number;
  requestId?: string;
  acknowledged: boolean;
  expiresAt: number;
}>>;

export function reconcileControls(state: PlayerState | undefined, pending: PendingControls, now = Date.now()): PlayerState | undefined {
  if (!state) return state;
  const next = { ...state };
  for (const key of ["isPlaying", "volume"] as const) {
    const control = pending[key];
    if (!control) continue;
    if (now >= control.expiresAt || (control.acknowledged && state[key] === control.value)) {
      delete pending[key];
    } else {
      Object.assign(next, { [key]: control.value });
    }
  }
  return next;
}

export class VolumeQueue {
  private inFlight?: string;
  private latest?: number;

  send(volume: number, transmit: (volume: number) => string): string | undefined {
    if (this.inFlight) {
      this.latest = volume;
      return;
    }
    this.inFlight = transmit(volume);
    return this.inFlight;
  }

  acknowledge(requestId: string, transmit: (volume: number) => string): string | undefined {
    if (requestId !== this.inFlight) return;
    this.inFlight = undefined;
    const volume = this.latest;
    this.latest = undefined;
    if (volume !== undefined) return this.send(volume, transmit);
  }

  reset(): void {
    this.inFlight = undefined;
    this.latest = undefined;
  }
}
