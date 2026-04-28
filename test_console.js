// Simple test to trigger console log request
const io = require('socket.io-client');

console.log('[Test] Connecting to server...');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('[Test] Connected to server with ID:', socket.id);
    
    // Simulate some console logs
    console.log('[Test] This is a test log message');
    console.warn('[Test] This is a test warning');
    console.error('[Test] This is a test error');
    
    // Wait a bit then request console logs
    setTimeout(() => {
        console.log('[Test] Requesting console logs from server...');
        socket.emit('requestConsoleLogs');
    }, 2000);
});

socket.on('consoleLogs', (logsData) => {
    console.log('[Test] Received console logs from server:');
    console.log('Client info:', logsData.clientInfo);
    console.log('Number of log entries:', logsData.buffer.length);
    
    // Show first few entries
    logsData.buffer.slice(0, 5).forEach((entry, index) => {
        console.log(`Entry ${index + 1}: [${entry.timestamp}] ${entry.level.toUpperCase()} - ${entry.message}`);
    });
    
    setTimeout(() => {
        socket.disconnect();
        process.exit(0);
    }, 1000);
});

socket.on('disconnect', () => {
    console.log('[Test] Disconnected from server');
});

setTimeout(() => {
    console.log('[Test] Test timeout, exiting...');
    process.exit(1);
}, 10000);
