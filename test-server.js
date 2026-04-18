const express = require('express');

console.log('Starting test server...');

const app = express();
const port = process.env.PORT || 3000;

// Simple test route
app.get('/', (req, res) => {
    res.send(`
        <h1>Chesiopia Test Server Working!</h1>
        <p>Port: ${port}</p>
        <p>Time: ${new Date().toISOString()}</p>
        <p>Status: Server is running successfully</p>
        <button onclick="alert('JavaScript working!')">Test JavaScript</button>
        <script>
            console.log('Client-side JavaScript loaded');
        </script>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', port: port, time: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Test server running on port ${port}`);
});
