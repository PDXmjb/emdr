// Free mode: tone and eye movement for a chosen length of time, then a quiet rest until you
// start the next round. No questions, no chat. Rounds are logged to Targets & history.
const FreeMode = (() => {
  const PRESETS = [[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min'], [1800, '30 min']];

  let root = null, h = null;      // tab element and the el() helper passed in by app.js
  let phase = 'idle';             // idle | running | rest
  let run = null;                 // { id, start, rounds, activeSec } for the current sitting
  let autoTimer = null, autoLeft = 0;
  let chimeCtx = null;
  let message = '';

  const cfg = () => Store.get('free');
  const save = f => Store.set('free', f);

  function fmt(sec) {
    sec = Math.round(sec);
    const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
    if (hh) return `${hh}h ${mm}m ${ss}s`;
    return mm ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
  }

  // A single low, soft tone to mark the end of a round.
  function chime() {
    try {
      chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
      const c = chimeCtx;
      c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = 330;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(0.15, c.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.2);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 2.3);
    } catch (e) { /* the chime is optional */ }
  }

  function logRun() {
    Store.upsertSession({
      id: run.id, date: run.start, type: 'free', rounds: run.rounds, sets: run.rounds,
      activeSec: Math.round(run.activeSec), minutes: Math.round(run.activeSec / 60),
      incomplete: false, notes: '', transcript: []
    });
  }

  function cancelAuto() {
    clearInterval(autoTimer);
    autoTimer = null;
  }

  function armAuto() {
    cancelAuto();
    const f = cfg();
    if (!f.auto) return;
    autoLeft = f.autoSec;
    autoTimer = setInterval(() => {
      autoLeft--;
      const n = root && root.querySelector('#free-auto-n');
      if (n) n.textContent = autoLeft;
      if (autoLeft <= 0) { cancelAuto(); startRound(); }
    }, 1000);
  }

  async function startRound() {
    if (phase === 'running') return;
    cancelAuto();
    if ('speechSynthesis' in window) speechSynthesis.cancel(); // don't talk over the round
    const f = cfg();
    if (!run) run = { id: Store.uid(), start: Date.now(), rounds: 0, activeSec: 0 };
    phase = 'running';
    message = '';

    const dur = f.infinite ? Infinity : f.seconds;
    const nudgeSec = f.nudge ? f.nudgeMin * 60 : 0;
    await BLS.run({
      durationSec: dur,
      fadeSec: 2,
      softStop: true,
      countdown: 2,
      nudgeAfterSec: nudgeSec && dur > nudgeSec ? nudgeSec : 0
    });

    run.rounds++;
    run.activeSec += BLS.elapsedSec();
    logRun();
    phase = 'rest';
    if (f.chime) chime();
    render();
    armAuto();
    // an auto-start may need the counting line, so refresh it once the timer exists
    if (autoTimer) render();
  }

  function finish() {
    cancelAuto();
    message = run && run.rounds ? `Saved: ${run.rounds} round${run.rounds > 1 ? 's' : ''}, ${fmt(run.activeSec)} of eye movement.` : '';
    run = null;
    phase = 'idle';
    render();
  }

  // ---- small UI helpers
  function check(label, key, after) {
    const f = cfg();
    const box = h('input', { type: 'checkbox' });
    box.checked = !!f[key];
    box.addEventListener('change', () => { const g = cfg(); g[key] = box.checked; save(g); if (after) after(box.checked); render(); });
    return h('label', { class: 'check' }, box, ' ' + label);
  }

  function num(value, min, max, onChange, disabled) {
    const input = h('input', { type: 'number', min, max, value, disabled: disabled ? '' : false, class: 'num' });
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
      input.value = v;
      onChange(v);
    });
    return input;
  }

  function settingsCard() {
    const f = cfg();
    const bls = Store.get('bls');
    const hh = Math.floor(f.seconds / 3600), mm = Math.floor(f.seconds % 3600 / 60), ss = f.seconds % 60;
    const setSeconds = (a, b, c) => {
      const g = cfg();
      g.seconds = Math.max(5, a * 3600 + b * 60 + c);
      save(g);
      render();
    };

    const chips = h('div', { class: 'chips' }, PRESETS.map(([v, label]) =>
      h('button', { type: 'button', class: 'chip' + (!f.infinite && f.seconds === v ? ' on' : ''), onclick: () => {
        const g = cfg(); g.seconds = v; g.infinite = false; save(g); render();
      } }, label)));

    const custom = h('div', { class: 'free-custom' },
      num(hh, 0, 23, v => setSeconds(v, mm, ss), f.infinite), ' h ',
      num(mm, 0, 59, v => setSeconds(hh, v, ss), f.infinite), ' m ',
      num(ss, 0, 59, v => setSeconds(hh, mm, v), f.infinite), ' s');

    const speedVal = h('span', { class: 'val' }, bls.speed.toFixed(1) + 's');
    const speed = h('input', { type: 'range', min: 0.5, max: 5, step: 0.1, value: bls.speed });
    speed.addEventListener('input', () => {
      const b = Store.get('bls'); b.speed = parseFloat(speed.value); Store.set('bls', b);
      speedVal.textContent = b.speed.toFixed(1) + 's';
    });
    const tone = h('input', { type: 'checkbox' });
    tone.checked = !!bls.sound;
    tone.addEventListener('change', () => { const b = Store.get('bls'); b.sound = tone.checked; Store.set('bls', b); });

    return h('div', { class: 'card' },
      h('h3', {}, 'Round length'),
      chips,
      custom,
      check("Don't stop: run until I end the round", 'infinite'),
      h('h3', { class: 'free-sub' }, 'Between rounds'),
      h('div', { class: 'free-row' }, check('Start the next round automatically after', 'auto', on => { if (!on) cancelAuto(); }),
        num(f.autoSec, 5, 600, v => { const g = cfg(); g.autoSec = v; save(g); }, !f.auto), ' seconds'),
      check('Soft chime when a round ends', 'chime'),
      h('div', { class: 'free-row' }, check('Check-in prompt after', 'nudge'),
        num(f.nudgeMin, 1, 60, v => { const g = cfg(); g.nudgeMin = v; save(g); }, !f.nudge), ' minutes of continuous movement'),
      check('Show round and time counters', 'counters'),
      h('h3', { class: 'free-sub' }, 'Circle & tone'),
      h('div', { class: 'field' }, h('label', {}, 'Speed (seconds per pass)'), speed, speedVal),
      h('label', { class: 'check' }, tone, ' Stereo tone (use headphones)'),
      h('p', { class: 'muted small' }, 'Size, colours, tone pitch and more are in Settings. Changes apply from the next round.'));
  }

  function render(rootEl, elFn) {
    if (rootEl) { root = rootEl; h = elFn; }
    if (!root) return;
    const f = cfg();
    root.replaceChildren();

    root.append(h('div', { class: 'free-top' },
      h('h2', {}, 'Free mode'),
      h('button', { class: 'link', onclick: () => { const g = cfg(); g.hidden = !g.hidden; save(g); render(); } },
        f.hidden ? 'Show settings' : 'Hide settings')));

    if (!f.hidden) root.append(settingsCard());

    const length = f.infinite ? 'until you end the round' : fmt(f.seconds);
    let main;
    if (phase === 'rest') {
      const next = h('button', { class: 'btn-muted', onclick: startRound }, 'Next round');
      main = h('div', { class: 'free-rest' },
        h('p', { class: 'free-breathe' }, 'Take a breath. Notice what you notice.'),
        next,
        f.counters && run ? h('p', { class: 'muted small' }, `Round ${run.rounds} · ${fmt(run.activeSec)} of eye movement so far`) : '',
        autoTimer ? h('p', { class: 'muted small' }, 'Next round in ', h('span', { id: 'free-auto-n' }, String(autoLeft)), ' s · ',
          h('button', { class: 'link', onclick: () => { cancelAuto(); render(); } }, 'cancel')) : '',
        h('button', { class: 'link', onclick: finish }, 'Finish & save'));
      setTimeout(() => next.focus());
    } else {
      main = h('div', { class: 'free-rest' },
        message ? h('p', { class: 'muted' }, message) : '',
        h('button', { class: 'primary big', onclick: startRound }, 'Start'),
        h('p', { class: 'muted small' }, `Round length: ${length}. Esc or End round fades out gently.`));
    }
    root.append(main);
  }

  // Enter / Space starts the next round while resting (when nothing else has focus).
  document.addEventListener('keydown', e => {
    if (phase !== 'rest' || !root || root.hidden || BLS.isRunning()) return;
    if (document.querySelector('.overlay:not([hidden])')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startRound(); }
  });

  // Called when the user switches to another tab: don't auto-start rounds in the background.
  const leave = () => { cancelAuto(); if (phase === 'rest' && root && !root.hidden) render(); };

  return { render, leave };
})();
