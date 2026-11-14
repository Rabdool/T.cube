// Shared client for /api/db. Loaded by tictactoe.html, settings.html and admin.html.
const TOKEN_KEY = 'ttt_token';

function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem('ttt_currentUser'); // legacy key from the old client-side login
    } catch { /* storage unavailable */ }
}

// POST {type, action, ...payload}; throws an Error with .status on failure.
async function apiCall(type, action, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/db', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, type, action })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

// Public data: leaderboard + global difficulty win counts.
async function apiGetPublic() {
    const res = await fetch('/api/db');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}
