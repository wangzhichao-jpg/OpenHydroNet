#!/bin/sh
# Stand-in for the bundled Python in tests/ui.startup.cjs (T-015, W4-06). Arguments are passed through
# to the real interpreter. OHN_TEST_MODE:
#   delay        sleep OHN_TEST_DELAY seconds, then start the real backend
#   first-slow   first run sleeps OHN_TEST_DELAY seconds (marker file), later runs start at once
#   exit         print an error and exit with code 3 (backend dies before it is ready)
real="${OHN_TEST_REAL_PYTHON:-python3}"
case "$OHN_TEST_MODE" in
  exit)
    echo "ModuleNotFoundError: No module named 'numpy' (test stand-in)" >&2
    exit 3 ;;
  first-slow)
    if [ ! -e "$OHN_TEST_MARKER" ]; then
      : > "$OHN_TEST_MARKER"
      echo $$ > "$OHN_TEST_MARKER.pid"
      sleep "${OHN_TEST_DELAY:-6}"
    fi ;;
  *)
    sleep "${OHN_TEST_DELAY:-20}" ;;
esac
exec "$real" "$@"
