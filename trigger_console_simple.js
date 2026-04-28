const net = require('net');

const client = net.createConnection({ host: 'localhost', port: 3000 }, () => {
    console.log('Connected to server, sending console request...');
    client.write('c\n');
});

client.on('data', (data) => {
    console.log('Server response:', data.toString());
    client.end();
});

client.on('end', () => {
    console.log('Disconnected from server');
});

client.on('error', (err) => {
    console.error('Connection error:', err.message);
});
