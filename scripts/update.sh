#!/bin/bash
#
# ip-cam-master self-update runner
#
# Runs inside a detached systemd-run unit spawned by POST /api/update/run.
# Writes incremental progress to $LOG and a final exit code to $EXITCODE_FILE.
# On ANY failure, resets the working tree to $PRE_SHA, rebuilds, and restarts
# the service so the previous version comes back online automatically.
#
# Args:
#   $1 - PRE_SHA: full SHA the worktree is currently on
#   $2 - PRE_SCHEMA_HASH: sha256 of src/lib/server/db/schema.ts before git pull
#
# Env:
#   LOG            - absolute path to the log file (timestamped by Node caller)
#   EXITCODE_FILE  - absolute path to the exitcode file
#   INSTALL_DIR    - optional override of install directory (default /opt/ip-cam-master)
#
# Exit codes written to $EXITCODE_FILE:
#   0 - success
#   1 - failed before rollback (should be rare)
#   2 - failed, rolled back to $PRE_SHA

set -o pipefail

PRE_SHA="${1:-}"
PRE_SCHEMA_HASH="${2:-}"
LOG="${LOG:-/tmp/ip-cam-master-update-$(date +%s).log}"
EXITCODE_FILE="${EXITCODE_FILE:-${LOG%.log}.exitcode}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ip-cam-master}"
LOCK_FILE="/run/ip-cam-master-deploy.lock"

exec 9>"$LOCK_FILE" || {
	echo "ERROR: cannot open lock file $LOCK_FILE" | tee -a "${LOG:-/dev/stderr}"
	echo "=== UPDATE_RESULT: failed (lock open failed, nothing changed) ===" | tee -a "${LOG:-/dev/stderr}"
	echo 1 > "$EXITCODE_FILE" 2>/dev/null || true
	exit 1
}
if ! flock -n 9; then
	echo "ERROR: another deploy/update is already running (lock held on $LOCK_FILE)" | tee -a "${LOG:-/dev/stderr}"
	echo "=== UPDATE_RESULT: failed (deploy lock busy, nothing changed) ===" | tee -a "${LOG:-/dev/stderr}"
	echo 1 > "$EXITCODE_FILE" 2>/dev/null || true
	exit 1
fi

# Ensure log file exists without truncating — the Node caller may have
# written pre-update lines (auto-backup status) that must be preserved.
touch "$LOG"

log() {
	local ts
	ts="$(date '+%H:%M:%S')"
	echo "[$ts] $*" | tee -a "$LOG"
}

write_exit() {
	echo "$1" > "$EXITCODE_FILE"
}

# --- Pre-flight -------------------------------------------------------------

if [ -z "$PRE_SHA" ] || [ -z "$PRE_SCHEMA_HASH" ]; then
	log "ERROR: missing PRE_SHA or PRE_SCHEMA_HASH args"
	echo "=== UPDATE_RESULT: failed (bad args, nothing changed) ===" | tee -a "$LOG"
	write_exit 1
	exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
	log "ERROR: $INSTALL_DIR is not a git working tree"
	echo "=== UPDATE_RESULT: failed (not a git tree, nothing changed) ===" | tee -a "$LOG"
	write_exit 1
	exit 1
fi

cd "$INSTALL_DIR" || {
	log "ERROR: cannot cd to $INSTALL_DIR"
	echo "=== UPDATE_RESULT: failed (cd failed, nothing changed) ===" | tee -a "$LOG"
	write_exit 1
	exit 1
}

log "Starting update from $PRE_SHA"
log "Install dir: $INSTALL_DIR"
log "Log file: $LOG"

# --- Rollback helper --------------------------------------------------------

rollback() {
	local reason="$1"
	log "ROLLBACK: $reason — resetting to $PRE_SHA"
	git reset --hard "$PRE_SHA" 2>&1 | tee -a "$LOG" || true
	log "Rollback: reinstalling deps (best effort)"
	npm install 2>&1 | tee -a "$LOG" || log "WARNING: rollback npm install failed"
	log "Rollback: rebuilding (best effort)"
	npm run build 2>&1 | tee -a "$LOG" || log "WARNING: rollback build failed"
	log "Rollback: restarting service (best effort)"
	systemctl restart ip-cam-master 2>&1 | tee -a "$LOG" || log "WARNING: rollback restart failed"
	echo "=== UPDATE_RESULT: failed ($reason, rolled back to $PRE_SHA) ===" | tee -a "$LOG"
	write_exit 2
	exit 0
}

# --- 1. git pull ------------------------------------------------------------

log "Running git pull..."
if ! git pull --ff-only origin main 2>&1 | tee -a "$LOG"; then
	log "ERROR: git pull failed"
	git reset --hard "$PRE_SHA" 2>&1 | tee -a "$LOG" || true
	echo "=== UPDATE_RESULT: failed (pull failed, reset to $PRE_SHA) ===" | tee -a "$LOG"
	write_exit 2
	exit 0
fi

POST_SHA="$(git rev-parse HEAD)"
log "Pulled to $POST_SHA"

# --- 2. schema hash compare (non-blocking) ----------------------------------

if [ -f "src/lib/server/db/schema.ts" ]; then
	POST_SCHEMA_HASH="$(sha256sum src/lib/server/db/schema.ts | awk '{print $1}')"
	if [ "$POST_SCHEMA_HASH" != "$PRE_SCHEMA_HASH" ]; then
		log "WARNING: schema.ts changed — manual migration may be required"
	fi
fi

# --- 3. npm install ---------------------------------------------------------

log "Running npm install..."
if ! npm install 2>&1 | tee -a "$LOG"; then
	rollback "install failed"
fi

# --- 4. npm run build -------------------------------------------------------

log "Running npm run build..."
if ! npm run build 2>&1 | tee -a "$LOG"; then
	rollback "build failed"
fi

# --- 5. systemctl restart ---------------------------------------------------

log "Restarting ip-cam-master.service..."
if ! systemctl restart ip-cam-master 2>&1 | tee -a "$LOG"; then
	rollback "restart failed"
fi

sleep 3

if ! systemctl is-active --quiet ip-cam-master; then
	log "ERROR: service is not active after restart"
	rollback "service inactive after restart"
fi

# --- 6. success -------------------------------------------------------------

log "Update complete: $PRE_SHA -> $POST_SHA"
echo "=== UPDATE_RESULT: success ($PRE_SHA -> $POST_SHA) ===" | tee -a "$LOG"
write_exit 0
exit 0
