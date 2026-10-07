import { describe, it, expect, vi } from 'vitest';
import { BuzzerAudio, isBuzzerEvent } from '../src/ui/audio.js';

/**
 * A stand-in for WebAudio.
 *
 * jsdom has no AudioContext at all, and the real one needs a sound device and
 * a user gesture, so the class takes a factory and this records what it was
 * asked to play.
 */
function fakeContext() {
  const events: string[] = [];
  let now = 0;
  const param = (name: string, initial: number) => {
    const p = {
      value: initial,
      // Ramped towards a target: a glide, if it is the frequency.
      setTargetAtTime: (target: number) => {
        p.value = target;
        events.push(`${name}~${Math.round(target * 1000) / 1000}`);
      },
      // Set outright, between one cycle and the next.
      setValueAtTime: (target: number) => {
        p.value = target;
        events.push(`${name}=${Math.round(target * 1000) / 1000}`);
      },
    };
    return p;
  };
  const oscillators: { type: string; frequency: { value: number }; stopped: boolean }[] = [];
  const filters: { type: string; frequency: { value: number }; Q: { value: number }; gain: { value: number } }[] =
    [];
  const ctx = {
    state: 'running' as AudioContextState,
    get currentTime() {
      return now;
    },
    destination: {},
    createOscillator: () => {
      const osc = {
        type: 'sine',
        frequency: param('freq', 0),
        stopped: false,
        start: () => events.push('start'),
        stop: () => {
          osc.stopped = true;
          events.push('stop');
        },
        connect: () => {},
        disconnect: () => {},
      };
      oscillators.push(osc as never);
      return osc;
    },
    createGain: () => ({
      gain: param('gain', 0),
      connect: () => {},
      disconnect: () => {},
    }),
    createBiquadFilter: () => {
      const f = {
        type: 'peaking',
        frequency: param('filterFreq', 0),
        Q: param('q', 1),
        gain: param('filterGain', 0),
        connect: () => {},
        disconnect: () => {},
      };
      filters.push(f as never);
      return f;
    },
    resume: () => {
      ctx.state = 'running';
      events.push('resume');
      return Promise.resolve();
    },
  };
  return {
    ctx,
    events,
    oscillators,
    filters,
    advance: (seconds: number) => (now += seconds),
  };
}

function audio(masterGain = 1) {
  const fake = fakeContext();
  return {
    fake,
    a: new BuzzerAudio({ create: () => fake.ctx as unknown as AudioContext, masterGain }),
  };
}

describe('isBuzzerEvent', () => {
  it('recognises what a buzzer reports', () => {
    expect(isBuzzerEvent({ frequency: 440, playing: true, volume: 1 })).toBe(true);
  });

  it('ignores every other part', () => {
    // The same handler sees LED brightness, LCD text and pin states.
    expect(isBuzzerEvent({ brightness: 1 })).toBe(false);
    expect(isBuzzerEvent({ pressed: true })).toBe(false);
    expect(isBuzzerEvent({ frequency: 440 })).toBe(false);
  });
});

describe('BuzzerAudio', () => {
  it('plays a square wave at the frequency reported', () => {
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    expect(fake.oscillators).toHaveLength(1);
    // A piezo buzzer is driven by a square wave, and sounds like one.
    expect(fake.oscillators[0].type).toBe('square');
    expect(fake.events).toContain('freq=440');
    expect(fake.events).toContain('gain~1');
  });

  it('keeps one oscillator across a melody rather than one per note', () => {
    /*
     * A sketch playing a tune changes pitch many times a second. Building a
     * new oscillator for each note clicks, and leaks one per note.
     */
    const { a, fake } = audio();
    for (const frequency of [262, 294, 330, 349]) {
      a.update('bz1', { playing: true, frequency, volume: 1 });
    }
    expect(fake.oscillators).toHaveLength(1);
    expect(fake.events.filter((e) => e.startsWith('freq='))).toEqual([
      'freq=262',
      'freq=294',
      'freq=330',
      'freq=349',
    ]);
  });

  it('changes pitch outright, without gliding between notes', () => {
    /*
     * Ramping the frequency is a portamento, which is what made a melody sound
     * like a theremin rather than a beeper: every note slid into the next. A
     * buzzer's pin changes frequency between one cycle and the next.
     */
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    a.update('bz1', { playing: true, frequency: 880, volume: 1 });
    expect(fake.events.filter((e) => e.startsWith('freq'))).toEqual(['freq=440', 'freq=880']);
    // A glide would show up as `freq~880`.
    expect(fake.events.some((e) => e.startsWith('freq~'))).toBe(false);
  });

  it('shapes the tone the way a piezo case does', () => {
    /*
     * A piezo buzzer is a resonator in a small plastic case, not a
     * loudspeaker: little output down low, a sharp peak a few kHz up. Sending
     * the bare square wave to the speakers put all the energy in the
     * fundamental, which is why it sounded like a synthesiser.
     */
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    const highpass = fake.filters.find((f) => f.type === 'highpass');
    const peak = fake.filters.find((f) => f.type === 'peaking');
    expect(highpass, 'the low end is rolled off').toBeDefined();
    expect(peak, 'the case resonance is lifted').toBeDefined();
    expect(peak!.gain.value).toBeGreaterThan(0);
    // The resonance sits well above the notes a sketch plays, or it would just
    // be a tone control.
    expect(peak!.frequency.value).toBeGreaterThan(1500);
  });

  it('builds the filters once, not once per note', () => {
    const { a, fake } = audio();
    for (const frequency of [262, 294, 330]) {
      a.update('bz1', { playing: true, frequency, volume: 1 });
    }
    expect(fake.filters).toHaveLength(2);
  });

  it('clicks in accurate mode, as Wokwi says it does', () => {
    // Wokwi's two modes: "smooth" shapes the note edges, "accurate" is precise
    // and clicks. Ramping in accurate mode would be the wrong part.
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1, mode: 'accurate' });
    expect(fake.events).toContain('gain=1');
    expect(fake.events.some((e) => e.startsWith('gain~'))).toBe(false);
  });

  it('goes quiet when the tone stops', () => {
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    a.update('bz1', { playing: false, frequency: 0 });
    expect(fake.events.at(-1)).toBe('gain~0');
  });

  it('scales the level by the part volume', () => {
    const { a, fake } = audio(0.06);
    a.update('bz1', { playing: true, frequency: 440, volume: 0.5 });
    expect(fake.events).toContain('gain~0.03');
  });

  it('never makes a sound above the level it was given', () => {
    // A square wave through someone's headphones; the attribute cannot turn
    // this up past what the app chose.
    const { a, fake } = audio(0.06);
    a.update('bz1', { playing: true, frequency: 440, volume: 99 });
    expect(fake.events).toContain('gain~0.06');
  });

  it('refuses a frequency nobody can hear', () => {
    // These come out of the measurement when a pin toggles oddly - a
    // sub-audible or ultrasonic "tone" is a measurement, not a note.
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 3, volume: 1 });
    a.update('bz2', { playing: true, frequency: 44_000, volume: 1 });
    expect(fake.oscillators).toHaveLength(0);
  });

  it('gives each buzzer its own voice', () => {
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    a.update('bz2', { playing: true, frequency: 880, volume: 1 });
    expect(fake.oscillators).toHaveLength(2);
  });

  it('tears the oscillators down when the simulation stops', () => {
    // A stopped simulation should hold no audio resources, and must not hum.
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    a.stopAll();
    expect(fake.oscillators[0].stopped).toBe(true);
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    expect(fake.oscillators).toHaveLength(2);
  });

  it('stays silent while muted', () => {
    const { a, fake } = audio();
    a.setMuted(true);
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    expect(fake.oscillators).toHaveLength(0);
  });

  it('picks a held note back up when unmuted', () => {
    /*
     * A buzzer reports a change, not a heartbeat: a note held through the mute
     * says nothing more, so unmuting has to reapply what was last asked for
     * rather than wait for an event that never comes.
     */
    const { a, fake } = audio();
    a.update('bz1', { playing: true, frequency: 440, volume: 1 });
    a.setMuted(true);
    expect(fake.events.at(-1)).toBe('gain~0');
    a.setMuted(false);
    expect(fake.events.at(-1)).toBe('gain~1');
  });

  it('reports whether it is muted', () => {
    const { a } = audio();
    expect(a.isMuted).toBe(false);
    a.setMuted(true);
    expect(a.isMuted).toBe(true);
  });

  it('wakes a context the browser suspended', () => {
    // A context built before the person has interacted with the page starts
    // suspended, and pressing Start is that interaction.
    const fake = fakeContext();
    fake.ctx.state = 'suspended';
    const a = new BuzzerAudio({ create: () => fake.ctx as unknown as AudioContext });
    a.resume();
    expect(fake.events).toContain('resume');
    expect(a.isRunning).toBe(true);
  });

  it('carries on silently on a machine with no audio at all', () => {
    /*
     * No sound device, or a browser without WebAudio. The simulation is still
     * perfectly usable, so this must not throw at every part event.
     */
    const create = vi.fn(() => {
      throw new Error('no audio device');
    });
    const a = new BuzzerAudio({ create });
    expect(() => a.update('bz1', { playing: true, frequency: 440 })).not.toThrow();
    a.update('bz1', { playing: true, frequency: 550 });
    // Tried once, then left alone rather than throwing on every event.
    expect(create).toHaveBeenCalledTimes(1);
    expect(a.isRunning).toBe(false);
  });
});
