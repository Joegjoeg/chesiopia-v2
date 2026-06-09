// VillagerSystem — Villager agents with roles, daily schedules, and node-based movement

const ROLE_HAT_COLORS = {
    farmer: 0x8b6914,
    fisher: 0x4a6fa5,
    priest: 0x2d2d2d,
    mayor: 0x8b0000,
    townCrier: 0xd4a017,
    child: 0x87ceeb,
    villager: 0x6b8e23,
    knight: 0xc0c0c0,
    monk: 0x6b5b95
};

const ROLE_BODY_COLORS = {
    farmer: 0x8b6914,
    fisher: 0x4a6fa5,
    priest: 0x2d2d2d,
    mayor: 0x8b0000,
    townCrier: 0xd4a017,
    child: 0x87ceeb,
    villager: 0x6b8e23,
    knight: 0xc0c0c0,
    monk: 0x6b8e23
};

class VillagerSystem {
    constructor(scene, terrainSystem, settlementSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;

        this.villagerIdCounter = 0;

        this.villagerGeometry = null;
        this.hatGeometry = null;
        this.bodyMaterial = null;
        this.hatMaterial = null;

        this._dummy = new THREE.Object3D();
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchMatrix2 = new THREE.Matrix4();
        this._scratchColor = new THREE.Color();
        this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

        this._scratchVec = new THREE.Vector3();
        this._scratchVec2 = new THREE.Vector3();
    }

    init() {
        this.villagerGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8);
        this.hatGeometry = new THREE.ConeGeometry(0.12, 0.2, 6);
        this.bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        this.hatMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        console.log('[VillagerSystem] Initialized');
    }

    _ensureInstancedMeshes(settlement) {
        if (settlement._bodyInstancedMesh) return;

        const capacity = Math.max(settlement.maxPopulation || 80, settlement.villagers?.length || 0) + 20;
        const bodyMesh = new THREE.InstancedMesh(this.villagerGeometry, this.bodyMaterial, capacity);
        const hatMesh = new THREE.InstancedMesh(this.hatGeometry, this.hatMaterial, capacity);

        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        hatMesh.castShadow = true;
        hatMesh.receiveShadow = true;

        settlement._group.add(bodyMesh);
        settlement._group.add(hatMesh);

        settlement._bodyInstancedMesh = bodyMesh;
        settlement._hatInstancedMesh = hatMesh;
        settlement._instancedMeshCapacity = capacity;
        settlement._freeInstanceIndices = [];
        settlement._nextInstanceIndex = 0;
    }

    _allocateInstance(settlement) {
        this._ensureInstancedMeshes(settlement);
        if (settlement._freeInstanceIndices.length > 0) {
            return settlement._freeInstanceIndices.pop();
        }
        if (settlement._nextInstanceIndex < settlement._instancedMeshCapacity) {
            return settlement._nextInstanceIndex++;
        }
        return this._growInstancedMeshes(settlement);
    }

    _growInstancedMeshes(settlement) {
        const oldCapacity = settlement._instancedMeshCapacity;
        const newCapacity = oldCapacity * 2;

        const oldBody = settlement._bodyInstancedMesh;
        const oldHat = settlement._hatInstancedMesh;

        const newBody = new THREE.InstancedMesh(this.villagerGeometry, this.bodyMaterial, newCapacity);
        const newHat = new THREE.InstancedMesh(this.hatGeometry, this.hatMaterial, newCapacity);

        newBody.castShadow = true;
        newBody.receiveShadow = true;
        newHat.castShadow = true;
        newHat.receiveShadow = true;

        for (let i = 0; i < oldCapacity; i++) {
            oldBody.getMatrixAt(i, this._scratchMatrix);
            newBody.setMatrixAt(i, this._scratchMatrix);
            if (oldBody.instanceColor) {
                oldBody.getColorAt(i, this._scratchColor);
                newBody.setColorAt(i, this._scratchColor);
            }

            oldHat.getMatrixAt(i, this._scratchMatrix);
            newHat.setMatrixAt(i, this._scratchMatrix);
            if (oldHat.instanceColor) {
                oldHat.getColorAt(i, this._scratchColor);
                newHat.setColorAt(i, this._scratchColor);
            }
        }

        settlement._group.remove(oldBody);
        settlement._group.remove(oldHat);
        oldBody.dispose();
        oldHat.dispose();

        settlement._group.add(newBody);
        settlement._group.add(newHat);
        settlement._bodyInstancedMesh = newBody;
        settlement._hatInstancedMesh = newHat;
        settlement._instancedMeshCapacity = newCapacity;

        return oldCapacity;
    }

    _freeInstance(settlement, instanceIndex) {
        if (!settlement._bodyInstancedMesh) return;
        settlement._bodyInstancedMesh.setMatrixAt(instanceIndex, this._zeroMatrix);
        settlement._hatInstancedMesh.setMatrixAt(instanceIndex, this._zeroMatrix);
        settlement._bodyInstancedMesh.instanceMatrix.needsUpdate = true;
        settlement._hatInstancedMesh.instanceMatrix.needsUpdate = true;
        settlement._freeInstanceIndices.push(instanceIndex);
    }

    _updateVillagerMatrix(villager, settlement) {
        if (villager._instanceIndex === undefined || !settlement._bodyInstancedMesh) return;
        const idx = villager._instanceIndex;
        const pos = villager._mesh.position;
        const rotY = villager._mesh.rotation.y;

        this._dummy.position.copy(pos);
        this._dummy.rotation.set(0, rotY, 0);
        this._dummy.scale.set(0.6, 0.6, 0.6);
        this._dummy.updateMatrix();
        settlement._bodyInstancedMesh.setMatrixAt(idx, this._dummy.matrix);

        this._dummy.position.set(pos.x, pos.y + 0.132, pos.z);
        this._dummy.updateMatrix();
        settlement._hatInstancedMesh.setMatrixAt(idx, this._dummy.matrix);
    }

    _updateAllVillagerMatrices(settlement, cameraPos) {
        if (!settlement._bodyInstancedMesh) return;

        const dist = distance2D(settlement, cameraPos || { x: 0, z: 0 });
        const isClose = dist < 20;

        for (const villager of settlement.villagers) {
            if (!villager._mesh || villager._instanceIndex === undefined) continue;

            const idx = villager._instanceIndex;
            const isInside = this.isVillagerInsideMotte(villager, settlement);
            const visible = isInside ? isClose : true;

            if (!visible) {
                settlement._bodyInstancedMesh.setMatrixAt(idx, this._zeroMatrix);
                settlement._hatInstancedMesh.setMatrixAt(idx, this._zeroMatrix);
                continue;
            }

            const pos = villager._mesh.position;
            const rotY = villager._mesh.rotation.y;

            this._dummy.position.copy(pos);
            this._dummy.rotation.set(0, rotY, 0);
            this._dummy.scale.set(0.6, 0.6, 0.6);
            this._dummy.updateMatrix();
            settlement._bodyInstancedMesh.setMatrixAt(idx, this._dummy.matrix);

            this._dummy.position.set(pos.x, pos.y + 0.132, pos.z);
            this._dummy.updateMatrix();
            settlement._hatInstancedMesh.setMatrixAt(idx, this._dummy.matrix);
        }

        settlement._bodyInstancedMesh.instanceMatrix.needsUpdate = true;
        settlement._hatInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    populateSettlement(settlement) {
        const pop = Math.floor(settlement.population);
        const roleDistribution = this.getRoleDistribution(settlement);
        settlement.motteRadius = settlement.type === 'hamlet' ? 6 : 12;

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

        this._ensureInstancedMeshes(settlement);
        const instanceIndex = this._allocateInstance(settlement);
        if (instanceIndex === -1) {
            console.warn('[VillagerSystem] No free instance slots for villager', villager.id);
            return;
        }

        villager._instanceIndex = instanceIndex;
        villager._mesh = {
            position: new THREE.Vector3(),
            rotation: { y: 0 },
            visible: true
        };

        const bodyColor = new THREE.Color(ROLE_BODY_COLORS[villager.role] || ROLE_BODY_COLORS.villager);
        const hatColor = new THREE.Color(ROLE_HAT_COLORS[villager.role] || ROLE_HAT_COLORS.villager);
        settlement._bodyInstancedMesh.setColorAt(instanceIndex, bodyColor);
        settlement._hatInstancedMesh.setColorAt(instanceIndex, hatColor);
        settlement._bodyInstancedMesh.instanceColor.needsUpdate = true;
        settlement._hatInstancedMesh.instanceColor.needsUpdate = true;

        let pos;
        if (villager.currentNode) {
            pos = this.getNodeWorldPos(villager.currentNode, settlement);
        } else {
            pos = new THREE.Vector3(settlement.x, settlement.height + 0.5, settlement.z);
        }
        villager._mesh.position.copy(pos);
        villager._mesh.position.y += 0.4;

        this._updateVillagerMatrix(villager, settlement);
    }

    initVillagersFromServer(settlement, serverVillagers) {
        if (!serverVillagers || !Array.isArray(serverVillagers)) {
            console.log(`[VillagerSystem] initVillagersFromServer: no villagers for ${settlement.name}`);
            return;
        }
        console.log(`[VillagerSystem] initVillagersFromServer: ${serverVillagers.length} villagers for ${settlement.name}, geometry=${!!this.villagerGeometry}`);
        let created = 0;
        for (const v of serverVillagers) {
            try {
                v.home = v.home || this.findHomeNode(settlement);
                v.currentNode = v.currentNode || v.home;
                v.morningTask = v.morningTask || this.getDefaultTask(v.role, 'morning');
                v.eveningTask = v.eveningTask || this.getDefaultTask(v.role, 'evening');
                v.moveProgress = v.moveProgress || 0;
                v.moveSpeed = v.moveSpeed || 0.8 + Math.random() * 0.6;
                v.idleTimer = v.idleTimer || 0;
                v.idleDuration = v.idleDuration || 2 + Math.random() * 4;
                v.socialPreference = v.socialPreference || Math.random();
                v.targetNode = v.targetNode || null;
                v.currentTask = v.currentTask || null;
                v._mesh = null;
                v._lastPathTime = 0;
                this.createVillagerMesh(v, settlement);
                if (v._mesh) created++;
            } catch (err) {
                console.error(`[VillagerSystem] Failed to init villager ${v.id} (${v.name}):`, err);
            }
        }
        console.log(`[VillagerSystem] Created ${created}/${serverVillagers.length} villager meshes for ${settlement.name}`);
    }

    getNodeWorldPos(node, settlement) {
        const x = node.x;
        const z = node.z;
        const y = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : (node.y || 0);
        return new THREE.Vector3(x, y, z);
    }

    updateSettlementVillagers(settlement, deltaTime, cameraPos) {
        const dist = distance2D(settlement, cameraPos || { x: 0, z: 0 });

        let interval;
        if (dist < 30) interval = 0.05;
        else if (dist < 60) interval = 0.3;
        else if (dist < 120) interval = 1.5;
        else if (dist < 200) interval = 4.0;
        else interval = 10.0;

        settlement._villagerUpdateTimer = (settlement._villagerUpdateTimer || 0) - deltaTime;
        const shouldUpdate = settlement._villagerUpdateTimer <= 0;
        if (shouldUpdate) {
            settlement._villagerUpdateTimer = interval;
        }

        const isClose = dist < 20;

        const currentInsideCount = settlement.villagers.filter(v => this.isVillagerInsideMotte(v, settlement)).length;
        const dotCount = settlement._villagerDotVillagers ? settlement._villagerDotVillagers.length : -1;
        if (!settlement._villagerDots || settlement._villagerDotsDirty || dotCount !== currentInsideCount) {
            this.rebuildInsideVillagerDots(settlement);
        }

        if (shouldUpdate) {
            const simDt = Math.min(interval, 0.5);
            const hour = this.settlementSystem.getHourOfDay();
            const timeSlot = getCurrentTimeSlot(hour);
            const season = this.settlementSystem.getCurrentSeason();
            const seasonDef = SEASONS[season];

            for (const villager of settlement.villagers) {
                this.updateVillager(villager, settlement, simDt, timeSlot, seasonDef);
            }

            this.updateInsideVillagerDots(settlement);
        }

        this._updateAllVillagerMatrices(settlement, cameraPos);

        if (settlement._villagerDots) {
            settlement._villagerDots.visible = !isClose;
        }
    }

    isVillagerInsideMotte(villager, settlement) {
        const radius = settlement.motteRadius || 10;
        let x, z;
        if (villager._mesh) {
            x = villager._mesh.position.x;
            z = villager._mesh.position.z;
        } else if (villager.currentNode) {
            x = villager.currentNode.x;
            z = villager.currentNode.z;
        } else {
            return true;
        }
        const dx = x - settlement.x;
        const dz = z - settlement.z;
        return Math.sqrt(dx * dx + dz * dz) <= radius;
    }

    rebuildInsideVillagerDots(settlement) {
        if (settlement._villagerDots) {
            settlement._group.remove(settlement._villagerDots);
            settlement._villagerDots.geometry.dispose();
            settlement._villagerDots.material.dispose();
            settlement._villagerDots = null;
        }
        settlement._villagerDotsDirty = false;

        const insideVillagers = settlement.villagers.filter(v => this.isVillagerInsideMotte(v, settlement));
        if (insideVillagers.length === 0) {
            settlement._villagerDotVillagers = [];
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(insideVillagers.length * 3);
        const colors = new Float32Array(insideVillagers.length * 3);

        for (let i = 0; i < insideVillagers.length; i++) {
            const v = insideVillagers[i];
            const node = v.currentNode || v.home;
            let pos;
            if (v._mesh) {
                pos = v._mesh.position;
            } else if (node) {
                pos = this.getNodeWorldPos(node, settlement);
            } else {
                pos = new THREE.Vector3(settlement.x, settlement.height || 0, settlement.z);
            }
            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y + 0.05;
            positions[i * 3 + 2] = pos.z;

            const color = new THREE.Color(ROLE_HAT_COLORS[v.role] || ROLE_HAT_COLORS.villager);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            vertexColors: true,
            size: 0.15,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9
        });

        const points = new THREE.Points(geometry, material);
        settlement._group.add(points);
        settlement._villagerDots = points;
        settlement._villagerDotVillagers = insideVillagers;
    }

    updateInsideVillagerDots(settlement) {
        if (!settlement._villagerDots || !settlement._villagerDotVillagers) return;

        const positions = settlement._villagerDots.geometry.attributes.position.array;
        let needsRebuild = false;

        for (let i = 0; i < settlement._villagerDotVillagers.length; i++) {
            const v = settlement._villagerDotVillagers[i];
            if (!v._mesh) continue;

            if (!this.isVillagerInsideMotte(v, settlement)) {
                needsRebuild = true;
                break;
            }

            positions[i * 3] = v._mesh.position.x;
            positions[i * 3 + 1] = v._mesh.position.y + 0.05;
            positions[i * 3 + 2] = v._mesh.position.z;
        }

        if (needsRebuild) {
            settlement._villagerDotsDirty = true;
            return;
        }

        settlement._villagerDots.geometry.attributes.position.needsUpdate = true;
    }

    updateVillager(villager, settlement, deltaTime, timeSlot, seasonDef) {
        if (!villager._mesh) return;

        if (villager._ceremonyBuilding) {
            this.updateCeremonyVillager(villager, settlement, deltaTime);
            return;
        }

        if (villager._constructionSite) {
            this.updateConstructionVillager(villager, settlement, deltaTime);
            return;
        }

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
        settlement._villagerDotsDirty = true;
    }

    applyTomeUpdate(settlement, villagerData) {
        if (!settlement || !villagerData) return;

        const serverMap = new Map(villagerData.map(v => [v.id, v]));

        for (const villager of settlement.villagers) {
            const serverVillager = serverMap.get(villager.id);
            if (!serverVillager) continue;

            villager.stress = serverVillager.stress;
            villager.faith = serverVillager.faith;
            villager.grumpy = serverVillager.grumpy;
            villager.calledToService = serverVillager.calledToService;
            villager.walkType = serverVillager.walkType;
            villager.age = serverVillager.age;

            if (serverVillager.activities) {
                villager.activities = serverVillager.activities;
            }

            if (villager._mesh && villager.calledToService) {
                this.ensureServiceHat(villager, settlement);
            }
        }
    }

    ensureServiceHat(villager, settlement) {
        if (!villager._mesh) return;
        if (villager._hasServiceHat) return;
        villager._hasServiceHat = true;

        if (villager._instanceIndex !== undefined && settlement._hatInstancedMesh) {
            settlement._hatInstancedMesh.setColorAt(villager._instanceIndex, new THREE.Color(0xff4444));
            settlement._hatInstancedMesh.instanceColor.needsUpdate = true;
        }
    }

    removeVillager(villager, settlement) {
        if (villager._instanceIndex !== undefined) {
            this._freeInstance(settlement, villager._instanceIndex);
            delete villager._instanceIndex;
        }
        villager._mesh = null;
        settlement._villagerDotsDirty = true;
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

    startConstruction(settlement, type) {
        const site = settlement.buildings.find(b => b.type === type && b.state === 'under_construction');
        if (!site) return;
        const available = settlement.villagers.filter(v => !v._constructionSite && !v._ceremonyBuilding);
        for (const w of available.slice(0, site._workerCount || 2)) {
            w._constructionSite = site;
            w._constructPhase = 'moving';
            w._constructTimer = 0;
        }
    }

    updateConstructionVillager(villager, settlement, deltaTime) {
        if (!villager._mesh || !villager._constructionSite) return;
        const site = villager._constructionSite;
        if (site.state === 'complete') {
            delete villager._constructionSite;
            delete villager._constructPhase;
            return;
        }

        if (villager._constructPhase === 'moving') {
            const tx = site.x + (Math.random() - 0.5) * 3;
            const tz = site.z + (Math.random() - 0.5) * 3;
            villager._constructTarget = { x: tx, z: tz };
            villager._constructPhase = 'walking';
        }

        if (villager._constructPhase === 'walking') {
            const target = villager._constructTarget;
            const pos = villager._mesh.position;
            const dx = target.x - pos.x;
            const dz = target.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < 0.3) {
                villager._constructPhase = 'working';
                villager._constructTimer = 1 + Math.random() * 1.5;
            } else {
                const speed = villager.moveSpeed * deltaTime;
                pos.x += (dx / dist) * speed;
                pos.z += (dz / dist) * speed;
                pos.y = this.terrainSystem.getHeight(pos.x, pos.z) + 0.4;
                villager._mesh.rotation.y = Math.atan2(dx, dz);
            }
        }

        if (villager._constructPhase === 'working') {
            villager._constructTimer -= deltaTime;
            const isBarn = site.type === 'barn';
            if ((isBarn && Math.random() < 0.15) || (!isBarn && Math.random() < 0.03)) {
                this.doPissAround(villager, settlement, site);
                return;
            }
            if (villager._constructTimer <= 0) {
                this.playBuildingSound(villager, site);
                if (this.settlementSystem && this.settlementSystem.buildingSystem) {
                    this.settlementSystem.buildingSystem.advanceConstruction(site, 0.05);
                }
                villager._constructPhase = 'moving';
            }
        }
    }

    doPissAround(villager, settlement, site) {
        const oldY = villager._mesh.position.y;
        villager._mesh.position.y = oldY + 0.2;
        setTimeout(() => {
            if (villager._mesh) {
                villager._mesh.position.y = this.terrainSystem.getHeight(villager._mesh.position.x, villager._mesh.position.z) + 0.4;
            }
        }, 200);
        for (const v of settlement.villagers) {
            if (v === villager || v._constructionSite) continue;
            if (v._mesh && v._mesh.position.distanceTo(villager._mesh.position) < 8 && Math.random() < 0.3) {
                this.playSound('get back to work', v);
            }
        }
    }

    playBuildingSound(villager, site) {
        const phrases = {
            house: ['hammer hammer hammer', 'thud thud', 'creak bang'],
            barn: ['heave ho', 'timber', 'bang bang'],
            church: ['stone on stone', 'chisel chisel', 'mason work'],
            field: ['plough plough', 'dig dig'],
            manor: ['fine craft', 'measure twice'],
            fishingHut: ['saw saw', 'nail nail']
        };
        const list = phrases[site.type] || ['work work'];
        this.playSound(list[Math.floor(Math.random() * list.length)], villager);
    }

    playSound(phrase, villager) {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            const u = new SpeechSynthesisUtterance(phrase);
            let baseVolume = 0.15;
            let volume = baseVolume;
            if (villager && villager._mesh && window.game && window.game.camera) {
                const dx = villager._mesh.position.x - window.game.camera.position.x;
                const dy = villager._mesh.position.y - window.game.camera.position.y;
                const dz = villager._mesh.position.z - window.game.camera.position.z;
                const distanceToCamera = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (window.soundManager && window.soundManager.calculateDistanceVolume) {
                    volume = window.soundManager.calculateDistanceVolume(distanceToCamera, baseVolume);
                }
            }
            u.volume = volume;
            u.rate = 0.9 + Math.random() * 0.2;
            window.speechSynthesis.speak(u);
        }
    }

    triggerOpeningCeremony(settlement, building) {
        const mayor = settlement.villagers.find(v => v.role === 'mayor');
        const guests = settlement.villagers.filter(v => v !== mayor && !v._constructionSite).slice(0, 2);
        const attendees = [mayor, ...guests].filter(Boolean);
        for (const v of attendees) {
            v._ceremonyBuilding = building;
            v._ceremonyPhase = 'walking';
        }
        setTimeout(() => {
            if (mayor) this.playSound(`I hereby declare this ${building.type} open for use!`, mayor);
        }, 3000);
        setTimeout(() => {
            for (const v of attendees) {
                delete v._ceremonyBuilding;
                delete v._ceremonyPhase;
            }
        }, 8000);
    }

    updateCeremonyVillager(villager, settlement, deltaTime) {
        if (!villager._mesh || !villager._ceremonyBuilding) return;
        const b = villager._ceremonyBuilding;
        const pos = villager._mesh.position;
        const dx = b.x - pos.x + (Math.random() - 0.5) * 2;
        const dz = b.z - pos.z + (Math.random() - 0.5) * 2;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.5) {
            const speed = villager.moveSpeed * deltaTime;
            pos.x += (dx / dist) * speed;
            pos.z += (dz / dist) * speed;
            pos.y = this.terrainSystem.getHeight(pos.x, pos.z) + 0.4;
            villager._mesh.rotation.y = Math.atan2(dx, dz);
        }
    }

    dispose() {
        for (const settlement of this.settlementSystem?.settlements || []) {
            if (settlement._villagerDots) {
                settlement._group.remove(settlement._villagerDots);
                settlement._villagerDots.geometry.dispose();
                settlement._villagerDots.material.dispose();
                settlement._villagerDots = null;
            }
            settlement._villagerDotVillagers = null;

            if (settlement._bodyInstancedMesh) {
                settlement._group.remove(settlement._bodyInstancedMesh);
                settlement._bodyInstancedMesh.dispose();
                settlement._bodyInstancedMesh = null;
            }
            if (settlement._hatInstancedMesh) {
                settlement._group.remove(settlement._hatInstancedMesh);
                settlement._hatInstancedMesh.dispose();
                settlement._hatInstancedMesh = null;
            }
            settlement._freeInstanceIndices = null;
            settlement._nextInstanceIndex = 0;
            settlement._instancedMeshCapacity = 0;
        }

        if (this.villagerGeometry) {
            this.villagerGeometry.dispose();
            this.villagerGeometry = null;
        }
        if (this.hatGeometry) {
            this.hatGeometry.dispose();
            this.hatGeometry = null;
        }
        if (this.bodyMaterial) {
            this.bodyMaterial.dispose();
            this.bodyMaterial = null;
        }
        if (this.hatMaterial) {
            this.hatMaterial.dispose();
            this.hatMaterial = null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VillagerSystem;
}
