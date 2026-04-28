// Simple script to request client console logs using HTTP
const http = require('http');

console.log('Requesting client console logs from game server...');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/request-logs',
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('\n=== CLIENT CONSOLE LOGS ===');
        try {
            const logs = JSON.parse(data);
            console.log(logs);
        } catch (e) {
            console.log('Raw response:', data);
        }
        console.log('=== END LOGS ===\n');
    });
});

req.on('error', (error) => {
    console.error('Error requesting logs:', error.message);
    console.log('Make sure game server is running and has /request-logs endpoint');
});

req.end();
