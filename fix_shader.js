const fs = require('fs');
const path = 'd:\\Chesiopia v2\\client\\board_clean.js';
let content = fs.readFileSync(path, 'utf8');

// Find the vertex shader injection ending - look for the gust calculation and add vWindOffset after it
const marker = "+ sin(phase * 4.5 - t * 2.2) * 0.35";
const idx = content.indexOf(marker);
if (idx === -1) {
    console.log('Marker not found');
    process.exit(1);
}

// Find the closing backtick after this marker (should be within the same line/template literal)
const closeTick = content.indexOf('`', idx + marker.length);
if (closeTick === -1) {
    console.log('Closing backtick not found');
    process.exit(1);
}

// Insert vWindOffset assignment before the closing backtick
const before = content.substring(0, closeTick);
const after = content.substring(closeTick);
const newContent = before + '\n    vWindOffset = wind * gust * amp * 2.0;' + after;

fs.writeFileSync(path, newContent);
console.log('Fixed! Inserted vWindOffset assignment before backtick at position', closeTick);
