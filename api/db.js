import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const users = (await kv.get('ttt_users')) || [];
            const stats = (await kv.get('ttt_wins')) || { very_easy: 0, easy: 0, normal: 0, hard: 0, very_hard: 0 };
            return res.status(200).json({ users, stats });
        } catch (error) {
            console.error('KV Storage GET Error:', error);
            return res.status(500).json({ error: 'Failed to fetch data' });
        }
    } else if (req.method === 'POST') {
        try {
            const { type, data } = req.body;
            if (type === 'users') {
                await kv.set('ttt_users', data);
                return res.status(200).json({ success: true });
            } else if (type === 'stats') {
                await kv.set('ttt_wins', data);
                return res.status(200).json({ success: true });
            }
            return res.status(400).json({ error: 'Invalid operation type' });
        } catch (error) {
            console.error('KV Storage POST Error:', error);
            return res.status(500).json({ error: 'Failed to write data' });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
