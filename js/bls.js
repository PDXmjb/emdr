// Bilateral stimulation: a circle to follow with the eyes, optional panned tone.
// Visual/audio design carried over from the original browser extension (extension/content.js).
const BLS = (() => {
  const $ = id => document.getElementById(id);
  let active = null; // the running set, if any

  function makeAudio(s) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = s.frequency;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    osc.connect(gain).connect(pan).connect(ctx.destination);
    osc.start();
    ctx.resume();
    return { ctx, osc, gain, pan };
  }

  function position(cycles, s) {
    let p;
    if (s.motion === 'linear') {
      const f = cycles % 1;
      p = f < 0.5 ? 2 * f : 2 - 2 * f;
    } else {
      p = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycles);
    }
    const y = s.pattern === 'figure8' ? Math.sin(4 * Math.PI * cycles) : 0;
    return { p, y };
  }

  // opts: { passes, settings (overrides), hint, countdown }
  // Resolves 'done' when the set completes or 'stopped' if the user stops it.
  function run(opts = {}) {
    if (active) active.finish('stopped');
    const s = { ...Store.get('bls'), ...(opts.settings || {}) };
    const passes = opts.passes || s.passes;
    const countdown = opts.countdown ?? 3;

    const overlay = $('bls'), circle = $('bls-circle');
    const count = $('bls-count'), hint = $('bls-hint');
    const pauseBtn = $('bls-pause'), stopBtn = $('bls-stop'), fsBtn = $('bls-fs');

    overlay.style.background = s.bg;
    overlay.hidden = false;
    circle.style.width = circle.style.height = s.diameter + 'px';
    circle.style.background = s.color;
    circle.style.opacity = s.opacity;
    hint.textContent = opts.hint || '';
    pauseBtn.textContent = 'Pause';

    let audio = null;
    if (s.sound) {
      try { audio = makeAudio(s); } catch (e) { console.warn('EMDR: audio failed', e); }
    }
    let wakeLock = null;
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});

    return new Promise(resolve => {
      let raf = 0, paused = false, pauseStart = 0, pausedMs = 0;
      const startAt = performance.now() + countdown * 1000;

      function place(p, y) {
        const W = overlay.clientWidth, H = overlay.clientHeight;
        const span = W * s.widthPct / 100;
        const left = (W - span) / 2;
        const x = left + p * (span - s.diameter);
        const yy = H / 2 - s.diameter / 2 + y * H * 0.15;
        circle.style.transform = `translate3d(${x}px, ${yy}px, 0)`;
      }

      function frame(now) {
        if (now < startAt) {
          place(0, 0);
          count.textContent = 'Starting in ' + Math.ceil((startAt - now) / 1000);
        } else if (!paused) {
          const cycles = (now - startAt - pausedMs) / 1000 / s.speed;
          if (cycles >= passes) return finish('done');
          const { p, y } = position(cycles, s);
          place(p, y);
          count.textContent = `${Math.floor(cycles) + 1} / ${passes}`;
          if (audio) {
            const pan = p * 2 - 1;
            const vol = s.volume * (1 - s.centerFade * (1 - Math.abs(pan)));
            audio.pan.pan.setTargetAtTime(pan, audio.ctx.currentTime, 0.02);
            audio.gain.gain.setTargetAtTime(vol, audio.ctx.currentTime, 0.02);
          }
        }
        raf = requestAnimationFrame(frame);
      }

      function togglePause() {
        if (performance.now() < startAt) return;
        paused = !paused;
        pauseBtn.textContent = paused ? 'Resume' : 'Pause';
        if (paused) {
          pauseStart = performance.now();
          if (audio) audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.02);
        } else {
          pausedMs += performance.now() - pauseStart;
        }
      }

      function toggleFs() {
        if (document.fullscreenElement) document.exitFullscreen();
        else overlay.requestFullscreen?.().catch(() => {});
      }

      function onKey(e) {
        if (e.key === 'Escape') finish('stopped');
        else if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key === 'f' || e.key === 'F') toggleFs();
      }

      function finish(result) {
        if (!active) return;
        active = null;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        pauseBtn.onclick = stopBtn.onclick = fsBtn.onclick = null;
        if (audio) {
          try { audio.osc.stop(); audio.ctx.close(); } catch (e) {}
        }
        if (wakeLock) wakeLock.release().catch(() => {});
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        overlay.hidden = true;
        resolve(result);
      }

      active = { finish };
      pauseBtn.onclick = togglePause;
      stopBtn.onclick = () => finish('stopped');
      fsBtn.onclick = toggleFs;
      document.addEventListener('keydown', onKey);
      raf = requestAnimationFrame(frame);
    });
  }

  const stop = () => { if (active) active.finish('stopped'); };
  const isRunning = () => !!active;

  return { run, stop, isRunning };
})();
