/**
 * Preview scene setup: Three.js scene, camera, renderer, terrain, sun light.
 */
class PreviewScene {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.sunLight = null;
        this.sunHelper = null;
        this.terrainMesh = null;
        this.groundPlane = null;
        this.gridHelper = null;
        this.onAnimate = null;
        this.clock = new THREE.Clock();
        this.currentModel = null;
        this.shadowMesh = null;

        this.setup();
    }

    setup() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
        this.camera.position.set(5, 5, 8);
        this.camera.lookAt(0, 1, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false; // We bake shadows, don't render them

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.target.set(0, 1, 0);
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 40;

        // Ambient light
        const ambient = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambient);

        // Fill light
        const fill = new THREE.DirectionalLight(0xffffff, 0.3);
        fill.position.set(-10, 20, -10);
        this.scene.add(fill);

        // Sun light (the one we control)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.sunLight.position.set(10, 20, 10);
        this.scene.add(this.sunLight);

        // Sun helper arrow
        const arrowDir = new THREE.Vector3(1, -0.5, 1).normalize();
        this.sunHelper = new THREE.ArrowHelper(
            arrowDir,
            new THREE.Vector3(0, 5, 0),
            3,
            0xffdd00,
            0.5,
            0.3
        );
        this.scene.add(this.sunHelper);

        // Create terrain
        this.createTerrain();

        // Ground plane (flat, slightly below terrain for shadow visualization)
        const groundGeo = new THREE.PlaneGeometry(50, 50);
        const groundMat = new THREE.MeshLambertMaterial({
            color: 0x5c8a3e,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.position.y = 0.01;
        this.groundPlane.visible = false;
        this.scene.add(this.groundPlane);

        // Grid helper
        this.gridHelper = new THREE.GridHelper(20, 40, 0x888888, 0xcccccc);
        this.gridHelper.position.y = 0.02;
        this.gridHelper.visible = false;
        this.scene.add(this.gridHelper);

        // Resize handler
        window.addEventListener('resize', () => this.onResize());
        this.onResize();

        // Start loop
        this.animate();
    }

    createTerrain() {
        const size = 80;
        const segments = 64;
        const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;
        const colors = [];
        const colorGrass = new THREE.Color(0x5c8a3e);
        const colorDirt = new THREE.Color(0x8B7355);
        const colorSnow = new THREE.Color(0xEEEEEE);

        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const y = this.getTerrainHeight(x, z);
            positions.setY(i, y);

            // Color by height
            let c = colorGrass.clone();
            if (y > 3) {
                c = colorGrass.clone().lerp(colorDirt, Math.min(1, (y - 3) / 4));
            }
            if (y > 6) {
                c = c.lerp(colorSnow, Math.min(1, (y - 6) / 4));
            }
            colors.push(c.r, c.g, c.b);
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.FrontSide
        });

        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.receiveShadow = false;
        this.terrainMesh.castShadow = false;
        this.scene.add(this.terrainMesh);
    }

    getTerrainHeight(x, z) {
        // Multi-octave noise matching Chessopia's terrain.js approach
        const smoothNoise = (nx, nz) => {
            const sinVal = Math.sin(nx * 12.9898 + nz * 78.233) * 43758.5453;
            return sinVal - Math.floor(sinVal);
        };

        let height = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;
        const noiseScale = 0.02;
        const heightScale = 10;

        for (let i = 0; i < 4; i++) {
            height += smoothNoise(
                x * noiseScale * frequency,
                z * noiseScale * frequency
            ) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return (height / maxValue) * heightScale;
    }

    setSunPosition(azimuthDeg, elevationDeg, height = 50) {
        const azimuth = THREE.Math.degToRad(azimuthDeg);
        const elevation = THREE.Math.degToRad(elevationDeg);

        const r = height;
        const x = r * Math.cos(elevation) * Math.sin(azimuth);
        const y = r * Math.sin(elevation);
        const z = r * Math.cos(elevation) * Math.cos(azimuth);

        this.sunLight.position.set(x, y, z);
        this.sunLight.intensity = Math.max(0.1, Math.sin(elevation) * 1.2);

        // Update arrow helper
        const dir = new THREE.Vector3(-x, -y, -z).normalize();
        this.sunHelper.setDirection(dir);
        this.sunHelper.position.set(0, 3, 0);
        this.sunHelper.setLength(3, 0.5, 0.3);

        // Tint sky based on elevation
        if (elevationDeg > 10) {
            this.scene.background.setHex(0x87CEEB);
            this.scene.fog.color.setHex(0x87CEEB);
        } else if (elevationDeg > -5) {
            const t = (elevationDeg + 5) / 15;
            this.scene.background.lerpColors(
                new THREE.Color(0xffa500),
                new THREE.Color(0x87CEEB),
                t
            );
            this.scene.fog.color.copy(this.scene.background);
        } else {
            this.scene.background.setHex(0x1a0a2e);
            this.scene.fog.color.setHex(0x1a0a2e);
        }
    }

    addModel(model) {
        if (this.currentModel) {
            this.scene.remove(this.currentModel);
        }
        this.currentModel = model;
        this.scene.add(model);
    }

    addShadowMesh(geometry, material) {
        if (this.shadowMesh) {
            this.scene.remove(this.shadowMesh);
            this.shadowMesh.geometry.dispose();
        }
        this.shadowMesh = new THREE.Mesh(geometry, material);
        this.shadowMesh.rotation.x = -Math.PI / 2;
        this.shadowMesh.position.y = 0.03;
        this.shadowMesh.renderOrder = 999; // Render on top
        this.scene.add(this.shadowMesh);
    }

    removeShadowMesh() {
        if (this.shadowMesh) {
            this.scene.remove(this.shadowMesh);
            this.shadowMesh.geometry.dispose();
            this.shadowMesh = null;
        }
    }

    setGridOverlay(visible) {
        this.gridHelper.visible = visible;
        this.groundPlane.visible = visible;
    }

    onResize() {
        const container = this.canvas.parentElement;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        if (this.onAnimate) this.onAnimate(delta);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        window.removeEventListener('resize', () => this.onResize());
        this.renderer.dispose();
    }
}

window.PreviewScene = PreviewScene;
