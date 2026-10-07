const button = document.getElementById('share');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Sharing your visit…';
  try {
    const payload = { consent: true, language: navigator.language, screen: `${screen.width}×${screen.height}` };
    if (document.getElementById('gps').checked) {
      if (!navigator.geolocation) throw new Error('Location is unavailable. Uncheck location to share the rest.');
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
      payload.location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp };
    }
    const response = await fetch(`/api/visits/${button.dataset.link}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    status.textContent = 'Visit shared. You can continue using either destination link.';
    button.textContent = 'Visit shared';
  } catch (error) { status.textContent = `${error.message || 'Sharing failed.'} You can continue without sharing.`; button.disabled = false; }
});
