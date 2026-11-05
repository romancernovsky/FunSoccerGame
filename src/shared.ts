export const DEFAULT_MATCH_DURATION_SECONDS = 180;

export type Team = "BLUE" | "ORANGE";
export type Phase =
  | "WAITING"
  | "COUNTDOWN"
  | "RULES_COUNTDOWN"
  | "PLAYING"
  | "PAUSED"
  | "GOAL"
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
  id: string;
  height: number;
  vz: number;
  scored: boolean;
  possessionTeam: Team | null;
  passes: number;
  passFrom: string | null;
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
  at: number;
  team: Team;
  scorer: string;
  passes: number;
  id: number;
};
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
  eventStreamId: string;
  now: number;
  phase: Phase;
  deadline: number;
  remaining: number;
  score: Record<Team, number>;
  players: Player[];
  ball: Ball;
  balls: Ball[];
  multiball: boolean;
  celebration: Celebration | null;
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
export const TEAMS: Team[] = ["BLUE", "ORANGE"];

export const TEAM_NAMES: Record<Team, string> = {
  BLUE: "Blue Team",
  ORANGE: "Orange Team",
};
export const teamName = (team: Team) => TEAM_NAMES[team];
export const teamClass = (team: Team) => `team-${team.toLowerCase()}`;

export const MULTIBALL_COUNTDOWN_SECONDS = 7;
