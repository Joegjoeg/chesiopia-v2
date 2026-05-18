/**
 * Enhanced Dev Interface with Transparent Background
 * Comprehensive parameter controls for all world systems
 */
class DevInterface {
    constructor() {
        this.isVisible = false;
        this.container = null;
        this.parameterSystem = window.parameterSystem;
        this.categories = ['terrain', 'planet', 'lighting', 'time', 'environment', 'graphics', 'taa', 'performance', 'lod', 'water', 'shoreline', 'landCover', 'cliff', 'tree', 'blending', 'verts', 'camera', 'sky', 'stars', 'rig', 'checkerboard', 'models', 'jesus'];
        this.categoryCache = new Map(); // Cache DOM elements for each category
        this.activeCategories = new Set(); // Multiple categories can be active
        this._jesusStatusInterval = null;
        this._taaStatusInterval = null;
        this._taaStatusRefs = null;
        this.memoryPanelMount = null;
        this._edgePairCache = this._loadEdgePairsFromStorage();
        
        this.init();
        console.log('[DevInterface] Enhanced dev interface initialized');
    }
    
    init() {
        this.createInterface();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.createMobileDevButton();
    }

    createMobileDevButton() {
        const btn = document.createElement('button');
        btn.id = 'mobileDevBtn';
        btn.textContent = 'Dev';
        btn.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: #000080;
            color: #fff;
            font-size: 12px;
            font-weight: bold;
            font-family: 'Segoe UI', sans-serif;
            border: 2px solid #fff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            z-index: 10001;
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        `;

        btn.onclick = () => {
            const isDev = window.authState && window.authState.isDev();
            if (isDev) {
                this.toggle();
            } else {
                console.log('[DevInterface] Dev tools restricted to dev users only');
            }
        };

        document.body.appendChild(btn);
        this.mobileDevBtn = btn;

        // Show button for dev users when auth state changes
        const updateVisibility = () => {
            const isDev = window.authState && window.authState.isDev();
            btn.style.display = isDev ? 'flex' : 'none';
        };

        if (window.authState) {
            window.authState.onChange(updateVisibility);
            updateVisibility();
        }
    }

    _slugBiomeName(name, idx) {
        if (!name || typeof name !== 'string') {
            return `biome${idx}`;
        }
        return name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || `biome${idx}`;
    }

    _edgePairKeyCandidates(a, b) {
        const base = `edge_${a}_${b}`;
        const names = this._biomeNames || [];
        const nameA = names[a];
        const nameB = names[b];
        if (!nameA || !nameB) {
            return [base];
        }
        const canonical = `edge_${a}_${b}_${this._slugBiomeName(nameA, a)}_${this._slugBiomeName(nameB, b)}`;
        if (canonical === base) return [canonical];
        return [canonical, base];
    }

    _edgePairKey(a, b) {
        return this._edgePairKeyCandidates(a, b)[0];
    }

    _edgePairStorageKey() {
        return 'chesiopia-edge-pairs';
    }

    _loadEdgePairsFromStorage() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return {};
            const raw = window.localStorage.getItem(this._edgePairStorageKey());
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            console.warn('[DevInterface] Failed to load edge pair cache:', err);
            return {};
        }
    }

    _persistEdgePairs() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            window.localStorage.setItem(this._edgePairStorageKey(), JSON.stringify(this._edgePairCache || {}));
        } catch (err) {
            console.warn('[DevInterface] Failed to persist edge pair cache:', err);
        }
    }

    _getPairEdgeSettings(biomeA, biomeB) {
        if (!this._edgePairCache) this._edgePairCache = {};
        const candidates = this._edgePairKeyCandidates(biomeA, biomeB);
        for (const key of candidates) {
            const stored = this._edgePairCache[key];
            if (stored) {
                const clone = Object.assign({}, stored);
                if (key !== candidates[0]) {
                    this._edgePairCache[candidates[0]] = clone;
                    delete this._edgePairCache[key];
                    this._persistEdgePairs();
                }
                return { key: candidates[0], data: clone };
            }
        }
        return { key: candidates[0], data: null };
    }

    _savePairEdgeSettings(biomeA, biomeB) {
        if (!this._edgePairCache) this._edgePairCache = {};
        const key = this._edgePairKey(biomeA, biomeB);
        const snapshot = {
            mode: this.parameterSystem.getParameter('biomeEdgeMode'),
            scale: this.parameterSystem.getParameter('biomeEdgeScale'),
            strength: this.parameterSystem.getParameter('biomeEdgeStrength'),
            splatScale: this.parameterSystem.getParameter('biomeSplatterScale'),
            splatAmt: this.parameterSystem.getParameter('biomeSplatterAmount'),
            edgeSplatMix: this.parameterSystem.getParameter('biomeEdgeSplatterMix')
        };
        this._edgePairCache[key] = snapshot;
        const candidates = this._edgePairKeyCandidates(biomeA, biomeB);
        candidates.forEach(candidate => {
            if (candidate !== key) delete this._edgePairCache[candidate];
        });
        this._persistEdgePairs();
        return { key, data: Object.assign({}, snapshot) };
    }

    _applyPairEdgeSettings(biomeA, biomeB, saved) {
        const ps = this.parameterSystem;
        const applyValue = (paramName, val) => {
            const paramCfg = ps.params.get(paramName);
            const nextVal = val !== undefined && val !== null
                ? val
                : (paramCfg ? paramCfg.defaultValue : undefined);
            if (nextVal !== undefined) {
                ps.setParameter(paramName, nextVal, 'ui-sync', { clamp: false });
            }
        };
        ps.setParameter('biomeEdgeA', biomeA, 'ui-sync');
        ps.setParameter('biomeEdgeB', biomeB, 'ui-sync');
        if (saved) {
            applyValue('biomeEdgeMode', saved.mode);
            applyValue('biomeEdgeScale', saved.scale);
            applyValue('biomeEdgeStrength', saved.strength);
            applyValue('biomeSplatterScale', saved.splatScale);
            applyValue('biomeSplatterAmount', saved.splatAmt);
            applyValue('biomeEdgeSplatterMix', saved.edgeSplatMix);
        } else {
            applyValue('biomeEdgeMode');
            applyValue('biomeEdgeScale');
            applyValue('biomeEdgeStrength');
            applyValue('biomeSplatterScale');
            applyValue('biomeSplatterAmount');
            applyValue('biomeEdgeSplatterMix');
        }
    }

    _addRigKeyframesAtTime(section, rig, hours, board) {
        if (!section || !rig || !rig.lights || !board || typeof board.interpolateRig !== 'function') return;
        const clampedHours = Math.max(0, Math.min(24, hours));
        const time = Math.round(clampedHours * 10) / 10;
        const lightKeys = Object.keys(rig.lights);
        lightKeys.forEach(key => {
            const kfs = rig.lights[key];
            if (!Array.isArray(kfs)) return;
            const state = board.interpolateRig(kfs, time);
            const newKf = {
                time,
                color: state && state.color ? '#' + state.color.getHexString() : '#ffffff',
                intensity: state ? Math.round(state.intensity * 100) / 100 : 0
            };
            kfs.push(newKf);
            kfs.sort((a, b) => a.time - b.time);
            if (section._rigTrackRefs && section._rigTrackRefs[key]) {
                section._rigTrackRefs[key]._selectedIndex = kfs.indexOf(newKf);
            }
        });
        this._refreshRigUI(section, rig);
        this._saveRigToStorage(rig);
    }
    
    createInterface() {
        // Create main container with transparent background
        this.container = document.createElement('div');
        this.container.id = 'enhancedDevInterface';
        this.container.style.cssText = `
            position: fixed;
            top: 5px;
            right: 5px;
            width: 360px;
            max-height: 95vh;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            padding: 8px 10px;
            font-family: 'Segoe UI', 'Roboto', sans-serif;
            font-size: 11px;
            color: #00ff00;
            display: none;
            overflow-y: auto;
            z-index: 10000;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
        `;
        
        // Create compact header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            padding-bottom: 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        `;

        const title = document.createElement('h3');
        title.textContent = '🛠️ Dev Tools';
        title.style.cssText = `
            margin: 0;
            color: #00ff00;
            font-size: 11px;
            font-weight: 600;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #ff6666;
            font-size: 14px;
            cursor: pointer;
            padding: 0;
            width: 16px;
            height: 16px;
            line-height: 16px;
        `;
        closeBtn.onclick = () => this.hide();
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        this.container.appendChild(header);

        // Memory telemetry mount (populated by MemoryProfiler)
        this.memoryPanelMount = document.createElement('div');
        this.memoryPanelMount.id = 'devMemoryPanelMount';
        this.memoryPanelMount.style.cssText = `
            margin-bottom: 6px;
            padding: 6px 8px 8px 8px;
            border-radius: 6px;
            background: rgba(0, 15, 0, 0.45);
            border: 1px solid rgba(0, 255, 0, 0.12);
            box-shadow: inset 0 0 12px rgba(0, 255, 60, 0.05);
        `;

        const memoryHeader = document.createElement('div');
        memoryHeader.textContent = 'MEMORY MONITOR';
        memoryHeader.style.cssText = `
            font-size: 9px;
            font-weight: 600;
            letter-spacing: 0.5px;
            color: #8fffb8;
            margin-bottom: 4px;
        `;
        this.memoryPanelMount.appendChild(memoryHeader);

        this.memoryPanelBody = document.createElement('div');
        this.memoryPanelBody.dataset.memoryPanelBody = '1';
        this.memoryPanelBody.textContent = 'Initializing memory profiler…';
        this.memoryPanelBody.style.cssText = `
            font-size: 9px;
            color: #6aa;
            opacity: 0.8;
        `;
        this.memoryPanelMount.appendChild(this.memoryPanelBody);

        this.container.appendChild(this.memoryPanelMount);
        
        // Create compact tab navigation (toggle buttons)
        const tabNav = document.createElement('div');
        tabNav.style.cssText = `
            display: flex;
            gap: 3px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        `;

        const categoryLabels = { shoreline: 'Shore', landCover: 'Land', graphics: 'GRA', taa: 'TAA', tree: 'TRE', blending: 'BLD', verts: 'GEO', camera: 'CAM', rig: 'RIG', checkerboard: 'CHK', models: 'MDL', jesus: 'JES' };
        this.categories.forEach(category => {
            const tab = document.createElement('button');
            tab.textContent = (categoryLabels[category] || category.slice(0, 3)).toUpperCase();
            tab.dataset.category = category;
            tab.title = category;
            tab.style.cssText = `
                background: rgba(0, 255, 0, 0.08);
                border: 1px solid rgba(0, 255, 0, 0.2);
                color: #00ff00;
                padding: 3px 6px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 10px;
                font-weight: 500;
                transition: all 0.15s;
                min-width: 36px;
            `;
            tab.onclick = () => this.toggleCategory(category);
            tabNav.appendChild(tab);
        });
        
        this.container.appendChild(tabNav);
        
        // Create content area (scrollable, holds multiple category sections)
        this.contentArea = document.createElement('div');
        this.contentArea.id = 'devContentArea';
        this.contentArea.style.cssText = `
            max-height: 70vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;
        
        this.container.appendChild(this.contentArea);

        // Game actions section
        const actionsSection = document.createElement('div');
        actionsSection.style.cssText = `
            margin-top: 6px;
            padding-top: 4px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        `;
        const actionsTitle = document.createElement('div');
        actionsTitle.textContent = 'ACTIONS';
        actionsTitle.style.cssText = `
            font-size: 9px;
            font-weight: 600;
            color: #00ff00;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        `;
        actionsSection.appendChild(actionsTitle);

        const gameActionsGrid = document.createElement('div');
        gameActionsGrid.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 3px;
        `;

        const gameActions = [
            { text: 'Clear', title: 'Clear All Pieces', action: () => this.clearAllPieces(), color: '#ff4444' },
            { text: 'Spawn', title: 'Spawn Test Pieces', action: () => this.spawnTestPieces(), color: '#ff8800' },
            { text: 'Cel', title: 'Toggle Cel Shading', action: () => this.toggleCelShading(), color: '#9966ff' },
            { text: 'Map', title: 'Recreate Map', action: () => this.recreateMap(), color: '#ff0066' },
            { text: 'Err', title: 'Test Server Error', action: () => this.testServerError(), color: '#ff0000' },
            { text: 'Respawn', title: 'Respawn (Flying Castle)', action: () => this.startRespawn(), color: '#4488ff' }
        ];

        gameActions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.text;
            btn.title = action.title;
            btn.style.cssText = `
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid ${action.color}40;
                color: ${action.color};
                padding: 4px 2px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 9px;
                font-weight: 500;
                transition: all 0.15s;
                white-space: nowrap;
            `;
            btn.onclick = action.action;
            gameActionsGrid.appendChild(btn);
        });
        actionsSection.appendChild(gameActionsGrid);
        this.container.appendChild(actionsSection);

        // Live stats bar
        const statsSection = document.createElement('div');
        statsSection.style.cssText = `
            margin-top: 6px;
            padding: 5px 6px;
            background: rgba(0, 20, 0, 0.3);
            border: 1px solid rgba(0, 255, 0, 0.1);
            border-radius: 4px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
            font-size: 9px;
            color: #aaffaa;
        `;

        const windStat = document.createElement('div');
        windStat.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        windStat.innerHTML = '<span>🌬️</span> <span id="windSpeed">0</span>';
        statsSection.appendChild(windStat);

        const compassContainer = document.createElement('div');
        compassContainer.style.cssText = 'width: 18px; height: 18px; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; position: relative; background: rgba(0,0,0,0.2); justify-self: end;';
        compassContainer.innerHTML = '<div id="windArrow" style="position: absolute; top: 50%; left: 50%; width: 0; height: 0; margin-left: -2px; margin-top: -5px; border-left: 2px solid transparent; border-right: 2px solid transparent; border-bottom: 8px solid rgba(255,200,100,0.8); transform-origin: 50% 100%; transform: rotate(0deg);"></div>';
        statsSection.appendChild(compassContainer);

        const dayStat = document.createElement('div');
        dayStat.innerHTML = '⏰ <span id="dayTime">12:00</span>';
        statsSection.appendChild(dayStat);

        const seasonStat = document.createElement('div');
        seasonStat.innerHTML = '🌸 <span id="seasonProgress">Spring</span>';
        seasonStat.style.cssText = 'text-align: right;';
        statsSection.appendChild(seasonStat);

        const vertStat = document.createElement('div');
        vertStat.innerHTML = '📊 V: <span id="vertexCount">-</span>';
        statsSection.appendChild(vertStat);

        const triStat = document.createElement('div');
        triStat.innerHTML = 'T: <span id="triangleCount">-</span>';
        triStat.style.cssText = 'text-align: right;';
        statsSection.appendChild(triStat);

        const camDistStat = document.createElement('div');
        camDistStat.innerHTML = '📷 D: <span id="cameraRayDist">-</span>';
        statsSection.appendChild(camDistStat);

        const camObjStat = document.createElement('div');
        camObjStat.innerHTML = '🎯 <span id="cameraRayObj">-</span>';
        camObjStat.style.cssText = 'text-align: right;';
        statsSection.appendChild(camObjStat);

        this.container.appendChild(statsSection);

        // Create compact quick actions
        const quickActions = document.createElement('div');
        quickActions.style.cssText = `
            margin-top: 6px;
            padding-top: 4px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const actionButtons = document.createElement('div');
        actionButtons.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr 1fr 1fr;
            gap: 3px;
        `;

        const actions = [
            { text: 'Reset', action: () => this.resetAllParameters(), color: '#ff8888' },
            { text: 'Rand', action: () => this.randomizeParameters(), color: '#ffaa44' },
            { text: 'Export', action: () => this.exportConfiguration(), color: '#00aaff' },
            { text: 'Import', action: () => this.importConfiguration(), color: '#00aaff' },
            { text: 'Save Def', action: () => this.saveDefaults(), color: '#00ff88' },
            { text: 'Set Def', action: () => this.setDefaultEnv(), color: '#ffaa44' },
            { text: 'Clear Def', action: () => this.clearDefaults(), color: '#ff4444' },
            { text: 'Photo', action: () => this.takeScreenshot(), color: '#00ff88' },
            { text: 'Logs', action: () => this.getClientLogs(), color: '#aa88ff' },
            { text: 'Ray', action: () => this.toggleRaycastDot(), color: '#ff4444' }
        ];

        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.text;
            btn.style.cssText = `
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid ${action.color}40;
                color: ${action.color};
                padding: 3px 4px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 8px;
                transition: all 0.15s;
            `;
            btn.onclick = action.action;
            actionButtons.appendChild(btn);
            if (action.text === 'Ray') this.raycastBtn = btn;
        });

        quickActions.appendChild(actionButtons);
        this.container.appendChild(quickActions);
        
        document.body.appendChild(this.container);
    }

    getMemoryPanelMount() {
        return this.memoryPanelBody || this.memoryPanelMount;
    }
    
    toggleCategory(category) {
        // Toggle category on/off
        if (this.activeCategories.has(category)) {
            // Hide this category
            this.activeCategories.delete(category);
            if (this.categoryCache.has(category)) {
                const content = this.categoryCache.get(category);
                if (content.parentNode === this.contentArea) {
                    this.contentArea.removeChild(content);
                }
            }
            if (category === 'taa') {
                this._stopTaaStatusPolling();
            }
        } else {
            // Show this category
            this.activeCategories.add(category);
            if (!this.categoryCache.has(category)) {
                const categoryContent = this.createCategoryContent(category);
                this.categoryCache.set(category, categoryContent);
            }
            this.contentArea.appendChild(this.categoryCache.get(category));
            if (category === 'taa') {
                this._startTaaStatusPolling();
            }
        }
        this.updateTabStyles();
        if (category === 'verts') {
            if (this.activeCategories.has(category)) this._startGeometryPolling();
            else this._stopGeometryPolling();
        }
        if (category === 'jesus') {
            if (this.activeCategories.has(category)) this._startJesusStatusPolling();
            else this._stopJesusStatusPolling();
        }
    }

    updateTabStyles() {
        const tabs = this.container.querySelectorAll('[data-category]');
        tabs.forEach(tab => {
            const cat = tab.dataset.category;
            if (this.activeCategories.has(cat)) {
                tab.style.background = 'rgba(0, 255, 0, 0.25)';
                tab.style.borderColor = 'rgba(0, 255, 0, 0.5)';
                tab.style.color = '#00ff00';
            } else {
                tab.style.background = 'rgba(0, 255, 0, 0.05)';
                tab.style.borderColor = 'rgba(0, 255, 0, 0.15)';
                tab.style.color = '#88aa88';
            }
        });
    }

    // Legacy method - now just toggles
    showCategory(category) {
        this.toggleCategory(category);
    }
    
    createCategoryContent(category) {
        if (category === 'verts') {
            return this._createGeometryContent();
        }
        if (category === 'blending') {
            return this._createBlendingContent();
        }
        if (category === 'rig') {
            return this._createRigContent();
        }
        if (category === 'checkerboard') {
            return this._createCheckerboardContent();
        }
        if (category === 'cliff') {
            return this._createCliffContent();
        }
        if (category === 'models') {
            return this._createModelsContent();
        }
        if (category === 'jesus') {
            return this._createJesusContent();
        }
        if (category === 'taa') {
            return this._createTaaContent();
        }
        return this._buildParameterSection(category);
    }

    _buildParameterSection(category) {
        const parameters = this.parameterSystem.getParametersByCategory(category);
        const section = document.createElement('div');
        section.dataset.categorySection = category;
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
        `;

        const categoryHeader = document.createElement('div');
        categoryHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 0 0 4px 0;
            padding-bottom: 2px;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
        `;

        const title = document.createElement('span');
        title.textContent = category.toUpperCase();
        title.style.cssText = `
            font-size: 9px;
            font-weight: 600;
            color: #00ff00;
            letter-spacing: 0.5px;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #ff6666;
            font-size: 10px;
            cursor: pointer;
            padding: 0;
            width: 12px;
            height: 12px;
            line-height: 12px;
        `;
        closeBtn.onclick = () => this.toggleCategory(category);

        categoryHeader.appendChild(title);
        categoryHeader.appendChild(closeBtn);
        section.appendChild(categoryHeader);

        const paramsContainer = document.createElement('div');
        paramsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 3px;';

        Object.entries(parameters).forEach(([name, config]) => {
            // Skip params that don't match their showIf condition
            if (config.showIf) {
                const controllingValue = this.parameterSystem.getParameter(config.showIf.param);
                const expected = config.showIf.value;
                const expectedArr = Array.isArray(expected) ? expected : [expected];
                if (!expectedArr.includes(controllingValue)) {
                    return;
                }
            }
            const paramRow = document.createElement('div');
            paramRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 0;
                border-bottom: 1px solid rgba(0, 255, 0, 0.05);
            `;

            const label = document.createElement('span');
            const displayLabel = config.shortLabel || config.description || name;
            label.textContent = displayLabel.slice(0, 26);
            label.title = displayLabel;
            label.style.cssText = `
                font-size: 9px;
                color: #aaffaa;
                width: 90px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            paramRow.appendChild(label);

            if (config.type === 'boolean') {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !!config.value;
                checkbox.dataset.parameter = name;
                checkbox.style.cssText = `
                    width: 14px;
                    height: 14px;
                    cursor: pointer;
                    accent-color: #00ff00;
                `;
                checkbox.addEventListener('change', (e) => {
                    console.log(`[DevInterface] Checkbox "${name}" ->`, e.target.checked);
                    this.parameterSystem.setParameter(name, e.target.checked);
                });
                paramRow.appendChild(checkbox);
            } else if (config.type === 'color') {
                const control = document.createElement('input');
                control.type = 'color';
                control.value = config.value;
                control.dataset.parameter = name;
                control.style.cssText = `
                    width: 28px;
                    height: 16px;
                    border: 1px solid rgba(0, 255, 0, 0.3);
                    border-radius: 2px;
                    background: rgba(0, 0, 0, 0.5);
                    padding: 0;
                    cursor: pointer;
                `;
                control.addEventListener('input', (e) => {
                    this.parameterSystem.setParameter(name, e.target.value);
                });
                paramRow.appendChild(control);
            } else if (config.type === 'select') {
                const select = document.createElement('select');
                select.dataset.parameter = name;
                select.style.cssText = `
                    flex: 1;
                    background: rgba(0, 0, 0, 0.5);
                    border: 1px solid rgba(0, 255, 0, 0.3);
                    color: #00ff00;
                    padding: 2px 4px;
                    border-radius: 2px;
                    font-size: 9px;
                    cursor: pointer;
                `;
                const opts = config.options || [];
                console.log(`[DevInterface] Building select "${name}": ${opts.length} options, default="${config.value}"`);
                opts.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label || opt.value;
                    if (opt.value === config.value) option.selected = true;
                    select.appendChild(option);
                });
                if (opts.length === 0) {
                    console.warn(`[DevInterface] Select "${name}" has ZERO options!`);
                }
                select.addEventListener('change', (e) => {
                    console.log(`[DevInterface] Select "${name}" changed to:`, e.target.value);
                    const rawValue = e.target.value;
                    const nextValue = typeof config.value === 'number' ? parseFloat(rawValue) : rawValue;
                    this.parameterSystem.setParameter(name, nextValue);
                    if (config.rebuildCategory) {
                        const cat = config.category;
                        if (cat && this.activeCategories.has(cat)) {
                            const old = this.categoryCache.get(cat);
                            if (old && old.parentNode === this.contentArea) {
                                this.contentArea.removeChild(old);
                            }
                            this.categoryCache.delete(cat);
                            const newContent = this.createCategoryContent(cat);
                            this.categoryCache.set(cat, newContent);
                            this.contentArea.appendChild(newContent);
                        }
                    }
                });
                paramRow.appendChild(select);
            } else if (config.type === 'modifierStack') {
                const stack = config.value || ModifierStack.defaultStack();
                const count = stack.layers ? stack.layers.length : 0;
                const summary = document.createElement('div');
                summary.style.cssText = `
                    flex: 1;
                    font-size: 9px;
                    color: #aaffaa;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                `;
                summary.innerHTML = `<span>${count} layers</span>`;
                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                editBtn.style.cssText = `
                    background: rgba(0, 255, 0, 0.1);
                    border: 1px solid rgba(0, 255, 0, 0.3);
                    color: #00ff00;
                    padding: 2px 6px;
                    border-radius: 2px;
                    font-size: 9px;
                    cursor: pointer;
                `;
                editBtn.onclick = () => this.toggleCategory('modifier');
                summary.appendChild(editBtn);
                paramRow.appendChild(summary);
            } else {
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = -100;
                slider.max = 100;
                slider.step = 1;
                slider.value = 0;
                slider.style.cssText = `
                    flex: 1;
                    height: 3px;
                    background: rgba(0, 255, 0, 0.15);
                    outline: none;
                    margin: 0;
                `;

                const valueDisplay = document.createElement('span');
                valueDisplay.className = 'param-value';
                valueDisplay.textContent = config.value;
                valueDisplay.style.cssText = `
                    font-size: 9px;
                    color: #00ff00;
                    width: 28px;
                    text-align: right;
                    flex-shrink: 0;
                `;

                const numberInput = document.createElement('input');
                numberInput.type = 'number';
                numberInput.step = config.step || 1;
                numberInput.value = config.value;
                numberInput.style.cssText = `
                    width: 38px;
                    background: rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(0, 255, 0, 0.2);
                    color: #00ff00;
                    padding: 1px 3px;
                    border-radius: 2px;
                    font-size: 8px;
                    text-align: right;
                `;

                let lastSliderVal = 0;
                slider.addEventListener('input', (e) => {
                    const sliderVal = parseFloat(e.target.value);
                    const rawDelta = sliderVal - lastSliderVal;
                    lastSliderVal = sliderVal;

                    const dist = Math.abs(sliderVal);
                    const paramStep = config.step || 1;
                    const sensitivity = paramStep * (0.1 + dist / 200);

                    const currentValue = this.parameterSystem.getParameter(name) || config.value;
                    let newValue = currentValue + rawDelta * sensitivity;

                    const min = config.min !== undefined ? config.min : -Infinity;
                    const max = config.max !== undefined ? config.max : Infinity;
                    newValue = Math.max(min, Math.min(max, newValue));

                    numberInput.value = newValue;
                    console.log(`[DevInterface] Slider "${name}" delta=${rawDelta} sens=${sensitivity.toFixed(4)} ->`, newValue);
                    this.parameterSystem.setParameter(name, newValue, 'user', { clamp: false });
                });

                slider.addEventListener('change', () => {
                    slider.value = 0;
                    lastSliderVal = 0;
                });

                numberInput.addEventListener('input', (e) => {
                    let value = parseFloat(e.target.value);
                    const min = config.min !== undefined ? config.min : -Infinity;
                    const max = config.max !== undefined ? config.max : Infinity;
                    value = Math.max(min, Math.min(max, value));
                    if (value >= min && value <= max) {
                        slider.value = value;
                    }
                    console.log(`[DevInterface] Number "${name}" ->`, value);
                    this.parameterSystem.setParameter(name, value, 'user', { clamp: false });
                });

                paramRow.dataset.parameter = name;
                paramRow.appendChild(slider);
                paramRow.appendChild(valueDisplay);
                paramRow.appendChild(numberInput);
            }

            const resetBtn = document.createElement('button');
            resetBtn.textContent = '↺';
            resetBtn.title = 'Reset to default';
            resetBtn.style.cssText = `
                background: ${config.userOverridden ? 'rgba(255,100,100,0.2)' : 'transparent'};
                border: ${config.userOverridden ? '1px solid rgba(255,100,100,0.4)' : 'none'};
                color: ${config.userOverridden ? '#ff8888' : '#444'};
                padding: 0;
                width: 14px;
                height: 14px;
                border-radius: 2px;
                cursor: ${config.userOverridden ? 'pointer' : 'default'};
                font-size: 9px;
                line-height: 14px;
                visibility: ${config.userOverridden ? 'visible' : 'hidden'};
            `;
            resetBtn.onclick = () => {
                this.parameterSystem.resetParameter(name);
                const p = this.parameterSystem.getAllParameters()[name];
                if (p) {
                    this.updateParameterDisplay(name, p.value);
                    resetBtn.style.visibility = 'hidden';
                }
            };
            paramRow.appendChild(resetBtn);

            paramsContainer.appendChild(paramRow);
        });

        section.appendChild(paramsContainer);
        return section;
    }

    _createTaaContent() {
        const section = this._buildParameterSection('taa');
        const statusCard = document.createElement('div');
        statusCard.style.cssText = `
            margin-bottom: 6px;
            padding: 4px 6px;
            border-radius: 3px;
            background: rgba(0, 20, 0, 0.35);
            border: 1px solid rgba(0, 255, 0, 0.1);
            box-shadow: inset 0 0 6px rgba(0, 255, 0, 0.05);
            font-size: 9px;
            color: #b9ffcf;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const grid = document.createElement('div');
        grid.style.cssText = `
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 2px 6px;
            align-items: center;
        `;

        const refs = {
            support: document.createElement('span'),
            enabled: document.createElement('span'),
            active: document.createElement('span'),
            samples: document.createElement('span'),
            jitter: document.createElement('span'),
            resolution: document.createElement('span'),
            reset: document.createElement('span')
        };

        const makeRow = (label, ref) => {
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'text-transform: uppercase; letter-spacing: 0.5px; color: #7effa3; font-size: 8px;';
            ref.style.cssText = 'text-align: right; font-weight: 600; color: #e4ffe8;';
            grid.appendChild(lbl);
            grid.appendChild(ref);
        };

        makeRow('Support', refs.support);
        makeRow('Enabled', refs.enabled);
        makeRow('Active', refs.active);
        makeRow('Samples', refs.samples);
        makeRow('Jitter', refs.jitter);
        makeRow('Resolution', refs.resolution);
        makeRow('History', refs.reset);

        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:4px;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset History';
        resetBtn.style.cssText = `
            background: rgba(0, 255, 0, 0.08);
            border: 1px solid rgba(0, 255, 0, 0.3);
            color: #aaffc4;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            cursor: pointer;
        `;
        resetBtn.onclick = () => {
            const taa = window.game && window.game.temporalAA;
            if (taa) {
                taa.resetHistory('devtools');
                this._updateTaaStatusCard();
                console.log('[DevInterface] Temporal AA history reset via dev tools');
            } else {
                console.warn('[DevInterface] Temporal AA system not available');
            }
        };
        buttonRow.appendChild(resetBtn);

        statusCard.appendChild(grid);
        statusCard.appendChild(buttonRow);
        section.insertBefore(statusCard, section.children[1] || null);

        this._taaStatusRefs = refs;
        this._updateTaaStatusCard();
        if (this.activeCategories.has('taa')) {
            this._startTaaStatusPolling();
        }
        return section;
    }

    _updateTaaStatusCard() {
        if (!this._taaStatusRefs) return;
        const refs = this._taaStatusRefs;
        const game = window.game;
        const taa = game && game.temporalAA;
        if (!taa) {
            Object.values(refs).forEach(ref => { ref.textContent = '—'; ref.style.color = '#888'; });
            return;
        }
        const status = taa.getStatus();
        refs.support.textContent = status.supported ? 'Yes' : 'No';
        refs.enabled.textContent = status.enabled ? 'ON' : 'OFF';
        refs.active.textContent = status.active ? 'Accumulating' : 'Warming';
        refs.samples.textContent = status.accumulatedSamples.toString();
        refs.jitter.textContent = `${status.jitterIndex + 1}/${status.jitterSpan}`;
        refs.resolution.textContent = `${status.resolution} @${status.pixelRatio}x`;
        refs.reset.textContent = `${status.historyResets} (${status.lastResetReason || '-'})`;
        refs.enabled.style.color = status.enabled ? '#a4ffb0' : '#ff9a9a';
        refs.active.style.color = status.active ? '#a4ffb0' : '#ffd27f';
    }

    _startTaaStatusPolling() {
        if (this._taaStatusInterval || !this._taaStatusRefs) return;
        this._taaStatusInterval = setInterval(() => this._updateTaaStatusCard(), 750);
        this._updateTaaStatusCard();
    }

    _stopTaaStatusPolling() {
        if (this._taaStatusInterval) {
            clearInterval(this._taaStatusInterval);
            this._taaStatusInterval = null;
        }
    }
    
    // Legacy - no longer used with additive categories
    showCachedCategory(category) {
        // Categories are now additive, handled by toggleCategory
    }
    
    setupEventListeners() {
        // Listen for parameter updates from server
        if (window.game && window.game.networkManager) {
            window.game.networkManager.on('parameterUpdate', (data) => {
                const { name, value } = data;
                this.updateParameterDisplay(name, value);
            });
        }
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Toggle dev interface with Space key (dev only)
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                const isDev = window.authState && window.authState.isDev();
                if (isDev) {
                    this.toggle();
                } else {
                    console.log('[DevInterface] Dev tools restricted to dev users only');
                }
            }
            
            // Quick category switching with number keys
            if (this.isVisible && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < this.categories.length) {
                    this.showCategory(this.categories[index]);
                }
            }
        });
    }
    
    updateParameterDisplay(name, value) {
        if (!this.container) return;
        const isOverridden = this.parameterSystem && this.parameterSystem.isOverridden && this.parameterSystem.isOverridden(name);

        // Find the param row and update controls
        const rows = this.container.querySelectorAll(`[data-parameter="${name}"]`);
        rows.forEach(row => {
            const slider = row.querySelector('input[type="range"]');
            const num = row.querySelector('input[type="number"]');
            if (slider && !slider.matches(':focus')) {
                if (slider.dataset.mode === 'absolute') {
                    slider.value = value;
                } else {
                    slider.value = 0;
                }
            }
            if (num && !num.matches(':focus')) num.value = value;
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.matches(':focus')) {
                checkbox.checked = !!value;
            }
            const valueDisplay = row.querySelector('.param-value');
            if (valueDisplay) valueDisplay.textContent = value;

            // Update reset button visibility
            const resetBtn = row.querySelector('button');
            if (resetBtn) {
                resetBtn.style.visibility = isOverridden ? 'visible' : 'hidden';
                resetBtn.style.background = isOverridden ? 'rgba(255,100,100,0.2)' : 'transparent';
                resetBtn.style.border = isOverridden ? '1px solid rgba(255,100,100,0.4)' : 'none';
                resetBtn.style.color = isOverridden ? '#ff8888' : '#444';
                resetBtn.style.cursor = isOverridden ? 'pointer' : 'default';
            }
        });

        // Update color inputs
        const colorInputs = this.container.querySelectorAll(`input[type="color"][data-parameter="${name}"]`);
        colorInputs.forEach(input => {
            if (!input.matches(':focus')) input.value = value;
        });
    }
    
    show() {
        this.isVisible = true;
        this.container.style.display = 'block';
        // Don't auto-show any categories - let user pick
        this.updateTabStyles();
        if (this.activeCategories.has('jesus')) {
            this._startJesusStatusPolling();
        }
    }
    
    hide() {
        this.isVisible = false;
        this.container.style.display = 'none';
        this._stopJesusStatusPolling();
    }
    
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    toggleRaycastDot() {
        const game = window.game;
        if (game) {
            game.raycastDotEnabled = !game.raycastDotEnabled;
            if (this.raycastBtn) {
                const active = game.raycastDotEnabled;
                this.raycastBtn.style.background = active ? 'rgba(255, 68, 68, 0.3)' : 'rgba(0, 0, 0, 0.3)';
                this.raycastBtn.style.borderColor = active ? 'rgba(255, 68, 68, 0.6)' : '#ff444440';
            }
        }
    }
    
    resetAllParameters() {
        console.log('[DevInterface] Resetting all parameters to defaults...');
        if (this.parameterSystem && typeof this.parameterSystem.resetAll === 'function') {
            this.parameterSystem.resetAll();
        }
        // Refresh all active categories
        const active = Array.from(this.activeCategories);
        this.categoryCache.clear();
        this.contentArea.innerHTML = '';
        active.forEach(cat => {
            this.activeCategories.delete(cat);
            this.toggleCategory(cat);
        });
    }

    randomizeParameters() {
        console.log('[DevInterface] Randomizing numeric parameters...');
        const all = this.parameterSystem.getAllParameters();
        Object.entries(all).forEach(([name, cfg]) => {
            if (cfg.type !== 'number') return;
            const min = cfg.min !== undefined ? cfg.min : 0;
            const max = cfg.max !== undefined ? cfg.max : 1;
            const v = min + Math.random() * (max - min);
            const step = cfg.step || 1;
            const quantised = Math.round(v / step) * step;
            this.parameterSystem.setParameter(name, quantised);
        });
        // Refresh all active categories to show new values
        const active = Array.from(this.activeCategories);
        this.categoryCache.clear();
        this.contentArea.innerHTML = '';
        active.forEach(cat => {
            this.activeCategories.delete(cat);
            this.toggleCategory(cat);
        });
    }

    saveDefaults() {
        const all = this.parameterSystem.getAllParameters();
        const overrides = {};
        const equalsDefault = (cfg) => {
            if (!cfg) return true;
            const { value, defaultValue } = cfg;
            const isObject = (val) => val && typeof val === 'object';
            if (isObject(value) || isObject(defaultValue)) {
                try {
                    return JSON.stringify(value) === JSON.stringify(defaultValue);
                } catch (err) {
                    console.warn('[DevInterface.saveDefaults] Deep compare failed for', cfg.name, err);
                    return false;
                }
            }
            return value === defaultValue;
        };
        Object.entries(all).forEach(([name, cfg]) => {
            if (cfg && cfg.persist === false) return;
            if (!equalsDefault(cfg)) overrides[name] = cfg.value;
        });
        const count = Object.keys(overrides).length;
        console.log('[DevInterface.saveDefaults] overrides collected:', JSON.stringify(overrides, null, 2));
        if (count === 0) {
            alert('No overridden parameters to save. Adjust some values first.');
            return;
        }
        if (!confirm(`Save ${count} overridden parameter${count > 1 ? 's' : ''} as new defaults?`)) return;

        fetch('/api/defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(overrides)
        })
        .then(async r => {
            const text = await r.text();
            console.log(`[DevInterface.saveDefaults] response status=${r.status}, body=`, text);
            let data;
            try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
            return { ok: r.ok, status: r.status, data };
        })
        .then(({ ok, status, data }) => {
            if (ok && data.success) {
                this._showToast(`Saved ${count} default${count > 1 ? 's' : ''}`);
            } else {
                alert(`Failed to save defaults (HTTP ${status}): ${data.error || data.raw || 'Unknown error'}`);
            }
        })
        .catch(err => {
            console.error('[DevInterface] Error saving defaults:', err);
            alert('Failed to save defaults. Check console.');
        });
    }

    setDefaultEnv() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const config = JSON.parse(event.target.result);
                    localStorage.setItem('chesiopia-default-env', JSON.stringify(config));
                    localStorage.setItem('chesiopia-default-env-name', file.name);
                    console.log('[DevInterface] Default ENV set:', file.name);
                    this._showToast(`Default ENV set: ${file.name}`);
                } catch (error) {
                    console.error('[DevInterface] Failed to set default ENV:', error);
                    alert('Failed to set default ENV');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    clearDefaultEnv() {
        const name = localStorage.getItem('chesiopia-default-env-name') || 'stored default';
        localStorage.removeItem('chesiopia-default-env');
        localStorage.removeItem('chesiopia-default-env-name');
        console.log('[DevInterface] Default ENV cleared:', name);
        return name;
    }

    clearDefaults() {
        if (!confirm('Clear all saved defaults and restore hardcoded values on next reload?')) return;
        const clearedName = this.clearDefaultEnv();
        fetch('/api/defaults', { method: 'DELETE' })
        .then(async r => {
            const text = await r.text();
            console.log(`[DevInterface.clearDefaults] response status=${r.status}, body=`, text);
            let data;
            try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
            return { ok: r.ok, status: r.status, data };
        })
        .then(({ ok, status, data }) => {
            if (ok && data.success) {
                this._showToast(`Defaults cleared (${clearedName})`);
            } else {
                alert(`Failed to clear defaults (HTTP ${status}): ${data.error || data.raw || 'Unknown error'}`);
            }
        })
        .catch(err => {
            console.error('[DevInterface] Error clearing defaults:', err);
            alert('Failed to clear defaults. Check console.');
        });
    }

    _showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 255, 0, 0.9);
            color: #000;
            padding: 6px 14px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            z-index: 10001;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
    
    exportConfiguration() {
        const config = this.parameterSystem.getAllParameters();
        const board = window.boardSystem;
        if (board && board.lightingRig) {
            config.lightingRig = JSON.parse(JSON.stringify(board.lightingRig));
        }
        const json = JSON.stringify(config, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chesiopia-config.json';
        a.click();
        URL.revokeObjectURL(url);
        console.log('[DevInterface] Configuration exported');
    }
    
    importConfiguration() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const config = JSON.parse(event.target.result);
                        const board = window.boardSystem;
                        if (config.lightingRig && board && board.lightingRig) {
                            Object.assign(board.lightingRig, JSON.parse(JSON.stringify(config.lightingRig)));
                            delete config.lightingRig;
                        }
                        Object.entries(config).forEach(([name, data]) => {
                            this.parameterSystem.setParameter(name, data.value);
                        });
                        console.log('[DevInterface] Configuration imported successfully');
                        alert('Configuration imported successfully');
                    } catch (error) {
                        console.error('[DevInterface] Failed to import configuration:', error);
                        alert('Failed to import configuration');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }
    
    takeScreenshot() {
        if (window.game && window.game.renderer) {
            const canvas = window.game.renderer.domElement;
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chesiopia-screenshot-${Date.now()}.png`;
                a.click();
                URL.revokeObjectURL(url);
                console.log('[DevInterface] Screenshot captured');
            });
        }
    }
    
    getClientLogs() {
        if (window.game && window.game.networkManager) {
            window.game.networkManager.emit('requestConsoleLogs');
            console.log('[DevInterface] Requesting client logs...');
        }
    }

    // Game action helpers
    clearAllPieces() {
        console.log('[DevInterface] Clear all pieces');
        if (window.game && window.game.networkManager) {
            window.game.networkManager.resetGame();
        }
    }

    spawnTestPieces() {
        console.log('[DevInterface] Spawn test pieces');
        if (window.game && window.game.networkManager) {
            window.game.networkManager.emit('spawnTestPieces', {});
        }
    }

    toggleCelShading() {
        console.log('[DevInterface] Toggle cel shading');
        if (window.game && window.game.celShaderSystem) {
            window.game.celShaderSystem.toggleCelShading(window.game.scene);
        } else {
            console.error('[DevInterface] CelShaderSystem not available');
        }
    }

    async recreateMap() {
        console.log('[DevInterface] Recreate map');
        try {
            const response = await fetch('/api/world/recreate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                if (window.game) {
                    const g = window.game;
                    if (g.terrainSystem) g.terrainSystem.chunks.clear();
                    if (g.hybridTreeManager && g.hybridTreeManager.terrainTreeSystem) {
                        g.hybridTreeManager.terrainTreeSystem.treeQuads.clear();
                        g.hybridTreeManager.terrainTreeSystem.treeGeometry.clear();
                    }
                    if (g.boardSystem) g.boardSystem.clearTerrainCache();
                    const cam = g.cameraController && g.cameraController.camera;
                    if (cam && g.terrainSystem) {
                        await g.terrainSystem.generateInitialTerrain(
                            Math.floor(cam.position.x),
                            Math.floor(cam.position.z),
                            g.terrainSystem.loadDistance
                        );
                    }
                    if (g.boardSystem) g.boardSystem.updateTerrainMesh();
                    if (g.cameraController) g.cameraController.updateCameraPosition();
                }
                alert('Map recreated! New seed: ' + result.seed);
            } else {
                alert('Failed: ' + result.message);
            }
        } catch (error) {
            console.error('[DevInterface] Recreate map error:', error);
            alert('Error: ' + error.message);
        }
    }

    async testServerError() {
        console.log('[DevInterface] Test server error');
        try {
            const response = await fetch('/api/test-error', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                alert('Test error triggered! Check Server Errors panel.');
            } else {
                alert('Failed: ' + result.message);
            }
        } catch (error) {
            console.error('[DevInterface] Test error:', error);
            alert('Error: ' + error.message);
        }
    }

    startRespawn() {
        console.log('[DevInterface] Start respawn');
        if (window.game && window.game.startRespawnAnimation) {
            window.game.startRespawnAnimation();
        }
    }

    // ---------- Geometry Profiler Tab ----------

    _createGeometryContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'verts';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 0 0 4px 0;
            padding-bottom: 2px;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
        `;
        const title = document.createElement('span');
        title.textContent = 'GEOMETRY';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; letter-spacing: 0.5px;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('verts');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        const summary = document.createElement('div');
        summary.style.cssText = `font-size: 9px; color: #aaffaa; margin-bottom: 4px; display: flex; gap: 8px; flex-wrap: wrap;`;
        summary.innerHTML = `<span id="geoSummary">Total: \u2014</span>`;
        section.appendChild(summary);

        const list = document.createElement('div');
        list.id = 'geometryList';
        list.style.cssText = `
            max-height: 55vh;
            overflow-y: auto;
            font-size: 9px;
            display: flex;
            flex-direction: column;
            gap: 1px;
        `;
        section.appendChild(list);

        this._geometryListEl = list;
        this._geometrySummaryEl = summary.querySelector('#geoSummary');
        return section;
    }

    _updateGeometryPanel() {
        if (!this._geometryListEl) return;
        const g = window.game;
        if (!g || !g.scene) return;

        const items = [];
        g.scene.traverse(obj => {
            if (!obj.isMesh && !obj.isPoints && !obj.isLine && !obj.isInstancedMesh) return;
            const geo = obj.geometry;
            const pos = geo?.attributes?.position;
            const verts = pos ? pos.count : 0;
            const tris = geo?.index ? Math.round(geo.index.count / 3) : Math.round(verts / 3);
            const inst = obj.isInstancedMesh ? obj.count : 1;

            // Derive name from first named ancestor if object itself is unnamed
            let displayName = obj.name || '';
            if (!displayName) {
                let n = obj.parent;
                while (n) {
                    if (n.name) { displayName = n.name; break; }
                    n = n.parent;
                }
            }
            displayName = displayName || 'unnamed';

            let cat = 'other';
            const n = displayName.toLowerCase();
            const p = obj.parent ? (obj.parent.name || '').toLowerCase() : '';
            const s = n + ' ' + p;
            if (s.includes('terrain') || s.includes('chunk') || s.includes('ground') || s.includes('rolling')) cat = 'terrain';
            else if (s.includes('water')) cat = 'water';
            else if (s.includes('piece') || s.includes('bishop') || s.includes('knight') || s.includes('rook') || s.includes('pawn') || s.includes('queen') || s.includes('king')) cat = 'pieces';
            else if (s.includes('tree') || s.includes('poplar') || s.includes('cherry') || s.includes('canopy') || s.includes('foliage')) cat = 'trees';
            else if (s.includes('grass') || s.includes('blade')) cat = 'grass';
            else if (s.includes('board') || s.includes('tile') || s.includes('square') || s.includes('chess')) cat = 'board';
            else if (s.includes('bird') || s.includes('dais') || s.includes('book') || s.includes('fairy') || s.includes('deco') || s.includes('cloud')) cat = 'decor';
            else if (s.includes('shadow')) cat = 'shadows';
            else if (s.includes('sun') || s.includes('moon') || s.includes('light')) cat = 'lights';
            else if (s.includes('marker') || s.includes('move') || s.includes('valid')) cat = 'ui';

            items.push({
                name: displayName,
                category: cat,
                verts,
                tris,
                inst,
                totalVerts: verts * inst,
                visible: obj.visible
            });
        });

        items.sort((a, b) => b.totalVerts - a.totalVerts);

        const catColor = {
            terrain: '#ffaa66', water: '#66aaff', pieces: '#ff6666', trees: '#66ff66',
            grass: '#88ff88', board: '#ffcc66', decor: '#cc88ff', shadows: '#888',
            lights: '#ffff88', ui: '#ff88ff', other: '#aaa'
        };

        let html = '';
        let totalVerts = 0, totalTris = 0;
        items.forEach(it => {
            totalVerts += it.totalVerts;
            totalTris += it.tris * it.inst;
            const nameShort = it.name.length > 20 ? it.name.slice(0, 18) + '..' : it.name;
            const instStr = it.inst > 1 ? ` <span style="color:#88ccff">\u00D7${it.inst}</span>` : '';
            const totalStr = it.inst > 1 ? ` <span style="color:#aaa">= ${it.totalVerts.toLocaleString()}</span>` : '';
            const color = catColor[it.category] || '#aaa';
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:1px 2px;border-bottom:1px solid rgba(255,255,255,0.04);${!it.visible ? 'opacity:0.4;' : ''}">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">
                    <span style="color:${color};font-size:7px;">[${it.category.toUpperCase()}]</span> ${nameShort}${instStr}
                </div>
                <div style="text-align:right;white-space:nowrap;">
                    <span style="color:#aaffaa">${it.verts.toLocaleString()}</span>${totalStr}
                </div>
            </div>`;
        });

        this._geometryListEl.innerHTML = html || '<div style="color:#666;padding:4px;">No geometry</div>';
        this._geometrySummaryEl.textContent = `${items.length} drawables | ${totalVerts.toLocaleString()} verts | ${totalTris.toLocaleString()} tris`;
    }

    _startGeometryPolling() {
        if (this._geometryInterval) return;
        this._geometryInterval = setInterval(() => {
            if (this.isVisible && this.activeCategories.has('verts')) {
                this._updateGeometryPanel();
            }
        }, 1000);
        this._updateGeometryPanel();
    }

    _stopGeometryPolling() {
        if (this._geometryInterval) {
            clearInterval(this._geometryInterval);
            this._geometryInterval = null;
        }
    }

    // ---------- Biome Editor ----------

    _createBiomeContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'biome';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            margin: 0 0 4px 0; padding-bottom: 2px;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
        `;
        const title = document.createElement('span');
        title.textContent = 'BIOME EDITOR';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; letter-spacing: 0.5px;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('biome');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.style.cssText = `display: flex; gap: 3px; margin-bottom: 4px; align-items: center;`;
        const btnStyle = `
            background: rgba(0, 255, 0, 0.08); border: 1px solid rgba(0, 255, 0, 0.25);
            color: #00ff00; padding: 3px 6px; border-radius: 3px; cursor: pointer;
            font-size: 9px; transition: all 0.15s;
        `;
        const addBtn = document.createElement('button');
        addBtn.textContent = '+ New';
        addBtn.style.cssText = btnStyle;
        addBtn.title = 'Duplicate selected biome';
        addBtn.onclick = () => this._biomeDuplicate();
        toolbar.appendChild(addBtn);
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '- Remove';
        removeBtn.style.cssText = btnStyle;
        removeBtn.title = 'Reset selected biome to default';
        removeBtn.onclick = () => this._biomeReset();
        toolbar.appendChild(removeBtn);
        section.appendChild(toolbar);

        // Biome list
        const listContainer = document.createElement('div');
        listContainer.id = 'biomeListContainer';
        listContainer.style.cssText = `
            display: flex; flex-direction: column; gap: 2px;
            max-height: 28vh; overflow-y: auto;
        `;
        section.appendChild(listContainer);

        // Detail panel
        const detailPanel = document.createElement('div');
        detailPanel.id = 'biomeDetailPanel';
        detailPanel.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px; padding: 4px 6px;
            background: rgba(0, 30, 0, 0.3);
            display: flex; flex-direction: column; gap: 3px;
        `;
        section.appendChild(detailPanel);

        this._biomeSection = section;
        this._biomeListContainer = listContainer;
        this._biomeDetailPanel = detailPanel;
        this._selectedBiomeIndex = 0;
        this._biomeNames = ['Deep Water','Shallow Water','Beach','Lowland','Grassland','Forest','Mountain','Snow'];
        this._rebuildBiomeList();
        this._rebuildBiomeDetail();
        return section;
    }

    _biomeDefaultColor(idx) {
        const defaults = ['#6699e6','#b3a580','#c2bf6b','#6bad51','#3f9438','#2d6b26','#856148','#e0e6eb'];
        return defaults[idx];
    }

    _rebuildBiomeList() {
        const container = this._biomeListContainer;
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const colorVal = this.parameterSystem.getParameter(`biomeColor${i}`) || this._biomeDefaultColor(i);
            const thresholdVal = i > 0 ? this.parameterSystem.getParameter(`biomeThreshold${i-1}`) : null;
            const row = document.createElement('div');
            row.dataset.biomeIndex = i;
            const isSelected = i === this._selectedBiomeIndex;
            row.style.cssText = `
                display: flex; align-items: center; gap: 4px;
                padding: 3px 4px; border-radius: 3px;
                border: 1px solid ${isSelected ? 'rgba(0,255,0,0.35)' : 'rgba(255,255,255,0.06)'};
                background: ${isSelected ? 'rgba(0,255,0,0.12)' : 'rgba(0,20,0,0.2)'};
                cursor: pointer; transition: all 0.1s;
            `;
            row.onclick = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                this._selectedBiomeIndex = i;
                this._rebuildBiomeList();
                this._rebuildBiomeDetail();
            };
            // Arrows
            const arrowWrap = document.createElement('div');
            arrowWrap.style.cssText = `display: flex; flex-direction: column; gap: 0px;`;
            const upBtn = document.createElement('button');
            upBtn.textContent = '\u25B2';
            upBtn.style.cssText = `background: none; border: none; color: ${i===0?'#444':'#0f0'}; font-size: 7px; cursor: ${i===0?'default':'pointer'}; padding: 0; line-height: 8px;`;
            if (i > 0) upBtn.onclick = () => this._biomeSwap(i, i - 1);
            const downBtn = document.createElement('button');
            downBtn.textContent = '\u25BC';
            downBtn.style.cssText = `background: none; border: none; color: ${i===7?'#444':'#0f0'}; font-size: 7px; cursor: ${i===7?'default':'pointer'}; padding: 0; line-height: 8px;`;
            if (i < 7) downBtn.onclick = () => this._biomeSwap(i, i + 1);
            arrowWrap.appendChild(upBtn);
            arrowWrap.appendChild(downBtn);
            row.appendChild(arrowWrap);
            // Color swatch
            const swatch = document.createElement('div');
            swatch.style.cssText = `width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.2); background: ${colorVal};`;
            row.appendChild(swatch);
            // Name
            const nameSpan = document.createElement('span');
            nameSpan.textContent = this._biomeNames[i];
            nameSpan.style.cssText = `font-size: 9px; color: #aaffaa; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
            row.appendChild(nameSpan);
            // Start height
            const heightLabel = document.createElement('span');
            heightLabel.textContent = i === 0 ? 'Base' : 'Start';
            heightLabel.style.cssText = `font-size: 8px; color: #88aa88;`;
            row.appendChild(heightLabel);
            const heightInput = document.createElement('input');
            heightInput.type = 'number';
            heightInput.value = i === 0 ? '' : (thresholdVal !== undefined ? thresholdVal : '');
            heightInput.disabled = i === 0;
            heightInput.style.cssText = `
                width: 44px; background: rgba(0,0,0,0.3);
                border: 1px solid rgba(0,255,0,0.15);
                color: ${i===0?'#555':'#00ff00'}; padding: 1px 3px;
                border-radius: 2px; font-size: 9px; text-align: right;
            `;
            if (i > 0) {
                heightInput.addEventListener('change', (e) => {
                    let v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                        v = Math.max(-50, Math.min(100, v));
                        this.parameterSystem.setParameter(`biomeThreshold${i-1}`, v, 'user', { clamp: false });
                    }
                });
            }
            row.appendChild(heightInput);
            container.appendChild(row);
        }
    }

    _biomeSwap(i, j) {
        if (j < 0 || j > 7) return;
        const ci = this.parameterSystem.getParameter(`biomeColor${i}`);
        const cj = this.parameterSystem.getParameter(`biomeColor${j}`);
        this.parameterSystem.setParameter(`biomeColor${i}`, cj);
        this.parameterSystem.setParameter(`biomeColor${j}`, ci);
        [this._biomeNames[i], this._biomeNames[j]] = [this._biomeNames[j], this._biomeNames[i]];
        if (this._selectedBiomeIndex === i) this._selectedBiomeIndex = j;
        else if (this._selectedBiomeIndex === j) this._selectedBiomeIndex = i;
        this._rebuildBiomeList();
        this._rebuildBiomeDetail();
    }

    _biomeDuplicate() {
        const sel = this._selectedBiomeIndex;
        const color = this.parameterSystem.getParameter(`biomeColor${sel}`);
        this.parameterSystem.setParameter(`biomeColor${sel}`, color);
        this._showToast('Biome color copied to slot (duplicate not yet supported)');
    }

    _biomeReset() {
        const sel = this._selectedBiomeIndex;
        const defaults = ['#6699e6','#b3a580','#c2bf6b','#6bad51','#3f9438','#2d6b26','#856148','#e0e6eb'];
        const defaultThresholds = [-1.5, -1.0, 2.5, 4.5, 11.5, 19.5, 26.5];
        this.parameterSystem.resetParameter(`biomeColor${sel}`);
        if (sel > 0) this.parameterSystem.resetParameter(`biomeThreshold${sel-1}`);
        this._rebuildBiomeList();
        this._rebuildBiomeDetail();
        this._showToast(`${this._biomeNames[sel]} reset to defaults`);
    }

    _rebuildBiomeDetail() {
        const panel = this._biomeDetailPanel;
        if (!panel) return;
        const i = this._selectedBiomeIndex;
        if (i === undefined || i < 0) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';
        panel.innerHTML = '';
        const grassTypeOptions = [
            { value: 0, label: 'None' },
            { value: 1, label: 'Meadow' },
            { value: 2, label: 'Prairie' },
            { value: 3, label: 'Alpine' },
            { value: 4, label: 'Marsh' },
            { value: 5, label: 'Dry Steppe' }
        ];
        // Title
        const title = document.createElement('div');
        title.textContent = `${this._biomeNames[i]} Options`;
        title.style.cssText = `font-size: 10px; font-weight: 600; color: #00ff00; border-bottom: 1px solid rgba(0,255,0,0.1); padding-bottom: 2px; margin-bottom: 2px;`;
        panel.appendChild(title);
        // Color row
        const colorRow = document.createElement('div');
        colorRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;
        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Color';
        colorLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 50px;`;
        colorRow.appendChild(colorLabel);
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.parameterSystem.getParameter(`biomeColor${i}`) || this._biomeDefaultColor(i);
        colorInput.style.cssText = `width: 28px; height: 16px; border: 1px solid rgba(0,255,0,0.3); border-radius: 2px; background: rgba(0,0,0,0.5); padding: 0; cursor: pointer;`;
        colorInput.addEventListener('input', (e) => {
            this.parameterSystem.setParameter(`biomeColor${i}`, e.target.value);
        });
        colorRow.appendChild(colorInput);
        panel.appendChild(colorRow);

        // Grass type dropdown
        const grassRow = document.createElement('div');
        grassRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;
        const grassLabel = document.createElement('span');
        grassLabel.textContent = 'Grass';
        grassLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 50px;`;
        grassRow.appendChild(grassLabel);
        const grassSelect = document.createElement('select');
        grassSelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,0,0.2); color: #00ff00; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
        const grassValue = this.parameterSystem.getParameter(`grassType${i}`) ?? 0;
        grassTypeOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === grassValue) option.selected = true;
            grassSelect.appendChild(option);
        });
        grassSelect.addEventListener('change', (e) => {
            this.parameterSystem.setParameter(`grassType${i}`, parseFloat(e.target.value));
        });
        grassRow.appendChild(grassSelect);
        panel.appendChild(grassRow);
        // Start height
        if (i > 0) {
            const thRow = document.createElement('div');
            thRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;
            const thLabel = document.createElement('span');
            thLabel.textContent = 'Start Ht';
            thLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 50px;`;
            thRow.appendChild(thLabel);
            const thInput = document.createElement('input');
            thInput.type = 'number';
            thInput.step = 0.1;
            thInput.value = this.parameterSystem.getParameter(`biomeThreshold${i-1}`);
            thInput.style.cssText = `flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,255,0,0.15); color: #00ff00; padding: 2px 4px; border-radius: 2px; font-size: 9px;`;
            thInput.addEventListener('change', (e) => {
                let v = parseFloat(e.target.value);
                if (Number.isFinite(v)) {
                    v = Math.max(-50, Math.min(100, v));
                    this.parameterSystem.setParameter(`biomeThreshold${i-1}`, v, 'user', { clamp: false });
                }
            });
            thRow.appendChild(thInput);
            panel.appendChild(thRow);
        }
        // Edge blending section
        if (i < 7) {
            const savedInfo = this._getPairEdgeSettings(i, i + 1);
            const saved = savedInfo.data;
            this._applyPairEdgeSettings(i, i + 1, saved);

            const edgeTitle = document.createElement('div');
            edgeTitle.style.cssText = `display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-weight: 600; color: #aaffaa; margin-top: 4px; border-bottom: 1px solid rgba(0,255,0,0.08); padding-bottom: 2px;`;
            const edgeLabel = document.createElement('span');
            edgeLabel.textContent = `Edge to ${this._biomeNames[i+1]}`;
            edgeTitle.appendChild(edgeLabel);
            const saveBtn = document.createElement('button');
            const setSaveState = (isSaved) => {
                saveBtn.textContent = isSaved ? '\u2714 Saved' : 'Save';
                saveBtn.style.cssText = `background: ${isSaved ? 'rgba(0,255,0,0.2)' : 'rgba(0,255,0,0.08)'}; border: 1px solid rgba(0,255,0,0.25); color: #00ff00; padding: 1px 5px; border-radius: 2px; cursor: pointer; font-size: 8px;`;
                saveBtn.title = isSaved ? 'Overwrite saved edge settings for this pair' : 'Lock current edge settings to this biome pair';
            };
            setSaveState(!!saved);
            saveBtn.onclick = () => {
                this._savePairEdgeSettings(i, i + 1);
                setSaveState(true);
                this._showToast(`Edge ${this._biomeNames[i]}\u2192${this._biomeNames[i+1]} saved`);
            };
            edgeTitle.appendChild(saveBtn);
            panel.appendChild(edgeTitle);
            // Mode
            const modeRow = document.createElement('div');
            modeRow.style.cssText = `display: flex; align-items: center; gap: 6px; margin-top: 2px;`;
            const modeLabel = document.createElement('span');
            modeLabel.textContent = 'Mode';
            modeLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 50px;`;
            modeRow.appendChild(modeLabel);
            const modeSelect = document.createElement('select');
            modeSelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,0,0.2); color: #00ff00; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
            const modeOpts = [
                { value: 0, label: 'Blended' },
                { value: 1, label: 'Sharp' },
                { value: 2, label: 'Custom' }
            ];
            const curMode = this.parameterSystem.getParameter('biomeEdgeMode');
            modeOpts.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.value; opt.textContent = o.label;
                if (o.value == curMode) opt.selected = true;
                modeSelect.appendChild(opt);
            });
            modeSelect.addEventListener('change', (e) => {
                this.parameterSystem.setParameter('biomeEdgeMode', parseInt(e.target.value));
            });
            modeRow.appendChild(modeSelect);
            panel.appendChild(modeRow);
            // Helper to make param rows
            const mkParam = (paramName, label) => {
                const row = document.createElement('div');
                row.style.cssText = `display: flex; align-items: center; gap: 6px;`;
                const lbl = document.createElement('span');
                lbl.textContent = label;
                lbl.style.cssText = `font-size: 9px; color: #aaffaa; width: 50px;`;
                row.appendChild(lbl);
                const val = this.parameterSystem.getParameter(paramName);
                const pCfg = this.parameterSystem.params.get(paramName);
                const num = document.createElement('input');
                num.type = 'number';
                num.value = val;
                num.step = pCfg ? pCfg.step : 0.01;
                num.style.cssText = `flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,255,0,0.15); color: #00ff00; padding: 2px 4px; border-radius: 2px; font-size: 9px;`;
                num.addEventListener('change', (e) => {
                    let v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                        if (pCfg && pCfg.min !== undefined) v = Math.max(pCfg.min, v);
                        if (pCfg && pCfg.max !== undefined) v = Math.min(pCfg.max, v);
                        this.parameterSystem.setParameter(paramName, v, 'user', { clamp: false });
                    }
                });
                row.appendChild(num);
                return row;
            };
            panel.appendChild(mkParam('biomeEdgeScale', 'Wiggle Sc'));
            panel.appendChild(mkParam('biomeEdgeStrength', 'Wiggle Str'));
            panel.appendChild(mkParam('biomeSplatterScale', 'Splat Sc'));
            panel.appendChild(mkParam('biomeSplatterAmount', 'Splat Amt'));
            panel.appendChild(mkParam('biomeEdgeSplatterMix', 'Edge/Splat'));
        }
    }

    // ---------- Surface Stack Editor (Nested Frames) ----------

    _createModifierContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'modifier';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            margin: 0 0 4px 0; padding-bottom: 2px;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
        `;
        const title = document.createElement('span');
        title.textContent = 'SURFACE STACK';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; letter-spacing: 0.5px;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('modifier');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        // Target biome pair selector
        const targetRow = document.createElement('div');
        targetRow.style.cssText = `display: flex; gap: 4px; align-items: center; margin-bottom: 4px;`;
        const targetLabel = document.createElement('span');
        targetLabel.textContent = 'Edge';
        targetLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 30px;`;
        targetRow.appendChild(targetLabel);
        const edgeASelect = document.createElement('select');
        edgeASelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,0,0.2); color: #00ff00; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
        const edgeBSelect = document.createElement('select');
        edgeBSelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,0,0.2); color: #00ff00; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
        const biomeOptions = [
            { value: 0, label: 'Deep Water' },
            { value: 1, label: 'Shallow Water' },
            { value: 2, label: 'Beach' },
            { value: 3, label: 'Lowland' },
            { value: 4, label: 'Grassland' },
            { value: 5, label: 'Forest' },
            { value: 6, label: 'Mountain' },
            { value: 7, label: 'Snow' }
        ];
        biomeOptions.forEach(o => {
            const optA = document.createElement('option');
            optA.value = o.value; optA.textContent = o.label;
            edgeASelect.appendChild(optA);
            const optB = document.createElement('option');
            optB.value = o.value; optB.textContent = o.label;
            edgeBSelect.appendChild(optB);
        });
        const syncEdge = () => {
            this.parameterSystem.setParameter('biomeEdgeA', parseInt(edgeASelect.value));
            this.parameterSystem.setParameter('biomeEdgeB', parseInt(edgeBSelect.value));
        };
        edgeASelect.addEventListener('change', syncEdge);
        edgeBSelect.addEventListener('change', syncEdge);
        targetRow.appendChild(edgeASelect);
        const toLabel = document.createElement('span');
        toLabel.textContent = '\u2192';
        toLabel.style.cssText = `font-size: 9px; color: #aaffaa;`;
        targetRow.appendChild(toLabel);
        targetRow.appendChild(edgeBSelect);
        section.appendChild(targetRow);

        // Tree container
        const treeContainer = document.createElement('div');
        treeContainer.id = 'modifierTreeContainer';
        treeContainer.style.cssText = `
            display: flex; flex-direction: column; gap: 3px;
            max-height: 55vh; overflow-y: auto;
        `;
        section.appendChild(treeContainer);

        this._modifierSection = section;
        this._modifierTreeContainer = treeContainer;
        this._modifierEdgeASelect = edgeASelect;
        this._modifierEdgeBSelect = edgeBSelect;
        this._rebuildModifierTree();
        return section;
    }

    // ---------- Blending (Biome + Modifier Stack) ----------

    _createBlendingContent() {
        const container = document.createElement('div');
        container.dataset.categorySection = 'blending';
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;

        // Biome palette section
        const biomeSection = this._createBiomeContent();
        container.appendChild(biomeSection);

        // Auto-generated parameter sliders for blending category
        const paramsSection = this._buildParameterSection('blending');
        container.appendChild(paramsSection);

        // Modifier stack section
        const modifierSection = this._createModifierContent();
        container.appendChild(modifierSection);

        return container;
    }

    _rebuildModifierTree() {
        const container = this._modifierTreeContainer;
        if (!container) return;
        container.innerHTML = '';
        const stack = this.parameterSystem.getParameter('biomeModifierStack');
        if (!stack) return;
        // Sync edge selectors
        const edgeA = this.parameterSystem.getParameter('biomeEdgeA') || 3;
        const edgeB = this.parameterSystem.getParameter('biomeEdgeB') || 4;
        if (this._modifierEdgeASelect) this._modifierEdgeASelect.value = edgeA;
        if (this._modifierEdgeBSelect) this._modifierEdgeBSelect.value = edgeB;
        // Build tree from flat layers
        const tree = this._modifierFlatToTree(stack.layers);
        container.appendChild(this._modifierBuildNode(tree, 0, stack));
    }

    _modifierFlatToTree(layers) {
        if (!layers || layers.length === 0) return { type: 'shader', layer: null };
        if (layers.length === 1) return { type: 'shader', layer: layers[0] };
        // Build right-associative tree: last layer mixes over the rest
        const last = layers[layers.length - 1];
        const rest = layers.slice(0, -1);
        return {
            type: 'mixer',
            blendOp: last.blendOp,
            layerId: last.id,
            left: { type: 'shader', layer: last },
            right: this._modifierFlatToTree(rest)
        };
    }

    _modifierBuildNode(node, depth, stack) {
        const frame = document.createElement('div');
        const borderColor = depth === 0 ? 'rgba(0,255,0,0.25)' : depth === 1 ? 'rgba(255,170,68,0.25)' : 'rgba(100,200,255,0.25)';
        const bgColor = depth === 0 ? 'rgba(0,20,0,0.25)' : depth === 1 ? 'rgba(40,20,0,0.25)' : 'rgba(0,10,30,0.25)';
        frame.style.cssText = `
            border: 1px solid ${borderColor};
            border-radius: 4px;
            padding: 4px 5px;
            background: ${bgColor};
            display: flex;
            flex-direction: column;
            gap: 3px;
            margin-left: ${depth * 6}px;
        `;

        if (!node || node.type === 'shader') {
            const layer = node && node.layer ? node.layer : {
                id: null, noiseType: 'fbm', params: { scale: 0.3, strength: 1.0, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }
            };
            // Type row
            const typeRow = document.createElement('div');
            typeRow.style.cssText = `display: flex; align-items: center; gap: 4px;`;
            const typeLabel = document.createElement('span');
            typeLabel.textContent = 'Shader';
            typeLabel.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; width: 42px;`;
            typeRow.appendChild(typeLabel);
            const noiseSelect = document.createElement('select');
            noiseSelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,0,0.2); color: #00ff00; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
            ModifierStack.NOISE_TYPES.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t; opt.textContent = t;
                if (t === layer.noiseType) opt.selected = true;
                noiseSelect.appendChild(opt);
            });
            noiseSelect.addEventListener('change', (e) => {
                if (layer.id) { stack.setLayerField(layer.id, 'noiseType', e.target.value); this._modifierApply(); }
            });
            typeRow.appendChild(noiseSelect);
            frame.appendChild(typeRow);
            // Params
            const paramNames = [
                { key: 'scale', min: 0.01, max: 3, step: 0.01, label: 'Scale' },
                { key: 'strength', min: 0, max: 5, step: 0.05, label: 'Str' },
                { key: 'octaves', min: 1, max: 8, step: 1, label: 'Oct' },
                { key: 'lacunarity', min: 1, max: 4, step: 0.1, label: 'Lac' },
                { key: 'gain', min: 0, max: 1, step: 0.05, label: 'Gain' },
                { key: 'offset', min: -2, max: 2, step: 0.1, label: 'Off' },
                { key: 'contrast', min: 0.1, max: 3, step: 0.1, label: 'Con' }
            ];
            const paramGrid = document.createElement('div');
            paramGrid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin-top: 2px;`;
            paramNames.forEach(spec => {
                const cell = document.createElement('div');
                cell.style.cssText = `display: flex; align-items: center; gap: 3px;`;
                const lbl = document.createElement('span');
                lbl.textContent = spec.label;
                lbl.style.cssText = `font-size: 8px; color: #aaffaa; width: 22px;`;
                const num = document.createElement('input');
                num.type = 'number';
                num.min = spec.min; num.max = spec.max; num.step = spec.step;
                num.value = layer.params[spec.key];
                num.style.cssText = `flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,255,0,0.15); color: #00ff00; padding: 1px 2px; border-radius: 2px; font-size: 8px;`;
                num.addEventListener('change', (e) => {
                    let v = parseFloat(e.target.value);
                    v = Math.max(spec.min, Math.min(spec.max, v));
                    if (layer.id) { stack.setLayerParam(layer.id, spec.key, v); this._modifierApply(); }
                });
                cell.appendChild(lbl);
                cell.appendChild(num);
                paramGrid.appendChild(cell);
            });
            frame.appendChild(paramGrid);
        } else if (node.type === 'mixer') {
            const typeRow = document.createElement('div');
            typeRow.style.cssText = `display: flex; align-items: center; gap: 4px; margin-bottom: 2px;`;
            const typeLabel = document.createElement('span');
            typeLabel.textContent = 'Mixer';
            typeLabel.style.cssText = `font-size: 9px; font-weight: 600; color: #ffaa44; width: 42px;`;
            typeRow.appendChild(typeLabel);
            const blendSelect = document.createElement('select');
            blendSelect.style.cssText = `flex:1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,170,68,0.3); color: #ffaa44; padding: 1px 3px; border-radius: 2px; font-size: 9px;`;
            ModifierStack.BLEND_OPS.forEach(op => {
                const opt = document.createElement('option');
                opt.value = op; opt.textContent = op;
                if (op === node.blendOp) opt.selected = true;
                blendSelect.appendChild(opt);
            });
            blendSelect.addEventListener('change', (e) => {
                if (node.layerId) { stack.setLayerField(node.layerId, 'blendOp', e.target.value); this._modifierApply(); }
            });
            typeRow.appendChild(blendSelect);
            frame.appendChild(typeRow);
            // Nested children
            const childrenWrap = document.createElement('div');
            childrenWrap.style.cssText = `display: flex; flex-direction: column; gap: 3px;`;
            if (node.left) childrenWrap.appendChild(this._modifierBuildNode(node.left, depth + 1, stack));
            if (node.right) childrenWrap.appendChild(this._modifierBuildNode(node.right, depth + 1, stack));
            frame.appendChild(childrenWrap);
        }
        return frame;
    }

    _modifierApply() {
        const stack = this.parameterSystem.getParameter('biomeModifierStack');
        if (!stack) return;
        const ps = this.parameterSystem;
        const p = ps.params.get('biomeModifierStack');
        if (p) {
            p.lastModified = Date.now();
            ps._apply('biomeModifierStack', p, ps._getSystem(), true);
        }
    }

    // ---------- Lighting Rig Tab ----------

    _createRigContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'rig';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin: 0 0 4px 0; padding-bottom: 2px; border-bottom: 1px solid rgba(0, 255, 0, 0.1);`;
        const title = document.createElement('span');
        title.textContent = 'RIG';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('rig');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        const board = window.boardSystem;
        const rig = board && board.lightingRig ? board.lightingRig : null;

        if (!rig) {
            const msg = document.createElement('div');
            msg.textContent = 'BoardSystem not ready';
            msg.style.cssText = `color: #ff6666; font-size: 10px;`;
            section.appendChild(msg);
            return section;
        }

        // Enabled toggle
        const toggleRow = document.createElement('div');
        toggleRow.style.cssText = `display: flex; align-items: center; gap: 6px; margin-bottom: 4px;`;
        const toggleLabel = document.createElement('label');
        toggleLabel.textContent = 'Enable Rig';
        toggleLabel.style.cssText = `font-size: 10px; color: #00ff00; cursor: pointer;`;
        const toggleCheckbox = document.createElement('input');
        toggleCheckbox.type = 'checkbox';
        toggleCheckbox.checked = rig.enabled;
        toggleCheckbox.style.cssText = `cursor: pointer;`;
        toggleCheckbox.onchange = () => {
            rig.enabled = toggleCheckbox.checked;
            this._saveRigToStorage(rig);
        };
        toggleRow.appendChild(toggleCheckbox);
        toggleRow.appendChild(toggleLabel);
        section.appendChild(toggleRow);

        // Preset dropdown
        const presetRow = document.createElement('div');
        presetRow.style.cssText = `display: flex; align-items: center; gap: 4px; margin-bottom: 4px;`;
        const presetLabel = document.createElement('span');
        presetLabel.textContent = 'Preset:';
        presetLabel.style.cssText = `font-size: 10px; color: #88aa88;`;
        const presetSelect = document.createElement('select');
        presetSelect.style.cssText = `background: #111; color: #00ff00; border: 1px solid rgba(0,255,0,0.2); font-size: 10px; border-radius: 3px; padding: 2px 4px; cursor: pointer;`;
        ['Custom', 'Cinematic', 'Flat Debug', 'Winter Gloom'].forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            presetSelect.appendChild(opt);
        });
        presetSelect.onchange = () => {
            const p = this._getRigPreset(presetSelect.value);
            if (p) {
                Object.assign(rig.lights, p);
                this._refreshRigUI(section, rig);
                this._saveRigToStorage(rig);
            }
        };
        presetRow.appendChild(presetLabel);
        presetRow.appendChild(presetSelect);
        section.appendChild(presetRow);

        // Light panels
        const lightNames = [
            { key: 'sun', label: 'SUN' },
            { key: 'moon', label: 'MOON' },
            { key: 'ambient', label: 'AMBIENT' },
            { key: 'nightAmbient', label: 'NIGHT AMB' }
        ];

        const trackRefs = {};
        lightNames.forEach(({ key, label }) => {
            const panel = this._createRigLightPanel(key, label, rig, trackRefs);
            section.appendChild(panel);
        });

        // Global add slider
        const addSliderBlock = document.createElement('div');
        addSliderBlock.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 4px;
            border: 1px dashed rgba(0,255,0,0.2);
            border-radius: 3px;
            background: rgba(0, 30, 0, 0.25);
        `;

        const addSliderLabel = document.createElement('div');
        addSliderLabel.textContent = 'ADD NEW — drag handle, release to drop keyframes for every light';
        addSliderLabel.style.cssText = `font-size: 8px; color: #88aa88; letter-spacing: 0.3px;`;
        addSliderBlock.appendChild(addSliderLabel);

        const addSliderRow = document.createElement('div');
        addSliderRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;

        const addSlider = document.createElement('input');
        addSlider.type = 'range';
        addSlider.min = '0';
        addSlider.max = '24';
        addSlider.step = '0.1';
        const initialHours = this._getCurrentHours(board);
        addSlider.value = initialHours !== null ? initialHours : 12;
        addSlider.style.cssText = `
            flex: 1;
            appearance: none;
            height: 4px;
            border-radius: 3px;
            background: rgba(0,255,0,0.15);
            border: 1px solid rgba(0,255,0,0.3);
            outline: none;
            cursor: grab;
            transition: box-shadow 0.2s ease;
        `;

        const sliderValue = document.createElement('span');
        sliderValue.textContent = `${parseFloat(addSlider.value).toFixed(1)}h`;
        sliderValue.style.cssText = `font-size: 9px; color: #00ff00; min-width: 32px; text-align: right;`;

        addSliderRow.appendChild(addSlider);
        addSliderRow.appendChild(sliderValue);
        addSliderBlock.appendChild(addSliderRow);

        const sliderHint = document.createElement('div');
        sliderHint.textContent = 'Use this single timeline instead of adding dots per row.';
        sliderHint.style.cssText = `font-size: 8px; color: #668866;`;
        addSliderBlock.appendChild(sliderHint);
        section.appendChild(addSliderBlock);

        let sliderDragging = false;
        let sliderFeedbackTimeout = null;
        const updateSliderValue = () => {
            sliderValue.textContent = `${parseFloat(addSlider.value).toFixed(1)}h`;
        };
        const flashSlider = () => {
            if (sliderFeedbackTimeout) clearTimeout(sliderFeedbackTimeout);
            addSlider.style.boxShadow = '0 0 8px rgba(0,255,0,0.6)';
            sliderFeedbackTimeout = setTimeout(() => {
                addSlider.style.boxShadow = 'none';
            }, 180);
        };
        const commitSliderDrop = () => {
            const hours = parseFloat(addSlider.value);
            if (Number.isNaN(hours) || !board) return;
            this._addRigKeyframesAtTime(section, rig, hours, board);
            flashSlider();
        };
        const finishSliderDrag = () => {
            if (!sliderDragging) return;
            sliderDragging = false;
            commitSliderDrop();
        };
        addSlider.addEventListener('pointerdown', (e) => {
            sliderDragging = true;
            if (addSlider.setPointerCapture) {
                addSlider.setPointerCapture(e.pointerId);
            }
        });
        addSlider.addEventListener('pointerup', finishSliderDrag);
        addSlider.addEventListener('pointercancel', finishSliderDrag);
        addSlider.addEventListener('lostpointercapture', finishSliderDrag);
        addSlider.addEventListener('change', () => {
            if (!sliderDragging) commitSliderDrop();
        });
        addSlider.addEventListener('input', updateSliderValue);

        // Hint text
        const hint = document.createElement('div');
        hint.textContent = 'Tip: select a coloured dot to edit its colour + intensity. Drag the global slider to drop new ones.';
        hint.style.cssText = `font-size: 8px; color: #668866; margin-top: 2px; line-height: 1.3;`;
        section.appendChild(hint);

        // Global actions
        const actionRow = document.createElement('div');
        actionRow.style.cssText = `display: flex; gap: 4px; margin-top: 2px;`;

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset Defaults';
        resetBtn.style.cssText = `background: rgba(255,0,0,0.1); border: 1px solid rgba(255,0,0,0.3); color: #ff8888; font-size: 9px; padding: 3px 6px; border-radius: 3px; cursor: pointer; flex: 1;`;
        resetBtn.onclick = () => {
            const defaults = this._getDefaultRig();
            Object.assign(rig.lights, defaults.lights);
            rig.enabled = false;
            toggleCheckbox.checked = false;
            this._refreshRigUI(section, rig);
            this._saveRigToStorage(rig);
        };

        actionRow.appendChild(resetBtn);
        section.appendChild(actionRow);

        // Store refs for refresh
        section._rigTrackRefs = trackRefs;
        section._rigData = rig;

        // Global drag handler on document
        const dragState = {
            info: null,
            startX: 0,
            startY: 0
        };
        section._rigDragState = dragState;
        const DRAG_THRESHOLD = 3;
        const onMouseMove = (e) => {
            const info = dragState.info;
            if (!info) return;
            if (!info.active) {
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;
                if (Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return;
                info.active = true;
            }
            const rect = info.track.getBoundingClientRect();
            let t = (e.clientX - rect.left) / rect.width;
            t = Math.max(0, Math.min(1, t));
            let time = Math.round(t * 24 * 10) / 10;
            const kfs = rig.lights[info.lightKey];
            const kf = kfs[info.index];
            if (kf && Math.abs(kf.time - time) > 0.05) {
                kf.time = time;
                kfs.sort((a, b) => a.time - b.time);
                info.index = kfs.indexOf(kf);
                info.track._selectedIndex = info.index;
                this._refreshRigUI(section, rig);
            }
        };
        const onMouseUp = () => {
            if (dragState.info) {
                dragState.info = null;
                this._saveRigToStorage(rig);
            }
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Current time animation loop
        let animId = null;
        const tick = () => {
            this._updateRigCurrentTimeLines(section);
            animId = requestAnimationFrame(tick);
        };
        animId = requestAnimationFrame(tick);

        section._rigCleanup = () => {
            if (animId) cancelAnimationFrame(animId);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            dragState.info = null;
        };

        return section;
    }

    _createCliffContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'cliff';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.18);
            border-radius: 5px;
            padding: 6px;
            background: rgba(5, 25, 5, 0.7);
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(0,255,0,0.15);padding-bottom:3px;`;
        const title = document.createElement('span');
        title.textContent = 'HERO CLIFFS';
        title.style.cssText = `font-size:10px;font-weight:700;color:#00ff99;letter-spacing:0.8px;`;
        const hint = document.createElement('span');
        hint.textContent = 'Slope-driven rock detail';
        hint.style.cssText = `font-size:8px;color:#66ffaa;opacity:0.8;`;
        header.appendChild(title);
        header.appendChild(hint);
        section.appendChild(header);

        const params = this.parameterSystem?.getAllParameters?.() || {};
        const getCfg = (name) => params[name] || {};
        const getValue = (name) => this.parameterSystem?.getParameter ? this.parameterSystem.getParameter(name) : getCfg(name).value;

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        section.appendChild(controls);

        const makeToggle = (name, label, description) => {
            const cfg = getCfg(name);
            const row = document.createElement('label');
            row.dataset.parameter = name;
            row.style.cssText = `display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.25);padding:4px 6px;border-radius:3px;border:1px solid rgba(0,255,0,0.15);gap:8px;`;

            const info = document.createElement('div');
            info.style.cssText = 'display:flex;flex-direction:column;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'font-size:9px;color:#aaffaa;font-weight:600;';
            const desc = document.createElement('span');
            desc.textContent = description || cfg.description || '';
            desc.style.cssText = 'font-size:8px;color:#77aa77;';
            info.appendChild(lbl);
            info.appendChild(desc);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.parameter = name;
            checkbox.checked = !!getValue(name);
            checkbox.style.cssText = 'width:16px;height:16px;accent-color:#00ff99;cursor:pointer;';
            checkbox.addEventListener('change', (e) => {
                this.parameterSystem?.setParameter(name, e.target.checked);
            });

            row.appendChild(info);
            row.appendChild(checkbox);
            controls.appendChild(row);
        };

        const sliderGrid = document.createElement('div');
        sliderGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;';
        controls.appendChild(sliderGrid);

        const makeSlider = (name, label) => {
            const cfg = getCfg(name);
            if (!cfg) return;
            const row = document.createElement('div');
            row.dataset.parameter = name;
            row.style.cssText = 'border:1px solid rgba(0,255,0,0.12);border-radius:3px;padding:4px;background:rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:4px;';

            const top = document.createElement('div');
            top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'font-size:9px;color:#aaffaa;font-weight:600;';
            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'param-value';
            const currentVal = Number(getValue(name) ?? cfg.value ?? cfg.defaultValue ?? 0);
            valueDisplay.textContent = currentVal.toFixed(2);
            valueDisplay.style.cssText = 'font-size:9px;color:#00ffaa;';
            top.appendChild(lbl);
            top.appendChild(valueDisplay);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.dataset.parameter = name;
            slider.dataset.mode = 'absolute';
            slider.min = cfg.min ?? 0;
            slider.max = cfg.max ?? 1;
            slider.step = cfg.step ?? 0.01;
            slider.value = currentVal;
            slider.style.cssText = 'width:100%;cursor:pointer;accent-color:#00ff99;';

            const number = document.createElement('input');
            number.type = 'number';
            number.dataset.parameter = name;
            number.value = currentVal;
            number.step = cfg.step ?? 0.01;
            number.min = cfg.min ?? 0;
            number.max = cfg.max ?? 1;
            number.style.cssText = 'width:100%;background:rgba(0,0,0,0.35);border:1px solid rgba(0,255,0,0.2);color:#ceffce;font-size:9px;padding:2px;border-radius:2px;';

            const updateValue = (nextVal, sourceEl) => {
                const clamped = Math.max(number.min !== '' ? parseFloat(number.min) : nextVal, Math.min(number.max !== '' ? parseFloat(number.max) : nextVal, nextVal));
                if (sourceEl !== slider) slider.value = clamped;
                if (sourceEl !== number) number.value = clamped;
                valueDisplay.textContent = Number(clamped).toFixed(2);
                this.parameterSystem?.setParameter(name, clamped, 'user', { clamp: true });
            };

            slider.addEventListener('input', (e) => updateValue(parseFloat(e.target.value), slider));
            number.addEventListener('change', (e) => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) updateValue(parsed, number);
            });

            row.appendChild(top);
            row.appendChild(slider);
            row.appendChild(number);
            sliderGrid.appendChild(row);
        };

        const colorRow = document.createElement('div');
        colorRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
        controls.appendChild(colorRow);

        const makeColor = (name, label) => {
            const cfg = getCfg(name);
            const wrapper = document.createElement('label');
            wrapper.dataset.parameter = name;
            wrapper.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding:4px;border:1px solid rgba(0,255,0,0.12);border-radius:3px;background:rgba(0,0,0,0.3);min-width:120px;flex:1;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'font-size:9px;color:#aaffaa;font-weight:600;';
            const input = document.createElement('input');
            input.type = 'color';
            input.dataset.parameter = name;
            input.value = cfg.value || cfg.defaultValue || '#ffffff';
            input.style.cssText = 'width:100%;height:22px;border:none;background:none;cursor:pointer;';
            input.addEventListener('input', (e) => {
                this.parameterSystem?.setParameter(name, e.target.value);
            });
            wrapper.appendChild(lbl);
            wrapper.appendChild(input);
            colorRow.appendChild(wrapper);
        };

        makeToggle('cliffEnabled', 'Enable Cliffs', 'Master toggle for rock material');
        makeToggle('cliffDebug', 'Debug Mask', 'Visualize slope mask');

        makeSlider('cliffThreshold', 'Slope Threshold');
        makeSlider('cliffBlendWidth', 'Blend Width');
        makeSlider('cliffRubbleAmount', 'Rubble Amount');
        makeSlider('cliffStrataScale', 'Strata Scale');
        makeSlider('cliffStrataAmount', 'Strata Amount');
        makeSlider('cliffDarkenAmount', 'Darken');
        makeSlider('cliffMossAmount', 'Moss Amount');

        makeColor('cliffBaseColor', 'Base Rock');
        makeColor('cliffLightColor', 'Highlight Rock');
        makeColor('cliffMossColor', 'Moss Tint');

        return section;
    }

    _createCheckerboardContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'checkerboard';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin: 0 0 4px 0; padding-bottom: 2px; border-bottom: 1px solid rgba(0, 255, 0, 0.1);`;
        const title = document.createElement('span');
        title.textContent = 'CHECKERBOARD';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; letter-spacing: 0.5px;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('checkerboard');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        // Transparency fade slider
        const fadeRow = document.createElement('div');
        fadeRow.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 2px 0;`;
        
        const fadeLabel = document.createElement('label');
        fadeLabel.textContent = 'Transparency Fade';
        fadeLabel.style.cssText = `font-size: 9px; color: #aaffaa; width: 90px;`;
        
        const fadeSlider = document.createElement('input');
        fadeSlider.type = 'range';
        fadeSlider.min = 0;
        fadeSlider.max = 1;
        fadeSlider.step = 0.01;
        fadeSlider.value = 1;
        fadeSlider.style.cssText = `flex: 1; height: 3px; background: rgba(0, 255, 0, 0.15); outline: none; margin: 0;`;
        
        const fadeValueDisplay = document.createElement('span');
        fadeValueDisplay.textContent = '1.00';
        fadeValueDisplay.style.cssText = `font-size: 9px; color: #00ff00; width: 28px; text-align: right;`;
        
        fadeSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            fadeValueDisplay.textContent = value.toFixed(2);
            this._updateCheckerboardFade(value);
        });
        
        fadeRow.appendChild(fadeLabel);
        fadeRow.appendChild(fadeSlider);
        fadeRow.appendChild(fadeValueDisplay);
        section.appendChild(fadeRow);

        // Store reference to slider for updates
        section._fadeSlider = fadeSlider;
        section._fadeValueDisplay = fadeValueDisplay;

        // Initialize slider from current system state if available
        const currentFadeStrength = window.game?.textureBlendingSystem?.checkerFadeStrength;
        if (typeof currentFadeStrength === 'number') {
            const clamped = Math.max(0, Math.min(1, currentFadeStrength));
            fadeSlider.value = clamped;
            fadeValueDisplay.textContent = clamped.toFixed(2);
        }

        return section;
    }

    _updateCheckerboardFade(value) {
        console.log('[DevInterface] Updating checkerboard fade to:', value);
        
        // Try to access the texture blending system
        const game = window.game;
        console.log('[DevInterface] game exists:', !!game);
        
        if (game && game.textureBlendingSystem) {
            const tbs = game.textureBlendingSystem;
            console.log('[DevInterface] textureBlendingSystem exists:', !!tbs);
            console.log('[DevInterface] shaderMaterial exists:', !!tbs.shaderMaterial);
            tbs.checkerFadeStrength = value;
            
            if (tbs.shaderMaterial && tbs.shaderMaterial.uniforms) {
                console.log('[DevInterface] uniforms exist:', !!tbs.shaderMaterial.uniforms);
                console.log('[DevInterface] uFadeEnabled exists:', !!tbs.shaderMaterial.uniforms.uFadeEnabled);
                
                // Update the fade enabled uniform
                if (tbs.shaderMaterial.uniforms.uCheckerFadeStrength) {
                    tbs.shaderMaterial.uniforms.uCheckerFadeStrength.value = value;
                    console.log('[DevInterface] Set uCheckerFadeStrength to:', value);
                }
                tbs.shaderMaterial.needsUpdate = true;
                console.log('[DevInterface] Set needsUpdate to true');
            }
        } else {
            console.log('[DevInterface] Cannot access texture blending system');
        }
    }

    _getCurrentHours(board) {
        if (!board) return null;
        let gt = board.serverGameTime || 0;
        if (board.lastTimeSyncTimestamp > 0) gt += Date.now() - board.lastTimeSyncTimestamp;
        const dl = board.serverDayLength || 60000;
        return ((gt % dl) / dl) * 24;
    }

    _updateRigCurrentTimeLines(section) {
        if (!section || !section._rigTrackRefs) return;
        const board = window.boardSystem;
        const hours = this._getCurrentHours(board);
        if (hours === null) return;
        const pct = (hours / 24) * 100;
        Object.values(section._rigTrackRefs).forEach(track => {
            const line = track.querySelector('[data-current-time]');
            if (line) line.style.left = pct + '%';
        });
    }

    _createRigLightPanel(lightKey, label, rig, trackRefs) {
        const panel = document.createElement('div');
        panel.style.cssText = `border: 1px solid rgba(0,255,0,0.1); border-radius: 3px; padding: 4px; background: rgba(0,0,0,0.2);`;

        const titleRow = document.createElement('div');
        titleRow.textContent = label;
        titleRow.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; margin-bottom: 3px;`;
        panel.appendChild(titleRow);

        // Timeline labels
        const labels = document.createElement('div');
        labels.style.cssText = `display: flex; justify-content: space-between; font-size: 8px; color: #668866; margin-bottom: 2px;`;
        ['0h', '6h', '12h', '18h', '24h'].forEach(t => {
            const s = document.createElement('span');
            s.textContent = t;
            labels.appendChild(s);
        });
        panel.appendChild(labels);

        // Track
        const track = document.createElement('div');
        track.style.cssText = `
            position: relative;
            height: 18px;
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(0,255,0,0.15);
            border-radius: 2px;
            margin-bottom: 4px;
            cursor: crosshair;
        `;
        track.onclick = (e) => {
            if (e.target !== track) return;
            const rect = track.getBoundingClientRect();
            let t = (e.clientX - rect.left) / rect.width;
            t = Math.max(0, Math.min(1, t));
            const time = Math.round(t * 24 * 10) / 10;
            const kfs = rig.lights[lightKey];
            const state = board.interpolateRig(kfs, time);
            kfs.push({ time, color: '#' + state.color.getHexString(), intensity: Math.round(state.intensity * 100) / 100 });
            kfs.sort((a, b) => a.time - b.time);
            track._selectedIndex = kfs.findIndex(k => k.time === time);
            this._refreshRigUI(section, rig);
            this._saveRigToStorage(rig);
        };
        trackRefs[lightKey] = track;
        panel.appendChild(track);

        // Current time indicator line
        const timeLine = document.createElement('div');
        timeLine.dataset.currentTime = 'true';
        timeLine.style.cssText = `
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: rgba(255, 255, 255, 0.7);
            pointer-events: none;
            z-index: 5;
            left: 0%;
        `;
        track.appendChild(timeLine);

        // Editor area
        const editor = document.createElement('div');
        editor.style.cssText = `display: none; flex-direction: row; gap: 4px; align-items: center; flex-wrap: wrap;`;
        panel.appendChild(editor);

        // Populate handles
        this._renderRigHandles(track, editor, lightKey, rig);

        return panel;
    }

    _renderRigHandles(track, editor, lightKey, rig) {
        // Clear existing handles, keep current time line
        const toRemove = track.querySelectorAll('[data-rig-handle]');
        toRemove.forEach(el => el.remove());

        const kfs = rig.lights[lightKey];
        const selectedIdx = track._selectedIndex ?? -1;

        kfs.forEach((kf, idx) => {
            const handle = document.createElement('div');
            handle.dataset.rigHandle = 'true';
            handle.style.cssText = `
                position: absolute;
                top: 2px;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: ${kf.color};
                border: 1px solid rgba(255,255,255,0.4);
                cursor: grab;
                transform: translateX(-50%);
                left: ${(kf.time / 24) * 100}%;
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
            `;
            if (idx === selectedIdx) {
                handle.style.borderColor = '#00ff00';
                handle.style.boxShadow = '0 0 4px #00ff00';
            }
            handle.title = `${kf.time.toFixed(1)}h — ${kf.color} @ ${kf.intensity.toFixed(2)}`;
            handle.onmousedown = (e) => {
                e.stopPropagation();
                track._selectedIndex = idx;
                const section = track.closest('[data-category-section="rig"]');
                if (section && section._rigData) this._refreshRigUI(section, section._rigData);
                const dragState = section?._rigDragState;
                if (dragState) {
                    dragState.startX = e.clientX;
                    dragState.startY = e.clientY;
                    dragState.info = { track, lightKey, index: idx, active: false };
                }
            };
            track.appendChild(handle);
        });

        // Setup editor for selected
        if (selectedIdx >= 0 && selectedIdx < kfs.length) {
            editor.style.display = 'flex';
            this._buildRigKeyframeEditor(editor, kfs, selectedIdx, rig, track);
        } else {
            editor.style.display = 'none';
            editor.innerHTML = '';
        }
    }

    _updateRigHandleAppearance(track, idx, kf) {
        if (!track) return;
        const handles = track.querySelectorAll('[data-rig-handle]');
        const handle = handles[idx];
        if (!handle) return;
        handle.style.background = kf.color;
        handle.title = `${kf.time.toFixed(1)}h — ${kf.color} @ ${kf.intensity.toFixed(2)}`;
    }

    _buildRigKeyframeEditor(editor, kfs, idx, rig, track) {
        editor.innerHTML = '';
        editor.style.cssText = `
            display: flex;
            flex-direction: row;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
            background: rgba(0,30,0,0.25);
            border: 1px solid rgba(0,255,0,0.15);
            border-radius: 3px;
            padding: 4px 6px;
            margin-top: 2px;
        `;
        const kf = kfs[idx];

        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Colour';
        colorLabel.style.cssText = `font-size: 9px; color: #88cc88;`;
        editor.appendChild(colorLabel);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = kf.color;
        colorInput.title = 'Keyframe colour';
        colorInput.style.cssText = `width: 28px; height: 20px; border: none; padding: 0; cursor: pointer; background: none;`;
        colorInput.oninput = () => {
            kf.color = colorInput.value;
            this._updateRigHandleAppearance(track, idx, kf);
            this._saveRigToStorage(rig);
        };
        editor.appendChild(colorInput);

        const intLabel = document.createElement('span');
        intLabel.textContent = 'Intensity';
        intLabel.style.cssText = `font-size: 9px; color: #88cc88;`;
        editor.appendChild(intLabel);

        const intControls = document.createElement('div');
        intControls.style.cssText = `display: flex; align-items: center; gap: 4px; min-width: 150px;`;

        const intSlider = document.createElement('input');
        intSlider.type = 'range';
        intSlider.min = '0';
        intSlider.max = '5';
        intSlider.step = '0.01';
        intSlider.value = kf.intensity.toFixed(2);
        intSlider.style.cssText = `flex: 1; appearance: none; height: 4px; border-radius: 3px; background: rgba(0,255,0,0.15); border: 1px solid rgba(0,255,0,0.3);`; 

        const intValue = document.createElement('span');
        intValue.textContent = kf.intensity.toFixed(2);
        intValue.style.cssText = `font-size: 9px; color: #00ff00; min-width: 34px; text-align: right;`;

        intSlider.oninput = () => {
            const val = parseFloat(intSlider.value);
            kf.intensity = Number.isNaN(val) ? 0 : val;
            intValue.textContent = kf.intensity.toFixed(2);
            this._updateRigHandleAppearance(track, idx, kf);
            this._saveRigToStorage(rig);
        };

        intControls.appendChild(intSlider);
        intControls.appendChild(intValue);
        editor.appendChild(intControls);

        const timeLabel = document.createElement('span');
        timeLabel.textContent = `${kf.time.toFixed(1)}h`;
        timeLabel.style.cssText = `font-size: 9px; color: #88aa88; min-width: 28px;`;
        editor.appendChild(timeLabel);

        if (kfs.length > 2) {
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.style.cssText = `background: rgba(255,0,0,0.08); border: 1px solid rgba(255,0,0,0.25); color: #ff8888; font-size: 9px; cursor: pointer; padding: 2px 6px; border-radius: 2px;`;
            delBtn.onclick = () => {
                kfs.splice(idx, 1);
                track._selectedIndex = -1;
                this._refreshRigUI(editor.closest('[data-category-section="rig"]'), rig);
                this._saveRigToStorage(rig);
            };
            editor.appendChild(delBtn);
        }
    }

    _refreshRigUI(section, rig) {
        if (!section || !section._rigTrackRefs) return;
        const refs = section._rigTrackRefs;
        const lightKeys = ['sun', 'moon', 'ambient', 'nightAmbient'];
        lightKeys.forEach(key => {
            const track = refs[key];
            if (!track) return;
            const panel = track.parentElement;
            const editor = panel.querySelector('div:nth-child(4)');
            this._renderRigHandles(track, editor, key, rig);
        });
    }

    _createModelsContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'models';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
        `;

        const categoryHeader = document.createElement('div');
        categoryHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 0 0 4px 0;
            padding-bottom: 2px;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
        `;
        const title = document.createElement('span');
        title.textContent = 'MODELS';
        title.style.cssText = `font-size: 9px; font-weight: 600; color: #00ff00; letter-spacing: 0.5px;`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `background: none; border: none; color: #ff6666; font-size: 10px; cursor: pointer; padding: 0; width: 12px; height: 12px; line-height: 12px;`;
        closeBtn.onclick = () => this.toggleCategory('models');
        categoryHeader.appendChild(title);
        categoryHeader.appendChild(closeBtn);
        section.appendChild(categoryHeader);

        const container = document.createElement('div');
        container.style.cssText = `display: flex; flex-direction: column; gap: 3px;`;

        const pieceTypes = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
        const availableModels = [
            { value: '', label: 'Default' },
            { value: 'Bishop', label: 'Bishop' },
            { value: 'book', label: 'book' },
            { value: 'horizon', label: 'horizon' },
            { value: 'jesus+figurine+3d+model', label: 'jesus figurine' },
            { value: 'king', label: 'king' },
            { value: 'king1', label: 'king1' },
            { value: 'kinte', label: 'kinte' },
            { value: 'marker1', label: 'marker1' },
            { value: 'marker2', label: 'marker2' },
            { value: 'marker3', label: 'marker3' },
            { value: 'pawn', label: 'pawn' },
            { value: 'pawn1', label: 'pawn1' },
            { value: 'queen', label: 'queen' },
            { value: 'queen1', label: 'queen1' },
            { value: 'rook', label: 'rook' },
            { value: 'trunk', label: 'trunk' }
        ];

        let overrides = {};
        try {
            overrides = JSON.parse(localStorage.getItem('chessiopia_piece_models') || '{}');
        } catch (e) { /* ignore */ }

        pieceTypes.forEach(type => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 0;
                border-bottom: 1px solid rgba(0, 255, 0, 0.05);
            `;

            const label = document.createElement('span');
            label.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            label.style.cssText = `
                font-size: 9px;
                color: #aaffaa;
                width: 50px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            row.appendChild(label);

            const select = document.createElement('select');
            select.style.cssText = `
                flex: 1;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(0, 255, 0, 0.3);
                color: #00ff00;
                padding: 2px 4px;
                border-radius: 2px;
                font-size: 9px;
                cursor: pointer;
            `;
            availableModels.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === (overrides[type] || '')) option.selected = true;
                select.appendChild(option);
            });
            select.addEventListener('change', (e) => {
                const value = e.target.value;
                try {
                    const current = JSON.parse(localStorage.getItem('chessiopia_piece_models') || '{}');
                    if (value) {
                        current[type] = value;
                    } else {
                        delete current[type];
                    }
                    localStorage.setItem('chessiopia_piece_models', JSON.stringify(current));
                    console.log(`[DevInterface] Piece model override: ${type} -> ${value || 'default'}`);
                    if (window.game && window.game.piecesSystem) {
                        window.game.piecesSystem.glbModelCache.clear();
                        console.log(`[DevInterface] Cleared piece model cache`);
                    }
                } catch (err) {
                    console.error('[DevInterface] Failed to save piece model override:', err);
                }
            });
            row.appendChild(select);
            container.appendChild(row);
        });

        section.appendChild(container);
        return section;
    }

    _createJesusContent() {
        const section = document.createElement('div');
        section.dataset.categorySection = 'jesus';
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 6px;
            background: rgba(10, 10, 30, 0.6);
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(0, 255, 0, 0.1);
            padding-bottom: 4px;
        `;
        const title = document.createElement('span');
        title.textContent = 'JESUS SUMMON';
        title.style.cssText = 'font-size: 10px; font-weight: 600; color: #00ffcc; letter-spacing: 0.5px;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:none;color:#ff6666;font-size:11px;cursor:pointer;padding:0;width:12px;height:12px;line-height:12px;';
        closeBtn.onclick = () => this.toggleCategory('jesus');
        header.appendChild(title);
        header.appendChild(closeBtn);
        section.appendChild(header);

        const status = document.createElement('div');
        status.dataset.jesusStatus = '1';
        status.style.cssText = 'font-size: 9px; color: #a0ffc0;';
        status.textContent = 'Status: unavailable';
        section.appendChild(status);

        const sliderRow = document.createElement('div');
        sliderRow.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:9px; color:#cfd;';
        const sliderLabel = document.createElement('span');
        sliderLabel.dataset.jesusHeightLabel = '1';
        sliderLabel.textContent = 'Lift: 4.0m';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '1';
        slider.max = '20';
        slider.step = '0.5';
        slider.value = '4';
        slider.dataset.jesusHeightControl = '1';
        slider.style.cssText = 'flex:1;';
        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            sliderLabel.textContent = `Lift: ${value.toFixed(1)}m`;
            if (window.jesusSummonSystem && typeof window.jesusSummonSystem.setTargetLift === 'function') {
                window.jesusSummonSystem.setTargetLift(value);
            }
        });
        sliderRow.appendChild(sliderLabel);
        sliderRow.appendChild(slider);
        section.appendChild(sliderRow);

        const button = document.createElement('button');
        button.textContent = 'Summon Jesus';
        button.style.cssText = `
            background: linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,215,0,0.25));
            border: 1px solid rgba(255,215,0,0.5);
            color: #ffe083;
            padding: 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        `;
        button.onmouseenter = () => button.style.transform = 'translateY(-1px)';
        button.onmouseleave = () => button.style.transform = 'translateY(0)';
        button.onclick = () => {
            if (window.jesusSummonSystem && typeof window.jesusSummonSystem.summonJesus === 'function') {
                window.jesusSummonSystem.summonJesus();
                status.textContent = `Status: ${window.jesusSummonSystem.status || 'summoning'}`;
            } else {
                status.textContent = 'Status: system unavailable';
            }
        };
        section.appendChild(button);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size: 8px; color: #889; line-height: 1.4;';
        hint.textContent = 'Hover near the origin shoreline and watch the waters rise.';
        section.appendChild(hint);

        return section;
    }

    _startJesusStatusPolling() {
        this._stopJesusStatusPolling();
        const section = this.categoryCache.get('jesus');
        if (!section) return;
        const statusLabel = section.querySelector('[data-jesus-status]');
        const slider = section.querySelector('[data-jesus-height-control]');
        const sliderLabel = section.querySelector('[data-jesus-height-label]');
        if (!statusLabel) return;
        const update = () => {
            const system = window.jesusSummonSystem;
            const current = system ? (system.status || 'idle') : 'unavailable';
            statusLabel.textContent = `Status: ${current}`;
            if (system && slider && sliderLabel) {
                const target = system.getTargetLift ? system.getTargetLift() : system.targetLift;
                if (Number.isFinite(target)) {
                    slider.value = target;
                    sliderLabel.textContent = `Lift: ${Number(target).toFixed(1)}m`;
                }
            }
        };
        update();
        this._jesusStatusInterval = setInterval(update, 500);
    }

    _stopJesusStatusPolling() {
        if (this._jesusStatusInterval) {
            clearInterval(this._jesusStatusInterval);
            this._jesusStatusInterval = null;
        }
    }

    _getDefaultRig() {
        return {
            lights: {
                sun: [
                    { time: 0,  color: '#000000', intensity: 0.0 },
                    { time: 5,  color: '#ff6347', intensity: 0.1 },
                    { time: 6.5, color: '#ffd700', intensity: 0.6 },
                    { time: 12, color: '#ffffff', intensity: 1.0 },
                    { time: 18, color: '#ffaa55', intensity: 0.5 },
                    { time: 20, color: '#4a0080', intensity: 0.05 },
                    { time: 24, color: '#000000', intensity: 0.0 }
                ],
                moon: [
                    { time: 0,  color: '#e2e8f0', intensity: 0.5 },
                    { time: 5,  color: '#4a5568', intensity: 0.1 },
                    { time: 12, color: '#000000', intensity: 0.0 },
                    { time: 18, color: '#4a5568', intensity: 0.1 },
                    { time: 20, color: '#a0aec0', intensity: 0.4 },
                    { time: 24, color: '#e2e8f0', intensity: 0.5 }
                ],
                ambient: [
                    { time: 0,  color: '#2d1b4e', intensity: 0.05 },
                    { time: 5,  color: '#8b5cf6', intensity: 0.15 },
                    { time: 6,  color: '#ffecd2', intensity: 0.25 },
                    { time: 12, color: '#ffffff', intensity: 0.25 },
                    { time: 18, color: '#ffecd2', intensity: 0.25 },
                    { time: 20, color: '#8b5cf6', intensity: 0.15 },
                    { time: 24, color: '#2d1b4e', intensity: 0.05 }
                ],
                nightAmbient: [
                    { time: 0,  color: '#2a3a5a', intensity: 0.12 },
                    { time: 5,  color: '#2a3a5a', intensity: 0.08 },
                    { time: 6,  color: '#2a3a5a', intensity: 0.0 },
                    { time: 18, color: '#2a3a5a', intensity: 0.0 },
                    { time: 20, color: '#2a3a5a', intensity: 0.06 },
                    { time: 24, color: '#2a3a5a', intensity: 0.12 }
                ]
            }
        };
    }

    _getRigPreset(name) {
        if (name === 'Cinematic') {
            return {
                sun: [
                    { time: 0,  color: '#0a0a20', intensity: 0.0 },
                    { time: 5,  color: '#ff4500', intensity: 0.15 },
                    { time: 7,  color: '#ffaa00', intensity: 0.8 },
                    { time: 10, color: '#fff5e6', intensity: 1.1 },
                    { time: 14, color: '#ffffff', intensity: 1.2 },
                    { time: 18, color: '#ff7744', intensity: 0.6 },
                    { time: 20, color: '#220044', intensity: 0.08 },
                    { time: 24, color: '#0a0a20', intensity: 0.0 }
                ],
                moon: [
                    { time: 0,  color: '#ddeeff', intensity: 0.6 },
                    { time: 6,  color: '#000000', intensity: 0.0 },
                    { time: 18, color: '#445566', intensity: 0.15 },
                    { time: 22, color: '#c0d0e0', intensity: 0.5 },
                    { time: 24, color: '#ddeeff', intensity: 0.6 }
                ],
                ambient: [
                    { time: 0,  color: '#1a1040', intensity: 0.04 },
                    { time: 5,  color: '#6644aa', intensity: 0.12 },
                    { time: 7,  color: '#ffddaa', intensity: 0.3 },
                    { time: 12, color: '#e8f0ff', intensity: 0.3 },
                    { time: 18, color: '#ffccaa', intensity: 0.28 },
                    { time: 20, color: '#6644aa', intensity: 0.12 },
                    { time: 24, color: '#1a1040', intensity: 0.04 }
                ],
                nightAmbient: [
                    { time: 0,  color: '#223355', intensity: 0.15 },
                    { time: 5,  color: '#1a2a44', intensity: 0.08 },
                    { time: 7,  color: '#2a3a5a', intensity: 0.0 },
                    { time: 17, color: '#2a3a5a', intensity: 0.0 },
                    { time: 20, color: '#1a2a44', intensity: 0.08 },
                    { time: 24, color: '#223355', intensity: 0.15 }
                ]
            };
        }
        if (name === 'Flat Debug') {
            return {
                sun: [
                    { time: 0,  color: '#ffffff', intensity: 0.8 },
                    { time: 24, color: '#ffffff', intensity: 0.8 }
                ],
                moon: [
                    { time: 0,  color: '#ffffff', intensity: 0.3 },
                    { time: 24, color: '#ffffff', intensity: 0.3 }
                ],
                ambient: [
                    { time: 0,  color: '#ffffff', intensity: 0.5 },
                    { time: 24, color: '#ffffff', intensity: 0.5 }
                ],
                nightAmbient: [
                    { time: 0,  color: '#ffffff', intensity: 0.2 },
                    { time: 24, color: '#ffffff', intensity: 0.2 }
                ]
            };
        }
        if (name === 'Winter Gloom') {
            return {
                sun: [
                    { time: 0,  color: '#050510', intensity: 0.0 },
                    { time: 6,  color: '#8899aa', intensity: 0.3 },
                    { time: 10, color: '#c0d0e0', intensity: 0.5 },
                    { time: 14, color: '#d0e0f0', intensity: 0.55 },
                    { time: 17, color: '#8899aa', intensity: 0.3 },
                    { time: 20, color: '#101025', intensity: 0.05 },
                    { time: 24, color: '#050510', intensity: 0.0 }
                ],
                moon: [
                    { time: 0,  color: '#aabbcc', intensity: 0.35 },
                    { time: 6,  color: '#000000', intensity: 0.0 },
                    { time: 18, color: '#334455', intensity: 0.1 },
                    { time: 24, color: '#aabbcc', intensity: 0.35 }
                ],
                ambient: [
                    { time: 0,  color: '#111122', intensity: 0.03 },
                    { time: 6,  color: '#556677', intensity: 0.15 },
                    { time: 12, color: '#8899aa', intensity: 0.18 },
                    { time: 18, color: '#556677', intensity: 0.15 },
                    { time: 24, color: '#111122', intensity: 0.03 }
                ],
                nightAmbient: [
                    { time: 0,  color: '#1a2030', intensity: 0.1 },
                    { time: 6,  color: '#1a2030', intensity: 0.04 },
                    { time: 18, color: '#1a2030', intensity: 0.04 },
                    { time: 24, color: '#1a2030', intensity: 0.1 }
                ]
            };
        }
        return null;
    }

    _saveRigToStorage(rig) {
        try {
            localStorage.setItem('chesiopia-lighting-rig', JSON.stringify(rig));
        } catch (e) { /* ignore */ }
    }
}

// Initialize dev interface
window.devInterface = new DevInterface();

console.log('[DevInterface] Enhanced dev interface loaded. Press Space to toggle.');
