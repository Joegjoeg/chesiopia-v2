// KnightSystem — Ceremonial prestige knight NPCs: manor life, road riding, tournament attendance

class KnightSystem {
    constructor(scene, terrainSystem, settlementSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;

        this.knights = [];
        this.knightIdCounter = 0;

        this.knightGeometry = null;
        this.knightMaterial = null;
        this.horseGeometry = null;
        this.horseMaterial = null;
    }

    init() {
        this.knightGeometry = new THREE.CapsuleGeometry(0.2, 0.5, 4, 8);
        this.knightMaterial = new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });
        this.horseGeometry = new THREE.BoxGeometry(0.5, 0.6, 1.0);
        this.horseMaterial = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
        console.log('[KnightSystem] Initialized');
    }

    assignKnight(settlement) {
        if (settlement.knight) return;

        const id = ++this.knightIdCounter;
        const manorNode = settlement.nodes.find(n => n.type === 'manor');
        const homeNode = manorNode || { x: settlement.x, z: settlement.z, y: 0 };

        const knight = {
            id,
            name: this.generateKnightName(),
            settlementId: settlement.id,
            homeNode,
            currentNode: homeNode,
            targetNode: null,
            state: 'idle',
            stateTimer: 0,
            stateDuration: 5 + Math.random() * 10,
            moveProgress: 0,
            moveSpeed: 1.5,
            _group: null,
            _knightMesh: null,
            _horseMesh: null
        };

        this.createKnightMesh(knight, settlement);
        this.knights.push(knight);
        settlement.knight = knight;
    }

    generateKnightName() {
        const firstNames = ['Sir Aldric', 'Sir Cedric', 'Sir Godfrey', 'Sir Percival', 'Sir Roland',
                           'Sir Tristan', 'Sir Gawain', 'Sir Lancelot', 'Sir Bedivere', 'Sir Gareth'];
        const titles = ['the Bold', 'the Just', 'the Fair', 'the Stalwart', 'of the Green',
                        'the Valiant', 'the Steadfast', 'the Noble', 'the True', 'the Wise'];
        return firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' +
               titles[Math.floor(Math.random() * titles.length)];
    }

    createKnightMesh(knight, settlement) {
        const group = new THREE.Group();
        group.name = `Knight_${knight.name}`;

        const horse = new THREE.Mesh(this.horseGeometry, this.horseMaterial);
        horse.position.y = 0.3;
        horse.castShadow = true;
        group.add(horse);
        knight._horseMesh = horse;

        const horseHeadGeo = new THREE.BoxGeometry(0.2, 0.25, 0.3);
        const horseHead = new THREE.Mesh(horseHeadGeo, this.horseMaterial);
        horseHead.position.set(0, 0.5, 0.55);
        group.add(horseHead);

        const knightBody = new THREE.Mesh(this.knightGeometry, this.knightMaterial);
        knightBody.position.y = 0.75;
        knightBody.scale.set(0.8, 0.8, 0.8);
        knightBody.castShadow = true;
        group.add(knightBody);
        knight._knightMesh = knightBody;

        const helmetGeo = new THREE.SphereGeometry(0.15, 6, 4);
        const helmet = new THREE.Mesh(helmetGeo, new THREE.MeshLambertMaterial({ color: 0x888888 }));
        helmet.position.y = 1.15;
        group.add(helmet);

        const plumeGeo = new THREE.ConeGeometry(0.05, 0.2, 4);
        const plume = new THREE.Mesh(plumeGeo, new THREE.MeshLambertMaterial({ color: 0xff4444 }));
        plume.position.y = 1.3;
        group.add(plume);

        const pos = this.getNodePos(knight.homeNode);
        group.position.copy(pos);
        group.position.y += 0.3;

        settlement._group.add(group);
        knight._group = group;
    }

    getNodePos(node) {
        const y = this.terrainSystem ? this.terrainSystem.getHeight(node.x, node.z) : (node.y || 0);
        return new THREE.Vector3(node.x, y, node.z);
    }

    update(deltaTime) {
        for (const knight of this.knights) {
            this.updateKnight(knight, deltaTime);
        }
    }

    updateKnight(knight, deltaTime) {
        if (!knight._group) return;

        const settlement = this.settlementSystem.settlements.find(s => s.id === knight.settlementId);
        if (!settlement || !settlement._active) return;

        knight.stateTimer -= deltaTime;

        if (knight.stateTimer <= 0) {
            this.transitionKnightState(knight, settlement);
        }

        switch (knight.state) {
            case 'idle':
                this.idleAtNode(knight, settlement, deltaTime);
                break;
            case 'riding':
                this.rideRoads(knight, settlement, deltaTime);
                break;
            case 'visiting':
                this.visitGreen(knight, settlement, deltaTime);
                break;
            case 'traveling':
                this.travelToTournament(knight, deltaTime);
                break;
            case 'socializing':
                this.socialize(knight, settlement, deltaTime);
                break;
            case 'returning':
                this.returnHome(knight, settlement, deltaTime);
                break;
        }
    }

    transitionKnightState(knight, settlement) {
        const states = ['idle', 'riding', 'visiting'];
        const weights = [0.4, 0.35, 0.25];

        if (knight.state === 'traveling' || knight.state === 'socializing') {
            knight.state = 'returning';
            knight.stateDuration = 8 + Math.random() * 5;
            knight.targetNode = knight.homeNode;
            return;
        }

        if (knight.state === 'returning') {
            knight.state = 'idle';
            knight.stateDuration = 5 + Math.random() * 10;
            knight.currentNode = knight.homeNode;
            return;
        }

        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let rand = Math.random() * totalWeight;
        let chosen = states[0];
        for (let i = 0; i < states.length; i++) {
            rand -= weights[i];
            if (rand <= 0) { chosen = states[i]; break; }
        }

        knight.state = chosen;
        knight.stateDuration = 4 + Math.random() * 8;

        switch (chosen) {
            case 'riding': {
                const roadNodes = this.getRoadNodes(settlement);
                if (roadNodes.length > 0) {
                    knight.targetNode = roadNodes[Math.floor(Math.random() * roadNodes.length)];
                } else {
                    knight.state = 'idle';
                }
                break;
            }
            case 'visiting': {
                const green = settlement.nodes.find(n => n.type === 'villageGreen');
                knight.targetNode = green || knight.homeNode;
                break;
            }
            default:
                knight.targetNode = null;
        }
    }

    getRoadNodes(settlement) {
        const nodes = [];
        for (const [key, segment] of this.settlementSystem.roadSystem.roadSegments) {
            if (segment.settlementId === settlement.id && segment.strength >= ROAD_TYPES.villageRoad.strength) {
                nodes.push({ x: segment.from.x, z: segment.from.z, y: 0, type: 'road' });
                nodes.push({ x: segment.to.x, z: segment.to.z, y: 0, type: 'road' });
            }
        }
        return nodes;
    }

    idleAtNode(knight, settlement, deltaTime) {
        if (!knight._group) return;
        const pos = this.getNodePos(knight.homeNode);
        const current = knight._group.position;
        current.x = lerp(current.x, pos.x, deltaTime * 0.5);
        current.z = lerp(current.z, pos.z, deltaTime * 0.5);
        current.y = pos.y + 0.3;
    }

    rideRoads(knight, settlement, deltaTime) {
        if (!knight.targetNode || !knight._group) return;
        this.moveToward(knight, knight.targetNode, deltaTime);
    }

    visitGreen(knight, settlement, deltaTime) {
        if (!knight.targetNode || !knight._group) return;
        this.moveToward(knight, knight.targetNode, deltaTime);
    }

    socialize(knight, settlement, deltaTime) {
        if (!knight._group) return;
        const pos = this.getNodePos(knight.currentNode || knight.homeNode);
        const current = knight._group.position;
        current.x = lerp(current.x, pos.x + Math.sin(knight.stateTimer * 2) * 0.5, deltaTime * 0.3);
        current.z = lerp(current.z, pos.z + Math.cos(knight.stateTimer * 2) * 0.5, deltaTime * 0.3);
        current.y = pos.y + 0.3;
    }

    travelToTournament(knight, deltaTime) {
        if (!knight.targetNode || !knight._group) return;
        this.moveToward(knight, knight.targetNode, deltaTime);
    }

    returnHome(knight, settlement, deltaTime) {
        if (!knight._group) return;
        this.moveToward(knight, knight.homeNode, deltaTime);
    }

    moveToward(knight, target, deltaTime) {
        const targetPos = this.getNodePos(target);
        const currentPos = knight._group.position.clone();
        currentPos.y = targetPos.y;

        const dist = currentPos.distanceTo(targetPos);

        if (dist < 0.5) {
            knight.currentNode = target;
            knight.targetNode = null;
            knight.stateTimer = 0;
            return;
        }

        const speed = knight.moveSpeed * deltaTime;
        const t = Math.min(1, speed / dist);
        knight._group.position.lerp(targetPos, t);

        const terrainY = this.terrainSystem
            ? this.terrainSystem.getHeight(knight._group.position.x, knight._group.position.z)
            : targetPos.y;
        knight._group.position.y = terrainY + 0.3;

        const dx = targetPos.x - knight._group.position.x;
        const dz = targetPos.z - knight._group.position.z;
        knight._group.rotation.y = Math.atan2(dx, dz);
    }

    sendToTournament(knight, tournamentLocation) {
        knight.state = 'traveling';
        knight.stateDuration = 20;
        knight.targetNode = {
            x: tournamentLocation.x,
            z: tournamentLocation.z,
            y: 0,
            type: 'tournament'
        };
    }

    arriveAtTournament(knight) {
        knight.state = 'socializing';
        knight.stateDuration = 15;
        knight.currentNode = knight.targetNode;
        knight.targetNode = null;
    }

    dispose() {
        for (const knight of this.knights) {
            if (knight._group) {
                if (knight._group.parent) knight._group.parent.remove(knight._group);
                knight._group.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }
        }
        this.knights = [];

        if (this.knightGeometry) { this.knightGeometry.dispose(); this.knightGeometry = null; }
        if (this.knightMaterial) { this.knightMaterial.dispose(); this.knightMaterial = null; }
        if (this.horseGeometry) { this.horseGeometry.dispose(); this.horseGeometry = null; }
        if (this.horseMaterial) { this.horseMaterial.dispose(); this.horseMaterial = null; }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = KnightSystem;
}
