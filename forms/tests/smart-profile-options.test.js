const assert = require('node:assert/strict');
const {test}=require('node:test');
const app=require('../server.js');
// Profiles must never synthesize labels missing from the target form.
test('all profiles preserve exact advertised Likert labels, including Neutro and English', () => {
  const sets = [
    ['Totalmente en desacuerdo', 'En desacuerdo', 'Neutro', 'De acuerdo', 'Totalmente de acuerdo'],
    ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
    ['1', '2', '3', '4', '5'],
  ];
  for (const options of sets) {
    for (const type of ['favorable', 'intermedio', 'desfavorable']) {
      for (let i = 0; i < 100; i++) {
        const result = app.buildAttemptPayload(
          {'entry.42': options[2]}, i, false,
          {enabled:true, type, entryMeta:{'entry.42':{question:'Opinion',options}}}, null
        );
        assert.ok(options.includes(result['entry.42']), JSON.stringify(result));
      }
    }
  }
});
