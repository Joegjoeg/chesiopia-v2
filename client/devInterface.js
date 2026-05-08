/**
 * Enhanced Dev Interface with Transparent Background
 * Comprehensive parameter controls for all world systems
 */
class DevInterface {
    constructor() {
        this.isVisible = false;
        this.container = null;
        this.parameterSystem = window.parameterSystem;
        this.categories = ['terrain', 'planet', 'lighting', 'time', 'environment', 'graphics', 'performance', 'lod'];
        this.categoryCache = new Map(); // Cache DOM elements for each category
        this.activeCategories = new Set(); // Multiple categories can be active
        
        this.init();
        console.log('[DevInterface] Enhanced dev interface initialized');
    }
    
    init() {
        this.createInterface();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
    }
    
    createInterface() {
        // Create main container with transparent background
        this.container = document.createElement('div');
        this.container.id = 'enhancedDevInterface';
        this.container.style.cssText = `
            position: fixed;
            top: 5px;
            right: 5px;
            width: 320px;
            max-height: 95vh;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            padding: 8px 10px;
            font-family: 'Segoe UI', 'Roboto', sans-serif;
            font-size: 10px;
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
        
        // Create compact tab navigation (toggle buttons)
        const tabNav = document.createElement('div');
        tabNav.style.cssText = `
            display: flex;
            gap: 3px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        `;

        this.categories.forEach(category => {
            const tab = document.createElement('button');
            tab.textContent = category.slice(0, 3).toUpperCase();
            tab.dataset.category = category;
            tab.title = category;
            tab.style.cssText = `
                background: rgba(0, 255, 0, 0.08);
                border: 1px solid rgba(0, 255, 0, 0.2);
                color: #00ff00;
                padding: 2px 5px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 9px;
                font-weight: 500;
                transition: all 0.15s;
                min-width: 32px;
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
            grid-template-columns: 1fr 1fr 1fr;
            gap: 3px;
        `;

        const actions = [
            { text: 'Reset', action: () => this.resetAllParameters(), color: '#ff8888' },
            { text: 'Rand', action: () => this.randomizeParameters(), color: '#ffaa44' },
            { text: 'Export', action: () => this.exportConfiguration(), color: '#00aaff' },
            { text: 'Import', action: () => this.importConfiguration(), color: '#00aaff' },
            { text: 'Photo', action: () => this.takeScreenshot(), color: '#00ff88' },
            { text: 'Logs', action: () => this.getClientLogs(), color: '#aa88ff' }
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
        });

        quickActions.appendChild(actionButtons);
        this.container.appendChild(quickActions);
        
        document.body.appendChild(this.container);
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
        } else {
            // Show this category
            this.activeCategories.add(category);
            if (!this.categoryCache.has(category)) {
                const categoryContent = this.createCategoryContent(category);
                this.categoryCache.set(category, categoryContent);
            }
            this.contentArea.appendChild(this.categoryCache.get(category));
        }
        this.updateTabStyles();
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
        const parameters = this.parameterSystem.getParametersByCategory(category);
        const section = document.createElement('div');
        section.dataset.categorySection = category;
        section.style.cssText = `
            border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 4px;
            padding: 4px 6px;
            background: rgba(0, 20, 0, 0.3);
        `;

        // Compact category header with close button
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
        
        // Create compact parameter controls
        Object.entries(parameters).forEach(([name, config]) => {
            const paramRow = document.createElement('div');
            paramRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 0;
                border-bottom: 1px solid rgba(0, 255, 0, 0.05);
            `;

            // Compact label
            const label = document.createElement('span');
            label.textContent = (config.description || name).slice(0, 18);
            label.title = config.description || name;
            label.style.cssText = `
                font-size: 8px;
                color: #aaffaa;
                width: 70px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            paramRow.appendChild(label);
            
            // Compact controls
            if (config.type === 'color') {
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
            } else {
                // Slider + number in compact row
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = config.min || 0;
                slider.max = config.max || 100;
                slider.step = config.step || 1;
                slider.value = config.value;
                slider.style.cssText = `
                    flex: 1;
                    height: 3px;
                    background: rgba(0, 255, 0, 0.15);
                    outline: none;
                    margin: 0;
                `;

                const numberInput = document.createElement('input');
                numberInput.type = 'number';
                numberInput.min = config.min || 0;
                numberInput.max = config.max || 100;
                numberInput.step = config.step || 1;
                numberInput.value = config.value;
                numberInput.style.cssText = `
                    width: 45px;
                    background: rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(0, 255, 0, 0.2);
                    color: #00ff00;
                    padding: 1px 3px;
                    border-radius: 2px;
                    font-size: 8px;
                    text-align: right;
                `;

                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    numberInput.value = value;
                    this.parameterSystem.setParameter(name, value);
                });

                numberInput.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    slider.value = value;
                    this.parameterSystem.setParameter(name, value);
                });

                paramRow.dataset.parameter = name;
                paramRow.appendChild(slider);
                paramRow.appendChild(numberInput);
            }

            // Compact reset button (only shows when overridden)
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
            // Toggle dev interface with Space key
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.toggle();
            }
            
            // Quick category switching with number keys
            if (this.isVisible && e.key >= '1' && e.key <= '8') {
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
            if (slider && !slider.matches(':focus')) slider.value = value;
            if (num && !num.matches(':focus')) num.value = value;

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
    }
    
    hide() {
        this.isVisible = false;
        this.container.style.display = 'none';
    }
    
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
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
    
    exportConfiguration() {
        const config = this.parameterSystem.getAllParameters();
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
}

// Initialize dev interface
window.devInterface = new DevInterface();

console.log('[DevInterface] Enhanced dev interface loaded. Press Space to toggle.');
