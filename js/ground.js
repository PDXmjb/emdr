// Grounding overlay: always reachable from the red button in the header.
const Ground = (() => {
  const $ = id => document.getElementById(id);
  let resolver = null;

  function open() {
    if (resolver) return Promise.resolve('resume');
    const sp = Store.get('safePlace');
    $('ground-safe').textContent = sp
      ? `Your calm place: ${sp}`
      : 'Bring to mind a place, real or imagined, where you feel calm and safe.';
    $('ground').hidden = false;
    return new Promise(res => { resolver = res; });
  }

  function close(result) {
    $('ground').hidden = true;
    const r = resolver;
    resolver = null;
    if (r) r(result);
  }

  function init() {
    $('ground-resume').onclick = () => close('resume');
    $('ground-end').onclick = () => close('end');
  }

  const isOpen = () => !!resolver;
  return { open, close, init, isOpen };
})();
