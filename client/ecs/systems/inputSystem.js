// Input System — reads keyboard state and writes to playerInput component
class InputSystem {
    constructor() {
        this.keys = {};
        this._bound = false;
    }

    bind() {
        if (this._bound) return;
        this._bound = true;
        const onDown = (e) => { this.keys[e.code] = true; };
        const onUp = (e) => { this.keys[e.code] = false; };
        // Capture phase on every possible target to ensure we get events
        const opts = { capture: true };
        for (const target of [window, document, document.documentElement, document.body]) {
            if (target) {
                target.addEventListener('keydown', onDown, opts);
                target.addEventListener('keyup', onUp, opts);
            }
        }
    }

    update(dt, world) {
        if (!this._bound) this.bind();

        const ships = world.getEntities('ship');
        for (const entityId of ships) {
            const input = world.pool.getComponent(entityId, 'playerInput');
            if (!input) continue;

            // Naval telegraph speed settings (1-8); W/S override for direct control
            const gearMap = {
                'Digit1': 0.20, 'Numpad1': 0.20,   // Dead Slow Ahead
                'Digit2': 0.35, 'Numpad2': 0.35,   // Slow Ahead
                'Digit3': 0.50, 'Numpad3': 0.50,   // Standard Ahead
                'Digit4': 0.75, 'Numpad4': 0.75,   // Full Ahead
                'Digit5': 1.00, 'Numpad5': 1.00,   // Ahead Flank
                'Digit6': -0.50, 'Numpad6': -0.50, // Astern
                'Digit7': -0.80, 'Numpad7': -0.80, // Emergency Astern
                'Digit8': 0.00, 'Numpad8': 0.00    // Stop Engine
            };
            for (const [code, throttleVal] of Object.entries(gearMap)) {
                if (this.keys[code]) { input.throttle = throttleVal; break; }
            }

            // W/S direct override
            if (this.keys['KeyW'] || this.keys['ArrowUp']) {
                input.throttle = 1;
            }
            if (this.keys['KeyS'] || this.keys['ArrowDown']) {
                input.throttle = -0.5;
            }

            input.fireRequested = false;
            if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
                input.rudder = 1;
                input.rudderLock = false; // keyboard overrides bridge
                input.targetHeading = null; // manual override cancels steady mode
            } else if (this.keys['KeyD'] || this.keys['ArrowRight']) {
                input.rudder = -1;
                input.rudderLock = false;
                input.targetHeading = null;
            } else if (!input.rudderLock) {
                input.rudder = 0; // only zero if no bridge command is locked
            }
            if (this.keys['Space']) {
                input.fireRequested = true;
            }
        }
    }
}

window.InputSystem = InputSystem;
