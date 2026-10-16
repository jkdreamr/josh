import assert from 'node:assert/strict';
import test from 'node:test';
import { batteryView, hourLabel, monthGrid, parseWeather } from '../src/os/hooks.ts';
import { onEscapeCapture } from '../src/os/escape.ts';

test('onEscapeCapture handles Escape in capture phase and removes its listener', () => {
  let added: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions } | undefined;
  let removed: typeof added;
  const target = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      added = { type, listener, options };
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
      removed = { type, listener, options };
    },
  } as Parameters<typeof onEscapeCapture>[0];
  let handled = 0;
  let prevented = 0;
  let stopped = 0;
  const cleanup = onEscapeCapture(target, () => { handled += 1; });
  assert.equal(added?.type, 'keydown');
  assert.equal(added?.options, true);

  const invoke = (event: KeyboardEvent) => {
    if (typeof added?.listener === 'function') added.listener(event);
  };
  invoke({
    key: 'Escape',
    preventDefault: () => { prevented += 1; },
    stopImmediatePropagation: () => { stopped += 1; },
  } as KeyboardEvent);
  assert.deepEqual([handled, prevented, stopped], [1, 1, 1]);
  invoke({
    key: 'a',
    preventDefault: () => { prevented += 1; },
    stopImmediatePropagation: () => { stopped += 1; },
  } as KeyboardEvent);
  assert.deepEqual([handled, prevented, stopped], [1, 1, 1]);

  cleanup();
  assert.equal(removed?.type, 'keydown');
  assert.equal(removed?.listener, added?.listener);
  assert.equal(removed?.options, true);
});

test('hourLabel formats hours in 12-hour time', () => {
  assert.equal(hourLabel(0), '12 AM');
  assert.equal(hourLabel(9), '9 AM');
  assert.equal(hourLabel(12), '12 PM');
  assert.equal(hourLabel(13), '1 PM');
  assert.equal(hourLabel(23), '11 PM');
});

test('parseWeather returns current conditions, daily range, and the next four hourly entries', () => {
  const report = parseWeather({
    current: { time: '2026-10-12T21:45', temperature_2m: 58.6, weather_code: 0, is_day: 0 },
    hourly: {
      time: [
        '2026-10-12T20:00',
        '2026-10-12T21:00',
        '2026-10-12T22:00',
        '2026-10-12T23:00',
        '2026-10-13T00:00',
        '2026-10-13T01:00',
        '2026-10-13T02:00',
        '2026-10-13T03:00',
      ],
      temperature_2m: [60, 59, 57.4, 56, 55, 54, 53, 52],
      weather_code: [0, 0, 0, 61, 3, 0, 0, 0],
      is_day: [1, 1, 0, 0, 0, 0, 0, 0],
    },
    daily: { temperature_2m_max: [74.6], temperature_2m_min: [48.2] },
  });

  assert.deepEqual(report, {
    temp: 59,
    label: 'Clear',
    icon: 'moon',
    high: 75,
    low: 48,
    hours: [
      { label: '10 PM', temp: 57, icon: 'moon' },
      { label: '11 PM', temp: 56, icon: 'rain' },
      { label: '12 AM', temp: 55, icon: 'cloud' },
      { label: '1 AM', temp: 54, icon: 'moon' },
    ],
  });
});

test('parseWeather tolerates missing forecast sections but requires a current temperature', () => {
  assert.deepEqual(parseWeather({ current: { time: '2026-10-12T21:45', temperature_2m: 58.6 } }), {
    temp: 59,
    label: 'Cloudy',
    icon: 'cloud',
    high: null,
    low: null,
    hours: [],
  });
  assert.deepEqual(parseWeather({
    current: { time: '2026-10-12T21:45', temperature_2m: 58.6 },
    daily: { temperature_2m_max: [74], temperature_2m_min: [48] },
  })?.hours, []);
  assert.equal(parseWeather(null), null);
  assert.equal(parseWeather('x'), null);
  assert.equal(parseWeather({}), null);
  assert.equal(parseWeather({ current: { temperature_2m: '58' } }), null);
});

test('batteryView maps readings to menu-bar battery state', () => {
  assert.deepEqual(batteryView(null), {
    percent: 100,
    level: 1,
    plugged: true,
    charging: false,
    source: 'Power Adapter',
    status: 'Battery Is Charged',
  });
  assert.deepEqual(batteryView({ level: 0.42, charging: false }), {
    percent: 42, level: 0.42, plugged: false, charging: false, source: 'Battery', status: null,
  });
  assert.deepEqual(batteryView({ level: 0.8, charging: true }), {
    percent: 80, level: 0.8, plugged: true, charging: true, source: 'Power Adapter', status: 'Charging',
  });
  assert.deepEqual(batteryView({ level: 1, charging: true }), {
    percent: 100, level: 1, plugged: true, charging: false, source: 'Power Adapter', status: 'Battery Is Charged',
  });
  assert.equal(batteryView({ level: 1.3, charging: false }).level, 1);
  assert.equal(batteryView({ level: -0.2, charging: false }).level, 0);
  assert.equal(batteryView({ level: Number.NaN, charging: false }).level, 1);
});

test('monthGrid fills complete Sunday-first weeks in day order', () => {
  const october = monthGrid(2026, 9);
  assert.equal(october.length, 5);
  assert.deepEqual(october[0], [null, null, null, null, 1, 2, 3]);
  assert.deepEqual(october.at(-1), [25, 26, 27, 28, 29, 30, 31]);

  const february = monthGrid(2026, 1);
  assert.equal(february.length, 4);
  assert.ok(february.every((week) => week.length === 7 && week.every((day) => day !== null)));

  const may = monthGrid(2026, 4);
  assert.equal(may.length, 6);
  for (const [grid, month] of [[october, 9], [february, 1], [may, 4]] as const) {
    assert.ok(grid.every((week) => week.length === 7));
    assert.deepEqual(
      grid.flat().filter((day): day is number => day !== null),
      Array.from({ length: new Date(2026, month + 1, 0).getDate() }, (_, index) => index + 1),
    );
  }
});
