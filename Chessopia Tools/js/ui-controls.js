/**
 * UI Controller - ties together the preview scene, tree generator,
 * shadow baker, and exporter. Handles all DOM events and state.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    const state = {
        sunAzimuth: 45,
        sunElevation: 45,
        sunHeight: 50,
        autoRotate: false,
        autoRotateSpeed: 10,
        gridResolution: 32,
        worldSize: 3.0,
        numAngles: 12,
        includeTerrain: false,
        showGrid: false,
        shadowWireframe: false,
        windStrength: 0,
        windDirection: 0,
        animateWind: false,
        modelType: 'procedural-tree',
        bakedSet: null,
        currentBakedAngle: null,
    };

    // --- Components ---
    const preview = new PreviewScene('previewCanvas');
    const treeGen = new TreeGenerator();
    const baker = new ShadowBaker(preview.scene, preview.sunLight);
    const exporter = new ShadowSetExporter();

    // --- DOM refs ---
    const $ = id => document.getElementById(id);
    const sunAzimuth = $('sunAzimuth');
    const sunElevation = $('sunElevation');
    const sunHeight = $('sunHeight');
    const azimuthVal = $('azimuthVal');
    const elevationVal = $('elevationVal');
    const sunHeightVal = $('sunHeightVal');
    const autoRotate = $('autoRotateSun');
    const sunSpeed = $('sunSpeed');
    const gridResolution = $('gridResolution');
    const gridResVal = $('gridResVal');
    const gridWorldSize = $('gridWorldSize');
    const worldSizeVal = $('worldSizeVal');
    const numAngles = $('numAngles');
    const numAnglesVal = $('numAnglesVal');
    const includeTerrain = $('includeTerrain');
    const showGridOverlay = $('showGridOverlay');
    const shadowWireframe = $('shadowWireframe');
    const windStrength = $('windStrength');
    const windStrVal = $('windStrVal');
    const windDirection = $('windDirection');
    const windDirVal = $('windDirVal');
    const animateWind = $('animateWind');
    const modelSelect = $('modelSelect');
    const regenerateTree = $('regenerateTree');
    const glbUpload = $('glbUpload');
    const bakeSingle = $('bakeSingle');
    const bakeAll = $('bakeAll');
    const exportSet = $('exportSet');
    const bakeProgress = $('bakeProgress');
    const angleIndicator = $('angleIndicator');
    const shadowInfo = $('shadowInfo');
    const statVerts = $('statVerts');
    const statAngles = $('statAngles');
    const statData = $('statData');

    // --- Model management ---
    let currentTree = null;
    let animationTime = 0;

    function spawnModel() {
        if (currentTree) {
            treeGen.disposeTree(currentTree);
            preview.scene.remove(currentTree);
        }

        if (state.modelType === 'procedural-tree') {
            currentTree = treeGen.createTree();
        } else if (state.modelType === 'simple-tree') {
            currentTree = treeGen.createSimpleTree();
        } else {
            return; // GLB loaded separately
        }

        currentTree.position.set(0, 0, 0);
        // Tag for wind reset
        currentTree.userData._treeGenerator = treeGen;
        preview.addModel(currentTree);
    }

    spawnModel();

    // --- GLB upload ---
    function handleGLBUpload(file) {
        const reader = new FileReader();
        reader.onload = e => {
            const loader = new THREE.GLTFLoader();
            const arrayBuffer = e.target.result;
            loader.parse(arrayBuffer, '', gltf => {
                if (currentTree) {
                    preview.scene.remove(currentTree);
                }
                currentTree = gltf.scene;
                currentTree.userData.isGLB = true;
                currentTree.position.set(0, 0, 0);
                // Auto-scale to fit
                const box = new THREE.Box3().setFromObject(currentTree);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0 && maxDim < 0.1) {
                    currentTree.scale.setScalar(10 / maxDim);
                } else if (maxDim > 5) {
                    currentTree.scale.setScalar(2 / maxDim);
                }
                preview.addModel(currentTree);
                state.bakedSet = null;
                updateStats();
                exportSet.disabled = true;
                shadowInfo.textContent = 'No shadow baked';
                shadowInfo.className = 'no-shadow';
            }, err => {
                console.error('GLB load error:', err);
                alert('Failed to load GLB: ' + err.message);
            });
        };
        reader.readAsArrayBuffer(file);
    }

    glbUpload.addEventListener('change', e => {
        if (e.target.files[0]) {
            state.modelType = 'upload-glb';
            modelSelect.value = 'upload-glb';
            handleGLBUpload(e.target.files[0]);
        }
    });

    // Drag & drop
    document.body.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    document.body.addEventListener('drop', e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
            handleGLBUpload(file);
        }
    });

    // --- Sun update ---
    function updateSun() {
        preview.setSunPosition(state.sunAzimuth, state.sunElevation, state.sunHeight);
        azimuthVal.textContent = Math.round(state.sunAzimuth) + '\u00B0';
        elevationVal.textContent = Math.round(state.sunElevation) + '\u00B0';
        sunHeightVal.textContent = Math.round(state.sunHeight);
        angleIndicator.textContent = `Sun: ${Math.round(state.sunAzimuth)}\u00B0 / ${Math.round(state.sunElevation)}\u00B0`;
    }

    // --- Wind update ---
    function updateWind(time) {
        if (!currentTree) return;
        if (state.animateWind) {
            const windDir = THREE.Math.degToRad(state.windDirection);
            const str = state.windStrength;
            treeGen.applyWind(currentTree, time, windDir, str);
        } else if (state.windStrength === 0) {
            treeGen.resetTree(currentTree);
        } else {
            const windDir = THREE.Math.degToRad(state.windDirection);
            treeGen.applyWind(currentTree, 0, windDir, state.windStrength);
        }
    }

    // --- Bake single angle ---
    function doBakeSingle() {
        if (!currentTree) return;

        // Reset tree to neutral before baking
        treeGen.resetTree(currentTree);

        const params = {
            gridResolution: state.gridResolution,
            worldSize: state.worldSize,
            groundY: 0,
            azimuth: state.sunAzimuth,
            elevation: state.sunElevation,
            lightHeight: state.sunHeight
        };

        bakeProgress.textContent = 'Baking...';
        setTimeout(() => {
            try {
                const { mesh } = baker.bakePreview(currentTree, params, state.shadowWireframe);
                preview.removeShadowMesh();
                preview.scene.add(mesh);
                preview.shadowMesh = mesh;
                preview.shadowMesh.position.y = 0.03;
                preview.shadowMesh.renderOrder = 999;
                state.currentBakedAngle = baker.currentSet;
                state.bakedSet = baker.currentSet;

                shadowInfo.textContent = `Baked: ${state.gridResolution}\u00D7${state.gridResolution} grid`;
                shadowInfo.className = 'baked';
                bakeProgress.textContent = '';
                updateStats();
                exportSet.disabled = false;
            } catch (err) {
                console.error('Bake error:', err);
                bakeProgress.textContent = 'Error: ' + err.message;
            }
        }, 10);
    }

    // --- Bake all angles ---
    async function doBakeAll() {
        if (!currentTree) return;
        treeGen.resetTree(currentTree);

        const params = {
            gridResolution: state.gridResolution,
            worldSize: state.worldSize,
            groundY: 0,
            elevation: state.sunElevation,
            lightHeight: state.sunHeight,
            numAngles: state.numAngles,
            modelType: state.modelType
        };

        bakeProgress.textContent = `Baking 0/${state.numAngles} angles...`;
        bakeAll.disabled = true;
        bakeSingle.disabled = true;

        // Do actual bake
        setTimeout(() => {
            try {
                const set = baker.bakeAllAngles(currentTree, params);
                state.bakedSet = set;

                // Show preview of current sun angle using first baked angle
                const sunParams = {
                    gridResolution: set.gridResolution,
                    worldSize: set.worldSize,
                    groundY: set.groundY,
                    azimuth: state.sunAzimuth,
                    elevation: state.sunElevation,
                    lightHeight: state.sunHeight
                };
                const nearest = set.angles.reduce((best, a) => {
                    const da = Math.abs(a.azimuth - state.sunAzimuth);
                    const wrap = Math.min(da, 360 - da);
                    return wrap < best.wrap ? { angle: a, wrap } : best;
                }, { wrap: Infinity }).angle;
                if (nearest) {
                    const mesh = baker.createPreviewFromHeights(
                        nearest.heights,
                        set.gridResolution, set.worldSize,
                        new THREE.Vector3(0, 0, 0),
                        set.groundY, state.shadowWireframe
                    );
                    preview.removeShadowMesh();
                    preview.scene.add(mesh);
                    preview.shadowMesh = mesh;
                    preview.shadowMesh.position.y = 0.03;
                    preview.shadowMesh.renderOrder = 999;
                }

                bakeProgress.textContent = `Done! ${state.numAngles} angles baked`;
                exportSet.disabled = false;
                updateStats();

                // Show preview of current angle
                doBakeSingle();
            } catch (err) {
                console.error('Bake all error:', err);
                bakeProgress.textContent = 'Error: ' + err.message;
            } finally {
                bakeAll.disabled = false;
                bakeSingle.disabled = false;
            }
        }, 10);
    }

    // --- Export ---
    function doExport() {
        if (!state.bakedSet) return;
        const type = state.modelType.replace(/[^a-z0-9]/gi, '_');
        const filename = `shadowset_${type}_${state.gridResolution}x${state.numAngles}.json`;
        exporter.exportJSON(state.bakedSet, filename);
        bakeProgress.textContent = `Exported: ${filename}`;
    }

    // --- Stats ---
    function updateStats() {
        if (!state.bakedSet) {
            statVerts.textContent = state.gridResolution * state.gridResolution;
            statAngles.textContent = state.numAngles;
            statData.textContent = '--';
            return;
        }
        const stats = exporter.getStats(state.bakedSet);
        if (stats) {
            statVerts.textContent = stats.verts;
            statAngles.textContent = stats.angles;
            statData.textContent = stats.kb + ' KB';
        }
    }
    updateStats();

    // --- Event Listeners ---
    sunAzimuth.addEventListener('input', e => {
        state.sunAzimuth = parseFloat(e.target.value);
        updateSun();
        if (!state.autoRotate) doBakeSingle();
    });

    sunElevation.addEventListener('input', e => {
        state.sunElevation = parseFloat(e.target.value);
        updateSun();
        if (!state.autoRotate) doBakeSingle();
    });

    sunHeight.addEventListener('input', e => {
        state.sunHeight = parseFloat(e.target.value);
        sunHeightVal.textContent = state.sunHeight;
        updateSun();
    });

    autoRotate.addEventListener('change', e => {
        state.autoRotate = e.target.checked;
    });

    gridResolution.addEventListener('input', e => {
        state.gridResolution = parseInt(e.target.value);
        gridResVal.textContent = state.gridResolution;
        updateStats();
    });

    gridWorldSize.addEventListener('input', e => {
        state.worldSize = parseFloat(e.target.value);
        worldSizeVal.textContent = state.worldSize.toFixed(1);
    });

    numAngles.addEventListener('input', e => {
        state.numAngles = parseInt(e.target.value);
        numAnglesVal.textContent = state.numAngles;
        updateStats();
    });

    showGridOverlay.addEventListener('change', e => {
        state.showGrid = e.target.checked;
        preview.setGridOverlay(state.showGrid);
    });

    shadowWireframe.addEventListener('change', e => {
        state.shadowWireframe = e.target.checked;
        if (state.currentBakedAngle) doBakeSingle();
    });

    windStrength.addEventListener('input', e => {
        state.windStrength = parseFloat(e.target.value);
        windStrVal.textContent = state.windStrength.toFixed(2);
    });

    windDirection.addEventListener('input', e => {
        state.windDirection = parseFloat(e.target.value);
        windDirVal.textContent = state.windDirection + '\u00B0';
    });

    modelSelect.addEventListener('change', e => {
        state.modelType = e.target.value;
        if (state.modelType === 'upload-glb') {
            glbUpload.click();
            modelSelect.value = currentTree?.userData.isGLB ? 'upload-glb' : 'procedural-tree';
            state.modelType = modelSelect.value;
        } else {
            spawnModel();
        }
    });

    regenerateTree.addEventListener('click', () => {
        if (state.modelType === 'procedural-tree' || state.modelType === 'simple-tree') {
            spawnModel();
            doBakeSingle();
        }
    });

    bakeSingle.addEventListener('click', doBakeSingle);
    bakeAll.addEventListener('click', doBakeAll);
    exportSet.addEventListener('click', doExport);

    // --- Animation Loop ---
    preview.onAnimate = delta => {
        animationTime += delta;

        if (state.autoRotate) {
            state.sunAzimuth = (state.sunAzimuth + state.autoRotateSpeed * delta * 5) % 360;
            sunAzimuth.value = state.sunAzimuth;
            updateSun();
        }

        if (state.animateWind || state.windStrength > 0) {
            updateWind(animationTime);
        }
    };

    // --- Init sun ---
    updateSun();
    doBakeSingle();
});
