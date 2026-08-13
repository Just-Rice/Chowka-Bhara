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
check('four settings are offered', keys.length === 4, keys.join(','));
['text', 'contrast', 'motion', 'messages'].forEach(function (k) {
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

print('');
print('settings: ' + keys.join(', '));
if (!fails.length) {
  print('✅ all accessibility checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
