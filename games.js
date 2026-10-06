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

  // scores.csv: one line per finished game ->  date,team,highland,opponent[,note]
  // e.g.  2026-10-24,JV,3,2      or  2026-11-02,Varsity,4,3,OT
  function readScores(text){
    var out = {};
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^date\s*,/i.test(line)) return;
      var c = line.split(",").map(function(x){ return x.trim(); });
      if (c.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0]) || isNaN(+c[2]) || isNaN(+c[3])) return;
      out[c[0] + "|" + c[1].toLowerCase()] = { us: +c[2], them: +c[3], note: (c[4] || "").toUpperCase() };
    });
    return out;
  }

  function loadGames(){
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function(){ if (ctl) ctl.abort(); }, 15000);
    var gamesReq = fetch("games.ics?t=" + Date.now(), ctl ? {signal: ctl.signal, cache: "no-store"} : {cache: "no-store"})
      .then(function(r){ clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    var scoresReq = fetch("scores.csv?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; }).catch(function(){ return ""; });
    return Promise.all([gamesReq, scoresReq]).then(function(res){
      var scores = readScores(res[1]);
      return readIcs(res[0]).map(toGame).filter(Boolean).map(function(g){
        var sc = scores[g.key + "|" + g.team.toLowerCase()];
        if (sc){
          g.us = sc.us; g.them = sc.them; g.note = sc.note;
          g.result = sc.us > sc.them ? "W" : sc.us < sc.them ? "L" : "T";
        }
        return g;
      }).sort(function(a,b){ return a.start - b.start; });
    });
  }

  window.HB = { CONFIG: CONFIG, esc: esc, loadGames: loadGames, dayKey: dayKey, fmt: fmt };
})();
