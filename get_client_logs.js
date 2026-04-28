// Simple script to trigger client console logs
const io = require('socket.io-client');

console.log('Connecting to game server to request client logs...');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected to server, requesting client logs...');
    
    // Send console log request
    socket.emit('requestConsoleLogs');
    
    // Listen for console logs
    socket.on('consoleLogs', (logs) => {
        console.log('\n=== CLIENT CONSOLE LOGS ===');
        console.log(logs);
        console.log('=== END LOGS ===\n');
        
        // Disconnect after receiving logs
        socket.disconnect();
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
        console.log('Timeout - disconnecting...');
        socket.disconnect();
    }, 5000);
});

socket.on('connect_error', (error) => {
    console.error('Failed to connect to server:', error.message);
    console.log('Make sure the game server is running on port 3000');
});
