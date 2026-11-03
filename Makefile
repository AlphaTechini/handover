# Handover: build, test and verify entry points.
#
#   make verify            offline check of the whole repo (no keys, no network, no wallet)
#   make test              all unit tests (contract, clean-check library, web chain layer)
#   make build-contract    rebuild contracts/res/handover.wasm and its sha256
#   make status TOKEN=0    live clean check of one wallet (needs .env, see .env.example)
#   make snapshot TOKEN=0  save a live snapshot to evidence/snapshots/token-0.json
#
# Requires: Rust (stable), Node 22, pnpm 10, GNU make, bash.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

CARGO_MANIFEST := contracts/handover/Cargo.toml
RES_DIR        := contracts/res
FIXTURES       := $(wildcard packages/cleancheck/test/fixtures/*.json)
VERIFY_LOG     := .verify.log
CLI            := pnpm --silent --filter @handover/cleancheck cli

.PHONY: all help install verify build-contract test test-contract test-cleancheck test-web \
        web dev checks-offline status snapshot clean

all: help

help:
	@echo "Targets:"
	@echo "  verify          offline judge path: contract tests, clean-check tests, snapshot verdicts, wasm hash"
	@echo "  install         pnpm install --frozen-lockfile"
	@echo "  build-contract  cargo near build + regenerate $(RES_DIR)/handover.wasm.sha256"
	@echo "  test            contract + clean-check + web unit tests"
	@echo "  web             production build of the web app (web/build)"
	@echo "  dev             web dev server"
	@echo "  checks-offline  capability checks that need no network (check 3 --offline, check 4)"
	@echo "  status TOKEN=N  live clean check (reads .env)"
	@echo "  snapshot TOKEN=N  write evidence/snapshots/token-N.json (reads .env)"
	@echo "  clean           remove build output"

install:
	pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------- verify

verify:
	@start=$$(date +%s); \
	if [ ! -d node_modules ]; then echo "node_modules missing: running pnpm install --frozen-lockfile"; pnpm install --frozen-lockfile; fi; \
	echo; echo "[1/4] Contract unit tests (cargo test)"; \
	if cargo test --manifest-path $(CARGO_MANIFEST) >$(VERIFY_LOG) 2>&1; then grep -E '^test result' $(VERIFY_LOG); \
	else echo "FAIL: cargo test"; tail -40 $(VERIFY_LOG); exit 1; fi; \
	echo; echo "[2/4] Clean-check library tests (vitest)"; \
	if pnpm --filter @handover/cleancheck test >$(VERIFY_LOG) 2>&1; then grep -E 'Test Files|Tests ' $(VERIFY_LOG); \
	else echo "FAIL: cleancheck tests"; tail -40 $(VERIFY_LOG); exit 1; fi; \
	echo; echo "[3/4] Clean-check verdicts over committed snapshots"; \
	real=$$(ls evidence/snapshots/*.json 2>/dev/null || true); \
	if [ -n "$$real" ]; then \
	  echo "Real snapshots (evidence/snapshots):"; \
	  $(CLI) verify $$(for f in $$real; do echo "$(CURDIR)/$$f"; done); \
	else \
	  echo "No real snapshot committed yet (evidence/snapshots is empty): only synthetic fixtures below."; \
	fi; \
	echo; echo "Synthetic fixtures (packages/cleancheck/test/fixtures, NOT chain data):"; \
	$(CLI) verify $(foreach f,$(FIXTURES),$(CURDIR)/$(f)); \
	echo; echo "[4/4] Committed wasm matches its sha256"; \
	cd $(RES_DIR); \
	if command -v sha256sum >/dev/null 2>&1; then sha256sum -c handover.wasm.sha256; else shasum -a 256 -c handover.wasm.sha256; fi; \
	cd $(CURDIR); \
	end=$$(date +%s); \
	n_real=$$({ ls evidence/snapshots/*.json 2>/dev/null || true; } | wc -l | tr -d ' '); \
	echo; \
	echo "VERIFY OK in $$((end - start))s: contract tests pass, clean-check tests pass, $$(echo $(FIXTURES) | wc -w | tr -d ' ') synthetic fixtures and $$n_real real snapshot(s) give the expected verdicts, wasm hash matches."; \
	if [ "$$n_real" = "0" ]; then echo "Note: no real snapshot committed yet; real-chain proof is pending the evidence run (see evidence/README.md)."; fi

# ------------------------------------------------------------------------------ building

# Rebuilds the wasm with cargo-near (non-reproducible, no docker) and regenerates the hash.
# Update the size and hash recorded in contracts/res/BUILD.md by hand afterwards.
build-contract:
	cd contracts/handover && cargo near build non-reproducible-wasm --locked --out-dir ../res
	cd $(RES_DIR) && sha256sum handover.wasm > handover.wasm.sha256 && cat handover.wasm.sha256 && wc -c handover.wasm

# ---------------------------------------------------------------------------------- tests

test: test-contract test-cleancheck test-web

test-contract:
	cargo test --manifest-path $(CARGO_MANIFEST)

test-cleancheck:
	pnpm --filter @handover/cleancheck test

test-web:
	pnpm --filter web test

web:
	pnpm --filter web build

dev:
	pnpm --filter web dev

# Capability checks that need no network: address derivation vector (3) and omni-transaction vs viem (4).
checks-offline:
	pnpm --filter checks check:3 -- --offline
	pnpm --filter checks check:4

# ------------------------------------------------------------------------- live (needs .env)

# Loads .env (repo root, git-ignored) into the environment of the command; see .env.example.
LOAD_ENV := set -a; if [ -f .env ]; then . ./.env; fi; set +a

status:
	@[ -n "$(TOKEN)" ] || { echo "usage: make status TOKEN=<token_id>"; exit 2; }
	@$(LOAD_ENV); $(CLI) status $(TOKEN)

snapshot:
	@[ -n "$(TOKEN)" ] || { echo "usage: make snapshot TOKEN=<token_id>"; exit 2; }
	@mkdir -p evidence/snapshots
	@$(LOAD_ENV); $(CLI) snapshot $(TOKEN) $(CURDIR)/evidence/snapshots/token-$(TOKEN).json

clean:
	rm -rf web/build web/.svelte-kit contracts/handover/target .verify.log
