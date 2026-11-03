import type { Snapshot } from "./shared";
export type Camera = { x: number; y: number; zoom: number };
export const overview = (): Camera => ({ x: 660, y: 400, zoom: 1 });
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
/** Broadcast framing in the renderer's 1320 × 800 coordinates. */
export function cameraTarget(state: Snapshot, follow: boolean): Camera {
  if (!follow || !["PLAYING", "GOLDEN_GOAL"].includes(state.phase))
    return overview();
  const ball = state.ball;
  // Widen for fast shots and spread-out play; tighten around contested possession.
  const nearby = state.players.filter(
    (p) => p.connected && Math.hypot(p.x - ball.x, p.y - ball.y) < 360,
  );
  const spread = Math.max(
    0,
    ...nearby.map((p) => Math.hypot(p.x - ball.x, p.y - ball.y)),
  );
  const speed = Math.hypot(ball.vx, ball.vy);
  const zoom = clamp(1.48 - spread / 1600 - speed / 3200, 1.12, 1.48);
  const halfWidth = 660 / zoom,
    halfHeight = 400 / zoom;
  return {
    zoom,
    x: clamp(
      ball.x + 60 + clamp(ball.vx * 0.12, -90, 90),
      halfWidth,
      1320 - halfWidth,
    ),
    y: clamp(
      ball.y + 50 + clamp(ball.vy * 0.1, -55, 55),
      halfHeight,
      800 - halfHeight,
    ),
  };
}
export function smoothCamera(
  current: Camera,
  target: Camera,
  dt: number,
): Camera {
  const pan = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * 4.5);
  const zoom = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * 2.5);
  const nextZoom = current.zoom + (target.zoom - current.zoom) * zoom;
  return {
    x: clamp(
      current.x + (target.x - current.x) * pan,
      660 / nextZoom,
      1320 - 660 / nextZoom,
    ),
    y: clamp(
      current.y + (target.y - current.y) * pan,
      400 / nextZoom,
      800 - 400 / nextZoom,
    ),
    zoom: nextZoom,
  };
}

/** Phone play follows the controlled player, keeping orientation fixed. */
export function playerCameraTarget(
  state: Snapshot,
  localId: string,
  height: number,
): Camera {
  const player = state.players.find((p) => p.id === localId);
  if (!player || !["PLAYING", "GOLDEN_GOAL"].includes(state.phase))
    return overview();
  // Preserve a useful character size when Safari leaves only a short viewport.
  const zoom = clamp(440 / Math.max(160, height), 1.6, 2.2);
  const ownBall = state.ball.owner === localId;
  const leadX = ownBall
    ? player.fx * 70
    : clamp((state.ball.x - player.x) * 0.25, -100, 100);
  const leadY = ownBall
    ? player.fy * 50
    : clamp((state.ball.y - player.y) * 0.2, -65, 65);
  return {
    x: clamp(player.x + 60 + leadX, 660 / zoom, 1320 - 660 / zoom),
    y: clamp(player.y + 50 + leadY, 400 / zoom, 800 - 400 / zoom),
    zoom,
  };
}
