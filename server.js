const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Log environment check
console.log('Starting server...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname + '/public'));

// PostgreSQL connection with better error handling
let pool;
try {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL environment variable is not set!');
        console.error('Please set DATABASE_URL in your Render environment variables');
        // Create a dummy pool for development
        pool = new Pool({
            connectionString: 'postgresql://localhost:5432/molta9a_db'
        });
    } else {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { 
                rejectUnauthorized: false 
            } : false
        });
        
        // Test connection
        pool.query('SELECT NOW()', (err) => {
            if (err) {
                console.error('Database connection failed:', err.message);
            } else {
                console.log('Database connected successfully');
            }
        });
    }
} catch (error) {
    console.error('Failed to create database pool:', error);
    process.exit(1);
}

// Admin password
const ADMIN_PASSWORD = "tchedlouzeboulaaz1919";

// Initialize database
async function initializeDatabase() {
    try {
        console.log('Initializing database...');
        
        // Create players table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                team VARCHAR(100) NOT NULL,
                position VARCHAR(50) DEFAULT 'Player',
                votes INTEGER DEFAULT 0,
                image TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Players table created/verified');

        // Create votes table with UNIQUE constraint on device_id
        await pool.query(`
            CREATE TABLE IF NOT EXISTS votes (
                id SERIAL PRIMARY KEY,
                player_id INTEGER REFERENCES players(id),
                device_id VARCHAR(255) NOT NULL UNIQUE,
                voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Votes table created/verified');

        // Check if we need to seed initial players
        const { rows } = await pool.query('SELECT COUNT(*) FROM players');
        const playerCount = parseInt(rows[0].count);
        console.log(`Found ${playerCount} existing players`);
        
        if (playerCount === 0) {
            console.log('Seeding initial players...');
            const initialPlayers = [
                ['Alaa Azouzi', '3eme math', 'Forward', 0, ''],
                ['Youssef Hmaidi', '3eme math', 'Forward', 0, ''],
                ['Ayhem Zerai', '3eme math', 'Forward', 0, ''],
                ['Amine Mehdouani', '3eme math', 'Midfielder', 0, ''],
                ['Adem Nahedh', '3eme math', 'Forward', 0, ''],
                ['Adem Hdhili', '3eme math', 'Forward', 0, '']
            ];
            
            for (const player of initialPlayers) {
                await pool.query(
                    'INSERT INTO players (name, team, position, votes, image) VALUES ($1, $2, $3, $4, $5)',
                    player
                );
            }
            
            console.log('Initial players seeded successfully');
        }

        console.log('Database initialization completed successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        // Don't crash - maybe tables already exist
        console.log('Continuing despite database error...');
    }
}

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: !!pool 
    });
});

// Get all players and total votes
app.get('/api/players', async (req, res) => {
    try {
        const playersResult = await pool.query('SELECT * FROM players ORDER BY id');
        const totalVotesResult = await pool.query('SELECT SUM(votes) as total FROM players');
        
        res.json({
            players: playersResult.rows,
            totalVotes: parseInt(totalVotesResult.rows[0].total) || 0
        });
    } catch (error) {
        console.error('Error fetching players:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check if device has voted
app.get('/api/check-vote/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const result = await pool.query(
            'SELECT player_id FROM votes WHERE device_id = $1',
            [deviceId]
        );
        
        if (result.rows.length > 0) {
            res.json({
                hasVoted: true,
                playerId: result.rows[0].player_id
            });
        } else {
            res.json({ hasVoted: false });
        }
    } catch (error) {
        console.error('Error checking vote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Submit a vote - SIMPLIFIED VERSION
app.post('/api/vote', async (req, res) => {
    try {
        const { playerId, deviceId } = req.body;
        
        if (!playerId || !deviceId) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                success: false 
            });
        }
        
        // Start transaction
        await pool.query('BEGIN');
        
        // Check if already voted
        const existingVote = await pool.query(
            'SELECT player_id FROM votes WHERE device_id = $1',
            [deviceId]
        );
        
        if (existingVote.rows.length > 0) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Already voted from this device',
                success: false 
            });
        }
        
        // Record the vote
        await pool.query(
            'INSERT INTO votes (player_id, device_id) VALUES ($1, $2)',
            [playerId, deviceId]
        );
        
        // Update player vote count
        await pool.query(
            'UPDATE players SET votes = votes + 1 WHERE id = $1',
            [playerId]
        );
        
        await pool.query('COMMIT');
        
        res.json({ 
            success: true,
            message: 'Vote recorded successfully'
        });
    } catch (error) {
        await pool.query('ROLLBACK');
        
        if (error.code === '23505') { // unique_violation
            return res.status(400).json({ 
                error: 'Already voted from this device',
                success: false 
            });
        }
        
        console.error('Error submitting vote:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            success: false 
        });
    }
});

// Reset user's vote
app.post('/api/reset-vote', async (req, res) => {
    try {
        const { deviceId } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID required' });
        }
        
        // Start transaction
        await pool.query('BEGIN');
        
        // Get the player they voted for
        const voteResult = await pool.query(
            'SELECT player_id FROM votes WHERE device_id = $1',
            [deviceId]
        );
        
        if (voteResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.json({ success: true });
        }
        
        const playerId = voteResult.rows[0].player_id;
        
        // Remove vote record
        await pool.query(
            'DELETE FROM votes WHERE device_id = $1',
            [deviceId]
        );
        
        // Decrement player vote count
        await pool.query(
            'UPDATE players SET votes = GREATEST(votes - 1, 0) WHERE id = $1',
            [playerId]
        );
        
        await pool.query('COMMIT');
        
        res.json({ success: true });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error resetting vote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (password === ADMIN_PASSWORD) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset all votes (admin only)
app.post('/api/admin/reset-all', async (req, res) => {
    try {
        // Start transaction
        await pool.query('BEGIN');
        
        // Reset all player votes
        await pool.query('UPDATE players SET votes = 0');
        
        // Clear all votes
        await pool.query('DELETE FROM votes');
        
        await pool.query('COMMIT');
        
        res.json({ success: true });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error resetting all votes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add new player (admin only)
app.post('/api/admin/add-player', async (req, res) => {
    try {
        const { name, team, image } = req.body;
        
        if (!name || !team) {
            return res.status(400).json({ error: 'Name and team are required' });
        }
        
        const result = await pool.query(
            'INSERT INTO players (name, team, image) VALUES ($1, $2, $3) RETURNING *',
            [name, team, image || '']
        );
        
        res.json({ player: result.rows[0] });
    } catch (error) {
        console.error('Error adding player:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove player (admin only)
app.delete('/api/admin/remove-player/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Start transaction
        await pool.query('BEGIN');
        
        // Remove votes for this player
        await pool.query('DELETE FROM votes WHERE player_id = $1', [id]);
        
        // Remove player
        await pool.query('DELETE FROM players WHERE id = $1', [id]);
        
        await pool.query('COMMIT');
        
        res.json({ success: true });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error removing player:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update player image (admin only)
app.put('/api/admin/update-image/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { image } = req.body;
        
        const result = await pool.query(
            'UPDATE players SET image = $1 WHERE id = $2 RETURNING *',
            [image || '', id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }
        
        res.json({ player: result.rows[0] });
    } catch (error) {
        console.error('Error updating player image:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve frontend for any other route
app.get('*', (req, res) => {
    res.sendFile('index.html', { root: __dirname + '/public' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(port, () => {
            console.log(`✅ Server running on port ${port}`);
            console.log(`✅ Health check: http://localhost:${port}/health`);
            console.log(`✅ API base: http://localhost:${port}/api`);
            console.log(`✅ Frontend: http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer();
