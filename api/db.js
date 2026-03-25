import { MongoClient } from 'mongodb';

const uri = process.env.STORAGE_URL || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'tcube';

let client;
let clientPromise;

if (!uri) {
    console.error('Database connection string missing. Expected STORAGE_URL or MONGODB_URI.');
} else {
    try {
        if (process.env.NODE_ENV === 'development') {
            if (!global._mongoClientPromise) {
                client = new MongoClient(uri);
                global._mongoClientPromise = client.connect();
            }
            clientPromise = global._mongoClientPromise;
        } else {
            client = new MongoClient(uri);
            clientPromise = client.connect();
        }
    } catch (e) {
        console.error('MongoClient initialization error:', e);
    }
}

export default async function handler(req, res) {
    if (!clientPromise) {
        return res.status(500).json({ 
            error: 'Database connection not initialized.', 
            details: 'Check if STORAGE_URL or MONGODB_URI is set in Vercel environment variables.',
            debug: { hasUri: !!uri }
        });
    }

    try {
        const connectedClient = await clientPromise;
        const db = connectedClient.db(dbName);
        const collection = db.collection('kv_store');

        if (req.method === 'GET') {
            // Fetch users and stats
            const usersData = await collection.findOne({ key: 'ttt_users' });
            const statsData = await collection.findOne({ key: 'ttt_wins' });

            const users = usersData?.value || [];
            const stats = statsData?.value || { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
            
            return res.status(200).json({ users, stats });
        } else if (req.method === 'POST') {
            const { type, data } = req.body;
            let key = type === 'users' ? 'ttt_users' : (type === 'stats' ? 'ttt_wins' : null);
            
            if (!key) return res.status(400).json({ error: 'Invalid operation type' });

            // Upsert generic key/value
            await collection.updateOne(
                { key: key },
                { $set: { value: data } },
                { upsert: true }
            );

            return res.status(200).json({ success: true });
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('MongoDB Error:', error);
        return res.status(500).json({ error: 'Database operation failed' });
    }
}
