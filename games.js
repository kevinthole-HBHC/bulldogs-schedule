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
    // events without an opponent (e.g. "Varsity 26-27 Alumni game") show their own name, minus the team label
    var opp = m ? m[2].trim() : text.replace(/^[^:]*:\s*/,"").replace(/\b(varsity|jv)\s+\d{2}-\d{2}\s*/i,"").trim()
      .replace(/\b\w/g, function(ch){ return ch.toUpperCase(); });
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

  // scores.csv: one line per finished game ->  date,team,highland,opponent[,note][,video link]
  // e.g.  2026-10-24,JV,3,2,https://youtu.be/abc123
  //       2026-11-02,Varsity,4,3,OT,https://youtu.be/def456
  // The note (OT or SO) and the video link are optional, in either order.
  function readScores(text){
    var out = {};
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^date\s*,/i.test(line)) return;
      var c = line.split(",").map(function(x){ return x.trim(); });
      c[0] = normDate(c[0]);
      if (c.length < 2 || !c[0]) return;
      var rec = { note: "", video: "" };
      c.slice(4).forEach(function(x){
        if (/^https?:\/\/[^\s"'<>]+$/i.test(x)) rec.video = x;
        else if (x) rec.note = x.toUpperCase();
      });
      var hasScore = c[2] !== undefined && c[3] !== undefined && c[2] !== "" && c[3] !== "" && !isNaN(+c[2]) && !isNaN(+c[3]);
      if (hasScore){ rec.us = +c[2]; rec.them = +c[3]; }
      if (!hasScore && !rec.video) return;
      out[c[0] + "|" + c[1].toLowerCase()] = rec;
    });
    return out;
  }

  // accepts 2026-12-5 or 2026-12-05; returns "" if it isn't a date
  function normDate(v){
    var m = (v || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : "";
  }

  // promos.csv: one line per game with a special note ->  date,team,message[,link]
  // e.g.  2026-12-05,Varsity,Free Highland Student Admission courtesy of Apex Network Physical Therapy,https://apexnetworkpt.com/
  // Leave the team blank to apply to every HBHC game that day. The link (a sponsor's website) is optional.
  function readPromos(text){
    var out = [];
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^date\s*,/i.test(line)) return;
      var c = line.split(","), d = normDate(c[0]);
      var rest = c.slice(2), link = "";
      var last = (rest[rest.length - 1] || "").trim();
      if (rest.length > 1 && /^https?:\/\/[^\s"'<>]+$/i.test(last)){ link = last; rest.pop(); }
      var msg = rest.join(",").trim();
      if (!d || !msg) return;
      out.push({ key: d, team: (c[1] || "").trim().toLowerCase(), text: msg, link: link });
    });
    return out;
  }

  // sponsors.csv: one line per sponsor ->  name,link
  function readSponsors(text){
    var out = [];
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^name\s*,/i.test(line)) return;
      var c = line.split(","), last = (c[c.length - 1] || "").trim(), link = "";
      if (c.length > 1 && /^https?:\/\/[^\s"'<>]+$/i.test(last)){ link = last; c.pop(); }
      var name = c.join(",").trim();
      if (name) out.push({ name: name, link: link });
    });
    return out;
  }

  // holidays.csv: date,message,picture  (picture: thanksgiving, christmas, newyear)
  function readHolidays(text){
    var out = [];
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^date\s*,/i.test(line)) return;
      var c = line.split(","), d = normDate(c[0]);
      var art = (c.length > 2 ? c.pop() : "").trim().toLowerCase();
      var msg = c.slice(1).join(",").trim();
      if (d && msg) out.push({ key: d, text: msg, art: art });
    });
    return out;
  }

  // homeaway.csv: fixes for games the rink guess gets wrong ->  date,team,home|away
  function readHomeAway(text){
    var out = {};
    text.split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === "#" || /^date\s*,/i.test(line)) return;
      var c = line.split(",").map(function(x){ return x.trim(); }), d = normDate(c[0]);
      var v = (c[2] || "").toLowerCase();
      if (d && (v === "home" || v === "away")) out[d + "|" + (c[1] || "").toLowerCase()] = v === "home";
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
    var promosReq = fetch("promos.csv?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; }).catch(function(){ return ""; });
    var sponsorsReq = fetch("sponsors.csv?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; }).catch(function(){ return ""; });
    var holidaysReq = fetch("holidays.csv?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; }).catch(function(){ return ""; });
    var homeAwayReq = fetch("homeaway.csv?t=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; }).catch(function(){ return ""; });
    return Promise.all([gamesReq, scoresReq, promosReq, sponsorsReq, holidaysReq, homeAwayReq]).then(function(res){
      var homeAway = readHomeAway(res[5]);
      HB.holidays = readHolidays(res[4]);
      var scores = readScores(res[1]), promos = readPromos(res[2]), sponsors = readSponsors(res[3]);
      HB.sponsors = sponsors;
      return readIcs(res[0]).map(toGame).filter(Boolean).map(function(g){
        var ha = homeAway[g.key + "|" + g.team.toLowerCase()];
        if (ha === undefined) ha = homeAway[g.key + "|"];      // team left blank: every game that day
        if (ha !== undefined) g.home = ha;
        var sc = scores[g.key + "|" + g.team.toLowerCase()];
        if (sc){
          if (sc.us != null){
            g.us = sc.us; g.them = sc.them; g.note = sc.note;
            g.result = sc.us > sc.them ? "W" : sc.us < sc.them ? "L" : "T";
          }
          if (sc.video) g.video = sc.video;
        }
        promos.forEach(function(p){
          if (p.key === g.key && (!p.team || p.team === g.team.toLowerCase())){ g.promo = p.text; g.promoLink = p.link;
            g.sponsors = p.link ? [] : sponsors; }   // no link given: thank all sponsors, in rotation
        });
        return g;
      }).sort(function(a,b){ return a.start - b.start; });
    });
  }

  var HB = window.HB = { CONFIG: CONFIG, esc: esc, loadGames: loadGames, dayKey: dayKey, fmt: fmt, sponsors: [], holidays: [] };
})();
