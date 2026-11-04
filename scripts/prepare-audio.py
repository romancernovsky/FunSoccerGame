"""Optional asset regeneration: Python 3 and FFmpeg. Not part of production builds."""
from pathlib import Path
from urllib.request import urlopen
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parents[1]
folder = root / 'public/audio'
originals = root / 'artifacts/audio-originals'
originals.mkdir(parents=True, exist_ok=True)
manifest = json.loads((folder / 'sources.json').read_text())
for item in manifest:
    original = originals / f"{item['id']}.mp3"
    # The research download is reusable when working locally.
    research = root / 'artifacts/audio-sources/recordings' / ('applause.mp3' if item['name'] == 'clap' else item['name'] + '.mp3')
    if not original.exists():
        if research.exists():
            original.write_bytes(research.read_bytes())
        else:
            with urlopen(item['download'], timeout=30) as response:
                original.write_bytes(response.read())
    duration = item['duration']
    filters = f"atrim=start={item['start']}:duration={duration},asetpts=PTS-STARTPTS,highpass=f=45"
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(original), '-af', filters + ',volumedetect', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    peak = float(re.search(r'max_volume: (-?[\d.]+) dB', probe.stderr).group(1))
    filters += f",volume={-4 - peak}dB,afade=t=in:d=0.006,afade=t=out:st={duration-.025}:d=0.025"
    target = folder / item['file']
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(original), '-af', filters, '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', str(target)], check=True)
    target.chmod(0o644)
    item['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    print(item['file'], target.stat().st_size)
(folder / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
lines=['# Recorded match audio', '', 'All bundled recordings are dedicated to the public domain under **CC0 1.0**. They may be copied, modified and redistributed, including in this repository and commercial games.', '', 'License: https://creativecommons.org/publicdomain/zero/1.0/', '', 'Credits are retained as a courtesy to the field recordists. Recordings are cropped, peak-normalized, high-pass filtered at 45 Hz and faded at the edges. These are real recordings, not synthesized tones. Playback layers and timing are original game code.', '', '| Bundled file | Recording and creator | Source |', '| --- | --- | --- |']
for item in manifest:
    lines.append(f"| {item['file']} | {item['title']} | [{item['id']}]({item['page']}) |")
lines.extend(['', '`sources.json` records the source downloads, license, exact edits and SHA-256 of each bundled file.', '', 'To regenerate: `python3 scripts/prepare-audio.py` (requires FFmpeg). Production builds use committed files, with no external audio download or sound-service account.', ''])
(folder / 'CREDITS.md').write_text('\n'.join(lines))
