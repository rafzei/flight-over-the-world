import tzLookup from 'tz-lookup';

export function flightTimeZone(latDeg, lonDeg) {
  const lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return tzLookup(Math.max(-90, Math.min(90, latDeg)), lon);
}

export function createFlightClock(element) {
  let second, zone, clockFormat, dateFormat, latest;
  const time = element.querySelector('time');
  const zoneLabel = element.querySelector('[data-clock-zone]');
  const detail = element.querySelector('[data-clock-detail]');
  const phaseLabel = element.querySelector('[data-clock-phase]');
  return {
    update({ utcMs, latDeg, lonDeg, phase, inSpace = false, hidden = false }) {
      element.hidden = hidden;
      if (hidden) return;
      const nextSecond = Math.floor(utcMs / 1000);
      if (nextSecond === second && latest?.inSpace === inSpace) return;
      second = nextSecond;
      const nextZone = inSpace ? 'UTC' : flightTimeZone(latDeg, lonDeg);
      if (zone !== nextZone) {
        zone = nextZone;
        clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' });
        dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: 'short', year: 'numeric' });
      }
      const parts = clockFormat.formatToParts(utcMs);
      const value = type => parts.find(p => p.type === type)?.value || '';
      const offset = value('timeZoneName').replace('GMT', 'UTC');
      const nautical = zone.startsWith('Etc/');
      time.textContent = `${value('hour')}:${value('minute')}:${value('second')}`;
      time.dateTime = new Date(utcMs).toISOString();
      zoneLabel.textContent = `${nautical ? 'Nautical time' : zone.replaceAll('_', ' ')} · ${offset}`;
      detail.textContent = `${dateFormat.format(utcMs)} · ${inSpace ? 'UTC' : 'Local time'}`;
      phaseLabel.textContent = inSpace ? 'Live' : phase;
      element.dataset.phase = inSpace ? 'Space' : phase;
      latest = { utcMs, zone, offset, time: time.textContent, phase, inSpace };
    },
    diagnostics: () => latest,
  };
}
