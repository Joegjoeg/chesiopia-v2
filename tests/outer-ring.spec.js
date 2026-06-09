// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3000';
const GAME_BOOT_TIMEOUT = 45_000;  // ms to wait for full terrain load
const POLL_INTERVAL    = 500;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Wait until window.boardSystem?.terrainOuterRing is non-null */
async function waitForOuterRing(page, timeout = GAME_BOOT_TIMEOUT) {
    await page.waitForFunction(
        () => !!(window.boardSystem?.terrainOuterRing),
        { timeout }
    );
}

/** Run the in-browser OUTER_RING validation suite and return results */
async function getOuterRingResults(page) {
    return page.evaluate(() => {
        const v = new window.ChessopiaValidator();
        v.testOuterRingVisibility();
        return v.results.filter(r => r.category === 'OUTER_RING');
    });
}

/** Move the camera by nudging boardSystem's camera position and waiting a tick */
async function nudgeCamera(page, dx, dz) {
    await page.evaluate(({ dx, dz }) => {
        const cam = window.boardSystem?.game?.cameraController?.camera;
        if (cam) { cam.position.x += dx; cam.position.z += dz; }
    }, { dx, dz });
    await page.waitForTimeout(300);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Terrain Outer Ring', () => {

    test.beforeEach(async ({ page }) => {
        // Suppress unrelated console noise but capture errors
        page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    });

    // ── 1. Ring appears after boot ───────────────────────────────────────────
    test('outer ring is created on high/medium tier device', async ({ page }) => {
        await waitForOuterRing(page);

        const results = await getOuterRingResults(page);
        const failures = results.filter(r => !r.passed);

        if (failures.length) {
            console.log('\nFailed OUTER_RING checks:');
            failures.forEach(r => console.log(`  FAIL: ${r.test} — ${r.details}`));
        }

        expect(failures, `${failures.length} OUTER_RING checks failed`).toHaveLength(0);
    });

    // ── 2. Ring stays alive during camera movement ───────────────────────────
    test('outer ring survives camera movement (does not disappear)', async ({ page }) => {
        await waitForOuterRing(page);

        // Sample ring existence over several camera nudges
        const snapshots = [];
        for (let i = 0; i < 8; i++) {
            await nudgeCamera(page, 20, 0);
            const exists = await page.evaluate(() => !!window.boardSystem?.terrainOuterRing);
            const opacity = await page.evaluate(() =>
                window.boardSystem?.terrainOuterRing?.material?.uniforms?.uTerrainOpacity?.value ?? -1
            );
            snapshots.push({ step: i, exists, opacity });
        }

        console.log('Ring snapshots during movement:', snapshots);

        const disappearedSteps = snapshots.filter(s => !s.exists);
        expect(disappearedSteps, `Ring disappeared at steps: ${disappearedSteps.map(s=>s.step).join(',')}`).toHaveLength(0);

        const invisibleSteps = snapshots.filter(s => s.opacity < 0.5);
        expect(invisibleSteps, `Ring went transparent at steps: ${invisibleSteps.map(s=>s.step).join(',')}`).toHaveLength(0);
    });

    // ── 3. Ring is not destroyed when FPS drops (quality level) ─────────────
    test('ring persists when performance quality drops to 1', async ({ page }) => {
        await waitForOuterRing(page);

        // Force quality to 1 (should NOT destroy the ring — only quality 0 does)
        await page.evaluate(() => {
            window.game?.performanceManager?.forceQualityLevel?.(1);
        });
        await page.waitForTimeout(1000);

        const exists = await page.evaluate(() => !!window.boardSystem?.terrainOuterRing);
        expect(exists, 'Ring should survive quality level 1').toBe(true);
    });

    // ── 4. Ring is destroyed at quality 0 and recreated when quality recovers ─
    test('ring is destroyed at quality 0 and recreates when quality recovers', async ({ page }) => {
        await waitForOuterRing(page);

        // Drop to emergency quality
        await page.evaluate(() => window.game?.performanceManager?.forceQualityLevel?.(0));
        await page.waitForTimeout(6_000); // > hysteresisMs (5000)

        const existsAt0 = await page.evaluate(() => !!window.boardSystem?.terrainOuterRing);
        expect(existsAt0, 'Ring should be absent at quality 0').toBe(false);

        // Recover quality
        await page.evaluate(() => window.game?.performanceManager?.forceQualityLevel?.(2));
        await page.waitForTimeout(6_000);

        const existsAfterRecovery = await page.evaluate(() => !!window.boardSystem?.terrainOuterRing);
        expect(existsAfterRecovery, 'Ring should recreate after quality recovery').toBe(true);
    });

    // ── 5. Ring heights are non-zero after terrain chunks load ───────────────
    test('ring vertices have real terrain heights (not all zero)', async ({ page }) => {
        await waitForOuterRing(page);

        // Wait for at least one chunk-loaded resample cycle
        await page.waitForFunction(() => {
            const ring = window.boardSystem?.terrainOuterRing;
            if (!ring) return false;
            const pos = ring.meshes?.[0]?.geometry?.attributes?.position?.array;
            if (!pos) return false;
            for (let i = 1; i < pos.length; i += 3) {
                if (Math.abs(pos[i]) > 0.1) return true;
            }
            return false;
        }, { timeout: GAME_BOOT_TIMEOUT });

        const maxH = await page.evaluate(() => {
            const ring = window.boardSystem?.terrainOuterRing;
            const pos = ring?.meshes?.[0]?.geometry?.attributes?.position?.array;
            if (!pos) return 0;
            let max = 0;
            for (let i = 1; i < pos.length; i += 3) max = Math.max(max, Math.abs(pos[i]));
            return max;
        });

        expect(maxH, 'Max vertex height should be > 0.1').toBeGreaterThan(0.1);
    });

    // ── 6. uFadeEnabled must stay 0 at all times ─────────────────────────────
    test('uFadeEnabled stays 0 on outer ring material', async ({ page }) => {
        await waitForOuterRing(page);

        // Check immediately and after a few frames
        for (let i = 0; i < 5; i++) {
            await page.waitForTimeout(200);
            const fadeEnabled = await page.evaluate(() =>
                window.boardSystem?.terrainOuterRing?.material?.uniforms?.uFadeEnabled?.value
            );
            expect(fadeEnabled, `uFadeEnabled should be 0 at frame ${i}`).toBe(0);
        }
    });
});
