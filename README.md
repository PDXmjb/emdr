# EMDR Companion

A personal, self-guided EMDR web app for someone who has already done EMDR with a clinician and has the coping skills to continue safely. It is **not** a replacement for therapy.

## Run it

No build step. On Windows, double-click `start.bat` (serves on localhost only and opens Edge). Or open `index.html` directly, or serve the folder:

```
python -m http.server 8000
```

## What it does

Follows the standard eight-phase EMDR structure:

1. **Check-in / preparation**: readiness questions, distress rating, calm place. Offers stabilisation-only if you're not ready.
2. **Assessment**: target, worst image, negative belief, positive belief, VOC (1-7), emotions, SUD (0-10), body location.
3. **Desensitization**: sets of bilateral stimulation (a circle to follow, optional panned tone), "what do you notice?", periodic return to target, stuck/looping handling with a cognitive interweave, and a one-click ground.
4. **Installation** of the positive belief (VOC to 7).
5. **Body scan**.
6. **Closure**: container exercise if incomplete, calm place, final SUD/VOC, journal note.
7. **Reevaluation**: unresolved targets are offered at the start of the next session and re-rated.

**Safety:** the red **Stop · Ground** button (or `Esc`) is always available. Crisis phrases trigger a resource panel and end reprocessing. The app steers toward stabilisation if you report high distress at the start, and nudges towards closing after 75 minutes.

## AI guide

Paste an Anthropic API key in Settings and the guide gives brief therapist-style responses between steps (minimal "go with that" during processing, interweaves when stuck, closure advice, and free chat). The key stays in this browser's localStorage; session text is sent to the Anthropic API when enabled. Without a key, the full protocol still runs with built-in responses.

## Data

Everything lives in `localStorage` (targets, sessions with transcripts, settings). Export/import from Settings. API keys are never exported.

## Layout

- `index.html`, `css/app.css`, `js/` is the web app (`app.js` is the session flow, `bls.js` the circle/audio, `ai.js` the guide, `ground.js`, `store.js`)
- `extension/` is the original Firefox extension (circle overlay on any page), kept for reference
