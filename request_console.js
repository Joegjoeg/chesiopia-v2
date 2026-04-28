const net = require('net');

const client = net.createConnection({ host: 'localhost', port: 3000 }, () => {
    console.log('Connected to server');
    client.write('c\n');
});

client.on('data', (data) => {
    console.log('Received:', data.toString());
    client.end();
});

client.on('end', () => {
    console.log('Disconnected from server');
});

client.on('error', (err) => {
    console.error('Error:', err.message);
});
