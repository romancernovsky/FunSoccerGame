# Office Arena — Leaders vs Workers

An original browser football game for one live meeting: up to six Leaders against six Workers, a host, and a projector. TypeScript, Three.js/WebGL 3D rendering and native WebSockets; one Node service, one in-memory match, no database.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
HOST_PIN=choose-your-pin npm run dev
```

Open `http://localhost:3000` for the spectator lobby, `/join` for players, `/host` for administration and `/screen` for the projector. The root route is a spectator view. Vite is integrated into the Node development service, so one command starts everything. The server listens on all interfaces. Phones on the same network should open `http://YOUR-LAN-IP:3000/join`; open the projector using that same address so its QR code is reachable from phones. Separate browser profiles or private windows simulate different players; tabs in one profile share the temporary player session.

The development host console includes **Fill with Test Players**. All bots are labeled TEST PLAYER. This command is rejected by the production server even if called directly.

## Play and host

Players enter a unique 1–12 character name and choose a team. The host can move/remove players and toggle a team's one optional goalkeeper before starting. At least one connected player on each side is required. Incomplete teams need an explicit confirmation; uneven teams are allowed and visibly flagged. Full teams never start automatically.

- Move: WASD/arrows, or the left touch joystick.
- Pass: tap Space or PASS / SHOOT. Nearby teammates in front receive gentle aim assistance.
- Shoot: hold and release Space or PASS / SHOOT. Charge maxes in one second and automatically releases after 1.1 seconds.
- Dash: Shift or DASH. Short burst with a 2.5-second cooldown.
- Steal: contact the opponent; dashing increases reach. No health or elimination.
- Goalkeeper: larger interception range inside their marked area and secure possession for at most two seconds before automatic release.

The five-minute clock pauses for celebrations, kickoff countdowns and host pauses. Three or more completed passes in the same team possession earn TEAM GOAL recognition. Ties enter unlimited Golden Goal. Host pause/resume, confirmed restart/end, rematch and new match are supported. Rematch keeps players and roles; new match clears them.

Enable sound with the button on the projector after an initial browser interaction. Host audio is separately opt-in; leave it off when the projector is the audio source. Phones are silent. All effects are original synthesized tones and filtered noise, including the goal cheer; no third-party sound assets. Display graphics and characters are drawn in code. UI fonts are self-hosted Barlow Condensed and DM Sans (SIL Open Font License), with system fallbacks. The event UI makes no external font requests.

## Production

```sh
npm run build
NODE_ENV=production HOST_PIN=choose-your-pin PORT=8080 npm start
```

```sh
docker build -t office-arena .
docker run --rm -p 8080:8080 -e HOST_PIN=choose-your-pin office-arena
```

The production Dockerfile supports both the legacy Docker builder used by Cloud Build and BuildKit. It uses standard `npm ci` without secret mounts or session-specific certificate paths. To check legacy-builder compatibility, run `DOCKER_BUILDKIT=0 docker build -t office-arena .`. After a Dockerfile fix, trigger deployment from the latest `main` commit; retrying an older build keeps its original source commit.

`HOST_PIN` is required; the server refuses to start without it. It is never sent to clients or compiled into the frontend. `.env.example` lists configuration; this project does not automatically load `.env` files.

| Variable                | Default             | Range / purpose                                        |
| ----------------------- | ------------------- | ------------------------------------------------------ |
| HOST_PIN                | required            | Host WebSocket authentication                          |
| PORT                    | 3000 (Docker: 8080) | HTTP and WebSocket port                                |
| MATCH_DURATION_SECONDS  | 300                 | 1–3600 seconds of active play                          |
| MAX_TEAM_SIZE           | 6                   | 1–6                                                    |
| RECONNECT_GRACE_SECONDS | 20                  | 5–120                                                  |
| GAME_TICK_RATE          | 30                  | 20–30 Hz                                               |
| NODE_ENV                | development         | Set `production` to serve built files and disable bots |

## Google Cloud Run

Use a GCP project with billing, Cloud Run and Cloud Build enabled. From this directory, with `gcloud` authenticated to that project:

```sh
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
# Create a secret without putting the PIN in source or deployment configuration.
read -r -s -p 'Event host PIN: ' EVENT_HOST_PIN
printf '%s' "$EVENT_HOST_PIN" | gcloud secrets create office-arena-host-pin --data-file=-
unset EVENT_HOST_PIN
```

Grant the runtime service account `roles/secretmanager.secretAccessor` on this secret. Replace the placeholders below with that account, your project number and preferred region. The account needs no other application permissions.

```sh
gcloud secrets add-iam-policy-binding office-arena-host-pin \
  --member='serviceAccount:YOUR_RUNTIME_ACCOUNT' \
  --role='roles/secretmanager.secretAccessor'
gcloud run deploy office-arena --source . --region europe-west1 \
  --service-account YOUR_RUNTIME_ACCOUNT --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --concurrency 80 \
  --cpu 1 --memory 512Mi --timeout 3600 --no-cpu-throttling \
  --set-env-vars NODE_ENV=production \
  --set-secrets HOST_PIN=office-arena-host-pin:latest
```

Cloud Run supplies `PORT` and TLS. Deploy a single revision receiving 100% of traffic; don't split traffic, use parallel revisions, or deploy during an event. Each process has separate memory. Min/max one and always-allocated CPU preserve the narrow single-match architecture, but infrastructure replacement can still lose the match. No persistence is promised. Keep the service running during the event, then reduce minimum instances to avoid ongoing idle cost.

WebSockets use same-origin `/ws`. One-hour request timeout exceeds the typical meeting session; clients reconnect automatically with a 20-second reserved slot. The player token is stored only in that browser's local storage and disappears on New Match/server reset. Refreshing host requires PIN again and does not reset state. Authentication is connection-scoped. Health probe: `/healthz`. Structured JSON events go directly to Cloud Logging. Avoid logging host PINs or session tokens.

Live Cloud Run deployment was not performed in this workspace because no GCP identity or project is configured.

## Verification

```sh
npm run check
npm test
npm run build
# System Chromium is used by default. Set CHROMIUM_PATH to your browser binary.
npm run test:browser
```

Unit tests cover join/capacity, roles, starts, phases, goals, timing, Golden Goal, reconnection and reset behavior. Network integration tests launch a separate production server and verify host authorization and production bot rejection. Browser tests cover the host/projector lifecycle with realtime test clients, desktop movement and character restoration after refresh, and mobile team choice, orientation and touch controls. Actual WebGL rendering is enabled. Tests do not prove real iOS Safari/Android Chrome or corporate Wi-Fi reliability; those require a physical-device rehearsal.

For load testing, run the development server and `npm run test:load`. This connects 20 WebSocket clients, joins 12 players, starts a match with an authenticated host, sends simultaneous inputs and checks synchronized snapshots. Override `LOAD_URL` and `LOAD_HOST_PIN` if needed. Do not run this against a live event lobby.

Before the event, rehearse on the actual Wi-Fi with 12 phones and the projector: join/scan, landscape controls, pass/shoot, audio unlock, briefly toggle one phone's network, and verify reconnect. Corporate networks may isolate phones or block WebSocket upgrades. Touch emulation is not a substitute for this rehearsal.

## Architecture

`server/game.ts` contains the authoritative simulation and state machine. `server/index.ts` validates WebSocket messages, limits input to 80 messages/second, applies connection-scoped host authorization, rate limits PIN attempts, handles reconnect identity and serves the frontend. Clients never submit position, score, charge duration or match time. Server-calculated charge, input expiry, bounded movement, deterministic goal checks and fixed target ticks own gameplay. Snapshot bandwidth is bounded for the intended 20 connections; slow consumers are disconnected instead of accumulating messages. The browser interpolates snapshots in the 3D view at up to 30 frames per second and captures touch pointers for forgiving controls.

No production bots, accounts, rooms, persistent statistics or external data services are included.

## Host live broadcast

After START MATCH, `/host` automatically displays the live arena, synchronized countdown, score, clock and celebrations above the match controls. The default ball-follow camera gently pans toward play and adjusts zoom for ball speed and nearby players. A full-field minimap shows every player while zoomed in. Countdown, pause, goal and final screens return to the overview. Player and `/screen` cameras remain full-field.

Use **Full field / Ball-follow camera** to switch framing. **Broadcast mode** hides administration, rosters and navigation, fits the arena to the window and requests browser fullscreen. Share this host browser tab or window in the meeting. Move the pointer over the field to reveal camera, audio and exit controls; press Escape to return to administration. Enable sound on the host if broadcasting its tab audio, and avoid also playing the projector audio. Broadcast mode is local to the host browser and does not pause or change the match; exiting it restores the controls.

## Visual presentation and review

The arena uses a real Three.js scene with original modeled stadium architecture, instanced seating/crowd, 3D goal nets, and articulated toy-like player models. Depth sorting, collision-aware nameplates, ball trails, team lighting and goal particles keep live play readable. Mobile players have a bright YOU marker, possession hint, shot-charge ring and dash cooldown. Turf is a cached high-resolution texture; crowd geometry is instanced. Hemispheric and directional lighting, soft cached contact shadows, and adaptive pixel resolution keep the scene readable. The renderer warms up in the lobby. The authoritative rules remain on a planar pitch; rendering is real 3D.

An independent critic reviewed the 2D iterations and the 3D conversion and scored the previous 2D version 8.3/10 and the final **3D version 8.2/10**. See [VISUAL_REVIEW.md](VISUAL_REVIEW.md) for findings and screenshot provenance. Review screenshots are generated local artifacts in `artifacts/final-screenshots/`; `artifacts/office-arena-screenshots.zip` contains the set. These are excluded from Git; the capture helpers can reproduce them. Screenshot capture helpers in `scripts/capture-*.mjs` are for an isolated development server only: they reset its lobby and create test players.

The 3D browser view requires WebGL 2. If unavailable, the application displays a clear graphics message. On graphics-context loss it stops local controls and restores the scene when the browser restores WebGL. A temporary host connection loss reauthenticates using the PIN held only in that tab’s memory; refreshing the page still requires PIN entry. Input stalls stop movement and prevent stale automatic shots, while a later explicit release still works.

## The Reorg surprise

Once per match, when the authoritative clock reaches **02:00**, the organization gets a surprise Reorg. Play and the match clock stop. Players are randomly redistributed by the server, with their identities and session tokens retained. There is a two-second surprise introduction, ten seconds to read both new rosters on one screen, then a synchronized three-second countdown into a center kickoff. These fifteen seconds do not consume match time.

Scores stay with LEADERS and WORKERS. Current team sizes are retained and capacities are respected; a reshuffle always exchanges at least two players when both teams have members. If departures have emptied a team, remaining players are split into two sides where possible. When both teams had connected players, the shuffle keeps a connected player on both sides. Existing goalkeeper slots are preserved, with at most one assigned keeper per new team; teams without a keeper slot are not forced to have one.

The host, projector and player screens show the same server-owned assignments. Phones highlight the local player's new team and hide gameplay controls during the reveal. The roster uses the full phone width, including short landscape and portrait layouts. Jerseys, nameplate colors, team identity and goalkeeper gloves update from the new authoritative assignments. The ball, positions, dash/charge state and pass sequence reset for kickoff; names, identities, score and the two remaining minutes are kept.

Host Pause/Resume freezes and restores the remaining reveal time. Refresh/reconnection restores the same new team rather than reshuffling again. Restart/Rematch rearms the surprise for the next full match while retaining the current players/teams; New Match clears it. Golden Goal does not trigger another Reorg. Custom matches of 120 seconds or less skip the event.

```sh
npm test
npm run test:reorg
```

The dedicated browser check starts an isolated 126-second development match, so the event arrives after six seconds of actual play. It verifies the 1v1 team swap, orange-to-blue 3D kit change, locked clock/controls, pause and player refresh during the reveal, synchronized kickoff, and movement after play resumes. Reorg screenshots are in `artifacts/reorg/`. The capture helper uses only isolated TEST participants and holds genuine REORG snapshots during still capture; it does not inject assignments or scores.
