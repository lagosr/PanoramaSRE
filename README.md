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
*   **Dynamic 7-Domain SSL Dual-Probe:** Queries certificate validity concurrently over internal LAN IPs and external WAN Cloudflare edge, comparing local staging `.crt` files with live port `:443` certificates to detect drift or upcoming expiration across all 7 declaratively registered fleet devices (`Unifi_Cloud_Key_G2`, `Unifi_Protect_UNVR`, `HomeAssistant`, `Genmon`, `WebServicesHost`, `NanoStation_House`, `NanoStation_Shed`).
*   **Directory & Explorer Navigation:** Interactive clickable path banner for the base certificate repository (`D:\Google\My Drive\HomeApplicationData\WebServicesCertificates`) and per-device row links to launch Windows Explorer directly into each certificate staging subfolder.
*   **Headless Renewal & `UnifiCoreSync` Automation:** Invokes `Get-SSLCerts.ps1 -Unattended` under the `WSH_REMOTE_MUTATION` lock for single-device or fleet-wide Posh-ACME DNS-01 certificate renewals and deployments (including 6-layer forced-command SSH deployment and active UUID / PostgreSQL synchronization on UniFi OS consoles via `UnifiCoreSync`) with zero Windows elevation requirements.
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
*   **Workstation Key Inventory (`C:\Users\rodrigo\.ssh\`):**
    *   `rsa-key-deployment`: OpenSSH RSA private key for `WebServicesHost`, `Genmon`, `NanoStation_House`, and `NanoStation_Shed` (plus `rsa-key-deployment.ppk` for PuTTY sessions).
    *   `unifi-cloudkey-ssl` & `unifi-protect-ssl`: Dedicated per-appliance Ed25519 keys exclusively for `ui.panoramadr.com` and `protect.panoramadr.com`, bound to `/data/panorama-security/ssl-gatekeeper.sh`.
*   **Encrypted Google Drive DR Vault:** All workstation SSH keys and PuTTY session profiles in `C:\Users\rodrigo\.ssh\` are backed up in an OpenSSL 3 `AES-256-CBC` + `PBKDF2-HMAC-SHA512` (600,000 iterations) encrypted archive at `D:\Google\My Drive\RSA\panorama-ssh-vault.tar.gz.enc` (`Backup-SshVault.ps1` / `Restore-SshVault.ps1`; see `PanoramaDrSuite/tools/ssl-cert-manager/README.md`).
*   **Mandatory NTFS ACL Permissions:** Windows OpenSSH rejects private keys accessible by other users. File permissions must be strictly scoped via Windows PowerShell:
    ```powershell
    icacls "$env:USERPROFILE\.ssh\rsa-key-deployment" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
    icacls "$env:USERPROFILE\.ssh\unifi-cloudkey-ssl" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
    icacls "$env:USERPROFILE\.ssh\unifi-protect-ssl" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
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
├── certs/                                   # Public Authenticode code signing certificates
│   └── PanoramaDrSuite-CodeSigning.cer      # Public RSA-4096 SHA-256 Code Signing Certificate
├── scripts/                                 # Host probes, Authenticode signing & build scripts
│   ├── Setup-CodeSigningCert.ps1            # RSA-4096 SHA-256 self-signed code signing PKI provisioner
│   ├── sign-binary.ps1                      # Automated Authenticode binary/installer signing hook
│   ├── Verify-Authenticode.ps1              # Post-build Authenticode signature & store verifier
│   ├── probe_ssl_dual.ps1                   # Dual-probe TLS certificate query script
│   ├── run-pester-json.ps1                  # Pester unit test JSON output adapter
│   ├── sync-build-info.mjs                  # Build metadata & portable signCommand path stamper
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

## 🛡️ Windows Authenticode Code Signing & Zero-UAC Installer Pipeline

Because **PanoramaSRE** runs as a standard unprivileged user (`rodrigo`) to preserve direct access to workstation DPAPI secrets (`.cf-token.enc`), `HKCU` SSH/PuTTY keys, Docker Desktop contexts, and user-scoped npm/Git credentials, its installer and desktop binaries are engineered for **Zero-UAC Per-User Installation** paired with **Automated RSA-4096 SHA-256 Authenticode Code Signing**.

### 1. Why NSIS `currentUser` Exclusively (No `.msi` Per-Machine Target)
*   **Zero UAC Elevation (`installMode: "currentUser"`):** Configured with `"targets": ["nsis"]` and `"nsis": { "installMode": "currentUser" }` in `src-tauri/tauri.conf.json`. The generated NSIS installer compiles with `RequestExecutionLevel user` and installs cleanly into `%LOCALAPPDATA%\PanoramaSRE` without triggering a Windows User Account Control (UAC) administrator prompt.
*   **Elimination of Legacy WiX `.msi` UAC Conflicts:** Tauri's WiX `.msi` bundler hardcodes `InstallScope="perMachine"` (`C:\Program Files\PanoramaSRE`). Furthermore, if a per-machine `.msi` was ever installed in `HKLM`, Tauri's NSIS template (`FindWixInstall`) detects the `HKLM` uninstall key and spawns `MsiExec.exe /X{GUID}` during upgrades—triggering an unexpected UAC prompt even in a `currentUser` installer. Restricting `"targets": ["nsis"]` guarantees 100% unprivileged, UAC-free installations and upgrades.

### 2. End-to-End Build & 4-Stage Authenticode Signing Flow

```text
+-----------------------------------------------------------------------------------+
| 1. npm run prebuild (scripts/sync-build-info.mjs)                                 |
|    - Stamps version + Git build ID into window title                              |
|    - Resolves portable absolute path for scripts/sign-binary.ps1 in tauri.conf    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 2. cargo build --release & tauri-bundler (NSIS x64)                               |
|    - Stage A: Signs src-tauri/target/release/panorama-sre.exe                     |
|    - Stage B: Signs NSIS helper plugin DLLs (nsis_tauri_utils.dll)                |
|    - Stage C: Invokes !uninstfinalize hook to sign generated uninstall.exe        |
|    - Stage D: Signs final PanoramaSRE_<version>_x64-setup.exe installer           |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 3. npm run cert:verify (scripts/Verify-Authenticode.ps1)                          |
|    - Re-signs restored standalone target/release/panorama-sre.exe on disk         |
|    - Verifies Authenticode signatures & TrustedPublisher presence (Exit Code 0)   |
+-----------------------------------------------------------------------------------+
```

### 3. Code Signing Scripts & `tauri-bundler` Integration
*   **`scripts/Setup-CodeSigningCert.ps1` (`npm run cert:setup`):**
    *   Idempotently checks `Cert:\CurrentUser\My` for an active code signing certificate matching `CN=PanoramaDrSuite, O=PanoramaDrSuite` with $> 30\text{ days}$ validity remaining.
    *   If absent (or `-Force` is passed), provisions a 5-year **RSA-4096 SHA-256** self-signed `CodeSigningCert` (`2.5.29.37={text}1.3.6.1.5.5.7.3.3`), exports the public certificate to `certs/PanoramaDrSuite-CodeSigning.cer`, and imports it into `Cert:\CurrentUser\TrustedPublisher` and `Cert:\CurrentUser\Root` (supports `-SkipRootPrompt` for non-interactive CI/background builds).
*   **`scripts/sign-binary.ps1`:**
    *   Automatically locates the latest Windows 10/11 SDK `x64\signtool.exe` (or `$env:SIGNTOOL_PATH`) and the active `PanoramaDrSuite` certificate in `Cert:\CurrentUser\My` (auto-invoking `Setup-CodeSigningCert.ps1 -SkipRootPrompt` if needed).
    *   Executes `signtool.exe sign /sha1 <Thumbprint> /fd sha256 /tr "http://timestamp.digicert.com" /td sha256 /d "PanoramaSRE Control Plane" <FilePath>`, with automatic fallback to offline SHA-256 signing if the RFC 3161 timestamp server is unreachable.
    *   **Standalone `"%1"` Contract:** Tauri v2's `tauri-bundler` substitutes `"%1"` only when it appears as an exact standalone element in `bundle.windows.signCommand.args`, and `makensis.exe` executes `!uninstfinalize` from `src-tauri/target/release/nsis/x64/`. To remain immune to working-directory shifts across machines, `scripts/sync-build-info.mjs` dynamically writes the resolved host path of `scripts/sign-binary.ps1` into `tauri.conf.json` prior to every build.
*   **`scripts/Verify-Authenticode.ps1` (`npm run cert:verify`):**
    *   Because `tauri-bundler` temporarily patches `panorama-sre.exe` with `__TAURI_BUNDLE_TYPE="nsis"`, signs it, packs it into the setup `.exe`, and then restores the unpatched `panorama-sre.exe` backup on disk after `makensis` finishes, `Verify-Authenticode.ps1` automatically signs the restored standalone `src-tauri/target/release/panorama-sre.exe` if `NotSigned` and verifies that both the standalone binary and latest `PanoramaSRE_*_x64-setup.exe` installer carry valid `CN=PanoramaDrSuite` Authenticode signatures.

---

## 🚀 Development & Testing Guide

### Prerequisites
*   **Operating System:** Windows 11 (`x86_64`)
*   **Node.js:** v20+ or v22+
*   **Rust & Cargo:** Modern stable Rust (`rustup default stable`)
*   **Build Tools:** Microsoft C++ Build Tools & Windows 10/11 SDK (`signtool.exe`)
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
3.  **Execute Automated Frontend & PowerShell Tests:**
    ```powershell
    npm run test:all
    ```
4.  **Verify Rust Backend Compilation:**
    ```powershell
    cargo check --manifest-path src-tauri/Cargo.toml
    ```
5.  **Run Native Desktop Application in Development:**
    ```powershell
    npm run tauri dev
    ```
6.  **Provision Code Signing Certificate & Compile Signed Production Installer:**
    ```powershell
    # One-time setup: generates RSA-4096 cert & installs into CurrentUser\TrustedPublisher & Root
    npm run cert:setup

    # Build & Authenticode-sign the per-user NSIS installer
    npm run tauri build

    # Verify Authenticode signatures on standalone binary & NSIS setup.exe
    npm run cert:verify
    ```
    *Produces the signed, zero-UAC per-user installer `src-tauri/target/release/bundle/nsis/PanoramaSRE_<version>_x64-setup.exe`.*
