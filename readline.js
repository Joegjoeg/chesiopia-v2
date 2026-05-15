const fs = require('fs');
const line = fs.readFileSync('d:\\Chesiopia v2\\client\\board_clean.js', 'utf8').split('\n')[1260];
// Write first 1500 chars to one file and last 1200 chars to another
fs.writeFileSync('d:\\Chesiopia v2\\line_start.txt', line.substring(0, 1500));
fs.writeFileSync('d:\\Chesiopia v2\\line_end.txt', line.substring(line.length - 1200));
console.log('Line length:', line.length);
