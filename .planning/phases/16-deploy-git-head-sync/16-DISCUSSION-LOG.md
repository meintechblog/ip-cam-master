# Phase 16: Deploy Flow — .git/HEAD Sync — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 16-deploy-git-head-sync
**Areas discussed:** Uncommitted-Handling, Unpublished-Commits, Build-Lokation, Restart-Policy, Recovery, .env/data-Handling, Installer-Anpassung, Updater-Race-Conditions
**Mode:** --all (alle Gray Areas auto-selected, Discussion interaktiv)

---

## Uncommitted-Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Direkt auf VM pushen | Dev-Deploy pusht lokalen HEAD via git-over-SSH direkt zur VM; auch nicht-gepushte WIP-Commits landen auf der VM | ✓ |
| Verbieten — Commit-First | Deploy-Script bricht ab bei dirty tree; User muss committen (und ggf. pushen) vorher | |
| Auto-Stash-to-WIP-Branch | Script stash't als temporären wip-deploy-YYYYMMDD Commit auf dev-Branch | |

**User's choice:** Direkt auf VM pushen (Recommended)
**Notes:** Erlaubt private/WIP-Commits ohne GitHub-Umweg; commit-first-Disziplin über D-02 erzwungen (kein auto-stash)

---

## Unpublished-Commits

| Option | Description | Selected |
|--------|-------------|----------|
| Nein — git push direkt Mac→VM | Eigenes git-Remote auf der VM; Mac pusht direkt; auch private Commits deploybar | ✓ |
| Ja — Push-zu-GitHub vor Deploy | VM pullt ausschließlich von origin/main; Deploy ist immer push-zu-GitHub + VM-pull | |
| Git-Bundle als Transport | git bundle create + scp + git fetch bundle-datei | |

**User's choice:** Nein — git push direkt Mac→VM (Recommended)
**Notes:** Passt zum Home-Lab-Setup; keine GitHub-Abhängigkeit für Dev-Testing

---

## Build-Lokation

| Option | Description | Selected |
|--------|-------------|----------|
| Auf der VM | Konsistent mit install.sh + update.sh; npm ci && npm run build nach Pull | ✓ |
| Auf dem Mac, Artefakte rsync'd | Build lokal, .svelte-kit/ + build/ mit-synchronisiert; Risk: arm64 vs x64 für native Deps | |
| Nur bei Bedarf — skipbar | Script erkennt src/-Änderungen und skippt sonst; spart Zeit bei .planning/-Änderungen | |

**User's choice:** Auf der VM (Recommended)
**Notes:** Einheitliche Linux-x64 Toolchain für better-sqlite3; konsistent mit Production

---

## Restart-Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Immer automatisch | systemctl restart nach jedem Deploy; 2-3s Downtime akzeptabel | ✓ |
| Nur bei schema/deps-Änderungen | Script diff't package.json/schema.ts; restart nur bei Änderung | |
| Nie — manueller Restart | Deploy pullt und baut; Restart explizit manuell | |

**User's choice:** Immer automatisch (Recommended)
**Notes:** Garantiert Refresh des cachedVersion in getCurrentVersion()

---

## Recovery für Altinstallationen

| Option | Description | Selected |
|--------|-------------|----------|
| scripts/migrate-install.sh | Idempotentes Script auf VM; fetch + reset --hard + clean -fd + ci + build + restart | ✓ |
| Nur Doku im README | Copy-paste-Anleitung; minimaler Aufwand aber fehleranfällig | |
| /api/update/migrate Endpoint | Button im Settings-UI; Race-Risiko mit /api/update/run | |

**User's choice:** scripts/migrate-install.sh (Recommended)
**Notes:** Idempotent, vom Dev-Deploy und manuell ausführbar

---

## .env / data/ Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Unverändert lassen | .env und data/ bleiben auf VM, gitignore geschützt | ✓ |
| Getrennte Env-Sync-Mechanik | deploy.sh env Befehl für Env-Übertragung bei Bedarf | |
| sops-verschlüsselt im Repo | .env.enc im git, sops decrypt auf VM; braucht GPG-Key-Management | |

**User's choice:** Unverändert lassen (Recommended)
**Notes:** Kein Scope-Creep; git clean -fd respektiert gitignore

---

## Installer-Anpassung

| Option | Description | Selected |
|--------|-------------|----------|
| Unverändert | install.sh macht bereits git clone; Production-Install bleibt korrekt | ✓ |
| Installer nimmt Tag-Checkout | git clone && git checkout v1.x für Reproduzierbarkeit | |
| Installer + Deploy teilen Bootstrap | Gemeinsame Funktion bootstrap_git_state(); mehr Refactoring | |

**User's choice:** Unverändert (Recommended)
**Notes:** Phase 16 fokussiert rein auf Dev-Deploy; Production bereits git-basiert

---

## Updater-Race-Conditions

| Option | Description | Selected |
|--------|-------------|----------|
| File-Lock /run/…-deploy.lock | flock in scripts/update.sh und Dev-Deploy; explizite Fehlermeldung bei Konflikt | ✓ |
| Dev-Deploy prüft Updater-Unit | systemctl is-active ip-cam-master-update; einseitig | |
| Keine Koordination | Letzter gewinnt; Race-Risiko bei halbfertigen pulls/builds | |

**User's choice:** File-Lock /run/ip-cam-master-deploy.lock (Recommended)
**Notes:** Standard-Linux-Pattern, ~10 Zeilen Code; beide Pfade ehren den Lock

---

## Claude's Discretion

Bereiche wo der Planner Freiheit hat:
- Konkrete Shell-Implementierung des git-over-SSH-Remotes (bare vs non-bare, post-receive hook vs client-side fetch)
- Exact file-layout: scripts/dev-deploy.sh als separates Script oder Make-Target im Mac-Repo
- Exit-Codes und Error-Message-Wording (konsistent mit update.sh Stil halten)

## Deferred Ideas

- Direkter SSH-Key für root@192.168.3.249 (Phase 17 Kandidat)
- Versionierte Tag-Releases im Installer
- sops-verschlüsselte .env im Repo
- /api/update/migrate UI-Endpoint
- Installer + Deploy geteilte Bootstrap-Funktion
