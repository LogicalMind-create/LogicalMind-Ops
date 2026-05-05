/**
 * Extract and save SmartBiz session from browser
 * Run this in browser console while logged into SmartBiz
 */
const extractSession = async () => {
  // Get all cookies
  const cookies = document.cookie.split(';').map(c => {
    const [name, ...value] = c.trim().split('=');
    return { name, value: value.join('='), domain: window.location.hostname };
  });

  // Get localStorage
  const localStorage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    localStorage[key] = localStorage.getItem(key);
  }

  // Get sessionStorage
  const sessionStorage = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    sessionStorage[key] = sessionStorage.getItem(key);
  }

  const sessionData = {
    cookies,
    localStorage,
    sessionStorage,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent
  };

  console.log('Session data extracted:', sessionData);
  console.log('Copy this data and save it to a file, then run the save script');

  // Also try to send to local server if available
  fetch('http://localhost:3000/save-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionData)
  }).catch(() => console.log('Local server not available - save manually'));

  return sessionData;
};

// Auto-run
extractSession();