#!/usr/bin/env bash
set -euo pipefail

# A project-owned daemon: no sudo, Docker group, system service, or global context changes.
cd "$(dirname "$0")/.."
runtime="$PWD/work/runtime"
socket="unix://$runtime/docker.sock"
mkdir -p "$runtime/bin"
if docker --host "$socket" info >/dev/null 2>&1; then exit 0; fi

if [[ "$(uname -m)" != x86_64 ]]; then
  echo "The bundled rootless setup supports Linux x86_64. Use an existing rootless Docker daemon on this device."
  exit 1
fi
if [[ ! -x "$runtime/bin/rootlesskit" ]]; then
  curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-rootless-extras-29.8.0.tgz -o "$runtime/rootless.tgz"
  tar -xzf "$runtime/rootless.tgz" --strip-components=1 -C "$runtime/bin"
fi
if [[ ! -x "$runtime/bin/slirp4netns" ]]; then
  curl -fsSL https://github.com/rootless-containers/slirp4netns/releases/download/v1.3.5/slirp4netns-x86_64 -o "$runtime/bin/slirp4netns"
  printf '%s  %s\n' 8e54132bc80fc60d53af4b544dae63a81151774b56f129e572f7f1a2e89a57cf "$runtime/bin/slirp4netns" | sha256sum --check
  chmod +x "$runtime/bin/slirp4netns"
fi
cat > "$runtime/daemon.json" <<'JSON'
{
  "ip": "127.0.0.1",
  "default-network-opts": {
    "bridge": { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" }
  }
}
JSON

nohup env PATH="$runtime/bin:$PATH" \
  DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR="$runtime/state" \
  "$runtime/bin/dockerd-rootless.sh" \
  --host "$socket" --config-file "$runtime/daemon.json" \
  --data-root "$PWD/work/docker-data" --exec-root "$runtime/exec" \
  --pidfile "$runtime/docker.pid" > "$runtime/docker.log" 2>&1 < /dev/null &
daemon_pid=$!

for attempt in {1..30}; do
  if docker --host "$socket" info >/dev/null 2>&1; then
    echo "Rootless Docker is ready for NeighborWalk."
    if [[ "${1:-}" == --foreground ]]; then wait "$daemon_pid"; fi
    exit 0
  fi
  sleep 1
done
tail -n 30 "$runtime/docker.log"
exit 1
