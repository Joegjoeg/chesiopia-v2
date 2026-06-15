// Component Registry — maps component names to schemas and bit flags
class ComponentRegistry {
    constructor() {
        this._schemas = new Map();
        this._bitFlags = new Map();
        this._nextBit = 1;
    }

    register(name, schema) {
        if (this._schemas.has(name)) {
            console.warn(`[ComponentRegistry] Component "${name}" already registered`);
            return;
        }
        this._schemas.set(name, schema);
        this._bitFlags.set(name, this._nextBit);
        this._nextBit <<= 1;
    }

    getSchema(name) {
        return this._schemas.get(name) || null;
    }

    getBit(name) {
        return this._bitFlags.get(name) || 0;
    }

    getMask(names) {
        let mask = 0;
        for (const name of names) {
            mask |= this.getBit(name);
        }
        return mask;
    }

    validate(name, data) {
        const schema = this._schemas.get(name);
        if (!schema) return false;
        for (const key of Object.keys(schema)) {
            if (!(key in data)) return false;
            const expectedType = schema[key];
            const actualType = typeof data[key];
            if (expectedType === 'int' || expectedType === 'float') {
                if (actualType !== 'number') return false;
            } else if (expectedType === 'bool') {
                if (actualType !== 'boolean') return false;
            } else if (expectedType === 'string') {
                if (actualType !== 'string') return false;
            } else if (expectedType === 'object') {
                if (actualType !== 'object' || data[key] === null) return false;
            }
        }
        return true;
    }

    has(name) {
        return this._schemas.has(name);
    }
}

window.ComponentRegistry = ComponentRegistry;
