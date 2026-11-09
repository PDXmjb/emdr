// Bilateral stimulation: a circle to follow with the eyes, optional panned tone.
// Visual/audio design carried over from the original browser extension (extension/content.js).
const BLS = (() => {
  const $ = id => document.getElementById(id);
  let active = null;      // the running set, if any
  let lastElapsed = 0;    // seconds of movement in the most recent set (pauses excluded)

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

  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // opts:
  //   passes, settings (overrides), hint, countdown   - the guided-session form (counts passes)
  //   durationSec                                     - run for a length of time instead (Infinity = until stopped)
  //   fadeSec                                         - fade circle and tone out over this long at the end
  //   softStop                                        - Stop button / Esc end the set with a fade instead of cutting off
  //   nudgeAfterSec                                   - pause and ask whether to continue after this much movement
  // Resolves 'done' when the set completes or 'stopped' if the user stops it.
  function run(opts = {}) {
    if (active) active.finish('stopped');
    const s = { ...Store.get('bls'), ...(opts.settings || {}) };
    const passes = opts.passes || s.passes;
    const timed = opts.durationSec != null;
    const duration = opts.durationSec;
    const fadeSec = opts.fadeSec || 0;
    const nudgeAfter = opts.nudgeAfterSec || 0;
    const countdown = opts.countdown ?? 3;

    const overlay = $('bls'), circle = $('bls-circle');
    const count = $('bls-count'), hint = $('bls-hint');
    const pauseBtn = $('bls-pause'), stopBtn = $('bls-stop'), fsBtn = $('bls-fs');
    const nudgeEl = $('bls-nudge'), nudgeGo = $('bls-nudge-go'), nudgeEnd = $('bls-nudge-end');

    overlay.style.background = s.bg;
    overlay.hidden = false;
    circle.style.width = circle.style.height = s.diameter + 'px';
    circle.style.background = s.color;
    circle.style.opacity = s.opacity;
    hint.textContent = opts.hint || '';
    pauseBtn.textContent = 'Pause';
    stopBtn.textContent = opts.softStop ? 'End round' : 'Stop';
    nudgeEl.hidden = true;

    let audio = null;
    if (s.sound) {
      try { audio = makeAudio(s); } catch (e) { console.warn('EMDR: audio failed', e); }
    }
    let wakeLock = null;
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});

    return new Promise(resolve => {
      let raf = 0, paused = false, pauseStart = 0, pausedMs = 0, tAtPause = 0;
      let elapsed = 0, softAt = null, nextNudge = nudgeAfter || Infinity, idleTimer = 0;
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
          const t = (now - startAt - pausedMs) / 1000;
          elapsed = t;
          const cycles = t / s.speed;
          if (timed ? t >= duration : cycles >= passes) return finish('done');

          // fade out at the natural end, or when the user ends the round softly
          let amp = 1;
          if (fadeSec > 0) {
            if (timed && isFinite(duration)) amp = Math.min(amp, (duration - t) / fadeSec);
            if (softAt !== null) amp = Math.min(amp, 1 - (now - softAt) / (fadeSec * 1000));
            if (amp <= 0) return finish('done');
            amp = Math.max(0, Math.min(1, amp));
          }

          if (t >= nextNudge && softAt === null) {
            pause();
            nudgeEl.hidden = false;
          } else {
            const { p, y } = position(cycles, s);
            place(p, y);
            circle.style.opacity = s.opacity * amp;
            if (timed) count.textContent = isFinite(duration) ? `${fmtTime(t)} / ${fmtTime(duration)}` : fmtTime(t);
            else count.textContent = `${Math.floor(cycles) + 1} / ${passes}`;
            if (audio) {
              const pan = p * 2 - 1;
              const vol = s.volume * amp * (1 - s.centerFade * (1 - Math.abs(pan)));
              audio.pan.pan.setTargetAtTime(pan, audio.ctx.currentTime, 0.02);
              audio.gain.gain.setTargetAtTime(vol, audio.ctx.currentTime, 0.02);
            }
          }
        }
        raf = requestAnimationFrame(frame);
      }

      function pause() {
        if (paused || performance.now() < startAt) return;
        paused = true;
        pauseStart = performance.now();
        tAtPause = (pauseStart - startAt - pausedMs) / 1000;
        pauseBtn.textContent = 'Resume';
        if (audio) audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.02);
      }

      function resume() {
        if (!paused) return;
        paused = false;
        pausedMs += performance.now() - pauseStart;
        pauseBtn.textContent = 'Pause';
        nudgeEl.hidden = true;
        if (nudgeAfter) nextNudge = tAtPause + nudgeAfter;
      }

      const togglePause = () => (paused ? resume() : pause());

      // End the round: fade out if asked to, otherwise cut straight to the end.
      function endRound() {
        if (!opts.softStop || fadeSec <= 0 || paused || performance.now() < startAt) return finish('stopped');
        if (softAt === null) softAt = performance.now();
      }

      function toggleFs() {
        if (document.fullscreenElement) document.exitFullscreen();
        else overlay.requestFullscreen?.().catch(() => {});
      }

      function onKey(e) {
        if (e.key === 'Escape') endRound();
        else if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key === 'f' || e.key === 'F') toggleFs();
      }

      // Hide the pointer and controls while idle so the screen is just the circle.
      function wake() {
        overlay.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => overlay.classList.add('idle'), 2500);
      }

      function finish(result) {
        if (!active) return;
        active = null;
        lastElapsed = Math.max(0, elapsed);
        cancelAnimationFrame(raf);
        clearTimeout(idleTimer);
        overlay.classList.remove('idle');
        overlay.removeEventListener('mousemove', wake);
        document.removeEventListener('keydown', onKey);
        pauseBtn.onclick = stopBtn.onclick = fsBtn.onclick = nudgeGo.onclick = nudgeEnd.onclick = null;
        nudgeEl.hidden = true;
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
      stopBtn.onclick = endRound;
      fsBtn.onclick = toggleFs;
      nudgeGo.onclick = resume;
      nudgeEnd.onclick = () => { resume(); endRound(); };
      overlay.addEventListener('mousemove', wake);
      document.addEventListener('keydown', onKey);
      wake();
      raf = requestAnimationFrame(frame);
    });
  }

  const stop = () => { if (active) active.finish('stopped'); };
  const isRunning = () => !!active;
  const elapsedSec = () => lastElapsed;

  return { run, stop, isRunning, elapsedSec };
})();
