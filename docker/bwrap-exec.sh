#!/bin/bash
#
# bwrap-exec.sh — run a shell command in a bubblewrap sandbox.
#
# Used by the agent when executing shell tool calls locally.
# The sandbox has no access to the home directory, credentials,
# or anything outside /sandbox (a tmpfs scratchpad).
#
# Usage: bwrap-exec <command> [args...]
#
# Environment:
#   SANDBOX_DIR  — host path to mount as /workspace (default: /tmp/omni-sandbox)
#

set -euo pipefail

SANDBOX_DIR="${SANDBOX_DIR:-/tmp/omni-sandbox}"
mkdir -p "$SANDBOX_DIR"

exec bwrap \
  --ro-bind /usr       /usr        \
  --ro-bind /bin       /bin        \
  --ro-bind /sbin      /sbin       \
  --ro-bind-try /lib   /lib        \
  --ro-bind-try /lib64 /lib64      \
  --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --bind "$SANDBOX_DIR" /workspace  \
  --tmpfs /tmp                      \
  --proc /proc                      \
  --dev /dev                        \
  --unshare-pid                     \
  --unshare-ipc                     \
  --unshare-uts                     \
  --new-session                     \
  --die-with-parent                 \
  --chdir /workspace                \
  -- "$@"
