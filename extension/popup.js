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

const diameterInput = document.getElementById('diameter');
const speedInput = document.getElementById('speed');
const maxWidthInput = document.getElementById('maxWidth');
const opacityInput = document.getElementById('opacity');
const colorInput = document.getElementById('color');
const soundEnabledInput = document.getElementById('soundEnabled');
const volumeInput = document.getElementById('volume');
const frequencyInput = document.getElementById('frequency');
const centerFadeInput = document.getElementById('centerFade');
const toggleBtn = document.getElementById('toggle');

const volumeControl = document.getElementById('volume-control');
const frequencyControl = document.getElementById('frequency-control');
const centerFadeControl = document.getElementById('centerFade-control');
const soundLabel = document.getElementById('sound-label');

const diameterValue = document.getElementById('diameter-value');
const speedValue = document.getElementById('speed-value');
const maxWidthValue = document.getElementById('maxWidth-value');
const opacityValue = document.getElementById('opacity-value');
const volumeValue = document.getElementById('volume-value');
const frequencyValue = document.getElementById('frequency-value');
const centerFadeValue = document.getElementById('centerFade-value');
const colorPreview = document.getElementById('color-preview');
const colorSwatches = document.querySelectorAll('.color-swatch');

function updateDisplayValues() {
  diameterValue.textContent = `${diameterInput.value}px`;
  speedValue.textContent = `${parseFloat(speedInput.value).toFixed(1)}s`;

  const mw = parseInt(maxWidthInput.value);
  if (mw >= 1500) {
    maxWidthValue.textContent = 'Full';
  } else {
    maxWidthValue.textContent = `${mw}px`;
  }

  opacityValue.textContent = `${Math.round(parseFloat(opacityInput.value) * 100)}%`;
  volumeValue.textContent = `${Math.round(parseFloat(volumeInput.value) * 100)}%`;
  frequencyValue.textContent = `${frequencyInput.value}Hz`;

  const cf = parseFloat(centerFadeInput.value);
  if (cf === 0) {
    centerFadeValue.textContent = 'Off';
  } else if (cf === 1) {
    centerFadeValue.textContent = 'Full';
  } else {
    centerFadeValue.textContent = `${Math.round(cf * 100)}%`;
  }

  if (soundEnabledInput.checked) {
    soundLabel.textContent = 'On';
    volumeControl.classList.add('visible');
    frequencyControl.classList.add('visible');
    centerFadeControl.classList.add('visible');
  } else {
    soundLabel.textContent = 'Off';
    volumeControl.classList.remove('visible');
    frequencyControl.classList.remove('visible');
    centerFadeControl.classList.remove('visible');
  }

  const currentColor = colorInput.value;
  colorPreview.style.backgroundColor = currentColor;

  colorSwatches.forEach(swatch => {
    if (swatch.dataset.color.toLowerCase() === currentColor.toLowerCase()) {
      swatch.classList.add('selected');
    } else {
      swatch.classList.remove('selected');
    }
  });
}

function getSettings() {
  return {
    diameter: parseInt(diameterInput.value),
    speed: parseFloat(speedInput.value),
    maxWidth: parseInt(maxWidthInput.value),
    opacity: parseFloat(opacityInput.value),
    color: colorInput.value,
    soundEnabled: soundEnabledInput.checked,
    volume: parseFloat(volumeInput.value),
    frequency: parseInt(frequencyInput.value),
    centerFade: parseFloat(centerFadeInput.value)
  };
}

async function loadSettings() {
  const result = await browser.storage.local.get(['settings', 'isActive']);
  const settings = { ...defaults, ...result.settings };

  diameterInput.value = settings.diameter;
  speedInput.value = settings.speed;
  maxWidthInput.value = settings.maxWidth;
  opacityInput.value = settings.opacity;
  colorInput.value = settings.color;
  soundEnabledInput.checked = settings.soundEnabled;
  volumeInput.value = settings.volume;
  frequencyInput.value = settings.frequency;
  centerFadeInput.value = settings.centerFade;
  updateDisplayValues();

  updateToggleButton(result.isActive);
}

async function saveSettings() {
  const settings = getSettings();
  await browser.storage.local.set({ settings });

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    browser.tabs.sendMessage(tabs[0].id, { action: 'updateSettings', settings });
  }
}

function updateToggleButton(isActive) {
  if (isActive) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.add('active');
  } else {
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.remove('active');
  }
}

diameterInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

speedInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

maxWidthInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

opacityInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

colorInput.addEventListener('input', () => {
  if (/^#[0-9A-Fa-f]{6}$/.test(colorInput.value)) {
    updateDisplayValues();
    saveSettings();
  }
});

colorSwatches.forEach(swatch => {
  swatch.addEventListener('click', () => {
    colorInput.value = swatch.dataset.color;
    updateDisplayValues();
    saveSettings();
  });
});

soundEnabledInput.addEventListener('change', () => {
  updateDisplayValues();
  saveSettings();
});

volumeInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

frequencyInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

centerFadeInput.addEventListener('input', () => {
  updateDisplayValues();
  saveSettings();
});

toggleBtn.addEventListener('click', async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    const result = await browser.storage.local.get('isActive');
    const newState = !result.isActive;
    await browser.storage.local.set({ isActive: newState });
    updateToggleButton(newState);

    const settings = getSettings();
    browser.tabs.sendMessage(tabs[0].id, {
      action: 'toggle',
      settings,
      isActive: newState
    });
  }
});

loadSettings();
