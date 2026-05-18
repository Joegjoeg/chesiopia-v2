// VillagerSystem — Villager agents with roles, daily schedules, and node-based movement

class VillagerSystem {
    constructor(scene, terrainSystem, settlementSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;

        this.villagerIdCounter = 0;
        this.villagerMeshes = new Map();

        this.villagerGeometry = null;
        this.villagerMaterials = {};

        this._scratchVec = new THREE.Vector3();
        this._scratchVec2 = new THREE.Vector3();
    }

    init() {
        this.villagerGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
        this.villagerMaterials = {
            farmer:    new THREE.MeshLambertMaterial({ color: 0x8b6914 }),
            fisher:    new THREE.MeshLambertMaterial({ color: 0x4a6fa5 }),
            priest:    new THREE.MeshLambertMaterial({ color: 0x2d2d2d }),
            mayor:     new THREE.MeshLambertMaterial({ color: 0x8b0000 }),
            townCrier: new THREE.MeshLambertMaterial({ color: 0xd4a017 }),
            child:     new THREE.MeshLambertMaterial({ color: 0x87ceeb }),
            villager:  new THREE.MeshLambertMaterial({ color: 0x6b8e23 }),
            knight:    new THREE.MeshLambertMaterial({ color: 0xc0c0c0 })
        };
        console.log('[VillagerSystem] Initialized');
    }

    populateSettlement(settlement) {
        const pop = Math.floor(settlement.population);
        const roleDistribution = this.getRoleDistribution(settlement);

        for (let i = 0; i < pop; i++) {
            const role = this.pickRole(roleDistribution, i, pop);
            const villager = this.createVillager(settlement, role);
            settlement.villagers.push(villager);
        }
    }

    getRoleDistribution(settlement) {
        const dist = {
            farmer: 0.35,
            villager: 0.25,
            child: 0.15,
            priest: 0,
            mayor: 0,
            townCrier: 0,
            fisher: 0,
            knight: 0
        };

        if (settlement.typeDef.hasChurch) {
            dist.priest = 0.05;
            dist.mayor = 0.03;
            dist.townCrier = 0.02;
        }

        const nearWater = this.settlementSystem.isNearWater(settlement.x, settlement.z, 15);
        if (nearWater) {
            dist.fisher = 0.10;
            dist.farmer -= 0.05;
            dist.villager -= 0.05;
        }

        return dist;
    }

    pickRole(distribution, index, total) {
        const cumulative = [];
        let sum = 0;
        for (const [role, weight] of Object.entries(distribution)) {
            sum += weight;
            cumulative.push({ role, threshold: sum });
        }

        const rand = (index / total + Math.random() * 0.3) % 1.0;
        const target = rand * sum;

        for (const entry of cumulative) {
            if (target <= entry.threshold) return entry.role;
        }
        return 'villager';
    }

    createVillager(settlement, role) {
        const id = ++this.villagerIdCounter;
        const homeNode = this.findHomeNode(settlement);

        const villager = {
            id,
            role,
            age: 8 + Math.floor(Math.random() * 50),
            home: homeNode,
            currentTask: null,
            morningTask: this.getDefaultTask(role, 'morning'),
            eveningTask: this.getDefaultTask(role, 'evening'),
            currentNode: homeNode,
            targetNode: null,
            socialPreference: Math.random(),
            moveProgress: 0,
            moveSpeed: 0.8 + Math.random() * 0.6,
            idleTimer: 0,
            idleDuration: 2 + Math.random() * 4,
            _mesh: null,
            _lastPathTime: 0
        };

        this.createVillagerMesh(villager, settlement);
        return villager;
    }

    getDefaultTask(role, slot) {
        const roleDef = VILLAGER_ROLES[role];
        if (!roleDef) return 'wander';

        const tasks = slot === 'morning' ? roleDef.morningTasks : roleDef.eveningTasks;
        return tasks[Math.floor(Math.random() * tasks.length)];
    }

    findHomeNode(settlement) {
        const homes = settlement.buildings.filter(b => b.type === 'house');
        if (homes.length > 0) {
            const home = homes[Math.floor(Math.random() * homes.length)];
            return { type: 'home', x: home.x, z: home.z, y: home.y, label: 'Home', buildingRef: home };
        }
        const green = settlement.nodes.find(n => n.type === 'villageGreen');
        if (green) return green;
        return { type: 'home', x: settlement.x, z: settlement.z, y: 0, label: 'Home' };
    }

    createVillagerMesh(villager, settlement) {
        if (!this.villagerGeometry) return;

        const material = this.villagerMaterials[villager.role] || this.villagerMaterials.villager;
        const mesh = new THREE.Mesh(this.villagerGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.scale.set(0.6, 0.6, 0.6);

        const pos = this.getNodeWorldPos(villager.currentNode, settlement);
        mesh.position.copy(pos);
        mesh.position.y += 0.4;

        settlement._group.add(mesh);
        villager._mesh = mesh;
        this.villagerMeshes.set(villager.id, mesh);
    }

    getNodeWorldPos(node, settlement) {
        const x = node.x;
        const z = node.z;
        const y = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : (node.y || 0);
        return new THREE.Vector3(x, y, z);
    }

    updateSettlementVillagers(settlement, deltaTime) {
        const hour = this.settlementSystem.getHourOfDay();
        const timeSlot = getCurrentTimeSlot(hour);
        const season = this.settlementSystem.getCurrentSeason();
        const seasonDef = SEASONS[season];

        for (const villager of settlement.villagers) {
            this.updateVillager(villager, settlement, deltaTime, timeSlot, seasonDef);
        }
    }

    updateVillager(villager, settlement, deltaTime, timeSlot, seasonDef) {
        if (!villager._mesh) return;

        if (timeSlot === 'night') {
            this.moveVillagerToward(villager, villager.home, settlement, deltaTime);
            return;
        }

        villager.idleTimer -= deltaTime;

        if (villager.idleTimer <= 0 && !villager.targetNode) {
            this.assignVillagerTask(villager, settlement, timeSlot, seasonDef);
            villager.idleTimer = villager.idleDuration;
        }

        if (villager.targetNode) {
            this.moveVillagerToward(villager, villager.targetNode, settlement, deltaTime);
        } else if (villager.currentNode) {
            this.wanderNearNode(villager, settlement, deltaTime);
        }
    }

    assignVillagerTask(villager, settlement, timeSlot, seasonDef) {
        let taskKey;
        if (timeSlot === 'morning') {
            taskKey = villager.morningTask;
        } else if (timeSlot === 'evening') {
            taskKey = villager.eveningTask;
        } else {
            taskKey = this.pickMiddayTask(villager, seasonDef);
        }

        const taskDef = TASKS[taskKey];
        if (!taskDef) {
            villager.targetNode = villager.home;
            return;
        }

        villager.currentTask = taskKey;
        const node = this.findTaskNode(settlement, taskDef, villager);
        villager.targetNode = node || villager.home;
    }

    pickMiddayTask(villager, seasonDef) {
        const options = ['wander', 'rest'];
        if (seasonDef.churchActivity > 0.5) options.push('attendChurch');
        if (seasonDef.fieldActivity > 0.5) options.push('tendFields');
        if (villager.role === 'child') options.push('play');
        return options[Math.floor(Math.random() * options.length)];
    }

    findTaskNode(settlement, taskDef, villager) {
        const availableNodes = [];

        for (const destType of taskDef.destinations) {
            const nodes = this.getNodesOfType(settlement, destType);
            for (const node of nodes) {
                availableNodes.push(node);
            }
        }

        if (availableNodes.length === 0) return villager.home;

        const weights = availableNodes.map(n => {
            const nodeTypeDef = NODE_TYPES[n.type];
            return nodeTypeDef ? nodeTypeDef.weight : 1;
        });

        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let rand = Math.random() * totalWeight;
        for (let i = 0; i < availableNodes.length; i++) {
            rand -= weights[i];
            if (rand <= 0) return availableNodes[i];
        }

        return availableNodes[0];
    }

    getNodesOfType(settlement, type) {
        const results = [];

        for (const node of settlement.nodes) {
            if (node.type === type) results.push(node);
        }

        for (const building of settlement.buildings) {
            if (building.type === type) {
                results.push({ type, x: building.x, z: building.z, y: building.y, label: building.type, buildingRef: building });
            }
        }

        if (type === 'scenicSpot' && results.length === 0) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 5 + Math.random() * 15;
            results.push({
                type: 'scenicSpot',
                x: settlement.x + Math.cos(angle) * dist,
                z: settlement.z + Math.sin(angle) * dist,
                y: 0,
                label: 'Scenic Spot'
            });
        }

        return results;
    }

    moveVillagerToward(villager, target, settlement, deltaTime) {
        if (!villager._mesh || !target) return;

        const targetPos = this.getNodeWorldPos(target, settlement);
        const currentPos = villager._mesh.position.clone();
        currentPos.y = targetPos.y;

        const dist = currentPos.distanceTo(targetPos);

        if (dist < 0.3) {
            villager.currentNode = target;
            villager.targetNode = null;
            villager.moveProgress = 0;
            villager.idleTimer = villager.idleDuration;

            if (this.settlementSystem.roadSystem) {
                this.settlementSystem.roadSystem.recordMovement(
                    villager._lastNode || villager.currentNode,
                    target,
                    settlement
                );
            }
            villager._lastNode = target;
            return;
        }

        const speed = villager.moveSpeed * deltaTime;
        const t = Math.min(1, speed / dist);
        villager._mesh.position.lerp(targetPos, t);

        const terrainY = this.terrainSystem
            ? this.terrainSystem.getHeight(villager._mesh.position.x, villager._mesh.position.z)
            : targetPos.y;
        villager._mesh.position.y = terrainY + 0.4;

        if (villager._mesh.position.x !== targetPos.x || villager._mesh.position.z !== targetPos.z) {
            const dx = targetPos.x - villager._mesh.position.x;
            const dz = targetPos.z - villager._mesh.position.z;
            const angle = Math.atan2(dx, dz);
            villager._mesh.rotation.y = angle;
        }
    }

    wanderNearNode(villager, settlement, deltaTime) {
        if (!villager._mesh || !villager.currentNode) return;

        const nodePos = this.getNodeWorldPos(villager.currentNode, settlement);
        const meshPos = villager._mesh.position;
        meshPos.y = nodePos.y;

        const dist = meshPos.distanceTo(nodePos);
        const wanderRadius = 2;

        if (dist > wanderRadius) {
            const t = Math.min(1, villager.moveSpeed * 0.5 * deltaTime / dist);
            meshPos.lerp(nodePos, t);
        } else {
            villager._wanderAngle = (villager._wanderAngle || Math.random() * Math.PI * 2) +
                (Math.random() - 0.5) * 0.5;
            const wx = nodePos.x + Math.cos(villager._wanderAngle) * wanderRadius * 0.5;
            const wz = nodePos.z + Math.sin(villager._wanderAngle) * wanderRadius * 0.5;
            const t = Math.min(1, villager.moveSpeed * 0.3 * deltaTime);
            meshPos.x = lerp(meshPos.x, wx, t);
            meshPos.z = lerp(meshPos.z, wz, t);
        }

        const terrainY = this.terrainSystem
            ? this.terrainSystem.getHeight(meshPos.x, meshPos.z)
            : nodePos.y;
        meshPos.y = terrainY + 0.4;
    }

    onDayPassed(settlement, season, seasonDef) {
        for (const villager of settlement.villagers) {
            villager.age += 1 / 360;

            if (villager.age > 70 && Math.random() < 0.01) {
                this.removeVillager(villager, settlement);
                continue;
            }

            if (Math.random() < 0.02) {
                villager.morningTask = this.getDefaultTask(villager.role, 'morning');
            }
            if (Math.random() < 0.02) {
                villager.eveningTask = this.getDefaultTask(villager.role, 'evening');
            }
        }

        settlement.villagers = settlement.villagers.filter(v => v._mesh);

        if (settlement.population > settlement.villagers.length && settlement.villagers.length < settlement.maxPopulation) {
            const births = Math.min(2, settlement.population - settlement.villagers.length);
            for (let i = 0; i < births; i++) {
                if (Math.random() < 0.3) {
                    const villager = this.createVillager(settlement, 'child');
                    villager.age = 0;
                    settlement.villagers.push(villager);
                }
            }
        }
    }

    removeVillager(villager, settlement) {
        if (villager._mesh) {
            settlement._group.remove(villager._mesh);
            villager._mesh.geometry && villager._mesh.geometry.dispose();
            this.villagerMeshes.delete(villager.id);
            villager._mesh = null;
        }
        const idx = settlement.villagers.indexOf(villager);
        if (idx !== -1) settlement.villagers.splice(idx, 1);
    }

    setVillagerTask(villagerId, slot, task) {
        for (const settlement of this.settlementSystem.settlements) {
            const villager = settlement.villagers.find(v => v.id === villagerId);
            if (villager) {
                if (slot === 'morning') villager.morningTask = task;
                else villager.eveningTask = task;
                return true;
            }
        }
        return false;
    }

    dispose() {
        for (const [id, mesh] of this.villagerMeshes) {
            if (mesh.parent) mesh.parent.remove(mesh);
            mesh.geometry && mesh.geometry.dispose();
        }
        this.villagerMeshes.clear();

        if (this.villagerGeometry) {
            this.villagerGeometry.dispose();
            this.villagerGeometry = null;
        }
        for (const mat of Object.values(this.villagerMaterials)) {
            mat.dispose();
        }
        this.villagerMaterials = {};
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VillagerSystem;
}
