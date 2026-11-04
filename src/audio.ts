import type { Snapshot } from "./shared";

export type AudioStatus = "off" | "enabling" | "on" | "blocked" | "unavailable";
const pitches: Record<string, number[]> = {
  test: [523, 659, 784],
  countdown: [660],
  pass: [280],
  shot: [140, 90],
  go: [440, 660, 880],
  goal_scored: [523, 659, 784, 1047, 784, 1047],
  match_finished: [784, 659, 523, 1047],
  final_minute: [440, 440, 660],
  golden_goal_started: [330, 660, 990],
  reorg_started: [220, 165, 330, 440, 660, 880],
  reorg_kickoff: [440, 660],
};

/** Original effects, shared by live playback and offline signal verification. */
export function synthesizeEffect(
  audio: BaseAudioContext,
  output: AudioNode,
  kind: string,
  track: (
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
  ) => void = () => {},
) {
  const notes = pitches[kind];
  if (!notes) return;
  const start = audio.currentTime + 0.025;
  notes.forEach((frequency, i) => {
    const source = audio.createOscillator(),
      gain = audio.createGain();
    const at = start + i * 0.12;
    const duration = kind === "countdown" ? 0.12 : 0.3;
    source.type = kind === "goal_scored" ? "triangle" : "sine";
    source.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.2, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(gain).connect(output);
    track(source, [gain]);
    source.start(at);
    source.stop(at + duration + 0.02);
  });
  if (kind === "match_finished" || kind === "go") {
    const source = audio.createOscillator(),
      gain = audio.createGain();
    const at = start;
    source.frequency.setValueAtTime(2700, at);
    source.frequency.linearRampToValueAtTime(2350, at + 0.35);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
    source.connect(gain).connect(output);
    track(source, [gain]);
    source.start(at);
    source.stop(at + 0.42);
  }
  if (kind === "goal_scored" || kind === "match_finished") {
    const buffer = audio.createBuffer(
      1,
      audio.sampleRate * 1.5,
      audio.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 900;
    gain.gain.value = 0.25;
    source.connect(filter).connect(gain).connect(output);
    track(source, [filter, gain]);
    source.start(start);
  }
}

/** One opt-in audio source for a host/projector page, never for player phones. */
export class MatchAudio {
  status: AudioStatus = "off";
  volume = 0.6;
  private wanted = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private pending = false;
  private attempt = 0;
  private lastEvent: number | null = null;
  private countdown = "";
  private previousSessionType: string | undefined;

  constructor(private changed: () => void) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        ++this.attempt;
        this.pending = false;
        this.stopVoices();
        this.setGain(0);
        if (this.wanted) this.publish("blocked");
      } else this.recover();
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
      this.status === "on" &&
      this.wanted &&
      this.context?.state === "running" &&
      !document.hidden
    );
  }
  toggle() {
    if (this.ready || this.pending) this.mute();
    else void this.activate(true, this.status === "blocked");
  }
  test() {
    if (this.ready) this.play("test");
    else if (!this.pending) void this.activate(true, this.status === "blocked");
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context && !document.hidden) {
      this.setGain(this.volume, true);
    }
    this.changed();
  }
  mute() {
    this.wanted = false;
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
    this.changed();
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
        this.master = context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(context.destination);
        context.onstatechange = () => {
          if (
            this.context !== context ||
            !this.wanted ||
            this.pending ||
            document.hidden
          )
            return;
          if (context.state === "running") this.publish("on");
          else {
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
      if (attempt !== this.attempt || !this.wanted || document.hidden) return;
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
    if (!this.ready || !this.context || !this.master || this.voices.size > 64)
      return;
    try {
      synthesizeEffect(this.context, this.master, kind, (source, nodes) => {
        this.voices.add(source);
        source.onended = () => {
          this.voices.delete(source);
          source.disconnect();
          for (const node of nodes) node.disconnect();
        };
      });
    } catch {
      // An audio device change must not interrupt rendering or socket messages.
      this.publish("blocked");
    }
  }
  observe(state: Snapshot) {
    if (this.lastEvent !== null && state.event.id !== this.lastEvent)
      this.play(state.event.kind);
    this.lastEvent = state.event.id;
    // Use authoritative snapshots, not the WebGL animation loop, for the beeps.
    if (["COUNTDOWN", "KICKOFF_COUNTDOWN"].includes(state.phase)) {
      const n = Math.ceil((state.deadline - state.now) / 1000);
      const key = `${state.phase}:${state.deadline}:${n}`;
      if (key !== this.countdown && n >= 1 && n <= 3) this.play("countdown");
      this.countdown = key;
    } else this.countdown = "";
  }
}
