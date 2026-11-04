import type { Snapshot } from "./shared";
export type Camera = { x: number; y: number; zoom: number };
export type Viewport = { width: number; height: number };
export const CAMERA_ELEVATION = Math.atan2(19, 7.5);
const reference: Viewport = { width: 1320, height: 800 };
export const overview = (): Camera => ({ x: 660, y: 400, zoom: 1 });
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Orthographic half extents at zoom 1, in game units (100 units = 1m). */
export function cameraFrustum(viewport: Viewport) {
  const aspect = Math.max(0.25, viewport.width / Math.max(1, viewport.height));
  const halfHeight = 415 * Math.max(1, 1.65 / aspect);
  return { halfWidth: halfHeight * aspect, halfHeight };
}
/** Footprint on the ground; the overhead angle also affects vertical framing. */
export function visibleHalfExtents(
  view: Camera,
  viewport: Viewport = reference,
) {
  const frustum = cameraFrustum(viewport);
  return {
    x: frustum.halfWidth / view.zoom,
    y: frustum.halfHeight / view.zoom / Math.sin(CAMERA_ELEVATION),
  };
}
function bound(view: Camera, viewport: Viewport) {
  const half = visibleHalfExtents(view, viewport);
  // Allow a little stadium beyond the touchline. Otherwise a corner ball ends
  // up underneath phone controls while the camera tries to contain the pitch.
  const x = Math.min(660, half.x * 0.55),
    y = Math.min(400, half.y * 0.4);
  return {
    zoom: view.zoom,
    x: clamp(view.x, x, 1320 - x),
    y: clamp(view.y, y, 800 - y),
  };
}

/** A close, fixed-orientation camera shared by players, host and projector. */
export function cameraTarget(
  state: Snapshot,
  follow: boolean,
  viewport: Viewport = reference,
): Camera {
  if (!follow || ["WAITING", "REORG", "FINISHED"].includes(state.phase))
    return overview();
  const ball = state.ball;
  const nearby = state.players.filter(
    (p) => p.connected && Math.hypot(p.x - ball.x, p.y - ball.y) < 300,
  );
  const spread = Math.max(
    0,
    ...nearby.map((p) => Math.hypot(p.x - ball.x, p.y - ball.y)),
  );
  const speed = Math.hypot(ball.vx, ball.vy);
  const actionWidth = clamp(750 + spread * 0.18 + speed * 0.1, 750, 900);
  // Fit the action's width, not the whole pitch or a fixed screen-height zoom.
  // This is especially important on a very wide, short Safari viewport.
  const zoom = clamp(
    (cameraFrustum(viewport).halfWidth * 2) / actionWidth,
    1.6,
    4.8,
  );
  return bound(
    {
      zoom,
      x: ball.x + 60 + clamp(ball.vx * 0.08, -70, 70),
      y:
        ball.y +
        50 +
        clamp(ball.vy * 0.07, -45, 45) +
        visibleHalfExtents({ x: 0, y: 0, zoom }, viewport).y * 0.1,
    },
    viewport,
  );
}

export function smoothCamera(
  current: Camera,
  target: Camera,
  dt: number,
  viewport: Viewport = reference,
  focus?: { x: number; y: number },
): Camera {
  const step = Math.min(0.1, Math.max(0, dt));
  const pan = 1 - Math.exp(-step * 9),
    zoom = 1 - Math.exp(-step * 3.5);
  const next = {
    x: current.x + (target.x - current.x) * pan,
    y: current.y + (target.y - current.y) * pan,
    zoom: current.zoom + (target.zoom - current.zoom) * zoom,
  };
  if (focus) {
    const half = visibleHalfExtents(next, viewport);
    // Fast shots and network corrections cannot drag the ball out of view.
    next.x = clamp(next.x, focus.x - half.x * 0.42, focus.x + half.x * 0.42);
    next.y = clamp(next.y, focus.y - half.y * 0.52, focus.y + half.y * 0.52);
  }
  return bound(next, viewport);
}
