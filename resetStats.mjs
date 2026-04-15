import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error("❌ Please provide the MONGODB_URI environment variable.");
    console.error("Usage: MONGODB_URI='your_connection_string' node resetStats.mjs");
    process.exit(1);
}

const dbName = process.env.MONGODB_DB || 'tcube';

async function resetStats() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("✅ Connected to MongoDB.");
        const db = client.db(dbName);
        
        // 1. Reset user statistics entirely
        const usersResult = await db.collection('users').updateMany(
            {},
            { $set: { "stats.wins": 0, "stats.losses": 0, "stats.ties": 0 } }
        );
        console.log(`✅ Reset stats for ${usersResult.modifiedCount} users.`);

        // 2. Reset global game stats (wins vs AI)
        const kvResult = await db.collection('kv_store').updateOne(
            { key: 'ttt_wins' },
            { $set: { value: { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 } } },
            { upsert: true }
        );
        console.log(`✅ Reset global difficulty stats in kv_store.`);

        console.log("🎉 All users game play stats successfully reset!");
    } catch (e) {
        console.error("❌ Error resetting stats:", e);
    } finally {
        await client.close();
    }
}

resetStats();
