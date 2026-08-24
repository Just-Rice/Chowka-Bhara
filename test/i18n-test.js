/* Checks the translation table is complete and consistent, and that nothing
 * in the game still hard-codes English where it should look a string up.
 *
 * A missing key falls back to English rather than showing blank, so these
 * failures are cosmetic rather than fatal — but a half-translated screen looks
 * worse than an untranslated one. */

var root = this;
load('js/i18n.js');
var I18N = root.I18N;
var STRINGS = I18N._strings;

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

/* --------------------------------------------------- complete coverage -- */

var enKeys = Object.keys(STRINGS.en).sort();
check('English is the largest table', enKeys.length > 90, enKeys.length + ' keys');

Object.keys(STRINGS).forEach(function (code) {
  if (code === 'en') return;
  var keys = Object.keys(STRINGS[code]);
  var missing = enKeys.filter(function (k) { return !(k in STRINGS[code]); });
  var extra = keys.filter(function (k) { return !(k in STRINGS.en); });
  check(code + ' has every English key', missing.length === 0,
        missing.length + ' missing: ' + missing.slice(0, 5).join(', '));
  check(code + ' has no keys English lacks', extra.length === 0,
        extra.join(', '));
});

/* ------------------------------------------------ placeholders line up -- */

function placeholders(s) {
  var out = (String(s).match(/\{[a-zA-Z]+\}/g) || []).slice();
  out.sort();
  return out.join(',');
}

Object.keys(STRINGS).forEach(function (code) {
  if (code === 'en') return;
  enKeys.forEach(function (k) {
    if (!(k in STRINGS[code])) return;
    var want = placeholders(STRINGS.en[k]);
    var got = placeholders(STRINGS[code][k]);
    check(code + ' placeholders match for "' + k + '"', want === got,
          'en has [' + want + '], ' + code + ' has [' + got + ']');
  });
});

/* -------------------------------------------------- nothing left blank -- */

Object.keys(STRINGS).forEach(function (code) {
  Object.keys(STRINGS[code]).forEach(function (k) {
    check(code + '.' + k + ' is not empty',
          String(STRINGS[code][k]).trim().length > 0);
  });
});

/* ---------------------------------------- non-English is actually translated */

/* A value identical to English usually means a forgotten line. Proper nouns and
 * bare punctuation are legitimately the same, so those are allowed through. */
var SAME_OK = {
  kn: ['net.online'],
  hi: ['net.online'],
  // Words that are genuinely the same in Spanish, not forgotten lines.
  es: ['net.online', 'players.areca', 'lobby.computer', 'a11y.textNormal',
       'a11y.contrastOff']
};
Object.keys(STRINGS).forEach(function (code) {
  if (code === 'en') return;
  var copied = enKeys.filter(function (k) {
    if ((SAME_OK[code] || []).indexOf(k) >= 0) return false;
    return STRINGS[code][k] === STRINGS.en[k];
  });
  check(code + ' does not simply copy English', copied.length === 0,
        copied.slice(0, 6).join(', '));
});

/* --------------------------------------------------------- the lookup --- */

I18N.set('en');
check('substitution fills placeholders',
      I18N.t('game.turn', { name: 'Indigo' }) === "Indigo's turn",
      I18N.t('game.turn', { name: 'Indigo' }));
check('an unknown key returns the key rather than blank',
      I18N.t('nope.nothing') === 'nope.nothing');

I18N.set('kn');
check('switching language changes the output',
      I18N.t('btn.throw') !== STRINGS.en['btn.throw'], I18N.t('btn.throw'));
check('a key missing from a table falls back to English',
      I18N.t('app.tagline').length > 0);
I18N.set('en');

check('an unknown language code is refused', I18N.set('zz') === false);
check('every advertised language has a table',
      I18N.langs.every(function (l) { return !!STRINGS[l.code]; }),
      I18N.langs.map(function (l) { return l.code; }).join(','));
check('language labels are in their own script',
      I18N.langs.map(function (l) { return l.label; }).join(' ')
        .indexOf('Kannada') < 0);

/* ------------------------------------------- words that do not survive --- */

/* Literal translation produces words that are technically correct and that
   nobody uses. These are the ones that were actually found and replaced —
   textbook coinages where the borrowed word is what people say, and abstract
   nouns standing in for actions. Listing them stops them coming back.
   \u0917\u0923\u0915 = "reckoner" for computer, \u0915\u0915\u094d\u0937 = a classroom, and so on. */
var CALQUES = {
  kn: ['\u0c97\u0ca3\u0c95', '\u0c95\u0cca\u0ca0\u0ca1\u0cbf', '\u0c86\u0ca4\u0cbf\u0ca5\u0ccd\u0caf ', '\u0cb8\u0c82\u0c9c\u0ccd\u0c9e\u0cc6', '\u0c97\u0ccd\u0cb0\u0c82\u0ca5\u0cbe\u0cb2\u0caf'],
  hi: ['\u0915\u0915\u094d\u0937', '\u0922\u0940\u0932\u093e \u0916\u0947\u0932\u0924\u093e']
};
Object.keys(CALQUES).forEach(function (lang) {
  CALQUES[lang].forEach(function (word) {
    var found = Object.keys(STRINGS[lang]).filter(function (k) {
      return String(STRINGS[lang][k]).indexOf(word) >= 0;
    });
    check(lang + ' does not use "' + word + '"', found.length === 0,
          found.slice(0, 3).join(', '));
  });
});

/* ----------------------------------- the game asks for keys that exist --- */

/* Keys appear as t("...") in the modules and as data-i18n in the markup. */
var SRC = read('index.html') + '\n' +
  ['config','path','rules','ai','render','game','online','main','seats','a11y','net']
  .map(function (n) { return read('js/' + n + '.js'); }).join('\n');
var used = {};
/* Modules reach the table either through the t() shorthand or through I18N.t,
   and a key asked for by only one of those still has to exist. */
/* net.js hands its keys to a callback called diag(), since that file has no
   business knowing what language anyone reads in. */
var re = /\b(?:I18N\.)?t\(\s*"([a-zA-Z][a-zA-Z0-9.]*)"|\bdiag\(\s*"([a-zA-Z][a-zA-Z0-9.]*)"/g, m;
while ((m = re.exec(SRC))) used[m[1] || m[2]] = true;
/* data-i18n attributes count too — text, markup and aria labels alike. */
var re2 = /data-i18n(?:-html|-aria)?="([^"]+)"/g;
while ((m = re2.exec(SRC))) used[m[1]] = true;

var unknown = Object.keys(used).filter(function (k) {
  if (k.indexOf('.') < 0) return false;                 // not a translation key
  if (/^(ord|howto)\./.test(k)) return false;           // built by index
  return !(k in STRINGS.en);
});
check('every key the game looks up exists', unknown.length === 0,
      unknown.join(', '));

check('the game actually uses the table', Object.keys(used).length > 50,
      Object.keys(used).length + ' keys referenced');

/* ------------------------------------- and every key it has, it asks for -- */

/* The other direction, which is the one that catches a translated string the
   game has quietly stopped using — or, worse, never started. Five refusal
   messages and four lines of the end-of-game card were sitting here fully
   translated into four languages while the code that should have looked them up
   said the English out loud instead. Nothing in the game failed; it simply
   spoke English to everybody, and the table said otherwise.

   Keys the game builds rather than writes out are exempt, and listed here so
   that the exemption is a decision rather than a hole. */
var BUILT_UP = /^(ord|howto|seat|players|diag)\./;
var everything = read('index.html') + '\n' +
  ['config','path','rules','ai','render','game','online','main','seats','a11y','net']
  .map(function (n) { return read('js/' + n + '.js'); }).join('\n');

var unused = enKeys.filter(function (k) {
  if (BUILT_UP.test(k)) return false;
  return everything.indexOf('"' + k + '"') < 0;
});
check('every string in the table is one the game asks for', unused.length === 0,
      unused.join(', '));

/* How to play is built from a numbered run; make sure it has no holes. */
var howto = enKeys.filter(function (k) { return k.indexOf('howto.') === 0; });
var nums = howto.map(function (k) { return parseInt(k.split('.')[1], 10); })
                .filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
check('how-to-play steps are numbered without gaps',
      nums.every(function (n, i) { return n === i + 1; }), nums.join(','));
check('how to play has a useful number of steps', nums.length >= 10,
      nums.length + ' steps');

/* -------------------------------------------------------------- report -- */

print('');
print('languages: ' + I18N.langs.map(function (l) { return l.code + ' (' + l.label + ')'; }).join(', '));
print('keys per language: ' + enKeys.length);
if (!fails.length) {
  print('✅ all translation checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.slice(0, 25).forEach(function (f) { print('  - ' + f); });
}
