export const DEFAULT_MATCH_DURATION_SECONDS = 180;

export type Team = "LEADERS" | "WORKERS";
export type Phase =
  | "WAITING"
  | "COUNTDOWN"
  | "PLAYING"
  | "PAUSED"
  | "GOAL"
  | "REORG"
  | "KICKOFF_COUNTDOWN"
  | "GOLDEN_GOAL"
  | "FINISHED";
export type Input = { x: number; y: number; action: boolean; dash: boolean };
export type Player = {
  id: string;
  name: string;
  team: Team;
  keeper: boolean;
  connected: boolean;
  disconnectedAt: number;
  bot: boolean;
  x: number;
  y: number;
  fx: number;
  fy: number;
  dashUntil: number;
  dashReady: number;
  chargeAt: number;
  input: Input;
  inputAt: number;
};
export type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string | null;
  lastTouch: string | null;
  lockUntil: number;
  heldAt: number;
};
export type Celebration = {
  team: Team;
  scorer: string;
  passes: number;
  id: number;
};
export type ReorgAssignment = {
  id: string;
  name: string;
  fromTeam: Team;
  team: Team;
  keeper: boolean;
};
export type Reorg = { id: number; assignments: ReorgAssignment[] };
export const REORG = {
  remaining: 60,
  revealSeconds: 12,
  introSeconds: 2,
  kickoffSeconds: 3,
} as const;
export type PredictionSummary = {
  roundId: string;
  open: boolean;
  totals: Record<Team, number>;
  total: number;
  outcome: "PENDING" | "SETTLED" | "VOID";
  winner: Team | null;
};
export type AudienceState = {
  now: number;
  phase: Phase;
  remaining: number;
  golden: boolean;
  score: Record<Team, number>;
  predictions: PredictionSummary;
  pick: Team | null;
};
export type GameEvent = { id: number; kind: string; at: number };
export type Snapshot = {
  now: number;
  phase: Phase;
  deadline: number;
  remaining: number;
  score: Record<Team, number>;
  players: Player[];
  ball: Ball;
  celebration: Celebration | null;
  reorg: Reorg | null;
  golden: boolean;
  ended: boolean;
  predictions: PredictionSummary;
  maxTeamSize: number;
  dev: boolean;
  event: { id: number; kind: string };
  events?: GameEvent[];
};
export const FIELD = {
  width: 1200,
  height: 700,
  goalTop: 245,
  goalBottom: 455,
  radius: 17,
  ballRadius: 9,
  centerCircleRadius: 100,
};
export const TEAMS: Team[] = ["LEADERS", "WORKERS"];
