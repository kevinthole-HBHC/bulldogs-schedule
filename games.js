/* Highland Bulldogs – shared schedule reader.
   Reads games.ics (refreshed hourly by the GitHub Action) and turns each game into
   a simple object used by both the strip (index.html) and the calendar (calendar.html). */
(function(){
  var CONFIG = {
    HOME_RINK: "R.P. Lumber",   // games at a rink containing this text are HOME games
    US_NAME: "Highland",
    US_ABBR: "HHS",
    TZ: "America/Chicago"
  };

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function abbr(name){
    var n = name.replace(/[^A-Za-z\s]/g,"").trim();
    if (/^[A-Z]{2,5}$/.test(n)) return n;
    var w = n.split(/\s+/);
    return (w.length > 1 ? w.map(function(x){return x[0];}).join("") : n.slice(0,3)).toUpperCase().slice(0,4);
  }

  function unescapeIcs(v){ return v.replace(/\\n/gi,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\"); }
  function parseIcsDate(v){
    var m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return null;
    if (m[7]) return new Date(Date.UTC(+m[1], m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)));
    return new Date(+m[1], m[2]-1, +m[3], +(m[4]||0), +(m[5]||0));
  }
  function parseDuration(v){
    var m = (v||"").match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
    if (!m) return 3600000;
    return (((+m[1]||0)*24 + (+m[2]||0))*60 + (+m[3]||0))*60000 || 3600000;
  }
  function readIcs(text){
    var lines = text.replace(/\r\n?/g,"\n").replace(/\n[ \t]/g,"").split("\n");
    var events = [], cur = null;
    lines.forEach(function(line){
      line = line.replace(/\s+$/,"");
      if (/^BEGIN:VEVENT$/i.test(line)) cur = {};
      else if (/^END:VEVENT/i.test(line)){ if (cur) events.push(cur); cur = null; }
      else if (cur){
        var i = line.indexOf(":"); if (i < 0) return;
        cur[line.slice(0,i).split(";")[0].toUpperCase()] = line.slice(i+1);
      }
    });
    return events;
  }

  function fmt(date, opts){ return new Intl.DateTimeFormat("en-US", Object.assign({timeZone: CONFIG.TZ}, opts)).format(date); }
  function dayKey(date){ // YYYY-MM-DD in Central time
    return new Intl.DateTimeFormat("en-CA", {timeZone: CONFIG.TZ, year:"numeric", month:"2-digit", day:"2-digit"}).format(date);
  }

  function toGame(ev){
    var text = unescapeIcs(ev.SUMMARY || "");
    if (!/\bgame\b/i.test(text)) return null;
    var start = parseIcsDate(ev.DTSTART || ""); if (!start) return null;
    var end = ev.DTEND ? parseIcsDate(ev.DTEND) : new Date(start.getTime() + parseDuration(ev.DURATION));
    var m = text.match(/\b(vs\.?|at|@)\s+(.+?)\s*(\(|$)/i);
    var opp = m ? m[2].trim() : text.replace(/^.*?:\s*/,"");
    var arrive = (text.match(/\(([^)]*arrive[^)]*)\)/i) || [])[1] || "";
    var loc = unescapeIcs(ev.LOCATION || "");
    var lines = loc.split("\n");
    var rink = lines[0].trim();
    return {
      team: unescapeIcs(ev.CATEGORIES || "").split(",")[0].trim(),
      opp: opp, oppAbbr: abbr(opp),
      home: rink.toLowerCase().indexOf(CONFIG.HOME_RINK.toLowerCase()) !== -1,
      rink: rink, address: lines.slice(1).join(", ").trim(), arrive: arrive,
      cancelled: /^cancel/i.test(text) || /CANCEL/i.test(ev.STATUS || ""),
      start: start, end: end, key: dayKey(start),
      weekday: fmt(start,{weekday:"short"}), month: fmt(start,{month:"short"}), day: fmt(start,{day:"numeric"}),
      time: fmt(start,{hour:"numeric", minute:"2-digit"}),
      longDate: fmt(start,{weekday:"long", month:"long", day:"numeric", year:"numeric"}),
      map: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loc.replace(/\n/g, ", "))
    };
  }

  function loadGames(){
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function(){ if (ctl) ctl.abort(); }, 15000);
    return fetch("games.ics?t=" + Date.now(), ctl ? {signal: ctl.signal, cache: "no-store"} : {cache: "no-store"})
      .then(function(r){ clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function(text){
        return readIcs(text).map(toGame).filter(Boolean).sort(function(a,b){ return a.start - b.start; });
      });
  }

  window.HB = { CONFIG: CONFIG, esc: esc, loadGames: loadGames, dayKey: dayKey, fmt: fmt };
})();
