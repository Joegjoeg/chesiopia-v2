class ClimateInference {
    constructor() {}

    _ramp(value, low, high) {
        if (value <= low) return 0;
        if (value >= high) return 1;
        return (value - low) / (high - low);
    }

    _mountain(sample) {
        const pressureVar = sample.pressureVariance || 0;
        const cold = this._ramp(1 - sample.temperature, 0.4, 0.7);
        const dry = this._ramp(1 - sample.humidity, 0.3, 0.6);
        const highVar = this._ramp(pressureVar, 0.15, 0.4);
        return Math.min(1, cold * 0.4 + dry * 0.3 + highVar * 0.3);
    }

    _basin(sample) {
        const lowPressure = this._ramp(1 - sample.pressure, 0.4, 0.7);
        const wet = this._ramp(sample.humidity, 0.5, 0.8);
        const warm = this._ramp(sample.temperature, 0.4, 0.7);
        return Math.min(1, lowPressure * 0.35 + wet * 0.35 + warm * 0.3);
    }

    _marsh(sample) {
        const veryWet = this._ramp(sample.humidity, 0.7, 0.95);
        const moderateTemp = this._ramp(1 - Math.abs(sample.temperature - 0.5), 0.3, 0.6);
        const lowPressure = this._ramp(1 - sample.pressure, 0.2, 0.5);
        return Math.min(1, veryWet * 0.5 + moderateTemp * 0.25 + lowPressure * 0.25);
    }

    _hill(sample) {
        const moderateVar = this._ramp(sample.pressureVariance || 0, 0.05, 0.2);
        const moderateDry = this._ramp(1 - sample.humidity, 0.2, 0.5);
        const moderateTemp = this._ramp(1 - Math.abs(sample.temperature - 0.5), 0.2, 0.5);
        return Math.min(1, moderateVar * 0.3 + moderateDry * 0.35 + moderateTemp * 0.35);
    }

    infer(sample) {
        return {
            mountainEvidence: this._mountain(sample),
            basinEvidence: this._basin(sample),
            marshEvidence: this._marsh(sample),
            hillEvidence: this._hill(sample)
        };
    }
}

module.exports = ClimateInference;
