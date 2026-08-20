// Pure score state. Doge-voice event strings surface through takeEvents().
const POINTS = { coin: 10, kill: 100, wow: 50, boss: 500 };

export function makeScore() {
  let value = 0, flightKills = 0, killEarned = 0;
  const events = [];
  return {
    add(kind) { value += POINTS[kind] ?? 0; },       // boss + coin: NOT tracked in killEarned
    onKill(airborne) {
      value += POINTS.kill;
      killEarned += POINTS.kill;
      if (airborne) {
        flightKills++;
        if (flightKills >= 2) {
          value += POINTS.wow;
          killEarned += POINTS.wow;                  // the WOW+ bonus is a kill reward too
          events.push('WOW+');
        }
      }
    },
    onLand() { flightKills = 0; },
    // Real death penalty. Deliberately un-floored: a death with little banked
    // can now push the run negative, which is the point — see refundKills.
    dock(n) { value -= n; },
    // Every respawn's exploit guard: revoke every point a kill (or its WOW+
    // bonus) ever earned since the last respawn. Boss points and coins are
    // untouched — killEarned never counted them in the first place.
    refundKills() { value -= killEarned; killEarned = 0; },
    takeEvents() { return events.splice(0); },
    value() { return value; },
  };
}
