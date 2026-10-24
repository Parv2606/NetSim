# NetSim — Interactive Network Communication Simulator

An interactive, browser-based Computer Networks simulator built with vanilla web technologies (HTML5 Canvas, CSS3, JavaScript ES modules).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Vanilla JS](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)
![HTML5](https://img.shields.io/badge/HTML5-Canvas-orange.svg)
![GitHub Pages](https://img.shields.io/badge/Deployed%20with-GitHub%20Pages-brightgreen.svg)

---

## 🌟 Key Features

1. **Breadth-First Search (BFS) Routing**: Dynamically discovers shortest transmission paths across custom or pre-configured topologies.
2. **TCP Connection Establishment**: Visualizes the Three-Way Handshake (`SYN` ➔ `SYN-ACK` ➔ `ACK`) with state timeline progression.
3. **Reliable Transport Transmission**: Demonstrates sequence numbers, positive ACKs, and timeout/retransmission recovery.
4. **Collision Simulation & CSMA/CD**: Shared-medium channel occupancy collision tracking with randomized exponential backoff recovery.
5. **Interactive Network Canvas**:
   - Drag-and-drop node positioning (PCs, Switches, Routers).
   - Dynamic link creation and full-duplex / shared-medium toggling.
   - Real-time packet animation with distinct protocol colors.
6. **Live Dashboard & Event Log**: Real-time throughput metrics, latency monitoring, packet success rates, and timestamped packet logs.

---

## 🚀 Live Demo

You can view the live simulation directly in your browser:
> **https://parv2606.github.io/NetSim/**

*(Follow the deployment steps below to activate GitHub Pages on your repository).*

---

## 🛠️ Project Architecture

```
.
├── index.html         # Main dashboard, UI controls, and canvas container
├── style.css          # Design system, responsive layout, and modern light theme
├── script.js          # Main UI controller, event bindings, and DOM orchestration
├── simulation.js      # Discrete-event simulation engine (TCP handshake, ACKs, CSMA/CD)
├── topology.js        # Graph data structure, canvas renderer, BFS pathfinding
├── utils.js           # Math helpers, distance algorithms, and formatting utilities
├── explanation.txt    # In-depth architectural explanation and viva reference guide
└── README.md          # Project documentation
```

---

## 💻 Running Locally

No node modules, backend server, or build steps required!

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Parv2606/NetSim.git
   cd NetSim
   ```
2. Open `index.html` in any modern web browser:
   - Double click `index.html`, or
   - Use VS Code Live Server / Python simple server:
     ```bash
     python -m http.server 8000
     ```
   - Open `http://localhost:8000` in your browser.

---

## 🌐 Deploying to GitHub Pages

Because this project is built entirely on client-side web technologies, it can be hosted for free on **GitHub Pages**:

1. **Push your code to GitHub** (see instructions below).
2. Go to your repository on [GitHub](https://github.com).
3. Click on **Settings** (gear icon near top right).
4. In the left navigation menu, click **Pages** (under the "Code and automation" section).
5. Under **Build and deployment** > **Source**, choose **Deploy from a branch**.
6. Set branch to `main` (or `master`) and directory to `/(root)`.
7. Click **Save**.
8. Wait ~30 to 60 seconds, then refresh the page. Your live site URL will be displayed at the top!

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
