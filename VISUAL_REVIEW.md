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
