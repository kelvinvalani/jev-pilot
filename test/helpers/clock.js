/**
 * Auto-advancing virtual clock. Timers fire in due order as soon as the
 * event loop is idle, so 60s rate-limit waits finish instantly in tests.
 */

function createClock(start) {
  let now = start || 1_790_000_000_000;
  let nextId = 1;
  const timers = new Map();
  let pumping = false;

  function schedule() {
    if (pumping || !timers.size) return;
    pumping = true;
    setImmediate(() => {
      pumping = false;
      let earliest = null;
      for (const t of timers.values()) {
        if (!earliest || t.due < earliest.due || (t.due === earliest.due && t.id < earliest.id)) earliest = t;
      }
      if (!earliest) return;
      timers.delete(earliest.id);
      now = Math.max(now, earliest.due);
      try {
        earliest.fn(...earliest.args);
      } finally {
        schedule();
      }
    });
  }

  function setTimeoutFake(fn, ms, ...args) {
    const id = nextId++;
    timers.set(id, { id, fn, args, due: now + Math.max(0, Number(ms) || 0) });
    schedule();
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }
    static now() {
      return now;
    }
  }

  return {
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    Date: FakeDate,
    performance: { now: () => now },
    now: () => now,
    advance(ms) {
      now += ms;
    },
    pending: () => timers.size,
  };
}

module.exports = { createClock };
