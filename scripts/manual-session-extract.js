/**
 * Manual session extraction for SmartBiz
 * Run this in browser console while logged into SmartBiz
 */

// Copy and paste this into your browser console:
const extractSession = async () => {
  const cookies = document.cookie.split(';').map(c => {
    const [name, ...value] = c.trim().split('=');
    return { name, value: value.join('='), domain: window.location.hostname };
  });

  const localStorage = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    localStorage[key] = window.localStorage.getItem(key);
  }

  const sessionData = {
    cookies,
    localStorage,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };

  console.log('SESSION DATA - Copy this entire JSON:');
  console.log(JSON.stringify(sessionData, null, 2));

  // Try to save to server
  try {
    const response = await fetch('http://localhost:3000/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Session saved successfully!');
      alert('Session saved! You can now run the scraper.');
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    console.error('❌ Auto-save failed. Copy the JSON above manually.');
    alert('Copy the JSON from console and save it manually');
  }

  return sessionData;
};

// Run it
extractSession();