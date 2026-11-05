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
  closed = false;
  private picks = new Map<
    string,
    { team: Team; windowAt: number; changes: number }
  >();
  private counts: Record<Team, number> = { BLUE: 0, ORANGE: 0 };
  pick(token: string) {
    return this.picks.get(token)?.team ?? null;
  }
  reset() {
    this.roundId = randomBytes(8).toString("hex");
    this.closed = false;
    this.picks.clear();
    this.counts = { BLUE: 0, ORANGE: 0 };
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
        "A new betting round has opened. Choose again.",
        409,
      );
    if (this.closed || phase === "FINISHED")
      throw new PredictionError("Betting has ended for this match.", 409);
    if (typeof team !== "string" || !TEAMS.includes(team as Team))
      throw new PredictionError("Choose Blue Team or Orange Team.");
    const previous = this.picks.get(token);
    if (previous?.team === team) return;
    if (previous && now - previous.windowAt < 1000 && previous.changes >= 5)
      throw new PredictionError(
        "You're changing bets too quickly. Try again in a moment.",
        429,
      );
    if (!previous && this.picks.size >= 5000)
      throw new PredictionError("Bet capacity reached.", 503);
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
      finished && !ended && score.BLUE !== score.ORANGE
        ? score.BLUE > score.ORANGE
          ? "BLUE"
          : "ORANGE"
        : null;
    return {
      roundId: this.roundId,
      open: phase !== "FINISHED" && !this.closed,
      totals: { ...this.counts },
      total: this.picks.size,
      outcome: finished ? (winner ? "SETTLED" : "VOID") : "PENDING",
      winner,
    };
  }
}
