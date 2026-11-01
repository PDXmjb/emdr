// The "therapist" voice. Calls the Anthropic Messages API directly from the browser
// using the user's own key (stored only in this browser's localStorage).
// The app itself runs the scripted EMDR protocol; the model supplies the brief human
// responses between steps.
const AI = (() => {
  const SYSTEM = `You are a warm, steady, EMDR-informed guide inside a personal self-help app. The user is one adult who has had a substantial amount of EMDR therapy with a licensed clinician and has learned the coping skills needed to do more of it safely. You are not a licensed therapist and you do not diagnose. The app runs the standard eight-phase EMDR structure (history/preparation, assessment, desensitization, installation, body scan, closure, reevaluation) and the bilateral stimulation; you supply the brief human responses between the scripted steps.

Style:
- Plain, warm, concise: usually 1-3 short sentences. No markdown, no lists, no headings, no emojis.
- Do not interpret what a memory "means". Do not suggest or lead the content of memories. Do not invent details of the person's history.
- Usually do not ask a question; the app asks the next scripted question. Ask at most one, and only if the task says to.
- Use the person's own words where helpful (their image, belief, sensations).
- During reprocessing, stay minimal like a good EMDR therapist: "Good. Go with that." Trust the person's own processing.

Safety (these override everything else):
- If the person mentions suicidal thoughts, self-harm, intent to hurt others, psychosis-like experiences, or losing touch with reality, stop reprocessing: encourage grounding, tell them to contact a crisis line (in the US call or text 988) or their therapist, and do not continue trauma work.
- If you see signs of dissociation (numb, floating, "not here", lost time, blank) or overwhelming abreaction, steer toward grounding and orienting to the present (here, now, safe, an adult in a safe room) rather than another set.
- Never push someone to continue. They control the pace, and they may stop anytime.
- If a question is outside self-guided EMDR (medication, diagnosis, ongoing crisis, new complex trauma), say so kindly and point them to their clinician.`;

  const enabled = () => !!(Store.get('ai').key || '').trim();

  // Collapse history into valid alternating roles beginning with a user turn.
  function normalize(history) {
    const out = [];
    for (const m of history.slice(-40)) {
      const text = (m.content || '').trim();
      if (!text) continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.content += '\n' + text;
      else out.push({ role: m.role, content: text });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    if (!out.length || out[out.length - 1].role !== 'user') {
      out.push({ role: 'user', content: '(Please continue.)' });
    }
    return out;
  }

  async function complete({ directive, context, history, maxTokens = 350 }) {
    const { key, model } = Store.get('ai');
    const system = `${SYSTEM}\n\n# Current session state\n${JSON.stringify(context)}\n\n# Your task right now\n${directive}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: normalize(history) })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) {}
      throw new Error(`API ${res.status} ${detail}`.trim());
    }
    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }

  const DIRECTIVES = {
    opening: 'Greet the person briefly and reflect the check-in they just gave. Normalise how they feel, remind them they set the pace and can stop at any time. 2-3 sentences. No question.',
    reflect: 'Briefly acknowledge what the person just said, in their own words where possible. 1-2 sentences. Do not ask a question.',
    desens: 'The person just finished a set of bilateral stimulation and told you what they noticed. Stay minimal as a good EMDR therapist does: validate and encourage them to go with it. If the report shows rising distress or a strong emotional release, remind them it is old material, they are safe now, and to breathe. If you see signs of dissociation (numb, floating, not here, blank, lost time), recommend grounding instead of another set. 1-2 sentences. Do not interpret and do not ask a question.',
    interweave: 'The person feels stuck or the material is looping. Offer ONE short cognitive interweave: a gentle, least-leading question or reframe from the adult perspective (responsibility, safety, or choices) that they can hold in mind during the next set. Frame it as something to consider, not a fact about their history. Max 3 sentences.',
    closure: 'Close the session. Validate their effort. If the work was incomplete, reassure them that unfinished processing is normal and that the container exercise they just did helps hold it. Mention what to expect between sessions (new thoughts, dreams or feelings may surface, keep a brief log, use the calm place and grounding, drink water, be gentle with yourself). Suggest bringing unfinished or intense material to their therapist. 4-6 sentences. No question.',
    free: 'The person is chatting with you outside the scripted steps. Respond as a supportive EMDR-informed guide in 1-4 sentences. Give brief practical advice if they ask. If they seem to need processing, point them to the next set; if distressed, point to the red Stop / Ground button.'
  };

  return { enabled, complete, DIRECTIVES };
})();
