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
                grassEnabled: false
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
                grassEnabled: false
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
                grassEnabled: false
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
                grassEnabled: false
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
                grassEnabled: false
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
        
        // Fog distance (affects draw distance)
        if (game.boardSystem && game.boardSystem.scene && game.boardSystem.scene.fog) {
            game.boardSystem.scene.fog.far = settings.fogDistance;
        }
        
        // Tree distance
        if (game.treeSystem) {
            game.treeSystem.maxRenderDistance = settings.treeDistance;
            // Update LOD
            if (game.treeSystem.setLodLevel) {
                game.treeSystem.setLodLevel(settings.treeLod);
            }
        }
        
        // Tree animation frequency
        if (game.treeSystem) {
            game.treeSystem.animationEnabled = settings.treeAnimation;
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
        
        // Shadow quality
        if (game.shadowSystem && game.shadowSystem.setQuality) {
            game.shadowSystem.setQuality(settings.shadowQuality);
        }
        
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
