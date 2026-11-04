# Recorded match audio

All bundled recordings are dedicated to the public domain under **CC0 1.0**. They may be copied, modified and redistributed, including in this repository and commercial games.

License: https://creativecommons.org/publicdomain/zero/1.0/

Credits are retained as a courtesy to the field recordists. Recordings are cropped, peak-normalized, high-pass filtered at 45 Hz and faded at the edges. These are real recordings, not synthesized tones. Playback layers and timing are original game code.

| Bundled file | Recording and creator                                     | Source                                                               |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------- |
| kick.mp3     | soccer ball kick 2 edit by Luisa_Sanchez                  | [816823](https://freesound.org/people/Luisa_Sanchez/sounds/816823/)  |
| shot.mp3     | Soccer Kick.wav by musita182                              | [261267](https://freesound.org/people/musita182/sounds/261267/)      |
| net.mp3      | Soccer net by Luisa_Sanchez                               | [813410](https://freesound.org/people/Luisa_Sanchez/sounds/813410/)  |
| whistle.mp3  | Referee whistle sound.wav by Rosa-Orenes256               | [538422](https://freesound.org/people/Rosa-Orenes256/sounds/538422/) |
| crowd.mp3    | Stadium Crowd by stomachache                              | [274516](https://freesound.org/people/stomachache/sounds/274516/)    |
| reaction.mp3 | Soccer stadium Oehh.wav by Sandermotions                  | [494362](https://freesound.org/people/Sandermotions/sounds/494362/)  |
| applause.mp3 | Voice_Crowd_Small_Expression_Applause_Stereo by Nox_Sound | [752710](https://freesound.org/people/Nox_Sound/sounds/752710/)      |
| clap.mp3     | Voice_Crowd_Small_Expression_Applause_Stereo by Nox_Sound | [752710](https://freesound.org/people/Nox_Sound/sounds/752710/)      |
| step.mp3     | Footstep_Grass_5.wav by GiocoSound                        | [421135](https://freesound.org/people/GiocoSound/sounds/421135/)     |
| horn.mp3     | Raven Horn.mp3 by Streetpoptunez                          | [653781](https://freesound.org/people/Streetpoptunez/sounds/653781/) |
| cheer.mp3    | Crowd Cheer 5 by Krizin                                   | [651646](https://freesound.org/people/Krizin/sounds/651646/)         |

`sources.json` records the source downloads, license, exact edits and SHA-256 of each bundled file.

To regenerate: `python3 scripts/prepare-audio.py` (requires FFmpeg). Production builds use committed files, with no external audio download or sound-service account.
