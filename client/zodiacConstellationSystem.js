/**
 * Zodiac Constellation System
 * Generates persistent 3D star constellations with glowing spline connections
 * that change between visits to space but remain stable while in orbit.
 */
class ZodiacConstellationSystem {
    constructor(scene) {
        this.scene = scene;
        this.enabled = true;
        this.starRadius = 1850; // Slightly inside sky sphere (2000)
        this.constellationCount = 12;
        this.starsPerConstellationMin = 5;
        this.starsPerConstellationMax = 8;
        this.clusterAngle = 0.35; // Radians spread for each constellation
        this.fadeStartHeight = 60;
        this.fadeEndHeight = 120;
        this.isVisible = false;
        this.inSpace = false;
        this.seed = Math.floor(Math.random() * 100000);

        // Glow texture (generated once)
        this.glowTexture = this.createGlowTexture();

        // Container for all constellation objects
        this.constellationGroup = new THREE.Group();
        this.constellationGroup.name = 'ZodiacConstellations';
        this.scene.add(this.constellationGroup);

        // Initialize with empty state — generation deferred until first space entry
        this.constellations = [];
        this.starSprites = [];
        this.lineMeshes = [];

        console.log('[Zodiac] System initialized');
    }

    createGlowTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(0.5, 'rgba(220, 240, 255, 0.3)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // Simple seeded random [0, 1)
    srand(seed) {
        let s = seed;
        return function() {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    generateConstellations(cameraPosition) {
        if (!this.enabled) return;
        // Clean up previous
        this.clearConstellations();
        this.constellations = [];
        this.starSprites = [];
        this.lineMeshes = [];

        // New seed on each space visit
        this.seed = Math.floor(Math.random() * 100000);
        const rand = this.srand(this.seed);

        // Create star sprite material (shared base, cloned for individual opacity)
        const starMat = new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Line material (shared base, cloned for individual opacity)
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xaaddff,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        for (let c = 0; c < this.constellationCount; c++) {
            const starCount = this.starsPerConstellationMin +
                Math.floor(rand() * (this.starsPerConstellationMax - this.starsPerConstellationMin + 1));

            // Pick a random direction on sphere for this constellation center
            const theta = rand() * Math.PI * 2; // azimuth
            const phi = Math.acos(2 * rand() - 1); // polar
            const centerDir = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta)
            ).normalize();

            const stars = [];
            const positions = [];

            for (let s = 0; s < starCount; s++) {
                // Scatter around center direction within cone
                const offsetTheta = (rand() - 0.5) * this.clusterAngle * 2;
                const offsetPhi = (rand() - 0.5) * this.clusterAngle * 2;

                // Create orthonormal basis around centerDir
                const up = Math.abs(centerDir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
                const tangent = new THREE.Vector3().crossVectors(centerDir, up).normalize();
                const bitangent = new THREE.Vector3().crossVectors(centerDir, tangent).normalize();

                const dir = new THREE.Vector3().copy(centerDir)
                    .addScaledVector(tangent, Math.sin(offsetTheta))
                    .addScaledVector(bitangent, Math.sin(offsetPhi))
                    .normalize();

                const pos = dir.clone().multiplyScalar(this.starRadius);
                positions.push(pos);

                // Star sprite
                const sprite = new THREE.Sprite(starMat.clone());
                sprite.position.copy(pos);
                // Vary size for depth effect
                const baseSize = 12 + rand() * 16;
                sprite.scale.set(baseSize, baseSize, 1);
                sprite.userData = {
                    baseSize: baseSize,
                    pulsePhase: rand() * Math.PI * 2,
                    pulseSpeed: 0.5 + rand() * 1.5
                };
                this.constellationGroup.add(sprite);
                this.starSprites.push(sprite);
                stars.push(sprite);
            }

            // Connect stars with lines in path order
            const linePoints = [];
            for (let s = 0; s < stars.length; s++) {
                linePoints.push(positions[s].clone());
                // Some constellations loop back or branch
                if (s > 0 && rand() > 0.65) {
                    // Extra cross-connection for visual interest
                    const target = Math.floor(rand() * s);
                    if (target !== s - 1) {
                        const extraGeo = new THREE.BufferGeometry().setFromPoints([
                            positions[s].clone(),
                            positions[target].clone()
                        ]);
                        const extraLine = new THREE.Line(extraGeo, lineMat.clone());
                        extraLine.userData = { pulsePhase: rand() * Math.PI * 2 };
                        this.constellationGroup.add(extraLine);
                        this.lineMeshes.push(extraLine);
                    }
                }
            }
            // Main path line through all stars
            const mainGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
            const mainLine = new THREE.Line(mainGeo, lineMat.clone());
            mainLine.userData = { pulsePhase: rand() * Math.PI * 2 };
            this.constellationGroup.add(mainLine);
            this.lineMeshes.push(mainLine);

            this.constellations.push({
                stars: stars,
                positions: positions,
                centerDir: centerDir,
                rotationSpeed: (rand() - 0.5) * 0.02 // Very slow drift
            });
        }

        // Offset group to camera so stars stay at infinite distance
        if (cameraPosition) {
            this.constellationGroup.position.copy(cameraPosition);
        }

        this.constellationGroup.visible = false;
        this.isVisible = false;
        console.log('[Zodiac] Generated', this.constellationCount, 'constellations with seed', this.seed);
    }

    clearConstellations() {
        // Remove all children safely
        while (this.constellationGroup.children.length > 0) {
            const child = this.constellationGroup.children[0];
            this.constellationGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        }
        this.constellations = [];
        this.starSprites = [];
        this.lineMeshes = [];
    }

    update(time, cameraPosition, cameraHeight) {
        const spaceThreshold = this.fadeStartHeight;
        const nowInSpace = cameraHeight >= spaceThreshold;

        // Generate on first entry to space
        if (nowInSpace && !this.inSpace) {
            this.generateConstellations(cameraPosition);
        }
        this.inSpace = nowInSpace;

        if (!this.constellations.length) return;

        // Keep constellations centered on camera (infinite distance illusion)
        if (cameraPosition) {
            this.constellationGroup.position.copy(cameraPosition);
        }

        // Fade in/out based on height
        let targetOpacity = 0;
        if (cameraHeight >= this.fadeEndHeight) {
            targetOpacity = 1;
        } else if (cameraHeight >= this.fadeStartHeight) {
            targetOpacity = (cameraHeight - this.fadeStartHeight) / (this.fadeEndHeight - this.fadeStartHeight);
        }

        const wasVisible = this.constellationGroup.visible;
        this.constellationGroup.visible = targetOpacity > 0.01;
        if (!this.constellationGroup.visible) return;

        // Update star pulse scale and opacity
        for (const sprite of this.starSprites) {
            const ud = sprite.userData;
            const pulse = 1.0 + 0.15 * Math.sin(time * ud.pulseSpeed + ud.pulsePhase);
            sprite.scale.set(ud.baseSize * pulse, ud.baseSize * pulse, 1);
            sprite.material.opacity = 0.7 * targetOpacity + 0.2 * Math.sin(time * 2 + ud.pulsePhase) * targetOpacity;
        }

        // Update line opacity with subtle pulse
        for (const line of this.lineMeshes) {
            const phase = line.userData.pulsePhase || 0;
            const pulse = 0.45 + 0.15 * Math.sin(time * 0.8 + phase);
            line.material.opacity = pulse * targetOpacity;
        }
    }

    dispose() {
        this.clearConstellations();
        if (this.constellationGroup) {
            this.scene.remove(this.constellationGroup);
        }
        if (this.glowTexture) {
            this.glowTexture.dispose();
        }
    }
}

// Export pattern matching project conventions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZodiacConstellationSystem;
} else if (typeof window !== 'undefined') {
    window.ZodiacConstellationSystem = ZodiacConstellationSystem;
}
