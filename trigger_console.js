const net = require('net');

// Connect to the server's console input
const client = net.createConnection({ port: 3000 }, () => {
    console.log('Connected to server');
    
    // Send 'c' to trigger console request
    client.write('c\n');
    
    // Wait a bit then disconnect
    setTimeout(() => {
        client.end();
    }, 1000);
});

client.on('data', (data) => {
    console.log('Received:', data.toString());
});

client.on('end', () => {
    console.log('Disconnected from server');
});

client.on('error', (err) => {
    console.error('Connection error:', err.message);
});
