/**
 * NetSim - Computer Networks Interactive Simulator
 * utils.js - Helper functions, data formatting, and sample topology definitions
 */

// Generate a unique ID with a prefix
export function generateId(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).substr(2, 7)}_${Date.now().toString(36)}`;
}

// Format seconds into mm:ss.s display format
export function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const minsStr = mins.toString().padStart(2, '0');
    const secsStr = secs.toFixed(1).padStart(4, '0');
    return `${minsStr}:${secsStr}`;
}

// Clamp a number between min and max
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Euclidean distance between two points
export function distance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Calculate the shortest distance from point p to segment ab
export function pointToSegmentDistance(p, a, b) {
    const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
    if (l2 === 0) return distance(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y)
    };
    return distance(p, proj);
}

// Format simulation metric percentage
export function formatPercentage(numerator, denominator) {
    if (!denominator || denominator === 0) return '0.0%';
    const pct = (numerator / denominator) * 100;
    return `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
}

// Prebuilt sample network topology as required:
// PC1, PC3 connect to Switch1 (PC1 and PC3 share medium segment / collision domain)
// Switch1 connects to Router1
// Router1 connects to Router2
// Router2 connects to PC2
export function getDefaultTopology(canvasWidth = 850, canvasHeight = 380) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;

    const nodes = [
        {
            id: 'node_pc1',
            type: 'pc',
            name: 'PC1',
            ip: '192.168.1.10',
            mac: '00:1A:2B:3C:01:01',
            x: Math.round(cx - 280),
            y: Math.round(cy - 85)
        },
        {
            id: 'node_pc3',
            type: 'pc',
            name: 'PC3',
            ip: '192.168.1.11',
            mac: '00:1A:2B:3C:01:03',
            x: Math.round(cx - 280),
            y: Math.round(cy + 85)
        },
        {
            id: 'node_sw1',
            type: 'switch',
            name: 'Switch1',
            ip: '192.168.1.1',
            mac: '00:1A:2B:3C:AA:01',
            x: Math.round(cx - 130),
            y: Math.round(cy)
        },
        {
            id: 'node_r1',
            type: 'router',
            name: 'Router1',
            ip: '10.0.0.1',
            mac: '00:1A:2B:3C:BB:01',
            x: Math.round(cx - 10),
            y: Math.round(cy - 50)
        },
        {
            id: 'node_r2',
            type: 'router',
            name: 'Router2',
            ip: '10.0.1.1',
            mac: '00:1A:2B:3C:BB:02',
            x: Math.round(cx + 120),
            y: Math.round(cy + 35)
        },
        {
            id: 'node_pc2',
            type: 'pc',
            name: 'PC2',
            ip: '192.168.2.10',
            mac: '00:1A:2B:3C:02:02',
            x: Math.round(cx + 270),
            y: Math.round(cy)
        }
    ];

    const links = [
        // PC1 to Switch1 - shared medium to Switch1 (along with PC3)
        {
            id: 'link_pc1_sw1',
            from: 'node_pc1',
            to: 'node_sw1',
            isShared: true,
            channelName: 'Shared Channel 1 (Hub/Bus segment)',
            bandwidth: '100 Mbps',
            delay: '2 ms'
        },
        // PC3 to Switch1 - shared medium with PC1
        {
            id: 'link_pc3_sw1',
            from: 'node_pc3',
            to: 'node_sw1',
            isShared: true,
            channelName: 'Shared Channel 1 (Hub/Bus segment)',
            bandwidth: '100 Mbps',
            delay: '2 ms'
        },
        // Switch1 to Router1 - point-to-point link
        {
            id: 'link_sw1_r1',
            from: 'node_sw1',
            to: 'node_r1',
            isShared: false,
            channelName: 'PtP Link SW1-R1',
            bandwidth: '1 Gbps',
            delay: '1 ms'
        },
        // Router1 to Router2 - point-to-point WAN link
        {
            id: 'link_r1_r2',
            from: 'node_r1',
            to: 'node_r2',
            isShared: false,
            channelName: 'PtP WAN Link R1-R2',
            bandwidth: '100 Mbps',
            delay: '5 ms'
        },
        // Router2 to PC2 - point-to-point LAN link
        {
            id: 'link_r2_pc2',
            from: 'node_r2',
            to: 'node_pc2',
            isShared: false,
            channelName: 'PtP Link R2-PC2',
            bandwidth: '1 Gbps',
            delay: '1 ms'
        }
    ];

    return { nodes, links };
}

// Validate configuration parameters
export function validateConfig(config) {
    const errors = [];
    if (!config.sourceId) {
        errors.push('Please select a valid Source PC.');
    }
    if (!config.destId) {
        errors.push('Please select a valid Destination PC.');
    }
    if (config.sourceId && config.destId && config.sourceId === config.destId) {
        errors.push('Source and Destination devices must be different.');
    }
    if (config.totalPackets < 1 || config.totalPackets > 50) {
        errors.push('Total Data Packets must be between 1 and 50.');
    }
    if (config.packetLossProb < 0 || config.packetLossProb > 0.3) {
        errors.push('Packet Loss Probability must be between 0% and 30%.');
    }
    return {
        isValid: errors.length === 0,
        errors
    };
}

