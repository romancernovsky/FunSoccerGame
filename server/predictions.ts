import { randomBytes } from "node:crypto";
import {
  TEAMS,
  type PredictionSummary,
  type Team,
  type Phase,
} from "../src/shared.js";

export class PredictionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Temporary audience picks. Identity cookies and picks never enter game snapshots. */
export class Predictions {
  roundId = randomBytes(8).toString("hex");
  locked = false;
  private picks = new Map<
    string,
    { team: Team; windowAt: number; changes: number }
  >();
  private counts: Record<Team, number> = { LEADERS: 0, WORKERS: 0 };
  pick(token: string) {
    return this.picks.get(token)?.team ?? null;
  }
  reset() {
    this.roundId = randomBytes(8).toString("hex");
    this.locked = false;
    this.picks.clear();
    this.counts = { LEADERS: 0, WORKERS: 0 };
  }
  choose(
    token: string,
    team: unknown,
    roundId: unknown,
    now: number,
    phase: Phase,
  ) {
    if (roundId !== this.roundId)
      throw new PredictionError(
        "A new prediction round has opened. Choose again.",
        409,
      );
    if (this.locked || phase !== "WAITING")
      throw new PredictionError(
        "Predictions are locked. Enjoy the match!",
        409,
      );
    if (typeof team !== "string" || !TEAMS.includes(team as Team))
      throw new PredictionError("Choose LEADERS or WORKERS.");
    const previous = this.picks.get(token);
    if (previous?.team === team) return;
    if (previous && now - previous.windowAt < 1000 && previous.changes >= 5)
      throw new PredictionError(
        "You're changing picks too quickly. Try again in a moment.",
        429,
      );
    if (!previous && this.picks.size >= 5000)
      throw new PredictionError("Audience prediction capacity reached.", 503);
    if (previous) this.counts[previous.team]--;
    this.counts[team as Team]++;
    this.picks.set(token, {
      team: team as Team,
      windowAt:
        previous && now - previous.windowAt < 1000 ? previous.windowAt : now,
      changes:
        previous && now - previous.windowAt < 1000 ? previous.changes + 1 : 1,
    });
  }
  summary(
    phase: Phase,
    score: Record<Team, number>,
    ended: boolean,
  ): PredictionSummary {
    const finished = phase === "FINISHED";
    const winner =
      finished && !ended && score.LEADERS !== score.WORKERS
        ? score.LEADERS > score.WORKERS
          ? "LEADERS"
          : "WORKERS"
        : null;
    return {
      roundId: this.roundId,
      open: phase === "WAITING" && !this.locked,
      totals: { ...this.counts },
      total: this.picks.size,
      outcome: finished ? (winner ? "SETTLED" : "VOID") : "PENDING",
      winner,
    };
  }
}
