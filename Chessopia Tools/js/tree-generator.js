/**
 * Standalone procedural tree generator matching Chessopia's LocalTreeSystem.
 * Creates Nintendo-style trees with triangular trunk + spherical foliage.
 */
class TreeGenerator {
    constructor() {
        this.materials = {
            trunk: new THREE.MeshStandardMaterial({
                color: 0x8B4513,
                roughness: 0.9,
                transparent: true,
                opacity: 0.85,
                depthWrite: false
            }),
            leaves: new THREE.MeshLambertMaterial({
                transparent: true,
                opacity: 1.0,
                alphaTest: 0.05,
                side: THREE.DoubleSide,
                depthWrite: false,
                color: 0xffffff
            })
        };
    }

    seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    createLeafTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        const leafColor = { r: 34, g: 139, b: 34 };
        const centerX = size / 2;
        const centerY = size / 2;
        const leafCount = 120;

        for (let i = 0; i < leafCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = (Math.random() * 10 + 5) * 1.5;
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = size * 0.48;
            const falloff = Math.max(0, 1 - (dist / maxDist));
            if (falloff <= 0) continue;

            ctx.beginPath();
            ctx.ellipse(x, y, radius, radius * 0.65, Math.random() * Math.PI, 0, Math.PI * 2);
            const opacity = (Math.random() * 0.5 + 0.4) * falloff;
            ctx.fillStyle = `rgba(${leafColor.r}, ${leafColor.g}, ${leafColor.b}, ${opacity})`;
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    createTree(seed = null) {
        seed = seed ?? Math.floor(Math.random() * 100000);
        const tree = new THREE.Group();

        const trunkHeight = 1.15 + this.seededRandom(seed) * 0.25;
        const trunkBaseRadius = 0.02 + this.seededRandom(seed + 1) * 0.025;
        const springiness = 0.5 + this.seededRandom(seed + 2) * 1.0;
        const windPhase = this.seededRandom(seed + 3) * Math.PI * 2;

        // Trunk: 3-sided prism, 3 height segments for smooth wind bending
        const trunkGeometry = new THREE.CylinderGeometry(0, trunkBaseRadius, trunkHeight, 3, 3);
        const trunkMesh = new THREE.Mesh(trunkGeometry, this.materials.trunk.clone());
        trunkMesh.position.y = trunkHeight / 2;
        trunkMesh.name = 'trunk';
        trunkMesh.userData.isTrunk = true;
        tree.add(trunkMesh);

        // Leaf texture
        const leafTexture = this.createLeafTexture();
        const foliageMaterial = this.materials.leaves.clone();
        foliageMaterial.map = leafTexture;

        // Foliage balls
        const centerRadius = 0.42 + this.seededRandom(seed + 4) * 0.10;
        const smallRadius = 0.22 + this.seededRandom(seed + 5) * 0.07;
        const topRadius = 0.18 + this.seededRandom(seed + 6) * 0.06;
        const canopyY = trunkHeight - centerRadius * 0.85;

        let ballIndex = 0;

        // Center ball
        const centerGeo = new THREE.SphereGeometry(centerRadius, 6, 4);
        const centerBall = new THREE.Mesh(centerGeo, foliageMaterial.clone());
        centerBall.position.set(0, canopyY, 0);
        centerBall.userData.isFoliage = true;
        centerBall.userData.foliageIndex = ballIndex++;
        centerBall.userData.lodTier = 'center';
        centerBall.userData.originalX = 0;
        centerBall.userData.originalY = canopyY;
        centerBall.userData.originalZ = 0;
        centerBall.userData.originalRotationX = 0;
        centerBall.userData.originalRotationY = 0;
        centerBall.userData.originalRotationZ = 0;
        centerBall.userData.flutterPhase = this.seededRandom(seed + 10) * Math.PI * 2;
        tree.add(centerBall);

        // Top ball
        const topGeo = new THREE.SphereGeometry(topRadius, 6, 4);
        const topBall = new THREE.Mesh(topGeo, foliageMaterial.clone());
        topBall.position.set(0, canopyY + centerRadius * 0.75, 0);
        topBall.userData.isFoliage = true;
        topBall.userData.foliageIndex = ballIndex++;
        topBall.userData.lodTier = 'top';
        topBall.userData.originalX = 0;
        topBall.userData.originalY = canopyY + centerRadius * 0.75;
        topBall.userData.originalZ = 0;
        topBall.userData.originalRotationX = 0;
        topBall.userData.originalRotationY = 0;
        topBall.userData.originalRotationZ = 0;
        topBall.userData.flutterPhase = this.seededRandom(seed + 11) * Math.PI * 2;
        tree.add(topBall);

        // Ring of 6 balls
        const ringCount = 6;
        for (let i = 0; i < ringCount; i++) {
            const angle = (i / ringCount) * Math.PI * 2 + (this.seededRandom(seed + 20 + i) - 0.5) * 0.3;
            const ringRadius = centerRadius * 0.70 + this.seededRandom(seed + 30 + i) * 0.15;
            const heightOffset = (this.seededRandom(seed + 40 + i) - 0.5) * 0.15;

            const ringGeo = new THREE.SphereGeometry(smallRadius, 6, 4);
            const ringBall = new THREE.Mesh(ringGeo, foliageMaterial.clone());
            ringBall.position.set(
                Math.cos(angle) * ringRadius,
                canopyY + heightOffset,
                Math.sin(angle) * ringRadius
            );
            ringBall.userData.isFoliage = true;
            ringBall.userData.foliageIndex = ballIndex++;
            ringBall.userData.lodTier = 'ring';
            ringBall.userData.originalX = ringBall.position.x;
            ringBall.userData.originalY = ringBall.position.y;
            ringBall.userData.originalZ = ringBall.position.z;
            ringBall.userData.originalRotationX = 0;
            ringBall.userData.originalRotationY = 0;
            ringBall.userData.originalRotationZ = 0;
            ringBall.userData.flutterPhase = this.seededRandom(seed + 50 + i) * Math.PI * 2;
            tree.add(ringBall);
        }

        // Store original positions on trunk for wind animation
        trunkMesh.userData.originalPositions = trunkMesh.geometry.attributes.position.clone();

        // Store wind properties
        tree.userData.windProperties = {
            height: trunkHeight,
            baseRadius: trunkBaseRadius,
            springiness: springiness,
            phase: windPhase,
            seed: seed
        };

        return tree;
    }

    createSimpleTree() {
        const tree = new THREE.Group();

        // Simple trunk
        const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.75;
        trunk.userData.isTrunk = true;
        trunk.userData.originalPositions = trunk.geometry.attributes.position.clone();
        tree.add(trunk);

        // Leaves
        const leafMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
        const mainLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), leafMat);
        mainLeaf.position.set(0, 1.5, 0);
        mainLeaf.scale.set(1, 1.2, 1);
        tree.add(mainLeaf);

        const smallGeo = new THREE.SphereGeometry(0.4, 6, 5);
        const offsets = [
            [-0.35, 1.4, 0], [0.35, 1.4, 0],
            [0, 1.4, -0.35], [0, 1.4, 0.35],
            [0, 1.9, 0]
        ];
        offsets.forEach(([x, y, z], i) => {
            const leaf = new THREE.Mesh(smallGeo, leafMat.clone());
            leaf.position.set(x, y, z);
            if (i === 4) leaf.scale.set(0.8, 1.1, 0.8);
            tree.add(leaf);
        });

        tree.userData.windProperties = {
            height: 1.5,
            baseRadius: 0.1,
            springiness: 0.5,
            phase: 0
        };

        return tree;
    }

    /**
     * Apply wind deformation to a tree, matching Chessopia's updateWindAnimation logic.
     */
    applyWind(tree, time, windDirection, windStrength) {
        const props = tree.userData.windProperties;
        if (!props) return;

        // Find trunk mesh
        let trunk = null;
        for (const child of tree.children) {
            if (child.isMesh && child.userData.isTrunk) {
                trunk = child;
                break;
            }
            if (child.isObject3D) {
                child.traverse(c => {
                    if (c.isMesh && c.userData.isTrunk) trunk = c;
                });
            }
        }
        if (!trunk || !trunk.userData.originalPositions) return;

        const positions = trunk.geometry.attributes.position;
        const original = trunk.userData.originalPositions;
        if (!original || typeof original.getY !== 'function') return;

        const windBase = 0.2 * windStrength;
        const windVariation = Math.sin(time * 0.5 + props.phase) * 0.1 * windStrength;
        const windFlutter = Math.sin(time * 2.0 + props.phase * 2) * 0.05 * windStrength;

        const bendHeightFactor = props.height / 1.5;
        const thicknessFactor = 0.05 / props.baseRadius;
        const dimensionScale = bendHeightFactor * thicknessFactor;
        const totalBend = (windBase + windVariation + windFlutter) * dimensionScale;

        const windDirX = Math.cos(windDirection);
        const windDirZ = Math.sin(windDirection);

        for (let i = 0; i < positions.count; i++) {
            const origY = original.getY(i);
            const normalizedHeight = (origY + props.height / 2) / props.height;
            const heightBendFactor = Math.pow(normalizedHeight, 2);
            const bendOffset = totalBend * heightBendFactor;

            positions.setX(i, original.getX(i) + bendOffset * windDirX);
            positions.setZ(i, original.getZ(i) + bendOffset * windDirZ);
        }

        positions.needsUpdate = true;
        trunk.geometry.computeVertexNormals();

        // Move foliage with trunk bend
        const topBendOffset = totalBend;
        for (let i = 1; i < tree.children.length; i++) {
            const foliage = tree.children[i];
            if (foliage.userData.isFoliage && foliage.userData.originalY !== undefined) {
                const heightFactor = Math.min(1.0, foliage.userData.originalY / props.height);
                const foliageBendOffset = topBendOffset * heightFactor;

                const flutter = Math.sin(time * 2.5 + foliage.userData.flutterPhase) * 0.02 * windStrength;
                const timeVar = Math.sin(time * 2.0 + foliage.userData.foliageIndex * 0.5) * 0.03 * windStrength;

                foliage.position.x = foliage.userData.originalX + (foliageBendOffset * windDirX) + flutter + timeVar * windDirX;
                foliage.position.z = foliage.userData.originalZ + (foliageBendOffset * windDirZ) + flutter + timeVar * windDirZ;

                const rotFlutter = flutter * 2.0;
                foliage.rotation.x = foliage.userData.originalRotationX + rotFlutter * Math.sin(time * 1.3 + foliage.userData.foliageIndex);
                foliage.rotation.y = foliage.userData.originalRotationY + rotFlutter * Math.cos(time * 1.1 + foliage.userData.foliageIndex);
                foliage.rotation.z = foliage.userData.originalRotationZ + rotFlutter * Math.sin(time * 1.7 + foliage.userData.foliageIndex);
            }
        }
    }

    resetTree(tree) {
        const props = tree.userData.windProperties;
        if (!props) return;

        let trunk = null;
        for (const child of tree.children) {
            if (child.isMesh && child.userData.isTrunk) {
                trunk = child;
                break;
            }
        }
        if (trunk && trunk.userData.originalPositions) {
            trunk.geometry.attributes.position.copy(trunk.userData.originalPositions);
            trunk.geometry.attributes.position.needsUpdate = true;
        }

        for (let i = 1; i < tree.children.length; i++) {
            const foliage = tree.children[i];
            if (foliage.userData.isFoliage && foliage.userData.originalX !== undefined) {
                foliage.position.set(
                    foliage.userData.originalX,
                    foliage.userData.originalY,
                    foliage.userData.originalZ
                );
                foliage.rotation.set(
                    foliage.userData.originalRotationX,
                    foliage.userData.originalRotationY,
                    foliage.userData.originalRotationZ
                );
            }
        }
    }

    disposeTree(tree) {
        tree.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
    }
}

window.TreeGenerator = TreeGenerator;
