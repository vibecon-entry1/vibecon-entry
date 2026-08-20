// Pure score state. Doge-voice event strings surface through takeEvents().
const POINTS = { coin: 10, kill: 100, wow: 50 };

export function makeScore() {
  let value = 0, flightKills = 0;
  const events = [];
  return {
    add(kind) { value += POINTS[kind] ?? 0; },
    onKill(airborne) {
      value += POINTS.kill;
      if (airborne) {
        flightKills++;
        if (flightKills >= 2) { value += POINTS.wow; events.push('WOW+'); }
      }
    },
    onLand() { flightKills = 0; },
    dock(n) { value = Math.max(0, value - n); },     // real death penalty; never negative
    takeEvents() { return events.splice(0); },
    value() { return value; },
  };
}
