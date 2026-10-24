"""Records the Grand Prix commentary booth (src/os/arcade/games/grand-prix/lines.ts) with a neural voice: Chatterbox
(the voices in the game, very human, with an emotion control) or Kokoro (small and quick, the fallback).

Each turn of each line becomes public/sounds/grand-prix/commentary/<key>-<variant>-<turn>.mp3, in its speaker's voice
and the mood it is written in (pace, pitch and level), with a light broadcast microphone treatment. Only new or
changed turns are rendered (what each clip was recorded from is kept in manifest.json beside them). Optionally checks
every clip with a speech recognizer, so a garbled line is caught without listening to all of them.

Setup (once), Chatterbox (Python 3.11, downloads its weights from huggingface.co on first run):
  pip install chatterbox-tts soundfile "setuptools<81"
Kokoro:
  pip install kokoro-onnx soundfile          # and sherpa-onnx for --check; ffmpeg with rubberband on the PATH
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  # for --check: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2

Run from the repo root:
  python3 scripts/grand-prix-commentary.py --engine chatterbox [--force]
  python3 scripts/grand-prix-commentary.py --engine kokoro --models <dir with the two files> [--force]
  python3 scripts/grand-prix-commentary.py --check <whisper dir>      # check what is recorded, record nothing

Chatterbox speaks from scripts/grand-prix-voices/<speaker>.wav, reference clips made with the Kokoro voices in
lines.ts, so no real person's voice is cloned. Chatterbox is MIT licensed (https://github.com/resemble-ai/chatterbox);
Kokoro is Apache 2.0 (https://huggingface.co/hexgrad/Kokoro-82M).
"""

import argparse, hashlib, json, os, re, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

OUT = 'public/sounds/grand-prix/commentary'
# bump when the processing below changes, so every clip is recorded again
PROCESS = 'booth-1'


def load_lines():
    code = """import('./src/os/arcade/games/grand-prix/lines.ts').then(m => console.log(JSON.stringify({
      lines: Object.fromEntries(Object.entries(m.LINES).map(([k, v]) => [k, v.map(t => t.map(x => ({ ...x, said: m.spoken(x.text) })))])),
      voices: m.VOICES, moods: m.MOODS })))"""
    return json.loads(subprocess.check_output(['node', '-e', code]))


def tidy(samples, sr):
    """Trims silence at both ends (keeping a breath) and levels the loudness."""
    level = np.sqrt(np.convolve(samples ** 2, np.ones(240) / 240, mode='same'))
    loud = np.where(level > 0.01)[0]
    if len(loud):
        samples = samples[max(0, loud[0] - int(0.03 * sr)): loud[-1] + int(0.12 * sr)]
    speech = samples[np.abs(samples) > 0.01]
    rms = np.sqrt(np.mean(speech ** 2)) if len(speech) else 1
    return samples * (0.11 / max(rms, 1e-4))


def booth(mood, shift=True):
    """ffmpeg filters: the mood's pitch (formants kept, so it sounds lifted rather than sped up) and level, then a
    commentary box microphone: low cut, a little presence, and a gentle compressor that brings the voice forward."""
    pitch = mood['pitch']
    chain = [f'rubberband=pitch={pitch}:formant=preserved'] if shift and abs(pitch - 1) > 1e-3 else []
    chain += [
        'highpass=f=85',
        'equalizer=f=3200:t=q:w=1.2:g=2.5',
        'equalizer=f=220:t=q:w=1.0:g=1.5',
        'acompressor=threshold=0.09:ratio=3:attack=5:release=120:makeup=1.6',
        f'volume={mood["gain"]}dB',
        'alimiter=limit=0.95',
        'afade=t=in:d=0.01',
    ]
    return ','.join(chain)


def words(text):
    text = text.lower().replace('it is', "it's").replace('that is', "that's")
    return re.sub(r"[^a-z0-9' ]", ' ', text).split()


# words the recognizer spells another way (American spelling, digits) or does not know (Italian names)
UNHEARD = {'chequered', 'kerbs', 'kilometres', 'curva', 'grande', 'roggia', 'rettifilo', 'ascari', 'lesmo', 'lesmos', 'parabolica', 'alboreto', 'tyre', 'tyres'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', choices=['chatterbox', 'kokoro'])
    ap.add_argument('--models')
    ap.add_argument('--check')
    ap.add_argument('--force', action='store_true')
    # record these clips again as a different take (Chatterbox varies from take to take), e.g. after --check
    ap.add_argument('--retake', default='')
    ap.add_argument('--take', type=int, default=1)
    args = ap.parse_args()

    data = load_lines()
    voices, moods = data['voices'], data['moods']
    if args.engine == 'kokoro':
        from kokoro_onnx import Kokoro
        kokoro = Kokoro(os.path.join(args.models, 'kokoro-v1.0.onnx'), os.path.join(args.models, 'voices-v1.0.bin'))
        styles = {who: sum(kokoro.get_voice_style(v) * w for v, w in mix.items()) for who, mix in voices.items()}

        def speak(turn, mood):
            samples, sr = kokoro.create(turn['said'], voice=styles[turn['who']], speed=mood['speed'], lang='en-gb')
            return np.asarray(samples, dtype=np.float32), sr
    elif args.engine == 'chatterbox':
        import torch
        from chatterbox.tts import ChatterboxTTS
        torch.set_num_threads(os.cpu_count() or 4)
        model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu')

        def speak(turn, mood):
            # the same take every time a line is recorded again
            torch.manual_seed(int(hashlib.sha1(turn['said'].encode()).hexdigest()[:8], 16) + turn.get('take', 0))
            wav = model.generate(turn['said'], audio_prompt_path=f"scripts/grand-prix-voices/{turn['who']}.wav", exaggeration=mood['emotion'], cfg_weight=mood['pace'])
            return wav.squeeze(0).numpy().astype(np.float32), model.sr
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = {} if args.force or not os.path.exists(manifest_path) else json.load(open(manifest_path))

    wanted = {}
    for key, variants in data['lines'].items():
        for v, turns in enumerate(variants):
            for t, turn in enumerate(turns):
                wanted[f'{key}-{v}-{t}'] = turn

    for name in list(manifest):
        if name not in wanted:
            del manifest[name]
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f[:-4] not in wanted:
            os.remove(os.path.join(OUT, f))

    done = 0
    for name, turn in wanted.items():
        mood = moods[turn['mood']]
        if not args.engine:
            break
        setup = hashlib.sha1(json.dumps([PROCESS, voices[turn['who']], mood], sort_keys=True).encode()).hexdigest()[:8]
        tag = f"{args.engine}:{setup}|{turn['who']}|{turn['mood']}|{turn['said']}"
        retake = name in args.retake.split(',')
        if retake:
            turn = {**turn, 'take': args.take}
        if not retake and manifest.get(name) == tag and os.path.exists(os.path.join(OUT, name + '.mp3')):
            continue
        samples, sr = speak(turn, mood)
        samples = tidy(samples, sr)
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            sf.write(wav.name, samples, sr)
            # (Chatterbox carries the emotion in the voice itself, so no pitch lift on top)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav.name, '-af', booth(mood, args.engine == 'kokoro'), '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', os.path.join(OUT, name + '.mp3')], check=True)
        manifest[name] = tag
        done += 1
        print(f'rendered {name} ({turn["who"]}, {turn["mood"]}): {turn["text"]}', flush=True)
        # saved as it goes, so a long recording can be stopped and picked up again
        json.dump(dict(sorted(manifest.items())), open(manifest_path, 'w'), indent=0)
    json.dump(dict(sorted(manifest.items())), open(manifest_path, 'w'), indent=0)
    print(f'{done} rendered, {len(wanted)} turns in all')

    if args.check:
        import sherpa_onnx
        d = args.check
        rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=os.path.join(d, 'base.en-encoder.int8.onnx'), decoder=os.path.join(d, 'base.en-decoder.int8.onnx'), tokens=os.path.join(d, 'base.en-tokens.txt'), num_threads=4)
        bad = 0
        for name, turn in wanted.items():
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', os.path.join(OUT, name + '.mp3'), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'])
            st = rec.create_stream()
            st.accept_waveform(16000, np.frombuffer(pcm, dtype=np.float32))
            rec.decode_stream(st)
            heard = st.result.text.strip()
            want, got = [w for w in words(turn['text']) if w not in UNHEARD], set(words(heard))
            missing = [w for w in want if w not in got]
            if len(missing) > max(1, len(want) // 5):
                bad += 1
                print(f'CHECK {name}: wanted "{turn["text"]}" heard "{heard}" (missing {missing})')
        print(f'checked {len(wanted)} clips, {bad} to listen to')


if __name__ == '__main__':
    sys.exit(main())
