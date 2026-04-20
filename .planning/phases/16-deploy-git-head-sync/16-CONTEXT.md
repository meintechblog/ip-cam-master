# Phase 16: Deploy Flow — .git/HEAD Sync — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix den **Dev-Deploy-Flow** (Mac → VM für Testing), sodass `/opt/ip-cam-master/.git/HEAD` nach jedem Deploy auf den tatsächlich deployten Commit zeigt. Der In-App-Updater (`/api/update/run` → `scripts/update.sh`) und der Installer (`install.sh`) sind **bereits korrekt git-basiert** und werden von dieser Phase nicht berührt — sie sind der Referenz-Zustand, den der Dev-Deploy erreichen soll.

**In Scope:**
- Ersatz des rsync-basierten Dev-Deploys durch git-basierten Flow
- Ein Migrations-Script für Altinstallationen mit gedriftetem HEAD
- Koordination zwischen Dev-Deploy und In-App-Updater (File-Lock)

**Out of Scope:**
- Änderungen an `install.sh` (ist bereits korrekt)
- Änderungen an `scripts/update.sh` (ist bereits korrekt — wird nur um Lock-Acquisition ergänzt)
- Änderungen an `.env`- oder `data/`-Handling (bleibt gitignore-basiert wie bisher)

</domain>

<decisions>
## Implementation Decisions

### Deploy-Transport
- **D-01:** Dev-Deploy pusht den lokalen Commit **direkt vom Mac zur VM** via git-over-SSH (eigenes git-Remote `vm` im Mac-Repo, z.B. `git remote add vm vm:/opt/ip-cam-master`). Kein GitHub-Zwischenstop für Tests.
- **D-02:** Uncommitted Änderungen auf dem Mac müssen vor dem Deploy committet sein. Der User committet normal; unpublished-to-GitHub ist OK. Das Deploy-Script prüft `git status --porcelain` und bricht bei dirty-tree mit klarer Meldung ab (kein Auto-Stash-WIP — das würde Commit-History verrauschen).
- **D-03:** Der Push auf die VM setzt dort HEAD via Server-seitigem `post-receive`-Hook (oder explizitem `git fetch + reset --hard <received-sha>` im Deploy-Script), sodass die Working-Copy exakt = gepushter Commit ist.

### Build-Lokation
- **D-04:** `npm ci && npm run build` läuft **auf der VM nach dem Pull**, konsistent mit `install.sh` (Line 319/332) und `scripts/update.sh` (Line 116/123). Build-Target passt (Linux x64 native Deps wie better-sqlite3).
- **D-05:** Deploy-Script zeigt Build-Output live im Terminal (über ssh mit `-t`), damit Fehler sofort sichtbar sind.

### Service-Management
- **D-06:** `systemctl restart ip-cam-master` läuft **nach jedem Deploy** — garantiert, dass der Version-Cache in `getCurrentVersion()` (`src/lib/server/services/version.ts:22`) erneuert wird. 2-3s Downtime ist im Home-Lab akzeptabel.

### Migration Altinstallationen
- **D-07:** `scripts/migrate-install.sh` — idempotent, auf der VM ausführbar. Prüft `git status`, macht bei Bedarf `git fetch && git reset --hard origin/main && git clean -fd` (respektiert `.gitignore` → `.env`/`data/` safe) → `npm ci && npm run build && systemctl restart`.
- **D-08:** Das Dev-Deploy-Script ruft `migrate-install.sh` als Bootstrap-Check vor jedem Deploy auf — idempotent, keine Wirkung wenn State bereits clean ist.
- **D-09:** Doku-Zeile im README, wie man `migrate-install.sh` einmalig auf einer bestehenden Installation laufen lässt (für User die nicht das Dev-Deploy-Script benutzen).

### Coexistence mit In-App-Updater
- **D-10:** Beide Pfade (Dev-Deploy und `scripts/update.sh`) holen sich vor kritischen Operationen ein `flock` auf `/run/ip-cam-master-deploy.lock`. Wer den Lock nicht sofort bekommt, failed mit klarer Meldung ("ein anderer Update-/Deploy-Prozess läuft — bitte warten"). Kein Queueing, kein Warten — explizite Fehlermeldung.
- **D-11:** Lock wird im `scripts/update.sh` am Anfang acquired und am Ende (success ODER rollback) released. Dev-Deploy-Script macht dasselbe.

### Keine Änderung am Rest
- **D-12:** `.env` und `data/` bleiben unverändert: auf der VM, gitignored, vom neuen Deploy-Script nicht angefasst (genau wie vorher bei rsync).
- **D-13:** `install.sh` bleibt unverändert — macht bereits `git clone` (Line 315), liefert also einen clean state.
- **D-14:** `scripts/update.sh` bleibt funktional unverändert — wird nur um die zwei Lock-Zeilen (D-10/D-11) ergänzt.

### Claude's Discretion
- Konkrete Shell-Implementierung des git-over-SSH-Remotes (bare vs non-bare, post-receive hook vs client-side fetch) — Planner wählt.
- Genaue Syntax des Dev-Deploy-Scripts (Name, Arg-Parsing, Verbosity-Flags).
- Exit-Codes und Error-Messages (konsistent mit bestehendem `scripts/update.sh` Stil halten).
- Ob das migrate-Script separat oder als Flag in einem einheitlichen Deploy-Script landet.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Deploy/Update Code (bereits git-basiert — Referenz)
- `install.sh` §§ 295-344 — Initialer VM-Provisioning-Flow (git clone → npm install → build → service setup)
- `scripts/update.sh` — In-App-Updater Full-File (git pull + rollback logic, ~146 Zeilen)
- `src/lib/server/services/version.ts` — `getCurrentVersion()` + `parseDescribe()`, in-process Cache
- `src/lib/server/services/update-runner.ts` § L268-280 — `getDirtyFiles()` via `git status --porcelain`
- `src/routes/api/update/run/+server.ts` § L43-46 — Der 409 dirty_tree Check

### Prior Milestone Context
- `.planning/milestones/v1.1-ROADMAP.md` § L123 — v1.1 Decision: "Git pull over rsync als kanonischer Deploy-Mechanismus für End-User"
- `.planning/phases/09-update-runner-rollback/09-01-SUMMARY.md` § L226-241 — Dokumentierte einmalige VM-Migration für Phase 09
- `.planning/phases/08-version-awareness-update-check/08-VERIFICATION.md` § L22-32 — Notiert den Dirty-Tree-Zustand und "future cleanup could normalize the VM to be rsync-free"

### Kein extern referenzierter Spec/ADR
Phase 16 ist rein interne Infrastruktur-Konsolidierung; keine externen Specs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`scripts/update.sh` Rollback-Helper (L75-88):** Das `rollback()` Pattern (reset --hard PRE_SHA → npm install → build → restart) lässt sich in `migrate-install.sh` und ggf. das Dev-Deploy-Script wiederverwenden.
- **`scripts/update.sh` Pre-Flight-Pattern (L48-67):** Die Struktur (Arg-Validation, .git-Existenz-Check, cd-Check) ist ein gutes Template für neue Scripts.
- **`src/lib/server/services/version.ts:78`** — `CANDIDATE_INSTALL_DIRS = ['/opt/ip-cam-master', process.cwd()]` — gleiche Heuristik im Dev-Deploy-Script wiederverwenden.

### Established Patterns
- Shell-Scripts in `scripts/` verwenden `set -o pipefail`, `log()` via tee, numbered step-Kommentare (`# --- N. step ---`).
- Log-Files nach `/tmp/ip-cam-master-update-$(date +%s).log` mit `EXITCODE_FILE` Companion.
- systemd-Service-Name ist hardcoded `ip-cam-master` in allen Scripts und Source-Files.

### Integration Points
- Dev-Deploy-Script landet entweder unter `scripts/dev-deploy.sh` (auf dem Mac ausgeführt) oder als Make-Target. Das `scripts/migrate-install.sh` landet auf der VM (wird mit-deployed via git).
- Lock-File-Pfad `/run/ip-cam-master-deploy.lock` ist wohl-etabliertes Linux-Runtime-Pattern.
- VM-Zugang per `ssh proxi2 "qm guest exec 104 …"` (siehe `reference_vm_access.md`) — falls Dev-Deploy-Script diese Route für initiale Bootstrapping-Aktionen braucht.

</code_context>

<specifics>
## Specific Ideas

- Der User sagt: "Tendenziell bevorzuge ich Option B" (aus den drei Roadmap-Optionen). Option B ist die semantisch sauberste und korrespondiert zum v1.1-Roadmap-Decision. Alle 8 Discuss-Fragen bestätigen die Recommended-Options → der Plan hat einen konsistenten, von v1.1 vorgezeichneten Pfad.
- Empirisches Recovery-Rezept (heute manuell ausgeführt, bestätigt funktional):
  ```
  cd /opt/ip-cam-master
  git fetch origin && git reset --hard origin/main && git clean -fd
  systemctl restart ip-cam-master
  ```
- User-Kontext (aus Memory): Deploys laufen über proxi2 via `qm guest exec 104`, direkter SSH auf die VM geht aktuell nicht (publickey denied). Phase 16 kann optional auch diese Zugangshürde adressieren, aber out-of-scope — reference_vm_access.md notiert den workaround.

</specifics>

<deferred>
## Deferred Ideas

- **Direkter SSH-Key für root@192.168.3.249:** Der aktuelle workaround (qm guest exec über proxi2) funktioniert, ist aber umständlich. Eine Phase 17 könnte einen `authorized_keys`-Deploy vereinfachen. **Nicht Teil von Phase 16** — Phase 16 fokussiert auf Deploy-Flow.
- **Versionierte Tag-Releases:** Der Installer könnte Tag-basierte Installations (`v1.2`, `v1.3`) statt main-tip erzwingen. Aus Phase 16 ausgeklammert, da v1.1-Tag-Strategie schon funktioniert.
- **sops-verschlüsselte .env im Repo:** Angesprochen in Q6. Nicht übernommen, da zu viel Scope. Könnte v2.x Milestone werden wenn Multi-Env-Deployments relevant werden.
- **/api/update/migrate UI-Endpoint:** Nice-to-have, aber Overlap-Risiko mit /api/update/run. Dokumentieren als Follow-up falls Multi-VM-Setups entstehen.
- **Installer + Deploy geteilte Bootstrap-Funktion (Q7 Option C):** Konsistenz-Gewinn aber Refactoring-Aufwand. Erst wenn Dev-Deploy ausgereift ist.

</deferred>

---

*Phase: 16-deploy-git-head-sync*
*Context gathered: 2026-04-20*
