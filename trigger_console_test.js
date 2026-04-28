// Simple script to trigger console log request
const net = require('net');

const client = net.createConnection({ port: 3000 }, () => {
    console.log('Connected to server');
    
    // Send a simple HTTP request to trigger the server
    client.write('GET / HTTP/1.1\r\n');
    client.write('Host: localhost:3000\r\n');
    client.write('Connection: close\r\n');
    client.write('\r\n');
});

client.on('data', (data) => {
    console.log('Received from server:', data.toString());
    client.end();
});

client.on('end', () => {
    console.log('Disconnected from server');
});

client.on('error', (err) => {
    console.log('Error:', err.message);
});
