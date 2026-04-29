#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_PORT="1420"
GITHUB_CLIENT_ID_KEY="HELMOR_GITHUB_CLIENT_ID"

cd "$ROOT_DIR"

info() {
	printf '\033[1;34m[dev]\033[0m %s\n' "$*"
}

warn() {
	printf '\033[1;33m[dev]\033[0m %s\n' "$*" >&2
}

fail() {
	printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2
	exit 1
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		fail "Missing required command: $1"
	fi
}

trim() {
	local value="$1"

	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	value="${value%$'\r'}"
	printf '%s' "$value"
}

read_env_file_var() {
	local env_file="$1"
	local key="$2"
	local line
	local value

	[ -f "$env_file" ] || return 1

	line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" | tail -n 1 || true)"
	[ -n "$line" ] || return 1

	value="$(trim "${line#*=}")"
	case "$value" in
		\"*\")
			value="${value#\"}"
			value="${value%\"}"
			;;
		\'*\')
			value="${value#\'}"
			value="${value%\'}"
			;;
	esac

	[ -n "$value" ] || return 1
	printf '%s\n' "$value"
}

load_github_client_id() {
	local env_file
	local value

	if [ -n "${HELMOR_GITHUB_CLIENT_ID:-}" ]; then
		return 0
	fi

	for env_file in "$ROOT_DIR/src-tauri/.env.local" "$ROOT_DIR/.env.local" "$ROOT_DIR/.env.example"; do
		value="$(read_env_file_var "$env_file" "$GITHUB_CLIENT_ID_KEY" || true)"
		if [ -n "$value" ]; then
			export HELMOR_GITHUB_CLIENT_ID="$value"
			info "Loaded $GITHUB_CLIENT_ID_KEY from ${env_file#$ROOT_DIR/}"
			return 0
		fi
	done

	return 1
}

save_github_client_id() {
	local value="$1"
	local env_file="$ROOT_DIR/.env.local"
	local tmp_file

	if [ -f "$env_file" ] && grep -qE "^[[:space:]]*${GITHUB_CLIENT_ID_KEY}[[:space:]]*=" "$env_file"; then
		tmp_file="$(mktemp)"
		awk -v key="$GITHUB_CLIENT_ID_KEY" -v value="$value" '
			$0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
				print key "=" value
				next
			}
			{ print }
		' "$env_file" > "$tmp_file"
		mv "$tmp_file" "$env_file"
	else
		{
			[ ! -f "$env_file" ] || printf '\n'
			printf '%s=%s\n' "$GITHUB_CLIENT_ID_KEY" "$value"
		} >> "$env_file"
	fi
}

ensure_github_client_id() {
	local value

	if load_github_client_id; then
		return 0
	fi

	warn "$GITHUB_CLIENT_ID_KEY is not configured. GitHub account connection will be disabled."

	if ! [ -t 0 ]; then
		fail "Run ./dev.sh in an interactive terminal or set $GITHUB_CLIENT_ID_KEY before starting dev mode."
	fi

	printf 'Enter %s to enable GitHub connection, or press Enter to continue without it: ' "$GITHUB_CLIENT_ID_KEY"
	read -r value
	value="$(trim "$value")"

	if [ -z "$value" ]; then
		warn "Continuing without GitHub account connection."
		return 0
	fi

	export HELMOR_GITHUB_CLIENT_ID="$value"

	if confirm "Save $GITHUB_CLIENT_ID_KEY to .env.local for future dev runs?"; then
		save_github_client_id "$value"
		info "Saved $GITHUB_CLIENT_ID_KEY to .env.local"
	fi
}

port_pids() {
	lsof -tiTCP:"$DEV_PORT" -sTCP:LISTEN 2>/dev/null || true
}

print_port_owner() {
	lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN 2>/dev/null || true
}

confirm() {
	local prompt="$1"
	local answer

	printf '%s [y/N] ' "$prompt"
	read -r answer

	case "$answer" in
		y | Y | yes | YES)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

wait_for_port_release() {
	local attempt

	for attempt in {1..20}; do
		if [ -z "$(port_pids)" ]; then
			return 0
		fi
		sleep 0.25
	done

	return 1
}

ensure_dev_port_available() {
	local pids
	pids="$(port_pids)"

	if [ -z "$pids" ]; then
		return 0
	fi

	warn "Port $DEV_PORT is already in use:"
	print_port_owner

	if ! [ -t 0 ]; then
		fail "Run ./dev.sh in an interactive terminal so it can ask before killing the port owner."
	fi

	if ! confirm "Kill the process(es) using port $DEV_PORT and continue?"; then
		fail "Port $DEV_PORT is still in use. Dev server not started."
	fi

	while IFS= read -r pid; do
		[ -n "$pid" ] || continue
		info "Stopping process $pid"
		kill "$pid" 2>/dev/null || true
	done <<< "$pids"

	if wait_for_port_release; then
		return 0
	fi

	warn "Port $DEV_PORT is still in use after SIGTERM:"
	print_port_owner

	if ! confirm "Force kill the remaining process(es) on port $DEV_PORT?"; then
		fail "Port $DEV_PORT is still in use. Dev server not started."
	fi

	while IFS= read -r pid; do
		[ -n "$pid" ] || continue
		info "Force stopping process $pid"
		kill -9 "$pid" 2>/dev/null || true
	done <<< "$(port_pids)"

	if ! wait_for_port_release; then
		fail "Port $DEV_PORT is still in use after force kill."
	fi
}

require_command bun
require_command lsof

ensure_github_client_id
ensure_dev_port_available

info "Installing root and sidecar dependencies"
bun install --frozen-lockfile
(cd sidecar && bun install --frozen-lockfile)

ensure_dev_port_available

info "Starting Helmor dev mode on http://localhost:$DEV_PORT"
exec bun run dev
