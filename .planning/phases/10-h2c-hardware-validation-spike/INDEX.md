# Phase 10 — H2C Hardware Validation Spike — Plan Index

**Phase goal:** Confirm H2C protocol assumptions against real hardware before any production code is written. Deliver `.planning/research/H2C-FIELD-NOTES.md` as ground truth for Phases 11-14.

**Requirements:** BAMBU-01, BAMBU-02

## Execution split

The phase is split into **two sessions** per 10-CONTEXT.md:

- **Session A (Claude alone, user not home)** — Plans 01, 02, 03. Pre-preparation: install tooling on App-VM, write spike script, prepare field-notes skeleton + runbook. No H2C access needed.
- **Session B (user home with H2C)** — Plan 04. Real run, fill field notes, commit.

## Plans

| Plan | Title | Wave | Depends on | Autonomous | Requirements | Session |
|------|-------|------|------------|------------|--------------|---------|
| 01 | Tooling preparation on App-VM | 1 | — | yes | BAMBU-01 | A |
| 02 | Spike script + go2rtc template | 2 | 01 | yes | BAMBU-01 | A |
| 03 | Field-notes template + RUN-GUIDE | 2 | — | yes | BAMBU-02 | A |
| 04 | Field run against real H2C + fill notes | 3 | 01, 02, 03 | no (checkpoints) | BAMBU-01, BAMBU-02 | B |

## Dependency graph

```
        Plan 01 (tooling)
              │
              ▼
        Plan 02 (spike script) ──┐
                                 ▼
Plan 03 (field-notes + guide) ─► Plan 04 (run + fill)
```

Plan 03 is independent of 01/02 (docs only) and runs in parallel with Plan 02 in Wave 2. Plan 04 waits for all three.

## File ownership (no overlaps within a wave)

| Plan | Files |
|------|-------|
| 01 | scripts/install-tooling.sh, scripts/.gitignore |
| 02 | scripts/run-spike.sh, scripts/go2rtc-template.yaml |
| 03 | .planning/research/H2C-FIELD-NOTES.md, RUN-GUIDE.md |
| 04 | .planning/research/H2C-FIELD-NOTES.md (fills skeleton), .planning/research/h2c-spike-*.log |

Plans 02 and 03 are in Wave 2 and modify disjoint files → safe in parallel.  
Plan 04 edits the file Plan 03 created — correct sequential dependency.

## Scope guardrails (from 10-CONTEXT.md)

- NO `src/` changes in any Plan 10-*.
- NO new npm dependencies.
- NO UniFi Protect adoption (that is Phase 13).
- Bird's-Eye `/streaming/live/2` is PROBED for evidence only; remains OUT OF SCOPE as a v1.2 feature.
- Scripts land in `.planning/phases/10-.../scripts/`, NOT in repo-root `scripts/`.

## Requirements coverage matrix

| Requirement | Plan | Coverage |
|-------------|------|----------|
| BAMBU-01 (spike confirms RTSPS/SSDP/MQTT assumptions on real H2C) | 01 (tooling prereq), 02 (script), 04 (actual run) | Full |
| BAMBU-02 (spike outputs `H2C-FIELD-NOTES.md` ground truth) | 03 (skeleton), 04 (fill) | Full |

Both v1.2-Phase-10 requirements are fully covered with no partial scope.

## Success for Phase 10 (from 10-CONTEXT.md)

- [ ] Spike script written and reviewed on App-VM (Plans 01 + 02)
- [ ] User provides IP, Serial, Access Code; LAN Mode confirmed ON (Plan 04 gate)
- [ ] All 4 verification areas run against real H2C (Plan 04)
- [ ] `.planning/research/H2C-FIELD-NOTES.md` written and committed with status=validated (Plan 04)
- [ ] Any X1C/P1S divergences flagged for Phase 11+ plan revision (Plan 04 Recommendations section)
