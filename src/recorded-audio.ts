/** CC0 field recordings, bundled locally. See public/audio/CREDITS.md. */
export const RECORDINGS = {
  kick: "/audio/kick.mp3",
  shot: "/audio/shot.mp3",
  net: "/audio/net.mp3",
  whistle: "/audio/whistle.mp3",
  crowd: "/audio/crowd.mp3",
  reaction: "/audio/reaction.mp3",
  applause: "/audio/applause.mp3",
  clap: "/audio/clap.mp3",
  step: "/audio/step.mp3",
  horn: "/audio/horn.mp3",
  cheer: "/audio/cheer.mp3",
} as const;
type Recording = keyof typeof RECORDINGS;
export type SoundBank = Record<Recording, AudioBuffer>;
type Part = {
  clip: Recording;
  gain: number;
  delay?: number;
  duration?: number;
  rate?: number;
};
export const EFFECTS: Record<string, Part[]> = {
  test: [
    { clip: "whistle", gain: 0.45, duration: 0.25 },
    { clip: "clap", gain: 0.5, delay: 0.25 },
  ],
  countdown: [{ clip: "clap", gain: 0.7 }],
  pass: [{ clip: "kick", gain: 0.7 }],
  shot: [{ clip: "shot", gain: 0.95 }],
  shot_charge: [{ clip: "step", gain: 0.24 }],
  ball_bounce: [{ clip: "net", gain: 0.65 }],
  ball_landed: [{ clip: "shot", gain: 0.45, duration: 0.3 }],
  balls_dropped: [
    { clip: "reaction", gain: 0.45, duration: 1.3 },
    { clip: "applause", gain: 0.35, delay: 0.2, duration: 1.4 },
  ],
  ball_control: [{ clip: "net", gain: 0.3, duration: 0.24 }],
  wall_bounce: [{ clip: "shot", gain: 0.55 }],
  dash: [
    { clip: "step", gain: 0.42, rate: 1.04 },
    { clip: "step", gain: 0.35, delay: 0.13 },
    { clip: "step", gain: 0.25, delay: 0.26 },
  ],
  tackle: [
    { clip: "step", gain: 0.5 },
    { clip: "net", gain: 0.6, delay: 0.025 },
  ],
  pass_completed: [{ clip: "clap", gain: 0.36 }],
  keeper_catch: [
    { clip: "net", gain: 0.65 },
    { clip: "applause", gain: 0.2, delay: 0.04, duration: 0.65 },
  ],
  keeper_save: [
    { clip: "shot", gain: 0.65 },
    { clip: "reaction", gain: 0.48, delay: 0.04, duration: 1.4 },
  ],
  near_miss: [{ clip: "reaction", gain: 0.55, duration: 1.5 }],
  match_started: [{ clip: "whistle", gain: 0.45, duration: 0.26 }],
  go: [{ clip: "whistle", gain: 0.8 }],
  match_paused: [{ clip: "whistle", gain: 0.5, duration: 0.24 }],
  match_resumed: [{ clip: "whistle", gain: 0.55, duration: 0.35 }],
  goal_scored: [
    { clip: "net", gain: 0.5 },
    { clip: "cheer", gain: 0.95, delay: 0.04, duration: 2.7 },
    { clip: "applause", gain: 0.75, delay: 0.15, duration: 2.6 },
  ],
  team_goal: [
    { clip: "applause", gain: 0.28, delay: 0.8, duration: 1.7 },
    { clip: "cheer", gain: 0.2, delay: 1.1, duration: 1.6 },
  ],
  match_finished: [
    { clip: "whistle", gain: 0.75 },
    { clip: "whistle", gain: 0.7, delay: 0.52 },
    { clip: "whistle", gain: 0.75, delay: 1.04 },
    { clip: "cheer", gain: 0.6, delay: 0.4, duration: 4 },
    { clip: "applause", gain: 0.5, delay: 1.4 },
  ],
  match_ended: [
    { clip: "whistle", gain: 0.7 },
    { clip: "whistle", gain: 0.65, delay: 0.55 },
  ],
  final_minute: [
    { clip: "horn", gain: 0.45, duration: 0.9 },
    { clip: "clap", gain: 0.55, delay: 0.3 },
    { clip: "clap", gain: 0.55, delay: 0.65 },
  ],
  last_seconds: [{ clip: "clap", gain: 0.7 }],
  golden_goal_started: [
    { clip: "horn", gain: 0.6, duration: 1.2 },
    { clip: "cheer", gain: 0.45, delay: 0.15, duration: 2 },
    { clip: "whistle", gain: 0.55, delay: 1.1 },
  ],
  crowd_clap: [
    { clip: "clap", gain: 0.35 },
    { clip: "clap", gain: 0.3, delay: 0.28 },
  ],
};
let encoded: Promise<Record<Recording, ArrayBuffer>> | null = null;
let decoded: Promise<SoundBank> | null = null;
export function preloadRecordings() {
  encoded ??= Promise.all(
    Object.entries(RECORDINGS).map(async ([name, url]) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Error(`Could not load match audio: ${name}`);
      return [name, await response.arrayBuffer()] as const;
    }),
  )
    .then(
      (entries) =>
        Object.fromEntries(entries) as Record<Recording, ArrayBuffer>,
    )
    .catch((error) => {
      encoded = null;
      throw error;
    });
  return encoded;
}
export function loadRecordings(audio: BaseAudioContext) {
  decoded ??= preloadRecordings()
    .then(
      async (files) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(files).map(async ([name, bytes]) => [
              name,
              await audio.decodeAudioData(bytes.slice(0)),
            ]),
          ),
        ) as SoundBank,
    )
    .catch((error) => {
      decoded = null;
      throw error;
    });
  return decoded;
}
/** Short fades and recorded transients; no oscillators or generated noise. */
export function playRecordedEffect(
  audio: BaseAudioContext,
  output: AudioNode,
  kind: string,
  bank: SoundBank,
  track: (
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
  ) => void = () => {},
) {
  for (const part of EFFECTS[kind] ?? []) {
    const source = audio.createBufferSource(),
      gain = audio.createGain();
    source.buffer = bank[part.clip];
    const rate = part.rate ?? 1;
    const duration = Math.min(
      part.duration ?? source.buffer.duration / rate,
      source.buffer.duration / rate,
    );
    const at = audio.currentTime + 0.025 + (part.delay ?? 0);
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(part.gain, at + 0.006);
    gain.gain.setValueAtTime(part.gain, at + Math.max(0.006, duration - 0.035));
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.connect(gain).connect(output);
    track(source, [gain]);
    source.start(at, 0, duration * rate);
    source.stop(at + duration + 0.01);
  }
}
export function recordedAmbience(
  audio: AudioContext,
  output: AudioNode,
  bank: SoundBank,
) {
  const source = audio.createBufferSource(),
    gain = audio.createGain();
  source.buffer = bank.crowd;
  source.loop = true;
  gain.gain.value = 0;
  source.connect(gain).connect(output);
  source.start();
  let previous = 0;
  return {
    setLevel(level: number) {
      if (level === previous) return;
      previous = level;
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.setTargetAtTime(level, audio.currentTime, 0.06);
    },
    stop() {
      source.stop();
      source.disconnect();
      gain.disconnect();
    },
  };
}
export function createBroadcastMaster(audio: BaseAudioContext) {
  const master = audio.createGain(),
    compressor = audio.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  master.connect(compressor).connect(audio.destination);
  return master;
}
