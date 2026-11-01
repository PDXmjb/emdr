// EMDR Companion: session flow, chat UI, targets and settings views.
// The session is written as a linear async script that mirrors the 8-phase protocol.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) n.append(kid);
    return n;
  }

  class EndSession extends Error {}

  // ---------------------------------------------------------------- state
  let S = null;          // current session
  let H = [];            // chat history for the model [{role, content}]
  let pendingReject = null;
  let sessionRunning = false;

  function newSession() {
    S = {
      id: Store.uid(), start: Date.now(), type: 'full', target: null, sets: 0,
      endRequested: false, crisis: false, incomplete: false, phase: 'intro',
      checkIn: null, sudStart: null, sudNow: null, sudEnd: null,
      vocStart: null, vocNow: null, vocEnd: null, notes: ''
    };
    H = [];
  }

  const minutes = () => Math.round((Date.now() - S.start) / 60000);

  function context() {
    const t = S.target;
    return {
      phase: S.phase, minutesElapsed: minutes(), setsDone: S.sets,
      checkInDistress: S.checkIn, currentSUD: S.sudNow, currentVOC: S.vocNow,
      target: t && { title: t.title, image: t.image, negativeBelief: t.nc, positiveBelief: t.pc, emotions: t.emotions, bodyLocation: t.body }
    };
  }

  // ---------------------------------------------------------------- chat UI
  const chat = $('#chat'), widget = $('#widget');

  // Stick to the bottom unless the reader has scrolled up. The chat box also resizes when
  // input widgets appear or disappear, so react to size and content changes, not just new bubbles.
  let stick = true;
  chat.addEventListener('scroll', () => {
    stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  });
  function scroll() { if (stick) chat.scrollTop = chat.scrollHeight; }
  new ResizeObserver(scroll).observe(chat);
  new MutationObserver(scroll).observe(chat, { childList: true, subtree: true, characterData: true });

  function bubble(kind, text) {
    if (kind === 'you') stick = true;
    const n = el('div', { class: 'msg ' + kind }, text);
    chat.append(n);
    scroll();
    return n;
  }

  // Read the guide's messages aloud with the browser's built-in voices (Settings > Read aloud).
  const TTS = {
    available: 'speechSynthesis' in window,
    gen: 0, // bumped by stop() so queued-but-unspoken messages are dropped
    // Edge/Chrome load voices lazily. On a fresh page load the list is empty, which made a saved
    // voice fall back to the default. Wait for the list (max 4s) before speaking.
    ready: null,
    whenReady() {
      if (!this.ready) {
        this.ready = new Promise(resolve => {
          if (speechSynthesis.getVoices().length) return resolve();
          const done = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged', done); resolve(); };
          const timer = setTimeout(done, 4000);
          speechSynthesis.addEventListener('voiceschanged', done);
        });
      }
      return this.ready;
    },
    async speak(text) {
      const c = Store.get('tts');
      if (!c.on || !this.available) return;
      const gen = this.gen;
      await this.whenReady();
      if (gen !== this.gen) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = c.rate;
      const v = speechSynthesis.getVoices().find(x => x.name === c.voice);
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    },
    stop() {
      this.gen++;
      if (this.available) speechSynthesis.cancel();
    }
  };

  function say(text) {
    bubble('guide', text);
    H.push({ role: 'assistant', content: text });
    TTS.speak(text);
  }

  function note(text) { bubble('note', text); }

  function phase(name) {
    S.phase = name;
    bubble('phase', name);
  }

  function userSays(text) {
    TTS.stop();
    bubble('you', text);
    H.push({ role: 'user', content: text });
    if (/\b(kill myself|suicid|end my life|want to die|better off dead|hurt myself|harm myself|self[- ]harm|cut myself)\b/i.test(text)) {
      S.crisis = true;
      $('#crisis').hidden = false;
      if (String(S.phase).toLowerCase() !== 'closure' && sessionRunning) requestEnd();
    }
  }

  // Scripted prompts are therapist turns; fallbacks are used when there is no API key or it fails.
  const FALLBACK = {
    opening: 'Thank you for checking in. You set the pace here, and you can stop at any time.',
    reflect: 'Thank you. Noticing that is useful.',
    desens: 'Good. Go with that.',
    interweave: 'As you hold this in mind, ask yourself: what would I say to a friend who went through this? Let whatever comes up come up in the next set.',
    closure: 'You did real work today. Unfinished processing is normal, and it can continue between sessions. New thoughts, feelings or dreams may surface. Be gentle with yourself, drink some water, use your calm place and the grounding tools, and jot down anything that comes up. Bring anything intense to your therapist.',
    free: 'I hear you. If it is intense, use the Stop · Ground button. Otherwise we can keep going with the next step.'
  };

  async function aiSay(kind, userText) {
    if (userText) H.push({ role: 'user', content: userText });
    let text = null;
    if (AI.enabled()) {
      const thinking = bubble('guide thinking', '…');
      try {
        text = await AI.complete({ directive: AI.DIRECTIVES[kind], context: context(), history: H });
      } catch (e) {
        note('AI unavailable (' + e.message + '). Using built-in responses.');
      }
      thinking.remove();
    }
    if (!text) text = FALLBACK[kind];
    say(text);
    guard();
    return text;
  }

  function guard() { if (S.endRequested) throw new EndSession(); }

  // ---------------------------------------------------------------- voice dictation
  // Browser speech recognition (Chrome/Edge). Fills the text field as you speak; you still press Send.
  const Voice = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let stopActive = null;

    function stopAll() { if (stopActive) stopActive(); }

    function button(field) {
      if (!SR) return null;
      const btn = el('button', { type: 'button', class: 'mic', title: 'Dictate with your microphone' }, '🎤 Speak');
      let rec = null;
      const stop = () => {
        if (rec) { rec.onend = null; try { rec.stop(); } catch (e) {} rec = null; }
        if (stopActive === stop) stopActive = null;
        btn.classList.remove('listening');
        btn.textContent = '🎤 Speak';
      };
      btn.addEventListener('click', () => {
        if (rec) return stop();
        stopAll();
        TTS.stop(); // don't let the mic hear the guide
        const base = field.value ? field.value.trimEnd() + ' ' : '';
        rec = new SR();
        rec.lang = navigator.language || 'en-US';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = e => {
          let t = '';
          for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
          field.value = base + t.trimStart();
        };
        rec.onerror = e => {
          stop();
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            note('Microphone blocked. Allow it in the browser address bar, and open the app via http://localhost rather than a file.');
          } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
            note('Voice input error: ' + e.error);
          }
        };
        rec.onend = stop; // the browser ends recognition after a pause
        try { rec.start(); } catch (e) { stop(); return; }
        stopActive = stop;
        btn.classList.add('listening');
        btn.textContent = '⏹ Listening…';
        field.focus();
      });
      return btn;
    }

    return { button, stopAll };
  })();

  // ---------------------------------------------------------------- input widgets
  function waitFor(build) {
    return new Promise((resolve, reject) => {
      pendingReject = reject;
      widget.replaceChildren();
      build(resolve);
    }).finally(() => { Voice.stopAll(); widget.replaceChildren(); pendingReject = null; });
  }

  // Returns { text, action }. `actions` are extra buttons that resolve with their id.
  function askText(prompt, { chips = [], placeholder = '', optional = false, actions = [], sendLabel = 'Send', rows = 2 } = {}) {
    if (prompt) say(prompt);
    return waitFor(done => {
      const ta = el('textarea', { rows, placeholder });
      const finish = (action) => {
        const text = ta.value.trim();
        if (!text && !optional && action === 'continue') { ta.focus(); return; }
        userSays(text || (action === 'continue' ? '(nothing new)' : actions.find(a => a.id === action).label));
        done({ text, action });
      };
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish('continue'); }
      });
      const chipRow = chips.length && el('div', { class: 'chips' }, chips.map(c =>
        el('button', { class: 'chip', type: 'button', onclick: () => {
          ta.value = ta.value ? ta.value + ', ' + c : c;
          ta.focus();
        } }, c)));
      const btns = el('div', { class: 'actions' },
        el('button', { class: 'primary', type: 'button', onclick: () => finish('continue') }, sendLabel),
        Voice.button(ta) || '',
        actions.map(a => el('button', { type: 'button', onclick: () => finish(a.id) }, a.label)));
      widget.append(...[chipRow, ta, btns].filter(Boolean));
      ta.focus();
    });
  }

  function askScale(prompt, { min, max, minLabel, maxLabel, label }) {
    if (prompt) say(prompt);
    return waitFor(done => {
      const row = el('div', { class: 'scale' });
      for (let i = min; i <= max; i++) {
        const cls = (i - min) / (max - min) < 0.34 ? 'low' : (i - min) / (max - min) > 0.66 ? 'high' : '';
        row.append(el('button', { class: cls, type: 'button', onclick: () => {
          userSays(`${label}: ${i}`);
          done(i);
        } }, String(i)));
      }
      widget.append(row, el('div', { class: 'scale-labels' }, el('span', {}, minLabel), el('span', {}, maxLabel)));
    });
  }

  const askSUD = (prompt) => askScale(prompt, { min: 0, max: 10, minLabel: '0 = no disturbance / neutral', maxLabel: '10 = worst you can imagine', label: 'Disturbance' });
  const askVOC = (prompt) => askScale(prompt, { min: 1, max: 7, minLabel: '1 = feels completely false', maxLabel: '7 = feels completely true', label: 'Feels true' });

  // options: [{ label, value, primary }]
  function askChoice(prompt, options) {
    if (prompt) say(prompt);
    return waitFor(done => {
      widget.append(el('div', { class: 'choices' }, options.map(o =>
        el('button', { class: o.primary ? 'primary' : '', type: 'button', onclick: () => {
          userSays(o.label);
          done(o.value);
        } }, o.label))));
    });
  }

  // ---------------------------------------------------------------- interrupts
  function requestEnd() {
    S.endRequested = true;
    BLS.stop();
    if (pendingReject) pendingReject(new EndSession());
  }

  async function openGrounding() {
    BLS.stop();
    const result = await Ground.open();
    if (result === 'end' && S && sessionRunning) requestEnd();
    return result;
  }

  // Run a BLS set; handle stop. Returns true if the set completed.
  async function runSet(opts) {
    Voice.stopAll();
    TTS.stop();
    const r = await BLS.run(opts);
    guard();
    return r === 'done';
  }

  // ---------------------------------------------------------------- the session
  const NC_CHIPS = ["I'm not safe", "I'm in danger", "I'm not good enough", "I'm powerless", "It's my fault", "I'm worthless", "I'm not lovable", "I can't trust anyone", "I'm a failure", "I don't deserve it"];
  const PC_CHIPS = ["I'm safe now", "I'm good enough", "I have choices", "I can handle it", "It's not my fault", "I'm worthy of love", "I can trust myself", "I did the best I could"];
  const EMOTION_CHIPS = ['Fear', 'Sadness', 'Anger', 'Shame', 'Guilt', 'Helplessness', 'Disgust', 'Grief', 'Anxiety'];
  const BODY_CHIPS = ['Chest', 'Throat', 'Stomach', 'Shoulders', 'Jaw', 'Head', 'Hands', 'Back'];

  async function startSession() {
    if (sessionRunning) return;
    sessionRunning = true;
    newSession();
    chat.replaceChildren();
    try {
      try {
        await intro();
        if (S.type === 'resource') await resourceSession();
        else await fullSession();
      } catch (e) {
        if (!(e instanceof EndSession)) throw e;
        S.endRequested = false;
        S.incomplete = true;
        note('Session ended early. Moving to closure.');
      }
      await closure();
    } catch (e) {
      if (!(e instanceof EndSession)) {
        console.error(e);
        note('Something went wrong: ' + e.message);
      }
    } finally {
      saveSession();
      sessionRunning = false;
      widget.replaceChildren();
    }
    await restartPrompt();
  }

  async function restartPrompt() {
    const again = await new Promise(resolve => {
      widget.replaceChildren(el('div', { class: 'choices' },
        el('button', { class: 'primary', onclick: () => resolve(true) }, 'Start a new session'),
        el('button', { onclick: () => resolve(false) }, "I'm done for now")));
    });
    widget.replaceChildren();
    if (again) startSession();
    else note('Session saved. Rest well.');
  }

  async function intro() {
    phase('Welcome');
    say("Welcome. This is a self-guided EMDR tool for someone who has already done EMDR with a clinician and has coping skills. It isn't a replacement for a therapist. You can stop at any time with the red Stop · Ground button, or Esc during eye movements.");
    S.type = await askChoice('What would you like to do?', [
      { label: 'Process a memory (full session)', value: 'full', primary: true },
      { label: 'Stabilise only: calm place and resourcing', value: 'resource' }
    ]);
  }

  // --- Phase 1/2: history & preparation, check-in
  async function checkIn() {
    phase('Check-in & preparation');
    const q = [
      'Are you in a private, undisturbed space with about an hour available?',
      'Are you free of alcohol or other substances, and reasonably rested?',
      'Right now, do you feel safe and ready to look at difficult material?'
    ];
    for (const text of q) {
      const ok = await askChoice(text, [{ label: 'Yes', value: true, primary: true }, { label: 'No / not really', value: false }]);
      if (!ok) {
        const choice = await askChoice("That's worth listening to. Reprocessing works best when these are in place.", [
          { label: 'Do stabilisation only today', value: 'resource', primary: true },
          { label: 'Continue anyway', value: 'continue' }
        ]);
        if (choice === 'resource') { S.type = 'resource'; return; }
      }
    }
    S.checkIn = await askSUD('How distressed do you feel right now, before we begin?');
    if (S.checkIn >= 7) {
      const choice = await askChoice("That's quite high to start trauma processing. Stabilising first is usually wiser.", [
        { label: 'Stabilise only today', value: 'resource', primary: true },
        { label: 'Continue to processing anyway', value: 'continue' }
      ]);
      if (choice === 'resource') { S.type = 'resource'; await aiSay('opening', `Distress now: ${S.checkIn}/10`); return; }
    }
    await aiSay('opening', `Distress now: ${S.checkIn}/10`);

    if (!Store.get('safePlace')) {
      const r = await askText('Let\'s set up a calm place you can return to. Bring to mind somewhere (real or imagined) where you feel calm and safe. What do you see, hear and feel there?', { rows: 3 });
      Store.set('safePlace', r.text);
    } else {
      note('Calm place on file: ' + Store.get('safePlace'));
    }
    say('Take a moment now to bring your calm place to mind. Notice what you feel in your body there. Then we\'ll begin.');
    await askChoice(null, [{ label: "I'm ready", value: 1, primary: true }]);
  }

  async function resourceSession() {
    phase('Stabilisation');
    const sp = Store.get('safePlace') ||
      (await askText('Describe a place (real or imagined) where you feel calm and safe. What do you see, hear and feel there?', { rows: 3 })).text;
    Store.set('safePlace', sp);
    S.checkIn = await askSUD('How distressed do you feel right now?');
    say('Bring your calm place to mind: ' + sp + '. Notice what you feel in your body. We\'ll use a few slow, short sets to strengthen it.');
    for (let i = 0; i < 3; i++) {
      await askChoice(null, [{ label: i ? 'Another slow set' : 'Start slow set', value: 1, primary: true }]);
      await runSet({ passes: 8, settings: { speed: 2.8 }, hint: 'Hold your calm place in mind. Notice what is pleasant.' });
      const r = await askText('What do you notice?', { optional: true, chips: ['Calmer', 'Warm', 'Heavier', 'Nothing', 'Distracted'] });
      await aiSay('reflect', r.text);
    }
    S.sudEnd = await askSUD('How distressed do you feel now?');
  }

  async function fullSession() {
    await checkIn();
    if (S.type === 'resource') { await resourceSession(); return; }

    const target = await chooseTarget();
    S.target = target;
    const outcome = await desensitization(target);
    if (outcome === 'incomplete') { S.incomplete = true; return; }
    await installation(target);
    await bodyScan(target);
  }

  // --- Phase 8 (reevaluation) of old targets + Phase 3 assessment
  async function chooseTarget() {
    const open = Store.get('targets').filter(t => t.status !== 'resolved');
    if (open.length) {
      phase('Reevaluation');
      const opts = open.slice(-5).reverse().map(t => ({ label: `Revisit: ${t.title}`, value: t.id }));
      opts.push({ label: 'Work on something new', value: 'new', primary: true });
      const pick = await askChoice('You have unresolved targets. Do you want to revisit one, or start something new?', opts);
      if (pick !== 'new') {
        const t = open.find(x => x.id === pick);
        const kind = await askChoice(`Last time: image "${t.image}", belief "${t.nc}", wanted belief "${t.pc}".`, [
          { label: 'Still right: just re-rate it', value: 'keep', primary: true },
          { label: 'Redo the assessment', value: 'redo' }
        ]);
        if (kind === 'keep') return rate(t);
        return assessment(t);
      }
    }
    return assessment(null);
  }

  async function rate(t) {
    phase('Assessment');
    say(`Bring up the picture (${t.image}) and the words "${t.nc}".`);
    t.sud0 = S.sudStart = S.sudNow = await askSUD('0-10, how disturbing does it feel now?');
    t.voc0 = S.vocStart = S.vocNow = await askVOC(`When you think of the incident, how true do the words "${t.pc}" feel right now?`);
    t.history = t.history || [];
    t.history.push({ date: Date.now(), sud: S.sudStart, voc: S.vocStart, kind: 'reevaluation' });
    Store.saveTarget(t);
    return t;
  }

  async function assessment(existing) {
    phase('Assessment');
    const t = existing || { id: Store.uid(), created: Date.now(), status: 'open', history: [] };
    say("We'll gather the parts of the target. Take your time with each. There are no wrong answers.");
    t.title = (await askText('What memory or issue do you want to work on today? A few words is enough. You don\'t need to go into detail.', { optional: false })).text;
    t.image = (await askText('What picture represents the worst part of it? If there is no picture, what do you notice when you think about it?')).text;
    await aiSay('reflect', null);
    t.nc = (await askText('When you bring up that picture, what words best go with it that express your negative belief about yourself now?', { chips: NC_CHIPS })).text;
    t.pc = (await askText('When you bring up that picture, what would you like to believe about yourself now?', { chips: PC_CHIPS })).text;
    S.vocStart = S.vocNow = await askVOC(`When you think of the incident, how true do the words "${t.pc}" feel to you now? (Gut feeling, not what you know in your head.)`);
    t.emotions = (await askText(`When you bring up the picture and the words "${t.nc}", what emotions do you feel now?`, { chips: EMOTION_CHIPS })).text;
    S.sudStart = S.sudNow = await askSUD('On a scale of 0 to 10, how disturbing does it feel to you now?');
    t.body = (await askText('Where do you feel it in your body?', { chips: BODY_CHIPS })).text;
    t.sud0 = S.sudStart; t.voc0 = S.vocStart;
    t.history.push({ date: Date.now(), sud: S.sudStart, voc: S.vocStart, kind: 'assessment' });
    Store.saveTarget(t);

    if (S.sudStart <= 1) {
      note('This target already feels fairly neutral. You may want to install the positive belief, or pick a different target.');
    }
    return t;
  }

  // --- Phase 4: desensitization
  async function desensitization(t) {
    phase('Desensitization');
    say(`Bring up the picture, the words "${t.nc}", and notice where you feel it in your body (${t.body}). Then follow the circle with your eyes. Let whatever happens happen. You can stop at any time.`);
    await askChoice(null, [{ label: "I'm ready for the first set", value: 1, primary: true }]);

    let lastCheck = S.sudStart;
    let stagnant = 0;
    for (;;) {
      guard();
      const completed = await runSet({ hint: 'Notice whatever comes up. Just let it happen.' });
      S.sets++;
      say('Blank it out. Take a deep breath.');
      if (!completed) {
        const c = await askChoice('You stopped the set. What would you like to do?', [
          { label: 'Resume', value: 'resume', primary: true },
          { label: 'Ground myself first', value: 'ground' },
          { label: 'Close for today', value: 'close' }
        ]);
        if (c === 'ground') { await openGrounding(); guard(); continue; }
        if (c === 'close') return 'incomplete';
        continue;
      }

      const r = await askText('What do you notice now?', {
        optional: true,
        chips: ['Same', 'Different', 'Nothing', 'New memory', 'Body sensation', 'Emotion shifted'],
        actions: [
          { id: 'sud', label: 'Check back at the target' },
          { id: 'stuck', label: "I'm stuck / looping" },
          { id: 'ground', label: 'Too much: ground me' },
          { id: 'close', label: 'Close for today' }
        ],
        sendLabel: 'Go with that'
      });
      if (r.action === 'close') return 'incomplete';
      if (r.action === 'ground') { await openGrounding(); guard(); continue; }
      if (r.action === 'stuck') {
        await aiSay('interweave', r.text || "I feel stuck / it's looping.");
        continue;
      }
      if (r.action === 'continue') await aiSay('desens', r.text || 'Nothing new came up.');

      const nothing = /^(nothing|nothing new|same|no change|calm|neutral|ok|okay|fine|blank)?$/i.test(r.text.trim());
      if (r.action === 'sud' || (nothing && S.sets >= 2) || S.sets % 5 === 0) {
        say('Go back to the original picture and the words. Notice what you get.');
        S.sudNow = await askSUD('How disturbing does the original memory feel now?');
        t.history.push({ date: Date.now(), sud: S.sudNow, kind: 'desensitization' });
        Store.saveTarget(t);
        if (S.sudNow === 0) {
          note('Fully neutral. Moving on to strengthen the positive belief.');
          return 'complete';
        }
        if (S.sudNow >= lastCheck) stagnant++; else stagnant = 0;
        lastCheck = S.sudNow;
        if (stagnant >= 2) {
          const c = await askChoice('The number has not come down for a couple of rounds. That happens. What would help?', [
            { label: 'Try a gentle reframe to hold in mind', value: 'interweave', primary: true },
            { label: 'Keep going', value: 'go' },
            { label: 'Close for today', value: 'close' }
          ]);
          if (c === 'close') return 'incomplete';
          if (c === 'interweave') await aiSay('interweave', 'The distress number has stopped decreasing.');
          stagnant = 0;
        } else if (S.sudNow <= 1 && S.sets >= 3) {
          const c = await askChoice(`It's at ${S.sudNow}. Is it ecologically okay to stay at that level, or is there more?`, [
            { label: "It's okay: move on", value: 'move', primary: true },
            { label: 'There is still more', value: 'go' }
          ]);
          if (c === 'move') return 'complete';
        }
      }

      if (minutes() >= 75) {
        const c = await askChoice(`You've been at this about ${minutes()} minutes. Long sessions are tiring and processing continues afterward anyway.`, [
          { label: 'Close for today', value: 'close', primary: true },
          { label: 'Another set', value: 'go' }
        ]);
        if (c === 'close') return 'incomplete';
      }
    }
  }

  // --- Phase 5: installation
  async function installation(t) {
    phase('Installation');
    say(`Hold the original memory together with the words "${t.pc}". Follow the circle.`);
    await askChoice(null, [{ label: 'Start set', value: 1, primary: true }]);
    let best = S.vocNow ?? 1, plateau = 0;
    for (let i = 0; i < 6; i++) {
      await runSet({ hint: `Hold the memory together with: ${t.pc}` });
      S.sets++;
      say('Blank it out. Take a breath.');
      await askText('What do you notice?', { optional: true, chips: ['Feels more true', 'Same', 'Doubt', 'Something came up'] });
      S.vocNow = await askVOC(`Thinking of the original incident, how true do the words "${t.pc}" feel now?`);
      t.history.push({ date: Date.now(), voc: S.vocNow, kind: 'installation' });
      Store.saveTarget(t);
      if (S.vocNow >= 7) { note('Fully true: that\'s a strong installation.'); break; }
      if (S.vocNow > best) { best = S.vocNow; plateau = 0; } else plateau++;
      if (plateau >= 2) {
        say('It seems to have settled where it is for now. That\'s okay: sometimes it needs a night\'s sleep or a different belief.');
        break;
      }
      say('Hold the memory and the words together again and follow the circle.');
    }
  }

  // --- Phase 6: body scan
  async function bodyScan(t) {
    phase('Body scan');
    say(`Close your eyes. Hold the original memory and the words "${t.pc}". Slowly scan from the top of your head down to your toes. Notice any tension, tightness or unusual sensation.`);
    for (let i = 0; i < 4; i++) {
      const r = await askText('Anything you notice? Type "none" if your body feels clear.', { chips: ['None', 'Tight chest', 'Tension in shoulders', 'Stomach', 'Jaw/head'] });
      if (/^(none|nothing|clear|no|all clear)\b/i.test(r.text.trim())) { note('Body clear.'); return; }
      await runSet({ passes: 15, hint: 'Focus on that sensation and follow the circle.' });
      S.sets++;
      say('Blank it out. Take a breath.');
      if (i < 3) say('Scan again, head to toe.');
    }
    note('Some body sensation remains: that can settle between sessions.');
    S.incomplete = true;
  }

  // --- Phase 7: closure
  async function closure() {
    phase('Closure');
    S.phase = 'closure';
    if (S.target && (S.incomplete || S.sudNow > 0)) {
      say('Let\'s close down safely. This container exercise helps hold unfinished material until next time: imagine a container that can hold anything: a vault, a chest, a strongbox. Place the memory and everything that came up inside, close and lock it, and decide where it stays. You can open it again when you choose.');
      await askChoice(null, [{ label: 'Done', value: 1, primary: true }]);
    }
    const sp = Store.get('safePlace');
    if (sp) {
      say(`Now bring your calm place to mind: ${sp}. Spend a minute there, letting your body settle. Breathe slowly.`);
      await askChoice(null, [{ label: 'Calmer', value: 1, primary: true }, { label: 'Still unsettled', value: 0 }])
        .then(async v => { if (!v) { await openGrounding(); } });
    }
    if (S.target) {
      S.sudEnd = await askSUD(`Bring up the original memory (${S.target.title}). How disturbing is it now?`);
      S.vocEnd = await askVOC(`How true do the words "${S.target.pc}" feel now?`);
      const t = S.target;
      t.history.push({ date: Date.now(), sud: S.sudEnd, voc: S.vocEnd, kind: 'closure' });
      if (S.sudEnd === 0 && S.vocEnd >= 6) t.status = 'resolved';
      Store.saveTarget(t);
      if (t.status === 'resolved') note('Target marked resolved. You can reopen it in Targets & history.');
    } else if (S.sudEnd == null) {
      S.sudEnd = await askSUD('How distressed do you feel now?');
    }
    await aiSay('closure', `Session ended. Starting distress ${S.sudStart ?? S.checkIn}, ending ${S.sudEnd}. ${S.incomplete ? 'Work was incomplete.' : ''}`);
    const n = await askText('Anything you want to remember or tell yourself next time? (Optional journal note)', { optional: true, rows: 3, sendLabel: 'Save & finish' });
    S.notes = n.text;
    if (S.sudEnd >= 7) say('You\'re still quite activated. Please stay with grounding, reach out to your therapist or someone you trust, and call or text 988 if you feel unsafe.');
  }

  function saveSession() {
    if (!S) return;
    Store.addSession({
      id: S.id, date: S.start, type: S.type, minutes: minutes(), sets: S.sets,
      targetId: S.target?.id, targetTitle: S.target?.title,
      sudStart: S.sudStart ?? S.checkIn, sudEnd: S.sudEnd, vocStart: S.vocStart, vocEnd: S.vocEnd,
      incomplete: S.incomplete, notes: S.notes, transcript: H
    });
  }

  // ---------------------------------------------------------------- free chat
  const chatMic = Voice.button($('#chat-input'));
  if (chatMic) $('#chat-form').insertBefore(chatMic, $('#chat-form button[type=submit]'));

  $('#chat-form').addEventListener('submit', async e => {
    e.preventDefault();
    Voice.stopAll();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (!S) newSession();
    userSays(text);
    if (!AI.enabled()) {
      say(FALLBACK.free + ' (Add an API key in Settings for real conversation.)');
      return;
    }
    // Use a throwaway guard: free chat shouldn't throw into the session flow
    try { await aiSay('free', null); } catch (err) { if (!(err instanceof EndSession)) throw err; }
  });

  // ---------------------------------------------------------------- header / tabs
  $('#btn-ground').addEventListener('click', () => {
    if (!S) newSession();
    openGrounding();
  });
  $('#crisis-ground').addEventListener('click', () => { $('#crisis').hidden = true; openGrounding(); });
  $('#crisis-close').addEventListener('click', () => { $('#crisis').hidden = true; });
  Ground.init();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !BLS.isRunning() && !Ground.isOpen()) {
      if (!S) newSession();
      openGrounding();
    }
  });

  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
    for (const id of ['session', 'targets', 'settings']) $('#tab-' + id).hidden = id !== b.dataset.tab;
    if (b.dataset.tab === 'targets') renderTargets();
    if (b.dataset.tab === 'settings') renderSettings();
  }));

  // ---------------------------------------------------------------- targets & history view
  const fmtDate = ms => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  function renderTargets() {
    const root = $('#tab-targets');
    root.replaceChildren();
    const targets = Store.get('targets').slice().reverse();
    root.append(el('h2', {}, 'Targets'));
    if (!targets.length) root.append(el('p', { class: 'muted' }, 'No targets yet. They\'re saved when you do an assessment.'));
    for (const t of targets) {
      const trend = (t.history || []).filter(h => h.sud != null).map(h => h.sud).join(' → ');
      const vtrend = (t.history || []).filter(h => h.voc != null).map(h => h.voc).join(' → ');
      root.append(el('div', { class: 'card' },
        el('h3', {}, t.title, el('span', { class: 'tag ' + t.status }, t.status)),
        el('div', { class: 'muted small' }, `Image: ${t.image} · Negative: "${t.nc}" · Positive: "${t.pc}"`),
        el('div', { class: 'small' }, `Emotions: ${t.emotions} · Body: ${t.body}`),
        el('div', { class: 'small' }, `SUD: ${trend || '–'}   VOC: ${vtrend || '–'}`),
        el('div', { class: 'row' },
          el('button', { onclick: () => { t.status = t.status === 'resolved' ? 'open' : 'resolved'; Store.saveTarget(t); renderTargets(); } },
            t.status === 'resolved' ? 'Reopen' : 'Mark resolved'),
          el('button', { onclick: () => { if (confirm('Delete this target?')) { Store.deleteTarget(t.id); renderTargets(); } } }, 'Delete'))));
    }
    root.append(el('h2', {}, 'Sessions'));
    const sessions = Store.get('sessions').slice().reverse();
    if (!sessions.length) root.append(el('p', { class: 'muted' }, 'No sessions yet.'));
    for (const s of sessions) {
      root.append(el('div', { class: 'card' },
        el('h3', {}, `${fmtDate(s.date)} · ${s.type === 'resource' ? 'Stabilisation' : (s.targetTitle || 'Session')}`,
          s.incomplete ? el('span', { class: 'tag' }, 'incomplete') : ''),
        el('div', { class: 'small' }, `${s.minutes} min · ${s.sets} sets · distress ${s.sudStart ?? '–'} → ${s.sudEnd ?? '–'}${s.vocEnd ? ` · belief ${s.vocStart ?? '–'} → ${s.vocEnd}` : ''}`),
        s.notes ? el('div', { class: 'small' }, 'Note: ' + s.notes) : '',
        el('details', {}, el('summary', {}, 'Transcript'),
          (s.transcript || []).map(m => el('div', { class: 'small' }, (m.role === 'user' ? 'You: ' : 'Guide: ') + m.content)))));
    }
  }

  // ---------------------------------------------------------------- settings view
  const BLS_FIELDS = [
    ['diameter', 'Circle size', 20, 250, 5, v => v + 'px'],
    ['speed', 'Seconds per full pass', 0.5, 5, 0.1, v => v.toFixed(1) + 's'],
    ['passes', 'Passes per set', 10, 60, 2, v => v],
    ['widthPct', 'Travel width', 20, 100, 5, v => v + '%'],
    ['opacity', 'Opacity', 0.1, 1, 0.1, v => Math.round(v * 100) + '%'],
    ['volume', 'Tone volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'],
    ['frequency', 'Tone frequency', 100, 800, 10, v => v + 'Hz'],
    ['centerFade', 'Quieter at center', 0, 1, 0.1, v => v === 0 ? 'Off' : Math.round(v * 100) + '%']
  ];

  function renderSettings() {
    const root = $('#tab-settings');
    root.replaceChildren();
    const bls = Store.get('bls');
    const ai = Store.get('ai');
    const saveBls = () => Store.set('bls', bls);

    // AI
    const keyInput = el('input', { type: 'password', value: ai.key, placeholder: 'sk-ant-…', autocomplete: 'off' });
    const modelInput = el('input', { type: 'text', value: ai.model });
    const saveAi = () => Store.set('ai', { key: keyInput.value.trim(), model: modelInput.value.trim() || Store.defaults.ai.model });
    keyInput.addEventListener('change', saveAi);
    modelInput.addEventListener('change', saveAi);
    root.append(el('div', { class: 'card' },
      el('h3', {}, 'AI guide'),
      el('p', { class: 'muted small' }, 'Optional. Without a key the app runs the full protocol with built-in responses. With a key, it calls the Anthropic API directly from this browser to give therapist-style follow-up. Your key is stored only in this browser\'s localStorage. What you write in sessions is sent to Anthropic when AI is on.'),
      el('div', { class: 'field' }, el('label', {}, 'Anthropic API key'), keyInput),
      el('div', { class: 'field' }, el('label', {}, 'Model'), modelInput)));

    // Read aloud
    if (TTS.available) {
      const tts = Store.get('tts');
      const saveTts = () => Store.set('tts', tts);
      const onBox = el('input', { type: 'checkbox' });
      onBox.checked = tts.on;
      onBox.addEventListener('change', () => { tts.on = onBox.checked; saveTts(); if (!tts.on) TTS.stop(); });
      const voiceSel = el('select', {});
      const voiceStatus = el('p', { class: 'muted small' });
      const allLangs = el('input', { type: 'checkbox' });
      allLangs.addEventListener('change', () => fillVoices());
      let tries = 0;
      const fillVoices = () => {
        // Default to the browser's language (any region: en-US, en-GB, ...) unless "all languages" is ticked
        const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
        const all = speechSynthesis.getVoices();
        const voices = (allLangs.checked ? all : all.filter(v => v.lang.toLowerCase().replace('_', '-').split('-')[0] === lang)).slice();
        const natural = v => /natural|online/i.test(v.name);
        // Natural/online voices first, then the rest by name
        voices.sort((a, b) => natural(b) - natural(a) || a.name.localeCompare(b.name));
        voiceSel.replaceChildren(el('option', { value: '' }, 'Default voice'),
          ...voices.map(v => el('option', { value: v.name }, `${natural(v) ? '★ ' : ''}${v.name} (${v.lang})`)));
        // keep a saved voice selectable even if the language filter hides it
        if (tts.voice && !voices.some(v => v.name === tts.voice) && all.some(v => v.name === tts.voice)) {
          voiceSel.append(el('option', { value: tts.voice }, tts.voice));
        }
        voiceSel.value = tts.voice;
        const nat = voices.filter(natural).length;
        voiceStatus.textContent = voices.length
          ? `${voices.length} voices shown (${lang}${allLangs.checked ? ' + all other languages' : ''}), ${nat} natural/online (★).`
          : 'Loading voices…';
        // Edge/Chrome load voices lazily; keep asking for a few seconds
        if (!all.length && tries++ < 20) setTimeout(() => { if (voiceSel.isConnected) fillVoices(); }, 500);
      };
      fillVoices();
      speechSynthesis.onvoiceschanged = fillVoices; // Chrome/Edge load voices asynchronously
      voiceSel.addEventListener('change', () => { tts.voice = voiceSel.value; saveTts(); });
      const rateVal = el('span', { class: 'val' }, tts.rate.toFixed(1) + '×');
      const rateIn = el('input', { type: 'range', min: 0.6, max: 1.4, step: 0.1, value: tts.rate });
      rateIn.addEventListener('input', () => { tts.rate = parseFloat(rateIn.value); rateVal.textContent = tts.rate.toFixed(1) + '×'; saveTts(); });
      root.append(el('div', { class: 'card' },
        el('h3', {}, 'Read aloud'),
        el('p', { class: 'muted small' }, 'Speaks the guide\'s messages using your system voices (on Windows, the "Natural" Edge voices sound best). Runs on your device; nothing is sent anywhere. Stops when you answer or start a set.'),
        el('div', { class: 'field' }, el('label', {}, 'Read guide messages aloud'), onBox),
        el('div', { class: 'field' }, el('label', {}, 'Voice'), voiceSel),
        el('div', { class: 'field' }, el('label', {}, 'Show all languages'), allLangs),
        voiceStatus,
        el('div', { class: 'field' }, el('label', {}, 'Speed'), rateIn, rateVal),
        el('div', { class: 'row' }, el('button', { onclick: () => {
          TTS.stop();
          const t = new SpeechSynthesisUtterance('You set the pace. Take a slow breath, and notice that you are safe right now.');
          const v = speechSynthesis.getVoices().find(x => x.name === tts.voice);
          if (v) t.voice = v;
          t.rate = tts.rate;
          speechSynthesis.speak(t);
        } }, 'Test voice'))));
    }

    // BLS
    const card = el('div', { class: 'card' }, el('h3', {}, 'Eye movement circle'));
    for (const [key, label, min, max, step, fmt] of BLS_FIELDS) {
      const val = el('span', { class: 'val' }, fmt(bls[key]));
      const input = el('input', { type: 'range', min, max, step, value: bls[key] });
      input.addEventListener('input', () => { bls[key] = parseFloat(input.value); val.textContent = fmt(bls[key]); saveBls(); });
      card.append(el('div', { class: 'field' }, el('label', {}, label), input, val));
    }
    const sel = (key, label, opts) => {
      const s = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: bls[key] === v ? '' : false }, l)));
      s.addEventListener('change', () => { bls[key] = s.value; saveBls(); });
      return el('div', { class: 'field' }, el('label', {}, label), s);
    };
    card.append(
      sel('motion', 'Motion', [['smooth', 'Smooth (slows at ends)'], ['linear', 'Constant speed']]),
      sel('pattern', 'Pattern', [['horizontal', 'Side to side'], ['figure8', 'Figure 8']]),
      sel('sound', 'Stereo tone', [['false', 'Off'], ['true', 'On (use headphones)']]));
    const soundSel = card.querySelectorAll('select')[2];
    soundSel.value = String(!!bls.sound);
    soundSel.addEventListener('change', () => { bls.sound = soundSel.value === 'true'; saveBls(); });
    const colorIn = el('input', { type: 'color', value: bls.color });
    colorIn.addEventListener('input', () => { bls.color = colorIn.value; saveBls(); });
    const bgIn = el('input', { type: 'color', value: bls.bg });
    bgIn.addEventListener('input', () => { bls.bg = bgIn.value; saveBls(); });
    card.append(
      el('div', { class: 'field' }, el('label', {}, 'Circle colour'), colorIn),
      el('div', { class: 'field' }, el('label', {}, 'Background colour'), bgIn),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => BLS.run({ passes: 8, hint: 'Preview', countdown: 1 }) }, 'Preview')));
    root.append(card);

    // Calm place + data
    const sp = el('input', { type: 'text', value: Store.get('safePlace') });
    sp.addEventListener('change', () => Store.set('safePlace', sp.value.trim()));
    const fileIn = el('input', { type: 'file', accept: 'application/json', hidden: '' });
    fileIn.addEventListener('change', async () => {
      try { Store.importAll(JSON.parse(await fileIn.files[0].text())); renderSettings(); }
      catch (e) { alert('Could not import: ' + e.message); }
    });
    root.append(el('div', { class: 'card' },
      el('h3', {}, 'Calm place & data'),
      el('div', { class: 'field' }, el('label', {}, 'Calm place'), sp),
      el('div', { class: 'row' },
        el('button', { onclick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' })), download: 'emdr-backup.json' });
          a.click();
        } }, 'Export backup'),
        el('button', { onclick: () => fileIn.click() }, 'Import backup'),
        fileIn,
        el('button', { class: 'danger', onclick: () => { if (confirm('Delete ALL targets, sessions and settings?')) { Store.wipe(); renderSettings(); } } }, 'Erase everything'))));
  }

  // ---------------------------------------------------------------- boot
  (function boot() {
    if (TTS.available) speechSynthesis.getVoices(); // prime the lazy voice list
    startSession();
  })();
})();
