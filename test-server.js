const express = require('express');
const path = require('path');

console.log('Starting test server...');

const app = express();
const port = process.env.PORT || 3000;

// Simple test route
app.get('/', (req, res) => {
    res.send('<h1>Test Server Working!</h1><p>Port: ' + port + '</p>');
});

// Test static file serving
app.use(express.static(path.join(__dirname, 'client')));

app.listen(port, () => {
    console.log(`Test server running on port ${port}`);
});
