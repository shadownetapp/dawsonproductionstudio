// Browser-only procedural music beds. Each preset is synthesized with an
// OfflineAudioContext into a WAV byte array so it can be muxed under a video by
// ffmpeg.wasm. Everything here is generated from scratch — there is no sampled
// or third-party audio — so the beds are original and royalty-free.

export type MusicPresetKey = "sunrise" | "golden" | "trot" | "barn" | "fields";

type Preset = {
  key: MusicPresetKey;
  label: string;
  bpm: number;
  // Chord progression as arrays of MIDI note numbers.
  chords: number[][];
  // Arpeggio timbre + how bright the pad is.
  padType: OscillatorType;
  leadType: OscillatorType;
  brightness: number; // low-pass cutoff in Hz
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// A few gentle, farm-friendly progressions (roman numerals commented).
export const MUSIC_PRESETS: Record<MusicPresetKey, Preset> = {
  sunrise: {
    key: "sunrise",
    label: "Sunrise Pasture",
    bpm: 82,
    // C - Am - F - G
    chords: [
      [60, 64, 67],
      [57, 60, 64],
      [53, 57, 60],
      [55, 59, 62],
    ],
    padType: "sine",
    leadType: "triangle",
    brightness: 2600,
  },
  golden: {
    key: "golden",
    label: "Golden Hour",
    bpm: 76,
    // F - C - Dm - Bb
    chords: [
      [53, 57, 60],
      [60, 64, 67],
      [62, 65, 69],
      [58, 62, 65],
    ],
    padType: "sine",
    leadType: "sine",
    brightness: 2200,
  },
  trot: {
    key: "trot",
    label: "Gentle Trot",
    bpm: 104,
    // G - D - Em - C
    chords: [
      [55, 59, 62],
      [62, 66, 69],
      [64, 67, 71],
      [60, 64, 67],
    ],
    padType: "triangle",
    leadType: "square",
    brightness: 3200,
  },
  barn: {
    key: "barn",
    label: "Barn Morning",
    bpm: 72,
    // Am - F - C - G
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [60, 64, 67],
      [55, 59, 62],
    ],
    padType: "sine",
    leadType: "triangle",
    brightness: 2000,
  },
  fields: {
    key: "fields",
    label: "Open Fields",
    bpm: 92,
    // D - A - Bm - G
    chords: [
      [62, 66, 69],
      [57, 61, 64],
      [59, 62, 66],
      [55, 59, 62],
    ],
    padType: "triangle",
    leadType: "triangle",
    brightness: 2800,
  },
};

/** Render a preset to a mono-ish stereo WAV of `seconds` length. Browser only. */
export async function renderMusicBed(
  key: MusicPresetKey,
  seconds: number,
): Promise<Uint8Array> {
  const preset = MUSIC_PRESETS[key] ?? MUSIC_PRESETS.sunrise;
  const sampleRate = 44100;
  const length = Math.max(1, Math.ceil(seconds)) * sampleRate;

  const AC: typeof OfflineAudioContext =
    (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
      .OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext!;
  const ctx = new AC(2, length, sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = preset.brightness;
  lp.connect(master);
  master.connect(ctx.destination);

  const beat = 60 / preset.bpm;
  const barLen = beat * 4; // 4/4
  const totalBars = Math.ceil(seconds / barLen);

  // Soft global fade in/out so loops/cuts don't click.
  master.gain.setValueAtTime(0.0001, 0);
  master.gain.exponentialRampToValueAtTime(0.9, Math.min(1.5, seconds / 4));
  master.gain.setValueAtTime(0.9, Math.max(0, seconds - 1.5));
  master.gain.exponentialRampToValueAtTime(0.0001, seconds);

  const playTone = (
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    dest: AudioNode,
  ) => {
    if (start >= seconds) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const end = Math.min(seconds, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(end + 0.02);
  };

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = preset.chords[bar % preset.chords.length];
    const barStart = bar * barLen;

    // Sustained pad: the whole triad across the bar.
    for (const note of chord) {
      playTone(midi(note), barStart, barLen, preset.padType, 0.10, lp);
      // Add an octave-up shimmer, quieter.
      playTone(midi(note + 12), barStart, barLen, preset.padType, 0.04, lp);
    }

    // Soft bass on the root, one octave down, retriggered on beats 1 and 3.
    playTone(midi(chord[0] - 12), barStart, beat * 2, "sine", 0.16, lp);
    playTone(midi(chord[0] - 12), barStart + beat * 2, beat * 2, "sine", 0.14, lp);

    // Gentle 8th-note arpeggio lead over the chord tones.
    const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12];
    for (let i = 0; i < 8; i++) {
      const t = barStart + i * (beat / 2);
      const n = arp[i % arp.length] + (i >= 4 ? 12 : 0);
      playTone(midi(n), t, beat / 2, preset.leadType, 0.05, lp);
    }
  }

  const buffer = await ctx.startRendering();
  return audioBufferToWav(buffer);
}

/** Encode an AudioBuffer as 16-bit PCM WAV. */
function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize;
  const out = new ArrayBuffer(bufferSize);
  const view = new DataView(out);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let sample = channels[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(out);
}
