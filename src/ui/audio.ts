/**
 * Sound for the buzzer.
 *
 * The buzzer part measures the square wave across its pins and reports a
 * frequency; until this existed, nothing listened. It drew its rings and made
 * no sound, which is not what a buzzer is for.
 *
 * The part stays headless so it can be tested without a browser, so the
 * WebAudio side lives here. One oscillator per buzzer, kept alive across
 * frequency changes: a sketch playing a melody changes the pitch dozens of
 * times a second, and building a new oscillator for each note clicks.
 */

export interface BuzzerState {
  playing?: boolean;
  frequency?: number;
  /** The part's `volume` attribute, 0-1. */
  volume?: number;
  /** The part's `mode`: "smooth" shapes the note edges, "accurate" does not. */
  mode?: string;
}

interface Voice {
  osc: OscillatorNode;
  /** Rolls off everything the little element cannot move air with. */
  highpass: BiquadFilterNode;
  /** The case resonance that gives a buzzer its voice. */
  resonance: BiquadFilterNode;
  gain: GainNode;
}

/**
 * How loud a buzzer at full volume is.
 *
 * A square wave is harsh, and this plays through whatever the person has
 * their machine set to. Loud enough to hear, quiet enough not to hurt.
 */
const MASTER_GAIN = 0.06;

/**
 * Gain ramp, in seconds, in Wokwi's "smooth" mode.
 *
 * Short: this is meant to take the click off a note edge, not to soften it
 * into a synthesiser's envelope. Wokwi's other mode, "accurate", does not ramp
 * at all and clicks, which is what a piezo driven by a pin really does.
 */
const RAMP = 0.004;

/*
 * What makes a buzzer sound like a buzzer.
 *
 * A piezo buzzer is a stiff disc in a small plastic case, and it is a
 * resonator, not a loudspeaker: it has a sharp mechanical resonance a few kHz
 * up, and almost no output below it. A bare square wave sent straight to the
 * speakers has all its energy in the fundamental, which is why it came out
 * sounding like a synth rather than a five-cent beeper.
 *
 * Two filters stand in for the case: the low end is rolled away, and the
 * resonance is lifted. What is left is mostly upper harmonics, so a low note
 * is still heard at its own pitch through them - exactly how a real buzzer
 * sounds thin and reedy rather than deep.
 */
const CASE_RESONANCE_HZ = 2800;
const CASE_Q = 1.4;
const CASE_LIFT_DB = 9;
const BODY_ROLLOFF_HZ = 900;

export interface BuzzerAudioOptions {
  /** Injectable so the sound can be tested without a browser. */
  create?: () => AudioContext;
  masterGain?: number;
}

export class BuzzerAudio {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, Voice>();
  private muted = false;
  /** Set when there is no audio to be had, so this stops trying every event. */
  private unavailable = false;
  private readonly create: () => AudioContext;
  private readonly masterGain: number;
  /** What each buzzer last asked for, so unmuting can pick it back up. */
  private wanted = new Map<string, BuzzerState>();

  constructor(options: BuzzerAudioOptions = {}) {
    this.create =
      options.create ??
      (() => {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error('this browser has no WebAudio');
        return new Ctor();
      });
    this.masterGain = options.masterGain ?? MASTER_GAIN;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** True once an audio context exists and is not suspended. */
  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Start or wake the audio context.
   *
   * Browsers refuse to play sound until the person has interacted with the
   * page, and a context created before that starts suspended. Pressing Start
   * is an interaction, so that is where this is called from - otherwise the
   * first tone of a sketch that beeps in `setup()` would be lost.
   */
  resume(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private context(): AudioContext | null {
    if (this.ctx || this.unavailable) return this.ctx;
    try {
      this.ctx = this.create();
    } catch {
      // No audio device, or a browser without WebAudio. The simulation is
      // still perfectly usable, so this is not worth an error in the UI.
      this.unavailable = true;
    }
    return this.ctx;
  }

  /** Apply what a buzzer is reporting. */
  update(partId: string, state: BuzzerState): void {
    this.wanted.set(partId, state);
    this.apply(partId, state);
  }

  private apply(partId: string, state: BuzzerState): void {
    const frequency = state.frequency ?? 0;
    const playing = state.playing === true && frequency > 0 && !this.muted;
    if (!playing) {
      this.silence(partId);
      return;
    }

    const ctx = this.context();
    if (!ctx) return;
    // A tone below 20Hz is not a tone, and above 20kHz nobody hears it; both
    // come out of the measurement when a pin is toggling oddly.
    if (frequency < 20 || frequency > 20_000) {
      this.silence(partId);
      return;
    }

    const volume = Math.max(0, Math.min(1, state.volume ?? 1));
    let voice = this.voices.get(partId);
    if (!voice) {
      const osc = ctx.createOscillator();
      // A piezo buzzer is driven by a square wave, and sounds like one.
      osc.type = 'square';

      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = BODY_ROLLOFF_HZ;

      const resonance = ctx.createBiquadFilter();
      resonance.type = 'peaking';
      resonance.frequency.value = CASE_RESONANCE_HZ;
      resonance.Q.value = CASE_Q;
      resonance.gain.value = CASE_LIFT_DB;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(highpass);
      highpass.connect(resonance);
      resonance.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      voice = { osc, highpass, resonance, gain };
      this.voices.set(partId, voice);
    }

    /*
     * The pitch is set, not ramped.
     *
     * Ramping it glides from one note to the next, which is a portamento - a
     * sound no buzzer has ever made, and the reason a melody came out sounding
     * like a theremin. A buzzer's pin changes frequency between one cycle and
     * the next, so this does too.
     */
    voice.osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    const level = this.masterGain * volume;
    if (state.mode === 'accurate') {
      // Wokwi's word for it: precise, and it clicks.
      voice.gain.gain.setValueAtTime(level, ctx.currentTime);
    } else {
      // Only the level is ramped, and only enough to take the click off.
      voice.gain.gain.setTargetAtTime(level, ctx.currentTime, RAMP);
    }
  }

  private silence(partId: string): void {
    const voice = this.voices.get(partId);
    if (!voice || !this.ctx) return;
    voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, RAMP);
  }

  /** Disconnect everything in one voice. */
  private teardown(voice: Voice): void {
    try {
      voice.osc.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    for (const node of [voice.osc, voice.highpass, voice.resonance, voice.gain]) {
      node.disconnect();
    }
  }

  /**
   * Stop every buzzer.
   *
   * Called when the simulation stops. The oscillators are torn down rather
   * than left silent: a stopped simulation should hold no audio resources,
   * and the next run builds them again.
   */
  stopAll(): void {
    for (const [, voice] of this.voices) this.teardown(voice);
    this.voices.clear();
    this.wanted.clear();
  }

  /** Mute or unmute every buzzer, now and in future. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    // Unmuting picks the tones back up rather than waiting for the next
    // change: a held note reports once and then says nothing more.
    for (const [partId, state] of this.wanted) this.apply(partId, state);
  }
}

/** True when a part event carries something a buzzer would report. */
export function isBuzzerEvent(event: Record<string, unknown>): boolean {
  return typeof event.frequency === 'number' && typeof event.playing === 'boolean';
}
