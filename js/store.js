// Persistent state in localStorage. Everything stays in this browser.
const Store = (() => {
  const PREFIX = 'emdr.';
  const defaults = {
    bls: {
      diameter: 90,
      speed: 1.4,        // seconds per full left-right-left pass
      passes: 30,        // passes per set
      widthPct: 90,      // % of screen width the circle travels
      opacity: 1,
      color: '#4a90d9',
      bg: '#0b0f1a',
      motion: 'smooth',  // smooth | linear
      pattern: 'horizontal', // horizontal | figure8
      sound: false,
      volume: 0.4,
      frequency: 400,
      centerFade: 0
    },
    ai: { key: '', model: 'claude-sonnet-5-5' },
    tts: { on: false, voice: '', rate: 1 }, // read the guide's messages aloud
    free: {
      seconds: 60, infinite: false,      // round length
      auto: false, autoSec: 30,          // start the next round automatically
      chime: true,                       // soft tone when a round ends
      nudge: true, nudgeMin: 5,          // check-in prompt after this much continuous movement
      counters: true, hidden: false      // show the counters / hide the settings panel
    },
    safePlace: '',
    targets: [],
    sessions: []
  };

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));

  function get(k) {
    try {
      const raw = localStorage.getItem(PREFIX + k);
      if (raw == null) return clone(defaults[k]);
      const v = JSON.parse(raw);
      return isObj(defaults[k]) ? { ...defaults[k], ...v } : v;
    } catch (e) {
      return clone(defaults[k]);
    }
  }

  function set(k, v) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); }
    catch (e) { console.warn('EMDR: could not save', k, e); }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function saveTarget(t) {
    const all = get('targets');
    const i = all.findIndex(x => x.id === t.id);
    if (i >= 0) all[i] = t; else all.push(t);
    set('targets', all);
  }

  function deleteTarget(id) {
    set('targets', get('targets').filter(t => t.id !== id));
  }

  function addSession(s) {
    const all = get('sessions');
    all.push(s);
    set('sessions', all);
  }

  function upsertSession(s) {
    const all = get('sessions');
    const i = all.findIndex(x => x.id === s.id);
    if (i >= 0) all[i] = s; else all.push(s);
    set('sessions', all);
  }

  function exportAll() {
    const out = {};
    for (const k of Object.keys(defaults)) out[k] = get(k);
    out.ai.key = ''; // never export the API key
    return out;
  }

  function importAll(data) {
    for (const k of ['bls', 'tts', 'free', 'safePlace', 'targets', 'sessions']) {
      if (data[k] !== undefined) set(k, data[k]);
    }
  }

  function wipe() {
    for (const k of Object.keys(defaults)) localStorage.removeItem(PREFIX + k);
  }

  return { get, set, uid, saveTarget, deleteTarget, addSession, upsertSession, exportAll, importAll, wipe, defaults };
})();
