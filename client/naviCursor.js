(function () {
    const INTERACTIVE_SELECTORS = [
        'button',
        'a[href]',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '.clickable',
        '.dev-btn',
        '.buy-btn',
        '.minimap-btn'
    ].join(',');

    class NaviCursor {
        constructor() {
            this._debug = false; // Set true for verbose drowning/cursor logs
            this.cursorEl = document.getElementById('naviCursor');
            this.trailEl = this.cursorEl?.querySelector('.navi-cursor-trail');
            this.active = false;
            this.interactive = false;
            this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            this.rendered = { ...this.pointer };
            this.velocity = { x: 0, y: 0 };
            this.visible = false;
            this.raf = null;
            this.rotation = 0;

            // Distance-based scaling
            this.distanceScaleEnabled = true;
            this.distanceNear = 5;
            this.distanceFar = 80;
            this.distanceMinScale = 0.3;
            this.baseSize = 42;
            this.currentDistanceScale = 1.0;
            this._paramListenerCleanup = null;
            this._parameterPollHandle = null;
            this._lastLoggedOrbit = null;
            this._lastLoggedDist = null;

            // Trail & speed size tuning
            this.trailScaleX = 1.25;
            this.trailScaleY = 0.7;
            this.trailOpacityMult = 1.0;
            this.speedSizeBase = 0.8;
            this.speedSizeMult = this.speedSizeBase;
            this.speedSizeOverrideActive = false;

            // Wing sonic-boom tuning
            this.wingSpeedScaleEnabled = true;
            this.wingScaleMult = 1.5;
            this.wingOpacityMult = 1.0;

            // Left-click grab-to-pan state
            this.isGrabbing = false;
            this.grabScreenX = 0;
            this.grabScreenY = 0;
            this.grabTarget = null;
            this.grabWorldPoint = null;
            this.grabWorldY = 0;

            // Grab behavior tuning
            this.grabDisableSpeedScale = true;
            this.grabSlowFactor = 0.55;
            this.grabBuzzIntensity = 1.6;

            // Underwater movement tuning
            this.underwaterSpeed = 0.02;

            // Drowning animation state
            this.drowningState = 'idle'; // idle, submerging, underwater, emerging, flying_up, shaking, harumph
            this.drowningStartTime = 0;
            this.drowningWorldPos = null;
            this.drowningWaterLevel = -1.5;
            this._drowningOffsetX = 0;
            this._drowningOffsetY = 0;
            this._drowningScale = 1;

            // Fairy expressions of displeasure (no swearing!)
            this._fairyExpressions = [
                'harumph', 'humph', 'oh bother', 'tut tut', 'goodness me',
                'oh dear', 'for shame', 'fiddlesticks', 'pish posh', 'mercy me',
                'heavens', 'tsk tsk', 'well I never', 'gracious me', 'my word'
            ];
            this._harumphPlayed = false;
            this._submerged = false;
            this._nextCussTime = 0;
            this._underwaterCussCooldownMin = 2000;
            this._underwaterCussCooldownMax = 5500;
            this._skipEmergingSplash = false;

            // Idle local-space hover / spherical flight (state machine)
            this.idleRadius = 18;        // max orbit radius (px)
            this.idleSpeed = 1.0;        // base speed multiplier
            this.lastMouseMoveTime = performance.now();
            this.currentIdleRadius = 0;
            this.idleTime = 0;

            // Idle behavior state machine
            this.idleState = 'inactive'; // inactive, wandering, orbiting, flutter, peek, bob
            this.idleLocalPos = { x: 0, y: 0, z: 0 };
            this.idleTargetPos = { x: 0, y: 0, z: 0 };
            this.idleOrbitCenter = { x: 0, y: 0, z: 0 };
            this.idleOrbitRadius = 0;
            this.idleOrbitAngle = 0;
            this.idleOrbitSpeed = 1;
            this.idleOrbitAxis = 'z';
            this.idleTravelSpeed = 1.0;
            this.idleStateStartTime = 0;
            this.idleStateDuration = 0;
            this.idleBasePos = { x: 0, y: 0, z: 0 };
            this.idleRotation = 0;

            if (!this.cursorEl || !document.body) {
                console.warn('[NaviCursor] Missing container element or document body.');
                return;
            }

            this.setBaseSize(this.baseSize);
            this.bindEvents();
            this.updateLoop();
            this.setupParameterListeners();
        }

        setBaseSize(size) {
            this.baseSize = size;
            if (!this.cursorEl) return;
            this.cursorEl.style.width = `${size}px`;
            this.cursorEl.style.height = `${size}px`;
            this.cursorEl.style.marginLeft = `${-size / 2}px`;
            this.cursorEl.style.marginTop = `${-size / 2}px`;
        }

        setActive(active) {
            this.active = active;
            if (this.raf) {
                cancelAnimationFrame(this.raf);
                this.raf = null;
            }
            if (this.cursorEl) {
                this.cursorEl.style.display = active ? 'block' : 'none';
            }
            if (active && !this.raf) {
                this.updateLoop();
            }
        }

        setupParameterListeners() {
            const attach = () => {
                const ps = window.parameterSystem;
                if (!ps) return false;
                if (this._paramListenerCleanup) {
                    this._paramListenerCleanup();
                    this._paramListenerCleanup = null;
                }
                this._paramListenerCleanup = ps.onParameterChange((name, value) => {
                    if (name.startsWith('cursor')) {
                        this.applyParameter(name, value);
                    }
                });
                this.applyParameters();
                return true;
            };

            if (!attach()) {
                if (this._parameterPollHandle) {
                    clearInterval(this._parameterPollHandle);
                }
                this._parameterPollHandle = setInterval(() => {
                    if (attach()) {
                        clearInterval(this._parameterPollHandle);
                        this._parameterPollHandle = null;
                    }
                }, 250);
            }
        }

        applyParameters() {
            if (!window.parameterSystem) return;
            const params = window.parameterSystem.getParametersByCategory('cursor');
            for (const [name, param] of Object.entries(params)) {
                this.applyParameter(name, param.value);
            }
        }

        applyParameter(name, value) {
            const core = this.cursorEl?.querySelector('.navi-cursor-core');
            const wings = this.cursorEl?.querySelectorAll('.navi-cursor-wing');
            const trail = this.cursorEl?.querySelector('.navi-cursor-trail');

            switch (name) {
                case 'cursorEnabled':
                    if (value) {
                        document.body.classList.add('navi-cursor-active');
                    } else {
                        document.body.classList.remove('navi-cursor-active');
                    }
                    break;
                case 'cursorSize':
                    this.setBaseSize(value);
                    break;
                case 'cursorWingWidth':
                    wings.forEach(wing => wing.style.width = `${value}px`);
                    break;
                case 'cursorWingHeight':
                    wings.forEach(wing => wing.style.height = `${value}px`);
                    break;
                case 'cursorWingOffset':
                    wings.forEach(wing => wing.style.top = `${value}px`);
                    break;
                case 'cursorWingAngle':
                    this.cursorEl?.style.setProperty('--wing-angle', `${value}deg`);
                    break;
                case 'cursorCoreColorInner':
                    if (core) {
                        core.style.background = `radial-gradient(circle at 50% 50%, ${value} 0%, rgba(213, 255, 255, 0.95) 25%, rgba(146, 224, 255, 0.8) 55%, rgba(94, 178, 255, 0.45) 80%, rgba(94, 178, 255, 0) 100%)`;
                    }
                    break;
                case 'cursorCoreColorOuter':
                    if (core) {
                        core.style.boxShadow = `0 0 18px ${value}`;
                    }
                    break;
                case 'cursorWingColor':
                    wings.forEach(wing => {
                        wing.style.background = `radial-gradient(ellipse at 50% 15%, ${value}, ${value}00)`;
                    });
                    break;
                case 'cursorTrailColor':
                    if (trail) {
                        trail.style.background = `radial-gradient(ellipse at 100% 50%, ${value}, ${value}00)`;
                    }
                    break;
                case 'cursorGlowColor':
                    if (this.cursorEl) {
                        this.cursorEl.style.filter = `drop-shadow(0 0 8px ${value}cc) drop-shadow(0 0 20px ${value}99)`;
                    }
                    break;
                case 'cursorPulseSpeed':
                    if (core) {
                        core.style.animationDuration = `${value}s`;
                    }
                    break;
                case 'cursorDistanceScale':
                    this.distanceScaleEnabled = value;
                    break;
                case 'cursorDistanceNear':
                    this.distanceNear = value;
                    break;
                case 'cursorDistanceFar':
                    this.distanceFar = value;
                    break;
                case 'cursorDistanceMinScale':
                    this.distanceMinScale = value;
                    break;
                case 'cursorTrailScaleX':
                    this.trailScaleX = value;
                    break;
                case 'cursorTrailScaleY':
                    this.trailScaleY = value;
                    break;
                case 'cursorTrailOpacity':
                    this.trailOpacityMult = value;
                    break;
                case 'cursorSpeedSize':
                    this.speedSizeBase = value;
                    if (!this.speedSizeOverrideActive) {
                        this.speedSizeMult = value;
                    }
                    break;
                case 'cursorWingSpeedScale':
                    this.wingSpeedScaleEnabled = value;
                    break;
                case 'cursorWingScaleMult':
                    this.wingScaleMult = value;
                    break;
                case 'cursorWingOpacityMult':
                    this.wingOpacityMult = value;
                    break;
                case 'cursorGrabDisableSpeedScale':
                    this.grabDisableSpeedScale = value;
                    break;
                case 'cursorGrabSlowFactor':
                    this.grabSlowFactor = value;
                    break;
                case 'cursorGrabBuzzIntensity':
                    this.grabBuzzIntensity = value;
                    break;
                case 'cursorSubmergedOpacity':
                    this.cursorEl?.style.setProperty('--cursor-submerged-opacity', value);
                    break;
                case 'cursorSubmergedBrightness':
                    this.cursorEl?.style.setProperty('--cursor-submerged-brightness', value);
                    break;
                case 'cursorSubmergedSepia':
                    this.cursorEl?.style.setProperty('--cursor-submerged-sepia', value);
                    break;
                case 'cursorSubmergedHue':
                    this.cursorEl?.style.setProperty('--cursor-submerged-hue', value + 'deg');
                    break;
                case 'cursorSubmergedSat':
                    this.cursorEl?.style.setProperty('--cursor-submerged-sat', value);
                    break;
                case 'cursorSubmergedBlur':
                    this.cursorEl?.style.setProperty('--cursor-submerged-blur', value + 'px');
                    break;
                case 'cursorSubmergedOverlay':
                    this.cursorEl?.style.setProperty('--cursor-submerged-overlay', value);
                    break;
                case 'cursorUnderwaterSpeed':
                    this.underwaterSpeed = value;
                    break;
                case 'cursorIdleRadius':
                    this.idleRadius = value;
                    break;
                case 'cursorIdleSpeed':
                    this.idleSpeed = value;
                    break;
            }
        }

        pickIdleTarget(radius) {
            const r = Math.cbrt(Math.random()) * radius;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            return {
                x: r * Math.sin(phi) * Math.cos(theta),
                y: r * Math.sin(phi) * Math.sin(theta),
                z: r * Math.cos(phi)
            };
        }

        pickIdleState(radius) {
            const r = Math.random();
            if (r < 0.55) {
                this.idleTargetPos = this.pickIdleTarget(radius);
                this.idleTravelSpeed = (0.4 + Math.random() * 1.6) * this.idleSpeed;
                this.idleState = 'wandering';
                this.idleStateDuration = 0;
            } else if (r < 0.75) {
                this.idleOrbitCenter = { ...this.idleLocalPos };
                this.idleOrbitRadius = 3 + Math.random() * Math.min(radius * 0.4, 10);
                this.idleOrbitAngle = Math.random() * Math.PI * 2;
                this.idleOrbitSpeed = (0.5 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1) * this.idleSpeed;
                this.idleOrbitAxis = Math.random() < 0.7 ? 'z' : (Math.random() < 0.5 ? 'x' : 'y');
                this.idleState = 'orbiting';
                this.idleStateDuration = 1000 + Math.random() * 2500;
            } else if (r < 0.85) {
                this.idleBasePos = { ...this.idleLocalPos };
                this.idleState = 'flutter';
                this.idleStateDuration = 500 + Math.random() * 1200;
            } else if (r < 0.93) {
                this.idleBasePos = { ...this.idleLocalPos };
                const angle = Math.random() * Math.PI * 2;
                const dist = 4 + Math.random() * Math.min(radius * 0.5, 12);
                this.idleTargetPos = {
                    x: this.idleBasePos.x + Math.cos(angle) * dist,
                    y: this.idleBasePos.y + Math.sin(angle) * dist,
                    z: this.idleBasePos.z
                };
                this.idleTravelSpeed = (2.0 + Math.random() * 2.0) * this.idleSpeed;
                this.idleState = 'peek';
                this.idleStateDuration = 400 + Math.random() * 600;
            } else {
                this.idleBasePos = { ...this.idleLocalPos };
                this.idleState = 'bob';
                this.idleStateDuration = 800 + Math.random() * 1500;
            }
            this.idleStateStartTime = performance.now();
        }

        bindEvents() {
            this.onMouseMove = this.handleMouseMove.bind(this);
            this.onMouseDown = this.handleMouseDown.bind(this);
            this.onMouseUp = this.handleMouseUp.bind(this);
            this.onMouseLeave = this.handleMouseLeave.bind(this);
            this.onVisibilityChange = this.handleVisibilityChange.bind(this);
            this.onContextMenu = this.handleContextMenu.bind(this);

            window.addEventListener('mousemove', this.onMouseMove, { passive: true });
            window.addEventListener('mousedown', this.onMouseDown, { passive: false });
            window.addEventListener('mouseup', this.onMouseUp, { passive: false });
            window.addEventListener('mouseleave', this.onMouseLeave, { passive: true });
            window.addEventListener('contextmenu', this.onContextMenu, { capture: true });
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }

        handleMouseMove(event) {
            this.pointer.x = event.clientX;
            this.pointer.y = event.clientY;
            this.velocity.x = event.movementX;
            this.velocity.y = event.movementY;
            this.lastMouseMoveTime = performance.now();

            const target = event.target;
            const isInteractive = (target instanceof Element) ? Boolean(target.closest(INTERACTIVE_SELECTORS)) : false;
            if (isInteractive !== this.interactive) {
                this.interactive = isInteractive;
                this.cursorEl.classList.toggle('is-interactive', this.interactive);
            }

            if (!this.visible) {
                this.visible = true;
                this.cursorEl.classList.add('is-visible');
            }

            // Grab visual state is handled by isGrabbing; camera pan is owned by CameraController
        }

        // Shared source of truth for mouse world position — avoids duplicating
        // the raycast that boardSystem already performs every frame.
        getMouseWorldPosition() {
            return window.game?.boardSystem?.mouseWorldPosition || null;
        }

        isOverWater() {
            const boardSys = window.game?.boardSystem;
            if (!boardSys) return false;
            const mwp = this.getMouseWorldPosition();
            if (!mwp) return false;

            const waterLevel = boardSys.tidalWaterLevel ?? boardSys.waterLevel ?? -1.5;
            let terrainHeight;
            if (boardSys.getUnifiedTerrainHeight) {
                terrainHeight = boardSys.getUnifiedTerrainHeight(mwp.x, mwp.z);
            } else if (boardSys.getHeightWithRipple) {
                terrainHeight = boardSys.getHeightWithRipple(mwp.x, mwp.z);
            } else if (window.game?.terrainSystem?.getHeight) {
                terrainHeight = window.game.terrainSystem.getHeight(mwp.x, mwp.z);
            } else {
                terrainHeight = mwp.y;
            }

            return terrainHeight < waterLevel;
        }

        startDrowning(options = {}) {
            if (this.drowningState !== 'idle') return;

            const boardSys = window.game?.boardSystem;
            const mwp = this.getMouseWorldPosition();
            this.drowningWorldPos = mwp ? mwp.clone() : null;
            this.drowningWaterLevel = boardSys?.tidalWaterLevel ?? boardSys?.waterLevel ?? -1.5;

            this.drowningState = 'submerging';
            this.drowningStartTime = performance.now();
            this._drowningOffsetX = 0;
            this._drowningOffsetY = 0;
            this._drowningScale = 1;
            this._harumphPlayed = false;
            this._skipEmergingSplash = false;
            this._nextCussTime = performance.now() + 1200;

            this.cursorEl.classList.add('is-drowning');

            if (options.playSplash !== false && window.soundManager) {
                window.soundManager.playSplash();
            }
            if (window.soundManager) window.soundManager.playGlug();

            if (this.drowningWorldPos && window.game?.visualFeedback) {
                window.game.visualFeedback.showWaterSplash(
                    this.drowningWorldPos.x,
                    this.drowningWorldPos.z,
                    this.drowningWaterLevel
                );
            }

            // console.log('[NaviCursor] Drowning START');
        }

        getDrownParam(name, fallback) {
            const ps = window.parameterSystem;
            if (!ps) return fallback;
            const v = ps.getParameter(name);
            return typeof v === 'number' ? v : fallback;
        }

        updateDrowning() {
            const elapsed = performance.now() - this.drowningStartTime;
            const sm = window.soundManager;
            if (sm && !sm.cursorBuzz) {
                sm.startCursorBuzz();
            }

            const durSub = this.getDrownParam('cursorDrownSubmergeMs', 400);
            const durUnder = this.getDrownParam('cursorDrownUnderwaterMs', 600);
            const durEmerge = this.getDrownParam('cursorDrownEmergeMs', 500);
            const durFly = this.getDrownParam('cursorDrownFlyUpMs', 800);
            const durShake = this.getDrownParam('cursorDrownShakeMs', 1200);
            const durHarumph = this.getDrownParam('cursorDrownHarumphMs', 400);
            const depth = this.getDrownParam('cursorDrownSubmergeDepth', 40);
            const flyHeight = this.getDrownParam('cursorDrownFlyHeight', 25);
            const shakeAmp = this.getDrownParam('cursorDrownShakeAmplitude', 12);
            const shakeCycles = this.getDrownParam('cursorDrownShakeCycles', 4);

            switch (this.drowningState) {
                case 'submerging': {
                    const progress = Math.min(elapsed / durSub, 1);
                    this._drowningOffsetY = progress * depth;
                    this._drowningScale = 1 - progress * 0.25;
                    if (sm) sm.updateCursorBuzz(0, 20, true, 1.8);

                    if (elapsed >= durSub) {
                        // console.log('[NaviCursor] Drowning → underwater');
                        this.drowningState = 'underwater';
                        this.drowningStartTime = performance.now();
                        if (sm) sm.setCursorBuzzMuffled(true, 1.6);
                    }
                    break;
                }
                case 'underwater': {
                    this._drowningOffsetY = depth;
                    this._drowningScale = 0.75;
                    if (sm) sm.updateCursorBuzz(0.2, 20, true, 2.0);

                    // Stay underwater until cursor is actually above water
                    if (!this.isOverWater()) {
                        this.drowningState = 'emerging';
                        this.drowningStartTime = performance.now();
                        if (sm) sm.setCursorBuzzMuffled(false, 1.0);
                    }

                    // Periodic muffled underwater cusses (expressive musical tones)
                    const nowMs = performance.now();
                    if (nowMs >= this._nextCussTime) {
                        this._nextCussTime = nowMs + this._underwaterCussCooldownMin
                            + Math.random() * (this._underwaterCussCooldownMax - this._underwaterCussCooldownMin);
                        if (sm) sm.playMuffledCuss();
                    }
                    break;
                }
                case 'emerging': {
                    const progress = Math.min(elapsed / durEmerge, 1);
                    this._drowningOffsetY = depth * (1 - progress);
                    this._drowningScale = 0.75 + progress * 0.25;
                    if (sm) sm.updateCursorBuzz(0.4, 20, true, 1.5);

                    if (elapsed >= durEmerge) {
                        // console.log('[NaviCursor] Drowning → flying_up');
                        if (!this._skipEmergingSplash) {
                            const splashPos = this.getMouseWorldPosition() || this.drowningWorldPos;
                            if (sm) sm.playSplash();
                            if (splashPos && window.game?.visualFeedback) {
                                window.game.visualFeedback.showWaterSplash(
                                    splashPos.x,
                                    splashPos.z,
                                    this.drowningWaterLevel
                                );
                            }
                        }
                        this._skipEmergingSplash = false;
                        this.drowningState = 'flying_up';
                        this.drowningStartTime = performance.now();
                        this.cursorEl.classList.remove('is-drowning');
                    }
                    break;
                }
                case 'flying_up': {
                    const progress = Math.min(elapsed / durFly, 1);
                    const easeOut = 1 - Math.pow(1 - progress, 3);
                    this._drowningOffsetY = -flyHeight * easeOut;
                    this._drowningScale = 1.0;
                    if (sm) sm.updateCursorBuzz(0.6, 20, true, 2.2);

                    if (elapsed >= durFly) {
                        // console.log('[NaviCursor] Drowning → shaking');
                        this.drowningState = 'shaking';
                        this.drowningStartTime = performance.now();
                    }
                    break;
                }
                case 'shaking': {
                    const progress = Math.min(elapsed / durShake, 1);
                    const shakePhase = progress * shakeCycles * Math.PI * 2;
                    const amplitude = shakeAmp * (1 - progress);
                    this._drowningOffsetX = Math.sin(shakePhase) * amplitude;
                    this._drowningOffsetY = -flyHeight;
                    this._drowningScale = 1.0;
                    if (sm) sm.updateCursorBuzz(0.8, 20, true, 2.5);

                    if (Math.random() < 0.4 && progress < 0.9) {
                        this.spawnShakeParticle(this._drowningOffsetX > 0 ? 1 : -1, 1 - progress);
                    }

                    if (elapsed >= durShake) {
                        // console.log('[NaviCursor] Drowning → harumph');
                        this.drowningState = 'harumph';
                        this.drowningStartTime = performance.now();
                        this.clearShakeParticles();
                    }
                    break;
                }
                case 'harumph': {
                    this._drowningOffsetX = 0;
                    this._drowningOffsetY = 0;
                    this._drowningScale = 1;
                    if (sm) {
                        sm.updateCursorBuzz(0, 20, false, 1.0);
                        if (!this._harumphPlayed) {
                            const expression = this._fairyExpressions[Math.floor(Math.random() * this._fairyExpressions.length)];
                            let distanceToCamera = null;
                            if (this.drowningWorldPos && window.game?.camera) {
                                const dx = this.drowningWorldPos.x - window.game.camera.position.x;
                                const dy = this.drowningWorldPos.y - window.game.camera.position.y;
                                const dz = this.drowningWorldPos.z - window.game.camera.position.z;
                                distanceToCamera = Math.sqrt(dx * dx + dy * dy + dz * dz);
                            }
                            sm.playHarumph(expression, distanceToCamera);
                            this._harumphPlayed = true;
                        }
                    }

                    if (elapsed >= durHarumph) {
                        // console.log('[NaviCursor] Drowning → idle');
                        this.endDrowning();
                    }
                    break;
                }
            }

            const wasSubmerged = this._submerged;
            const shouldBeSubmerged = ['submerging', 'underwater', 'emerging'].includes(this.drowningState);
            if (shouldBeSubmerged !== this._submerged) {
                if (this._debug) console.log('[NaviCursor] submerged check', { drowningState: this.drowningState, wasSubmerged, shouldBeSubmerged });
                // Snap instantly when surfacing so the visual pop matches the splash
                const isSurfacing = !shouldBeSubmerged && wasSubmerged;
                if (isSurfacing) {
                    this.cursorEl.classList.add('no-transition');
                    // Force reflow so the browser applies the transition override
                    void this.cursorEl.offsetHeight;
                    // console.log('[NaviCursor] Surfacing — removing is-submerged (sync with splash)');
                }
                this.cursorEl.classList.toggle('is-submerged', shouldBeSubmerged);
                this._submerged = shouldBeSubmerged;
                if (isSurfacing) {
                    // Keep transition suppressed for ~50ms to guarantee the browser paints the snap
                    setTimeout(() => {
                        this.cursorEl.classList.remove('no-transition');
                    }, 50);
                }
            }

            this.cursorEl.style.setProperty('--cursor-drown-x', `${this._drowningOffsetX.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-drown-y', `${this._drowningOffsetY.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-drown-scale', this._drowningScale.toFixed(3));
        }

        spawnShakeParticle(direction, intensity) {
            const particle = document.createElement('div');
            particle.className = 'navi-shake-particle';
            const size = 2 + Math.random() * 4;
            particle.style.cssText = `
                position: fixed;
                left: ${this.rendered.x.toFixed(2)}px;
                top: ${this.rendered.y.toFixed(2)}px;
                width: ${size}px;
                height: ${size}px;
                background: radial-gradient(circle, rgba(180, 230, 255, 0.9), rgba(180, 230, 255, 0));
                border-radius: 50%;
                pointer-events: none;
                z-index: 100001;
                filter: blur(1px);
            `;
            document.body.appendChild(particle);

            const angle = (direction > 0 ? -1 : 1) * (0.3 + Math.random() * 0.8);
            const speed = (40 + Math.random() * 60) * intensity;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - 30;
            const life = 500 + Math.random() * 400;

            let startTime = performance.now();
            const animate = () => {
                const dt = performance.now() - startTime;
                if (dt >= life) {
                    particle.remove();
                    return;
                }
                const t = dt / life;
                const x = vx * t;
                const y = vy * t + 0.5 * 200 * t * t;
                const opacity = 1 - t;
                const scale = 1 - t * 0.5;
                particle.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)})`;
                particle.style.opacity = opacity.toFixed(2);
                requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        }

        clearShakeParticles() {
            document.querySelectorAll('.navi-shake-particle').forEach(p => p.remove());
        }

        endDrowning() {
            this.drowningState = 'idle';
            this.drowningStartTime = 0;
            this._drowningOffsetX = 0;
            this._drowningOffsetY = 0;
            this._drowningScale = 1;
            this._submerged = false;
            this.cursorEl.classList.remove('is-drowning');
            this.cursorEl.classList.remove('is-submerged');
            this.cursorEl.style.setProperty('--cursor-drown-x', '0px');
            this.cursorEl.style.setProperty('--cursor-drown-y', '0px');
            this.cursorEl.style.setProperty('--cursor-drown-scale', '1');
            this.clearShakeParticles();
            if (window.soundManager) {
                window.soundManager.setCursorBuzzMuffled(false, 1.0);
            }
            // console.log('[NaviCursor] Drowning END');
        }

        handleMouseDown(event) {
            this.active = true;
            this.cursorEl.classList.add('is-active');

            if (event.button === 2) {
                // Check if cursor is over water before grabbing
                if (this.isOverWater()) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.startDrowning();
                    return;
                }

                const cc = window.game?.cameraController;
                if (!cc) return;

                event.preventDefault();
                this.isGrabbing = true;
                if (this.grabDisableSpeedScale) {
                    this.speedSizeOverrideActive = true;
                    this.speedSizeMult = 0;
                }
                // console.log('[NaviCursor] Grab START — disableSpeedScale=', this.grabDisableSpeedScale, 'slowFactor=', this.grabSlowFactor, 'buzzIntensity=', this.grabBuzzIntensity);
                this.grabScreenX = event.clientX;
                this.grabScreenY = event.clientY;
                this.grabTarget = cc.target.clone();

                // Capture exact world point under cursor (shared cached raycast)
                const mouseWorld = this.getMouseWorldPosition();
                if (mouseWorld) {
                    // Snap to the nearest terrain data grid point (cellSize = 1)
                    const gridX = Math.round(mouseWorld.x);
                    const gridZ = Math.round(mouseWorld.z);
                    const gridY = window.game?.boardSystem?.getTerrainHeight
                        ? window.game.boardSystem.getTerrainHeight(gridX, gridZ)
                        : mouseWorld.y;
                    this.grabWorldY = gridY;
                    this.grabWorldPoint = new THREE.Vector3(gridX, gridY, gridZ);
                } else {
                    this.grabWorldY = cc.camera.position.y;
                    this.grabWorldPoint = null;
                }

                if (cc.beginCursorGrabAnchor) {
                    cc.beginCursorGrabAnchor(this.grabWorldPoint, this.grabTarget, this.grabSlowFactor);
                }
            }
        }

        handleMouseUp(event) {
            this.active = false;
            this.cursorEl.classList.remove('is-active');

            if (event.button === 2) {
                const cc = window.game?.cameraController;
                if (cc && cc.endCursorGrabAnchor) {
                    cc.endCursorGrabAnchor();
                }
                this.isGrabbing = false;
                this.grabTarget = null;
                this.grabWorldPoint = null;
                if (this.speedSizeOverrideActive) {
                    this.speedSizeOverrideActive = false;
                    this.speedSizeMult = this.speedSizeBase;
                }
                if (this.drowningState === 'idle') {
                    // console.log('[NaviCursor] Grab END');
                }
            }
        }

        handleMouseLeave() {
            this.visible = false;
            this.cursorEl.classList.remove('is-visible');
            this.lastMouseMoveTime = performance.now();
        }

        handleContextMenu(event) {
            if (this.isGrabbing || this.drowningState !== 'idle') {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        handleVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                this.handleMouseLeave();
            }
        }

        getCameraHeight() {
            const game = window.game;
            const camera = game?.camera || window.boardSystem?.camera || window.camera;
            const mouseWorld = this.getMouseWorldPosition();

            if (camera?.position && mouseWorld) {
                const dx = camera.position.x - mouseWorld.x;
                const dy = camera.position.y - mouseWorld.y;
                const dz = camera.position.z - mouseWorld.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (Math.abs(dist - this._lastLoggedDist) > 1) {
                    // console.log(`[NaviCursor] cam-to-mouse dist: ${this._lastLoggedDist?.toFixed(1) ?? 'none'} -> ${dist.toFixed(1)}`);
                    this._lastLoggedDist = dist;
                }
                return dist;
            }

            // Fallback to orbitDistance if mouse world pos not available yet
            const od = game?.cameraController?.orbitDistance;
            if (typeof od === 'number' && od > 0) return od;

            if (!camera || !camera.position) return null;
            return camera.position.y;
        }

        updateLoop() {
            if (!this.cursorEl) return;

            // Drive drowning animation state machine
            if (this.drowningState !== 'idle') {
                this.updateDrowning();
            }

            const lerpFactor = this._submerged ? this.underwaterSpeed : 0.18;
            this.rendered.x += (this.pointer.x - this.rendered.x) * lerpFactor;
            this.rendered.y += (this.pointer.y - this.rendered.y) * lerpFactor;

            const dx = this.pointer.x - this.rendered.x;
            const dy = this.pointer.y - this.rendered.y;
            const speed = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 120);

            // Distance-based scaling from camera height
            let distanceScale = 1.0;
            const camDist = this.getCameraHeight();
            if (this.distanceScaleEnabled && typeof camDist === 'number') {
                if (camDist <= this.distanceNear) {
                    distanceScale = 1.0;
                } else if (camDist >= this.distanceFar) {
                    distanceScale = this.distanceMinScale;
                } else {
                    const t = (camDist - this.distanceNear) / (this.distanceFar - this.distanceNear);
                    distanceScale = 1.0 - t * (1.0 - this.distanceMinScale);
                }
            }
            this.currentDistanceScale = distanceScale;

            // --- Idle local-space behavior (scaled by distance) ---
            const now = performance.now();
            const timeSinceMove = now - this.lastMouseMoveTime;
            const idleDelay = 120; // ms before radius starts growing
            const growRate = 0.12; // radius growth per ms when idle
            const shrinkRate = 0.35; // radius shrink per ms when moving
            const targetRadius = timeSinceMove > idleDelay ? this.idleRadius * distanceScale : 0;
            if (this.currentIdleRadius < targetRadius) {
                this.currentIdleRadius = Math.min(targetRadius, this.currentIdleRadius + growRate * 16.67); // approx 1 frame at 60fps
            } else if (this.currentIdleRadius > targetRadius) {
                this.currentIdleRadius = Math.max(targetRadius, this.currentIdleRadius - shrinkRate * 16.67);
            }

            let idleOffsetX = 0;
            let idleOffsetY = 0;
            let idleScale = 1;
            this.idleRotation = 0;
            if (this.currentIdleRadius > 0.5 && this.idleSpeed > 0) {
                this.idleTime += 0.0167 * this.idleSpeed;
                const radius = this.currentIdleRadius;

                if (this.idleState === 'inactive') {
                    this.idleLocalPos = { x: 0, y: 0, z: 0 };
                    this.pickIdleState(radius);
                }

                const stateElapsed = now - this.idleStateStartTime;
                if (this.idleState !== 'wandering' && stateElapsed >= this.idleStateDuration) {
                    this.pickIdleState(radius);
                }

                switch (this.idleState) {
                    case 'wandering': {
                        const tx = this.idleTargetPos.x;
                        const ty = this.idleTargetPos.y;
                        const tz = this.idleTargetPos.z;
                        const dx = tx - this.idleLocalPos.x;
                        const dy = ty - this.idleLocalPos.y;
                        const dz = tz - this.idleLocalPos.z;
                        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        if (dist < 1.5) {
                            this.idleLocalPos = { x: tx, y: ty, z: tz };
                            this.pickIdleState(radius);
                        } else {
                            const step = this.idleTravelSpeed * 0.12;
                            const t = Math.min(1, step / (dist + 0.1));
                            this.idleLocalPos.x += dx * t;
                            this.idleLocalPos.y += dy * t;
                            this.idleLocalPos.z += dz * t;
                        }
                        break;
                    }
                    case 'orbiting': {
                        this.idleOrbitAngle += 0.0167 * this.idleOrbitSpeed;
                        const oR = this.idleOrbitRadius;
                        const oA = this.idleOrbitAngle;
                        if (this.idleOrbitAxis === 'z') {
                            this.idleLocalPos.x = this.idleOrbitCenter.x + Math.cos(oA) * oR;
                            this.idleLocalPos.y = this.idleOrbitCenter.y + Math.sin(oA) * oR;
                        } else if (this.idleOrbitAxis === 'x') {
                            this.idleLocalPos.y = this.idleOrbitCenter.y + Math.cos(oA) * oR;
                            this.idleLocalPos.z = this.idleOrbitCenter.z + Math.sin(oA) * oR;
                        } else {
                            this.idleLocalPos.x = this.idleOrbitCenter.x + Math.cos(oA) * oR;
                            this.idleLocalPos.z = this.idleOrbitCenter.z + Math.sin(oA) * oR;
                        }
                        break;
                    }
                    case 'flutter': {
                        const f = stateElapsed * 0.012 * this.idleSpeed;
                        const fR = 3 + Math.sin(this.idleTime * 3) * 1.5;
                        this.idleLocalPos.x = this.idleBasePos.x + Math.cos(f * 4.7) * fR;
                        this.idleLocalPos.y = this.idleBasePos.y + Math.sin(f * 3.9) * fR;
                        this.idleLocalPos.z = this.idleBasePos.z + Math.sin(f * 2.1) * fR * 0.3;
                        break;
                    }
                    case 'peek': {
                        const progress = Math.min(1, stateElapsed / this.idleStateDuration);
                        let t;
                        if (progress < 0.5) {
                            const p = progress * 2;
                            t = 1 - (1 - p) * (1 - p);
                        } else {
                            const p = (progress - 0.5) * 2;
                            t = 1 - p * p;
                        }
                        this.idleLocalPos.x = this.idleBasePos.x + (this.idleTargetPos.x - this.idleBasePos.x) * t;
                        this.idleLocalPos.y = this.idleBasePos.y + (this.idleTargetPos.y - this.idleBasePos.y) * t;
                        this.idleLocalPos.z = this.idleBasePos.z + (this.idleTargetPos.z - this.idleBasePos.z) * t;
                        break;
                    }
                    case 'bob': {
                        const b = stateElapsed * 0.003 * this.idleSpeed;
                        this.idleLocalPos.x = this.idleBasePos.x + Math.sin(b) * 2;
                        this.idleLocalPos.y = this.idleBasePos.y + Math.sin(b * 1.3 + 1) * 3;
                        this.idleLocalPos.z = this.idleBasePos.z + Math.sin(b * 0.7) * 1.5;
                        break;
                    }
                }

                idleOffsetX = this.idleLocalPos.x;
                idleOffsetY = this.idleLocalPos.y;
                const z = this.idleLocalPos.z;
                const r = radius || 1;
                idleScale = 1.0 + (z / r) * 0.12;
            } else {
                this.idleState = 'inactive';
                this.idleLocalPos = { x: 0, y: 0, z: 0 };
            }
            this.cursorEl.style.setProperty('--cursor-idle-x', `${idleOffsetX.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-idle-y', `${idleOffsetY.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-idle-scale', idleScale.toFixed(3));
            this.cursorEl.style.setProperty('--cursor-idle-rotate', `${this.idleRotation.toFixed(2)}deg`);

            // Speed-based scaling (grows when moving fast) — disabled during grab or while submerged
            const speedScale = ((this.isGrabbing && this.grabDisableSpeedScale) || this._submerged) ? 1.0 : 1.0 + speed * this.speedSizeMult;
            const finalScale = distanceScale * speedScale;
            this.cursorEl.style.setProperty('--cursor-scale', finalScale.toFixed(3));
            if (this.isGrabbing && this._lastLoggedGrab !== this.isGrabbing) {
                // console.log('[NaviCursor] updateLoop grab active — speedScale=', speedScale, 'finalScale=', finalScale, 'speed=', speed.toFixed(3));
                this._lastLoggedGrab = true;
            } else if (!this.isGrabbing && this._lastLoggedGrab) {
                this._lastLoggedGrab = false;
            }

            // Trail orientation follows movement direction relative to cursor forward (left-to-right)
            const velocityMag = Math.hypot(this.velocity.x, this.velocity.y);
            let trailAngle = this.rotation;
            if (velocityMag > 0.25) {
                trailAngle = Math.atan2(this.velocity.y, this.velocity.x) * (180 / Math.PI);
                this.rotation = trailAngle;
            }
            const facingAngle = (trailAngle + 180).toFixed(2); // align trail behind cursor
            this.cursorEl.style.setProperty('--cursor-trail-angle', `${facingAngle}deg`);

            // Trail size — disabled during grab so cursor stays small
            const isGrabbed = this.isGrabbing && this.grabDisableSpeedScale;
            const minScale = 0.02;
            const growThreshold = 0.18;
            let scaleX = minScale;
            let scaleY = minScale;
            if (!isGrabbed && speed > growThreshold) {
                const normalized = Math.min(1, (speed - growThreshold) / (1 - growThreshold));
                scaleX = minScale + normalized * this.trailScaleX;
                scaleY = minScale + normalized * this.trailScaleY;
            }
            this.cursorEl.style.setProperty('--cursor-trail-scale-x', scaleX.toFixed(3));
            this.cursorEl.style.setProperty('--cursor-trail-scale-y', scaleY.toFixed(3));
            this.cursorEl.style.setProperty('--cursor-trail-opacity', (!isGrabbed && speed > 0.05 ? Math.min(1, speed * 1.4 * this.trailOpacityMult) : 0).toFixed(3));

            // Wing sonic-boom effect — disabled during grab so cursor stays small
            let wingScale = 1.0;
            let wingOpacity = 0.75;
            if (this.wingSpeedScaleEnabled && !isGrabbed) {
                const wingMinScale = 0.0;
                const wingThreshold = 0.18;
                if (speed > wingThreshold) {
                    const normalized = Math.min(1, (speed - wingThreshold) / (1 - wingThreshold));
                    wingScale = wingMinScale + normalized * this.wingScaleMult;
                    wingOpacity = 0.75 + normalized * 0.15 * this.wingOpacityMult;
                } else {
                    wingScale = wingMinScale;
                    wingOpacity = 0.0;
                }
            }
            this.cursorEl.style.setProperty('--cursor-wing-scale', wingScale.toFixed(3));
            this.cursorEl.style.setProperty('--cursor-wing-opacity', wingOpacity.toFixed(3));

            this.cursorEl.style.setProperty('--cursor-x', `${this.rendered.x.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-y', `${this.rendered.y.toFixed(2)}px`);
            this.cursorEl.style.setProperty('--cursor-speed', speed.toFixed(3));

            // Apply drowning offset if active (updateDrowning already sets these, but ensure cleanup)
            if (this.drowningState === 'idle') {
                this.cursorEl.style.setProperty('--cursor-drown-x', '0px');
                this.cursorEl.style.setProperty('--cursor-drown-y', '0px');
                this.cursorEl.style.setProperty('--cursor-drown-scale', '1');
            }

            // Drive cursor buzz sound (skip when drowning — handled by updateDrowning())
            if (window.soundManager && this.drowningState === 'idle') {
                if (this.visible) {
                    window.soundManager.startCursorBuzz();
                    window.soundManager.updateCursorBuzz(speed, camDist ?? 20, this.isGrabbing, this.grabBuzzIntensity);
                } else {
                    window.soundManager.stopCursorBuzz();
                }
            }

            this.raf = requestAnimationFrame(() => this.updateLoop());
        }
    }

    function initCursor() {
        if (window.__naviCursorInitialized) return;
        window.__naviCursorInitialized = true;
        window.__naviCursor = new NaviCursor();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCursor, { once: true });
    } else {
        initCursor();
    }
})();
