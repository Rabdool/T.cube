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

// ===== Database Integration =====
let dbUsers = [];

async function fetchInitialDB() {
    try {
        const res = await fetch('/api/db');
        const data = await res.json();
        if (data.users) dbUsers = data.users;
        if (data.stats) winStats = data.stats;
    } catch (e) {
        console.error('Failed to load from DB', e);
    }
}

// ===== Persistent Stats =====
function loadStats() {
    return { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
}

function saveStats(stats) {
    winStats = stats;
    fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stats', data: stats })
    }).catch(e => console.error(e));
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

// Online State
let peer = null;
let conn = null;
let onlineRole = null; // 'host' or 'guest'
let onlineRoomId = null;

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
    } else if (mode === 'online') {
        labelLeft.textContent = `You (${humanSign})`;
        labelRight.textContent = `Opponent (${cpuSign})`;
    } else {
        labelLeft.textContent = `You (${humanSign})`;
        labelRight.textContent = `CPU (${cpuSign})`;
    }
}

function goToMenu() {
    if (peer) { peer.destroy(); peer = null; }
    if (conn) { conn.close(); conn = null; }
    resultOverlay.classList.remove('active');
    gameScreen.classList.remove('active');
    diffScreen.classList.remove('active');
    const onlineScreen = document.getElementById('online-screen');
    if (onlineScreen) onlineScreen.classList.remove('active');
    menuScreen.classList.add('active');
    gameActive = false;
}

function restartGame() {
    if (mode === 'online' && conn && conn.open) {
        conn.send({ type: 'restart' });
    }
    restartGameLogic();
}

function restartGameLogic() {
    resultOverlay.classList.remove('active');

    // Swap signs based on winner: loser starts (gets 'X')
    if (lastWinner !== null) {
        if (mode === '1p' || mode === 'online') {
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
        if (mode === '1p' || mode === 'online') {
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
    } else if (mode === 'online') {
        if (currentTurn === humanSign) {
            statusText.textContent = `Your turn (${humanSign})`;
            statusText.style.color = humanSign === 'O' ? 'var(--o-color)' : 'var(--x-color)';
        } else {
            statusText.textContent = `Opponent's turn (${cpuSign})`;
            statusText.style.color = cpuSign === 'O' ? 'var(--o-color)' : 'var(--x-color)';
        }
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
    if (mode === 'online' && currentTurn !== humanSign) return;

    placeMove(index, currentTurn);

    if (mode === 'online' && conn && conn.open) {
        conn.send({ type: 'move', index: index, sign: currentTurn });
    }

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
        
        // Sync ONLY this user
        saveAuthUsers(users[idx], 'update');
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
            } else if (mode === 'online') {
                const humanWon = (winnerSign === humanSign);
                if (humanWon) {
                    scores.p1++; // Human is always p1 in layout
                    updateUserStats('win');
                    resultIcon.textContent = '🎉';
                    resultTitle.textContent = 'You Won!';
                    resultSubtitle.textContent = 'Great game!';
                    statusText.textContent = 'You won!';
                } else {
                    scores.p2++; // Opponent is always p2
                    updateUserStats('loss');
                    resultIcon.textContent = '😞';
                    resultTitle.textContent = 'Opponent Wins!';
                    resultSubtitle.textContent = 'Well played by them.';
                    statusText.textContent = 'Opponent wins!';
                }
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
    menuScreen.classList.remove('active');
    document.getElementById('online-screen').classList.add('active');
    
    document.getElementById('online-options').style.display = 'flex';
    document.getElementById('online-host-view').style.display = 'none';
    document.getElementById('online-join-view').style.display = 'none';
    document.getElementById('online-automatch-view').style.display = 'none';
    
    document.getElementById('join-room-code').value = '';
    document.getElementById('join-status').textContent = '';
}

function backToMenuFromOnline() {
    if (peer) { peer.destroy(); peer = null; }
    if (conn) { conn.close(); conn = null; }
    document.getElementById('online-screen').classList.remove('active');
    menuScreen.classList.add('active');
}

async function autoMatch() {
    document.getElementById('online-options').style.display = 'none';
    const amView = document.getElementById('online-automatch-view');
    amView.style.display = 'flex';
    
    const statusEl = document.getElementById('automatch-status');
    statusEl.textContent = 'Connecting to matchmaker...';
    
    try {
        const res = await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'matchmaking', action: 'auto_match' })
        });
        const data = await res.json();
        
        if (!data.success) {
            statusEl.textContent = 'Matchmaking failed: ' + (data.error || 'Unknown error');
            return;
        }

        if (data.role === 'host') {
            statusEl.textContent = 'Waiting for an opponent to join...';
            onlineRoomId = data.roomCode;
            peer = new Peer('tcube-' + onlineRoomId);
            
            peer.on('open', (id) => {
                // Wait for connection
            });
            
            peer.on('connection', (connection) => {
                conn = connection;
                setupConnection(conn, 'host');
            });

            peer.on('error', (err) => {
                statusEl.textContent = 'Peer error: ' + err.type;
            });
            
        } else if (data.role === 'guest') {
            statusEl.textContent = 'Match found! Connecting...';
            peer = new Peer();
            
            peer.on('open', (id) => {
                conn = peer.connect('tcube-' + data.roomCode);
                
                conn.on('open', () => {
                    setupConnection(conn, 'guest');
                });
                
                conn.on('error', (err) => {
                    statusEl.textContent = 'Connection failed: ' + err;
                    setTimeout(autoMatch, 2000); 
                });
            });

            peer.on('error', (err) => {
                if (err.type === 'peer-unavailable') {
                    statusEl.textContent = 'Opponent left. Retrying...';
                    if (peer) { peer.destroy(); peer = null; }
                    setTimeout(autoMatch, 1500);
                } else {
                    statusEl.textContent = 'Peer error: ' + err.type;
                }
            });
        }
    } catch (e) {
        statusEl.textContent = 'Network error. Try again.';
        console.error(e);
    }
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

function hostOnlineGame() {
    document.getElementById('online-options').style.display = 'none';
    document.getElementById('online-host-view').style.display = 'flex';
    
    onlineRoomId = generateRoomCode();
    document.getElementById('room-code').textContent = onlineRoomId;
    document.getElementById('host-status').textContent = 'Generating room...';
    
    peer = new Peer('tcube-' + onlineRoomId);
    
    peer.on('open', (id) => {
        document.getElementById('host-status').textContent = 'Waiting for opponent to join...';
    });
    
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection(conn, 'host');
    });

    peer.on('error', (err) => {
        document.getElementById('host-status').textContent = 'Error: ' + err.type;
    });
}

function showJoinInput() {
    document.getElementById('online-options').style.display = 'none';
    document.getElementById('online-join-view').style.display = 'flex';
}

function joinOnlineGame() {
    const code = document.getElementById('join-room-code').value.trim().toUpperCase();
    if (code.length === 0) return;
    
    const statusEl = document.getElementById('join-status');
    statusEl.textContent = 'Connecting...';
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        conn = peer.connect('tcube-' + code);
        
        conn.on('open', () => {
            statusEl.textContent = 'Connected!';
            setupConnection(conn, 'guest');
        });
        
        conn.on('error', (err) => {
            statusEl.textContent = 'Connection failed: ' + err;
        });
    });

    peer.on('error', (err) => {
        statusEl.textContent = 'Error: ' + err.type;
        if (err.type === 'peer-unavailable') {
            statusEl.textContent = 'Room not found. Check the code and try again.';
        }
    });
}

function setupConnection(connection, role) {
    onlineRole = role;
    
    connection.on('data', (data) => {
        if (data.type === 'move') {
            placeMove(data.index, data.sign);
            const winner = checkWin(data.sign);
            if (winner) { endGame(data.sign); return; }
            if (getFreeCells().length === 0) { endGame(null); return; }
            currentTurn = currentTurn === 'O' ? 'X' : 'O';
            updateStatus();
        } else if (data.type === 'restart') {
            restartGameLogic();
        }
    });
    
    connection.on('close', () => {
        alert('Opponent disconnected!');
        goToMenu();
    });
    
    startOnlineGame();
}

function startOnlineGame() {
    mode = 'online';
    scores = { p1: 0, p2: 0, draw: 0 };
    lastWinner = null;
    tieLastMover = null;

    humanSign = onlineRole === 'host' ? 'X' : 'O';
    cpuSign = onlineRole === 'host' ? 'O' : 'X';
    p1Sign = 'X';
    p2Sign = 'O';

    updateLabels();
    updateScoreboard();

    document.getElementById('diff-badge').style.display = 'inline-block';
    document.getElementById('diff-badge').textContent = onlineRole === 'host' ? 'Host (X)' : 'Guest (O)';
    document.getElementById('diff-badge').style.background = 'var(--primary-color)22';
    document.getElementById('diff-badge').style.color = 'var(--primary-color)';
    document.getElementById('diff-badge').style.borderColor = 'var(--primary-color)44';

    document.getElementById('online-screen').classList.remove('active');
    gameScreen.classList.add('active');
    resetBoard();
}

// ===== Auth & Users (Vercel KV Backend) =====
function getAuthUsers() {
    return dbUsers;
}

function saveAuthUsers(data, action = 'update') {
    // If we're updating a single user, data is the user object.
    // If we're updating everything (legacy), data is the array.
    if (!Array.isArray(data)) {
        // Find and update in local list
        const idx = dbUsers.findIndex(u => u.email === data.email);
        if (idx !== -1) dbUsers[idx] = data;
        else dbUsers.push(data);
    } else {
        dbUsers = data;
    }

    fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'users', action, data })
    }).catch(e => console.error('Sync failed', e));
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
    const ALLOWED_ADMINS = ['abdurrahmanabdulkabir06@gmail.com', 'test-admin-verification@gmail.com'];
    const adminBtn = document.getElementById('admin-toggle');
    if (adminBtn && ALLOWED_ADMINS.includes(currentUser)) {
        adminBtn.style.display = 'flex';
    } else if (adminBtn) {
        adminBtn.style.display = 'none';
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

async function handleSignup(e) {
    e.preventDefault();
    const btn = document.getElementById('signup-btn');
    const prevText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-text" style="align-items: center"><strong>Processing...</strong></span>';
    btn.disabled = true;

    try {
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
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            errorEl.textContent = 'Account already exists for this email.';
            return;
        }
        if (users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase())) {
            errorEl.textContent = 'This username is already taken.';
            return;
        }

        const newUser = { username, email, password: pwd };
        
        const res = await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'users', action: 'signup', data: newUser })
        });
        
        const resData = await res.json();
        
        if (res.ok) {
            await fetchInitialDB();
            localStorage.setItem('ttt_currentUser', email);
            currentUser = email;
            authScreen.classList.remove('active');
            menuScreen.classList.add('active');
            showAdminButton();
        } else {
            errorEl.textContent = resData.error || 'Failed to create account.';
        }
    } finally {
        if(btn) {
            btn.innerHTML = prevText;
            btn.disabled = false;
        }
    }
}

function handleLogin(e) {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim().toLowerCase();
    const pwd = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    const users = getAuthUsers();
    const user = users.find(u => {
        const match = u.email.toLowerCase() === identifier || (u.username && u.username.toLowerCase() === identifier);
        return match && u.password === pwd;
    });

    if (user) {
        localStorage.setItem('ttt_currentUser', user.email);
        currentUser = user.email;
        authScreen.classList.remove('active');
        menuScreen.classList.add('active');
        showAdminButton();
    } else {
        errorEl.textContent = 'Invalid credentials.';
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

// Initialize App
async function initializeApp() {
    await fetchInitialDB();
    initAuth();
}
initializeApp();

// ===== Theme Toggle =====
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-theme');
    const isLight = body.classList.contains('light-theme');
    localStorage.setItem('ttt_theme', isLight ? 'light' : 'dark');
}
