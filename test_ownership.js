const io = require('socket.io-client');

const SERVER = 'http://localhost:3000';

async function testOwnership() {
    console.log('[Test] Connecting two clients...');
    
    const client1 = io(SERVER, { transports: ['websocket'], forceNew: true });
    const client2 = io(SERVER, { transports: ['websocket'], forceNew: true });
    
    await new Promise(r => setTimeout(r, 500));
    
    // Wait for game states
    let state1 = null;
    let state2 = null;
    
    client1.on('gameState', (data) => { state1 = data; });
    client2.on('gameState', (data) => { state2 = data; });
    
    // Request initial armies
    client1.emit('requestInitialArmy');
    client2.emit('requestInitialArmy');
    
    // Wait for state to propagate
    await new Promise(r => setTimeout(r, 3000));
    
    console.log('[Test] Client 1 pieces:', state1?.pieces?.length || 0);
    console.log('[Test] Client 2 pieces:', state2?.pieces?.length || 0);
    
    if (!state1?.pieces?.length || !state2?.pieces?.length) {
        console.log('[Test] Not enough pieces spawned, aborting');
        client1.close();
        client2.close();
        return;
    }
    
    // Try moving client2's piece with client1
    const enemyPiece = state2.pieces[0];
    const myPiece = state1.pieces[0];
    
    console.log('[Test] Client1 ID:', client1.id);
    console.log('[Test] Client2 ID:', client2.id);
    console.log('[Test] My piece:', myPiece.id, 'owner:', myPiece.playerId);
    console.log('[Test] Enemy piece:', enemyPiece.id, 'owner:', enemyPiece.playerId);
    
    // Try to move enemy piece (should fail)
    let moveInvalidReceived = false;
    client1.on('moveInvalid', (data) => {
        console.log('[Test] Client1 received moveInvalid:', data.reason);
        moveInvalidReceived = true;
    });
    
    client1.emit('movePiece', {
        pieceId: enemyPiece.id,
        fromX: enemyPiece.x,
        fromZ: enemyPiece.z,
        toX: enemyPiece.x + 1,
        toZ: enemyPiece.z
    });
    
    await new Promise(r => setTimeout(r, 500));
    
    if (moveInvalidReceived) {
        console.log('[Test] ✅ Ownership enforcement works! Cannot move enemy pieces.');
    } else {
        console.log('[Test] ❌ Ownership enforcement failed! Enemy piece move was accepted.');
    }
    
    client1.close();
    client2.close();
    console.log('[Test] Done.');
}

testOwnership().catch(err => {
    console.error('[Test] Error:', err);
    process.exit(1);
});
