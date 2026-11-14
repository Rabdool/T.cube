import { MongoClient } from 'mongodb';
import {
    hashPassword, verifyPassword, safeEqual,
    createToken, getRequestSession, isAdminEmail, ConfigError
} from './_auth.js';

const uri = process.env.STORAGE_URL || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'tcube';

const DIFFICULTY_IDS = ['very_easy', 'easy', 'normal', 'hard', 'very_hard'];
const EMPTY_WIN_STATS = { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
const USERNAME_RE = /^[\p{L}\p{N}_ .-]{3,20}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

// Failed-password limits, per 15-minute window.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_ACCOUNT = 10;
const MAX_FAILS_PER_IP = 30;

let clientPromise;

if (!uri) {
    console.error('❌ MongoDB Error: Connection string missing. Check STORAGE_URL or MONGODB_URI.');
} else {
    const options = {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 10000,
    };
    if (process.env.NODE_ENV === 'development') {
        if (!global._mongoClientPromise) {
            global._mongoClientPromise = new MongoClient(uri, options).connect();
        }
        clientPromise = global._mongoClientPromise;
    } else {
        clientPromise = new MongoClient(uri, options).connect();
    }
}

// ===== Helpers =====
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ciExact(value) {
    return { $regex: `^${escapeRegex(value)}$`, $options: 'i' };
}

function normalizeStats(stats) {
    return {
        wins: stats?.wins || 0,
        losses: stats?.losses || 0,
        ties: stats?.ties || 0,
    };
}

// Per-player wins against the CPU at each difficulty; drives difficulty unlocks.
function normalizeDifficultyWins(dw) {
    const out = {};
    for (const id of DIFFICULTY_IDS) out[id] = Math.max(0, Number(dw?.[id]) || 0);
    return out;
}

// What the logged-in user sees about themselves.
function toProfile(user) {
    return {
        email: user.email,
        username: user.username || user.email.split('@')[0],
        stats: normalizeStats(user.stats),
        difficultyWins: normalizeDifficultyWins(user.difficultyWins),
        isAdmin: isAdminEmail(user.email),
    };
}

// What admins see about any user. Never includes password data.
function toAdminView(user) {
    return {
        email: user.email,
        username: user.username || '',
        stats: normalizeStats(user.stats),
        difficultyWins: normalizeDifficultyWins(user.difficultyWins),
        isAdmin: isAdminEmail(user.email),
        createdAt: user.createdAt || null,
    };
}

function validateUsername(username) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
        throw new HttpError(400, 'Username must be 3-20 letters, numbers, spaces, or _ . -');
    }
    return username.trim();
}

async function assertUsernameFree(users, username, exceptEmail) {
    const taken = await users.findOne({ username: ciExact(username) });
    if (taken && (!exceptEmail || taken.email.toLowerCase() !== exceptEmail.toLowerCase())) {
        throw new HttpError(409, 'This username is already taken.');
    }
}

let migrationChecked = false;
async function migrateLegacyKv(users, kv) {
    if (migrationChecked) return;
    const entry = await kv.findOne({ key: 'ttt_users' });
    if (entry && Array.isArray(entry.value)) {
        for (const user of entry.value) {
            if (!user.email) continue;
            const { _id, ...data } = user;
            await users.updateOne({ email: user.email }, { $set: data }, { upsert: true });
        }
        await kv.deleteOne({ key: 'ttt_users' });
        console.log(`✅ Migrated ${entry.value.length} users from KV to 'users' collection`);
    }
    migrationChecked = true;
}

// ===== Brute-force protection =====
let attemptsIndexReady = false;
async function attemptsCollection(db) {
    const col = db.collection('login_attempts');
    if (!attemptsIndexReady) {
        // MongoDB deletes old attempts automatically once the window has passed.
        await col.createIndex({ at: 1 }, { expireAfterSeconds: ATTEMPT_WINDOW_MS / 1000 });
        await col.createIndex({ key: 1, at: 1 });
        attemptsIndexReady = true;
    }
    return col;
}

function attemptKeys(ctx, account) {
    const keys = [{ key: `acct:${account.toLowerCase()}`, max: MAX_FAILS_PER_ACCOUNT }];
    if (ctx.ip) keys.push({ key: `ip:${ctx.ip}`, max: MAX_FAILS_PER_IP });
    return keys;
}

async function assertNotLocked(ctx, account) {
    const col = await attemptsCollection(ctx.db);
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
    for (const { key, max } of attemptKeys(ctx, account)) {
        if (await col.countDocuments({ key, at: { $gte: since } }) >= max) {
            throw new HttpError(429, 'Too many failed attempts. Please wait 15 minutes and try again.');
        }
    }
}

async function recordFailure(ctx, account) {
    const col = await attemptsCollection(ctx.db);
    const at = new Date();
    await col.insertMany(attemptKeys(ctx, account).map(({ key }) => ({ key, at })));
}

async function clearFailures(ctx, account) {
    const col = await attemptsCollection(ctx.db);
    await col.deleteMany({ key: `acct:${account.toLowerCase()}` });
}

// Checks a password against a user record, upgrading legacy plaintext passwords to a hash.
async function checkPassword(users, user, password) {
    if (user?.passwordHash) return verifyPassword(password, user.passwordHash);
    if (typeof user?.password === 'string' && safeEqual(password, user.password)) {
        await users.updateOne(
            { _id: user._id },
            { $set: { passwordHash: hashPassword(password) }, $unset: { password: '' } }
        );
        return true;
    }
    return false;
}

// ===== Action handlers =====
async function handleAuth(action, body, ctx) {
    const { users } = ctx;

    if (action === 'signup') {
        const username = validateUsername(body.username);
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const password = body.password;
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email.');
        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
            throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        if (await users.findOne({ email: ciExact(email) })) {
            throw new HttpError(409, 'Account already exists for this email.');
        }
        await assertUsernameFree(users, username);

        const user = {
            email,
            username,
            passwordHash: hashPassword(password),
            stats: { wins: 0, losses: 0, ties: 0 },
            createdAt: new Date(),
        };
        await users.insertOne(user);
        return { token: createToken(email), user: toProfile(user) };
    }

    if (action === 'login') {
        const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!identifier || !password) throw new HttpError(400, 'Missing credentials.');

        const user = await users.findOne({
            $or: [{ email: ciExact(identifier) }, { username: ciExact(identifier) }]
        });
        // Lock by the account's email when it exists, so email and username share one limit.
        const account = user?.email || identifier;
        await assertNotLocked(ctx, account);

        if (!(await checkPassword(users, user, password))) {
            await recordFailure(ctx, account);
            throw new HttpError(401, 'Invalid credentials.');
        }
        await clearFailures(ctx, account);
        return { token: createToken(user.email), user: toProfile(user) };
    }

    // Everything below requires a valid session.
    const me = await requireUser(ctx);

    if (action === 'me') {
        return { user: toProfile(me) };
    }

    if (action === 'update_profile') {
        const username = validateUsername(body.username);
        await assertUsernameFree(users, username, me.email);
        await users.updateOne({ _id: me._id }, { $set: { username } });
        return { user: toProfile({ ...me, username }) };
    }

    if (action === 'change_password') {
        const { currentPassword, newPassword } = body;
        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new HttpError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        await assertNotLocked(ctx, me.email);
        if (typeof currentPassword !== 'string' || !(await checkPassword(users, me, currentPassword))) {
            await recordFailure(ctx, me.email);
            throw new HttpError(403, 'Current password is incorrect.');
        }
        await clearFailures(ctx, me.email);

        // Tokens issued before this moment stop working: other devices get logged out.
        await users.updateOne(
            { _id: me._id },
            { $set: { passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() }, $unset: { password: '' } }
        );
        return { token: createToken(me.email) };
    }

    throw new HttpError(400, 'Invalid auth action');
}

async function handleStats(action, body, ctx) {
    const { users, kv } = ctx;
    const me = await requireUser(ctx);

    if (action === 'record') {
        const field = { win: 'wins', loss: 'losses', tie: 'ties' }[body.result];
        if (!field) throw new HttpError(400, 'Invalid result');

        const inc = { [`stats.${field}`]: 1 };
        const cpuWin = body.result === 'win' && body.mode === '1p' && DIFFICULTY_IDS.includes(body.difficulty);
        if (cpuWin) inc[`difficultyWins.${body.difficulty}`] = 1;

        // Atomic increments: concurrent games can no longer overwrite each other.
        await users.updateOne({ _id: me._id }, { $inc: inc });

        if (cpuWin) {
            // Global total, shown on the admin dashboard.
            await kv.updateOne(
                { key: 'ttt_wins' },
                { $inc: { [`value.${body.difficulty}`]: 1 } },
                { upsert: true }
            );
        }
        return { success: true };
    }

    throw new HttpError(400, 'Invalid stats action');
}

async function handleAdmin(action, body, ctx) {
    const { users, kv } = ctx;
    const me = await requireUser(ctx);
    if (!isAdminEmail(me.email)) throw new HttpError(403, 'Admin access required.');

    if (action === 'list_users') {
        const all = await users.find({}).toArray();
        const stats = (await kv.findOne({ key: 'ttt_wins' }))?.value || EMPTY_WIN_STATS;
        return { users: all.map(toAdminView), stats };
    }

    if (action === 'update_user') {
        if (typeof body.email !== 'string') throw new HttpError(400, 'Missing email');
        const target = await users.findOne({ email: body.email });
        if (!target) throw new HttpError(404, 'User not found');
        const username = validateUsername(body.username);
        await assertUsernameFree(users, username, target.email);
        await users.updateOne({ _id: target._id }, { $set: { username } });
        return { success: true };
    }

    if (action === 'delete_user') {
        if (typeof body.email !== 'string') throw new HttpError(400, 'Missing email');
        if (body.email.toLowerCase() === me.email.toLowerCase()) {
            throw new HttpError(400, "You can't delete your own account");
        }
        await users.deleteOne({ email: body.email });
        return { success: true };
    }

    if (action === 'reset_stats') {
        await users.updateMany({}, { $set: {
            stats: { wins: 0, losses: 0, ties: 0 },
            difficultyWins: normalizeDifficultyWins(null),
        } });
        await kv.updateOne({ key: 'ttt_wins' }, { $set: { value: { ...EMPTY_WIN_STATS } } }, { upsert: true });
        return { success: true };
    }

    if (action === 'delete_all_users') {
        const result = await users.deleteMany({});
        return { success: true, deleted: result.deletedCount };
    }

    if (action === 'import') {
        if (!Array.isArray(body.users)) throw new HttpError(400, 'users must be an array');
        let imported = 0;
        for (const u of body.users) {
            if (!u || typeof u.email !== 'string' || !EMAIL_RE.test(u.email)) continue;
            const set = { email: u.email, stats: normalizeStats(u.stats) };
            if (u.difficultyWins) set.difficultyWins = normalizeDifficultyWins(u.difficultyWins);
            if (typeof u.username === 'string' && u.username.trim()) set.username = u.username.trim();
            if (typeof u.passwordHash === 'string' && u.passwordHash.startsWith('scrypt$')) {
                set.passwordHash = u.passwordHash;
            } else if (typeof u.password === 'string' && u.password) {
                // Old backups contain plaintext passwords; hash them on the way in.
                set.passwordHash = hashPassword(u.password);
            }
            await users.updateOne(
                { email: ciExact(u.email) },
                { $set: set, $unset: { password: '' } },
                { upsert: true }
            );
            imported++;
        }
        if (body.winStats && typeof body.winStats === 'object') {
            const value = {};
            for (const id of DIFFICULTY_IDS) value[id] = Math.max(0, Number(body.winStats[id]) || 0);
            await kv.updateOne({ key: 'ttt_wins' }, { $set: { value } }, { upsert: true });
        }
        return { success: true, imported };
    }

    throw new HttpError(400, 'Invalid admin action');
}

async function handleMatchmaking(action, body, ctx) {
    const matchCollection = ctx.db.collection('matchmaking');

    // Keep the pending collection clean of stale rooms
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await matchCollection.deleteMany({ createdAt: { $lt: fiveMinutesAgo } });

    if (action !== 'auto_match') throw new HttpError(400, 'Invalid matchmaking action');

    const me = ctx.email ? await ctx.users.findOne({ email: ctx.email }) : null;
    const username = me?.username || 'Opponent';

    const room = await matchCollection.findOneAndUpdate(
        { status: 'waiting' },
        { $set: { status: 'matched' } },
        { sort: { createdAt: 1 }, returnDocument: 'before' }
    );
    if (room && room.roomCode) {
        return { success: true, role: 'guest', roomCode: room.roomCode, hostName: room.hostName || 'Opponent' };
    }

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    await matchCollection.insertOne({ roomCode: code, status: 'waiting', hostName: username, createdAt: new Date() });
    return { success: true, role: 'host', roomCode: code };
}

async function requireUser(ctx) {
    if (!ctx.email) throw new HttpError(401, 'Please log in.');
    const user = await ctx.users.findOne({ email: ctx.email });
    if (!user) throw new HttpError(401, 'Session expired. Please log in again.');
    if (user.passwordChangedAt && ctx.session.iat < user.passwordChangedAt.getTime()) {
        throw new HttpError(401, 'Your password was changed. Please log in again.');
    }
    return user;
}

// ===== Entry point =====
export default async function handler(req, res) {
    if (!clientPromise) {
        return res.status(500).json({
            error: 'Database connection not initialized.',
            details: 'Check if STORAGE_URL or MONGODB_URI is set in Vercel environment variables.'
        });
    }

    try {
        const client = await clientPromise;
        const db = client.db(dbName);
        const users = db.collection('users');
        const kv = db.collection('kv_store');
        await migrateLegacyKv(users, kv);

        if (req.method === 'GET') {
            // Public data only: leaderboard names and stats. No emails, no passwords.
            const top = await users.find({}, { projection: { username: 1, stats: 1 } })
                .sort({ 'stats.wins': -1 }).limit(10).toArray();
            const statsDoc = await kv.findOne({ key: 'ttt_wins' });
            return res.status(200).json({
                leaderboard: top.map(u => ({
                    username: u.username || 'Anonymous',
                    stats: normalizeStats(u.stats),
                })),
                stats: { ...EMPTY_WIN_STATS, ...(statsDoc?.value || {}) },
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }

        const body = req.body || {};
        const session = getRequestSession(req);
        const forwarded = req.headers?.['x-forwarded-for'];
        const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req.socket?.remoteAddress || null;
        const ctx = { db, users, kv, ip, session, email: session?.email || null };
        const handlers = {
            auth: handleAuth,
            stats: handleStats,
            admin: handleAdmin,
            matchmaking: handleMatchmaking,
        };
        const fn = handlers[body.type];
        if (!fn) throw new HttpError(400, 'Invalid operation type');
        return res.status(200).json(await fn(body.action, body, ctx));
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        if (error instanceof ConfigError) {
            console.error('Config Error:', error.message);
            return res.status(500).json({ error: 'Server is misconfigured (AUTH_SECRET). Please contact the admin.' });
        }
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
}
