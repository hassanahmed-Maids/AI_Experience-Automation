'use strict';
// Test harness ONLY. Loads scorer.stage2.js - the verbatim body embedded in Stage 2's
// "Score Contract Month" Code node - and exports the surface scorer.test.js expects, so the same
// assertions run against the copy that actually scores production. Two copies of scoring logic
// only stay in step if the tests can reach both.
const fs = require('fs');
const path = require('path');
const core = fs.readFileSync(path.join(__dirname, 'scorer.stage2.js'), 'utf8');
const names = ['scoreContractMonth', 'VERDICT', 'RED_TYPE', 'KNOWN_TYPE_CODES', 'parseMoney',
  'shiftMonth', 'monthKey', 'classifyFollowup', 'applyVerifier', 'DELIVERED_STATUSES'];
const factory = new Function(core + '\nreturn {' +
  names.map(function (n) { return n + ": typeof " + n + " !== 'undefined' ? " + n + " : undefined"; }).join(', ') +
  '};');
module.exports = factory();
