// Background script for EMDR Circle extension
// Currently handles extension installation and cleanup

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({
    isActive: false,
    settings: {
      diameter: 100,
      speed: 1,
      maxWidth: 1500,
      opacity: 1,
      color: '#4a90d9',
      soundEnabled: false,
      volume: 0.5,
      frequency: 400,
      centerFade: 0
    }
  });
});
