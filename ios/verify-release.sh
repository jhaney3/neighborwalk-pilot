#!/bin/sh
set -eu
[ "${CONFIGURATION:-}" = Release ] || exit 0
fail() { echo "error: $1" >&2; exit 1; }
[ -n "${DEVELOPMENT_TEAM:-}" ] || fail 'Choose the actual Apple signing team.'
[ "${APS_ENVIRONMENT:-}" = production ] || fail 'Release requires production APNs.'
MARKER="$SRCROOT/App/public/build-provenance.json"
[ -f "$MARKER" ] || fail 'Missing bundle provenance. Run npm run ios:release:prepare.'
read_marker() { /usr/bin/plutil -extract "$1" raw -o - "$MARKER"; }
[ "$(read_marker channel)" = app-store ] || fail 'Sample bundles cannot be archived.'
[ "$(read_marker releaseEligible)" = true ] || fail 'Bundle is not release eligible.'
[ "$(read_marker remotePush)" = true ] || fail 'Remote push is required for this release.'
[ "$(read_marker apnsEnvironment)" = production ] || fail 'Bundle APNs environment mismatch.'
[ "$(read_marker appId)" = "$PRODUCT_BUNDLE_IDENTIFIER" ] || fail 'Bundle identifier mismatch.'
ORIGIN="$(read_marker inviteOrigin)"
case "$ORIGIN" in https://*.*) ;; *) fail 'Missing HTTPS invitation origin.' ;; esac
HOST="${ORIGIN#https://}"
case "$HOST" in */*|*:*|*@*|*\?*|*\#*) fail 'Invalid invitation origin.' ;; esac
DOMAIN="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.associated-domains:0' "$SRCROOT/App/App.entitlements")"
[ "$DOMAIN" = "applinks:$HOST" ] || fail 'Associated Domain does not match the bundled invitation origin.'
[ -f "$SRCROOT/App/public/index.html" ] || fail 'Bundled application is incomplete.'
