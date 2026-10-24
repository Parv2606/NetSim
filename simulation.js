/**
 * NetSim - Computer Networks Interactive Simulator
 * simulation.js - Core simulation engine integrating TCP 3-Way Handshake,
 * Routing, Shared-Medium Collision, and Reliable Data Packet Transport.
 */

import { generateId, formatTime, clamp } from './utils.js';

export const SIM_STATUS = {
    READY: 'Ready',
    RUNNING: 'Running',
    PAUSED: 'Paused',
    COMPLETED: 'Completed',
    FAILED: 'Failed'
};

export const TCP_STATE = {
    CLOSED: 'CLOSED',
    SYN_SENT: 'SYN-SENT',
    SYN_RECEIVED: 'SYN-RECEIVED',
    ESTABLISHED: 'ESTABLISHED'
};

export class Simulation {
    constructor(topology, options = {}) {
        this.topology = topology;
        
        // Hooks & callbacks for UI updates
        this.onLog = options.onLog || (() => {});
        this.onStatsUpdate = options.onStatsUpdate || (() => {});
        this.onStateChange = options.onStateChange || (() => {});
        this.onWindowUpdate = options.onWindowUpdate || (() => {});
        this.onTcpStateChange = options.onTcpStateChange || (() => {});

        // Configuration defaults
        this.config = {
            sourceId: 'node_pc1',
            destId: 'node_pc2',
            totalPackets: 10,
            windowSize: 4,
            speed: 1.0, // multiplier: 0.5 (Slow), 1.0 (Normal), 2.0 (Fast)
            collisionProb: 0.3, // Medium
            packetLossProb: 0.05, // 5%
            mode: 'complete' // 'complete', 'tcp_only', 'routing_only', 'collision_only'
        };

        // Engine State
        this.status = SIM_STATUS.READY;
        this.simTime = 0.0; // simulated elapsed seconds
        this.lastFrameTime = 0;
        this.animFrameId = null;

        // Statistics tracking
        this.stats = {
            totalPackets: 10,
            deliveredPackets: 0,
            lostPackets: 0,
            collisions: 0,
            retransmissions: 0,
            acksReceived: 0,
            hopCount: 0,
            simTime: 0,
            deliveryPercentage: '0.0%',
            tcpState: TCP_STATE.CLOSED,
            status: SIM_STATUS.READY
        };

        // Active in-flight packet objects
        // Each packet: { id, seqNum, type: 'DATA'|'SYN'|'SYN-ACK'|'ACK'|'PROBE', label,
        //               path: [nodeId1, nodeId2, ...], hopIndex: 0, progress: 0.0,
        //               status: 'IN_FLIGHT'|'COLLISION'|'ACK'|'RETRANSMIT'|'LOST',
        //               isRetransmit: boolean, x: number, y: number,
        //               onArrival: callback, onCollision: callback, onDrop: callback }
        this.inFlightPackets = [];

        // Reliable Data Packet Transmission State
        this.dataTx = {
            currentSeq: 1,
            totalPackets: 10,
            isAwaitingAck: false,
            timeoutExpiresAt: 0,
            timeoutDuration: 5.0,
            packetRetries: new Map(),
            maxRetries: 6
        };

        this.nextCrossTrafficTime = 2.5;

        // Shared channel collision tracker: linkId -> [packetIds currently traversing]
        this.channelOccupancy = new Map();

        // Step queue for Step Forward control
        this.stepQueue = [];

        this.initAnimationLoop();
    }

    // Update configuration from UI
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        this.dataTx.totalPackets = this.config.totalPackets;
        this.stats.totalPackets = this.config.totalPackets;
        this.onStatsUpdate(this.stats);
    }

    // Animation frame loop decoupled from simulation time
    initAnimationLoop() {
        const loop = (timestamp) => {
            if (!this.lastFrameTime) this.lastFrameTime = timestamp;
            const deltaRealMs = timestamp - this.lastFrameTime;
            this.lastFrameTime = timestamp;

            if (this.status === SIM_STATUS.RUNNING) {
                // Advance simulation time proportionally to speed
                const deltaSimSec = (deltaRealMs / 1000) * this.config.speed;
                this.tick(deltaSimSec);
            }

            // Always update packet positions and render topology
            this.updatePacketPositions();
            this.topology.setPacketMarkers(this.inFlightPackets);
            this.topology.render();

            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    // Core simulation tick
    tick(dt) {
        this.simTime += dt;
        this.stats.simTime = this.simTime;

        // 1. Advance in-flight packets along their path hops
        const finishedPackets = [];

        for (let i = this.inFlightPackets.length - 1; i >= 0; i--) {
            const pkt = this.inFlightPackets[i];

            if (pkt.isPaused) continue;

            const isControl = (pkt.type === 'SYN' || pkt.type === 'SYN-ACK' || pkt.type === 'ACK');
            const hopSpeed = (isControl ? 2.0 : 1.3) * this.config.speed;

            pkt.progress += hopSpeed * dt;

            // Check shared link collision during hop traversal
            this.checkSharedMediumCollision(pkt);

            // Handle dropped packet animation fading
            if (pkt.status === 'LOST') {
                if (pkt.progress >= 0.5) {
                    finishedPackets.push(pkt);
                    this.inFlightPackets.splice(i, 1);
                    this.releaseChannelOccupancy(pkt);
                    if (pkt.onDrop) pkt.onDrop(pkt);
                    continue;
                }
            }

            // Handle collided packet removal
            if (pkt.status === 'COLLISION') {
                if (pkt.progress >= 0.6) {
                    finishedPackets.push(pkt);
                    this.inFlightPackets.splice(i, 1);
                    this.releaseChannelOccupancy(pkt);
                    if (pkt.onCollision) pkt.onCollision(pkt);
                    continue;
                }
            }

            // Hop completion
            if (pkt.progress >= 1.0) {
                this.releaseChannelOccupancy(pkt);
                pkt.hopIndex++;
                pkt.progress = 0;

                if (pkt.hopIndex >= pkt.path.length - 1) {
                    // Reached destination!
                    finishedPackets.push(pkt);
                    this.inFlightPackets.splice(i, 1);
                    if (pkt.onArrival) {
                        pkt.onArrival(pkt);
                    }
                } else {
                    // Enter next hop
                    this.registerChannelOccupancy(pkt);
                }
            }
        }

        // 2. Reliable Data Transmission State Machine Tick
        if (this.config.mode === 'complete' && this.stats.tcpState === TCP_STATE.ESTABLISHED) {
            this.tickDataTransmission(dt);
        }

        // Update statistics and UI
        this.updateStats();
    }

    // Calculate (x, y) coordinates for in-flight packets based on current hop progress
    updatePacketPositions() {
        for (const pkt of this.inFlightPackets) {
            if (!pkt.path || pkt.path.length < 2) continue;
            const fromNodeId = pkt.path[pkt.hopIndex];
            const toNodeId = pkt.path[pkt.hopIndex + 1];

            const n1 = this.topology.getNodeById(fromNodeId);
            const n2 = this.topology.getNodeById(toNodeId);

            if (n1 && n2) {
                const t = clamp(pkt.progress, 0, 1);
                pkt.x = n1.x + t * (n2.x - n1.x);
                pkt.y = n1.y + t * (n2.y - n1.y);
            }
        }
    }

    // ==========================================
    // Shared-Medium Collision Model
    // ==========================================
    registerChannelOccupancy(pkt) {
        if (!pkt.path || pkt.hopIndex >= pkt.path.length - 1) return;
        const fromId = pkt.path[pkt.hopIndex];
        const toId = pkt.path[pkt.hopIndex + 1];
        const link = this.topology.getLinkBetween(fromId, toId);

        if (link && link.isShared) {
            const channelKey = link.channelName || link.id;
            pkt.currentChannelKey = channelKey;
            pkt.currentLinkId = link.id;
            if (!this.channelOccupancy.has(channelKey)) {
                this.channelOccupancy.set(channelKey, new Set());
            }
            this.channelOccupancy.get(channelKey).add(pkt.id);
        } else {
            pkt.currentChannelKey = null;
            pkt.currentLinkId = null;
        }
    }

    releaseChannelOccupancy(pkt) {
        if (pkt.currentChannelKey && this.channelOccupancy.has(pkt.currentChannelKey)) {
            const set = this.channelOccupancy.get(pkt.currentChannelKey);
            set.delete(pkt.id);
            if (set.size === 0) {
                if (pkt.currentLinkId) {
                    this.topology.setCollidingLink(pkt.currentLinkId, false);
                }
            }
        }
        pkt.currentChannelKey = null;
        pkt.currentLinkId = null;
    }

    checkSharedMediumCollision(pkt) {
        if (!pkt.currentChannelKey || pkt.status === 'COLLISION') return;
        if (pkt.type !== 'DATA') return;
        const occupants = this.channelOccupancy.get(pkt.currentChannelKey);
        if (!occupants || occupants.size <= 1) return;

        // Check if there are contending DATA packets from DIFFERENT sender stations
        const activePackets = Array.from(occupants)
            .map(pid => this.inFlightPackets.find(p => p.id === pid))
            .filter(p => p && p.type === 'DATA');

        const distinctSenders = new Set(activePackets.map(p => p.sourceId || p.path[0]));

        if (distinctSenders.size > 1) {
            // Overlapping transmissions between DIFFERENT stations on the shared medium!
            this.stats.collisions++;
            if (pkt.currentLinkId) {
                this.topology.setCollidingLink(pkt.currentLinkId, true);
            }

            // Mark all overlapping packets on this shared channel as COLLIDED
            for (const otherPkt of activePackets) {
                if (otherPkt.status !== 'COLLISION') {
                    otherPkt.status = 'COLLISION';
                    otherPkt.label = '⚡ COLLISION';
                }
            }

            const senderNames = Array.from(distinctSenders).map(id => this.topology.getNodeById(id)?.name || id).join(' and ');
            this.log(`COLLISION detected on ${pkt.currentChannelKey}! Transmissions overlapped between ${senderNames}.`, 'collision');
        }
    }

    // ==========================================
    // Protocol Orchestration
    // ==========================================
    start() {
        if (this.status === SIM_STATUS.RUNNING) return;

        // Validate configuration & route
        const routeResult = this.topology.findRouteBFS(this.config.sourceId, this.config.destId);
        if (!routeResult.success) {
            this.status = SIM_STATUS.FAILED;
            this.log(`[${formatTime(this.simTime)}] Error: ${routeResult.reason}`, 'error');
            this.onStateChange(this.status);
            return;
        }

        // Fresh start or resume from ready
        this.status = SIM_STATUS.RUNNING;
        this.activeRoute = routeResult;
        this.stats.hopCount = routeResult.hops;
        this.topology.setHighlightedRoute(routeResult.path);

        this.log(`[${formatTime(this.simTime)}] Simulation started. Mode: ${this.getModeName()}.`, 'info');
        this.log(`[${formatTime(this.simTime)}] Route discovered (${routeResult.hops} hops): ${routeResult.description}`, 'info');

        this.onStateChange(this.status);

        // Execute by mode
        switch (this.config.mode) {
            case 'complete':
                this.executeCompleteSimulation();
                break;
            case 'tcp_only':
                this.executeTcpHandshake();
                break;
            case 'routing_only':
                this.executeRoutingDemo();
                break;
            case 'collision_only':
                this.executeCollisionDemo();
                break;
            default:
                this.executeCompleteSimulation();
        }
    }

    pause() {
        if (this.status !== SIM_STATUS.RUNNING) return;
        this.status = SIM_STATUS.PAUSED;
        this.log(`[${formatTime(this.simTime)}] Simulation paused.`, 'warning');
        this.onStateChange(this.status);
    }

    resume() {
        if (this.status !== SIM_STATUS.PAUSED) return;
        this.status = SIM_STATUS.RUNNING;
        this.lastFrameTime = performance.now();
        this.log(`[${formatTime(this.simTime)}] Simulation resumed.`, 'info');
        this.onStateChange(this.status);
    }

    step() {
        if (this.status === SIM_STATUS.COMPLETED || this.status === SIM_STATUS.FAILED) return;

        // If paused or ready, step forward by discrete simulation slice (e.g. 0.25 simulated seconds)
        const previousStatus = this.status;
        this.status = SIM_STATUS.RUNNING;
        this.tick(0.25);
        this.status = SIM_STATUS.PAUSED;
        this.onStateChange(this.status);
        this.log(`[${formatTime(this.simTime)}] Stepped forward by 0.25s.`, 'info');
    }

    reset() {
        this.status = SIM_STATUS.READY;
        this.simTime = 0.0;
        this.inFlightPackets = [];
        this.channelOccupancy.clear();
        this.topology.clearHighlightedRoute();
        this.topology.clearCollisions();
        this.topology.setPacketMarkers([]);

        // Reset Data Transmission State
        this.dataTx = {
            currentSeq: 1,
            totalPackets: this.config.totalPackets,
            isAwaitingAck: false,
            timeoutExpiresAt: 0,
            timeoutDuration: 5.0,
            packetRetries: new Map(),
            maxRetries: 6
        };

        this.nextCrossTrafficTime = 2.5;

        // Reset Statistics
        this.stats = {
            totalPackets: this.config.totalPackets,
            deliveredPackets: 0,
            lostPackets: 0,
            collisions: 0,
            retransmissions: 0,
            acksReceived: 0,
            hopCount: this.activeRoute ? this.activeRoute.hops : 0,
            simTime: 0,
            deliveryPercentage: '0.0%',
            tcpState: TCP_STATE.CLOSED,
            status: SIM_STATUS.READY
        };

        this.onTcpStateChange(TCP_STATE.CLOSED);
        if (this.onWindowUpdate) this.onWindowUpdate(null, null);
        this.onStatsUpdate(this.stats);
        this.onStateChange(this.status);

        this.log(`[00:00.0] Simulation reset to initial state.`, 'info');
        this.topology.render();
    }

    // ==========================================
    // Phase 1 & 2: TCP Handshake
    // ==========================================
    executeTcpHandshake(onEstablished = null) {
        const srcNode = this.topology.getNodeById(this.config.sourceId);
        const dstNode = this.topology.getNodeById(this.config.destId);

        this.updateTcpState(TCP_STATE.CLOSED);
        this.log(`[${formatTime(this.simTime)}] [TCP Handshake] ${srcNode.name} initiating connection to ${dstNode.name}...`, 'info');

        // Step 1: Send SYN
        this.updateTcpState(TCP_STATE.SYN_SENT);
        this.log(`[${formatTime(this.simTime)}] [TCP] ${srcNode.name} sent SYN packet.`, 'info');

        const synPacket = this.createPacket({
            type: 'SYN',
            label: 'SYN',
            path: [...this.activeRoute.path],
            status: 'IN_FLIGHT',
            onArrival: () => {
                // Step 2: Destination received SYN, returns SYN-ACK
                this.updateTcpState(TCP_STATE.SYN_RECEIVED);
                this.log(`[${formatTime(this.simTime)}] [TCP] ${dstNode.name} received SYN, sending SYN-ACK.`, 'info');

                const reversePath = [...this.activeRoute.path].reverse();
                const synAckPacket = this.createPacket({
                    type: 'SYN-ACK',
                    label: 'SYN-ACK',
                    path: reversePath,
                    status: 'ACK',
                    onArrival: () => {
                        // Step 3: Source received SYN-ACK, sends ACK
                        this.log(`[${formatTime(this.simTime)}] [TCP] ${srcNode.name} received SYN-ACK, sending final ACK.`, 'info');

                        const ackPacket = this.createPacket({
                            type: 'ACK',
                            label: 'ACK',
                            path: [...this.activeRoute.path],
                            status: 'IN_FLIGHT',
                            onArrival: () => {
                                this.updateTcpState(TCP_STATE.ESTABLISHED);
                                this.log(`[${formatTime(this.simTime)}] [TCP] Connection ESTABLISHED successfully!`, 'success');

                                if (this.config.mode === 'tcp_only') {
                                    this.completeSimulation();
                                } else if (onEstablished) {
                                    onEstablished();
                                }
                            }
                        });
                        this.transmitPacket(ackPacket);
                    }
                });
                this.transmitPacket(synAckPacket);
            }
        });

        this.transmitPacket(synPacket);
    }

    // ==========================================
    // Phase 3: Reliable Data Packet Transmission Engine
    // ==========================================
    executeCompleteSimulation() {
        this.initDataTx();
        // Stage 1: Route is highlighted
        // Stage 2: Handshake
        this.executeTcpHandshake(() => {
            // Stage 3: Data packet transmission with ACKs + Collisions + Loss
            this.log(`[${formatTime(this.simTime)}] Beginning Data Packet Transmission across established route.`, 'info');
            this.sendNextDataPacket();
        });
    }

    initDataTx() {
        this.dataTx.currentSeq = 1;
        this.dataTx.totalPackets = this.config.totalPackets;
        this.dataTx.isAwaitingAck = false;
        this.dataTx.timeoutExpiresAt = 0;
        this.dataTx.packetRetries.clear();
    }

    tickDataTransmission(dt) {
        // Periodic background cross-traffic on shared link to simulate collisions based on probability
        if (this.config.collisionProb > 0 && this.simTime >= this.nextCrossTrafficTime) {
            this.nextCrossTrafficTime = this.simTime + (5.0 / (this.config.collisionProb * 1.5));
            if (Math.random() < this.config.collisionProb) {
                this.triggerBackgroundSharedTraffic();
            }
        }

        // Check timeout on outstanding packet
        if (this.dataTx.isAwaitingAck && this.dataTx.timeoutExpiresAt > 0 && this.simTime >= this.dataTx.timeoutExpiresAt) {
            this.handleDataTimeout();
        }

        // Check completion
        if (this.dataTx.currentSeq > this.dataTx.totalPackets && this.inFlightPackets.length === 0) {
            this.completeSimulation();
        }
    }

    triggerBackgroundSharedTraffic() {
        const sharedLink = this.topology.links.find(l => l.isShared);
        const pc3 = this.topology.getNodeById('node_pc3');
        const sw1 = this.topology.getNodeById('node_sw1');
        if (!sharedLink || !pc3 || !sw1) return;

        // PC3 transmits onto shared channel
        const crossPkt = this.createPacket({
            type: 'DATA',
            label: 'PC3-Bg',
            path: ['node_pc3', 'node_sw1'],
            status: 'IN_FLIGHT',
            onCollision: () => {
                this.log(`[${formatTime(this.simTime)}] Cross-traffic packet collided on ${sharedLink.channelName}! Backing off...`, 'collision');
            }
        });
        this.transmitPacket(crossPkt);
    }

    sendNextDataPacket(isRetransmit = false) {
        if (this.status !== SIM_STATUS.RUNNING) return;
        const seqNum = this.dataTx.currentSeq;
        if (seqNum > this.dataTx.totalPackets) return;

        const currentRetries = (this.dataTx.packetRetries.get(seqNum) || 0) + (isRetransmit ? 1 : 0);
        this.dataTx.packetRetries.set(seqNum, currentRetries);

        if (currentRetries > this.dataTx.maxRetries) {
            this.status = SIM_STATUS.FAILED;
            this.log(`[${formatTime(this.simTime)}] Transmission failed: Packet P${seqNum} exceeded maximum retry limit (${this.dataTx.maxRetries}).`, 'error');
            this.onStateChange(this.status);
            return;
        }

        this.dataTx.isAwaitingAck = true;
        this.dataTx.timeoutExpiresAt = this.simTime + this.dataTx.timeoutDuration;

        if (isRetransmit) {
            this.stats.retransmissions++;
            this.log(`[${formatTime(this.simTime)}] Retransmitting Packet P${seqNum} (Attempt ${currentRetries}).`, 'warning');
        } else {
            this.log(`[${formatTime(this.simTime)}] Transmitting Data Packet P${seqNum} of ${this.dataTx.totalPackets}.`, 'info');
        }

        const willDrop = Math.random() < this.config.packetLossProb;

        const packet = this.createPacket({
            seqNum,
            type: 'DATA',
            label: `P${seqNum}`,
            path: [...this.activeRoute.path],
            status: isRetransmit ? 'RETRANSMIT' : 'IN_FLIGHT',
            isRetransmit,
            onArrival: () => {
                this.handleReceiverDataArrival(seqNum);
            },
            onDrop: () => {
                this.stats.lostPackets++;
                this.log(`[${formatTime(this.simTime)}] Packet P${seqNum} dropped due to simulated channel loss!`, 'error');
            },
            onCollision: () => {
                this.scheduleBackoffRetry(seqNum);
            }
        });

        if (willDrop) {
            packet.status = 'LOST';
        }

        this.transmitPacket(packet);
    }

    handleReceiverDataArrival(seqNum) {
        this.stats.deliveredPackets++;
        this.log(`[${formatTime(this.simTime)}] Destination received Packet P${seqNum} successfully. Sending ACK ${seqNum}.`, 'success');
        this.sendAck(seqNum);
    }

    sendAck(ackNum) {
        const reversePath = [...this.activeRoute.path].reverse();
        const ackPacket = this.createPacket({
            ackNum,
            type: 'ACK',
            label: `ACK ${ackNum}`,
            path: reversePath,
            status: 'ACK',
            onArrival: () => {
                this.handleAckArrival(ackNum);
            }
        });

        this.transmitPacket(ackPacket);
    }

    handleAckArrival(ackNum) {
        this.stats.acksReceived++;
        this.log(`[${formatTime(this.simTime)}] Sender received ACK ${ackNum}. Delivery of Packet P${ackNum} confirmed.`, 'success');

        this.dataTx.isAwaitingAck = false;
        this.dataTx.timeoutExpiresAt = 0;
        this.dataTx.currentSeq++;

        if (this.dataTx.currentSeq <= this.dataTx.totalPackets) {
            setTimeout(() => {
                if (this.status === SIM_STATUS.RUNNING) {
                    this.sendNextDataPacket();
                }
            }, 300 / this.config.speed);
        } else {
            setTimeout(() => {
                if (this.status === SIM_STATUS.RUNNING && this.inFlightPackets.length === 0) {
                    this.completeSimulation();
                }
            }, 350 / this.config.speed);
        }
    }

    handleDataTimeout() {
        const seqNum = this.dataTx.currentSeq;
        this.log(`[${formatTime(this.simTime)}] [TIMEOUT] ACK timer expired for Packet P${seqNum}! Retransmitting...`, 'error');
        this.dataTx.timeoutExpiresAt = this.simTime + this.dataTx.timeoutDuration;
        this.sendNextDataPacket(true);
    }

    scheduleBackoffRetry(seqNum) {
        const backoffDelay = (0.5 + Math.random() * 0.8);
        this.log(`[${formatTime(this.simTime)}] Collision encountered. Scheduling retry for Packet P${seqNum} after ${backoffDelay.toFixed(2)}s backoff delay.`, 'warning');

        setTimeout(() => {
            if (this.status === SIM_STATUS.RUNNING && seqNum === this.dataTx.currentSeq) {
                this.sendNextDataPacket(true);
            }
        }, (backoffDelay * 1000) / this.config.speed);
    }

    // ==========================================
    // Phase 6: Simultaneous Traffic / Collision Demo
    // ==========================================
    executeCollisionDemo() {
        // Trigger simultaneous traffic on a shared medium
        this.log(`[${formatTime(this.simTime)}] Running Shared-Medium Collision Demonstration...`, 'info');
        this.generateSimultaneousTraffic();
    }

    generateSimultaneousTraffic() {
        // Find devices connected to a shared medium
        const sharedLink = this.topology.links.find(l => l.isShared);
        if (!sharedLink) {
            this.log(`[${formatTime(this.simTime)}] No shared medium link exists in current topology. Please connect devices with a Shared Channel.`, 'warning');
            alert('No shared medium channel exists in the current network. Click "+ Connect (Shared)" or load the default network.');
            return;
        }

        // Find devices connected to this shared link
        const n1 = this.topology.getNodeById(sharedLink.from);
        const n2 = this.topology.getNodeById(sharedLink.to);

        // Find another device sharing this medium segment or node
        let pc1 = this.topology.getNodeById('node_pc1');
        let pc3 = this.topology.getNodeById('node_pc3');
        let sw1 = this.topology.getNodeById('node_sw1');

        if (!pc1 || !pc3 || !sw1) {
            pc1 = n1;
            pc3 = n2;
            sw1 = n2;
        }

        // Ensure simulation is running to animate collision
        if (this.status !== SIM_STATUS.RUNNING) {
            this.status = SIM_STATUS.RUNNING;
            this.lastFrameTime = performance.now();
            this.onStateChange(this.status);
        }

        this.log(`[${formatTime(this.simTime)}] ${pc1.name} and ${pc3.name} transmitting simultaneously on Shared Channel 1...`, 'warning');

        // Transmit packet from PC1 -> Switch1
        const p1 = this.createPacket({
            type: 'DATA',
            label: 'PC1-Pkt',
            path: [pc1.id, sw1.id],
            status: 'IN_FLIGHT',
            onCollision: () => {
                this.log(`[${formatTime(this.simTime)}] ${pc1.name} detected collision on shared channel! Starting backoff...`, 'warning');
                setTimeout(() => {
                    if (this.status === SIM_STATUS.RUNNING) {
                        this.log(`[${formatTime(this.simTime)}] ${pc1.name} retransmitting successfully after backoff.`, 'success');
                        const p1Retry = this.createPacket({
                            type: 'DATA',
                            label: 'PC1-Retry',
                            path: [pc1.id, sw1.id],
                            status: 'RETRANSMIT',
                            onArrival: () => {
                                this.log(`[${formatTime(this.simTime)}] ${pc1.name} retransmitted packet delivered to ${sw1.name}.`, 'success');
                            }
                        });
                        this.transmitPacket(p1Retry);
                    }
                }, 1400 / this.config.speed);
            }
        });

        // Transmit packet from PC3 -> Switch1 at overlapping time
        const p2 = this.createPacket({
            type: 'DATA',
            label: 'PC3-Pkt',
            path: [pc3.id, sw1.id],
            status: 'IN_FLIGHT',
            onCollision: () => {
                this.log(`[${formatTime(this.simTime)}] ${pc3.name} detected collision on shared channel! Starting backoff...`, 'warning');
                setTimeout(() => {
                    if (this.status === SIM_STATUS.RUNNING) {
                        this.log(`[${formatTime(this.simTime)}] ${pc3.name} retransmitting successfully after backoff.`, 'success');
                        const p2Retry = this.createPacket({
                            type: 'DATA',
                            label: 'PC3-Retry',
                            path: [pc3.id, sw1.id],
                            status: 'RETRANSMIT',
                            onArrival: () => {
                                this.log(`[${formatTime(this.simTime)}] ${pc3.name} retransmitted packet delivered to ${sw1.name}.`, 'success');
                            }
                        });
                        this.transmitPacket(p2Retry);
                    }
                }, 2200 / this.config.speed);
            }
        });

        this.transmitPacket(p1);
        setTimeout(() => {
            if (this.status === SIM_STATUS.RUNNING) {
                this.transmitPacket(p2);
            }
        }, 120);
    }

    // ==========================================
    // Phase 2: Routing Probe Demo
    // ==========================================
    executeRoutingDemo() {
        this.log(`[${formatTime(this.simTime)}] Sending ICMP Echo Probe along BFS path...`, 'info');

        const probePkt = this.createPacket({
            type: 'PROBE',
            label: 'ECHO',
            path: [...this.activeRoute.path],
            status: 'IN_FLIGHT',
            onArrival: () => {
                this.log(`[${formatTime(this.simTime)}] Probe reached destination! Route verified with ${this.activeRoute.hops} hops.`, 'success');
                this.completeSimulation();
            }
        });

        this.transmitPacket(probePkt);
    }

    // ==========================================
    // Packet Life-cycle
    // ==========================================
    createPacket(props) {
        return {
            id: generateId('pkt'),
            progress: 0.0,
            hopIndex: 0,
            x: 0,
            y: 0,
            isPaused: false,
            sourceId: props.sourceId || (props.path && props.path.length > 0 ? props.path[0] : null),
            ...props
        };
    }

    transmitPacket(pkt) {
        this.registerChannelOccupancy(pkt);
        this.inFlightPackets.push(pkt);
    }

    // ==========================================
    // State & Summary Helpers
    // ==========================================
    updateTcpState(newState) {
        this.stats.tcpState = newState;
        this.onTcpStateChange(newState);
        this.updateStats();
    }

    updateStats() {
        const total = (this.config.mode === 'tcp_only' ? 3 : this.config.totalPackets) || 1;
        const delivered = this.stats.deliveredPackets;
        this.stats.deliveryPercentage = `${((delivered / total) * 100).toFixed(1)}%`;
        this.onStatsUpdate(this.stats);
    }

    completeSimulation() {
        this.status = SIM_STATUS.COMPLETED;
        if (this.config.mode === 'tcp_only') {
            this.stats.deliveredPackets = 3;
            this.stats.totalPackets = 3;
            this.stats.deliveryPercentage = '100.0%';
        }
        this.updateStats();
        this.onStateChange(this.status);

        this.log(`═══════════════════════════════════════`, 'success');
        this.log(`SIMULATION COMPLETED`, 'success');
        if (this.config.mode === 'tcp_only') {
            this.log(`• TCP Handshake Control Packets: 3 (SYN, SYN-ACK, ACK)`, 'info');
            this.log(`• Successfully Delivered: 3`, 'success');
            this.log(`• Delivery Rate: 100.0%`, 'success');
            this.log(`• Route Hop Count: ${this.stats.hopCount}`, 'info');
            this.log(`• Connection Status: ESTABLISHED`, 'success');
        } else {
            this.log(`• Total Unique Packets: ${this.config.totalPackets}`, 'info');
            this.log(`• Successfully Delivered: ${this.stats.deliveredPackets}`, 'success');
            this.log(`• Retransmissions: ${this.stats.retransmissions}`, 'info');
            this.log(`• Collisions Encountered: ${this.stats.collisions}`, 'info');
            this.log(`• Route Hop Count: ${this.stats.hopCount}`, 'info');
            this.log(`• Delivery Rate: ${this.stats.deliveryPercentage}`, 'success');
        }
        this.log(`• Total Simulated Duration: ${formatTime(this.simTime)}`, 'info');
        this.log(`═══════════════════════════════════════`, 'success');
    }

    log(message, type = 'normal') {
        const cleanMessage = message.replace(/^\[\d{2}:\d{2}\.\d\]\s*/, '');
        this.onLog({
            time: formatTime(this.simTime),
            message: cleanMessage,
            type, // 'info', 'success', 'warning', 'error', 'collision'
            timestamp: Date.now()
        });
    }

    getModeName() {
        switch (this.config.mode) {
            case 'complete': return 'Complete Simulation';
            case 'tcp_only': return 'TCP Handshake Only';
            case 'routing_only': return 'Routing Only';
            case 'collision_only': return 'Collision Demonstration';
            default: return this.config.mode;
        }
    }
}
