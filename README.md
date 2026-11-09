# 🖥️ PanoramaSRE: Desktop Control Plane, Release Provenance & Local Dev Orchestrator

**PanoramaSRE** is the native Windows 11 desktop Site Reliability Engineering (SRE) control plane, live telemetry monitor, release provenance tracker, and local development orchestrator for the **PanoramaDrSuite** ecosystem:
*   🔑 **PanoramaAuth** (`/auth`, Port 3000)
*   💳 **SpendyLedger** (`/spendy`, Port 3001)
*   🧬 **BiomedMaven** (`/biomed`, Port 3002)
*   💧 **WaterAnalyzer** (`/water`, Port 3003)
*   🧺 **TastyBasket** (`/basket`, Port 3004)
*   📦 **PanoramaResources** (`/res`, Port 4000)

PanoramaSRE bridges local workstation engineering with remote production operations on the Raspberry Pi 5 Web Services Host (`wsh.panoramadr.com`), providing continuous background observability, cryptographic Git provenance diffing, automated batch deployments with circuit breakers, and 1-click SQLite database hydration.

---

## ⚡ Core Technical Stack

| Layer | Technology | Key Capabilities |
| :--- | :--- | :--- |
| **Desktop Core** | **Tauri v2** (`rustc` 2021, Tokio async) | Native Windows 11 OS integration, System Tray lifecycle, child process management, native notifications, and SQLite event persistence. |
| **Frontend Framework** | **React 19** & **TypeScript** (Strict) | Modern component architecture, React Server/Client compatibility, zero `any` types. |
| **Styling & Theme** | **Tailwind CSS v4** (`@theme`, CSS-first) | Canonical slate/emerald design tokens, native dark/light theme engine (`@custom-variant dark`), Google Material contrast compliance. |
| **Tooling & Build** | **Vite 6** & **Vitest 2.1** | Sub-second HMR, fast compilation, isolated Vitest runner pool. |
| **Local Database** | **rusqlite** (`data/sre.sqlite`) | Local persistent audit logs, console session storage, and SRE state ledger. |

---

## 🏛️ System Architecture & Core Capabilities

```text
                                  +------------------------------------------+
                                  |         Windows 11 Workstation           |
                                  |                                          |
                                  |       +--------------------------+       |
                                  |       |       PanoramaSRE        |       |
                                  |       | (Tauri v2 + React 19 UI) |       |
                                  |       +------------+-------------+       |
                                  |                    |                     |
                       +----------+----------+---------+---------+-----------+
                       |                     |                   |           |
            +----------v----------+ +--------v--------+ +--------v-------+   |
            | Zero-Code Discovery | | Local Dev Sup.  | | OpenSSH Runner |   |
            | (panorama.app.json) | | (:3000 - :3004) | | (ssh.exe/scp)  |   |
            +---------------------+ +-----------------+ +--------+-------+   |
                                                                 |           |
                                                                 |           |
+----------------------------------------------------------------|-----------+
| Network Ingress (Split-DNS LAN / Cloudflare Tunnel WAN)        |
+----------------------------------------------------------------|-----------+
                                                                 v
                                             +-----------------------------------+
                                             |  Web Services Host (DietPi RPi 5) |
                                             |         wsh.panoramadr.com        |
                                             |                                   |
                                             |  +-------------+  +-------------+ |
                                             |  |  Lighttpd   |  | Docker Host | |
                                             |  | (Port :443) |  |  (Compose)  | |
                                             |  +-------------+  +-------------+ |
                                             +-----------------------------------+
```

### 1. Command HUD & Appliance Strip
*   **Fleet Application Cards:** Real-time health monitoring of all child applications via `/api/health`, showing latency sparklines, release IDs, schema versions, local dev states, and last backup timestamps.
*   **Live Git Drift Badges:** Real-time ancestry calculation comparing local `HEAD` Git commit SHA against production container commit SHA:
    *   `IN SYNC` (Emerald): Production matches local HEAD cleanly.
    *   `AHEAD BY N` (Sky): Local repository has $N$ unpushed or undeployed commits ready to ship.
    *   `BEHIND BY N` (Red): Local working branch is missing commits deployed in production.
    *   `LOCAL WIP` (Amber): Uncommitted local changes detected in working tree.
*   **Home Lab Appliance Health:** Live connectivity and SSL drift checks for UniFi Network (`ui.panoramadr.com`), UniFi Protect (`protect.panoramadr.com`), Home Assistant (`ha.panoramadr.com`), and Genmon (`genmon.panoramadr.com`).
*   **WSH Vitals:** CPU load, RAM usage, storage volume capacity, and Raspberry Pi 5 SoC thermals decoded from `vcgencmd`.

### 2. Git-Backed Release Provenance & Batch Deployment
*   **Release Composition Diffing:** Inspects commits pending deployment, detecting blast-radius indicators:
    *   `DB_MIGRATION`: Triggered if `migrations/` contains new schema changes.
    *   `ENV_CONTRACT`: Triggered if `.env.production` or `.env.local.keys` contains added keys.
    *   `AUTH_SECURITY`: Triggered if auth token verification or SSO routes were modified.
*   **Sequential Batch Deployer:** Multi-app deployment orchestrator executing deployments in dependency order (e.g. `PanoramaAuth` first, followed by child applications).
*   **Automatic Circuit Breaker & Halt Button:** If any application in a batch deployment fails health checks or exits with an error code, the pipeline **immediately halts**, tripping the circuit breaker to prevent cascading failures.
*   **Sub-5-Second Instant Rollbacks:** Interacts with `/var/data/<slug>/releases.json` on WSH to roll back containers to retained `N-3` images via `-RollbackToTag <tag>` in seconds.

### 3. Local Dev Supervisor & SQLite Backup Hydrator
*   **Dev Server Supervisor:** Starts, stops, and monitors local dev server processes (`npm run dev`), tracking child PIDs, listening ports, and stdout/stderr streams.
*   **Co-Dependent Launch (`[Start Auth + App]`):** Starts `PanoramaAuth` (:3000) concurrently with any target child app (:3001+) for seamless local SSO testing.
*   **Interactive SQLite Hydrator (`ApplyLocal`):** Scans workstation backup directories (`D:\Google\My Drive\HomeApplicationData\DatabaseBackups`), verifies schema compatibility, and extracts production SQLite databases directly into the local `data/` folder with safe file locking.

### 4. Edge PKI & SSL Dual-Probe Engine
*   **Dynamic SSL Dual-Probe:** Queries certificate validity concurrently over internal LAN IPs and external WAN Cloudflare edge, comparing local staging `.crt` files with live port `:443` certificates to detect drift or upcoming expiration across all declaratively registered devices (`Unifi_Cloud_Key_G2`, `Unifi_Protect_UNVR`, `HomeAssistant`, `Genmon`, `WebServicesHost`).
*   **Directory & Explorer Navigation:** Interactive clickable path banner for the base certificate repository (`D:\Google\My Drive\HomeApplicationData\WebServicesCertificates`) and per-device row links to launch Windows Explorer directly into each certificate staging subfolder.
*   **Headless Renewal:** Invokes `Get-SSLCerts.ps1 -Unattended` under the `WSH_REMOTE_MUTATION` lock for single-device or fleet-wide Posh-ACME DNS-01 certificate renewals with zero Windows elevation requirements.
*   **Cloudflare Zero Trust Tunnel:** Monitors `cloudflared` QUIC tunnel connections, connector version differences, and Google OIDC family access policies.

### 5. Backups & Disaster Recovery Matrix
*   **GFS Backup Ledger:** Analyzes `backup_history.json`, displaying retention timelines across Grandfather-Father-Son schedules (daily, weekly, monthly).
*   **Disaster Recovery Incident Reporting:** Surfaces failed backup runs, storage exhaustion warnings, and automated recovery steps.
*   **Drive Mirroring:** Monitors workstation Robocopy mirror operations (`D:\` $\rightarrow$ `E:\`).

### 6. Dynamic WSH Portal Generator (`portal-generator.ts`)
*   Generates `index-local.html` (LAN administrator portal with Portainer and telemetry) and `index-remote.html` (sanitized public catalog) directly from discovered `panorama.app.json` manifests.
*   Uses deterministic HTML marker blocks (`<!-- APP_CARDS_START --> ... <!-- APP_CARDS_END -->`) to update app cards without destroying layout styling or custom scripts.

---

## 🔒 Strict Single Source of Truth (SSOT) Architecture

PanoramaSRE enforces a zero-hardcoding policy. The application dynamically scans sibling directories in `C:\Users\rodrigo\Documents\AG Projects\` to discover services and operational tools:

### Authoritative Manifests
1.  **Application Manifest (`panorama.app.json`):**
    *   Defines `appId`, `slug`, `displayName`, `portalTitle`, `basePath`, TCP `port`, `containerName`, `remoteAppRoot`, `dataVolume`, `localSqlitePath`, `themeColor`, Lucide `icon`, and `sre` automation commands.
    *   Adheres strictly to `PanoramaResources/public/schemas/panorama.app.schema.json`.
2.  **SRE Tool Manifest (`panorama.tool.json`):**
    *   Defines operational scripts (`script`), categories (`edge`, `pki`, `portal`, `backup`, `storage`), and action configurations (`args`, `lock`, `elevated`, `destructive`).
    *   Adheres strictly to `PanoramaResources/public/schemas/panorama.tool.schema.json`.

### Configuration Hierarchy
```text
Tier 1: Architectural SSOT           ──> panorama.app.json
Tier 2: Production Environment       ──> .env.production (APP_URL, APP_DOMAIN, PORT)
Tier 3: Local Development            ──> .env.local (PORT, NODE_ENV)
Tier 4: Runtime Secrets & Keys       ──> .env.local.keys (SESSION_SECRET, Twilio, SendGrid)
Tier 5: Deployment Credentials       ──> .env.deploy (DEPLOY_USER, DEPLOY_HOST, SSH_KEY_PATH)
```

---

## 🔑 Windows OpenSSH Authentication Standard

PanoramaSRE and all underlying PowerShell scripts authenticate using **native Windows OpenSSH**:

*   **System Binaries:** `C:\Windows\System32\OpenSSH\ssh.exe` and `scp.exe`.
*   **Key Location:** Standard OpenSSH-formatted private key (e.g. `C:\Users\rodrigo\.ssh\rsa-key-deployment`), NOT legacy `.ppk` files.
*   **Mandatory NTFS ACL Permissions:** Windows OpenSSH rejects private keys accessible by other users. File permissions must be strictly scoped via Windows PowerShell:
    ```powershell
    icacls "$env:USERPROFILE\.ssh\rsa-key-deployment" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
    ```
*   **Non-Interactive Execution:** Commands execute in batch mode:
    ```powershell
    ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -i <KeyPath> root@wsh.panoramadr.com <Command>
    ```
*   **PuTTY Fallback:** If `ssh.exe` is absent or if a `.ppk` key is supplied, scripts automatically fall back to PuTTY `plink.exe`/`pscp.exe`. PanoramaSRE includes Pageant status detection (`check_pageant_status`) and launching tools for legacy support.

---

## 🚦 Concurrency Model & Resource Mutex Locks

To prevent race conditions, corrupted file staging, and workstation CPU exhaustion, the Rust backend manages an asynchronous FIFO job queue with mutual exclusion locks:

| Lock Name | Scope & Purpose | Conflicting Actions Blocked |
| :--- | :--- | :--- |
| `WSH_REMOTE_MUTATION` | Protects remote host `/opt/` and `/etc/` directories on `wsh.panoramadr.com`. | Concurrent container deployments, SSL certificate deployments, portal staging, and server reboots. |
| `WORKSTATION_DRIVE_MIRROR` | Protects workstation backup target drives (`D:\`, `E:\`). | Concurrent Robocopy mirror runs (`backup_processor.ps1`). |
| `DOCKER_BUILDX` | Serializes local ARM64 Docker cross-compilations. | Running multiple concurrent `docker buildx` processes. |
| `NONE` | Non-mutating read-only actions. | Allowed to execute concurrently (status checks, auth tests). |

---

## 🗂️ Repository Structure

```text
PanoramaSRE/
├── package.json                             # Dependencies & build scripts (React 19, Tailwind v4, Vite 6)
├── tsconfig.json                            # Strict TypeScript compiler options
├── vite.config.ts                           # Vite configuration with @tailwindcss/vite plugin
├── vitest.config.ts                         # Vitest test runner configuration
├── index.html                               # HTML root template
├── public/                                  # Static branding assets
├── scripts/                                 # Host probes & build synchronization scripts
│   ├── probe_ssl_dual.ps1                   # Dual-probe TLS certificate query script
│   ├── run-pester-json.ps1                  # Pester unit test JSON output adapter
│   ├── sync-build-info.mjs                  # Build metadata stamper (timestamp, git revision)
│   ├── Test-PanoramaSREStartup.ps1          # Cold start verification script
│   └── wsh_snapshot.sh                      # Stateless read-only DietPi host & docker probe
├── src/                                     # React 19 Frontend
│   ├── App.tsx                              # Main application container & view router
│   ├── globals.css                          # Tailwind CSS v4 CSS-first design tokens & dark variant
│   ├── main.tsx                             # React entrypoint
│   ├── context/                             # Global application contexts
│   │   └── ThemeContext.tsx                 # Dark/Light theme provider with Material contrast
│   ├── components/                          # UI views and modular controls
│   │   ├── hud/                             # Command HUD & Fleet App Cards
│   │   ├── releases/                        # Release Pipeline, Composition Drawer & Batch Modal
│   │   ├── local-dev/                       # Dev Server Cards & Backup Hydrator Panel
│   │   ├── dietpi/                          # DietPi Host View, APT Table & Service Controls
│   │   ├── edge/                            # Cloudflare Tunnel & SSL Dual Probe Table
│   │   ├── backups/                         # GFS Backup Ledger & Disaster Recovery View
│   │   ├── topology/                        # Ecosystem Topology Stacks View
│   │   ├── settings/                        # 4-Tab Settings View
│   │   ├── layout/                          # Sidebar, Status Bars & Emerald Terminal Drawer
│   │   └── ui/                              # ConfirmDangerModal, CustomSelect, ProvenanceBadge
│   └── lib/                                 # Core client utilities and adapters
│       ├── formatters.ts                    # parseUtcDate, bytes, and duration formatters
│       ├── portal-generator.ts              # Deterministic WSH portal generator
│       ├── process-runner.ts                # Tauri IPC streaming command bridge
│       ├── script-adapters.ts               # CLI binders for PowerShell automation tools
│       ├── types.ts                         # Strict TypeScript type definitions
│       ├── version.ts                       # SemVer & Git SHA provenance comparators
│       └── __tests__/                       # Comprehensive Vitest test suites (28 tests)
└── src-tauri/                               # Tauri v2 (Rust Backend)
    ├── Cargo.toml                           # Rust dependencies (Tokio, Rusqlite, Serde, Reqwest)
    ├── tauri.conf.json                      # Tauri v2 window, tray, and plugin configurations
    └── src/
        ├── main.rs                          # Desktop application entrypoint
        ├── lib.rs                           # IPC command registration and lifecycle setup
        ├── db.rs                            # Rusqlite SreDatabase initialization (data/sre.sqlite)
        ├── dev_supervisor.rs                # Child dev process supervision & port monitoring
        ├── job_manager.rs                   # FIFO job execution queue and mutex locks
        ├── notifications.rs                 # Native Windows toast notification dispatcher
        ├── scheduler.rs                     # 3-Tier configurable live telemetry scheduler
        ├── scrubber.rs                      # Real-time sensitive credential log scrubber
        ├── tray.rs                          # Windows System Tray setup and event handling
        └── commands/                        # Tauri IPC Command Handlers
            ├── dietpi_ops.rs                # SSH snapshot, APT update, service restart, reboot
            ├── git_ops.rs                   # Git SHA ancestry, dirty tree check, composition diff
            ├── ledger.rs                    # GFS backup ledger queries & statistics
            ├── local_backups.rs             # Local backup archive scanner & key verification
            ├── log_ops.rs                   # SQLite system audit logs & console sessions
            ├── monitor.rs                   # Network posture detection, /api/health probes
            ├── runner.rs                    # Streaming PowerShell/Node process runner with abort
            ├── ssl_ops.rs                   # SSL certificate dual probes & expiry calculation
            └── workspace.rs                 # Sibling app discovery & manifest validation
```

---

## 🚀 Development & Testing Guide

### Prerequisites
*   **Operating System:** Windows 11 (`x86_64`)
*   **Node.js:** v20+ or v22+
*   **Rust & Cargo:** Modern stable Rust (`rustup default stable`)
*   **Build Tools:** Microsoft C++ Build Tools (installed with Visual Studio or Visual Studio Build Tools)
*   **OpenSSH:** Windows OpenSSH client installed (`ssh.exe` and `scp.exe`)

### Setup & Launch
1.  **Install Node dependencies:**
    ```powershell
    npm install
    ```
2.  **Run Frontend in Browser Mode:**
    ```powershell
    npm run dev
    ```
3.  **Execute Automated Frontend Tests:**
    ```powershell
    npm run test
    ```
4.  **Verify Rust Backend Compilation:**
    ```powershell
    cargo check --manifest-path src-tauri/Cargo.toml
    ```
5.  **Run Native Desktop Application in Development:**
    ```powershell
    npm run tauri dev
    ```
6.  **Compile Production Desktop Application:**
    ```powershell
    npm run tauri build
    ```
    *Builds production `.exe` installer (NSIS) and `.msi` package in `src-tauri/target/release/bundle/`.*
