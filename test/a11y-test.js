/* Checks the accessibility settings do what they claim, and that nothing about
 * them can quietly stop working. */

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

var js = read('js/a11y.js');
var css = read('css/a11y.css');
var i18n = read('js/i18n.js');

/* Every setting the panel offers must have somewhere to be stored. */
var defaults = /defaults:\s*\{([^}]+)\}/.exec(js);
check('the settings have defaults', !!defaults);
var keys = (defaults ? defaults[1].match(/(\w+):/g) || [] : []).map(function (k) { return k.slice(0, -1); });
check('five settings are offered', keys.length === 5, keys.join(','));
['text', 'contrast', 'motion', 'messages', 'netlog'].forEach(function (k) {
  check('"' + k + '" is one of them', keys.indexOf(k) >= 0);
});

/* Text scaling only works because every font size is in rem. If someone adds a
   px font-size later, that text stops scaling and this catches it. */
var pxFonts = [];
['tokens', 'layout', 'screens', 'board', 'sidebar', 'online', 'contrast', 'a11y'].forEach(function (n) {
  var f;
  try { f = read('css/' + n + '.css'); } catch (e) { return; }
  var m = f.match(/font-size:\s*[^;]*px/g);
  if (m) pxFonts = pxFonts.concat(m.map(function (x) { return n + '.css: ' + x; }));
});
check('every font size is relative, so text scaling reaches all of it',
      pxFonts.length === 0, pxFonts.slice(0, 4).join(' | '));

/* The scales must actually differ, and go up. */
var scale = /SCALE:\s*\{([^}]+)\}/.exec(js);
check('three text sizes are defined', !!scale);
if (scale) {
  var vals = (scale[1].match(/(\d+)%/g) || []).map(function (v) { return parseInt(v, 10); });
  check('the sizes increase', vals.length === 3 && vals[0] < vals[1] && vals[1] < vals[2],
        vals.join(' < '));
  check('the largest is a real increase', vals[2] >= 125, vals[2] + '%');
}

/* Reduced motion has to stop the game's own timers, not just CSS animation. */
check('reduced motion reaches the game timings',
      /state\.reducedMotion\s*=/.test(js), 'not wired to state');
check('reduced motion is also enforced in CSS',
      /\.no-motion/.test(css), 'no .no-motion rules');

/* Removing the pulse would remove the clearest signal of a playable piece, so
   something static must replace it. */
check('a playable piece is still marked when motion is off',
      /\.no-motion \.token\.legal[\s\S]{0,200}box-shadow/.test(css),
      'no static replacement for the pulse');

/* The system settings should be honoured when nothing has been chosen. */
check('it follows the system contrast setting', /prefers-contrast/.test(js));
check('it follows the system motion setting', /prefers-reduced-motion/.test(js));

/* Every label the panel asks for must exist in every language. */
var rows = js.match(/"(a11y\.\w+)"/g) || [];
var wanted = {};
rows.forEach(function (r) { wanted[r.replace(/"/g, '')] = true; });
check('the panel asks for a good number of labels',
      Object.keys(wanted).length >= 12, Object.keys(wanted).length + ' labels');

['en', 'kn', 'hi', 'es'].forEach(function (lang) {
  var block = new RegExp('    ' + lang + ': \\{([\\s\\S]*?)\\n    \\}').exec(i18n);
  if (!block) { fails.push(lang + ' has no table'); return; }
  var missing = Object.keys(wanted).filter(function (k) {
    return block[1].indexOf('"' + k + '"') < 0;
  });
  check(lang + ' has every accessibility label', missing.length === 0,
        missing.slice(0, 4).join(', '));
});

/* The old Display control was replaced by the panel; its keys should be gone
   rather than left behind to rot. */
check('the replaced Display keys are gone',
      i18n.indexOf('"setup.highContrast"') < 0, 'setup.highContrast still present');

/* Two guards against the failure that once blanked the setup screen: a cached
   script from an earlier release meeting fresh markup. */
var main = read('js/main.js');
var idxApply = main.indexOf('I18N.apply()');
var idxWire = main.indexOf('WIRE UP');
var applyAfterWire = main.indexOf('I18N.apply()', idxWire);
var firstListener = main.indexOf('addEventListener', idxWire);
check('the words go in before anything that can throw',
      applyAfterWire > 0 && applyAfterWire < firstListener,
      'apply at ' + applyAfterWire + ', first listener at ' + firstListener);

check('no listener is attached without checking the element exists',
      !/el\("[a-z0-9-]+"\)\.addEventListener/.test(main),
      'found an unguarded addEventListener');

var page = read('index.html');

/* The setup screen's spacing comes from the panel, so the shared settings block
   only sits at the right distance from everything else once it has been moved
   into a panel. That used to happen on the first tab click, which meant the
   page as first served was spaced differently from the page after you had
   pressed anything — the gaps closed up until you switched tabs and came back.
   Two things keep it honest, and both are checked here: the markup already has
   the block in the tab that opens first, and the script settles the tab at load
   rather than waiting for a click. */
var atPanel = page.indexOf('id="panel-local"');
var atSettings = page.indexOf('id="game-settings"');
check('the shared settings start inside a panel, not loose above them',
      atPanel >= 0 && atSettings > atPanel,
      'panel at ' + atPanel + ', settings at ' + atSettings);
check('and inside that panel\'s slot',
      page.slice(atPanel, atSettings).indexOf('class="panel-slot"') >= 0);

/* syncCPUOptions rules out computer counts that have no seat for them. An
   option that is switched off but styled like every other one is worse than no
   option at all — it looks pressable and does nothing. */
var screens = read('css/screens.css');
check('an unavailable option looks unavailable',
      /input:disabled\s*\+\s*label/.test(screens));
check('and stays legible in high contrast',
      /input:disabled\s*\+\s*label/.test(read('css/contrast.css')));

var depth = 0, selectsAtLoad = false;
main.split('\n').forEach(function (line) {
  if (depth === 0 && /^\s*selectTab\(/.test(line)) selectsAtLoad = true;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}') depth--;
  }
});
check('the opening tab is chosen at load, not on the first click', selectsAtLoad);

/* Someone who needs larger text or more contrast usually finds that out
   mid-game, so the control has to be on the board screen too, not only on
   setup — and directly under the log, where it is out of the way of play. */
var gameAt = page.indexOf('id="game-screen"');
var logAt = page.indexOf('id="log"', gameAt);
var btnAt = page.indexOf('id="a11y-btn"', gameAt);
var footAt = page.indexOf('class="sidebar-foot"', gameAt);
check('the accessibility control is reachable during a game',
      gameAt >= 0 && btnAt > gameAt, 'game at ' + gameAt + ', control at ' + btnAt);
check('and it sits directly below the log',
      btnAt > logAt && btnAt < footAt,
      'log ' + logAt + ', control ' + btnAt + ', foot ' + footAt);
check('the setup screen keeps its own',
      page.indexOf('id="a11y-btn-setup"') >= 0);

/* The panel's own button used to be a dashed outline over nothing, which reads
   as a placeholder rather than a control — the opposite of what something
   people need to find should look like. */
['a11y-btn', 'howto-btn'].forEach(function (name) {
  var rule = new RegExp('\\.' + name + '\\s*\\{[^}]*\\}');
  var block = (rule.exec(css) || rule.exec(read('css/online.css')) || [''])[0];
  check(name + ' is drawn solid, not dashed', block.indexOf('dashed') < 0, block.slice(0, 90));
  check(name + ' has a fill of its own', /background:\s*rgba/.test(block), block.slice(0, 90));
});

/* The panel is called Settings now — "accessibility" is a long word in every
   language here and a narrow one in meaning, since language and player names
   live in the same panel. */
check('the panel is not called accessibility any more',
      i18n.indexOf('"a11y.title": "Accessibility"') < 0);
['seats.title', 'seats.hint', 'seats.nameFor', 'seats.colourFor'].forEach(function (k) {
  check('every language has ' + k,
        (i18n.match(new RegExp('"' + k.replace('.', '\\.') + '"', 'g')) || []).length === 4);
});

/* Two players in one colour would make the board unreadable, so a colour is
   traded rather than copied. */
var seats = read('js/seats.js');
check('choosing a taken colour trades for it', /row\.colour = mine/.test(seats));
check('and a saved file that collides is repaired', /spare\.shift\(\)/.test(seats));

/* The log scrolls past faster than anyone can read while pieces are moving, so
   there is a panel that keeps all of it. */
/* Walking the game back belongs beside the board, not only inside a panel. */
check('the step controls sit with the board',
      page.indexOf('id="history-bar"') > page.indexOf('class="board-col"'),
      'the controls are not in the board column');
['history-drawer', 'history-list', 'history-btn', 'history-close',
 'history-bar', 'history-back', 'history-forward', 'history-now'].forEach(function (id) {
  check('the game log has its ' + id, page.indexOf('id="' + id + '"') >= 0);
});
var renderSrc = read('js/render.js');
/* The sidebar used to carry a second, shorter copy of the log, which was a lot
   of room given over to something you could not read back. There is one now. */
check('there is one log, and it is the panel',
      (renderSrc.match(/textContent = logText\(entry\)/g) || []).length === 1,
      'a second copy of the log has come back');
check('the sidebar no longer holds one', page.indexOf('id="log"') < 0);
check('and a long game is not truncated to the last few lines',
      /logEntries\.length > 600/.test(renderSrc));
['history.title', 'history.hint', 'history.empty'].forEach(function (k) {
  check('every language has ' + k,
        (i18n.match(new RegExp('"' + k.replace('.', '\\.') + '"', 'g')) || []).length === 4);
});

/* Two players choosing one colour is the host's problem to settle, not each
   browser's to guess. */
var seatsSrc = read('js/seats.js');
check('a browser can be told what the table settled on', /useRemote:/.test(seatsSrc));
check('and prefers that to its own preference', /agreed: function/.test(seatsSrc));
check('editing online offers only your own seat', /soloEditing:/.test(seatsSrc));
check('and a change is sent rather than kept', /announce:/.test(seatsSrc));

var assets = page.match(/(?:src|href)="(?:js|css|img)\/[^"]+"/g) || [];
var unstamped = assets.filter(function (a) { return a.indexOf('?v=') < 0; });
check('every asset is version-stamped, so markup and scripts cannot mismatch',
      unstamped.length === 0, unstamped.slice(0, 3).join(' '));

/* A phone with no icon to use invents one, so the home-screen identity is part
   of the page rather than an optional extra. */
['apple-touch-icon', 'rel="manifest"', 'theme-color'].forEach(function (needed) {
  check('the page declares ' + needed, page.indexOf(needed) >= 0);
});
check('an icon is offered at the size iOS asks for',
      /apple-touch-icon"?[^>]*icon-180\.png/.test(page) ||
      /href="img\/icon-180\.png/.test(page));

print('');
print('settings: '  + keys.join(', '));
print('assets stamped: ' + assets.length);
if (!fails.length) {
  print('✅ all accessibility checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
