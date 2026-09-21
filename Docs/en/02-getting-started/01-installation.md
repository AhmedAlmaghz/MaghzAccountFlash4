# Installation — User Guide

> Installing MaghzAccountPro on the desktop (an Electron application for Windows) and reaching the first screen.

## Overview

MaghzAccountPro runs as a standalone desktop application built on Electron technology — it needs no browser and no web server. After installation you only need to choose where to store your data (the database), and then the First-Run Setup Wizard takes you step by step.

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| Operating system | Windows 10 (64-bit) or later | Also runs on Windows 11 |
| Memory | 4 GB | 8 GB recommended with multiple users |
| Disk space | 500 MB for the app + data space | Grows as your business activity grows |
| PostgreSQL server | Optional | Only if you choose the centralized server mode — see below |

## Before Installing — Quick Checklist

| Question | If the answer is "Yes" |
|---|---|
| Will more than one machine work on the same data? | Prepare a PostgreSQL server in advance on the central machine and keep the connection details |
| Is this a production machine or a trial machine? | A trial machine is perfect for demo data — don't mix training data with production data |
| Do you have a backup from a previous database? | You can restore it after installation from Settings ← Backup |
| Does your Windows user have permission to install software? | Installation requires Administrator privileges on Windows |

## Installation Steps

1. Obtain the Windows installer from whoever distributes it within your organization (for example a `Setup.exe` file).
2. Double-click the installer. A Windows SmartScreen warning may appear if the application is not digitally signed — click "More info" and then "Run anyway".
3. Follow the installation wizard: choose the installation folder (the default suits most cases) and click "Install".
4. When finished, click "Finish". A MaghzAccountPro shortcut is created on the desktop and in the Start menu.
5. Launch the application from the shortcut. The welcome screen appears, followed by the **First-Run Setup Wizard** — see `02-first-run-wizard.md` for details.

## Choosing a Database — The Two Options

In step two of the Setup Wizard the system asks: where should your data be stored? You have two options:

### Option 1: Built-in PGlite (Single Machine)

A PostgreSQL database running inside the application itself (PostgreSQL WASM) — **you don't need to install any server**.

| Property | Detail |
|---|---|
| Installation | Nothing extra — click the option and press "Test Connection" to confirm |
| Data location | Stored locally on your machine |
| Best for | One machine with a single user or a few users — a small shop, an office, or trying the system |
| Sharing | Another user on another machine cannot see the same data |

### Option 2: External PostgreSQL (Central Server)

A connection to a PostgreSQL server installed on a machine in your local network or a cloud server — **supports multiple users sharing the same data**.

| Field | Description | Example |
|---|---|---|
| Host | The address of the machine running the server | `192.168.1.10` or `localhost` |
| Port | The server port — default is 5432 | `5432` |
| Database name | The name of the database to be created/used | `maghzaccount` |
| Username | An authorized PostgreSQL user | `postgres` |
| Password | The PostgreSQL user's password | — |

After entering the details press **"Test Connection"** — a success message showing the database name and server version must appear before you continue. If the test fails, check the error table below; do not proceed before it succeeds.

| Property | Detail |
|---|---|
| Installation | Requires PostgreSQL pre-installed on the machine/server (version 14+ recommended) |
| Data location | On the server — centralized backups are possible |
| Best for | A business with several machines: the cashier, the accountant, and management all see the same data in real time |

### Which Option Suits Me?

| Your situation | Recommended option |
|---|---|
| Trying the system for the first time | Built-in PGlite |
| One machine, one user | Built-in PGlite |
| Several machines in the same shop/network | External PostgreSQL |
| I want centralized backups from a single server | External PostgreSQL |

You can start with PGlite and move later to a PostgreSQL server by re-running the Setup Wizard (see `02-first-run-wizard.md` — section "Re-running the Setup Wizard").

## Multiple Machines on One Network? (PostgreSQL Mode)

If you chose the central server, these are the general steps on the machine that will host the database:

1. Install PostgreSQL on the central machine and save the main user's password.
2. Create an empty database dedicated to the system (example: `maghzaccount`).
3. Make sure the server accepts connections from the local network, and add a firewall exception for it.
4. On each client machine: install the application, and in step 2 of the wizard choose "PostgreSQL server" and enter the central machine's address (Host) with the remaining details, then "Test Connection".

> Each client machine stays without local data — the server is the single source of truth, making backup a single, central point.

## First Launch

When you open the application for the first time:

1. The **welcome screen** appears immediately (you won't be asked to log in yet — no users exist yet).
2. The **5-step Setup Wizard** starts: Welcome ← Database ← Company Information ← Initial Data ← Finish.
3. At the end of the wizard you create/generate the admin (`admin`) password — **store it carefully**, it is your key into the system.

If this is not the first run and you have previous data, the session resumes automatically and you go straight to the login screen.

## Common Errors & Fixes

| Message/Problem as shown | Cause | Solution |
|---|---|---|
| "Connection test failed" when choosing PostgreSQL | The server is not running or the connection details are wrong | Make sure the PostgreSQL service is running, and check the Host/Port/database name/username/password |
| "Connection test failed — connection refused" | Wrong port or the firewall is blocking | Try the default port 5432 and add a firewall exception for PostgreSQL |
| A message about wrong username/password | These are PostgreSQL credentials, not system login credentials | These are database server credentials — ask whoever set up the server |
| SmartScreen blocks the installation | The application is not digitally signed | "More info" ← "Run anyway" |
| The app opens to a blank screen or doesn't respond | A temporary display issue | Close the application from the taskbar and reopen it |

## What Comes After Installation?

| Next step | Reference file |
|---|---|
| Completing the First-Run Setup Wizard (5 steps) | `02-first-run-wizard.md` |
| Logging in and the password policy | `03-login.md` |
| Running your first complete sales cycle with the numeric example | `04-quick-start.md` |
| Getting familiar with the sidebar, header, and themes | `../03-interface/README.md` |

## Tips

- Try PGlite first even if you plan to move to a server later — learning the system is faster without server setup.
- After a successful "Test Connection" with PostgreSQL, take a snapshot of the connection details and keep them — you will need them when setting up a new machine.
- Don't choose "Erase all data" on the welcome screen unless you are certain — see its warnings in the Setup Wizard guide.
