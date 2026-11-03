import { Predictions } from "./predictions.js";
import { randomBytes, randomInt } from "node:crypto";
import {
  FIELD as F,
  REORG,
  type Reorg,
  TEAMS,
  type Team,
  type Phase,
  type Player,
  type Ball,
  type Input,
  type Snapshot,
  type Celebration,
} from "../src/shared.js";
const blank = (): Input => ({ x: 0, y: 0, action: false, dash: false });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export class Game {
  predictions = new Predictions();
  players = new Map<string, Player>();
  sessions = new Map<string, string>();
  phase: Phase = "WAITING";
  deadline = 0;
  remaining: number;
  score = { LEADERS: 0, WORKERS: 0 };
  ball: Ball = this.newBall();
  celebration: Celebration | null = null;
  reorg: Reorg | null = null;
  reorgDone = false;
  golden = false;
  ended = false;
  event = { id: 0, kind: "ready" };
  resumePhase: Phase = "PLAYING";
  pausedDeadline = 0;
  possessionTeam: Team | null = null;
  passes = 0;
  passFrom: string | null = null;
  nextId = 0;
  constructor(
    public config = { duration: 300, maxTeamSize: 6, grace: 20, dev: false },
    public log: (kind: string, data?: unknown) => void = () => {},
  ) {
    this.remaining = config.duration;
  }
  newBall(): Ball {
    return {
      x: 600,
      y: 350,
      vx: 0,
      vy: 0,
      owner: null,
      lastTouch: null,
      lockUntil: 0,
      heldAt: 0,
    };
  }
  emit(kind: string, data?: unknown) {
    this.event = { id: ++this.nextId, kind };
    this.log(kind, data);
  }
  count(team: Team, connected = false) {
    return [...this.players.values()].filter(
      (p) => p.team === team && (!connected || p.connected),
    ).length;
  }
  join(name: unknown, team: unknown, now: number) {
    if (this.phase !== "WAITING")
      throw Error("MATCH IN PROGRESS. Please wait for the next game.");
    if (
      typeof name !== "string" ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _'-]{0,11}$/u.test(name.trim())
    )
      throw Error(
        "Use 1–12 letters or numbers, with spaces, hyphens or apostrophes.",
      );
    name = name.trim();
    if (
      [...this.players.values()].some(
        (p) => p.name.toLocaleLowerCase() === String(name).toLocaleLowerCase(),
      )
    )
      throw Error("That name is taken. Choose another name.");
    if (!TEAMS.includes(team as Team)) throw Error("Choose a team.");
    if (this.count(team as Team) >= this.config.maxTeamSize)
      throw Error("That team is full.");
    const token = randomBytes(24).toString("hex"),
      id = randomBytes(8).toString("hex");
    const p: Player = {
      id,
      name: String(name),
      team: team as Team,
      keeper: false,
      connected: true,
      disconnectedAt: 0,
      bot: false,
      x: 0,
      y: 0,
      fx: team === "LEADERS" ? 1 : -1,
      fy: 0,
      dashUntil: 0,
      dashReady: 0,
      chargeAt: 0,
      input: blank(),
      inputAt: now,
    };
    this.players.set(id, p);
    this.sessions.set(token, id);
    this.positionPlayers();
    this.emit("player_joined", { name, team });
    return { token, id };
  }
  reconnect(token: string, now: number) {
    const id = this.sessions.get(token),
      p = id && this.players.get(id);
    if (
      !p ||
      (!p.connected && now - p.disconnectedAt > this.config.grace * 1000)
    )
      return null;
    p.connected = true;
    p.input = blank();
    p.inputAt = now;
    this.emit("player_reconnected", { id: p.id });
    return p.id;
  }
  disconnect(id: string, now: number) {
    const p = this.players.get(id);
    if (p) {
      p.connected = false;
      p.disconnectedAt = now;
      p.input = blank();
      p.chargeAt = 0;
      p.dashUntil = 0;
      this.emit("player_disconnected", { id });
    }
  }
  remove(id: string) {
    if (this.ball.owner === id) this.release(0.2, Date.now());
    this.players.delete(id);
    for (const [t, p] of this.sessions) if (p === id) this.sessions.delete(t);
  }
  positionPlayers() {
    for (const team of TEAMS) {
      const ps = [...this.players.values()].filter((p) => p.team === team);
      ps.forEach((p, i) => {
        p.x = p.keeper
          ? team === "LEADERS"
            ? 70
            : 1130
          : (team === "LEADERS" ? 310 : 890) +
            (i % 2) * 65 * (team === "LEADERS" ? 1 : -1);
        p.y = p.keeper ? 350 : 110 + ((i * 103) % 500);
        p.fx = team === "LEADERS" ? 1 : -1;
        p.fy = 0;
        p.input = blank();
        p.chargeAt = 0;
        p.dashUntil = 0;
        p.dashReady = 0;
      });
    }
  }
  command(action: string, data: Record<string, unknown>, now: number) {
    if (
      ["move", "keeper", "remove", "reset", "bots"].includes(action) &&
      this.phase !== "WAITING"
    )
      throw Error("Player changes are only available in the lobby.");
    const p =
      typeof data.id === "string" ? this.players.get(data.id) : undefined;
    switch (action) {
      case "move":
        if (!p) throw Error("Player not found.");
        {
          const team = p.team === "LEADERS" ? "WORKERS" : "LEADERS";
          if (this.count(team) >= this.config.maxTeamSize)
            throw Error("Destination team is full.");
          p.team = team;
          p.keeper = false;
          this.positionPlayers();
          this.emit("player_moved", { id: p.id, team });
        }
        break;
      case "keeper":
        if (!p) throw Error("Player not found.");
        {
          const next = !p.keeper;
          for (const other of this.players.values())
            if (other.team === p.team) other.keeper = false;
          p.keeper = next;
          this.positionPlayers();
          this.emit("goalkeeper_assigned", { id: p.id, assigned: next });
        }
        break;
      case "remove":
        if (!p) throw Error("Player not found.");
        this.remove(p.id);
        break;
      case "reset":
      case "new":
        if (action === "new" && this.phase !== "FINISHED")
          throw Error("Finish the match first.");
        this.predictions.reset();
        this.players.clear();
        this.sessions.clear();
        this.reset();
        this.phase = "WAITING";
        break;
      case "start":
        if (this.phase !== "WAITING") throw Error("Match has already started.");
        this.checkStart(data.confirm === true);
        this.start(now);
        break;
      case "pause":
        if (
          ![
            "PLAYING",
            "GOLDEN_GOAL",
            "COUNTDOWN",
            "KICKOFF_COUNTDOWN",
            "GOAL",
            "REORG",
          ].includes(this.phase)
        )
          throw Error("Cannot pause now.");
        this.resumePhase = this.phase;
        this.pausedDeadline = Math.max(0, this.deadline - now);
        this.phase = "PAUSED";
        this.clearInputs();
        this.emit("match_paused");
        break;
      case "resume":
        if (this.phase !== "PAUSED") throw Error("Match is not paused.");
        this.phase = this.resumePhase;
        this.deadline = now + this.pausedDeadline;
        this.clearInputs();
        this.emit("match_resumed");
        break;
      case "restart":
        if (this.phase === "WAITING") throw Error("Start the match first.");
        if (data.confirm !== true) throw Error("Confirmation required.");
        this.checkStart(true);
        this.start(now);
        break;
      case "rematch_lobby":
        if (this.phase !== "FINISHED") throw Error("Finish the match first.");
        this.reset();
        this.predictions.reset();
        this.phase = "WAITING";
        this.emit("rematch_lobby_opened");
        break;
      case "rematch":
        if (this.phase !== "FINISHED") throw Error("Finish the match first.");
        this.checkStart(true);
        this.start(now);
        break;
      case "end":
        if (["WAITING", "FINISHED"].includes(this.phase))
          throw Error("No active match.");
        if (data.confirm !== true) throw Error("Confirmation required.");
        this.ended = true;
        this.finish();
        break;
      case "bots":
        if (!this.config.dev)
          throw Error("Test players are disabled in production.");
        for (const team of TEAMS)
          while (this.count(team) < this.config.maxTeamSize) {
            const n = ++this.nextId;
            const { id } = this.join(`TEST ${n}`, team, now);
            this.players.get(id)!.bot = true;
          }
        break;
      default:
        throw Error("Unknown command.");
    }
  }
  checkStart(confirm: boolean) {
    if (TEAMS.some((t) => this.count(t, true) === 0))
      throw Error("Both teams need at least one connected player.");
    if (!confirm && TEAMS.some((t) => this.count(t) < this.config.maxTeamSize))
      throw Error("Teams are incomplete. Confirm to start anyway.");
  }
  reset() {
    this.remaining = this.config.duration;
    this.score = { LEADERS: 0, WORKERS: 0 };
    this.ball = this.newBall();
    this.golden = false;
    this.ended = false;
    this.celebration = null;
    this.reorg = null;
    this.reorgDone = false;
    this.passes = 0;
    this.passFrom = null;
    this.possessionTeam = null;
    this.positionPlayers();
  }
  start(now: number) {
    this.predictions.locked = true;
    this.reset();
    this.phase = "COUNTDOWN";
    this.deadline = now + 4000;
    this.emit("match_started");
  }
  clearInputs() {
    for (const p of this.players.values()) {
      p.input = blank();
      p.chargeAt = 0;
      p.dashUntil = 0;
    }
  }
  finish() {
    this.phase = "FINISHED";
    this.clearInputs();
    this.emit("match_finished", { score: this.score, ended: this.ended });
  }
  input(id: string, v: unknown, now: number) {
    const p = this.players.get(id);
    if (!p || !p.connected || !v || typeof v !== "object") return;
    const a = v as Input;
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      Math.abs(a.x) > 1 ||
      Math.abs(a.y) > 1 ||
      typeof a.action !== "boolean" ||
      typeof a.dash !== "boolean"
    )
      return;
    if (!["PLAYING", "GOLDEN_GOAL"].includes(this.phase)) {
      p.input = blank();
      return;
    }
    if (a.action && !p.input.action) p.chargeAt = now;
    if (!a.action && p.input.action) {
      if (this.ball.owner === id && p.chargeAt)
        this.release(clamp((now - p.chargeAt) / 1000, 0, 1), now);
      p.chargeAt = 0;
    }
    if (a.dash && !p.input.dash && now >= p.dashReady) {
      p.dashUntil = now + 170;
      p.dashReady = now + 2500;
    }
    p.input = { ...a };
    p.inputAt = now;
  }
  release(charge: number, now: number) {
    const p = this.ball.owner && this.players.get(this.ball.owner);
    if (!p) return;
    let fx = p.fx,
      fy = p.fy;
    if (charge < 0.22) {
      let best: Player | undefined,
        dist = 400;
      for (const q of this.players.values()) {
        const dx = q.x - p.x,
          dy = q.y - p.y,
          d = Math.hypot(dx, dy);
        if (
          q.id !== p.id &&
          q.team === p.team &&
          q.connected &&
          d < dist &&
          (dx * fx + dy * fy) / d > 0.75
        ) {
          best = q;
          dist = d;
        }
      }
      if (best) {
        fx = (best.x - p.x) / dist;
        fy = (best.y - p.y) / dist;
      }
      this.passFrom = p.id;
    } else this.passFrom = null;
    const speed = 440 + charge * 650;
    Object.assign(this.ball, {
      owner: null,
      vx: fx * speed,
      vy: fy * speed,
      lastTouch: p.id,
      lockUntil: now + 220,
    });
    this.emit(charge < 0.22 ? "pass" : "shot");
  }
  goal(team: Team, now: number) {
    this.score[team]++;
    const shooter = this.ball.lastTouch
      ? this.players.get(this.ball.lastTouch)
      : undefined;
    this.celebration = {
      team,
      scorer: shooter?.name ?? "TEAM",
      passes: this.possessionTeam === team ? this.passes : 0,
      id: ++this.nextId,
    };
    this.phase = "GOAL";
    this.deadline = now + 3000;
    this.clearInputs();
    this.emit("goal_scored", this.celebration);
  }
  beginReorg(now: number) {
    const players = [...this.players.values()];
    const previous = new Map(
      players.map((p) => [p.id, { team: p.team, keeper: p.keeper }]),
    );
    const keeperSlots = {
      LEADERS: players.some((p) => p.team === "LEADERS" && p.keeper),
      WORKERS: players.some((p) => p.team === "WORKERS" && p.keeper),
    };
    const hadBothConnected = TEAMS.every((t) => this.count(t, true) > 0);
    let leaderSlots = this.count("LEADERS");
    if (
      players.length >= 2 &&
      (leaderSlots === 0 || leaderSlots === players.length)
    )
      leaderSlots = Math.ceil(players.length / 2);
    // Fisher–Yates uses server-side cryptographic randomness, never client assignments.
    for (let i = players.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [players[i], players[j]] = [players[j], players[i]];
    }
    players.forEach((p, i) => {
      p.team = i < leaderSlots ? "LEADERS" : "WORKERS";
    });
    const swap = (a: Player, b: Player) => {
      [a.team, b.team] = [b.team, a.team];
    };
    // A reorg must not empty a connected side when both sides were playable.
    if (hadBothConnected)
      for (const team of TEAMS)
        if (!this.count(team, true)) {
          const recipient = players.find((p) => p.team === team)!;
          const donor = players.filter((p) => p.team !== team && p.connected);
          swap(recipient, donor[randomInt(donor.length)]);
        }
    // Reject the visible no-op: even a 1v1 must actually exchange sides.
    if (
      players.length > 1 &&
      players.every((p) => p.team === previous.get(p.id)!.team)
    ) {
      const pool = (team: Team) =>
        players.filter(
          (p) => p.team === team && (!hadBothConnected || p.connected),
        );
      const leaders = pool("LEADERS"),
        workers = pool("WORKERS");
      if (leaders.length && workers.length)
        swap(
          leaders[randomInt(leaders.length)],
          workers[randomInt(workers.length)],
        );
    }
    for (const p of players) p.keeper = false;
    for (const team of TEAMS)
      if (keeperSlots[team]) {
        const members = players.filter((p) => p.team === team);
        const retained = members.filter((p) => previous.get(p.id)!.keeper);
        const live = members.filter((p) => p.connected);
        const candidates = retained.length
          ? retained
          : live.length
            ? live
            : members;
        if (candidates.length)
          candidates[randomInt(candidates.length)].keeper = true;
      }
    this.reorgDone = true;
    this.reorg = {
      id: ++this.nextId,
      assignments: players.map((p) => ({
        id: p.id,
        name: p.name,
        fromTeam: previous.get(p.id)!.team,
        team: p.team,
        keeper: p.keeper,
      })),
    };
    this.phase = "REORG";
    this.deadline = now + REORG.revealSeconds * 1000;
    this.clearInputs();
    this.positionPlayers();
    this.ball = this.newBall();
    this.celebration = null;
    this.possessionTeam = null;
    this.passes = 0;
    this.passFrom = null;
    this.emit("reorg_started", this.reorg);
  }
  tick(dt: number, now: number) {
    for (const p of [...this.players.values()])
      if (!p.connected && now - p.disconnectedAt > this.config.grace * 1000)
        this.remove(p.id);
    if (this.phase === "REORG") {
      if (now >= this.deadline) {
        this.positionPlayers();
        this.ball = this.newBall();
        this.clearInputs();
        this.phase = "KICKOFF_COUNTDOWN";
        this.deadline = now + REORG.kickoffSeconds * 1000;
        this.emit("reorg_kickoff");
      }
      return;
    }
    if (["COUNTDOWN", "KICKOFF_COUNTDOWN"].includes(this.phase)) {
      if (now >= this.deadline) {
        this.phase = this.golden ? "GOLDEN_GOAL" : "PLAYING";
        this.emit("go");
      }
      return;
    }
    if (this.phase === "GOAL") {
      if (now >= this.deadline) {
        if (this.golden) {
          this.finish();
          return;
        }
        this.positionPlayers();
        this.ball = this.newBall();
        this.possessionTeam = null;
        this.passes = 0;
        this.passFrom = null;
        this.phase = "KICKOFF_COUNTDOWN";
        this.deadline = now + 3000;
      }
      return;
    }
    if (!["PLAYING", "GOLDEN_GOAL"].includes(this.phase)) return;
    if (!this.golden) {
      const before = this.remaining;
      this.remaining = Math.max(0, this.remaining - dt);
      if (
        !this.reorgDone &&
        this.config.duration > REORG.remaining &&
        before > REORG.remaining &&
        this.remaining <= REORG.remaining
      ) {
        this.remaining = REORG.remaining;
        this.beginReorg(now);
        return;
      }
      if (before > 60 && this.remaining <= 60) this.emit("final_minute");
      if (this.remaining === 0) {
        if (this.score.LEADERS === this.score.WORKERS) {
          this.golden = true;
          this.phase = "GOLDEN_GOAL";
          this.emit("golden_goal_started");
        } else {
          this.finish();
          return;
        }
      }
    }
    for (const p of this.players.values()) {
      if (p.bot) {
        const dir = p.team === "LEADERS" ? 1 : -1;
        const teammates = [...this.players.values()].filter(
          (q) => q.team === p.team && !q.keeper,
        );
        const rank = [...teammates].sort(
          (a, b) =>
            Math.hypot(a.x - this.ball.x, a.y - this.ball.y) -
            Math.hypot(b.x - this.ball.x, b.y - this.ball.y),
        );
        const index = Math.max(
          0,
          teammates.findIndex((q) => q.id === p.id),
        );
        const owns = this.ball.owner === p.id;
        const owner = this.ball.owner
          ? this.players.get(this.ball.owner)
          : null;
        let tx = this.ball.x,
          ty = this.ball.y;
        if (
          p.keeper &&
          !this.inArea({ ...p, x: this.ball.x, y: this.ball.y })
        ) {
          tx = p.team === "LEADERS" ? 75 : 1125;
          ty = clamp(this.ball.y, 260, 440);
        } else if (owns) {
          tx = p.team === "LEADERS" ? 1230 : -30;
          ty = 350;
        } else if (
          owner?.team === p.team ||
          rank.findIndex((q) => q.id === p.id) > 1
        ) {
          tx = clamp(
            this.ball.x +
              dir * (owner?.team === p.team ? 200 : -170) +
              (index % 2) * dir * 70,
            180,
            1020,
          );
          ty = 120 + (index % 4) * 150;
        }
        const dx = tx - p.x,
          dy = ty - p.y,
          d = Math.hypot(dx, dy),
          scale = Math.max(d, 60);
        const attacking = p.team === "LEADERS" ? p.x > 760 : p.x < 440;
        const hold = attacking ? 720 : 140;
        this.input(
          p.id,
          {
            x: dx / scale,
            y: dy / scale,
            action: owns && (!p.chargeAt || now - p.chargeAt < hold),
            dash: !owns && d > 220 && Math.sin(now / 1300 + index) > 0.99,
          },
          now,
        );
      }
      if (!p.connected) {
        p.input = blank();
        p.chargeAt = 0;
        p.dashUntil = 0;
      } else if (now - p.inputAt > 350) {
        // Freeze movement on stalled input, but keep the button edge so an explicit
        // release still works after a rendering/network stall. Never auto-fire stale input.
        p.input = { x: 0, y: 0, action: p.input.action, dash: false };
        p.dashUntil = 0;
      }
      let { x, y } = p.input;
      const len = Math.hypot(x, y);
      if (len > 0.08) {
        x /= Math.max(1, len);
        y /= Math.max(1, len);
        p.fx = x / Math.hypot(x, y);
        p.fy = y / Math.hypot(x, y);
      }
      if (now < p.dashUntil && len <= 0.08) {
        x = p.fx;
        y = p.fy;
      }
      const speed = now < p.dashUntil ? 650 : 225;
      p.x = clamp(p.x + x * speed * dt, F.radius, F.width - F.radius);
      p.y = clamp(p.y + y * speed * dt, F.radius, F.height - F.radius);
      if (p.chargeAt && now - p.chargeAt >= 1100 && now - p.inputAt <= 350) {
        if (this.ball.owner === p.id) this.release(1, now);
        p.chargeAt = 0;
      }
    }
    const ps = [...this.players.values()];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i],
          b = ps[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy) || 0.01;
        if (d < 44) {
          const force = 44 - d;
          const share =
            now < a.dashUntil === now < b.dashUntil
              ? 0.5
              : now < a.dashUntil
                ? 0.2
                : 0.8;
          const nx = d < 0.1 ? 1 : dx / d,
            ny = d < 0.1 ? 0 : dy / d;
          a.x = clamp(a.x - nx * force * share, 17, 1183);
          b.x = clamp(b.x + nx * force * (1 - share), 17, 1183);
          a.y = clamp(a.y - ny * force * share, 17, 683);
          b.y = clamp(b.y + ny * force * (1 - share), 17, 683);
        }
      }
    const ball = this.ball;
    let owner = ball.owner ? this.players.get(ball.owner) : undefined;
    if (owner && (!owner.connected || !this.players.has(owner.id))) {
      ball.owner = null;
      owner = undefined;
    }
    if (owner) {
      const secure =
        (owner.keeper && this.inArea(owner) && now - ball.heldAt < 2000) ||
        now - ball.heldAt < 450;
      const thief = ps.find(
        (p) =>
          p.connected &&
          p.team !== owner!.team &&
          Math.hypot(p.x - owner!.x, p.y - owner!.y) <
            (now < p.dashUntil ? 70 : 51),
      );
      if (thief && !secure) {
        Object.assign(ball, {
          owner: thief.id,
          lastTouch: thief.id,
          heldAt: now,
          vx: 0,
          vy: 0,
          lockUntil: now + 150,
          x: clamp(thief.x + thief.fx * 29, 9, 1191),
          y: clamp(thief.y + thief.fy * 29, 9, 691),
        });
        this.possessionTeam = thief.team;
        this.passes = 0;
        this.passFrom = null;
      } else {
        ball.x = clamp(owner.x + owner.fx * 29, 9, 1191);
        ball.y = clamp(owner.y + owner.fy * 29, 9, 691);
        if (owner.keeper && this.inArea(owner) && now - ball.heldAt >= 2000)
          this.release(0.3, now);
        return;
      }
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const friction = Math.pow(0.985, dt * 30);
    ball.vx *= friction;
    ball.vy *= friction;
    if (ball.y < 9 || ball.y > 691) {
      ball.y = clamp(ball.y, 9, 691);
      ball.vy *= -0.85;
    }
    const inGoal =
      ball.y - F.ballRadius > F.goalTop && ball.y + F.ballRadius < F.goalBottom;
    if (inGoal && (ball.x < -F.ballRadius || ball.x > F.width + F.ballRadius)) {
      this.goal(ball.x < 0 ? "WORKERS" : "LEADERS", now);
      return;
    }
    if (!inGoal && (ball.x < 9 || ball.x > 1191)) {
      ball.x = clamp(ball.x, 9, 1191);
      ball.vx *= -0.85;
    }
    if (now >= ball.lockUntil) {
      const near = ps
        .filter(
          (p) =>
            p.connected &&
            Math.hypot(p.x - ball.x, p.y - ball.y) <
              (p.keeper && this.inArea(p) ? 54 : 34),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - ball.x, a.y - ball.y) -
            Math.hypot(b.x - ball.x, b.y - ball.y),
        )[0];
      if (near) {
        if (this.possessionTeam !== near.team) {
          this.passes = 0;
          this.possessionTeam = near.team;
        } else if (this.passFrom && this.passFrom !== near.id) this.passes++;
        this.passFrom = null;
        Object.assign(ball, {
          owner: near.id,
          lastTouch: near.id,
          vx: 0,
          vy: 0,
          heldAt: now,
        });
      }
    }
  }
  inArea(p: Player) {
    return (
      (p.team === "LEADERS" ? p.x < 155 : p.x > 1045) && p.y > 205 && p.y < 495
    );
  }
  snapshot(now: number): Snapshot {
    return {
      now,
      phase: this.phase,
      deadline: this.deadline,
      remaining: this.remaining,
      score: this.score,
      players: [...this.players.values()],
      ball: this.ball,
      celebration: this.celebration,
      reorg: this.reorg,
      golden: this.golden,
      ended: this.ended,
      predictions: this.predictions.summary(this.phase, this.score, this.ended),
      maxTeamSize: this.config.maxTeamSize,
      dev: this.config.dev,
      event: this.event,
    };
  }
}
