/* Checks the high-contrast palette actually is high contrast.
 *
 * The numbers are WCAG contrast ratios. 3:1 is the floor for a shape to be
 * distinguishable; this aims at 4.5:1, the floor for text, because a game piece
 * on a textured board is harder to pick out than a letter on a flat one.
 *
 * It reads the real values out of css/contrast.css, so the test fails if
 * somebody retunes a colour and drops below the line. */

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

function srgb(v) {
  v = v / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lum(hex) {
  var h = hex.replace('#', '');
  var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a, b) {
  var la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/* What a colour becomes under a translucent black scrim. */
function scrim(hex, alpha) {
  var h = hex.replace('#', ''), out = '#';
  for (var i = 0; i < 3; i++) {
    var v = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    var n = Math.round(v * (1 - alpha)).toString(16);
    out += n.length < 2 ? '0' + n : n;
  }
  return out;
}

var css = read('css/contrast.css');

function value(name) {
  var m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(css);
  return m && m[1];
}

var players = ['p-madder', 'p-indigo', 'p-turmeric', 'p-areca'];
var colours = {};
players.forEach(function (p) { colours[p] = value(p); });

check('the palette defines every player',
      players.every(function (p) { return !!colours[p]; }),
      JSON.stringify(colours));

/* The scrim strength, read from the stylesheet rather than assumed. */
var sm = /\.hc \.cell::after[\s\S]*?rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\s*\)/.exec(css);
check('the board scrim is defined', !!sm, sm ? sm[1] : 'not found');
var alpha = sm ? parseFloat(sm[1]) : 0;
check('the scrim is strong enough to matter', alpha >= 0.3, String(alpha));

/* Board rings come from the ordinary palette; the scrim darkens them. */
var rings = { outer: '#33415a', mid: '#29344a', inner: '#202940' };
var scrimmed = {};
Object.keys(rings).forEach(function (k) { scrimmed[k] = scrim(rings[k], alpha); });

players.forEach(function (p) {
  Object.keys(scrimmed).forEach(function (ring) {
    var r = ratio(colours[p], scrimmed[ring]);
    check(p + ' reads against the ' + ring + ' ring', r >= 4.5, r.toFixed(2) + ':1');
  });
});

/* And they must be distinguishable from one another, not just from the board. */
for (var i = 0; i < players.length; i++) {
  for (var j = i + 1; j < players.length; j++) {
    var a = colours[players[i]], b = colours[players[j]];
    var same = a.toLowerCase() === b.toLowerCase();
    check(players[i] + ' and ' + players[j] + ' are different colours', !same, a);
  }
}

/* Text has to clear 4.5:1 on the panel too, not just the pieces on the board. */
var panel = /--mat:\s*(#[0-9a-fA-F]{6})/.exec(css);
var inkText = /--ink-text:\s*(#[0-9a-fA-F]{6})/.exec(css);
check('the sidebar defines its own panel and text colours', !!panel && !!inkText);
if (panel && inkText) {
  var r = ratio(inkText[1], panel[1]);
  check('sidebar text reads against the panel', r >= 7, r.toFixed(2) + ':1');
}

/* Nothing may leak into the ordinary look. */
var selectors = css.match(/^\.[^{@\/\s][^{]*\{/gm) || [];
var unscoped = selectors.filter(function (s) { return s.indexOf('.hc') !== 0; });
check('every rule is scoped to .hc', unscoped.length === 0, unscoped.join(' '));

/* ------------------------------------------------------------- report -- */

print('');
players.forEach(function (p) {
  var worst = Math.min.apply(null, Object.keys(scrimmed).map(function (k) {
    return ratio(colours[p], scrimmed[k]);
  }));
  print('  ' + p.replace('p-', '') + '  ' + colours[p] + '  worst ' + worst.toFixed(1) + ':1');
});
print('');
if (!fails.length) {
  print('✅ all contrast checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
