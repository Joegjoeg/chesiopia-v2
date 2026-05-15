const io = require('socket.io-client');

console.log('[Console] Connecting to server to request client console logs...');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('[Console] Connected to server with ID:', socket.id);
    
    // Request console logs from the server
    setTimeout(() => {
        console.log('[Console] Requesting console logs...');
        socket.emit('requestConsoleLogs');
    }, 1000);
});

socket.on('consoleLogs', (logsData) => {
    console.log('\n=== CLIENT CONSOLE LOGS ===');
    console.log('Client info:', logsData.clientInfo);
    console.log(`Total log entries: ${logsData.buffer.length}`);
    console.log('\n=== RECENT LOGS (last 50) ===');
    
    // Show last 50 log entries
    const recentLogs = logsData.buffer.slice(-50);
    recentLogs.forEach((entry, index) => {
        console.log(`[${entry.timestamp}] ${entry.level.toUpperCase()} - ${entry.message}`);
    });
    
    console.log('\n=== END LOGS ===\n');
    socket.disconnect();
});

socket.on('disconnect', () => {
    console.log('[Console] Disconnected from server');
    process.exit(0);
});

socket.on('connect_error', (error) => {
    console.error('[Console] Connection error:', error.message);
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error('[Console] Timeout - no response');
    socket.disconnect();
    process.exit(1);
}, 10000);
