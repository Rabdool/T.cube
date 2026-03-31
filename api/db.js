import { MongoClient } from 'mongodb';

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
