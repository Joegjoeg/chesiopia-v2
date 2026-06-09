// TomeUI — Church tome interface: villager table with editable activity slots, stress bars, tournament tab

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
            width: 680px;
            max-height: 75vh;
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
                <button class="tomeTab" data-tab="tournament" style="flex:1; padding:8px; background:#4a3728; border:none; color:#c8b896; cursor:pointer; font-family:Georgia;">⚔️ Tournament</button>
                <button class="tomeTab" data-tab="info" style="flex:1; padding:8px; background:#4a3728; border:none; color:#c8b896; cursor:pointer; font-family:Georgia;">ℹ️ Info</button>
            </div>
            <div id="tomeContent" style="padding: 12px 16px; max-height: 45vh; overflow-y: auto; font-size: 13px; line-height: 1.6;"></div>
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
        const ledger = s._ledger;
        let stockInfo = '';
        if (ledger) {
            stockInfo = ` · 🌾${Math.floor(ledger.grainStock || 0)} 🐟${Math.floor(ledger.fishStock || 0)} ✝️${Math.floor(ledger.faithStock || 0)}`;
        }
        header.innerHTML = `
            <strong>${s.name}</strong> — ${s.typeDef.name} · Pop: ${Math.floor(s.population)}/${s.maxPopulation} · Age: ${s.age}d${stockInfo}
        `;

        const content = document.getElementById('tomeContent');

        switch (this.currentTab) {
            case 'villagers':
                content.innerHTML = this.renderVillagers(s);
                this.bindActivityDropdowns(s);
                break;
            case 'buildings':
                content.innerHTML = this.renderBuildings(s);
                break;
            case 'tournament':
                content.innerHTML = this.renderTournament(s);
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

        let html = '<div style="margin-bottom:8px; color:#c8b896; font-size:12px;">';
        for (const [role, count] of Object.entries(roleCounts)) {
            const roleDef = VILLAGER_ROLES[role];
            html += `<span style="margin-right:10px;">${roleDef ? roleDef.icon : ''} ${roleDef ? roleDef.label : role}: ${count}</span>`;
        }
        html += '</div>';

        const taskOptions = this.buildTaskOptions();

        html += '<div style="max-height:300px; overflow-y:auto;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
        html += '<thead><tr style="background:#2a1f18; color:#c8b896;">';
        html += '<th style="padding:4px 6px; text-align:left;">Villager</th>';
        html += '<th style="padding:4px 6px; text-align:left;">Role</th>';
        html += '<th style="padding:4px 6px; text-align:center; width:60px;">Stress</th>';
        html += '<th style="padding:4px 6px; text-align:center; width:40px;">✝️</th>';
        html += '<th style="padding:4px 6px; text-align:left;">🌅 Morning</th>';
        html += '<th style="padding:4px 6px; text-align:left;">🌆 Evening</th>';
        html += '</tr></thead><tbody>';

        for (const v of s.villagers) {
            const roleDef = VILLAGER_ROLES[v.role];
            const stressColor = this.getStressColor(v.stress);
            const stressBar = this.renderStressBar(v.stress);

            const morningActivity = v.activities ? v.activities[0] : null;
            const eveningActivity = v.activities ? v.activities[1] : null;

            const morningAssigned = morningActivity ? (morningActivity.playerOverride || morningActivity.assigned) : 'rest';
            const eveningAssigned = eveningActivity ? (eveningActivity.playerOverride || eveningActivity.assigned) : 'rest';
            const morningOverridden = morningActivity && morningActivity.playerOverride;
            const eveningOverridden = eveningActivity && eveningActivity.playerOverride;

            const calledStyle = v.calledToService ? 'background:#5c3020;' : '';
            const grumpyIcon = v.grumpy ? ' 😠' : '';

            html += `<tr style="border-bottom:1px solid #4a3728; ${calledStyle}">`;
            html += `<td style="padding:3px 6px;">${v.name}${grumpyIcon}</td>`;
            html += `<td style="padding:3px 6px; color:#c8b896;">${roleDef ? roleDef.icon : ''} ${roleDef ? roleDef.label : v.role}</td>`;
            html += `<td style="padding:3px 6px; text-align:center;">${stressBar} <span style="color:${stressColor}; font-size:10px;">${Math.round(v.stress)}</span></td>`;
            html += `<td style="padding:3px 6px; text-align:center; font-size:11px;">${Math.round(v.faith)}</td>`;

            html += `<td style="padding:3px 6px;">`;
            html += `<select class="tomeActivitySelect" data-villager="${v.id}" data-slot="0" `;
            html += `style="width:100%; font-size:11px; padding:2px; background:#3a2f28; color:${morningOverridden ? '#ff6b6b' : '#e8dcc8'}; border:1px solid ${morningOverridden ? '#ff4444' : '#6b5544'}; border-radius:3px;">`;
            html += taskOptions.replace(`value="${morningAssigned}"`, `value="${morningAssigned}" selected`);
            html += '</select></td>';

            html += `<td style="padding:3px 6px;">`;
            html += `<select class="tomeActivitySelect" data-villager="${v.id}" data-slot="1" `;
            html += `style="width:100%; font-size:11px; padding:2px; background:#3a2f28; color:${eveningOverridden ? '#ff6b6b' : '#e8dcc8'}; border:1px solid ${eveningOverridden ? '#ff4444' : '#6b5544'}; border-radius:3px;">`;
            html += taskOptions.replace(`value="${eveningAssigned}"`, `value="${eveningAssigned}" selected`);
            html += '</select></td>';

            html += '</tr>';
        }

        html += '</tbody></table></div>';

        return html;
    }

    buildTaskOptions() {
        let options = '';
        for (const [key, task] of Object.entries(TASKS)) {
            options += `<option value="${key}">${task.label}</option>`;
        }
        return options;
    }

    bindActivityDropdowns(s) {
        const selects = this.container.querySelectorAll('.tomeActivitySelect');
        selects.forEach(select => {
            select.addEventListener('change', (e) => {
                const villagerId = e.target.dataset.villager;
                const slotIndex = parseInt(e.target.dataset.slot);
                const newActivity = e.target.value;

                const villager = s.villagers.find(v => v.id === villagerId);
                if (!villager) return;

                if (villager.activities && villager.activities[slotIndex]) {
                    villager.activities[slotIndex].playerOverride = newActivity;
                    villager.calledToService = true;
                }

                if (this.settlementSystem.game && this.settlementSystem.game.networkManager) {
                    this.settlementSystem.game.networkManager.emit('tomeMutation', {
                        villageId: s.id,
                        villagerId,
                        slotIndex,
                        newActivity
                    });
                }

                e.target.style.color = '#ff6b6b';
                e.target.style.borderColor = '#ff4444';
            });
        });
    }

    getStressColor(stress) {
        if (stress > 100) return '#c084fc';
        if (stress > 70) return '#f87171';
        if (stress > 30) return '#fbbf24';
        return '#4ade80';
    }

    renderStressBar(stress) {
        const pct = Math.min(100, (stress / 150) * 100);
        const color = this.getStressColor(stress);
        return `<span style="display:inline-block; width:40px; height:8px; background:#2a1f18; border-radius:4px; vertical-align:middle; margin-right:2px;">
            <span style="display:block; width:${pct}%; height:100%; background:${color}; border-radius:4px;"></span>
        </span>`;
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

    renderTournament(s) {
        const ledger = s._ledger;
        const grainStock = ledger ? Math.floor(ledger.grainStock || 0) : 0;
        const fishStock = ledger ? Math.floor(ledger.fishStock || 0) : 0;
        const totalFood = grainStock + fishStock;
        const canAfford = totalFood >= 40;

        let html = '<div style="margin-bottom:12px;">';
        html += '<h3 style="margin:0 0 8px 0; color:#e8dcc8;">⚔️ Tournament Scheduling</h3>';
        html += `<p style="color:#c8b896; font-size:12px;">Food available: 🌾${grainStock} 🐟${fishStock} (Total: ${totalFood})</p>`;
        html += `<p style="color:#c8b896; font-size:12px;">Tournament cost: <strong>40 food</strong> · Can afford: <strong style="color:${canAfford ? '#4ade80' : '#f87171'};">${canAfford ? 'Yes' : 'No'}</strong></p>`;
        html += '</div>';

        html += '<div style="margin-bottom:12px;">';
        html += '<label style="color:#c8b896; font-size:12px;">Select date (weekends only):</label><br>';
        html += '<input type="number" id="tournamentDay" min="1" max="360" value="1" ';
        html += 'style="width:80px; padding:4px; background:#3a2f28; color:#e8dcc8; border:1px solid #6b5544; border-radius:3px; font-size:12px; margin-right:8px;">';
        html += '<button id="checkAvailabilityBtn" style="padding:4px 12px; background:#5c4033; color:#e8dcc8; border:1px solid #8b7355; border-radius:4px; cursor:pointer; font-family:Georgia; font-size:12px;">Check Availability</button>';
        html += '</div>';

        html += '<div id="tournamentResult" style="color:#c8b896; font-size:12px;"></div>';

        html += '<div style="margin-top:16px;">';
        html += '<h4 style="margin:0 0 6px 0; color:#e8dcc8;">Scheduled Tournaments</h4>';
        html += '<div id="tournamentList" style="color:#a09080; font-size:12px;">None scheduled</div>';
        html += '</div>';

        setTimeout(() => {
            const checkBtn = document.getElementById('checkAvailabilityBtn');
            if (checkBtn) {
                checkBtn.addEventListener('click', () => {
                    const dayInput = document.getElementById('tournamentDay');
                    const day = parseInt(dayInput?.value) || 1;
                    const resultDiv = document.getElementById('tournamentResult');
                    if (resultDiv) {
                        resultDiv.innerHTML = `<span style="color:#fbbf24;">Checking availability for day ${day}... (server check coming in Phase 3)</span>`;
                    }
                });
            }
        }, 50);

        return html;
    }

    renderInfo(s) {
        const season = this.settlementSystem.getCurrentSeason();
        const seasonDef = SEASONS[season];
        const ledger = s._ledger;

        let html = `
            <div style="margin-bottom:8px;"><strong>Settlement:</strong> ${s.name}</div>
            <div style="margin-bottom:8px;"><strong>Type:</strong> ${s.typeDef.name}</div>
            <div style="margin-bottom:8px;"><strong>Location:</strong> (${s.x.toFixed(1)}, ${s.z.toFixed(1)})</div>
            <div style="margin-bottom:8px;"><strong>Population:</strong> ${Math.floor(s.population)} / ${s.maxPopulation}</div>
            <div style="margin-bottom:8px;"><strong>Food Capacity:</strong> ${Math.floor(s.foodCapacity)}</div>
            <div style="margin-bottom:8px;"><strong>Faith Capacity:</strong> ${Math.floor(s.faithCapacity)}</div>
            <div style="margin-bottom:8px;"><strong>Buildings:</strong> ${s.buildings.length}</div>
            <div style="margin-bottom:8px;"><strong>Villagers:</strong> ${s.villagers.length}</div>
            <div style="margin-bottom:8px;"><strong>Age:</strong> ${s.age} days</div>
            <div style="margin-bottom:8px;"><strong>Season:</strong> ${seasonDef.label}</div>
            <div style="margin-bottom:8px;"><strong>Knight:</strong> ${s.knight ? s.knight.name : 'None'}</div>
            <div style="margin-bottom:8px;"><strong>Has Church:</strong> ${s.typeDef.hasChurch ? 'Yes' : 'No'}</div>
            <div style="margin-bottom:8px;"><strong>Has Manor:</strong> ${s.typeDef.hasManor ? 'Yes' : 'No'}</div>
            <div style="margin-bottom:8px;"><strong>Has Green:</strong> ${s.typeDef.hasGreen ? 'Yes' : 'No'}</div>
        `;

        if (ledger) {
            html += '<hr style="border-color:#6b5544; margin:12px 0;">';
            html += '<div style="color:#c8b896; font-size:12px;"><strong>Village Ledger:</strong></div>';
            html += `<div style="margin-bottom:4px;">🌾 Grain Stock: ${Math.floor(ledger.grainStock || 0)}</div>`;
            html += `<div style="margin-bottom:4px;">🐟 Fish Stock: ${Math.floor(ledger.fishStock || 0)}</div>`;
            html += `<div style="margin-bottom:4px;">✝️ Faith Stock: ${Math.floor(ledger.faithStock || 0)}</div>`;
            html += `<div style="margin-bottom:4px;">🍽️ Diet Bias: ${((ledger.dietBias || 0) * 100).toFixed(0)}% fish</div>`;
            html += `<div style="margin-bottom:4px;">😰 Collective Stress: ${(ledger.collectiveStress || 0).toFixed(1)}</div>`;
        }

        return html;
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
