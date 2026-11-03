# Independent visual review

The user requested a separate critic and iteration until the visual/player-experience score exceeded 8/10, then requested real 3D. A read-only critic reviewed actual browser screenshots of both renderers.

| Review            | Score      | Findings                                                                                                           |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| First 2D redesign | 7.2/10     | Better art, but crowded names, noisy turf and weak mobile identification                                           |
| Revised 2D        | 8.3/10     | Those blockers resolved                                                                                            |
| Final 3D          | **8.2/10** | Real modeled scene, clear figures and ball, coherent stadium, readable touch feedback; no remaining visual blocker |

These are qualitative reviewer scores, not performance measurements or universal user-preference claims. The critic independently reassessed the 3D screenshots rather than carrying forward the 2D score. Its final confirmation included the corrected goal screenshot with GOOOAL!, Maya, the 1–0 score and confetti.

The current renderer is Three.js/WebGL 2, with actual geometry for the stadium, articulated player models, goal frames/nets and rolling patterned ball. Instanced crowd meshes and a cached turf texture reduce rendering work. Hemisphere/directional lights and soft cached contact shadows give depth without expensive dynamic shadow maps. A fixed elevated camera preserves control orientation; the host has smooth ball-follow zoom, full-field mode, a minimap and broadcast presentation.

Projected player labels avoid models and other labels. The local YOU beacon, possession ring, guidance, shot-charge ring, in-world charge bar and dash cooldown support mobile play. The 3D renderer prewarms in the waiting lobby, renders at up to 30fps and reduces pixel resolution on slow devices. A brief input stall freezes movement without dropping the explicit shot-release edge; stale input never auto-fires. Backend positions, physics, goals and scoring remain authoritative on the planar pitch.

## Evidence

Final local artifacts: `artifacts/final-screenshots/` and `artifacts/office-arena-screenshots.zip`. Screenshots are intentionally excluded from the source repository; the capture helpers reproduce review frames.

The broadcast/lobby images show an actual 12-participant development-bot match. The possession/charge/goal images show a valid two-player match controlled through the real joystick and action button: Maya acquired the ball, aimed right, charged and released; the server awarded the goal. No position, score or match phase was injected. For the still goal artifact only, the screenshot harness forwarded the genuine first GOAL snapshot and buffered following network snapshots so the three-second celebration would not expire during software-GPU capture. The kickoff image is correctly labeled as a separate moment.

Automated browser checks use Chromium with touch emulation. Real iPhone/Android GPU performance and corporate Wi-Fi still need a physical-device rehearsal. Small distant names and the deliberately toy-like style remain subjective refinements rather than review blockers.

## Final verification

The production TypeScript/Vite build and 25 rule/network tests pass. Three browser role checks pass with actual WebGL: host/projector broadcast, pause/resume, PIN reentry after refresh, rematch/reset; desktop movement, immediate Shift dash and character restoration after refresh; and mobile team choice, portrait guidance, landscape movement/action/dash. The desktop check was rerun successfully after fixing quick Shift taps to send their input edge immediately.

The production Docker image builds and its health, host route and bundled font endpoints were smoke-tested. Real-device GPU/Wi-Fi rehearsal and live Cloud Run deployment remain outside this environment’s completed checks.

## Reorg update

The independent critic scored the first Reorg reveal 8.0/10 and the revised reveal **8.5/10**, above the requested threshold. The revision uses the full phone width in landscape and gives portrait team headers a separate count line. All twelve names, previous-team hints, keeper markers and the local YOU highlight fit in one view. Browser-measured board bounds fit both 844×320 and 390×844 without horizontal overflow.

The updated production build and 33 rule/network tests pass. The dedicated `npm run test:reorg` browser check passes through the actual 02:00 trigger, orange-to-blue 3D kit change in a 1v1, locked clock and controls, pause/refresh/reconnection, preserved assignments, synchronized kickoff and restored movement. Screenshots in `artifacts/reorg/` and the final screenshot pack show real server-generated assignments for twelve TEST participants. For these still captures only, following state packets were held after the genuine REORG snapshot, which is why a late captured countdown can show 0; the live server transition to kickoff is separately verified.

## Mobile HUD decluttering review

At the user's request, an independent critic reviewed actual before/after mobile landscape screenshots and interaction states. The crowded baseline scored **5.9/10 overall mobile gameplay UX** (approximately 6.3 on wide phones and 5.3 on 568×320). The overlapping identity/score blocks, bright bottom controls and redundant possession/branding text competed with the field.

The first revision scored **8.5/10 for visual clarity** and **8.2/10 for screenshot-based gameplay UX**. After reviewing possession, charge/release and dash-cooldown frames and the corrected joystick travel, the critic approved the final revision at **8.5/10 visual clarity** and **8.4/10 player UX**, above the requested threshold. It reported no remaining visual or screenshot-observable UX blocker. Small cooldown text remains a minor refinement, and physical-device thumb comfort and corporate Wi-Fi still need rehearsal.

The score/time rail is 28 px high. Wider phones put forgiving thumb controls beside the arena; small phones use translucent corner controls to preserve field scale. Separate identity/possession banners and pitch labels are removed. The world YOU/possession cues, possession accent on the action button, charge ring and RELEASE label retain interaction feedback. Countdown teaching remains. Fullscreen uses vector icons. Reorg temporarily uses the whole phone for its assignment reveal.

Evidence: `artifacts/mobile-hud/before-{wide,short,small,fullscreen}.png`, `after-{wide,short,small,fullscreen}.png` and `final-{wide,short,small,fullscreen}.png` cover 844×390, 740×320, 568×320 and fullscreen. Each standard set holds a genuine server-generated PLAYING snapshot with twelve TEST participants; individual before/after matches have different live positions and scores. They demonstrate visual hierarchy, not an exact pixel/position comparison or a quantified turf-area increase.

`final-possession.png`, `final-cooldown.png` and `final-charge.png` show genuine control states from a separate two-player test match. Real joystick movement acquired the ball, a real DASH tap triggered cooldown, and a real action hold charged the shot. Only the genuine charging server packet was held for its still while the server continued simulation. The review harness does not inject positions, scores, possession or match phases. Capture helpers and JSON metrics record the viewport bounds and provenance; artifacts remain excluded from Git.

## Ball visibility and iPhone Safari follow-up

The user's actual Safari screenshot showed that the prior HUD decluttering score did not establish phone playability with browser chrome: the game still devoted too much area to the stadium, and the pale physical ball was tiny. The critic explicitly reassessed this requirement rather than carrying the previous 8.4 score forward.

The revised phone view uses a full-width player camera (fixed orientation, 1.6–2.2 zoom according to usable height), a FIELD overview toggle, an attack cue, and a ball readability assist projected from the actual smoothed ball position. The ball's white core is 14 CSS pixels with a dark outline/contrasting rim and draws above labels. Offscreen/under-control positions receive an edge BALL arrow while the local player remains framed. The first visibility pass still had poor control contrast on turf (provisional UX 7.9); dark translucent controls, clear labels, projected-body name avoidance and a sticky screen-guide close control resolved the remaining blockers.

The final independent critic approved **8.7/10 ball visibility** and **8.5/10 player UX** after reviewing `visibility2-{small,short,wide,overview,safari-help}.png`, `visibility-small-skills-{possession,cooldown,charge}.png` and `visibility-far-{small,short}.png` in `artifacts/mobile-hud/`. The small/short stills use **568×240** and **740×260** content viewports to account for lost Safari space. Skill stills show genuine possession, charge/release and cooldown in the short viewport; far-ball stills show a second real-input TEST participant acquiring and dribbling the ball more than 800 world units away, with the local player still visible and BALL direction preserved. Actual server packets are held for stills; no game state is invented. Minor name-tag displacement remains a refinement, not a ball-findability blocker.

Fullscreen is now feature-detected. Unsupported or rejected native requests show honest help instead of a fake successful fullscreen state. The Safari guide supports Share → Add to Home Screen, launching before joining, the session-transfer caveat, and an always-visible 44 px close control. A standalone manifest, original icons and Apple web-app metadata provide the Home Screen route; no service worker/offline cache is installed. Native desktop fullscreen remains supported.

The critic's approval concerns screenshot-observable UI and accurate guidance. Physical iPhone installation/launch, actual browser chrome removal, safe areas and thumb comfort remain unverified in this Linux environment. Browser checks use Chromium with iPhone user-agent and capability emulation; they exercise unavailable/rejected APIs, simulated standalone detection, short-viewport controls and keyboard isolation while help is open. They must not be described as a physical Safari test.

## Match timing update

Default regulation is now three minutes (180 seconds), with Reorg at **01:00** remaining. The reveal and kickoff still pause the match clock, leaving one full minute of active play afterward. The final-minute cue is announced when play resumes. The accelerated Reorg browser check now uses a 66-second match to reach the event after six seconds; earlier 02:00 screenshots above describe the historical timing.
