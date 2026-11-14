// Shared auth helpers. Files starting with "_" in /api are not exposed as routes by Vercel.
import crypto from 'crypto';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Admins are decided server-side only. Override with ADMIN_EMAILS="a@x.com,b@y.com".
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ||
    'abdurrahmanabdulkabir06@gmail.com,test-admin-verification@gmail.com')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

export function isAdminEmail(email) {
    return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export class ConfigError extends Error {}

function getSecret() {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) {
        throw new ConfigError('AUTH_SECRET env var missing or shorter than 32 characters');
    }
    return secret;
}

// ===== Password hashing (scrypt) =====
export function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

// Random temporary password for admin resets (no look-alike characters such as 0/O, 1/l).
export function generateTempPassword(length = 10) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

// Constant-time compare for legacy plaintext passwords (migrated on next login).
export function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ===== Signed session tokens =====
function sign(payloadB64) {
    return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

export function createToken(email) {
    const now = Date.now();
    const payload = Buffer.from(JSON.stringify({ email, iat: now, exp: now + TOKEN_TTL_MS })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

// Returns { email, iat } for a valid token, or null.
export function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const { email, iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!email || typeof exp !== 'number' || exp < Date.now()) return null;
        return { email, iat: typeof iat === 'number' ? iat : 0 };
    } catch {
        return null;
    }
}

export function getRequestSession(req) {
    const header = req.headers?.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    return match ? verifyToken(match[1]) : null;
}
