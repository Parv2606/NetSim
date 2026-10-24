/**
 * NetSim - Computer Networks Interactive Simulator
 * topology.js - Topology management, canvas rendering, node dragging, and BFS routing
 */

import { generateId, distance, pointToSegmentDistance, getDefaultTopology } from './utils.js';

export class Topology {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.links = [];
        
        this.selectedNode = null;
        this.selectedLink = null;
        this.hoveredNode = null;
        this.draggedNode = null;
        this.dragOffset = { x: 0, y: 0 };
        
        // Mode: 'normal', 'connect'
        this.mode = 'normal';
        this.connectStartNode = null;
        this.connectCurrentPos = null;
        this.isSharedConnect = false;

        // Visual highlights
        this.highlightedRoute = null; // array of node IDs: ['node_pc1', 'node_sw1', ...]
        this.alternativePaths = [];
        this.currentAltIndex = 0;
        this.collidingLinkIds = new Set(); // Link IDs currently colliding
        this.activePacketMarkers = []; // Reference to moving packets rendered by simulation

        // Callbacks
        this.onSelectionChanged = options.onSelectionChanged || (() => {});
        this.onTopologyChanged = options.onTopologyChanged || (() => {});

        this.isInitialized = false;
        this.initCanvasDPI();
        this.bindEvents();
        this.loadDefault();
        this.isInitialized = true;
    }

    // Handle high DPI displays for crisp rendering
    initCanvasDPI() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const displayWidth = rect.width || this.canvas.clientWidth || 800;
        const displayHeight = rect.height || this.canvas.clientHeight || 380;

        this.canvas.width = Math.round(displayWidth * dpr);
        this.canvas.height = Math.round(displayHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = displayWidth;
        this.height = displayHeight;
    }

    resize() {
        this.initCanvasDPI();
        this.render();
    }

    loadDefault() {
        const def = getDefaultTopology(this.width || 800, this.height || 500);
        this.nodes = def.nodes;
        this.links = def.links;
        this.selectedNode = null;
        this.selectedLink = null;
        this.highlightedRoute = null;
        this.collidingLinkIds.clear();
        if (this.isInitialized) {
            this.onTopologyChanged();
        }
        this.render();
    }

    bindEvents() {
        // Track mouse down
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Touch support for tablets
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();
                const mouseEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => e.preventDefault()
                };
                this.handleMouseDown(mouseEvent);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();
                const mouseEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => e.preventDefault()
                };
                this.handleMouseMove(mouseEvent);
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            this.handleMouseUp(e);
        });
    }

    getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    getNodeAt(pos) {
        // Nodes have radius approx 26px
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            if (distance(pos, { x: node.x, y: node.y }) <= 28) {
                return node;
            }
        }
        return null;
    }

    getLinkAt(pos) {
        const threshold = 8;
        for (const link of this.links) {
            const n1 = this.getNodeById(link.from);
            const n2 = this.getNodeById(link.to);
            if (n1 && n2) {
                const d = pointToSegmentDistance(pos, { x: n1.x, y: n1.y }, { x: n2.x, y: n2.y });
                if (d <= threshold) {
                    return link;
                }
            }
        }
        return null;
    }

    handleMouseDown(e) {
        const pos = this.getCanvasPos(e);
        const clickedNode = this.getNodeAt(pos);

        if (this.mode === 'connect') {
            if (clickedNode) {
                if (!this.connectStartNode) {
                    this.connectStartNode = clickedNode;
                    this.connectCurrentPos = pos;
                } else if (this.connectStartNode.id !== clickedNode.id) {
                    // Create link between connectStartNode and clickedNode
                    this.addLink(this.connectStartNode.id, clickedNode.id, this.isSharedConnect);
                    this.mode = 'normal';
                    this.connectStartNode = null;
                    this.connectCurrentPos = null;
                }
                this.render();
            } else {
                // Cancel connection mode if clicking empty space
                this.mode = 'normal';
                this.connectStartNode = null;
                this.connectCurrentPos = null;
                this.render();
            }
            return;
        }

        if (clickedNode) {
            this.selectedNode = clickedNode;
            this.selectedLink = null;
            this.draggedNode = clickedNode;
            this.dragOffset = {
                x: clickedNode.x - pos.x,
                y: clickedNode.y - pos.y
            };
            this.onSelectionChanged(this.selectedNode, 'node');
            this.render();
            return;
        }

        const clickedLink = this.getLinkAt(pos);
        if (clickedLink) {
            this.selectedLink = clickedLink;
            this.selectedNode = null;
            this.onSelectionChanged(this.selectedLink, 'link');
            this.render();
            return;
        }

        // Clicked on empty space
        this.selectedNode = null;
        this.selectedLink = null;
        this.onSelectionChanged(null, null);
        this.render();
    }

    handleMouseMove(e) {
        const pos = this.getCanvasPos(e);

        if (this.mode === 'connect' && this.connectStartNode) {
            this.connectCurrentPos = pos;
            this.render();
            return;
        }

        if (this.draggedNode) {
            // Keep within bounds
            const padding = 35;
            this.draggedNode.x = Math.max(padding, Math.min(this.width - padding, pos.x + this.dragOffset.x));
            this.draggedNode.y = Math.max(padding, Math.min(this.height - padding, pos.y + this.dragOffset.y));
            this.render();
            return;
        }

        const hovered = this.getNodeAt(pos);
        if (hovered !== this.hoveredNode) {
            this.hoveredNode = hovered;
            this.canvas.style.cursor = hovered ? 'pointer' : 'default';
            this.render();
        }
    }

    handleMouseUp() {
        if (this.draggedNode) {
            this.draggedNode = null;
            this.onTopologyChanged();
        }
    }

    startConnectMode(isShared = false) {
        this.mode = 'connect';
        this.isSharedConnect = isShared;
        this.connectStartNode = null;
        this.connectCurrentPos = null;
        this.render();
    }

    cancelConnectMode() {
        this.mode = 'normal';
        this.connectStartNode = null;
        this.connectCurrentPos = null;
        this.render();
    }

    addNode(type, x, y) {
        const existingCount = this.nodes.filter(n => n.type === type).length + 1;
        let prefix = 'PC';
        let defaultIp = `192.168.1.${20 + existingCount}`;
        if (type === 'router') {
            prefix = 'Router';
            defaultIp = `10.0.${existingCount}.1`;
        } else if (type === 'switch') {
            prefix = 'Switch';
            defaultIp = `192.168.1.${existingCount}`;
        }

        const name = `${prefix}${existingCount}`;
        const node = {
            id: generateId('node'),
            type,
            name,
            ip: defaultIp,
            mac: `00:1A:2B:3C:0${Math.min(9, existingCount)}:0${Math.min(9, existingCount)}`,
            x: x || (this.width / 2 + (Math.random() * 80 - 40)),
            y: y || (this.height / 2 + (Math.random() * 80 - 40))
        };

        this.nodes.push(node);
        this.selectedNode = node;
        this.selectedLink = null;
        this.onSelectionChanged(node, 'node');
        this.onTopologyChanged();
        this.render();
        return node;
    }

    addLink(fromId, toId, isShared = false) {
        if (fromId === toId) return null;
        // Check if link already exists between these nodes
        const exists = this.links.some(l => 
            (l.from === fromId && l.to === toId) || 
            (l.from === toId && l.to === fromId)
        );
        if (exists) return null;

        const fromNode = this.getNodeById(fromId);
        const toNode = this.getNodeById(toId);
        if (!fromNode || !toNode) return null;

        const link = {
            id: generateId('link'),
            from: fromId,
            to: toId,
            isShared: isShared,
            channelName: isShared ? 'Shared Channel (Collision Domain)' : `PtP Link ${fromNode.name}-${toNode.name}`,
            bandwidth: isShared ? '100 Mbps' : '1 Gbps',
            delay: '2 ms'
        };

        this.links.push(link);
        this.selectedLink = link;
        this.selectedNode = null;
        this.onSelectionChanged(link, 'link');
        this.onTopologyChanged();
        this.render();
        return link;
    }

    deleteSelected() {
        if (this.selectedNode) {
            const nodeId = this.selectedNode.id;
            // Remove connected links
            this.links = this.links.filter(l => l.from !== nodeId && l.to !== nodeId);
            // Remove node
            this.nodes = this.nodes.filter(n => n.id !== nodeId);
            this.selectedNode = null;
            this.highlightedRoute = null;
            this.onSelectionChanged(null, null);
            this.onTopologyChanged();
            this.render();
            return true;
        } else if (this.selectedLink) {
            const linkId = this.selectedLink.id;
            this.links = this.links.filter(l => l.id !== linkId);
            this.selectedLink = null;
            this.highlightedRoute = null;
            this.onSelectionChanged(null, null);
            this.onTopologyChanged();
            this.render();
            return true;
        }
        return false;
    }

    getNodeById(id) {
        return this.nodes.find(n => n.id === id);
    }

    getLinkById(id) {
        return this.links.find(l => l.id === id);
    }

    getLinkBetween(id1, id2) {
        return this.links.find(l => 
            (l.from === id1 && l.to === id2) || 
            (l.from === id2 && l.to === id1)
        );
    }

    getConnectedLinks(nodeId) {
        return this.links.filter(l => l.from === nodeId || l.to === nodeId);
    }

    // Breadth-First Search (BFS) Routing
    // Computes shortest unweighted path (minimum hop count)
    findRouteBFS(sourceId, destId, excludedEdge = null) {
        if (!sourceId || !destId) {
            return { success: false, reason: 'Invalid source or destination node.' };
        }
        if (sourceId === destId) {
            return { success: false, reason: 'Source and Destination cannot be the same device.' };
        }

        const sourceNode = this.getNodeById(sourceId);
        const destNode = this.getNodeById(destId);
        if (!sourceNode || !destNode) {
            return { success: false, reason: 'Source or Destination device does not exist.' };
        }

        // Build adjacency graph
        const adj = new Map();
        for (const node of this.nodes) {
            adj.set(node.id, []);
        }

        for (const link of this.links) {
            if (excludedEdge && (
                (link.from === excludedEdge.from && link.to === excludedEdge.to) ||
                (link.from === excludedEdge.to && link.to === excludedEdge.from)
            )) {
                continue;
            }
            if (adj.has(link.from) && adj.has(link.to)) {
                adj.get(link.from).push(link.to);
                adj.get(link.to).push(link.from);
            }
        }

        // BFS Queue
        const queue = [[sourceId]];
        const visited = new Set([sourceId]);

        while (queue.length > 0) {
            const currentPath = queue.shift();
            const lastNodeId = currentPath[currentPath.length - 1];

            if (lastNodeId === destId) {
                const nodeObjects = currentPath.map(id => this.getNodeById(id));
                const hops = currentPath.length - 1;
                return {
                    success: true,
                    path: currentPath,
                    nodeObjects,
                    hops,
                    description: nodeObjects.map(n => n.name).join(' → ')
                };
            }

            const neighbors = adj.get(lastNodeId) || [];
            for (const neighborId of neighbors) {
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push([...currentPath, neighborId]);
                }
            }
        }

        return {
            success: false,
            reason: `No valid route between ${sourceNode.name} and ${destNode.name}.`
        };
    }

    // Discover alternative routes if available by pruning edges along the primary route
    findAlternativeRoutes(sourceId, destId) {
        const primary = this.findRouteBFS(sourceId, destId);
        if (!primary.success) return [];

        const altRoutes = [primary];
        // Try excluding each link along the primary path to find alternative paths
        for (let i = 0; i < primary.path.length - 1; i++) {
            const edge = { from: primary.path[i], to: primary.path[i + 1] };
            const alt = this.findRouteBFS(sourceId, destId, edge);
            if (alt.success) {
                // Check if already found
                const pathStr = alt.path.join('-');
                const alreadyFound = altRoutes.some(r => r.path.join('-') === pathStr);
                if (!alreadyFound) {
                    altRoutes.push(alt);
                }
            }
        }
        return altRoutes;
    }

    setHighlightedRoute(routeNodeIds) {
        this.highlightedRoute = routeNodeIds;
        this.render();
    }

    clearHighlightedRoute() {
        this.highlightedRoute = null;
        this.render();
    }

    setCollidingLink(linkId, isColliding = true) {
        if (isColliding) {
            this.collidingLinkIds.add(linkId);
        } else {
            this.collidingLinkIds.delete(linkId);
        }
        this.render();
    }

    clearCollisions() {
        this.collidingLinkIds.clear();
        this.render();
    }

    setPacketMarkers(markers) {
        this.activePacketMarkers = markers;
    }

    // ==========================================
    // Canvas Rendering Engine
    // ==========================================
    render() {
        const ctx = this.ctx;
        const width = this.width;
        const height = this.height;

        // Clear canvas with subtle grid background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Draw soft grid pattern
        this.drawGrid(ctx, width, height);

        // 1. Draw Links
        this.drawLinks(ctx);

        // 2. Draw Route Highlight overlay if active
        if (this.highlightedRoute && this.highlightedRoute.length >= 2) {
            this.drawRouteHighlight(ctx);
        }

        // 3. Draw Connecting line if in connect mode
        if (this.mode === 'connect' && this.connectStartNode && this.connectCurrentPos) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(this.connectStartNode.x, this.connectStartNode.y);
            ctx.lineTo(this.connectCurrentPos.x, this.connectCurrentPos.y);
            ctx.strokeStyle = this.isSharedConnect ? '#F59E0B' : '#2563EB';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
            ctx.restore();
        }

        // 4. Draw Moving Packets
        this.drawPackets(ctx);

        // 5. Draw Nodes
        for (const node of this.nodes) {
            this.drawNode(ctx, node);
        }

        // 6. Draw Helper Overlay / Connect Mode prompt
        if (this.mode === 'connect') {
            ctx.save();
            ctx.fillStyle = 'rgba(37, 99, 235, 0.9)';
            ctx.fillRect(15, 15, 290, 36);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '600 13px system-ui, sans-serif';
            ctx.fillText(
                this.connectStartNode 
                    ? `Click target device to connect ${this.isSharedConnect ? '(Shared)' : '(PtP)'}` 
                    : 'Click starting device to connect...',
                25, 38
            );
            ctx.restore();
        }
    }

    drawGrid(ctx, width, height) {
        ctx.save();
        ctx.strokeStyle = '#F1F5F9';
        ctx.lineWidth = 1;
        const gridSize = 24;

        ctx.beginPath();
        for (let x = 0; x <= width; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        for (let y = 0; y <= height; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    drawLinks(ctx) {
        for (const link of this.links) {
            const n1 = this.getNodeById(link.from);
            const n2 = this.getNodeById(link.to);
            if (!n1 || !n2) continue;

            const isSelected = this.selectedLink && this.selectedLink.id === link.id;
            const isColliding = this.collidingLinkIds.has(link.id);

            ctx.save();

            // Link path
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);

            if (isColliding) {
                // Severe collision highlight on link
                ctx.strokeStyle = '#DC2626';
                ctx.lineWidth = 6;
                ctx.shadowColor = 'rgba(220, 38, 38, 0.6)';
                ctx.shadowBlur = 12;
                ctx.stroke();
            } else if (isSelected) {
                ctx.strokeStyle = '#2563EB';
                ctx.lineWidth = 4;
                ctx.shadowColor = 'rgba(37, 99, 235, 0.4)';
                ctx.shadowBlur = 8;
                ctx.stroke();
            } else if (link.isShared) {
                // Shared medium link styling: golden amber with dashed accent
                ctx.strokeStyle = '#F59E0B';
                ctx.lineWidth = 4;
                ctx.stroke();

                ctx.strokeStyle = '#D97706';
                ctx.setLineDash([6, 5]);
                ctx.lineWidth = 1.8;
                ctx.stroke();
            } else {
                // Normal point-to-point link
                ctx.strokeStyle = '#94A3B8';
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            ctx.restore();

            // Draw link label (e.g. shared channel indicator or bandwidth badge)
            if (link.isShared || isSelected || isColliding) {
                const midX = (n1.x + n2.x) / 2;
                const midY = (n1.y + n2.y) / 2;
                
                ctx.save();
                ctx.font = '600 10px system-ui, sans-serif';
                const label = isColliding ? '⚡ COLLISION' : (link.isShared ? 'Shared Medium' : link.bandwidth);
                const textWidth = ctx.measureText(label).width;
                const boxW = textWidth + 12;
                const boxH = 18;

                ctx.fillStyle = isColliding ? '#FEE2E2' : (link.isShared ? '#FEF3C7' : '#EFF6FF');
                ctx.strokeStyle = isColliding ? '#DC2626' : (link.isShared ? '#D97706' : '#2563EB');
                ctx.lineWidth = 1;

                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 4);
                } else {
                    ctx.rect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
                }
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = isColliding ? '#B91C1C' : (link.isShared ? '#B45309' : '#1D4ED8');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, midX, midY);
                ctx.restore();
            }
        }
    }

    drawRouteHighlight(ctx) {
        ctx.save();
        ctx.strokeStyle = '#8B5CF6';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(139, 92, 246, 0.6)';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        for (let i = 0; i < this.highlightedRoute.length; i++) {
            const node = this.getNodeById(this.highlightedRoute[i]);
            if (!node) continue;
            if (i === 0) {
                ctx.moveTo(node.x, node.y);
            } else {
                ctx.lineTo(node.x, node.y);
            }
        }
        ctx.stroke();

        // Inner lighter stroke for neon tube effect
        ctx.strokeStyle = '#C4B5FD';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    drawNode(ctx, node) {
        const isSelected = this.selectedNode && this.selectedNode.id === node.id;
        const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
        const isInRoute = this.highlightedRoute && this.highlightedRoute.includes(node.id);

        ctx.save();

        // Outer glow/ring if selected or on highlighted route
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, 32, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
            ctx.fill();
            ctx.strokeStyle = '#2563EB';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        } else if (isInRoute) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, 30, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139, 92, 246, 0.15)';
            ctx.fill();
            ctx.strokeStyle = '#8B5CF6';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Node base shape
        const radius = 24;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

        // Color theme by type
        let bgGradient;
        let strokeColor;

        if (node.type === 'pc') {
            bgGradient = ctx.createLinearGradient(node.x - radius, node.y - radius, node.x + radius, node.y + radius);
            bgGradient.addColorStop(0, '#FFFFFF');
            bgGradient.addColorStop(1, '#EFF6FF');
            strokeColor = '#2563EB';
        } else if (node.type === 'router') {
            bgGradient = ctx.createLinearGradient(node.x - radius, node.y - radius, node.x + radius, node.y + radius);
            bgGradient.addColorStop(0, '#FFFFFF');
            bgGradient.addColorStop(1, '#F0FDF4');
            strokeColor = '#16A34A';
        } else if (node.type === 'switch') {
            bgGradient = ctx.createLinearGradient(node.x - radius, node.y - radius, node.x + radius, node.y + radius);
            bgGradient.addColorStop(0, '#FFFFFF');
            bgGradient.addColorStop(1, '#FFFBEB');
            strokeColor = '#D97706';
        }

        ctx.fillStyle = bgGradient;
        ctx.shadowColor = isHovered ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.08)';
        ctx.shadowBlur = isHovered ? 8 : 4;
        ctx.shadowOffsetY = 2;
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();

        // Draw Icon inside Node using Canvas primitives
        this.drawNodeIcon(ctx, node);

        // Node Name and IP Labels below
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Name badge
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#172033';
        ctx.fillText(node.name, node.x, node.y + radius + 7);

        // IP Label
        ctx.font = '10px monospace';
        ctx.fillStyle = '#64748B';
        ctx.fillText(node.ip, node.x, node.y + radius + 22);

        ctx.restore();
    }

    drawNodeIcon(ctx, node) {
        ctx.save();
        ctx.translate(node.x, node.y);

        if (node.type === 'pc') {
            // Monitor screen and stand
            ctx.fillStyle = '#2563EB';
            // Screen outer
            ctx.fillRect(-12, -11, 24, 16);
            // Screen inner
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(-10, -9, 20, 12);
            // Stand
            ctx.fillStyle = '#2563EB';
            ctx.fillRect(-3, 5, 6, 4);
            ctx.fillRect(-7, 9, 14, 2.5);
        } else if (node.type === 'router') {
            // Router 4 arrows pointing in/out
            ctx.strokeStyle = '#16A34A';
            ctx.fillStyle = '#16A34A';
            ctx.lineWidth = 1.8;

            // Horizontal cross
            ctx.beginPath();
            ctx.moveTo(-11, 0);
            ctx.lineTo(11, 0);
            ctx.moveTo(0, -11);
            ctx.lineTo(0, 11);
            ctx.stroke();

            // Arrowheads
            ctx.beginPath();
            // Right arrow
            ctx.moveTo(8, -3); ctx.lineTo(12, 0); ctx.lineTo(8, 3);
            // Left arrow
            ctx.moveTo(-8, -3); ctx.lineTo(-12, 0); ctx.lineTo(-8, 3);
            // Top arrow
            ctx.moveTo(-3, -8); ctx.lineTo(0, -12); ctx.lineTo(3, -8);
            // Bottom arrow
            ctx.moveTo(-3, 8); ctx.lineTo(0, 12); ctx.lineTo(3, 8);
            ctx.stroke();
        } else if (node.type === 'switch') {
            // Switch crossing arrows
            ctx.strokeStyle = '#D97706';
            ctx.lineWidth = 2;

            // Two arrows going right and left
            ctx.beginPath();
            ctx.moveTo(-10, -4);
            ctx.lineTo(10, -4);
            ctx.moveTo(7, -7); ctx.lineTo(10, -4); ctx.lineTo(7, -1);

            ctx.moveTo(10, 4);
            ctx.lineTo(-10, 4);
            ctx.moveTo(-7, 1); ctx.lineTo(-10, 4); ctx.lineTo(-7, 7);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPackets(ctx) {
        if (!this.activePacketMarkers || this.activePacketMarkers.length === 0) return;

        for (const pkt of this.activePacketMarkers) {
            ctx.save();
            ctx.translate(pkt.x, pkt.y);

            // Pulse or glow based on packet status
            let fillColor = '#2563EB'; // default Blue
            let strokeColor = '#1D4ED8';
            let label = pkt.label || `P${pkt.seqNum || ''}`;

            if (pkt.status === 'COLLISION') {
                fillColor = '#DC2626'; // Error Red
                strokeColor = '#991B1B';
                label = '⚡ BOOM';
            } else if (pkt.status === 'ACK') {
                fillColor = '#16A34A'; // Success Green
                strokeColor = '#15803D';
                label = pkt.label || `ACK ${pkt.ackNum || ''}`;
            } else if (pkt.status === 'RETRANSMIT') {
                fillColor = '#F59E0B'; // Warning Orange
                strokeColor = '#B45309';
            } else if (pkt.status === 'LOST') {
                fillColor = '#EF4444';
                strokeColor = '#B91C1C';
                label = '✕ LOST';
            }

            // Packet halo
            ctx.shadowColor = fillColor;
            ctx.shadowBlur = 8;

            // Rounded rectangle packet shape
            const width = Math.max(34, ctx.measureText(label).width + 12);
            const height = 18;

            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(-width / 2, -height / 2, width, height, 4);
            } else {
                ctx.rect(-width / 2, -height / 2, width, height);
            }
            ctx.fillStyle = fillColor;
            ctx.fill();

            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Packet text label
            ctx.shadowBlur = 0;
            ctx.font = 'bold 9.5px monospace';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 0, 1);

            ctx.restore();
        }
    }
}
