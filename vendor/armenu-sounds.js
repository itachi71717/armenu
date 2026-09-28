// Shared sound library for ARMenu — one AudioContext, 8 named cues.
// Import once per page: <script src="/vendor/armenu-sounds.js" defer></script>
// Use:  ArMenuSound.play('order')  // any of: order, call, alert, chime, tick, whoosh, pop, error
(function () {
  if (typeof window === 'undefined') return;
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    try { ctx.resume?.(); } catch {}
    return ctx;
  };
  function tone(freq, startOffset, dur, gainPeak = 0.18, type = 'sine') {
    const c = ensure(); if (!c) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(gainPeak, now + startOffset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
    o.connect(g); g.connect(c.destination);
    o.start(now + startOffset); o.stop(now + startOffset + dur + 0.02);
  }
  const cues = {
    // New order — two-note chirp (E5 → A5) that reads as "attention, positive"
    order:  () => { tone(659.25, 0, 0.14); tone(880, 0.13, 0.16); },
    // Waiter call — three quick notes, more urgent
    call:   () => { tone(880, 0, 0.09, 0.2); tone(1046.5, 0.10, 0.09, 0.2); tone(880, 0.20, 0.12, 0.2); },
    // Serious alert — low honk pair
    alert:  () => { tone(440, 0, 0.15, 0.22, 'square'); tone(370, 0.16, 0.20, 0.22, 'square'); },
    // Chime — success (single soft bell)
    chime:  () => { tone(1174.66, 0, 0.35, 0.14); tone(1567.98, 0.02, 0.35, 0.08); },
    // Tick — minor confirm (button press etc)
    tick:   () => { tone(1500, 0, 0.03, 0.09, 'square'); },
    // Whoosh — sheet slide-in
    whoosh: () => {
      const c = ensure(); if (!c) return;
      const now = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = 200;
      o.frequency.exponentialRampToValueAtTime(80, now + 0.18);
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      o.connect(g); g.connect(c.destination); o.start(now); o.stop(now + 0.22);
    },
    // Pop — add-to-cart
    pop:    () => { tone(600, 0, 0.05, 0.14, 'triangle'); tone(900, 0.03, 0.06, 0.10, 'triangle'); },
    // Error — descending
    error:  () => { tone(400, 0, 0.10, 0.16, 'square'); tone(280, 0.09, 0.16, 0.16, 'square'); }
  };

  // Mute toggle — remembered in localStorage per device
  const MUTE_KEY = 'armenu_sound_muted';
  function isMuted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } }
  function setMuted(v) { try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch {} }

  window.ArMenuSound = {
    play(name) {
      if (isMuted()) return;
      try {
        // Inactive tabs suspend the AudioContext — check and resume on every attempt.
        if (ctx && ctx.state === 'suspended') ctx.resume();
        const fn = cues[name]; if (fn) fn();
      } catch {}
    },
    mute() { setMuted(true); },
    unmute() { setMuted(false); },
    muted: isMuted,
    toggle() { setMuted(!isMuted()); return isMuted(); }
  };
})();
