// ===== Admin Dashboard Logic =====

// ===== Theme =====
function initTheme() {
    const saved = localStorage.getItem('ttt_theme');
    if (saved === 'light') document.body.classList.add('light-theme');
}
initTheme();

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('ttt_theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
}

// ===== Database Integration =====
let dbUsers = [];
let dbStats = { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
let currentUserEmail = null;

// Admin-only endpoint: the server rejects this unless the session belongs to an admin.
async function fetchInitialDB() {
    try {
        const data = await apiCall('admin', 'list_users');
        dbUsers = data.users || [];
        dbStats = data.stats || dbStats;
    } catch (e) {
        console.error('Failed to load from DB', e);
        showToast('❌', e.message);
    }
}

function getUsers() {
    return dbUsers;
}

function getWinStats() {
    return dbStats;
}

// Run an admin action, then reload data from the server so the UI matches the DB.
async function adminAction(action, payload, successIcon, successMsg) {
    try {
        const result = await apiCall('admin', action, payload);
        await fetchInitialDB();
        refreshDashboard();
        refreshUsersTable();
        if (successMsg) showToast(successIcon, successMsg);
        return result;
    } catch (e) {
        showToast('❌', e.message);
        return null;
    }
}

// ===== Admin Auth Gate =====
async function checkAdminAccess() {
    if (!getToken()) {
        window.location.href = 'tictactoe.html';
        return false;
    }
    try {
        const { user } = await apiCall('auth', 'me');
        if (!user.isAdmin) throw new Error('not admin');
        currentUserEmail = user.email;
        document.getElementById('admin-name').textContent = user.username || user.email;
        document.getElementById('admin-avatar').textContent = (user.username || user.email || 'A')[0].toUpperCase();
        return true;
    } catch (e) {
        if (e.status === 401) setToken(null);
        window.location.href = 'tictactoe.html';
        return false;
    }
}

// ===== Section Navigation =====
function switchSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-section]').forEach(n => n.classList.remove('active'));

    // Show target
    const section = document.getElementById(`section-${sectionId}`);
    if (section) section.classList.add('active');

    const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (navItem) navItem.classList.add('active');

    // Refresh data when switching to a section
    if (sectionId === 'dashboard') refreshDashboard();
    if (sectionId === 'users') refreshUsersTable();

    // Close mobile sidebar
    closeSidebar();
}

// ===== Sidebar Mobile =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
}

// ===== Dashboard Stats =====
const DIFFICULTY_META = [
    { id: 'very_easy', label: 'Very Easy', emoji: '🌱', color: '#6abf69' },
    { id: 'easy', label: 'Easy', emoji: '🍃', color: '#8bc34a' },
    { id: 'normal', label: 'Normal', emoji: '⚔️', color: '#ffb300' },
    { id: 'hard', label: 'Hard', emoji: '🔥', color: '#ff7043' },
    { id: 'very_hard', label: 'Very Hard', emoji: '💀', color: '#e53935' }
];

function refreshDashboard() {
    const users = getUsers();
    const stats = getWinStats();

    // Stat cards
    document.getElementById('stat-total-users').textContent = users.length;

    const totalGames = Object.values(stats).reduce((a, b) => a + b, 0);
    document.getElementById('stat-total-games').textContent = totalGames;

    const adminCount = users.filter(u => u.isAdmin).length;
    document.getElementById('stat-admin-count').textContent = adminCount;

    // Top difficulty
    let topDiff = '—';
    for (let i = DIFFICULTY_META.length - 1; i >= 0; i--) {
        if (stats[DIFFICULTY_META[i].id] > 0) {
            topDiff = DIFFICULTY_META[i].emoji + ' ' + DIFFICULTY_META[i].label;
            break;
        }
    }
    document.getElementById('stat-top-difficulty').textContent = topDiff;
 
    // Global Player Performance Totals
    let totalPlayerWins = 0;
    let totalPlayerLosses = 0;
    let totalPlayerTies = 0;
    
    users.forEach(u => {
        if (u.stats) {
            totalPlayerWins += (u.stats.wins || 0);
            totalPlayerLosses += (u.stats.losses || 0);
            totalPlayerTies += (u.stats.ties || 0);
        }
    });
    
    document.getElementById('stat-global-wins').textContent = totalPlayerWins.toLocaleString();
    document.getElementById('stat-global-losses').textContent = totalPlayerLosses.toLocaleString();
    document.getElementById('stat-global-ties').textContent = totalPlayerTies.toLocaleString();

    // Recent users (last 5)
    const recentBody = document.getElementById('recent-users-body');
    const dashboardEmpty = document.getElementById('dashboard-empty');

    if (users.length === 0) {
        recentBody.innerHTML = '';
        dashboardEmpty.style.display = 'block';
    } else {
        dashboardEmpty.style.display = 'none';
        const recent = users.slice(-5).reverse();
        recentBody.innerHTML = recent.map(u => `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="avatar-sm">${(u.username || u.email || '?')[0].toUpperCase()}</div>
                        <strong>${escapeHtml(u.username || '—')}</strong>
                    </div>
                </td>
                <td class="col-email">
                    ${escapeHtml(u.email)}
                </td>
                <td class="col-role"><span class="badge ${u.isAdmin ? 'badge-admin' : 'badge-user'}">${u.isAdmin ? '🛡️ Admin' : 'User'}</span></td>
            </tr>
        `).join('');
    }

    // Win stats grid
    const winGrid = document.getElementById('win-stats-grid');
    winGrid.innerHTML = DIFFICULTY_META.map(d => `
        <div class="stat-card" style="text-align: center;">
            <div style="font-size: 1.6rem; margin-bottom: 0.5rem;">${d.emoji}</div>
            <div class="stat-card-value" style="color: ${d.color}">${stats[d.id] || 0}</div>
            <div class="stat-card-label">${d.label}</div>
        </div>
    `).join('');
}

// ===== Users Table =====
function refreshUsersTable() {
    const users = getUsers();
    const searchTerm = (document.getElementById('user-search').value || '').toLowerCase();

    const filtered = users.filter(u => {
        const name = (u.username || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(searchTerm) || email.includes(searchTerm);
    });

    document.getElementById('user-count-badge').textContent = users.length;

    const tbody = document.getElementById('users-table-body');
    const emptyState = document.getElementById('users-empty');

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
        tbody.innerHTML = filtered.map(u => {
            const stats = u.stats || { wins: 0, losses: 0, ties: 0 };
            const wins = stats.wins || 0;
            const ties = stats.ties || 0;
            const losses = stats.losses || 0;
            const played = wins + ties + losses;
            return `
            <tr onclick="if(!event.target.closest('button')) openStatsModal('${escapeAttr(u.email)}')">
                <td>
                    <div class="user-cell">
                        <div class="avatar-sm">${(u.username || u.email || '?')[0].toUpperCase()}</div>
                        <strong>${escapeHtml(u.username || '—')}</strong>
                    </div>
                </td>
                <td class="col-email">
                    ${escapeHtml(u.email)}
                </td>
                <td class="col-role"><span class="badge ${u.isAdmin ? 'badge-admin' : 'badge-user'}">${u.isAdmin ? '🛡️ Admin' : 'User'}</span></td>
                <td class="col-played"><strong>${played}</strong></td>
                <td>
                    <span style="color: var(--success); font-weight:600;">${wins}</span> /
                    <span style="color: var(--text-muted); font-weight:600;">${ties}</span> /
                    <span style="color: var(--danger); font-weight:600;">${losses}</span>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action info" title="View Stats" onclick="openStatsModal('${escapeAttr(u.email)}')">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 20V10"></path>
                                <path d="M12 20V4"></path>
                                <path d="M6 20v-6"></path>
                            </svg>
                        </button>
                        <button class="btn-action" title="Edit" onclick="openEditModal('${escapeAttr(u.email)}')">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-action danger" title="Delete" onclick="confirmDeleteUser('${escapeAttr(u.email)}')">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `}).join('');
    }
}

function filterUsers() {
    refreshUsersTable();
}

// ===== Edit User Modal =====
function openEditModal(email) {
    const users = getUsers();
    const user = users.find(u => u.email === email);
    if (!user) return;

    document.getElementById('edit-user-email').value = email;
    document.getElementById('edit-username').value = user.username || '';
    const roleSelect = document.getElementById('edit-role');
    roleSelect.value = user.isAdmin ? 'admin' : 'user';
    roleSelect.disabled = true; // admins are configured server-side (ADMIN_EMAILS)
    roleSelect.title = 'Admin access is set by the ADMIN_EMAILS environment variable';
    document.getElementById('edit-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

// ===== User Stats Modal =====
function openStatsModal(email) {
    const users = getUsers();
    const user = users.find(u => u.email === email);
    if (!user) return;

    const stats = user.stats || { wins: 0, losses: 0, ties: 0 };
    const wins = stats.wins || 0;
    const ties = stats.ties || 0;
    const losses = stats.losses || 0;
    const total = wins + ties + losses;
    const wr = total > 0 ? Math.round((wins / total) * 100) : 0;

    document.getElementById('stats-avatar').textContent = (user.username || user.email || '?')[0].toUpperCase();
    document.getElementById('stats-title').textContent = user.username || 'Anonymous';
    document.getElementById('stats-email').textContent = user.email;
    document.getElementById('stats-wins').textContent = wins;
    document.getElementById('stats-ties').textContent = ties;
    document.getElementById('stats-losses').textContent = losses;
    document.getElementById('stats-winrate').textContent = `${wr}%`;
    document.getElementById('stats-winrate-bar').style.width = `${wr}%`;
    document.getElementById('stats-total-played').textContent = `Total games played: ${total}`;

    document.getElementById('user-stats-modal').classList.add('active');
}

function closeStatsModal() {
    document.getElementById('user-stats-modal').classList.remove('active');
}

async function saveUserEdit() {
    const email = document.getElementById('edit-user-email').value;
    const newUsername = document.getElementById('edit-username').value.trim();

    if (!newUsername || newUsername.length < 3) {
        showToast('❌', 'Username must be at least 3 characters');
        return;
    }

    const ok = await adminAction('update_user', { email, username: newUsername }, '✅', `User "${newUsername}" updated`);
    if (ok) closeModal();
}

// ===== Confirm Modal =====
let confirmCallback = null;

function openConfirmModal(title, message, actionText, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-action-btn').textContent = actionText;
    confirmCallback = callback;
    document.getElementById('confirm-action-btn').onclick = () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    };
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
    confirmCallback = null;
}

// ===== Delete User =====
function confirmDeleteUser(email) {
    // Don't allow self-deletion
    if (email === currentUserEmail) {
        showToast('⚠️', "You can't delete your own account");
        return;
    }

    const users = getUsers();
    const user = users.find(u => u.email === email);
    const displayName = user ? (user.username || user.email) : email;

    openConfirmModal(
        'Delete User',
        `This will permanently delete "${displayName}". This action cannot be undone.`,
        'Delete User',
        () => adminAction('delete_user', { email }, '🗑️', `User "${displayName}" deleted`)
    );
}

// ===== System Actions =====
function confirmResetStats() {
    openConfirmModal(
        'Reset Game Stats',
        'This will clear all win statistics across all difficulty levels and reset every users gameplay stats to 0. User accounts will not be deleted.',
        'Reset Stats',
        () => adminAction('reset_stats', {}, '📊', 'All game statistics have been reset')
    );
}

function confirmDeleteAllUsers() {
    openConfirmModal(
        'Delete All Users',
        'This will permanently delete ALL user accounts. You will be logged out. This action cannot be undone!',
        'Delete Everyone',
        async () => {
            try {
                await apiCall('admin', 'delete_all_users');
            } catch (e) {
                showToast('❌', e.message);
                return;
            }
            setToken(null);
            showToast('⚠️', 'All users deleted. Redirecting...');
            setTimeout(() => {
                window.location.href = 'tictactoe.html';
            }, 1500);
        }
    );
}

function exportData() {
    const data = {
        users: getUsers(),
        winStats: getWinStats(),
        exportedAt: new Date().toISOString(),
        version: 'T.cube-admin-1.0'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcube-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📦', 'Data exported successfully');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.users || !data.winStats) {
                showToast('❌', 'Invalid backup file format');
                return;
            }

            openConfirmModal(
                'Import Data',
                `This will replace all current data with the imported backup (${data.users.length} users). Continue?`,
                'Import',
                async () => {
                    const result = await adminAction('import', { users: data.users, winStats: data.winStats });
                    if (result) showToast('✅', `Imported ${result.imported} users and stats`);
                }
            );
        } catch (err) {
            showToast('❌', 'Failed to parse file');
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // reset file input
}

// ===== Toast =====
let toastTimer = null;

function showToast(icon, message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-icon').textContent = icon;
    document.getElementById('toast-message').textContent = message;

    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ===== Navigation =====
function goBackToGame() {
    window.location.href = 'tictactoe.html';
}

// ===== Utilities =====
function escapeAttr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', async () => {
    if (!(await checkAdminAccess())) return;
    await fetchInitialDB();
    refreshDashboard();
});
