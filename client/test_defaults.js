/**
 * Console test for parameter-default persistence.
 * Paste this entire file into the browser console, or load it via
 *   <script src="test_defaults.js?v=1"></script>
 * Then run: testDefaults()
 */
window.testDefaults = async function() {
    console.log('=== testDefaults() start ===');

    // 1. Check if the endpoint exists
    console.log('[Test] 1. Checking GET /api/defaults ...');
    const getRes = await fetch('/api/defaults');
    console.log(`[Test] GET status: ${getRes.status}, ok: ${getRes.ok}`);
    const getText = await getRes.text();
    let currentDefaults = {};
    try { currentDefaults = JSON.parse(getText); } catch (e) {}
    console.log('[Test] Current saved defaults:', currentDefaults);

    // 2. Check if ParameterSystem loaded anything
    const ps = window.parameterSystem;
    console.log('[Test] 2. ParameterSystem exists:', !!ps);
    if (ps) {
        console.log('[Test] ParameterSystem params count:', ps.params ? ps.params.size : 'N/A');
    }

    // 3. POST a dummy test default
    console.log('[Test] 3. POSTing dummy test parameter ...');
    const dummy = { testDummyParam: 42 };
    const postRes = await fetch('/api/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dummy)
    });
    console.log(`[Test] POST status: ${postRes.status}, ok: ${postRes.ok}`);
    const postText = await postRes.text();
    console.log('[Test] POST response body:', postText);

    // 4. Verify it was written by reading again
    console.log('[Test] 4. Re-reading to verify write ...');
    const getRes2 = await fetch('/api/defaults');
    const getText2 = await getRes2.text();
    let afterWrite = {};
    try { afterWrite = JSON.parse(getText2); } catch (e) {}
    console.log('[Test] Defaults after POST:', afterWrite);

    if (afterWrite.testDummyParam === 42) {
        console.log('%c[Test] WRITE + READ cycle PASSED', 'color: #0f0');
    } else {
        console.log('%c[Test] WRITE + READ cycle FAILED', 'color: #f00');
    }

    // 5. Cleanup dummy
    console.log('[Test] 5. Cleaning up dummy ...');
    const delRes = await fetch('/api/defaults', { method: 'DELETE' });
    console.log(`[Test] DELETE status: ${delRes.status}`);

    console.log('=== testDefaults() end ===');
};

console.log('[test_defaults.js] Loaded. Run testDefaults() in console to test persistence.');
