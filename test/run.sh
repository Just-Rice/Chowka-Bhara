#!/bin/sh
# Runs every suite. No Node on this machine, so we use the JavaScriptCore shell
# that ships with macOS. Suites report failures in their output, so we grep the
# captured result rather than relying on an exit code.
set -e
cd "$(dirname "$0")/.."

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore shell not found at $JSC"; exit 1; }

status=0
for suite in rules cpu turn net i18n contrast; do
  printf '\n=== %s ===\n' "$suite"
  out=$("$JSC" "test/$suite-test.js" 2>&1) || status=1
  printf '%s\n' "$out"
  case "$out" in *"❌"*) status=1 ;; esac
done

printf '\n'
if [ "$status" -eq 0 ]; then echo "all suites clean"; else echo "some suites reported failures"; fi
exit "$status"
