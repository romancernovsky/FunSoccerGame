# Office Arena — Leaders vs Workers

An original browser football game for one live meeting: up to six Leaders against six Workers, a host, and a projector. TypeScript, Three.js/WebGL 3D rendering and native WebSockets; one Node service, one in-memory match, no database.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
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

The three-minute regulation clock pauses for celebrations, kickoff countdowns and host pauses. Three or more completed passes in the same team possession earn TEAM GOAL recognition. Ties enter unlimited Golden Goal. Host pause/resume, confirmed restart/end, rematch and new match are supported. Rematch keeps players and roles; new match clears them.

The public pages (`/join`, the waiting lobby, `/predict` and `/screen`) adapt to narrow phones with 16px body text, 14px control instructions and roster status text, and 44px or larger navigation targets. The waiting lobby uses a compact team heading, two-column control tips and real teammates with an available-spots summary. Empty placeholder rows stay on the desktop host console. Phone spectator lobbies offer a direct join/predict link instead of a QR code; projector screens retain the QR. The host console keeps its existing administration layout.

Players, host and spectator now default to a close overhead camera that follows the ball and nearby action. The steep fixed angle keeps movement directions consistent. Framing adapts to the actual viewport width, so a short landscape phone shows the action rather than most of the pitch. Fast shots get a little more space and responsive camera tracking. **FIELD** shows the full arena; **BALL** restores the action view. A high-contrast ball marker preserves visibility, and an edge **YOU** arrow locates your character when it is outside the frame or underneath a touch control. The attack-direction cue follows your current team.

Native **Full screen** is available only where the browser supports it. Unsupported/rejected requests open screen options instead of claiming success. On iPhone Safari, the guide explains **Share → Add to Home Screen → Add**, then launching **Office Arena** from its icon before joining. Safari's address/tab bars cannot be hidden programmatically from an ordinary tab. The ordinary tab remains playable with the smaller visible viewport. The optional Home Screen app uses a standalone manifest and Apple web-app metadata; it requires no App Store download and has no offline game cache.

Set up the Home Screen app **before joining**: Safari and standalone storage/session continuity is not guaranteed. If you already joined, stay in that tab for the current match. The guide has an always-visible close control and does not permit movement/shot keyboard input behind it.

On iPhone, the join page's **Add to Home Screen** button opens a short illustrated guide showing the Safari Share icon, the Add action and the actual Office Arena icon to launch. **Play in browser** closes the guide without losing the name you entered. This button cannot create the shortcut or open Apple's Add to Home Screen confirmation automatically: iOS does not support the web `beforeinstallprompt` API. The guide is hidden when launched as a standalone Home Screen app.

On `/screen` or `/host`, use the visible **Enable sound** or **Test sound** button before kickoff. Either click unlocks browser audio and plays a confirmation tone. **Sound on** means the audio context is running; a blocked/interrupted browser instead offers **Resume sound**. Volume changes affect playing effects immediately, and muting stops the current fanfare as well as future sounds. Returning from a tab/app switch attempts recovery; tap **Resume sound** if the browser requires another gesture. Where available, Safari uses the playback audio-session category. If the test is silent, check device/media volume, the output device and Silent Mode on older iPhones. Refreshing a page requires enabling audio again.

Use a single audio source: host audio is separately opt-in, so leave it off when the projector is playing sound. For an online meeting, enable **Share tab audio** or **Include computer sound** in your meeting application when sharing the host/projector; enabling sound in the game does not enable meeting audio capture. Player phones and the audience prediction page remain silent. All effects are original synthesized tones and filtered noise, including the goal cheer; no third-party sound assets. Display graphics and characters are drawn in code. UI fonts are self-hosted Barlow Condensed and DM Sans (SIL Open Font License), with system fallbacks. The event UI makes no external font requests.

## Production

```sh
npm run build
NODE_ENV=production PORT=8080 npm start
```

```sh
docker build -t office-arena .
docker run --rm -p 8080:8080 office-arena
```

The production Dockerfile supports both the legacy Docker builder used by Cloud Build and BuildKit. It uses standard `npm ci` without secret mounts or session-specific certificate paths. To check legacy-builder compatibility, run `DOCKER_BUILDKIT=0 docker build -t office-arena .`. After a Dockerfile fix, trigger deployment from the latest `main` commit; retrying an older build keeps its original source commit.

The host opens `/host` directly: there is no PIN, login, or required secret. Keep this URL with the meeting organizer; anyone who discovers it can control the match. Player and spectator navigation does not advertise the host route. The host role is a UI/connection distinction, not authentication. `.env.example` lists optional configuration; this project does not automatically load `.env` files.

| Variable                | Default             | Range / purpose                                        |
| ----------------------- | ------------------- | ------------------------------------------------------ |
| PORT                    | 3000 (Docker: 8080) | HTTP and WebSocket port                                |
| MATCH_DURATION_SECONDS  | 180                 | 1–3600 seconds of active play                          |
| MAX_TEAM_SIZE           | 6                   | 1–6                                                    |
| RECONNECT_GRACE_SECONDS | 20                  | 5–120                                                  |
| GAME_TICK_RATE          | 30                  | 20–30 Hz                                               |
| NODE_ENV                | development         | Set `production` to serve built files and disable bots |

## Google Cloud Run

Use a GCP project with billing, Cloud Run and Cloud Build enabled. From this directory, with `gcloud` authenticated to that project:

```sh
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy office-arena --source . --region europe-west1 \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --concurrency 80 \
  --cpu 1 --memory 512Mi --timeout 3600 --no-cpu-throttling \
  --set-env-vars NODE_ENV=production
```

For an existing GitHub-connected Cloud Run service, deploy the latest `main` commit. No host PIN or Secret Manager binding is needed. If the service already has a legacy `HOST_PIN` environment/secret reference, it can be removed in **Edit & deploy new revision → Variables & Secrets**. The Docker image listens on `0.0.0.0:8080` by default; Cloud Run's supplied `PORT` is respected.

The default match is 180 seconds. If an existing Cloud Run revision explicitly sets `MATCH_DURATION_SECONDS`, set it to `180` or remove that override to use the new default. Repository updates do not replace existing Cloud Run environment settings.

Cloud Run supplies `PORT` and TLS. Deploy a single revision receiving 100% of traffic; don't split traffic, use parallel revisions, or deploy during an event. Each process has separate memory. Min/max one and always-allocated CPU preserve the narrow single-match architecture, but infrastructure replacement can still lose the match. No persistence is promised. Keep the service running during the event, then reduce minimum instances to avoid ongoing idle cost.

WebSockets use same-origin `/ws`. One-hour request timeout exceeds the typical meeting session; clients reconnect automatically with a 20-second reserved slot. The player token is stored only in that browser's local storage and disappears on New Match/server reset. Opening or refreshing `/host` automatically requests the host role and reconnects to the current match without resetting state. Health probe: `/healthz`. Structured JSON events go directly to Cloud Logging. Avoid logging player session tokens.

Live Cloud Run deployment was not performed in this workspace because no GCP identity or project is configured.

## Verification

```sh
npm run check
npm test
npm run build
# System Chromium is used by default. Set CHROMIUM_PATH to your browser binary.
npm run test:browser
```

Unit tests cover join/capacity, roles, starts, phases, goals, timing, Golden Goal, reconnection and reset behavior. Network integration tests launch a separate production server and verify startup without a PIN, explicit host-role selection, connection isolation, and production bot rejection. Browser tests cover the host/projector lifecycle with realtime test clients, desktop movement and character restoration after refresh, and mobile team choice, orientation and touch controls. Public-page browser checks cover 320px/390px portrait and 740px landscape viewports, text sizes, touch targets, overflow, joining, late joining and the unchanged host style scope. Audio browser checks measure real Web Audio output with a test-only audio-thread meter, verify live volume/mute and official countdown/end cues, simulate rejected/hung/interrupted resume requests, and render every synthesized effect offline. Actual WebGL rendering is enabled. Tests do not prove real iOS Safari/Android Chrome or corporate Wi-Fi reliability; those require a physical-device rehearsal.

For load testing, run the development server and `npm run test:load`. This connects 20 WebSocket clients, joins 12 players, starts a match through a host connection, sends simultaneous inputs and checks synchronized snapshots. Override `LOAD_URL` if needed. Do not run this against a live event lobby.

Before the event, rehearse on the actual Wi-Fi with 12 phones and the projector: join/scan, landscape controls, pass/shoot, audio unlock, briefly toggle one phone's network, and verify reconnect. Corporate networks may isolate phones or block WebSocket upgrades. Touch emulation is not a substitute for this rehearsal.

## Architecture

`server/game.ts` contains the authoritative simulation and state machine. `server/index.ts` validates WebSocket messages, limits input to 80 messages/second, keeps host commands separate from ordinary player inputs, handles reconnect identity and serves the frontend. Clients never submit position, score, charge duration or match time. Server-calculated charge, input expiry, bounded movement, deterministic goal checks and fixed target ticks own gameplay. Snapshot bandwidth is bounded for the intended 20 connections; slow consumers are disconnected instead of accumulating messages. The browser interpolates snapshots in the 3D view at up to 30 frames per second and captures touch pointers for forgiving controls.

No production bots, accounts, rooms, persistent statistics or external data services are included.

## Host live broadcast

After START MATCH, `/host` automatically displays the live arena, synchronized countdown, score, clock and celebrations above the match controls. Players, host and `/screen` share a close overhead ball-follow camera, with a full-field option. A host minimap shows every player and the current camera footprint while zoomed in. Countdown, pause and goal screens retain the action framing; the lobby, Reorg roster reveal and full-time screen use an overview.

Use **Full field / Ball-follow camera** to switch framing. **Broadcast mode** hides administration, rosters and navigation, fits the arena to the window and requests browser fullscreen. Share this host browser tab or window in the meeting. Move the pointer over the field to reveal camera, audio and exit controls; press Escape to return to administration. Enable sound on the host if broadcasting its tab audio, and avoid also playing the projector audio. Broadcast mode is local to the host browser and does not pause or change the match; exiting it restores the controls.

## Visual presentation and review

Leaders wear blue with blond hair; Workers wear orange with dark hair. Kit and hair follow the current team, including after a host move or the Reorg. Eye whites, pupils and highlights are grouped with the face and turn with the head.

The arena uses a real Three.js scene with original modeled stadium architecture, instanced seating/crowd, 3D goal nets, and articulated toy-like player models. Depth sorting, collision-aware nameplates, ball trails, team lighting and goal particles keep live play readable. Mobile players have a bright YOU marker, possession ring and action-button accent, shot-charge ring and dash cooldown. Turf is a cached high-resolution texture; crowd geometry is instanced. Hemispheric and directional lighting, soft cached contact shadows, and adaptive pixel resolution keep the scene readable. The renderer warms up in the lobby. The authoritative rules remain on a planar pitch; rendering is real 3D.

An independent critic reviewed the 2D iterations and the 3D conversion and scored the previous 2D version 8.3/10 and the final **3D version 8.2/10**. See [VISUAL_REVIEW.md](VISUAL_REVIEW.md) for findings and screenshot provenance. Review screenshots are generated local artifacts in `artifacts/final-screenshots/`; `artifacts/office-arena-screenshots.zip` contains the set. These are excluded from Git; the capture helpers can reproduce them. Screenshot capture helpers in `scripts/capture-*.mjs` are for an isolated development server only: they reset its lobby and create test players.

The 3D browser view requires WebGL 2. If unavailable, the application displays a clear graphics message. On graphics-context loss it stops local controls and restores the scene when the browser restores WebGL. A temporary host connection loss or refresh automatically restores the host role without a login prompt. Input stalls stop movement and prevent stale automatic shots, while a later explicit release still works.

## The Reorg surprise

Once per three-minute match, when the authoritative clock reaches **01:00**, the organization gets a surprise Reorg. Play and the match clock stop. Players are randomly redistributed by the server, with their identities and session tokens retained. There is a two-second surprise introduction, ten seconds to read both new rosters on one screen, then a synchronized three-second countdown into a center kickoff. These fifteen seconds do not consume match time. The final-minute cue plays when kickoff returns to active play.

Scores stay with LEADERS and WORKERS. Current team sizes are retained and capacities are respected; a reshuffle always exchanges at least two players when both teams have members. If departures have emptied a team, remaining players are split into two sides where possible. When both teams had connected players, the shuffle keeps a connected player on both sides. Existing goalkeeper slots are preserved, with at most one assigned keeper per new team; teams without a keeper slot are not forced to have one.

The host, projector and player screens show the same server-owned assignments. Phones highlight the local player's new team and hide gameplay controls during the reveal. The roster uses the full phone width, including short landscape and portrait layouts. Jerseys, nameplate colors, team identity and goalkeeper gloves update from the new authoritative assignments. The ball, positions, dash/charge state and pass sequence reset for kickoff; names, identities, score and the remaining minute are kept.

Host Pause/Resume freezes and restores the remaining reveal time. Refresh/reconnection restores the same new team rather than reshuffling again. Restart/Rematch rearms the surprise for the next full match while retaining the current players/teams; New Match clears it. Golden Goal does not trigger another Reorg. Custom matches of 60 seconds or less skip the event.

```sh
npm test
npm run test:reorg
```

The dedicated browser check starts an isolated 66-second development match, so the event arrives after six seconds of actual play. It verifies the 1v1 team swap, orange-to-blue 3D kit change, locked clock/controls, pause and player refresh during the reveal, synchronized kickoff, and movement after play resumes. Reorg screenshots are in `artifacts/reorg/`. The capture helper uses only isolated TEST participants and holds genuine REORG snapshots during still capture; it does not inject assignments or scores.

## Audience predictions

People who are not playing can open **`/predict`**, or choose **Predict the winner** from `/join`. The projector QR still opens `/join`, which offers both play and prediction paths. Both teams can fill up without starting the match; JOIN GAME is disabled when all twelve slots are taken, while audience predictions remain available. Audience picks never take a player slot or start the match.

Each audience browser chooses LEADERS or WORKERS and can change its pick while the lobby is open. The server locks all picks as soon as the host successfully starts the countdown. Failed start attempts leave them open. Late visitors see the crowd split and live score; their next chance to pick is a new prediction lobby. This is a no-money prediction poll with no accounts, odds, stakes, purchases or payouts.

The host and projector show the crowd split. Broadcast mode keeps a compact audience badge on the field. Audience phones show a live score, official clock updates, match status and their saved pick. When a match finishes normally, the winning team determines the prediction result, including Golden Goal; correct predictors see **YOU CALLED IT!**. Host-ended matches produce no prediction winners. The Reorg changes player assignments; predictions remain attached to the team names LEADERS and WORKERS.

**Rematch lobby** keeps players, team assignments and goalkeeper roles, resets the score, clears previous picks and opens predictions again. The host presses START MATCH when ready. The existing quick **Rematch** and **Restart match** keep the current locked team picks; **New Match** and **Reset lobby** clear all picks along with players. No flow starts a match because teams or predictions fill up.

A temporary HttpOnly, SameSite cookie keeps one pick per browser across refreshes and tabs. Separate browsers/devices count separately; clearing cookies creates a fresh audience identity. All choices exist only in server memory, bounded at 5,000 audience identities, and disappear on instance replacement or a new prediction round. Individual choices and identity cookies are never broadcast to other viewers.

Audience phones poll a small `/api/audience` JSON summary every two seconds (ten seconds while hidden). They do not create player WebSocket connections, download position snapshots or run the 3D render loop. They therefore do not consume the game's 64 realtime connection slots. The usual Cloud Run instance memory, request concurrency and CPU limits still apply; rehearse at the expected meeting audience size.

Prediction tests cover full-team lobbies, replacement/idempotence, validation/rate limits, host-start locking, Reorg, Golden Goal, host-ended results, reset/rematch behavior and bounded memory. HTTP integration tests exercise cookies, refresh identity, payload/origin validation and server-side locking. The mobile browser flow covers entry from a full lobby, picks and changes, refresh, shared totals, locking and rematch lobby reset.

## Mobile visibility and Safari display

Player phones use the full available width, a thin score/time rail and the overhead ball camera. The normal view covers roughly 750–900 of the pitch’s 1200 world units in width, including on short Safari viewports. Panning follows play with a small velocity lead; framing widens modestly for shots. Kickoffs, goals and pauses retain close framing, while the lobby, Reorg roster reveal and full-time screen use an overview. FIELD provides an optional full-arena view and BALL restores the action camera. The YOU edge pointer prevents losing track of an offscreen player; local identity and attack cues continue to reflect team changes.

The phone ball marker is drawn from the actual smoothed ball position above player labels: a **14 CSS-pixel white core**, dark outline and restrained contrasting rim. It remains readable in both camera modes without altering authoritative ball physics. If the ball is offscreen or beneath a thumb control, a BALL arrow preserves direction. Labels reserve projected character bounds; unplaceable noncritical phone labels yield to players and ball readability. Spectator labels remain available.

Controls use dark translucent backplates with clear labels over turf. Joystick targets remain 84–88 px, pass/shoot 76–80 px, and dash 48–52 px. Knob travel stays inside its ring. The redundant name/possession banners are removed; possession accent, charge ring, RELEASE text and cooldown remain. Reorg reveals still expand across the entire phone. Host/projector presentation is retained.

After the actual Safari screenshot exposed the limits of the earlier decluttering review, the critic reassessed visibility at **568×240** and **740×260** usable viewports. It approved the revised implementation at **8.7/10 ball visibility** and **8.5/10 player UX**, including clustered play, possession, charge/cooldown, a far-away ball, overview and screen-help states. These are screenshot-based qualitative scores. Physical iPhone Home Screen installation, browser chrome, safe-area behavior and thumb comfort still require a real-device rehearsal.

To reproduce the review, use an isolated development server (the helper resets its lobby and creates TEST participants):

```sh
PORT=3110 npm run dev
# In another terminal:
HUD_CAPTURE_TAG=visibility node scripts/capture-mobile-hud.mjs
HUD_CAPTURE_SKILLS=1 HUD_CAPTURE_TAG=visibility-skills node scripts/capture-mobile-hud.mjs
HUD_CAPTURE_FAR=1 HUD_CAPTURE_TAG=visibility-far node scripts/capture-mobile-hud.mjs
```

Screenshots/metrics go to `artifacts/mobile-hud/` and are excluded from Git. Standard stills hold genuine 12-player PLAYING packets; skill captures use genuine joystick/dash/shot input at 568×240; far-ball captures use actual inputs to let a second TEST player acquire and dribble the ball away. No positions, goals, possession or phases are injected. Safari UI branches are exercised with iPhone user-agent/capability emulation in Chromium; this does not constitute physical iOS installation/fullscreen testing.
