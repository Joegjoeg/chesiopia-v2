// Simple script to trigger console logs by connecting to stdin
const { spawn } = require('child_process');

// Start the server process and send 'c' to stdin
const server = spawn('node', ['server.js'], {
    stdio: ['pipe', 'inherit', 'inherit']
});

// Send 'c' to trigger console logs
setTimeout(() => {
    server.stdin.write('c\n');
    server.stdin.end();
}, 1000);

server.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
});
