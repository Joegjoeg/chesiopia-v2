// Test script to verify console forwarding system
const io = require('socket.io-client');

console.log('[Test] Starting console forwarding test...');

// Connect to the server
const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('[Test] Connected to server with ID:', socket.id);
    
    // Simulate some console logs on the client side
    console.log('[Test] This is a test log message from client');
    console.warn('[Test] This is a test warning from client');
    console.error('[Test] This is a test error from client');
    
    // Wait a moment then trigger console log request
    setTimeout(() => {
        console.log('[Test] Triggering console log request...');
        
        // Send a request to server to ask for console logs
        socket.emit('requestConsoleLogs');
        
        // Wait for response then disconnect
        setTimeout(() => {
            socket.disconnect();
            process.exit(0);
        }, 2000);
    }, 1000);
});

socket.on('consoleLogs', (logsData) => {
    console.log('\n[Test] === RECEIVED CONSOLE LOGS FROM SERVER ===');
    console.log('[Test] Client info:', {
        userAgent: logsData.clientInfo.userAgent,
        url: logsData.clientInfo.url,
        bufferSize: `${logsData.clientInfo.bufferSize}/${logsData.clientInfo.maxBufferSize}`,
        timestamp: logsData.clientInfo.timestamp
    });
    
    console.log(`[Test] Total log entries: ${logsData.buffer.length}`);
    
    // Show first 10 entries
    console.log('\n[Test] First 10 log entries:');
    logsData.buffer.slice(0, 10).forEach((entry, index) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const level = entry.level.toUpperCase().padEnd(5);
        console.log(`[Test] [${timestamp}] ${level} ${entry.message}`);
    });
    
    console.log('\n[Test] === CONSOLE FORWARDING TEST SUCCESSFUL ===\n');
});

socket.on('disconnect', () => {
    console.log('[Test] Disconnected from server');
});

socket.on('connect_error', (error) => {
    console.log('[Test] Connection error:', error.message);
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log('[Test] Test timed out');
    process.exit(1);
}, 10000);
