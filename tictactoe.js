// ===== Difficulty Definitions =====
const DIFFICULTIES = [
    { id: 'very_easy', label: 'Very Easy', emoji: '🌱', color: '#6abf69' },
    { id: 'easy', label: 'Easy', emoji: '🍃', color: '#8bc34a' },
    { id: 'normal', label: 'Normal', emoji: '⚔️', color: '#ffb300' },
    { id: 'hard', label: 'Hard', emoji: '🔥', color: '#ff7043' },
    { id: 'very_hard', label: 'Very Hard', emoji: '💀', color: '#e53935' }
];

function isUnlocked(diffId, stats) {
    switch (diffId) {
        case 'very_easy': return true;
        case 'easy': return true;
        case 'normal': return stats.easy >= 3;
        case 'hard': return stats.normal >= 3;
        case 'very_hard': return stats.normal >= 5 || stats.hard >= 3;
    }
    return false;
}

function unlockHint(diffId, stats) {
    switch (diffId) {
        case 'normal': return `Win Easy ${stats.easy}/3`;
        case 'hard': return `Win Normal ${stats.normal}/3`;
        case 'very_hard': {
            const a = `Normal ${stats.normal}/5`;
            const b = `Hard ${stats.hard}/3`;
            return `Win ${a} or ${b}`;
        }
    }
    return '';
}

// ===== Persistent Stats =====
function loadStats() {
    try {
        const raw = localStorage.getItem('ttt_wins');
        if (raw) return JSON.parse(raw);
    } catch (e) { }
    return { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
}

function saveStats(stats) {
    localStorage.setItem('ttt_wins', JSON.stringify(stats));
}

// ===== State =====
let mode = '1p';
let difficulty = 'easy';
let board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
let currentTurn = 'X'; // 'X' always moves first
let gameActive = false;
let scores = { p1: 0, p2: 0, draw: 0 };
let winStats = loadStats();

// Sign assignments (can swap between rounds)
let humanSign = 'X';    // 1P: human sign (default X)
let cpuSign = 'O';      // 1P: CPU sign (default O)
let p1Sign = 'X';       // 2P: P1 sign
let p2Sign = 'O';       // 2P: P2 sign
let lastWinner = null;  // sign of last game's winner (null = tie or first game)
let tieLastMover = null; // sign of the player who made the last move in a tie

// Auth State
let currentUser = null;

// ===== Theme Initialization =====
function initTheme() {
    const savedTheme = localStorage.getItem('ttt_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
}
initTheme();

// ===== DOM =====
const cells = document.querySelectorAll('.cell');
const statusText = document.getElementById('status-text');
const authScreen = document.getElementById('auth-screen');
const authLogin = document.getElementById('auth-login');
const authSignup = document.getElementById('auth-signup');
const authForgot = document.getElementById('auth-forgot');
const menuScreen = document.getElementById('menu-screen');
const diffScreen = document.getElementById('difficulty-screen');
const gameScreen = document.getElementById('game-screen');
const resultOverlay = document.getElementById('result-overlay');
const resultIcon = document.getElementById('result-icon');
const resultTitle = document.getElementById('result-title');
const resultSubtitle = document.getElementById('result-subtitle');
const resultUnlock = document.getElementById('result-unlock');
const scoreP1 = document.getElementById('score-p1');
const scoreP2 = document.getElementById('score-p2');
const scoreDraw = document.getElementById('score-draw');
const labelLeft = document.getElementById('label-left');
const labelRight = document.getElementById('label-right');
const diffBadge = document.getElementById('diff-badge');
const diffButtonsContainer = document.getElementById('diff-buttons');

// ===== Difficulty Screen =====
function renderDiffButtons() {
    diffButtonsContainer.innerHTML = '';
    DIFFICULTIES.forEach(d => {
        const unlocked = isUnlocked(d.id, winStats);
        const btn = document.createElement('button');
        btn.className = 'btn diff-btn' + (unlocked ? '' : ' locked');
        btn.onclick = () => { if (unlocked) selectDifficulty(d.id); };

        const wins = winStats[d.id] || 0;
        let detail = unlocked ? `${wins} win${wins !== 1 ? 's' : ''}` : unlockHint(d.id, winStats);

        btn.innerHTML = `
            <span class="diff-emoji">${d.emoji}</span>
            <span class="btn-text">
                <strong>${d.label}</strong>
                <small class="${unlocked ? '' : 'locked-hint'}">${unlocked ? detail : '🔒 ' + detail}</small>
            </span>
        `;
        btn.style.setProperty('--diff-color', d.color);
        diffButtonsContainer.appendChild(btn);
    });
}

function showDifficulty() {
    renderDiffButtons();
    menuScreen.classList.remove('active');
    diffScreen.classList.add('active');
}

function backToMenu() {
    diffScreen.classList.remove('active');
    menuScreen.classList.add('active');
}

function selectDifficulty(diffId) {
    difficulty = diffId;
    diffScreen.classList.remove('active');
    startGame('1p');
}

function goToMenu() {
    gameScreen.classList.remove('active');
    resultOverlay.classList.remove('active');
    menuScreen.classList.add('active');
}

function goBackToSelection() {
    resultOverlay.classList.remove('active');
    gameScreen.classList.remove('active');
    if (mode === '1p') {
        showDifficulty();
    } else {
        menuScreen.classList.add('active');
    }
}

// ===== Navigation =====
function startGame(selectedMode) {
    mode = selectedMode;
    scores = { p1: 0, p2: 0, draw: 0 };
    lastWinner = null;
    tieLastMover = null;

    // Reset signs: 'X' goes first
    humanSign = 'X';
    cpuSign = 'O';
    p1Sign = 'X';
    p2Sign = 'O';

    updateLabels();
    updateScoreboard();

    if (mode === '1p') {
        const d = DIFFICULTIES.find(x => x.id === difficulty);
        diffBadge.textContent = `${d.emoji} ${d.label}`;
        diffBadge.style.background = d.color + '22';
        diffBadge.style.color = d.color;
        diffBadge.style.borderColor = d.color + '44';
        diffBadge.style.display = 'inline-block';
    } else {
        diffBadge.style.display = 'none';
    }

    menuScreen.classList.remove('active');
    diffScreen.classList.remove('active');
    gameScreen.classList.add('active');
    resetBoard();
}

function updateLabels() {
    if (mode === '2p') {
        labelLeft.textContent = `Player 1 (${p1Sign})`;
        labelRight.textContent = `Player 2 (${p2Sign})`;
    } else {
        labelLeft.textContent = `You (${humanSign})`;
        labelRight.textContent = `CPU (${cpuSign})`;
    }
}

function goToMenu() {
    resultOverlay.classList.remove('active');
    gameScreen.classList.remove('active');
    diffScreen.classList.remove('active');
    menuScreen.classList.add('active');
    gameActive = false;
}

function restartGame() {
    resultOverlay.classList.remove('active');

    // Swap signs based on winner: loser starts (gets 'X')
    if (lastWinner !== null) {
        if (mode === '1p') {
            // If human won, human gets 'O' (goes second), CPU gets 'X' (goes first)
            if (lastWinner === humanSign) {
                humanSign = 'O';
                cpuSign = 'X';
            } else {
                humanSign = 'X';
                cpuSign = 'O';
            }
        } else {
            // 2P mode
            if (lastWinner === p1Sign) {
                p1Sign = 'O';
                p2Sign = 'X';
            } else {
                p1Sign = 'X';
                p2Sign = 'O';
            }
        }
    } else if (tieLastMover !== null) {
        // Tie game: the player who made the last move gets 'O' (goes second)
        if (mode === '1p') {
            if (tieLastMover === humanSign) {
                humanSign = 'O';
                cpuSign = 'X';
            } else {
                humanSign = 'X';
                cpuSign = 'O';
            }
        } else {
            if (tieLastMover === p1Sign) {
                p1Sign = 'O';
                p2Sign = 'X';
            } else {
                p1Sign = 'X';
                p2Sign = 'O';
            }
        }
    }

    updateLabels();
    resetBoard();
}

// ===== Board =====
function resetBoard() {
    board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    currentTurn = 'X'; // X always goes first
    gameActive = true;

    cells.forEach(cell => {
        cell.textContent = '';
        cell.classList.remove('o', 'x', 'taken', 'win-cell');
    });

    updateStatus();

    // In 1P: if CPU is 'X', it goes first
    if (mode === '1p' && cpuSign === 'X') {
        computerMove();
    }
}

function updateStatus() {
    if (!gameActive) return;

    if (mode === '2p') {
        const isP1Turn = (currentTurn === p1Sign);
        const playerName = isP1Turn ? 'Player 1' : 'Player 2';
        statusText.textContent = `${playerName}'s turn (${currentTurn})`;
        statusText.style.color = currentTurn === 'O' ? 'var(--o-color)' : 'var(--x-color)';
    } else {
        if (currentTurn === humanSign) {
            statusText.textContent = `Your turn (${humanSign})`;
            statusText.style.color = humanSign === 'O' ? 'var(--o-color)' : 'var(--x-color)';
        } else {
            statusText.textContent = 'Computer thinking...';
            statusText.style.color = cpuSign === 'O' ? 'var(--o-color)' : 'var(--x-color)';
        }
    }
}

// ===== Click Handler =====
function cellClick(index) {
    if (!gameActive) return;
    if (board[index] === 'O' || board[index] === 'X') return;
    if (mode === '1p' && currentTurn !== humanSign) return;

    placeMove(index, currentTurn);

    const winner = checkWin(currentTurn);
    if (winner) { endGame(currentTurn); return; }
    if (getFreeCells().length === 0) { endGame(null); return; }

    currentTurn = currentTurn === 'O' ? 'X' : 'O';
    updateStatus();

    if (mode === '1p' && currentTurn === cpuSign && gameActive) {
        setTimeout(() => { computerMove(); }, 400);
    }
}

function placeMove(index, sign) {
    board[index] = sign;
    const cell = cells[index];
    cell.textContent = sign;
    cell.classList.add(sign.toLowerCase(), 'taken');
}

// =============================================================
// ===== COMPUTER AI — 5 difficulty levels ====================
// =============================================================
function computerMove() {
    const free = getFreeCells();
    if (free.length === 0 || !gameActive) return;

    let pick;
    const mySign = cpuSign;
    const oppSign = humanSign;

    switch (difficulty) {
        case 'very_easy': pick = aiVeryEasy(free); break;
        case 'easy': pick = aiEasy(free, mySign); break;
        case 'normal': pick = aiNormal(free, mySign, oppSign); break;
        case 'hard': pick = aiHard(free, mySign, oppSign); break;
        case 'very_hard': pick = aiVeryHard(free, mySign, oppSign); break;
        default: pick = aiEasy(free, mySign);
    }

    placeMove(pick, cpuSign);

    const winner = checkWin(cpuSign);
    if (winner) { endGame(cpuSign); return; }
    if (getFreeCells().length === 0) { endGame(null); return; }

    currentTurn = humanSign;
    updateStatus();
}

function aiVeryEasy(free) {
    return free[Math.floor(Math.random() * free.length)];
}

function aiEasy(free, mySign) {
    if (Math.random() < 0.4) {
        const win = findWinningMove(mySign, free);
        if (win !== null) return win;
    }
    return free[Math.floor(Math.random() * free.length)];
}

function aiNormal(free, mySign, oppSign) {
    const win = findWinningMove(mySign, free);
    if (win !== null) return win;
    const block = findWinningMove(oppSign, free);
    if (block !== null) return block;
    if (Math.random() < 0.5) return smartPick(free);
    return free[Math.floor(Math.random() * free.length)];
}

function aiHard(free, mySign, oppSign) {
    if (Math.random() < 0.3) {
        const block = findWinningMove(oppSign, free);
        if (block !== null) return block;
        return free[Math.floor(Math.random() * free.length)];
    }
    return minimaxBest(mySign, oppSign);
}

function aiVeryHard(free, mySign, oppSign) {
    return minimaxBest(mySign, oppSign);
}

function findWinningMove(sign, free) {
    for (const idx of free) {
        board[idx] = sign;
        if (checkWin(sign)) { board[idx] = idx; return idx; }
        board[idx] = idx;
    }
    return null;
}

function smartPick(free) {
    const priority = [4, 0, 2, 6, 8, 1, 3, 5, 7];
    for (const p of priority) {
        if (free.includes(p)) return p;
    }
    return free[0];
}

function minimaxBest(maxSign, minSign) {
    let bestScore = -Infinity;
    let bestMove = null;

    for (let i = 0; i < 9; i++) {
        if (board[i] !== 'O' && board[i] !== 'X') {
            board[i] = maxSign;
            const score = minimax(board, 0, false, maxSign, minSign);
            board[i] = i;
            if (score > bestScore) {
                bestScore = score;
                bestMove = i;
            }
        }
    }
    return bestMove;
}

function minimax(b, depth, isMaximizing, maxSign, minSign) {
    if (checkWin(maxSign)) return 10 - depth;
    if (checkWin(minSign)) return depth - 10;
    const free = getFreeCells();
    if (free.length === 0) return 0;

    if (isMaximizing) {
        let best = -Infinity;
        for (const idx of free) {
            b[idx] = maxSign;
            best = Math.max(best, minimax(b, depth + 1, false, maxSign, minSign));
            b[idx] = idx;
        }
        return best;
    } else {
        let best = Infinity;
        for (const idx of free) {
            b[idx] = minSign;
            best = Math.min(best, minimax(b, depth + 1, true, maxSign, minSign));
            b[idx] = idx;
        }
        return best;
    }
}

function getFreeCells() {
    return board.filter(c => c !== 'O' && c !== 'X');
}

const WIN_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

function checkWin(sign) {
    for (const combo of WIN_COMBOS) {
        if (combo.every(i => board[i] === sign)) return combo;
    }
    return null;
}

function updateUserStats(result) {
    if (!currentUser) return;
    let users = getAuthUsers();
    let idx = users.findIndex(u => u.email === currentUser);
    if (idx !== -1) {
        if (!users[idx].stats) {
            users[idx].stats = { wins: 0, losses: 0, ties: 0 };
        }
        if (result === 'win') users[idx].stats.wins++;
        else if (result === 'loss') users[idx].stats.losses++;
        else if (result === 'tie') users[idx].stats.ties++;
        saveAuthUsers(users);
    }
}

// ===== End Game =====
function endGame(winnerSign) {
    gameActive = false;
    lastWinner = winnerSign; // track who won (null = tie)

    // The player who made the last move is simply the currentTurn, 
    // because currentTurn hasn't been swapped yet (swap happens *after* endGame check if no win/tie)
    tieLastMover = (winnerSign === null) ? currentTurn : null;

    if (winnerSign) {
        const combo = checkWin(winnerSign);
        if (combo) combo.forEach(i => cells[i].classList.add('win-cell'));
    }

    setTimeout(() => {
        resultUnlock.textContent = '';
        resultUnlock.style.display = 'none';

        if (winnerSign) {
            if (mode === '2p') {
                const isP1 = (winnerSign === p1Sign);
                if (isP1) {
                    scores.p1++;
                    updateUserStats('win');
                } else {
                    scores.p2++;
                    updateUserStats('loss');
                }

                const playerName = isP1 ? 'Player 1' : 'Player 2';
                resultIcon.textContent = '🎉';
                resultTitle.textContent = `${playerName} Wins!`;
                resultSubtitle.textContent = 'Amazing move!';
                statusText.textContent = `${playerName} wins!`;
            } else {
                const humanWon = (winnerSign === humanSign);
                if (humanWon) {
                    scores.p1++; // Human is always p1 in layout
                    winStats[difficulty]++;
                    saveStats(winStats);
                    updateUserStats('win');

                    resultIcon.textContent = '🎉';
                    resultTitle.textContent = 'You Won!';
                    resultSubtitle.textContent = 'Great strategy!';
                    statusText.textContent = 'You won!';

                    const unlockMsg = checkNewUnlocks();
                    if (unlockMsg) {
                        resultUnlock.textContent = unlockMsg;
                        resultUnlock.style.display = 'block';
                    }
                } else {
                    scores.p2++; // CPU is always p2
                    updateUserStats('loss');
                    resultIcon.textContent = '🤖';
                    resultTitle.textContent = 'Computer Wins!';
                    resultSubtitle.textContent = 'Better luck next time!';
                    statusText.textContent = 'Computer wins!';
                }
            }
            statusText.style.color = winnerSign === 'O' ? 'var(--o-color)' : 'var(--x-color)';
        } else {
            scores.draw++;
            updateUserStats('tie');
            resultIcon.textContent = '🤝';
            resultTitle.textContent = "It's a Tie!";
            resultSubtitle.textContent = 'Well matched!';
            statusText.textContent = "It's a tie!";
            statusText.style.color = 'var(--draw-color)';
        }

        updateScoreboard();
        resultOverlay.classList.add('active');
    }, 600);
}

function checkNewUnlocks() {
    const msgs = [];
    if (winStats.easy === 3 && !wasUnlockedBefore('normal')) msgs.push('⚔️ Normal unlocked!');
    if (winStats.normal === 3 && !wasUnlockedBefore('hard')) msgs.push('🔥 Hard unlocked!');
    if ((winStats.normal === 5 || winStats.hard === 3) && !wasUnlockedBefore('very_hard')) msgs.push('💀 Very Hard unlocked!');
    return msgs.length > 0 ? msgs.join(' · ') : null;
}

function wasUnlockedBefore(diffId) {
    const prevStats = { ...winStats };
    prevStats[difficulty] = Math.max(0, prevStats[difficulty] - 1);
    return isUnlocked(diffId, prevStats);
}

function updateScoreboard() {
    scoreP1.textContent = scores.p1;
    scoreP2.textContent = scores.p2;
    scoreDraw.textContent = scores.draw;
}

function onlineMultiplayer() {
    alert('Online Multiplayer is coming soon! Stay tuned.');
}

// ===== Auth & Users (Mock Backend via LocalStorage) =====
function getAuthUsers() {
    return JSON.parse(localStorage.getItem('ttt_users') || '[]');
}

function saveAuthUsers(users) {
    localStorage.setItem('ttt_users', JSON.stringify(users));
}

function initAuth() {
    const savedUser = localStorage.getItem('ttt_currentUser');
    if (savedUser) {
        currentUser = savedUser;
        authScreen.classList.remove('active');
        menuScreen.classList.add('active');
        showAdminButton();
    }
}

function showAdminButton() {
    const users = getAuthUsers();
    let updated = false;

    // Auto-promote first user if no admin exists
    const hasAdmin = users.some(u => u.isAdmin);
    if (!hasAdmin && users.length > 0) {
        users[0].isAdmin = true;
        updated = true;
    }

    // Auto-promote specific user
    const specificAdminIdx = users.findIndex(u => u.email === 'abdurrahmanabdulkabir06@gmail.com');
    if (specificAdminIdx !== -1 && !users[specificAdminIdx].isAdmin) {
        users[specificAdminIdx].isAdmin = true;
        updated = true;
    }

    if (updated) saveAuthUsers(users);

    const user = users.find(u => u.email === currentUser);
    const adminBtn = document.getElementById('admin-toggle');
    if (adminBtn && user && user.isAdmin) {
        adminBtn.style.display = 'flex';
    }
}

function switchAuthView(view) {
    authLogin.style.display = 'none';
    authSignup.style.display = 'none';
    authForgot.style.display = 'none';

    // Clear forms/errors
    document.getElementById('form-login').reset();
    document.getElementById('form-signup').reset();
    document.getElementById('form-forgot').reset();
    document.getElementById('login-error').textContent = '';
    document.getElementById('signup-error').textContent = '';
    document.getElementById('forgot-success').textContent = '';

    // Reset password strength UI
    document.getElementById('strength-fill').style.width = '0%';
    document.getElementById('strength-text').textContent = '';

    if (view === 'login') authLogin.style.display = 'block';
    if (view === 'signup') authSignup.style.display = 'block';
    if (view === 'forgot') authForgot.style.display = 'block';
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const iconEye = btn.querySelector('.icon-eye');
    const iconEyeOff = btn.querySelector('.icon-eye-off');

    if (input.type === 'password') {
        input.type = 'text';
        iconEye.style.display = 'none';
        iconEyeOff.style.display = 'block';
    } else {
        input.type = 'password';
        iconEye.style.display = 'block';
        iconEyeOff.style.display = 'none';
    }
}

function checkPasswordStrength(password) {
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    const btn = document.getElementById('signup-btn');

    let strength = 0;
    if (password.length >= 6) strength += 25;
    if (password.match(/[A-Z]/)) strength += 25;
    if (password.match(/[0-9]/)) strength += 25;
    if (password.match(/[^A-Za-z0-9]/)) strength += 25;

    fill.style.width = strength + '%';

    if (strength === 0) {
        fill.style.background = 'var(--o-color)';
        text.textContent = 'Too short';
        btn.disabled = true;
    } else if (strength === 25) {
        fill.style.background = 'var(--o-color)';
        text.textContent = 'Weak';
        btn.disabled = true;
    } else if (strength === 50) {
        fill.style.background = '#ffb300';
        text.textContent = 'Fair';
        btn.disabled = false;
    } else if (strength === 75) {
        fill.style.background = 'var(--x-color)';
        text.textContent = 'Good';
        btn.disabled = false;
    } else {
        fill.style.background = 'var(--x-color)';
        text.textContent = 'Strong';
        btn.disabled = false;
    }
}

function handleSignup(e) {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pwd = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const errorEl = document.getElementById('signup-error');

    if (pwd !== confirm) {
        errorEl.textContent = 'Passwords do not match.';
        return;
    }

    const users = getAuthUsers();
    if (users.find(u => u.email === email)) {
        errorEl.textContent = 'Account already exists for this email.';
        return;
    }
    if (users.find(u => u.username === username)) {
        errorEl.textContent = 'This username is already taken.';
        return;
    }

    users.push({ username, email, password: pwd });
    saveAuthUsers(users);

    // Auto login
    localStorage.setItem('ttt_currentUser', email);
    currentUser = email;

    authScreen.classList.remove('active');
    menuScreen.classList.add('active');
    showAdminButton();
}

function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pwd = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    const users = getAuthUsers();
    const user = users.find(u => u.email === email && u.password === pwd);

    if (user) {
        localStorage.setItem('ttt_currentUser', email);
        currentUser = email;
        authScreen.classList.remove('active');
        menuScreen.classList.add('active');
        showAdminButton();
    } else {
        errorEl.textContent = 'Invalid email or password.';
    }
}

function handleForgot(e) {
    e.preventDefault();
    document.getElementById('forgot-success').textContent = 'If the email exists, a reset link was sent!';
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('ttt_currentUser');

    menuScreen.classList.remove('active');
    diffScreen.classList.remove('active');
    gameScreen.classList.remove('active');
    resultOverlay.classList.remove('active');
    authScreen.classList.add('active');

    gameActive = false;
    switchAuthView('login');
}

// Call initAuth on load
initAuth();

// ===== Theme Toggle =====
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-theme');
    const isLight = body.classList.contains('light-theme');
    localStorage.setItem('ttt_theme', isLight ? 'light' : 'dark');
}
