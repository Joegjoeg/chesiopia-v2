/**
 * PerformanceManager - Automatic vertex budget and quality scaling
 * Monitors FPS and adjusts render quality to maintain target frame rate
 */
class PerformanceManager {
    constructor(game) {
        this.game = game;
        
        // Target FPS
        this.targetFps = 30;
        this.minAcceptableFps = 20;
        this.highFpsThreshold = 45;
        
        // FPS tracking
        this.frameTimes = [];
        this.maxFrameHistory = 60;
        this.currentFps = 60;
        this.smoothedFps = 60;
        this.lastFpsUpdate = 0;
        
        // Quality levels (0-4, 0 = lowest, 4 = highest)
        this.qualityLevel = 4;
        this.maxQualityLevel = 4;
        this.minQualityLevel = 0;
        this.tierCap = 4; // ceiling based on device tier (low→1, medium→2, high→4)
        
        // Quality settings per level
        this.qualitySettings = [
            { // Level 0 - Emergency
                pixelRatio: 0.5,
                fogDistance: 20,
                treeDistance: 25,
                treeLod: 'low',
                treeAnimation: false,
                particleCount: 0,
                daisyCount: 0,
                birdCount: 0,
                shadowQuality: 0,
                grassEnabled: false,
                voxelCloudEnabled: false,
                waterReflectionEnabled: false,
                fogPlaneEnabled: false,
                celShaderEnabled: false,
                temporalAAEnabled: false,
                minimapEnabled: true,
                zodiacEnabled: false,
                soundEnabled: false,
                naviCursorEnabled: false,
                textureBlendingLowQuality: true,
                bakedShadowEnabled: false,
                settlementUpdateInterval: 4
            },
            { // Level 1 - Low
                pixelRatio: 0.75,
                fogDistance: 30,
                treeDistance: 35,
                treeLod: 'low',
                treeAnimation: true,
                particleCount: 10,
                daisyCount: 50,
                birdCount: 3,
                shadowQuality: 512,
                grassEnabled: false,
                voxelCloudEnabled: false,
                waterReflectionEnabled: false,
                fogPlaneEnabled: false,
                celShaderEnabled: false,
                temporalAAEnabled: false,
                minimapEnabled: true,
                zodiacEnabled: false,
                soundEnabled: true,
                naviCursorEnabled: true,
                textureBlendingLowQuality: true,
                bakedShadowEnabled: false,
                settlementUpdateInterval: 3
            },
            { // Level 2 - Medium
                pixelRatio: 1.0,
                fogDistance: 45,
                treeDistance: 50,
                treeLod: 'medium',
                treeAnimation: true,
                particleCount: 25,
                daisyCount: 100,
                birdCount: 6,
                shadowQuality: 1024,
                grassEnabled: false,
                voxelCloudEnabled: true,
                waterReflectionEnabled: false,
                fogPlaneEnabled: true,
                celShaderEnabled: false,
                temporalAAEnabled: false,
                minimapEnabled: true,
                zodiacEnabled: false,
                soundEnabled: true,
                naviCursorEnabled: true,
                textureBlendingLowQuality: false,
                bakedShadowEnabled: false,
                settlementUpdateInterval: 2
            },
            { // Level 3 - High
                pixelRatio: 1.0,
                fogDistance: 60,
                treeDistance: 70,
                treeLod: 'high',
                treeAnimation: true,
                particleCount: 50,
                daisyCount: 150,
                birdCount: 10,
                shadowQuality: 2048,
                grassEnabled: false,
                voxelCloudEnabled: true,
                waterReflectionEnabled: true,
                fogPlaneEnabled: true,
                celShaderEnabled: true,
                temporalAAEnabled: true,
                minimapEnabled: true,
                zodiacEnabled: true,
                soundEnabled: true,
                naviCursorEnabled: true,
                textureBlendingLowQuality: false,
                bakedShadowEnabled: true,
                settlementUpdateInterval: 1
            },
            { // Level 4 - Ultra
                pixelRatio: 1.0,
                fogDistance: 80,
                treeDistance: 90,
                treeLod: 'high',
                treeAnimation: true,
                particleCount: 100,
                daisyCount: 200,
                birdCount: 12,
                shadowQuality: 2048,
                grassEnabled: false,
                voxelCloudEnabled: true,
                waterReflectionEnabled: true,
                fogPlaneEnabled: true,
                celShaderEnabled: true,
                temporalAAEnabled: true,
                minimapEnabled: true,
                zodiacEnabled: true,
                soundEnabled: true,
                naviCursorEnabled: true,
                textureBlendingLowQuality: false,
                bakedShadowEnabled: true,
                settlementUpdateInterval: 1
            }
        ];
        
        // Hysteresis to prevent rapid toggling
        this.lastQualityChange = 0;
        this.qualityChangeCooldown = 3000; // ms
        
        // Track what we've applied
        this.appliedSettings = null;
        
        console.log('[PerformanceManager] Initialized with target FPS:', this.targetFps);
    }
    
    update(deltaTime) {
        // Track frame time
        const frameTimeMs = deltaTime * 1000;
        this.frameTimes.push(frameTimeMs);
        if (this.frameTimes.length > this.maxFrameHistory) {
            this.frameTimes.shift();
        }
        
        // Calculate FPS every 500ms
        const now = performance.now();
        if (now - this.lastFpsUpdate > 500) {
            this.calculateFps();
            this.lastFpsUpdate = now;
        }
    }
    
    calculateFps() {
        if (this.frameTimes.length < 10) return;
        
        // Use median frame time for stability
        const sorted = [...this.frameTimes].sort((a, b) => a - b);
        const medianFrameTime = sorted[Math.floor(sorted.length / 2)];
        this.currentFps = 1000 / Math.max(medianFrameTime, 1);
        
        // Smooth with exponential moving average
        const alpha = 0.3;
        this.smoothedFps = this.smoothedFps * (1 - alpha) + this.currentFps * alpha;
        
        this.adjustQuality();
    }
    
    adjustQuality() {
        const now = performance.now();
        if (now - this.lastQualityChange < this.qualityChangeCooldown) {
            return;
        }

        let newLevel = this.qualityLevel;

        if (this.smoothedFps < this.minAcceptableFps) {
            // Emergency: drop quality immediately
            newLevel = Math.max(0, this.qualityLevel - 2);
        } else if (this.smoothedFps < this.targetFps) {
            // Below target: drop one level
            newLevel = Math.max(0, this.qualityLevel - 1);
        } else if (this.smoothedFps > this.highFpsThreshold && this.qualityLevel < this.maxQualityLevel) {
            // Above threshold: can increase quality
            newLevel = Math.min(this.maxQualityLevel, this.qualityLevel + 1);
        }

        // Clamp to tier cap
        newLevel = Math.min(newLevel, this.tierCap);

        if (newLevel !== this.qualityLevel) {
            console.log(`[PerformanceManager] Quality ${this.qualityLevel} -> ${newLevel} (FPS: ${this.smoothedFps.toFixed(1)})`);
            this.qualityLevel = newLevel;
            this.lastQualityChange = now;
            this.applySettings();
        }
    }
    
    applySettings() {
        const settings = this.qualitySettings[this.qualityLevel];
        if (!settings) return;

        const game = this.game;
        if (!game) return;

        // Pixel ratio
        if (game.renderer && game.renderer.getPixelRatio() !== settings.pixelRatio) {
            game.renderer.setPixelRatio(settings.pixelRatio);
            console.log(`[PerformanceManager] Pixel ratio: ${settings.pixelRatio}`);
        }

        // Distance scaling via DistanceManager (single source of truth)
        const perfScale = [0.25, 0.45, 0.65, 0.85, 1.0][this.qualityLevel] || 1.0;
        if (game.distanceManager) {
            game.distanceManager.setPerformanceScale(perfScale);
        }

        // Tree quality knobs
        const treeManager = game.hybridTreeManager;
        if (treeManager) {
            if (typeof treeManager.setLodLevel === 'function') {
                treeManager.setLodLevel(settings.treeLod);
            }
            treeManager.animationEnabled = settings.treeAnimation;
        }

        // Particle limits
        if (game.visualFeedback) {
            game.visualFeedback.maxParticles = settings.particleCount;
        }

        // Daisy count
        if (game.decorativeVisuals) {
            game.decorativeVisuals.maxDaisies = settings.daisyCount;
            game.decorativeVisuals.maxBirds = settings.birdCount;
        }

        // Voxel clouds
        if (game.voxelCloudSystem && game.voxelCloudSystem.setEnabled) {
            game.voxelCloudSystem.setEnabled(settings.voxelCloudEnabled);
        }

        // Water reflections
        if (game.waterReflectionManager) {
            game.waterReflectionManager.enabled = settings.waterReflectionEnabled;
        }

        // Fog plane
        if (game.fogPlaneSystem && game.fogPlaneSystem.setEnabled) {
            game.fogPlaneSystem.setEnabled(settings.fogPlaneEnabled);
        }

        // Cel shading
        if (game.celShaderSystem) {
            if (settings.celShaderEnabled) game.celShaderSystem.enableCelShading(game.scene);
            else game.celShaderSystem.disableCelShading(game.scene);
        }

        // Temporal AA
        if (game.temporalAA) {
            if (settings.temporalAAEnabled && game.temporalAA._userDisabled) {
                // User/emergency turned it off; don't auto-re-enable
            } else {
                game.temporalAA.setEnabled(settings.temporalAAEnabled);
            }
        }

        // Minimap
        if (game.minimapOverlay) {
            game.minimapOverlay.enabled = settings.minimapEnabled;
            if (game.minimapOverlay.container) {
                game.minimapOverlay.container.style.display = settings.minimapEnabled ? 'block' : 'none';
            }
        }

        // Zodiac constellations
        if (game.zodiacConstellationSystem) {
            game.zodiacConstellationSystem.enabled = settings.zodiacEnabled;
            if (game.zodiacConstellationSystem.constellationGroup) {
                game.zodiacConstellationSystem.constellationGroup.visible = settings.zodiacEnabled;
            }
        }

        // Sound
        if (game.soundManager) {
            game.soundManager.enabled = settings.soundEnabled;
            if (!settings.soundEnabled) game.soundManager.masterVolume = 0;
        }

        // Navi cursor
        const naviCursor = window.__naviCursor || window.naviCursor;
        if (naviCursor && naviCursor.setActive) {
            naviCursor.setActive(settings.naviCursorEnabled);
        }

        // Texture blending low-quality mode
        if (game.textureBlendingSystem && game.textureBlendingSystem.setLowQualityMode) {
            game.textureBlendingSystem.setLowQualityMode(settings.textureBlendingLowQuality);
        }

        // Baked shadows
        if (game.bakedShadowSystem) {
            game.bakedShadowSystem.enabled = settings.bakedShadowEnabled;
            if (game.scene) {
                game.scene.traverse(c => {
                    if (c.userData && c.userData.isBakedShadow) {
                        c.visible = settings.bakedShadowEnabled;
                    }
                });
            }
        }

        // Settlement update interval is handled by the game loop reading from performanceManager

        this.appliedSettings = settings;
    }
    
    getStatus() {
        return {
            fps: this.smoothedFps.toFixed(1),
            qualityLevel: this.qualityLevel,
            targetFps: this.targetFps,
            vertexBudget: this.getVertexBudget()
        };
    }
    
    getVertexBudget() {
        // Rough vertex budget based on quality level
        const budgets = [50000, 100000, 200000, 350000, 500000];
        return budgets[this.qualityLevel] || 200000;
    }
    
    setTierCap(tier) {
        const mapping = { low: 1, medium: 2, high: 4 };
        this.tierCap = mapping[tier] ?? 4;
        this.maxQualityLevel = this.tierCap;
        console.log(`[PerformanceManager] Tier cap set: ${tier} -> max quality ${this.tierCap}`);
        // If current level exceeds new cap, clamp down
        if (this.qualityLevel > this.tierCap) {
            this.forceQualityLevel(this.tierCap);
        }
    }

    forceQualityLevel(level) {
        level = Math.max(0, Math.min(this.maxQualityLevel, level));
        if (level !== this.qualityLevel) {
            this.qualityLevel = level;
            this.applySettings();
        }
    }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceManager;
}
