/**
 * NetSim - Computer Networks Interactive Simulator
 * script.js - Application initialization, UI event handling, and module synchronization
 */

import { Topology } from './topology.js';
import { Simulation, SIM_STATUS, TCP_STATE } from './simulation.js';
import { validateConfig, formatTime } from './utils.js';

function initApp() {
    if (window.__netsim_initialized) return;
    window.__netsim_initialized = true;

    // Canvas & Core Instances
    const canvas = document.getElementById('network-canvas');
    let topology = null;
    let simulation = null;

    // DOM Elements - Status & Header
    const statusBadge = document.getElementById('status-badge');
    const statusText = document.getElementById('status-text');
    const btnHeaderReset = document.getElementById('btn-header-reset');

    // DOM Elements - Controls
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnStep = document.getElementById('btn-step');
    const btnFindRoute = document.getElementById('btn-find-route');
    const btnReset = document.getElementById('btn-reset');
    const btnTraffic = document.getElementById('btn-traffic');
    const btnAltRoute = document.getElementById('btn-alt-route');

    // DOM Elements - Canvas Toolbar
    const btnAddPc = document.getElementById('btn-add-pc');
    const btnAddRouter = document.getElementById('btn-add-router');
    const btnAddSwitch = document.getElementById('btn-add-switch');
    const btnConnectPtp = document.getElementById('btn-connect-ptp');
    const btnConnectShared = document.getElementById('btn-connect-shared');
    const btnDelete = document.getElementById('btn-delete');
    const btnLoadDefault = document.getElementById('btn-load-default');

    // DOM Elements - Configuration Inputs
    const selectSource = document.getElementById('select-source');
    const selectDest = document.getElementById('select-dest');
    const selectMode = document.getElementById('select-mode');
    const inputTotalPackets = document.getElementById('input-total-packets');
    const selectSpeed = document.getElementById('select-speed');
    const selectLossProb = document.getElementById('select-loss-prob');
    const selectCollisionProb = document.getElementById('select-collision-prob');

    // DOM Elements - TCP Timeline
    const tcpSteps = {
        [TCP_STATE.CLOSED]: document.getElementById('tcp-closed'),
        [TCP_STATE.SYN_SENT]: document.getElementById('tcp-syn-sent'),
        [TCP_STATE.SYN_RECEIVED]: document.getElementById('tcp-syn-recv'),
        [TCP_STATE.ESTABLISHED]: document.getElementById('tcp-established')
    };
    const routeDisplayBadge = document.getElementById('route-display-badge');

    // DOM Elements - Live Statistics Dashboard
    const statTotalPackets = document.getElementById('stat-total-packets');
    const statDelivered = document.getElementById('stat-delivered');
    const statLost = document.getElementById('stat-lost');
    const statCollisions = document.getElementById('stat-collisions');
    const statRetransmissions = document.getElementById('stat-retransmissions');
    const statAcks = document.getElementById('stat-acks');
    const statHops = document.getElementById('stat-hops');
    const statTime = document.getElementById('stat-time');
    const statRate = document.getElementById('stat-rate');
    const statTcpState = document.getElementById('stat-tcp-state');

    // DOM Elements - Event Log & Inspector
    const eventLogContainer = document.getElementById('event-log-container');
    const btnClearLog = document.getElementById('btn-clear-log');
    const inspectorContent = document.getElementById('inspector-content');

    // ==========================================
    // Initialize Topology and Simulation
    // ==========================================
    topology = new Topology(canvas, {
        onSelectionChanged: (item, type) => {
            renderInspector(item, type);
        },
        onTopologyChanged: () => {
            populateDeviceDropdowns();
            updateCurrentRouteDisplay();
        }
    });

    simulation = new Simulation(topology, {
        onLog: (logItem) => {
            appendLog(logItem);
        },
        onStatsUpdate: (stats) => {
            renderStats(stats);
        },
        onStateChange: (state) => {
            updateStatusBadge(state);
            updateControlButtons(state);
        },
        onTcpStateChange: (tcpState) => {
            updateTcpTimeline(tcpState);
        }
    });

    // Handle Window Resize
    window.addEventListener('resize', () => {
        topology.resize();
    });

    // Populate initial dropdowns and route
    populateDeviceDropdowns();
    updateConfigFromUI();
    updateCurrentRouteDisplay();
    simulation.reset();

    // Ensure canvas dimensions match DOM layout
    setTimeout(() => {
        if (topology) topology.resize();
    }, 50);

    // ==========================================
    // Event Listeners - Controls
    // ==========================================
    btnStart.addEventListener('click', () => {
        updateConfigFromUI();
        const validation = validateConfig(simulation.config);
        if (!validation.isValid) {
            alert(validation.errors.join('\n'));
            return;
        }
        simulation.start();
    });

    btnPause.addEventListener('click', () => {
        simulation.pause();
    });

    btnResume.addEventListener('click', () => {
        simulation.resume();
    });

    btnStep.addEventListener('click', () => {
        simulation.step();
    });

    btnReset.addEventListener('click', () => {
        simulation.reset();
    });

    btnHeaderReset.addEventListener('click', () => {
        simulation.reset();
    });

    btnFindRoute.addEventListener('click', () => {
        updateConfigFromUI();
        const res = topology.findRouteBFS(simulation.config.sourceId, simulation.config.destId);
        if (res.success) {
            topology.setHighlightedRoute(res.path);
            routeDisplayBadge.textContent = `Route (${res.hops} hops): ${res.description}`;
            statHops.textContent = res.hops;
            simulation.log(`[${formatTime(simulation.simTime)}] BFS Route found (${res.hops} hops): ${res.description}`, 'success');
        } else {
            topology.clearHighlightedRoute();
            routeDisplayBadge.textContent = 'No valid route between the selected devices.';
            statHops.textContent = '0';
            simulation.log(`[${formatTime(simulation.simTime)}] BFS Route discovery failed: ${res.reason}`, 'error');
            alert(res.reason);
        }
    });

    let altIndex = 0;
    btnAltRoute.addEventListener('click', () => {
        updateConfigFromUI();
        const routes = topology.findAlternativeRoutes(simulation.config.sourceId, simulation.config.destId);
        if (routes.length > 1) {
            altIndex = (altIndex + 1) % routes.length;
            const chosen = routes[altIndex];
            topology.setHighlightedRoute(chosen.path);
            routeDisplayBadge.textContent = `Route [Alt ${altIndex + 1}/${routes.length}]: ${chosen.description}`;
            statHops.textContent = chosen.hops;
            simulation.log(`[${formatTime(simulation.simTime)}] Displaying Alternative BFS Route ${altIndex + 1}: ${chosen.description}`, 'info');
        } else if (routes.length === 1) {
            simulation.log(`[${formatTime(simulation.simTime)}] Only one distinct path exists between the selected nodes.`, 'info');
        } else {
            simulation.log(`[${formatTime(simulation.simTime)}] No alternative routes available.`, 'warning');
        }
    });

    btnTraffic.addEventListener('click', () => {
        simulation.generateSimultaneousTraffic();
    });

    // ==========================================
    // Event Listeners - Canvas Toolbar
    // ==========================================
    btnAddPc.addEventListener('click', () => {
        topology.addNode('pc');
    });

    btnAddRouter.addEventListener('click', () => {
        topology.addNode('router');
    });

    btnAddSwitch.addEventListener('click', () => {
        topology.addNode('switch');
    });

    btnConnectPtp.addEventListener('click', () => {
        topology.startConnectMode(false);
    });

    btnConnectShared.addEventListener('click', () => {
        topology.startConnectMode(true);
    });

    btnDelete.addEventListener('click', () => {
        const deleted = topology.deleteSelected();
        if (!deleted) {
            alert('Please select a device node or link to delete.');
        }
    });

    btnLoadDefault.addEventListener('click', () => {
        topology.loadDefault();
        simulation.reset();
        populateDeviceDropdowns();
        updateCurrentRouteDisplay();
    });

    btnClearLog.addEventListener('click', () => {
        eventLogContainer.innerHTML = '';
    });

    // ==========================================
    // Configuration Input Change Listeners
    // ==========================================
    [
        selectSource,
        selectDest,
        selectMode,
        inputTotalPackets,
        inputWindowSize,
        selectSpeed,
        selectLossProb,
        selectCollisionProb
    ].forEach(el => {
        el.addEventListener('change', () => {
            updateConfigFromUI();
            updateCurrentRouteDisplay();
        });
    });

    function updateConfigFromUI() {
        const conf = {
            sourceId: selectSource.value,
            destId: selectDest.value,
            mode: selectMode.value,
            totalPackets: parseInt(inputTotalPackets.value, 10) || 10,
            speed: parseFloat(selectSpeed.value) || 1.0,
            packetLossProb: parseFloat(selectLossProb.value) || 0.05,
            collisionProb: parseFloat(selectCollisionProb.value) || 0.3
        };
        simulation.updateConfig(conf);
    }

    function populateDeviceDropdowns() {
        if (!topology || !topology.nodes) return;
        const pcNodes = topology.nodes.filter(n => n.type === 'pc');
        const currentSrc = selectSource.value;
        const currentDst = selectDest.value;

        selectSource.innerHTML = '';
        selectDest.innerHTML = '';

        pcNodes.forEach((node, index) => {
            const opt1 = document.createElement('option');
            opt1.value = node.id;
            opt1.textContent = `${node.name} (${node.ip})`;
            selectSource.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = node.id;
            opt2.textContent = `${node.name} (${node.ip})`;
            selectDest.appendChild(opt2);
        });

        // Retain selections if still valid, or default logically
        if (currentSrc && pcNodes.some(n => n.id === currentSrc)) {
            selectSource.value = currentSrc;
        } else if (pcNodes.length > 0) {
            selectSource.value = pcNodes[0].id;
        }

        if (currentDst && pcNodes.some(n => n.id === currentDst)) {
            selectDest.value = currentDst;
        } else if (pcNodes.length > 1) {
            // Default destination to second PC (PC2)
            selectDest.value = pcNodes[pcNodes.length - 1].id;
        }
    }

    function updateCurrentRouteDisplay() {
        if (!topology || !topology.nodes) return;
        const srcId = selectSource.value;
        const dstId = selectDest.value;
        if (!srcId || !dstId) return;

        const res = topology.findRouteBFS(srcId, dstId);
        if (res.success) {
            topology.setHighlightedRoute(res.path);
            routeDisplayBadge.textContent = `Route (${res.hops} hops): ${res.description}`;
            statHops.textContent = res.hops;
        } else {
            topology.clearHighlightedRoute();
            routeDisplayBadge.textContent = 'No valid route between the selected devices.';
            statHops.textContent = '0';
        }
    }

    // ==========================================
    // UI Synchronizers
    // ==========================================
    function updateStatusBadge(state) {
        statusBadge.className = 'status-badge';
        statusText.textContent = state;

        switch (state) {
            case SIM_STATUS.READY:
                statusBadge.classList.add('ready');
                break;
            case SIM_STATUS.RUNNING:
                statusBadge.classList.add('running');
                break;
            case SIM_STATUS.PAUSED:
                statusBadge.classList.add('paused');
                break;
            case SIM_STATUS.COMPLETED:
                statusBadge.classList.add('completed');
                break;
            case SIM_STATUS.FAILED:
                statusBadge.classList.add('failed');
                break;
            default:
                statusBadge.classList.add('ready');
        }
    }

    function updateControlButtons(state) {
        if (state === SIM_STATUS.RUNNING) {
            btnStart.disabled = true;
            btnPause.disabled = false;
            btnResume.disabled = true;
            btnStep.disabled = true;
        } else if (state === SIM_STATUS.PAUSED) {
            btnStart.disabled = true;
            btnPause.disabled = true;
            btnResume.disabled = false;
            btnStep.disabled = false;
        } else {
            // READY, COMPLETED, or FAILED
            btnStart.disabled = false;
            btnPause.disabled = true;
            btnResume.disabled = true;
            btnStep.disabled = false;
        }
    }

    function updateTcpTimeline(state) {
        // Reset all
        Object.values(tcpSteps).forEach(step => {
            step.classList.remove('active', 'completed');
        });

        if (state === TCP_STATE.CLOSED) {
            tcpSteps[TCP_STATE.CLOSED].classList.add('active');
        } else if (state === TCP_STATE.SYN_SENT) {
            tcpSteps[TCP_STATE.CLOSED].classList.add('completed');
            tcpSteps[TCP_STATE.SYN_SENT].classList.add('active');
        } else if (state === TCP_STATE.SYN_RECEIVED) {
            tcpSteps[TCP_STATE.CLOSED].classList.add('completed');
            tcpSteps[TCP_STATE.SYN_SENT].classList.add('completed');
            tcpSteps[TCP_STATE.SYN_RECEIVED].classList.add('active');
        } else if (state === TCP_STATE.ESTABLISHED) {
            tcpSteps[TCP_STATE.CLOSED].classList.add('completed');
            tcpSteps[TCP_STATE.SYN_SENT].classList.add('completed');
            tcpSteps[TCP_STATE.SYN_RECEIVED].classList.add('completed');
            tcpSteps[TCP_STATE.ESTABLISHED].classList.add('completed');
        }
    }

    function renderStats(stats) {
        statTotalPackets.textContent = stats.totalPackets;
        statDelivered.textContent = stats.deliveredPackets;
        statLost.textContent = stats.lostPackets;
        statCollisions.textContent = stats.collisions;
        statRetransmissions.textContent = stats.retransmissions;
        statAcks.textContent = stats.acksReceived;
        statHops.textContent = stats.hopCount;
        statTime.textContent = formatTime(stats.simTime);
        statRate.textContent = stats.deliveryPercentage;
        statTcpState.textContent = stats.tcpState;
    }



    function appendLog(logItem) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${logItem.type}`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = `[${logItem.time}]`;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg';
        msgSpan.textContent = logItem.message;

        entry.appendChild(timeSpan);
        entry.appendChild(msgSpan);

        eventLogContainer.appendChild(entry);
        // Auto scroll to bottom
        eventLogContainer.scrollTop = eventLogContainer.scrollHeight;
    }

    function renderInspector(item, type) {
        if (!item) {
            inspectorContent.innerHTML = `
                <p style="color: var(--secondary-text); font-style: italic;">
                    Click any node or link on the network canvas to inspect properties.
                </p>
            `;
            return;
        }

        if (type === 'node') {
            inspectorContent.innerHTML = `
                <div class="inspector-row">
                    <span class="inspector-label">Device Name:</span>
                    <span class="inspector-value">${item.name}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">Device Type:</span>
                    <span class="inspector-value">${item.type.toUpperCase()}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">IP Address:</span>
                    <span class="inspector-value">${item.ip}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">MAC Address:</span>
                    <span class="inspector-value">${item.mac}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">Coordinates:</span>
                    <span class="inspector-value">(${Math.round(item.x)}, ${Math.round(item.y)})</span>
                </div>
            `;
        } else if (type === 'link') {
            const n1 = topology.getNodeById(item.from);
            const n2 = topology.getNodeById(item.to);
            inspectorContent.innerHTML = `
                <div class="inspector-row">
                    <span class="inspector-label">Endpoints:</span>
                    <span class="inspector-value">${n1 ? n1.name : '?'} ↔ ${n2 ? n2.name : '?'}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">Link Type:</span>
                    <span class="inspector-value" style="color: ${item.isShared ? 'var(--warning-orange)' : 'var(--primary-blue)'}">
                        ${item.isShared ? 'Shared Channel (Collision Domain)' : 'Point-to-Point'}
                    </span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">Bandwidth:</span>
                    <span class="inspector-value">${item.bandwidth}</span>
                </div>
                <div class="inspector-row">
                    <span class="inspector-label">Propagation Delay:</span>
                    <span class="inspector-value">${item.delay}</span>
                </div>
                <div style="margin-top: 10px;">
                    <button id="btn-toggle-shared" class="btn btn-secondary btn-sm" style="width: 100%;">
                        ${item.isShared ? 'Convert to Point-to-Point' : 'Convert to Shared Medium'}
                    </button>
                </div>
            `;

            const btnToggleShared = document.getElementById('btn-toggle-shared');
            if (btnToggleShared) {
                btnToggleShared.addEventListener('click', () => {
                    item.isShared = !item.isShared;
                    item.channelName = item.isShared ? 'Shared Channel (Collision Domain)' : `PtP Link ${n1.name}-${n2.name}`;
                    topology.render();
                    renderInspector(item, 'link');
                });
            }
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
