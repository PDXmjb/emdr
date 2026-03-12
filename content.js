console.log('EMDR: Content script loaded');

let circle = null;
let styleElement = null;
let audioContext = null;
let oscillator = null;
let gainNode = null;
let pannerNode = null;
let panAnimationId = null;
let currentSettings = null;
let audioPending = false;
let audioPrompt = null;

const defaults = {
  diameter: 100,
  speed: 1,
  maxWidth: 1500,
  opacity: 1,
  color: '#4a90d9',
  soundEnabled: false,
  volume: 0.5,
  frequency: 400,
  centerFade: 0
};

function applyStyles(settings) {
  const s = { ...defaults, ...settings };
  const diameter = s.diameter;
  const speed = s.speed;
  const maxWidth = s.maxWidth;
  const opacity = s.opacity;
  const color = s.color;

  // Calculate left/right positions
  // If maxWidth >= viewport, use full width; otherwise center it
  const viewportWidth = window.innerWidth;
  let leftStart, leftEnd;

  if (maxWidth >= viewportWidth / 2) {
    // Full width mode
    leftStart = 0;
    leftEnd = viewportWidth - diameter;
  } else {
    // Centered with limited width
    const center = viewportWidth / 2;
    leftStart = center - maxWidth - diameter / 2;
    leftEnd = center + maxWidth - diameter / 2;
  }

  const css = `
    #emdr-circle {
      position: fixed;
      width: ${diameter}px;
      height: ${diameter}px;
      border-radius: 50%;
      background-color: ${color};
      opacity: ${opacity};
      top: 50%;
      transform: translateY(-50%);
      z-index: 2147483647;
      pointer-events: none;
      animation: emdr-move ${speed}s ease-in-out infinite alternate;
    }

    @keyframes emdr-move {
      0% {
        left: ${leftStart}px;
      }
      100% {
        left: ${leftEnd}px;
      }
    }
  `;

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'emdr-styles';
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = css;
}

function showAudioPrompt() {
  console.log('EMDR: showAudioPrompt called, existing prompt:', !!audioPrompt);
  if (audioPrompt) return;

  audioPrompt = document.createElement('div');
  audioPrompt.id = 'emdr-audio-prompt';
  audioPrompt.innerHTML = 'Click anywhere to enable EMDR audio';
  audioPrompt.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    cursor: pointer;
  `;
  document.body.appendChild(audioPrompt);
  console.log('EMDR: Audio prompt added to page');
}

function hideAudioPrompt() {
  if (audioPrompt) {
    audioPrompt.remove();
    audioPrompt = null;
  }
}

async function initAudioOnGesture() {
  console.log('EMDR: initAudioOnGesture called, audioPending:', audioPending, 'currentSettings:', !!currentSettings);
  if (!audioPending || !currentSettings) {
    console.log('EMDR: Skipping audio init - not pending or no settings');
    return;
  }

  const s = { ...defaults, ...currentSettings };
  console.log('EMDR: Merged settings:', s);
  if (!s.soundEnabled) {
    console.log('EMDR: Sound not enabled in settings');
    return;
  }

  try {
    console.log('EMDR: Creating AudioContext...');
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('EMDR: AudioContext state:', audioContext.state);
    await audioContext.resume();
    console.log('EMDR: AudioContext resumed, state:', audioContext.state);

    oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(s.frequency, audioContext.currentTime);

    gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(s.volume, audioContext.currentTime);

    pannerNode = audioContext.createStereoPanner();
    pannerNode.pan.setValueAtTime(-1, audioContext.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(audioContext.destination);

    oscillator.start();
    console.log('EMDR: Oscillator started');

    startPanAnimation(s.speed);
    audioPending = false;
    hideAudioPrompt();
    document.removeEventListener('click', initAudioOnGesture);
    console.log('EMDR: Audio started successfully');
  } catch (e) {
    console.error('EMDR: Failed to start audio', e);
  }
}

async function startAudio(settings) {
  const s = { ...defaults, ...settings };
  console.log('EMDR: startAudio called, soundEnabled:', s.soundEnabled);

  if (!s.soundEnabled) {
    console.log('EMDR: Sound not enabled, skipping audio');
    return;
  }

  // Mark audio as pending and wait for user gesture
  audioPending = true;
  console.log('EMDR: Setting audioPending=true, showing prompt');
  showAudioPrompt();
  document.addEventListener('click', initAudioOnGesture);
  console.log('EMDR: Click listener added');
}

function startPanAnimation(speed) {
  if (panAnimationId) {
    clearInterval(panAnimationId);
  }

  const cycleDuration = speed * 1000;
  let startTime = performance.now();
  let direction = 1;

  // Use an interval instead of requestAnimationFrame for smoother audio
  // This decouples audio updates from frame rate
  const audioInterval = setInterval(() => {
    if (!audioContext || !pannerNode || !gainNode) {
      clearInterval(audioInterval);
      return;
    }

    const currentTime = performance.now();
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / cycleDuration, 1);

    // Ease-in-out
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
    const pan = direction === 1 ? -1 + 2 * eased : 1 - 2 * eased;

    // Direct value setting - simpler and often less crackling
    pannerNode.pan.value = pan;

    // Center fade
    const s = currentSettings || defaults;
    const centerFade = s.centerFade || 0;
    const distanceFromEdge = 1 - Math.abs(pan);
    const volumeMultiplier = 1 - (centerFade * distanceFromEdge);
    gainNode.gain.value = s.volume * volumeMultiplier;

    if (progress >= 1) {
      startTime = currentTime;
      direction *= -1;
    }
  }, 30); // ~33 updates per second

  // Store interval ID for cleanup
  panAnimationId = audioInterval;
}

function stopPanAnimation() {
  if (panAnimationId) {
    clearInterval(panAnimationId);
    panAnimationId = null;
  }
}


function stopAudio() {
  stopPanAnimation();

  if (oscillator) {
    try {
      oscillator.stop();
    } catch (e) {}
    oscillator = null;
  }

  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {}
    audioContext = null;
  }

  gainNode = null;
  pannerNode = null;
  audioPending = false;
  hideAudioPrompt();
  document.removeEventListener('click', initAudioOnGesture);
}

async function updateAudio(settings) {
  const s = { ...defaults, ...settings };
  console.log('EMDR: updateAudio called, soundEnabled:', s.soundEnabled, 'audioContext:', !!audioContext, 'audioPending:', audioPending, 'circle:', !!circle);

  if (!s.soundEnabled) {
    console.log('EMDR: Sound disabled, stopping audio');
    stopAudio();
    return;
  }

  // If audio not running and not pending, start it
  if (!audioContext && !audioPending && circle) {
    console.log('EMDR: No audio context and not pending, starting audio');
    await startAudio(settings);
    return;
  }

  // Update existing audio parameters
  if (oscillator && s.frequency) {
    console.log('EMDR: Updating frequency to', s.frequency);
    oscillator.frequency.setValueAtTime(s.frequency, audioContext.currentTime);
  }

  if (gainNode && s.volume !== undefined) {
    console.log('EMDR: Updating volume to', s.volume);
    gainNode.gain.setValueAtTime(s.volume, audioContext.currentTime);
  }

  // If speed changed, restart pan animation
  if (currentSettings && currentSettings.speed !== s.speed && panAnimationId) {
    startPanAnimation(s.speed);
  }
}

async function createCircle(settings) {
  console.log('EMDR: createCircle called, settings:', settings);
  if (circle) {
    console.log('EMDR: Circle already exists, returning');
    return;
  }

  currentSettings = { ...defaults, ...settings };
  applyStyles(settings);
  circle = document.createElement('div');
  circle.id = 'emdr-circle';
  document.body.appendChild(circle);
  console.log('EMDR: Circle created and added to page');

  await startAudio(settings);
}

function removeCircle() {
  if (circle) {
    circle.remove();
    circle = null;
  }
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
  }
  stopAudio();
  currentSettings = null;
}

async function updateCircle(settings) {
  if (circle) {
    const oldSpeed = currentSettings ? currentSettings.speed : null;
    currentSettings = { ...defaults, ...settings };

    applyStyles(settings);
    await updateAudio(settings);

    // Force animation restart if speed changed
    if (oldSpeed !== settings.speed) {
      const parent = circle.parentNode;
      parent.removeChild(circle);
      void circle.offsetWidth; // Trigger reflow
      parent.appendChild(circle);

      // Restart pan animation to sync with visual
      if (panAnimationId) {
        startPanAnimation(settings.speed);
      }
    }
  }
}

browser.runtime.onMessage.addListener((message) => {
  console.log('EMDR: Message received:', message);
  if (message.action === 'toggle') {
    if (message.isActive) {
      console.log('EMDR: Toggle ON, creating circle');
      createCircle(message.settings);
    } else {
      console.log('EMDR: Toggle OFF, removing circle');
      removeCircle();
    }
  } else if (message.action === 'updateSettings') {
    console.log('EMDR: Updating settings');
    updateCircle(message.settings);
  }
});

// Handle window resize to recalculate positions
window.addEventListener('resize', async () => {
  if (circle) {
    const result = await browser.storage.local.get('settings');
    applyStyles(result.settings || defaults);
  }
});
