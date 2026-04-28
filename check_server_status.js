// Check server status and try to get client logs
const io = require('socket.io-client');

console.log('Checking server status...');

const socket = io('http://localhost:3000');

let connected = false;

socket.on('connect', () => {
    connected = true;
    console.log('✅ Server is running and accepting connections');
    console.log('Socket ID:', socket.id);
    
    // Request client logs
    console.log('Requesting client console logs...');
    socket.emit('requestConsoleLogs');
});

socket.on('disconnect', () => {
    if (connected) {
        console.log('Disconnected from server');
    } else {
        console.log('❌ Failed to connect to server');
    }
});

socket.on('consoleLogs', (logs) => {
    console.log('\n=== CLIENT CONSOLE LOGS RECEIVED ===');
    console.log('Client info:', logs.clientInfo);
    console.log('Buffer size:', logs.buffer.length);
    
    if (logs.buffer.length > 0) {
        console.log('\nRecent logs:');
        logs.buffer.slice(-10).forEach((log, index) => {
            console.log(`[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`);
        });
    } else {
        console.log('No client logs available');
    }
    
    console.log('=== END LOGS ===\n');
    socket.disconnect();
});

socket.on('connect_error', (error) => {
    console.log('❌ Server connection error:', error.message);
    console.log('Make sure the game server is running on port 3000');
    console.log('Run: node server.js');
});

// Timeout after 10 seconds
setTimeout(() => {
    if (socket.connected) {
        console.log('⏰ Timeout - no logs received, disconnecting...');
        socket.disconnect();
    } else {
        console.log('❌ Could not connect to server within timeout');
    }
}, 10000);
