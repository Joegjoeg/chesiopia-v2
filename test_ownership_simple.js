const io = require('socket.io-client');

const SERVER = 'http://localhost:3000';

async function test() {
    console.log('[Test] Connecting client...');
    const client = io(SERVER, { transports: ['websocket'], forceNew: true });
    
    await new Promise(r => setTimeout(r, 500));
    
    // Try to move a non-existent piece (should fail with "Piece not found")
    let result1 = null;
    client.on('moveInvalid', (data) => { result1 = data; });
    
    client.emit('movePiece', { pieceId: 99999, fromX: 0, fromZ: 0, toX: 1, toZ: 0 });
    await new Promise(r => setTimeout(r, 500));
    console.log('[Test] Non-existent piece move:', result1?.reason || 'NO RESPONSE');
    
    // Now connect a second client, spawn pieces, then try cross-player move
    const client2 = io(SERVER, { transports: ['websocket'], forceNew: true });
    await new Promise(r => setTimeout(r, 500));
    
    client.emit('requestInitialArmy');
    client2.emit('requestInitialArmy');
    await new Promise(r => setTimeout(r, 2000));
    
    // Get fresh game state
    let state = null;
    client.on('gameState', (data) => { state = data; });
    client.emit('requestGameState'); // if this event exists
    await new Promise(r => setTimeout(r, 500));
    
    console.log('[Test] Client1 pieces:', state?.pieces?.filter(p => p.playerId === client.id).length || 0);
    console.log('[Test] Client2 pieces:', state?.pieces?.filter(p => p.playerId === client2.id).length || 0);
    
    if (state?.pieces?.length >= 2) {
        const enemyPiece = state.pieces.find(p => p.playerId === client2.id);
        if (enemyPiece) {
            let result2 = null;
            const oldHandler = client._callbacks?.['$moveInvalid'];
            client.on('moveInvalid', (data) => { result2 = data; });
            
            client.emit('movePiece', {
                pieceId: enemyPiece.id,
                fromX: enemyPiece.x,
                fromZ: enemyPiece.z,
                toX: enemyPiece.x + 1,
                toZ: enemyPiece.z
            });
            await new Promise(r => setTimeout(r, 500));
            console.log('[Test] Enemy piece move result:', result2?.reason || 'NO RESPONSE/ACCEPTED');
            
            if (result2?.reason === 'Not your piece') {
                console.log('[Test] ✅ Ownership enforcement confirmed working');
            } else {
                console.log('[Test] ⚠️ Unexpected result (may need manual verification)');
            }
        }
    }
    
    client.close();
    client2.close();
    console.log('[Test] Done');
}

test().catch(console.error);
