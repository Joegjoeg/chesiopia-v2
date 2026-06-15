// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3000';
const GAME_BOOT_TIMEOUT = 45_000;

// ── helpers ──────────────────────────────────────────────────────────────────

async function waitForGameBoot(page, timeout = GAME_BOOT_TIMEOUT) {
    await page.waitForFunction(
        () => !!(window.game && window.game.isInitialized && window.game.ecsWorld),
        { timeout }
    );
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('ECS Integration', () => {

    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    });

    test('player ship is spawned on boot', async ({ page }) => {
        await waitForGameBoot(page);

        const playerShipExists = await page.evaluate(() => {
            const g = window.game;
            if (!g || !g.ecsWorld) return false;
            return g.ecsWorld.pool.isAlive(g.playerShipId);
        });

        expect(playerShipExists, 'Player ship should exist in gameplay pool').toBe(true);
    });

    test('ship has expected components', async ({ page }) => {
        await waitForGameBoot(page);

        const components = await page.evaluate(() => {
            const g = window.game;
            const id = g.playerShipId;
            return {
                position: g.ecsWorld.pool.hasComponent(id, 'position'),
                velocity: g.ecsWorld.pool.hasComponent(id, 'velocity'),
                rotation: g.ecsWorld.pool.hasComponent(id, 'rotation'),
                sail: g.ecsWorld.pool.hasComponent(id, 'sail'),
                hull: g.ecsWorld.pool.hasComponent(id, 'hull'),
                cannon: g.ecsWorld.pool.hasComponent(id, 'cannon'),
                playerInput: g.ecsWorld.pool.hasComponent(id, 'playerInput')
            };
        });

        expect(components.position).toBe(true);
        expect(components.velocity).toBe(true);
        expect(components.rotation).toBe(true);
        expect(components.sail).toBe(true);
        expect(components.hull).toBe(true);
        expect(components.cannon).toBe(true);
        expect(components.playerInput).toBe(true);
    });

    test('ship visual handle is created', async ({ page }) => {
        await waitForGameBoot(page);

        const visual = await page.evaluate(() => {
            const g = window.game;
            const handle = g.ecsWorld.getVisualHandle(g.playerShipId);
            const mesh = g.ecsWorld.visualPool.getMesh(handle);
            return { handleDefined: handle !== undefined, meshExists: !!mesh };
        });

        expect(visual.handleDefined).toBe(true);
        expect(visual.meshExists).toBe(true);
    });

    test('cannonball spawns and despawns by TTL', async ({ page }) => {
        await waitForGameBoot(page);

        const results = await page.evaluate(async () => {
            const g = window.game;
            const world = g.ecsWorld;
            const before = world.getEntities('cannonball').length;

            // Simulate firing via input system keys
            const shipId = g.playerShipId;
            g.inputSystem.keys['Space'] = true;

            // Run a few ticks to process combat system
            for (let i = 0; i < 5; i++) world.tick(0.016);
            g.inputSystem.keys['Space'] = false;

            const afterFire = world.getEntities('cannonball').length;

            // Run ticks until TTL expiry (cannonball ttl = 10s, so fast-forward)
            for (let i = 0; i < 700; i++) world.tick(0.016);

            const afterTTL = world.getEntities('cannonball').length;

            return { before, afterFire, afterTTL };
        });

        expect(results.afterFire).toBeGreaterThan(results.before);
        expect(results.afterTTL).toBe(0);
    });

    test('keyboard events are captured by InputSystem', async ({ page }) => {
        await waitForGameBoot(page);

        const result = await page.evaluate(() => {
            const g = window.game;
            const inputSystem = g.inputSystem;

            // Ensure bound
            inputSystem.bind();

            // Dispatch keydown on the canvas (most likely target)
            const canvas = document.getElementById('gameCanvas');
            canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
            
            // Also try window and document
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));

            return {
                keyW: inputSystem.keys['KeyW'],
                bound: inputSystem._bound
            };
        });

        expect(result.keyW, 'KeyW should be true after dispatching keydown').toBe(true);
    });

    test('ship moves with real keyboard events', async ({ page }) => {
        await waitForGameBoot(page);

        // Click the canvas first to ensure focus
        await page.click('#gameCanvas');

        const moved = await page.evaluate(() => {
            const g = window.game;
            const world = g.ecsWorld;
            const id = g.playerShipId;
            const startPos = world.pool.getPosition(id);
            return { x: startPos.x, z: startPos.z };
        });

        // Simulate holding W via keyboard
        await page.keyboard.down('KeyW');
        
        // Wait for some ticks to process
        await page.waitForTimeout(2000);
        
        await page.keyboard.up('KeyW');

        const endPos = await page.evaluate(() => {
            const g = window.game;
            const world = g.ecsWorld;
            const id = g.playerShipId;
            const pos = world.pool.getPosition(id);
            return { x: pos.x, z: pos.z };
        });

        const dx = endPos.x - moved.x;
        const dz = endPos.z - moved.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        expect(dist, `Ship should move with real keyboard, dist=${dist}`).toBeGreaterThan(0.05);
    });

    test('naval telegraph keys set correct throttle', async ({ page }) => {
        await waitForGameBoot(page);

        const results = await page.evaluate(() => {
            const g = window.game;
            const world = g.ecsWorld;
            const id = g.playerShipId;
            const inputSystem = g.inputSystem;
            inputSystem.bind();

            const gearChecks = [
                { key: 'Digit1', expected: 0.20, name: 'Dead Slow Ahead' },
                { key: 'Digit2', expected: 0.35, name: 'Slow Ahead' },
                { key: 'Digit3', expected: 0.50, name: 'Standard Ahead' },
                { key: 'Digit4', expected: 0.75, name: 'Full Ahead' },
                { key: 'Digit5', expected: 1.00, name: 'Ahead Flank' },
                { key: 'Digit6', expected: -0.50, name: 'Astern' },
                { key: 'Digit7', expected: -0.80, name: 'Emergency Astern' },
                { key: 'Digit8', expected: 0.00, name: 'Stop Engine' }
            ];

            const outcomes = [];
            for (const check of gearChecks) {
                // Clear all keys first
                inputSystem.keys = {};
                // Press the target key
                inputSystem.keys[check.key] = true;
                // Tick so InputSystem writes to the component
                world.tick(0.016);
                const input = world.pool.getComponent(id, 'playerInput');
                const ok = Math.abs(input.throttle - check.expected) < 0.01;
                outcomes.push({ key: check.key, name: check.name, expected: check.expected, got: input.throttle, ok });
            }
            return outcomes;
        });

        for (const r of results) {
            expect(r.ok, `${r.name} (${r.key}): expected ${r.expected}, got ${r.got}`).toBe(true);
        }
    });

    test('bridge panel toggles with backtick and applies rudder commands', async ({ page }) => {
        await waitForGameBoot(page);
        await page.click('#gameCanvas');

        // Panel should be hidden initially
        let panelVisible = await page.evaluate(() => {
            const p = document.getElementById('bridgePanel');
            return p && p.style.display !== 'none';
        });
        expect(panelVisible).toBe(false);

        // Toggle open with backtick
        await page.keyboard.press('Backquote');
        panelVisible = await page.evaluate(() => {
            const p = document.getElementById('bridgePanel');
            return p && p.style.display !== 'none';
        });
        expect(panelVisible, 'Bridge panel should open on backtick').toBe(true);

        // Click "Steady As She Goes" and verify targetHeading is set
        await page.click('button[data-cmd="steady"]');
        const steadyState = await page.evaluate(() => {
            const g = window.game;
            const input = g.ecsWorld.pool.getComponent(g.playerShipId, 'playerInput');
            return { targetHeading: input.targetHeading, rudder: input.rudder };
        });
        expect(steadyState.targetHeading).not.toBeNull();
        expect(steadyState.rudder).toBe(0);

        // Click "Rudder Amidships" and verify targetHeading is cleared
        await page.click('button[data-cmd="amidships"]');
        const amidState = await page.evaluate(() => {
            const g = window.game;
            const input = g.ecsWorld.pool.getComponent(g.playerShipId, 'playerInput');
            return { targetHeading: input.targetHeading, rudder: input.rudder };
        });
        expect(amidState.targetHeading).toBeNull();
        expect(amidState.rudder).toBe(0);

        // Click "Hard Starboard" and verify rudder
        await page.click('button[data-cmd="hardStarboard"]');
        const hardState = await page.evaluate(() => {
            const g = window.game;
            const input = g.ecsWorld.pool.getComponent(g.playerShipId, 'playerInput');
            return input.rudder;
        });
        expect(hardState).toBe(1.0);

        // Toggle closed
        await page.keyboard.press('Backquote');
        panelVisible = await page.evaluate(() => {
            const p = document.getElementById('bridgePanel');
            return p && p.style.display !== 'none';
        });
        expect(panelVisible).toBe(false);
    });

    test('ECS tick runs without error for 60 frames', async ({ page }) => {
        await waitForGameBoot(page);

        const errors = await page.evaluate(() => {
            const errs = [];
            const origErr = console.error;
            console.error = (...args) => { errs.push(args.join(' ')); origErr.apply(console, args); };
            const g = window.game;
            for (let i = 0; i < 60; i++) g.ecsWorld.tick(0.016);
            console.error = origErr;
            return errs.filter(e => e.includes('ECS') || e.includes('GameplayPool') || e.includes('VisualPool'));
        });

        expect(errors, `ECS errors: ${errors.join(', ')}`).toHaveLength(0);
    });
});
