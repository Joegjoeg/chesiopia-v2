const http = require('http');

console.log('Starting minimal server...');

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    console.log(`Request received: ${req.method} ${req.url}`);
    
    res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
    });
    
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Minimal Test Server</title>
        </head>
        <body>
            <h1>Minimal Server Working!</h1>
            <p>Port: ${port}</p>
            <p>Time: ${new Date().toISOString()}</p>
            <p>Method: ${req.method}</p>
            <p>URL: ${req.url}</p>
        </body>
        </html>
    `);
});

server.listen(port, () => {
    console.log(`Minimal server running on port ${port}`);
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
