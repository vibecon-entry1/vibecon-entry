# perf probe

`probe.mjs` measures frame times at max entity load (boss arena + minions +
bolts) under CPU throttling. It is opt-in — machine-relative numbers, no
assertions — and exists so the Plan 5 perf pass stays reproducible:

    node tools/serve.mjs 8123 &
    node tests/perf/probe.mjs        # 4x throttle (the M7 budget rig)
    node tests/perf/probe.mjs 6      # meaner

Budget (spec §13 / plan 5 T3): p95 frame <= 16.6ms at 4x, 1280x720 scale 2.
The header of probe.mjs carries the recorded before/after numbers.
