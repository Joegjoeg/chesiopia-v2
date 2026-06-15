// ECS Unit Tests — run in browser console or standalone
// Usage: load this script after ecs/*.js, then call runECSUnitTests()

(function() {
    'use strict';

    const results = [];

    function assert(condition, message) {
        if (!condition) throw new Error(message || 'Assertion failed');
    }

    function test(name, fn) {
        try {
            fn();
            results.push({ name, passed: true });
            console.log(`  PASS: ${name}`);
        } catch (e) {
            results.push({ name, passed: false, error: e.message });
            console.error(`  FAIL: ${name} — ${e.message}`);
        }
    }

    function runTests() {
        results.length = 0;
        console.log('[ECS Unit Tests] Starting...');

        // ── ComponentRegistry ──
        test('registry registers component with schema', () => {
            const r = new ComponentRegistry();
            r.register('health', { current: 'float', max: 'float' });
            assert(r.has('health'), 'has health');
            assert(r.getBit('health') === 1, 'bit is 1');
        });

        test('registry assigns unique bits', () => {
            const r = new ComponentRegistry();
            r.register('a', {});
            r.register('b', {});
            assert(r.getBit('a') !== r.getBit('b'), 'bits differ');
        });

        test('registry validate passes correct data', () => {
            const r = new ComponentRegistry();
            r.register('health', { current: 'float', max: 'float' });
            assert(r.validate('health', { current: 50, max: 100 }), 'valid data');
        });

        test('registry validate fails wrong type', () => {
            const r = new ComponentRegistry();
            r.register('health', { current: 'float' });
            assert(!r.validate('health', { current: 'bad' }), 'invalid data');
        });

        // ── GameplayPool ──
        test('pool create returns valid id', () => {
            const p = new GameplayPool(4);
            const id = p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            assert(id >= 0 && id < 4, 'id in range');
            assert(p.isAlive(id), 'is alive');
        });

        test('pool destroy frees slot', () => {
            const p = new GameplayPool(4);
            const id = p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            assert(p.destroy(id), 'destroy succeeded');
            assert(!p.isAlive(id), 'not alive after destroy');
        });

        test('pool reuse freed slot', () => {
            const p = new GameplayPool(4);
            const id1 = p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            p.destroy(id1);
            const id2 = p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            assert(id1 === id2, 'slot reused');
        });

        test('pool enforces max capacity', () => {
            const p = new GameplayPool(2);
            p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            const id3 = p.create({ name: 'test', components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            assert(id3 === -1, 'max capacity reached');
        });

        test('pool position get/set', () => {
            const p = new GameplayPool(4);
            const id = p.create({ name: 'test', components: { position: { x: 1, y: 2, z: 3 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            const pos = p.getPosition(id);
            assert(pos.x === 1 && pos.y === 2 && pos.z === 3, 'initial position');
            p.setPosition(id, 10, 20, 30);
            const pos2 = p.getPosition(id);
            assert(pos2.x === 10 && pos2.y === 20 && pos2.z === 30, 'updated position');
        });

        test('pool cold component get/set', () => {
            const p = new GameplayPool(4);
            const id = p.create({
                name: 'test',
                components: {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { vx: 0, vy: 0, vz: 0 },
                    rotation: { heading: 0 },
                    hull: { maxHealth: 100, currentHealth: 100 }
                }
            });
            const hull = p.getComponent(id, 'hull');
            assert(hull && hull.maxHealth === 100, 'cold component retrieved');
            p.setComponent(id, 'hull', { maxHealth: 200, currentHealth: 200 });
            const hull2 = p.getComponent(id, 'hull');
            assert(hull2.maxHealth === 200, 'cold component updated');
        });

        test('pool hasComponent works', () => {
            const p = new GameplayPool(4);
            const id = p.create({
                name: 'test',
                components: {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { vx: 0, vy: 0, vz: 0 },
                    rotation: { heading: 0 },
                    sail: { maxSpeed: 8 }
                }
            });
            assert(p.hasComponent(id, 'position'), 'has position');
            assert(p.hasComponent(id, 'sail'), 'has sail');
            assert(!p.hasComponent(id, 'hull'), 'no hull');
        });

        // ── ECSWorld ──
        test('world spawn assigns archetype group', () => {
            const scene = new THREE.Scene();
            const w = new ECSWorld(scene, 8);
            w.registerArchetype({ name: 'test', poolCap: 4, components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            const id = w.spawn('test');
            assert(id >= 0, 'spawned');
            const group = w.getEntities('test');
            assert(group.length === 1 && group[0] === id, 'in archetype group');
        });

        test('world despawn removes from group', () => {
            const scene = new THREE.Scene();
            const w = new ECSWorld(scene, 8);
            w.registerArchetype({ name: 'test', poolCap: 4, components: { position: { x: 0, y: 0, z: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, rotation: { heading: 0 } } });
            const id = w.spawn('test');
            w.despawn(id);
            assert(w.getEntities('test').length === 0, 'group empty');
        });

        test('world system execution order', () => {
            const scene = new THREE.Scene();
            const w = new ECSWorld(scene, 8);
            const order = [];
            w.registerSystem('b', [], () => order.push('b'), { priority: 2 });
            w.registerSystem('a', [], () => order.push('a'), { priority: 1 });
            w.tick(0.016);
            assert(order[0] === 'a' && order[1] === 'b', 'priority order respected');
        });

        test('world getEntitiesWithComponents filters correctly', () => {
            const scene = new THREE.Scene();
            const w = new ECSWorld(scene, 8);
            w.registerArchetype({
                name: 'ship',
                poolCap: 4,
                components: {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { vx: 0, vy: 0, vz: 0 },
                    rotation: { heading: 0 },
                    sail: { maxSpeed: 8 }
                }
            });
            w.registerArchetype({
                name: 'rock',
                poolCap: 4,
                components: {
                    position: { x: 0, y: 0, z: 0 },
                    velocity: { vx: 0, vy: 0, vz: 0 },
                    rotation: { heading: 0 }
                }
            });
            w.spawn('ship');
            w.spawn('rock');
            const withSail = w.getEntitiesWithComponents(['sail']);
            assert(withSail.length === 1, 'only ship has sail');
        });

        // ── Summary ──
        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;
        console.log(`\n[ECS Unit Tests] ${passed} passed, ${failed} failed of ${results.length} total`);
        return { passed, failed, total: results.length, results };
    }

    window.runECSUnitTests = runTests;
    console.log('[ECS Unit Tests] Loaded. Call runECSUnitTests() to execute.');
})();
