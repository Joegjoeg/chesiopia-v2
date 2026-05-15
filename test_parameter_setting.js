// Test script to set a parameter and check logs
const io = require('socket.io-client');

console.log('Connecting to game server to test parameter setting...');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected to server, testing parameter setting...');
    
    // Set a random water level value
    const testValue = Math.random() * 10 - 5; // Random value between -5 and 5
    console.log(`Setting waterLevel to: ${testValue}`);
    
    // Send parameter set command
    socket.emit('setParameter', {
        name: 'waterLevel',
        value: testValue
    });
    
    // Wait a moment, then request console logs
    setTimeout(() => {
        console.log('Requesting console logs to check actual values...');
        socket.emit('requestConsoleLogs');
        
        // Listen for console logs
        socket.on('consoleLogs', (logs) => {
            console.log('\n=== CLIENT CONSOLE LOGS ===');
            console.log(logs);
            console.log('=== END LOGS ===\n');
            
            // Disconnect after receiving logs
            socket.disconnect();
        });
    }, 2000);
});

socket.on('connect_error', (error) => {
    console.error('Failed to connect to server:', error.message);
    console.log('Make sure the game server is running on port 3000');
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log('Timeout - disconnecting...');
    socket.disconnect();
}, 10000);
