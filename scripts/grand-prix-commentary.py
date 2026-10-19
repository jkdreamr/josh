"""Records the Grand Prix commentator's lines (src/os/arcade/games/grand-prix/lines.ts) with the Kokoro neural voice.

Each variant becomes public/sounds/grand-prix/commentary/<key>-<n>.mp3. Only new or changed lines are rendered (the
text of each recorded clip is kept in manifest.json beside them). Optionally checks every clip with a speech
recognizer, so a garbled line is caught without listening to all of them.

Setup (once):
  pip install kokoro-onnx soundfile          # and sherpa-onnx for --check
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  # for --check: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2

Run from the repo root:
  python3 scripts/grand-prix-commentary.py --models <dir with the two files> [--check <whisper dir>] [--force]

Kokoro (model and voices) is Apache 2.0 licensed: https://huggingface.co/hexgrad/Kokoro-82M
"""

import argparse, json, os, re, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

VOICE = 'bm_fable'
SPEED = 1.08
EXCITED_SPEED = 1.16
OUT = 'public/sounds/grand-prix/commentary'


def load_lines():
    # each line with the text the voice is given (lines.ts spells some names out the way they are said)
    code = "import('./src/os/arcade/games/grand-prix/lines.ts').then(m => console.log(JSON.stringify({ lines: m.LINES, said: Object.fromEntries(Object.entries(m.LINES).map(([k, v]) => [k, v.map(m.spoken)])), excited: [...m.EXCITED] })))"
    data = json.loads(subprocess.check_output(['node', '-e', code]))
    return data['lines'], data['said'], set(data['excited'])


def tidy(samples, sr):
    """Trims silence at both ends (keeping a breath), levels the loudness and fades the edges."""
    level = np.sqrt(np.convolve(samples ** 2, np.ones(240) / 240, mode='same'))
    loud = np.where(level > 0.01)[0]
    if len(loud):
        samples = samples[max(0, loud[0] - int(0.03 * sr)): loud[-1] + int(0.12 * sr)]
    speech = samples[np.abs(samples) > 0.01]
    rms = np.sqrt(np.mean(speech ** 2)) if len(speech) else 1
    samples = samples * (0.11 / max(rms, 1e-4))
    samples = np.clip(samples, -0.97, 0.97)
    fade = int(0.01 * sr)
    samples[:fade] *= np.linspace(0, 1, fade)
    samples[-fade:] *= np.linspace(1, 0, fade)
    return samples


# words the recognizer spells another way (American spelling, digits) or does not know (Italian names)
UNHEARD = {'chequered', 'kerbs', 'kilometres', 'curva', 'grande', 'roggia', 'rettifilo', 'ascari', 'lesmo', 'lesmos', 'parabolica'}


def words(text):
    text = text.lower().replace('it is', "it's").replace('that is', "that's")
    return re.sub(r"[^a-z0-9' ]", ' ', text).split()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', required=True)
    ap.add_argument('--check')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    from kokoro_onnx import Kokoro
    kokoro = Kokoro(os.path.join(args.models, 'kokoro-v1.0.onnx'), os.path.join(args.models, 'voices-v1.0.bin'))
    lines, said_lines, excited = load_lines()
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = {} if args.force or not os.path.exists(manifest_path) else json.load(open(manifest_path))
    wanted = {}
    for key, variants in lines.items():
        for n, text in enumerate(variants):
            wanted[f'{key}-{n}'] = (text, said_lines[key][n], EXCITED_SPEED if key in excited else SPEED)

    # clips no longer in lines.ts
    for name in list(manifest):
        if name not in wanted:
            del manifest[name]
            path = os.path.join(OUT, name + '.mp3')
            if os.path.exists(path):
                os.remove(path)

    done = 0
    for name, (text, said, speed) in wanted.items():
        tag = f'{VOICE}|{speed}|{said}'
        if manifest.get(name) == tag and os.path.exists(os.path.join(OUT, name + '.mp3')):
            continue
        samples, sr = kokoro.create(said, voice=VOICE, speed=speed, lang='en-gb')
        samples = tidy(np.asarray(samples, dtype=np.float32), sr)
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            sf.write(wav.name, samples, sr)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav.name, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', os.path.join(OUT, name + '.mp3')], check=True)
        manifest[name] = tag
        done += 1
        print(f'rendered {name}: {text}', flush=True)
    json.dump(dict(sorted(manifest.items())), open(manifest_path, 'w'), indent=0)
    print(f'{done} rendered, {len(wanted)} lines in all')

    if args.check:
        import sherpa_onnx
        d = args.check
        rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=os.path.join(d, 'base.en-encoder.int8.onnx'), decoder=os.path.join(d, 'base.en-decoder.int8.onnx'), tokens=os.path.join(d, 'base.en-tokens.txt'), num_threads=4)
        bad = 0
        for name, (text, _, _) in wanted.items():
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', os.path.join(OUT, name + '.mp3'), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'])
            st = rec.create_stream()
            st.accept_waveform(16000, np.frombuffer(pcm, dtype=np.float32))
            rec.decode_stream(st)
            heard = st.result.text.strip()
            want, got = [w for w in words(text) if w not in UNHEARD], set(words(heard))
            missing = [w for w in want if w not in got]
            if len(missing) > max(1, len(want) // 5):
                bad += 1
                print(f'CHECK {name}: wanted "{text}" heard "{heard}" (missing {missing})')
        print(f'checked {len(wanted)} clips, {bad} to listen to')


if __name__ == '__main__':
    sys.exit(main())
