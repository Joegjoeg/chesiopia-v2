/**
 * ShadowSet Exporter
 * Converts baked shadow data to a downloadable JSON file.
 */
class ShadowSetExporter {
    constructor() {}

    /**
     * Export a ShadowSet to a JSON file download.
     * @param {Object} shadowSet - The shadow set data from ShadowBaker
     * @param {string} filename - Output filename
     */
    exportJSON(shadowSet, filename = 'shadowset.json') {
        const data = JSON.stringify(shadowSet, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Export as a compressed binary format (more compact than JSON).
     * Uses Float32Array for heights, Uint16Array for indices.
     */
    exportBinary(shadowSet, filename = 'shadowset.bin') {
        const numAngles = shadowSet.angles.length;
        const gridRes = shadowSet.gridResolution;
        const numHeights = numAngles * gridRes * gridRes;
        const numIndices = shadowSet.indexBuffer.length;

        // Header: 6 x uint32 = 24 bytes
        // [magic, version, gridRes, worldSize*10, numAngles, numIndices]
        const header = new Uint32Array(6);
        header[0] = 0x53484144; // 'SHAD'
        header[1] = 1; // version
        header[2] = gridRes;
        header[3] = Math.round(shadowSet.worldSize * 10); // store as fixed-point
        header[4] = numAngles;
        header[5] = numIndices;

        // Angle metadata: numAngles x [azimuth (f32), elevation (f32)]
        const angleMeta = new Float32Array(numAngles * 2);
        for (let i = 0; i < numAngles; i++) {
            angleMeta[i * 2] = shadowSet.angles[i].azimuth;
            angleMeta[i * 2 + 1] = shadowSet.angles[i].elevation;
        }

        // Heights: all angles flattened
        const heights = new Float32Array(numHeights);
        let idx = 0;
        for (const angle of shadowSet.angles) {
            for (const h of angle.heights) {
                heights[idx++] = h;
            }
        }

        // Index buffer
        const indices = new Uint16Array(shadowSet.indexBuffer);

        // Combine all into one blob
        const totalSize = header.byteLength + angleMeta.byteLength + heights.byteLength + indices.byteLength;
        const combined = new Uint8Array(totalSize);

        let offset = 0;
        combined.set(new Uint8Array(header.buffer), offset);
        offset += header.byteLength;
        combined.set(new Uint8Array(angleMeta.buffer), offset);
        offset += angleMeta.byteLength;
        combined.set(new Uint8Array(heights.buffer), offset);
        offset += heights.byteLength;
        combined.set(new Uint8Array(indices.buffer), offset);

        const blob = new Blob([combined], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getStats(shadowSet) {
        if (!shadowSet) return null;
        const verts = shadowSet.gridResolution * shadowSet.gridResolution;
        const angles = shadowSet.numAngles;
        const bytes = JSON.stringify(shadowSet).length;
        const kb = (bytes / 1024).toFixed(1);
        return { verts, angles, kb, bytes };
    }
}

window.ShadowSetExporter = ShadowSetExporter;
