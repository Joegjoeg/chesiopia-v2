// TournamentSystem — Seasonal tournament events with jousting, banners, and knight gatherings

class TournamentSystem {
    constructor(scene, terrainSystem, settlementSystem, knightSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;
        this.knightSystem = knightSystem;

        this.activeTournament = null;
        this.tournamentTimer = 0;
        this.tournamentDuration = 60;
        this.cooldownTimer = 0;
        this.cooldownDuration = 120;

        this.joustState = null;
        this.joustTimer = 0;
        this.joustInterval = 8;

        this._group = null;
    }

    init() {
        console.log('[TournamentSystem] Initialized');
    }

    tryTriggerTournament(settlements) {
        if (this.activeTournament) return;
        if (this.cooldownTimer > 0) return;

        const villages = settlements.filter(s => s.type === 'village' && s._active);
        if (villages.length < 2) return;

        const host = villages[Math.floor(Math.random() * villages.length)];
        this.startTournament(host);
    }

    startTournament(hostSettlement) {
        console.log(`[TournamentSystem] Tournament at ${hostSettlement.name}!`);

        this.activeTournament = {
            hostId: hostSettlement.id,
            hostX: hostSettlement.x,
            hostZ: hostSettlement.z,
            timeRemaining: this.tournamentDuration,
            phase: 'gathering',
            phaseTimer: 10,
            participants: [],
            joustPair: null,
            joustResult: null
        };

        this.createTournamentVisuals(hostSettlement);

        const nearbyKnights = this.knightSystem.knights.filter(k => {
            const settlement = this.settlementSystem.settlements.find(s => s.id === k.settlementId);
            if (!settlement || settlement.id === hostSettlement.id) return false;
            return distance2D(settlement, hostSettlement) < 200;
        });

        for (const knight of nearbyKnights) {
            this.knightSystem.sendToTournament(knight, hostSettlement);
            this.activeTournament.participants.push(knight.id);
        }

        const hostKnight = hostSettlement.knight;
        if (hostKnight) {
            this.activeTournament.participants.push(hostKnight.id);
        }
    }

    createTournamentVisuals(settlement) {
        if (this._group) {
            this.scene.remove(this._group);
            this._group.traverse(c => {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
        }

        const group = new THREE.Group();
        group.name = `Tournament_${settlement.name}`;

        const greenNode = settlement.nodes.find(n => n.type === 'villageGreen');
        const cx = greenNode ? greenNode.x : settlement.x;
        const cz = greenNode ? greenNode.z : settlement.z;
        const cy = this.terrainSystem ? this.terrainSystem.getHeight(cx, cz) : 0;

        const tentGeo = new THREE.ConeGeometry(1.5, 1.8, 6);
        const tentMat = new THREE.MeshLambertMaterial({ color: 0xcc4444 });
        const tent = new THREE.Mesh(tentGeo, tentMat);
        tent.position.set(cx + 4, cy + 0.9, cz + 3);
        tent.castShadow = true;
        group.add(tent);

        const tent2 = new THREE.Mesh(tentGeo, new THREE.MeshLambertMaterial({ color: 0x4444cc }));
        tent2.position.set(cx - 4, cy + 0.9, cz + 3);
        tent2.castShadow = true;
        group.add(tent2);

        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const bannerGeo = new THREE.BoxGeometry(0.05, 1.2, 0.4);
            const bannerColors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff];
            const banner = new THREE.Mesh(bannerGeo, new THREE.MeshLambertMaterial({ color: bannerColors[i] }));
            banner.position.set(
                cx + Math.cos(angle) * 5,
                cy + 0.6,
                cz + Math.sin(angle) * 5
            );
            group.add(banner);
        }

        const barrierGeo = new THREE.BoxGeometry(6, 0.4, 0.15);
        const barrier = new THREE.Mesh(barrierGeo, new THREE.MeshLambertMaterial({ color: 0x8b7355 }));
        barrier.position.set(cx, cy + 0.2, cz - 4);
        group.add(barrier);

        group.position.y = 0;
        this.scene.add(group);
        this._group = group;
    }

    update(deltaTime) {
        if (this.cooldownTimer > 0) {
            this.cooldownTimer -= deltaTime;
        }

        if (!this.activeTournament) return;

        this.activeTournament.timeRemaining -= deltaTime;

        if (this.activeTournament.timeRemaining <= 0) {
            this.endTournament();
            return;
        }

        this.updateTournamentPhase(deltaTime);
    }

    updateTournamentPhase(deltaTime) {
        const t = this.activeTournament;

        switch (t.phase) {
            case 'gathering':
                t.phaseTimer -= deltaTime;
                this.checkKnightArrivals();
                if (t.phaseTimer <= 0) {
                    t.phase = 'jousting';
                    t.phaseTimer = 30;
                    this.startJoustRound();
                }
                break;

            case 'jousting':
                t.phaseTimer -= deltaTime;
                this.updateJoust(deltaTime);
                if (t.phaseTimer <= 0) {
                    t.phase = 'celebrating';
                    t.phaseTimer = 15;
                }
                break;

            case 'celebrating':
                t.phaseTimer -= deltaTime;
                if (t.phaseTimer <= 0) {
                    this.endTournament();
                }
                break;
        }
    }

    checkKnightArrivals() {
        for (const knight of this.knightSystem.knights) {
            if (knight.state === 'traveling' && this.activeTournament.participants.includes(knight.id)) {
                const hostSettlement = this.settlementSystem.settlements.find(
                    s => s.id === this.activeTournament.hostId
                );
                if (!hostSettlement) continue;

                const dist = distance2D(
                    { x: knight._group.position.x, z: knight._group.position.z },
                    hostSettlement
                );

                if (dist < 8) {
                    this.knightSystem.arriveAtTournament(knight);
                }
            }
        }
    }

    startJoustRound() {
        const availableKnights = this.knightSystem.knights.filter(k =>
            this.activeTournament.participants.includes(k.id) &&
            (k.state === 'socializing' || k.state === 'idle' || k.state === 'visiting')
        );

        if (availableKnights.length < 2) {
            this.activeTournament.phase = 'celebrating';
            this.activeTournament.phaseTimer = 10;
            return;
        }

        const a = availableKnights[Math.floor(Math.random() * availableKnights.length)];
        let b;
        do {
            b = availableKnights[Math.floor(Math.random() * availableKnights.length)];
        } while (b === a && availableKnights.length > 1);

        this.activeTournament.joustPair = { knightA: a.id, knightB: b.id };
        this.joustState = 'preparing';
        this.joustTimer = 2;
    }

    updateJoust(deltaTime) {
        if (!this.activeTournament.joustPair) {
            if (this.activeTournament.phaseTimer < 5) {
                this.startJoustRound();
            }
            return;
        }

        this.joustTimer -= deltaTime;

        const pair = this.activeTournament.joustPair;
        const knightA = this.knightSystem.knights.find(k => k.id === pair.knightA);
        const knightB = this.knightSystem.knights.find(k => k.id === pair.knightB);

        if (!knightA || !knightB) {
            this.activeTournament.joustPair = null;
            return;
        }

        switch (this.joustState) {
            case 'preparing':
                if (this.joustTimer <= 0) {
                    this.joustState = 'charging';
                    this.joustTimer = 3;
                }
                break;

            case 'charging':
                this.animateJoustCharge(knightA, knightB, deltaTime);
                if (this.joustTimer <= 0) {
                    this.resolveJoust(knightA, knightB);
                }
                break;

            case 'result':
                if (this.joustTimer <= 0) {
                    this.activeTournament.joustPair = null;
                    this.joustState = null;
                }
                break;
        }
    }

    animateJoustCharge(knightA, knightB, deltaTime) {
        if (!knightA._group || !knightB._group) return;

        const hostSettlement = this.settlementSystem.settlements.find(
            s => s.id === this.activeTournament.hostId
        );
        if (!hostSettlement) return;

        const cx = hostSettlement.x;
        const cz = hostSettlement.z;
        const cy = this.terrainSystem ? this.terrainSystem.getHeight(cx, cz) : 0;

        const progress = 1 - (this.joustTimer / 3);
        const offset = (1 - progress * 2) * 4;

        knightA._group.position.set(cx + offset, cy + 0.3, cz - 4);
        knightA._group.rotation.y = Math.PI / 2;

        knightB._group.position.set(cx - offset, cy + 0.3, cz - 4);
        knightB._group.rotation.y = -Math.PI / 2;
    }

    resolveJoust(knightA, knightB) {
        const roll = Math.random();
        let result;

        if (roll < 0.15) {
            result = { winner: knightA.name, loser: knightB.name, type: 'unhorsed' };
        } else if (roll < 0.30) {
            result = { winner: knightB.name, loser: knightA.name, type: 'unhorsed' };
        } else if (roll < 0.40) {
            result = { winner: knightA.name, loser: knightB.name, type: 'dramatic_fall' };
        } else if (roll < 0.50) {
            result = { winner: knightB.name, loser: knightA.name, type: 'dramatic_fall' };
        } else {
            result = { winner: null, loser: null, type: 'clean_pass' };
        }

        this.activeTournament.joustResult = result;
        this.joustState = 'result';
        this.joustTimer = 3;

        console.log(`[Tournament] Joust: ${knightA.name} vs ${knightB.name} — ${result.type}`);
    }

    endTournament() {
        console.log('[TournamentSystem] Tournament ended');

        if (this._group) {
            this.scene.remove(this._group);
            this._group.traverse(c => {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
            this._group = null;
        }

        for (const knight of this.knightSystem.knights) {
            if (knight.state === 'socializing' || knight.state === 'traveling') {
                knight.state = 'returning';
                knight.stateDuration = 8;
                knight.targetNode = knight.homeNode;
            }
        }

        this.activeTournament = null;
        this.cooldownTimer = this.cooldownDuration;
    }

    isTournamentActive() {
        return this.activeTournament !== null;
    }

    getActiveTournamentInfo() {
        if (!this.activeTournament) return null;
        const host = this.settlementSystem.settlements.find(s => s.id === this.activeTournament.hostId);
        return {
            hostName: host ? host.name : 'Unknown',
            phase: this.activeTournament.phase,
            timeRemaining: this.activeTournament.timeRemaining,
            participantCount: this.activeTournament.participants.length,
            joustResult: this.activeTournament.joustResult
        };
    }

    dispose() {
        if (this._group) {
            this.scene.remove(this._group);
            this._group.traverse(c => {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
            this._group = null;
        }
        this.activeTournament = null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TournamentSystem;
}
