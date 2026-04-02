import { MongoClient } from 'mongodb';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const uri = process.env.STORAGE_URL || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'tcube';

let client;
let clientPromise;

if (!uri) {
    console.error('❌ MongoDB Error: Connection string missing. Check STORAGE_URL or MONGODB_URI.');
} else {
    try {
        const options = {
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            serverSelectionTimeoutMS: 10000,
        };

        if (process.env.NODE_ENV === 'development') {
            if (!global._mongoClientPromise) {
                client = new MongoClient(uri, options);
                global._mongoClientPromise = client.connect();
                console.log('✅ MongoDB: Initialized development singleton connection');
            }
            clientPromise = global._mongoClientPromise;
        } else {
            client = new MongoClient(uri, options);
            clientPromise = client.connect();
            console.log('✅ MongoDB: Initialized production connection');
        }
    } catch (e) {
        console.error('❌ MongoDB Initialization error:', e);
    }
}

export default async function handler(req, res) {
    if (!clientPromise) {
        console.error('❌ Database connection not initialized.');
        return res.status(500).json({ 
            error: 'Database connection not initialized.', 
            details: 'Check if STORAGE_URL or MONGODB_URI is set in Vercel environment variables.'
        });
    }

    try {
        const connectedClient = await clientPromise;
        const db = connectedClient.db(dbName);
        const usersCollection = db.collection('users');
        const kvCollection = db.collection('kv_store');

        // --- MIGRATION: Move from KV to 'users' collection if needed ---
        const kvUsersEntry = await kvCollection.findOne({ key: 'ttt_users' });
        if (kvUsersEntry && Array.isArray(kvUsersEntry.value)) {
            for (const user of kvUsersEntry.value) {
                await usersCollection.updateOne(
                    { email: user.email },
                    { $set: user },
                    { upsert: true }
                );
            }
            // Once migrated, clear the bulk key to avoid re-migration
            await kvCollection.deleteOne({ key: 'ttt_users' });
            console.log(`✅ Migrated ${kvUsersEntry.value.length} users from KV to 'users' collection`);
        }

        if (req.method === 'GET') {
            // Fetch users from 'users' collection and global stats from 'kv_store'
            const users = await usersCollection.find({}).toArray();
            const statsData = await kvCollection.findOne({ key: 'ttt_wins' });
            const stats = statsData?.value || { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
            
            return res.status(200).json({ users, stats });

        } else if (req.method === 'POST') {
            const { type, data, action } = req.body;

            if (type === 'stats') {
                await kvCollection.updateOne(
                    { key: 'ttt_wins' },
                    { $set: { value: data } },
                    { upsert: true }
                );
                return res.status(200).json({ success: true });
            }

            if (type === 'users') {
                // If action is provided, handle specific user update
                if (action === 'send_verification') {
                    if (!data.email || !data.username) return res.status(400).json({ error: 'Missing email or username' });
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    const now = Date.now();
                    const expires = now + 10 * 60 * 1000;
                    
                    await usersCollection.updateOne(
                        { email: data.email },
                        { $set: { ...data, isVerified: false, verificationCode: code, verificationExpires: expires, verificationSentAt: now } },
                        { upsert: true }
                    );

                    try {
                        const emailResult = await resend.emails.send({
                            from: 'T.cube <onboarding@resend.dev>',
                            to: [data.email],
                            subject: 'T.cube - Verification Code',
                            html: `<p>Welcome to T.cube! Your verification code is: <strong>${code}</strong></p>`
                        });
                        console.log('✅ Resend email successful:', emailResult);
                        return res.status(200).json({ success: true });
                    } catch(err) {
                        console.error('❌ Resend Error:', err);
                        return res.status(500).json({ error: 'Failed to send verification email' });
                    }
                }

                if (action === 'resend_verification') {
                    if (!data.email) return res.status(400).json({ error: 'Missing email' });
                    
                    const user = await usersCollection.findOne({ email: data.email });
                    if (!user) return res.status(404).json({ error: 'User not found' });
                    if (user.isVerified) return res.status(400).json({ error: 'User already verified' });
                    
                    const now = Date.now();
                    if (user.verificationSentAt && now - user.verificationSentAt < 60 * 1000) {
                        return res.status(429).json({ error: 'Please wait before resending.' });
                    }
                    
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    const expires = now + 10 * 60 * 1000;
                    
                    await usersCollection.updateOne(
                        { email: data.email },
                        { $set: { verificationCode: code, verificationExpires: expires, verificationSentAt: now } }
                    );

                    try {
                        await resend.emails.send({
                            from: 'T.cube <onboarding@resend.dev>',
                            to: [data.email],
                            subject: 'T.cube - Your New Verification Code',
                            html: `<p>Welcome back! Your new verification code is: <strong>${code}</strong></p>`
                        });
                        return res.status(200).json({ success: true });
                    } catch(err) {
                        console.error('❌ Resend Error:', err);
                        return res.status(500).json({ error: 'Failed to resend verification email' });
                    }
                }

                if (action === 'verify_code') {
                    const { email, code } = data;
                    if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
                    
                    const user = await usersCollection.findOne({ email: email });
                    if (!user) return res.status(404).json({ error: 'User not found' });
                    
                    if (user.verificationCode !== code) {
                        return res.status(400).json({ error: 'Invalid verification code' });
                    }
                    if (user.verificationExpires && Date.now() > user.verificationExpires) {
                        return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
                    }
                    
                    await usersCollection.updateOne(
                        { email: email },
                        { 
                            $set: { isVerified: true },
                            $unset: { verificationCode: "", verificationExpires: "", verificationSentAt: "" }
                        }
                    );
                    return res.status(200).json({ success: true });
                }

                if (action === 'signup' || action === 'add' || action === 'update') {
                    if (!data.email) return res.status(400).json({ error: 'Missing email' });
                    await usersCollection.updateOne(
                        { email: data.email },
                        { $set: data },
                        { upsert: true }
                    );
                    return res.status(200).json({ success: true });
                } else if (action === 'delete') {
                    if (!data.email) return res.status(400).json({ error: 'Missing email' });
                    await usersCollection.deleteOne({ email: data.email });
                    return res.status(200).json({ success: true });
                } else if (action === 'sync_all') {
                    // LEGACY SUPPORT: If still sending full array, handle it (carefully)
                    if (!Array.isArray(data)) return res.status(400).json({ error: 'Data must be an array' });
                    for (const user of data) {
                        await usersCollection.updateOne(
                            { email: user.email },
                            { $set: user },
                            { upsert: true }
                        );
                    }
                    return res.status(200).json({ success: true });
                }
                return res.status(400).json({ error: 'Invalid user action' });
            }

            if (type === 'matchmaking') {
                const matchCollection = db.collection('matchmaking');
                
                // Keep the pending collection clean of stale rooms
                const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
                await matchCollection.deleteMany({ createdAt: { $lt: fiveMinutesAgo } });

                if (action === 'auto_match') {
                    // Find an existing waiting room
                    const waitingRoomResult = await matchCollection.findOneAndUpdate(
                        { status: 'waiting' },
                        { $set: { status: 'matched' } },
                        { sort: { createdAt: 1 }, returnDocument: 'before' }
                    );

                    // MongoDB native driver v6+ often returns the document directly, older ones wrap in {value: ...}
                    const room = waitingRoomResult?.value || waitingRoomResult;

                    if (room && room.roomCode) {
                        return res.status(200).json({ success: true, role: 'guest', roomCode: room.roomCode });
                    } else {
                        // Generate a new code and set to waiting
                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                        let code = '';
                        for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                        
                        await matchCollection.insertOne({ roomCode: code, status: 'waiting', createdAt: new Date() });
                        
                        return res.status(200).json({ success: true, role: 'host', roomCode: code });
                    }
                }
                return res.status(400).json({ error: 'Invalid matchmaking action' });
            }

            return res.status(400).json({ error: 'Invalid operation type' });
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('MongoDB Error:', error);
        return res.status(500).json({ error: 'Database operation failed' });
    }
}
