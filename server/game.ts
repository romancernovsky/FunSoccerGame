import { Predictions } from "./predictions.js";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_MATCH_DURATION_SECONDS,
  FIELD as F,
  MULTIBALL_COUNTDOWN_SECONDS,
  TEAMS,
  type Team,
  type Phase,
  type Player,
  type Ball,
  type Input,
  type Snapshot,
  type GameEvent,
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
  score = { BLUE: 0, ORANGE: 0 };
  private ballSequence = 0;
  balls: Ball[] = [this.newBall()];
  multiball = false;
  // The primary live ball remains available for existing tooling and snapshots.
  get ball(): Ball {
    return this.balls.find((b) => !b.scored) ?? this.balls[0];
  }
  set ball(ball: Ball) {
    this.balls = [ball];
  }
  get possessionTeam() {
    return this.ball.possessionTeam;
  }
  set possessionTeam(team: Team | null) {
    this.ball.possessionTeam = team;
  }
  get passes() {
    return this.ball.passes;
  }
  set passes(passes: number) {
    this.ball.passes = passes;
  }
  get passFrom() {
    return this.ball.passFrom;
  }
  set passFrom(id: string | null) {
    this.ball.passFrom = id;
  }
  private ownedBall(id: string) {
    return this.balls.find((b) => !b.scored && b.owner === id);
  }
  celebration: Celebration | null = null;
  finalMinuteAnnounced = false;
  golden = false;
  ended = false;
  event = { id: 0, kind: "ready" };
  private events: GameEvent[] = [];
  private eventTime = 0;
  resumePhase: Phase = "PLAYING";
  pausedDeadline = 0;
  nextId = 0;
  constructor(
    public config = {
      duration: DEFAULT_MATCH_DURATION_SECONDS,
      maxTeamSize: 6,
      grace: 20,
      dev: false,
    },
    public log: (kind: string, data?: unknown) => void = () => {},
  ) {
    this.remaining = config.duration;
  }
  newBall(): Ball {
    return {
      id: `ball-${++this.ballSequence}`,
      height: 0,
      vz: 0,
      scored: false,
      possessionTeam: null,
      passes: 0,
      passFrom: null,
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
    const event = this.sound(kind, this.eventTime);
    this.event = { id: event.id, kind };
    this.log(kind, data);
  }
  private sound(kind: string, at: number) {
    const event = { id: ++this.nextId, kind, at };
    this.events.push(event);
    if (this.events.length > 32) this.events.shift();
    return event;
  }
  count(team: Team, connected = false) {
    return [...this.players.values()].filter(
      (p) => p.team === team && (!connected || p.connected),
    ).length;
  }
  join(name: unknown, team: unknown, now: number) {
    this.eventTime = now;
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
      fx: team === "BLUE" ? 1 : -1,
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
    this.eventTime = now;
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
    this.eventTime = now;
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
    const ball = this.ownedBall(id);
    if (ball) this.release(0.2, this.eventTime, ball);
    this.players.delete(id);
    for (const [t, p] of this.sessions) if (p === id) this.sessions.delete(t);
  }
  positionPlayers() {
    for (const team of TEAMS) {
      const ps = [...this.players.values()].filter((p) => p.team === team);
      const field = ps.filter((p) => !p.keeper);
      ps.forEach((p) => {
        // Evenly space each side on its own semicircle, leaving a gap at the
        // halfway line. Single-player sides start opposite one another.
        const index = field.indexOf(p);
        const angle =
          (team === "BLUE" ? Math.PI : 0) +
          (field.length <= 1
            ? 0
            : (-Math.PI * 7) / 18 +
              (index * Math.PI * 7) / 9 / (field.length - 1));
        p.x = p.keeper
          ? team === "BLUE"
            ? 70
            : 1130
          : F.width / 2 + Math.cos(angle) * F.centerCircleRadius;
        p.y = p.keeper
          ? F.height / 2
          : F.height / 2 + Math.sin(angle) * F.centerCircleRadius;
        p.fx = team === "BLUE" ? 1 : -1;
        p.fy = 0;
        p.input = blank();
        p.chargeAt = 0;
        p.dashUntil = 0;
        p.dashReady = 0;
      });
    }
  }
  command(action: string, data: Record<string, unknown>, now: number) {
    this.eventTime = now;
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
          const team = p.team === "BLUE" ? "ORANGE" : "BLUE";
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
            "RULES_COUNTDOWN",
            "KICKOFF_COUNTDOWN",
            "GOAL",
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
    this.events = [];
    this.remaining = this.config.duration;
    this.score = { BLUE: 0, ORANGE: 0 };
    this.ball = this.newBall();
    this.multiball = false;
    this.golden = false;
    this.ended = false;
    this.celebration = null;
    this.finalMinuteAnnounced = false;
    this.passes = 0;
    this.passFrom = null;
    this.possessionTeam = null;
    this.positionPlayers();
  }
  start(now: number) {
    this.eventTime = now;
    this.predictions.closed = false;
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
    this.predictions.closed = true;
    this.phase = "FINISHED";
    this.clearInputs();
    this.emit("match_finished", { score: this.score, ended: this.ended });
  }
  input(id: string, v: unknown, now: number) {
    this.eventTime = now;
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
    if (a.action && !p.input.action) {
      p.chargeAt = now;
      if (this.ownedBall(id)) this.sound("shot_charge", now);
    }
    if (!a.action && p.input.action) {
      const ball = this.ownedBall(id);
      if (ball && p.chargeAt)
        this.release(clamp((now - p.chargeAt) / 1000, 0, 1), now, ball);
      p.chargeAt = 0;
    }
    if (a.dash && !p.input.dash && now >= p.dashReady) {
      p.dashUntil = now + 170;
      p.dashReady = now + 2500;
      this.sound("dash", now);
    }
    p.input = { ...a };
    p.inputAt = now;
  }
  release(charge: number, now: number, ball: Ball = this.ball) {
    this.eventTime = now;
    const p = !ball.scored && ball.owner && this.players.get(ball.owner);
    if (!p) return;
    let fx = p.fx,
      fy = p.fy;
    if (ball.possessionTeam !== p.team) {
      ball.possessionTeam = p.team;
      ball.passes = 0;
    }
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
      ball.passFrom = p.id;
    } else ball.passFrom = null;
    const speed = 440 + charge * 650;
    Object.assign(ball, {
      owner: null,
      vx: fx * speed,
      vy: fy * speed,
      lastTouch: p.id,
      lockUntil: now + 220,
    });
    this.emit(charge < 0.22 ? "pass" : "shot");
  }
  goal(team: Team, now: number, ball: Ball = this.ball) {
    if (ball.scored || !["PLAYING", "GOLDEN_GOAL"].includes(this.phase)) return;
    this.eventTime = now;
    this.score[team]++;
    if (this.golden) this.predictions.closed = true;
    const shooter = ball.lastTouch
      ? this.players.get(ball.lastTouch)
      : undefined;
    this.celebration = {
      at: now,
      team,
      scorer: shooter?.name ?? "TEAM",
      passes: ball.possessionTeam === team ? ball.passes : 0,
      id: ++this.nextId,
    };
    ball.scored = true;
    ball.owner = null;
    ball.vx = ball.vy = 0;
    if (!this.multiball || this.golden || this.balls.every((b) => b.scored)) {
      this.phase = "GOAL";
      this.deadline = now + 3000;
      this.clearInputs();
    }
    this.emit("goal_scored", { ...this.celebration, ballId: ball.id });
    if (this.celebration.passes >= 3) this.sound("team_goal", now);
  }
  private prepareKickoff() {
    this.positionPlayers();
    this.ball = this.newBall();
    this.celebration = null;
  }
  private dropExtraBalls(now: number) {
    if (!this.multiball || this.balls.length !== 1) return;
    for (const [dx, dy] of [
      [-40, -30],
      [40, 30],
    ]) {
      const ball = this.newBall();
      Object.assign(ball, { x: 600 + dx, y: 350 + dy, height: 300 });
      this.balls.push(ball);
    }
    this.emit("balls_dropped");
  }
  private beginNewRules(now: number) {
    this.finalMinuteAnnounced = true;
    this.multiball = true;
    this.remaining = 60;
    this.prepareKickoff();
    this.phase = "RULES_COUNTDOWN";
    this.deadline = now + MULTIBALL_COUNTDOWN_SECONDS * 1000;
    this.emit("final_minute");
  }
  tick(dt: number, now: number) {
    this.eventTime = now;
    for (const p of [...this.players.values()])
      if (!p.connected && now - p.disconnectedAt > this.config.grace * 1000)
        this.remove(p.id);
    if (
      ["COUNTDOWN", "KICKOFF_COUNTDOWN", "RULES_COUNTDOWN"].includes(this.phase)
    ) {
      if (now >= this.deadline) {
        this.dropExtraBalls(now);
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
        this.prepareKickoff();
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
        !this.finalMinuteAnnounced &&
        this.config.duration > 60 &&
        before >= 60 &&
        this.remaining <= 60
      ) {
        this.beginNewRules(now);
        return;
      }
      if (this.remaining === 0) {
        if (this.score.BLUE === this.score.ORANGE) {
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
        const liveBalls = this.balls.filter((b) => !b.scored);
        const ball =
          this.ownedBall(p.id) ??
          liveBalls.reduce((a, b) =>
            Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y)
              ? a
              : b,
          );
        const dir = p.team === "BLUE" ? 1 : -1;
        const teammates = [...this.players.values()].filter(
          (q) => q.team === p.team && !q.keeper,
        );
        const rank = [...teammates].sort(
          (a, b) =>
            Math.hypot(a.x - ball.x, a.y - ball.y) -
            Math.hypot(b.x - ball.x, b.y - ball.y),
        );
        const index = Math.max(
          0,
          teammates.findIndex((q) => q.id === p.id),
        );
        const owns = ball.owner === p.id;
        const owner = ball.owner ? this.players.get(ball.owner) : null;
        let tx = ball.x,
          ty = ball.y;
        if (p.keeper && !this.inArea({ ...p, x: ball.x, y: ball.y })) {
          tx = p.team === "BLUE" ? 75 : 1125;
          ty = clamp(ball.y, 260, 440);
        } else if (owns) {
          tx = p.team === "BLUE" ? 1230 : -30;
          ty = 350;
        } else if (
          owner?.team === p.team ||
          rank.findIndex((q) => q.id === p.id) > 1
        ) {
          tx = clamp(
            ball.x +
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
        const attacking = p.team === "BLUE" ? p.x > 760 : p.x < 440;
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
        const ball = this.ownedBall(p.id);
        if (ball) this.release(1, now, ball);
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
    for (const ball of this.balls) {
      if (!ball.scored) this.simulateBall(ball, dt, now, ps);
      // A winning Golden Goal, or the third scored ball, ends this simulation tick.
      if (!["PLAYING", "GOLDEN_GOAL"].includes(this.phase)) break;
    }
    this.collideBalls();
  }
  private simulateBall(ball: Ball, dt: number, now: number, ps: Player[]) {
    if (ball.height > 0 || ball.vz !== 0) {
      ball.vz -= 900 * dt;
      ball.height += ball.vz * dt;
      if (ball.height <= 0) {
        ball.height = 0;
        ball.vz = -ball.vz > 160 ? -ball.vz * 0.24 : 0;
        this.sound("ball_landed", now);
      }
      return; // A falling ball cannot be possessed, blocked or scored mid-air.
    }
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
          !this.ownedBall(p.id) &&
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
        ball.possessionTeam = thief.team;
        ball.passes = 0;
        ball.passFrom = null;
        this.sound("tackle", now);
      } else {
        ball.x = clamp(owner.x + owner.fx * 29, 9, 1191);
        ball.y = clamp(owner.y + owner.fy * 29, 9, 691);
        if (owner.keeper && this.inArea(owner) && now - ball.heldAt >= 2000)
          this.release(0.3, now, ball);
        return;
      }
    }
    // Small travel steps prevent a charged shot from skipping a player's body
    // at the event server's 20–30 Hz simulation rate.
    const steps = Math.max(
      1,
      Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / F.ballRadius),
    );
    for (let step = 0; step < steps; step++) {
      ball.x += (ball.vx * dt) / steps;
      ball.y += (ball.vy * dt) / steps;
      // A quick pass is a controllable delivery, not a charged-shot impact.
      // Only the passer is locked out: nearby teammates can receive immediately.
      const passer = ball.passFrom
        ? this.players.get(ball.passFrom)
        : undefined;
      if (passer) {
        const receiver = ps
          .filter(
            (p) =>
              p.connected &&
              p.id !== passer.id &&
              p.team === passer.team &&
              !this.ownedBall(p.id) &&
              Math.hypot(p.x - ball.x, p.y - ball.y) <
                (p.keeper && this.inArea(p) ? 54 : 34),
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - ball.x, a.y - ball.y) -
              Math.hypot(b.x - ball.x, b.y - ball.y),
          )[0];
        if (receiver) {
          this.controlBall(ball, receiver, now);
          return;
        }
      }
      if (Math.hypot(ball.vx, ball.vy) > 240 || now < ball.lockUntil) {
        for (const p of ps) {
          if (!p.connected) continue;
          const radius =
            p.keeper && this.inArea(p) ? 42 : F.radius + F.ballRadius;
          const dx = ball.x - p.x,
            dy = ball.y - p.y,
            distance = Math.hypot(dx, dy);
          if (distance >= radius) continue;
          const speed = Math.hypot(ball.vx, ball.vy);
          const nx = distance > 0.001 ? dx / distance : -ball.vx / (speed || 1),
            ny = distance > 0.001 ? dy / distance : -ball.vy / (speed || 1);
          ball.x = p.x + nx * (radius + 0.1);
          ball.y = p.y + ny * (radius + 0.1);
          const incoming = ball.vx * nx + ball.vy * ny;
          if (incoming >= 0) continue; // Never reflect an already outgoing ball.
          const rebound = speed > 650 ? 0.7 : 0.45;
          ball.vx = (ball.vx - 2 * incoming * nx) * rebound;
          ball.vy = (ball.vy - 2 * incoming * ny) * rebound;
          ball.lastTouch = p.id;
          ball.lockUntil = now + 150;
          if (ball.possessionTeam !== p.team) {
            ball.possessionTeam = p.team;
            ball.passes = 0;
            ball.passFrom = null;
          }
          this.emit(p.keeper && this.inArea(p) ? "keeper_save" : "ball_bounce");
        }
      }
      if (ball.y < F.ballRadius || ball.y > F.height - F.ballRadius) {
        ball.y = clamp(ball.y, F.ballRadius, F.height - F.ballRadius);
        ball.vy *= -0.85;
        if (Math.hypot(ball.vx, ball.vy) > 180) this.sound("wall_bounce", now);
      }
      const inGoal =
        ball.y - F.ballRadius > F.goalTop &&
        ball.y + F.ballRadius < F.goalBottom;
      if (
        inGoal &&
        (ball.x < -F.ballRadius || ball.x > F.width + F.ballRadius)
      ) {
        this.goal(ball.x < 0 ? "ORANGE" : "BLUE", now, ball);
        return;
      }
      if (
        !inGoal &&
        (ball.x < F.ballRadius || ball.x > F.width - F.ballRadius)
      ) {
        ball.x = clamp(ball.x, F.ballRadius, F.width - F.ballRadius);
        ball.vx *= -0.85;
        if (Math.hypot(ball.vx, ball.vy) > 180)
          this.sound(
            ball.y > F.goalTop - 70 && ball.y < F.goalBottom + 70
              ? "near_miss"
              : "wall_bounce",
            now,
          );
      }
    }
    const friction = Math.pow(0.985, dt * 30);
    ball.vx *= friction;
    ball.vy *= friction;
    if (now >= ball.lockUntil && Math.hypot(ball.vx, ball.vy) <= 240) {
      const near = ps
        .filter(
          (p) =>
            p.connected &&
            !this.ownedBall(p.id) &&
            Math.hypot(p.x - ball.x, p.y - ball.y) <
              (p.keeper && this.inArea(p) ? 54 : 34),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - ball.x, a.y - ball.y) -
            Math.hypot(b.x - ball.x, b.y - ball.y),
        )[0];
      if (near) this.controlBall(ball, near, now);
    }
  }
  private controlBall(ball: Ball, player: Player, now: number) {
    const completed =
      ball.possessionTeam === player.team &&
      ball.passFrom &&
      ball.passFrom !== player.id;
    if (ball.possessionTeam !== player.team) {
      ball.passes = 0;
      ball.possessionTeam = player.team;
    } else if (ball.passFrom && ball.passFrom !== player.id) ball.passes++;
    ball.passFrom = null;
    this.sound(
      player.keeper && this.inArea(player)
        ? "keeper_catch"
        : completed
          ? "pass_completed"
          : "ball_control",
      now,
    );
    Object.assign(ball, {
      owner: player.id,
      lastTouch: player.id,
      vx: 0,
      vy: 0,
      heldAt: now,
    });
  }
  private collideBalls() {
    const live = this.balls.filter(
      (b) => !b.scored && !b.owner && b.height === 0 && b.vz === 0,
    );
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i],
          b = live[j];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          distance = Math.hypot(dx, dy);
        if (distance >= F.ballRadius * 2) continue;
        const nx = distance > 0.001 ? dx / distance : 1,
          ny = distance > 0.001 ? dy / distance : 0;
        const push = (F.ballRadius * 2 - distance + 0.1) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (approach > 0) {
          const impulse = approach * 0.85;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
  }
  inArea(p: Player) {
    return (
      (p.team === "BLUE" ? p.x < 155 : p.x > 1045) && p.y > 205 && p.y < 495
    );
  }
  snapshot(now: number, includeEvents = true): Snapshot {
    return {
      now,
      phase: this.phase,
      deadline: this.deadline,
      remaining: this.remaining,
      score: this.score,
      players: [...this.players.values()],
      ball: this.ball,
      balls: this.balls,
      multiball: this.multiball,
      celebration: this.celebration,
      golden: this.golden,
      ended: this.ended,
      predictions: this.predictions.summary(this.phase, this.score, this.ended),
      maxTeamSize: this.config.maxTeamSize,
      dev: this.config.dev,
      event: this.event,
      ...(includeEvents
        ? { events: this.events.filter((event) => now - event.at <= 1500) }
        : {}),
    };
  }
}
