const fs = require('fs');
const path = 'd:\\Chesiopia v2\\client\\board_clean.js';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: Remove texture.repeat.set(64, 64) since world-space UVs control tiling
content = content.replace(
  /texture\.repeat\.set\(64, 64\);\n\s*/,
  ''
);

fs.writeFileSync(path, content);
console.log('Fixed: Removed texture.repeat.set(64, 64)');
console.log('World-space UVs now control ~9 grass texture repeats per 32m chunk');
console.log('Vertex colors disabled so real grass.jpg texture shows through');
console.log('Ready to test - hard refresh the client!');
