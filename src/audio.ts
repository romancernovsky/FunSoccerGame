import type { Snapshot } from "./shared";
import {
  EFFECTS,
  preloadRecordings,
  loadRecordings,
  playRecordedEffect,
  recordedAmbience,
  createBroadcastMaster,
  type SoundBank,
} from "./recorded-audio";
export type AudioStatus = "off" | "enabling" | "on" | "blocked" | "unavailable";
const GAMEPLAY = new Set([
  "pass",
  "shot",
  "shot_charge",
  "ball_bounce",
  "ball_control",
  "wall_bounce",
  "dash",
  "tackle",
  "pass_completed",
  "keeper_save",
  "keeper_catch",
  "near_miss",
  "ball_landed",
]);
const COOLDOWN: Record<string, number> = {
  ball_bounce: 100,
  ball_landed: 140,
  wall_bounce: 150,
  ball_control: 180,
  dash: 140,
  tackle: 200,
  near_miss: 900,
  keeper_save: 700,
  shot_charge: 140,
  pass_completed: 160,
};
/** One audio source for a host/projector page, never for player phones. */
export class MatchAudio {
  status: AudioStatus = "off";
  volume = 0.6;
  private wanted = false;
  private mutedByUser = false;
  private playing = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: ReturnType<typeof recordedAmbience> | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private bank: SoundBank | null = null;
  private crowdLevel = 0.12;
  private lastPlayed = new Map<string, number>();
  private phase = "";
  private rhythm = "";
  private finalSecond = 0;
  private pending = false;
  private attempt = 0;
  private lastEvent: number | null = null;
  private countdown = "";
  private previousSessionType: string | undefined;

  constructor(private changed: () => void) {
    void preloadRecordings().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      // A presenter may switch to the meeting tab while sharing this one.
      // Keep a running audio context audible; recover actual OS interruptions
      // when the page becomes visible again.
      if (!document.hidden) this.recover();
    });
    window.addEventListener("pageshow", () => this.recover());
    // An explicit previous opt-in is required; unrelated taps never enable audio.
    window.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest?.("[data-audio-action]")) return;
      this.recover();
    });
  }

  get ready() {
    return (
      this.status === "on" && this.wanted && this.context?.state === "running"
    );
  }
  toggle() {
    if (this.ready || this.pending) this.mute();
    else {
      this.mutedByUser = false;
      void this.activate(true, this.status === "blocked");
    }
  }
  test() {
    if (this.ready) this.play("test");
    else if (!this.pending) {
      this.mutedByUser = false;
      void this.activate(true, this.status === "blocked");
    }
  }
  /** Call inside the host's start/resume/broadcast click, before any await. */
  enableForMatch() {
    if (!this.mutedByUser && !this.ready && !this.pending)
      void this.activate(false, this.status === "blocked");
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context) {
      this.setGain(this.volume, true);
    }
    this.changed();
  }
  mute() {
    this.wanted = false;
    this.mutedByUser = true;
    ++this.attempt;
    this.pending = false;
    this.releaseContext();
    this.session(false);
    this.publish("off");
  }
  recover() {
    if (this.wanted && !this.ready && !this.pending && !document.hidden)
      void this.activate(false, false);
    else if (this.ready && this.master) {
      this.setGain(this.volume);
      this.publish("on");
    }
  }
  private publish(status: AudioStatus) {
    if (this.status === status) return;
    this.status = status;
    if (status === "on") this.syncAmbience();
    this.changed();
  }
  private syncAmbience() {
    if (!this.ready || !this.context || !this.master || !this.bank) return;
    try {
      if (this.playing)
        this.ambience ??= recordedAmbience(
          this.context,
          this.master,
          this.bank!,
        );
      this.ambience?.setLevel(this.playing ? this.crowdLevel : 0);
    } catch {
      this.publish("blocked");
    }
  }
  private session(on: boolean) {
    // Safari exposes this optional API. Playback routing avoids the ambient
    // audio category; no microphone permission or silent-media hack is needed.
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (!session) return;
    try {
      if (on) {
        this.previousSessionType ??= session.type;
        session.type = "playback";
      } else {
        if (session.type === "playback")
          session.type = this.previousSessionType ?? "auto";
        this.previousSessionType = undefined;
      }
    } catch {
      /* Unsupported session types must never prevent normal Web Audio. */
    }
  }
  private async activate(test: boolean, recreate: boolean) {
    this.wanted = true;
    const attempt = ++this.attempt;
    this.pending = true;
    this.publish("enabling");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (recreate) this.releaseContext();
      this.session(true);
      if (!this.context || this.context.state === "closed") {
        this.releaseContext();
        const Constructor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Constructor) {
          this.pending = false;
          this.wanted = false;
          this.session(false);
          this.publish("unavailable");
          return;
        }
        const context = (this.context = new Constructor());
        this.master = createBroadcastMaster(context);
        this.master.gain.value = this.volume;

        context.onstatechange = () => {
          if (this.context !== context || !this.wanted || this.pending) return;
          if (context.state === "running") this.publish("on");
          else {
            this.stopVoices();
            this.publish("blocked");
            this.recover();
          }
        };
      }
      const context = this.context;
      // Called synchronously from the click, before the first await, preserving
      // browser user activation. Some browsers leave resume() pending forever.
      const resumed = context.resume();
      await Promise.race([
        resumed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Audio resume timed out")),
            2000,
          );
        }),
      ]);
      this.bank = await loadRecordings(context);
      if (attempt !== this.attempt || !this.wanted) return;
      if (context.state !== "running")
        throw Error("Audio is still interrupted");
      this.pending = false;
      if (this.master) this.setGain(this.volume);
      this.publish("on");
      if (test) this.play("test");
    } catch {
      if (attempt === this.attempt && this.wanted) {
        this.pending = false;
        this.publish("blocked");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  private setGain(value: number, ramp = false) {
    if (!this.master || !this.context) return;
    const gain = this.master.gain,
      at = this.context.currentTime;
    gain.cancelScheduledValues(0);
    if (ramp && value > 0) gain.setTargetAtTime(value, at, 0.015);
    else gain.setValueAtTime(value, at);
  }
  private stopVoices() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.voices.clear();
  }
  private releaseContext() {
    this.ambience?.stop();
    this.ambience = null;
    this.bank = null;
    this.lastPlayed.clear();
    this.stopVoices();
    this.setGain(0);
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context) {
      context.onstatechange = null;
      if (context.state !== "closed") void context.close().catch(() => {});
    }
  }
  play(kind: string) {
    if (
      !this.ready ||
      !this.context ||
      !this.master ||
      !this.bank ||
      !EFFECTS[kind] ||
      this.voices.size > 48
    )
      return;
    const now = this.context.currentTime * 1000;
    if (now - (this.lastPlayed.get(kind) ?? -Infinity) < (COOLDOWN[kind] ?? 0))
      return;
    this.lastPlayed.set(kind, now);
    try {
      playRecordedEffect(
        this.context,
        this.master,
        kind,
        this.bank,
        (source, nodes) => {
          this.voices.add(source);
          source.onended = () => {
            this.voices.delete(source);
            source.disconnect();
            for (const node of nodes) node.disconnect();
          };
        },
      );
    } catch {
      this.publish("blocked");
    }
  }
  observe(state: Snapshot) {
    const playing = state.phase === "PLAYING" || state.phase === "GOLDEN_GOAL";
    if (
      this.phase !== state.phase &&
      ["PAUSED", "FINISHED", "WAITING", "RULES_COUNTDOWN"].includes(state.phase)
    )
      this.stopVoices();
    this.phase = state.phase;
    this.playing = playing;
    this.crowdLevel = state.golden
      ? 0.19
      : state.remaining <= 60 ||
          state.balls.some(
            (ball) => !ball.scored && (ball.x < 180 || ball.x > 1020),
          )
        ? 0.16
        : 0.12;
    this.syncAmbience();
    const events = state.events ?? [{ ...state.event, at: state.now }];
    const latest = Math.max(state.event.id, ...events.map((e) => e.id));
    if (this.lastEvent === null) this.lastEvent = latest;
    else if (!this.pending) {
      for (const event of events) {
        if (
          event.id <= this.lastEvent ||
          state.now - event.at > 1500 ||
          event.at > state.now
        )
          continue;
        if (!playing && GAMEPLAY.has(event.kind)) continue;
        this.play(
          event.kind === "match_finished" && state.ended
            ? "match_ended"
            : event.kind,
        );
      }
      this.lastEvent = Math.max(this.lastEvent, latest);
    }
    if (
      ["COUNTDOWN", "KICKOFF_COUNTDOWN", "RULES_COUNTDOWN"].includes(
        state.phase,
      )
    ) {
      const n = Math.ceil((state.deadline - state.now) / 1000);
      const key = `${state.phase}:${state.deadline}:${n}`;
      if (
        key !== this.countdown &&
        n >= 1 &&
        n <= (state.phase === "RULES_COUNTDOWN" ? 7 : 3)
      )
        this.play("countdown");
      this.countdown = key;
    } else this.countdown = "";
    const second = Math.ceil(state.remaining);
    if (state.remaining > 10) this.finalSecond = 0;
    if (
      playing &&
      !state.golden &&
      second >= 1 &&
      second <= 10 &&
      second !== this.finalSecond
    ) {
      this.finalSecond = second;
      this.play("last_seconds");
    }
    const rhythm = state.golden
      ? `golden:${Math.floor(state.now / 6000)}`
      : `normal:${Math.floor(state.remaining / 6)}`;
    if (playing && (state.golden || state.remaining > 10)) {
      if (this.rhythm && rhythm !== this.rhythm) this.play("crowd_clap");
      this.rhythm = rhythm;
    } else this.rhythm = "";
  }
}
