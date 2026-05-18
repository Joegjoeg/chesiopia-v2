// TomeUI — Church tome interface for viewing settlement data, villager lists, roles, schedules

class TomeUI {
    constructor(settlementSystem) {
        this.settlementSystem = settlementSystem;

        this.container = null;
        this.isOpen = false;
        this.currentSettlement = null;
        this.currentTab = 'villagers';
    }

    init() {
        this.createUI();
        console.log('[TomeUI] Initialized');
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'tomeUI';
        this.container.style.cssText = `
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 520px;
            max-height: 70vh;
            background: linear-gradient(135deg, #3a2f28 0%, #5c4033 50%, #3a2f28 100%);
            border: 3px solid #8b7355;
            border-radius: 12px;
            color: #e8dcc8;
            font-family: 'Georgia', serif;
            z-index: 1000;
            box-shadow: 0 0 40px rgba(0,0,0,0.7), inset 0 0 20px rgba(0,0,0,0.3);
            overflow: hidden;
        `;

        this.container.innerHTML = `
            <div style="background: #2a1f18; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #8b7355;">
                <span style="font-size: 18px; font-weight: bold;">📖 Village Tome</span>
                <button id="tomeClose" style="background: none; border: 1px solid #8b7355; color: #e8dcc8; padding: 4px 12px; cursor: pointer; border-radius: 4px; font-family: Georgia;">✕ Close</button>
            </div>
            <div id="tomeHeader" style="padding: 10px 16px; background: #4a3728; border-bottom: 1px solid #6b5544; font-size: 14px;"></div>
            <div style="display: flex; border-bottom: 1px solid #6b5544;">
                <button class="tomeTab active" data-tab="villagers" style="flex:1; padding:8px; background:#5c4033; border:none; color:#e8dcc8; cursor:pointer; font-family:Georgia;">👥 Villagers</button>
                <button class="tomeTab" data-tab="buildings" style="flex:1; padding:8px; background:#4a3728; border:none; color:#c8b896; cursor:pointer; font-family:Georgia;">🏠 Buildings</button>
                <button class="tomeTab" data-tab="schedule" style="flex:1; padding:8px; background:#4a3728; border:none; color:#c8b896; cursor:pointer; font-family:Georgia;">📋 Schedules</button>
                <button class="tomeTab" data-tab="info" style="flex:1; padding:8px; background:#4a3728; border:none; color:#c8b896; cursor:pointer; font-family:Georgia;">ℹ️ Info</button>
            </div>
            <div id="tomeContent" style="padding: 12px 16px; max-height: 40vh; overflow-y: auto; font-size: 13px; line-height: 1.6;"></div>
        `;

        document.body.appendChild(this.container);

        document.getElementById('tomeClose').addEventListener('click', () => this.close());

        this.container.querySelectorAll('.tomeTab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    open(settlement) {
        if (!settlement) return;
        this.currentSettlement = settlement;
        this.isOpen = true;
        this.container.style.display = 'block';
        this.render();
    }

    close() {
        this.isOpen = false;
        this.container.style.display = 'none';
        this.currentSettlement = null;
    }

    toggle(settlement) {
        if (this.isOpen && this.currentSettlement === settlement) {
            this.close();
        } else {
            this.open(settlement);
        }
    }

    switchTab(tab) {
        this.currentTab = tab;
        this.container.querySelectorAll('.tomeTab').forEach(t => {
            t.style.background = t.dataset.tab === tab ? '#5c4033' : '#4a3728';
            t.style.color = t.dataset.tab === tab ? '#e8dcc8' : '#c8b896';
        });
        this.render();
    }

    render() {
        if (!this.currentSettlement) return;

        const s = this.currentSettlement;
        const header = document.getElementById('tomeHeader');
        header.innerHTML = `
            <strong>${s.name}</strong> — ${s.typeDef.name} · Population: ${Math.floor(s.population)}/${s.maxPopulation} · Age: ${s.age} days
        `;

        const content = document.getElementById('tomeContent');

        switch (this.currentTab) {
            case 'villagers':
                content.innerHTML = this.renderVillagers(s);
                break;
            case 'buildings':
                content.innerHTML = this.renderBuildings(s);
                break;
            case 'schedule':
                content.innerHTML = this.renderSchedules(s);
                break;
            case 'info':
                content.innerHTML = this.renderInfo(s);
                break;
        }
    }

    renderVillagers(s) {
        if (!s.villagers || s.villagers.length === 0) {
            return '<div style="color:#a09080; text-align:center; padding:20px;">No villagers yet.</div>';
        }

        const roleCounts = {};
        for (const v of s.villagers) {
            roleCounts[v.role] = (roleCounts[v.role] || 0) + 1;
        }

        let html = '<div style="margin-bottom:10px; color:#c8b896;">';
        for (const [role, count] of Object.entries(roleCounts)) {
            const roleDef = VILLAGER_ROLES[role];
            html += `<span style="margin-right:12px;">${roleDef ? roleDef.icon : ''} ${roleDef ? roleDef.label : role}: ${count}</span>`;
        }
        html += '</div>';

        html += '<div style="max-height:250px; overflow-y:auto;">';
        for (const v of s.villagers) {
            const roleDef = VILLAGER_ROLES[v.role];
            html += `
                <div style="padding:4px 0; border-bottom:1px solid #4a3728; display:flex; justify-content:space-between;">
                    <span>${roleDef ? roleDef.icon : '🧑'} <strong>${roleDef ? roleDef.label : v.role}</strong> (Age ${Math.floor(v.age)})</span>
                    <span style="color:#a09080; font-size:11px;">🌅 ${TASKS[v.morningTask] ? TASKS[v.morningTask].label : v.morningTask} · 🌆 ${TASKS[v.eveningTask] ? TASKS[v.eveningTask].label : v.eveningTask}</span>
                </div>`;
        }
        html += '</div>';

        return html;
    }

    renderBuildings(s) {
        if (!s.buildings || s.buildings.length === 0) {
            return '<div style="color:#a09080; text-align:center; padding:20px;">No buildings yet.</div>';
        }

        const typeCounts = {};
        for (const b of s.buildings) {
            typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
        }

        let html = '';
        for (const [type, count] of Object.entries(typeCounts)) {
            html += `<div style="padding:4px 0; border-bottom:1px solid #4a3728;">🏠 ${type}: <strong>${count}</strong></div>`;
        }

        return html;
    }

    renderSchedules(s) {
        const hour = this.settlementSystem.getHourOfDay();
        const timeSlot = getCurrentTimeSlot(hour);
        const season = this.settlementSystem.getCurrentSeason();

        let html = `<div style="margin-bottom:10px; color:#c8b896;">
            Current: <strong>${TIME_SLOTS[timeSlot].label}</strong> · Season: <strong>${SEASONS[season].label}</strong>
        </div>`;

        html += '<div style="max-height:250px; overflow-y:auto;">';
        for (const v of s.villagers) {
            const roleDef = VILLAGER_ROLES[v.role];
            html += `
                <div style="padding:6px 0; border-bottom:1px solid #4a3728;">
                    <div>${roleDef ? roleDef.icon : '🧑'} <strong>${roleDef ? roleDef.label : v.role}</strong></div>
                    <div style="color:#a09080; font-size:11px; margin-top:2px;">
                        🌅 Morning: <span style="color:#e8dcc8;">${TASKS[v.morningTask] ? TASKS[v.morningTask].label : v.morningTask}</span>
                        &nbsp;·&nbsp;
                        🌆 Evening: <span style="color:#e8dcc8;">${TASKS[v.eveningTask] ? TASKS[v.eveningTask].label : v.eveningTask}</span>
                    </div>
                </div>`;
        }
        html += '</div>';

        return html;
    }

    renderInfo(s) {
        const season = this.settlementSystem.getCurrentSeason();
        const seasonDef = SEASONS[season];

        return `
            <div style="margin-bottom:8px;"><strong>Settlement:</strong> ${s.name}</div>
            <div style="margin-bottom:8px;"><strong>Type:</strong> ${s.typeDef.name}</div>
            <div style="margin-bottom:8px;"><strong>Location:</strong> (${s.x.toFixed(1)}, ${s.z.toFixed(1)})</div>
            <div style="margin-bottom:8px;"><strong>Population:</strong> ${Math.floor(s.population)} / ${s.maxPopulation}</div>
            <div style="margin-bottom:8px;"><strong>Food Capacity:</strong> ${Math.floor(s.foodCapacity)}</div>
            <div style="margin-bottom:8px;"><strong>Buildings:</strong> ${s.buildings.length}</div>
            <div style="margin-bottom:8px;"><strong>Villagers:</strong> ${s.villagers.length}</div>
            <div style="margin-bottom:8px;"><strong>Age:</strong> ${s.age} days</div>
            <div style="margin-bottom:8px;"><strong>Season:</strong> ${seasonDef.label}</div>
            <div style="margin-bottom:8px;"><strong>Knight:</strong> ${s.knight ? s.knight.name : 'None'}</div>
            <div style="margin-bottom:8px;"><strong>Has Church:</strong> ${s.typeDef.hasChurch ? 'Yes' : 'No'}</div>
            <div style="margin-bottom:8px;"><strong>Has Manor:</strong> ${s.typeDef.hasManor ? 'Yes' : 'No'}</div>
            <div style="margin-bottom:8px;"><strong>Has Green:</strong> ${s.typeDef.hasGreen ? 'Yes' : 'No'}</div>
        `;
    }

    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TomeUI;
}
