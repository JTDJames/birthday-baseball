/**
 * Add events to calendar (.ics download + Google Calendar link).
 * Event times match index.html (Sat May 9, 2026). Stored as UTC for broad client support.
 */
(function () {
  /** May 9, 2026 — Pacific (PDT in May) */
  const EVENTS = {
    parkHang: {
      id: "park-hang-20260509",
      title: "JJ Birthday Baseball — Park hang",
      description:
        "Casual pregame meet-up in the park to chill, snack, and enjoy the day together. (JJ Birthday Baseball Day)",
      location: "SF Bay Area (details to follow)",
      startUtc: "20260509T210000Z",
      endUtc: "20260509T230000Z",
    },
    game: {
      id: "giants-game-20260509",
      title: "JJ Birthday Baseball — Giants vs. Pirates",
      description:
        "Giants vs. Pirates. First pitch 6:05 PM. Come celebrate at the ballpark! (Save the Date — JJ Birthday Baseball Day)",
      location: "Oracle Park, San Francisco, CA",
      startUtc: "20260510T010500Z",
      endUtc: "20260510T050500Z",
    },
  };

  function escapeIcsText(str) {
    return String(str)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function buildIcs(ev) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Birthday Baseball//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${ev.id}@birthday-baseball.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ev.startUtc}`,
      `DTEND:${ev.endUtc}`,
      `SUMMARY:${escapeIcsText(ev.title)}`,
      `DESCRIPTION:${escapeIcsText(ev.description)}`,
      `LOCATION:${escapeIcsText(ev.location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  function downloadIcs(filename, content) {
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Google Calendar “template” URLs use YYYYMMDDTHHmmssZ / YYYYMMDDTHHmmssZ */
  function googleCalendarUrl(ev) {
    const d1 = ev.startUtc.replace(/[-:]/g, "");
    const d2 = ev.endUtc.replace(/[-:]/g, "");
    const dates = `${d1}/${d2}`;
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: ev.title,
      details: ev.description,
      location: ev.location,
      dates,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function wirePair(buttonId, googleLinkId, key) {
    const btn = document.getElementById(buttonId);
    const googleLink = document.getElementById(googleLinkId);
    const ev = EVENTS[key];
    if (!btn || !ev) return;

    if (googleLink) {
      googleLink.href = googleCalendarUrl(ev);
    }

    btn.addEventListener("click", () => {
      downloadIcs(`birthday-baseball-${key}.ics`, buildIcs(ev));
    });
  }

  wirePair("calendarParkHang", "calendarParkHangGoogle", "parkHang");
  wirePair("calendarGame", "calendarGameGoogle", "game");
})();
