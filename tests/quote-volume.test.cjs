'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const core = require('../plugin/core.js');

function packet(type, volume) {
  const fields = Array(62).fill('');
  Object.assign(fields, { 1:'Example', 3:'100', 4:'99', 5:'98', 6:volume,
    30:'20261106150000', 32:'1.01', 33:'105', 34:'95', 37:'200', 61:type });
  return `v_sh688001="${fields.join('~')}";`;
}
function market(body) {
  const https = { get(_url, _options, callback) {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = error => request.emit('error', error);
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  }};
  const module = { exports:{} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/node/market.cjs'), 'utf8'), {
    module, exports:module.exports, Buffer, URL, URLSearchParams, TextDecoder, Date,
    require(name) {
      if (name === '../calendar.js') return require('../plugin/calendar.js');
      if (name === '../clist.js') return require('../plugin/clist.js');
      if (name === '../kline.js') return require('../plugin/kline.js');
      if (name === 'node:crypto') return require('node:crypto');
      if (name === './network.cjs') return require('./helpers/network-fixture.cjs')(https);
      if (name === 'node:https') return https;
      if (name === '../core.js') return core;
      throw new Error('Unexpected dependency: '+name);
    }
  });
  return module.exports;
}

test('ambiguous STAR packet preserves raw volume without inventing share units', async () => {
  const q = (await market(packet('GP-A-KCB', '20000')).quotes(['sh688001'])).sh688001;
  assert.equal(q.volume, null);
  assert.equal(q.volumeRaw, 20000);
  assert.equal(q.volumeUnit, 'unknown');
  assert.match(q.volumeWarning, /口径/);
  assert.equal(q.price, 100);
  assert.equal(q.amount, 2000000);
  assert.equal(q.asOf, Date.parse('2026-11-06T15:00:00+08:00'));
  assert.equal(q.providerInstrumentType, 'GP-A-KCB');
});

test('mainboard legacy conversion remains unchanged', async () => {
  const q = (await market(packet('GP-A', '200')).quotes(['sh688001'])).sh688001;
  assert.equal(q.volume, 20000);
  assert.equal(q.volumeRaw, 200);
  assert.equal(q.price, 100);
  assert.equal(q.amount, 2000000);
});

test('missing raw volume remains missing', async () => {
  const q = (await market(packet('GP-A-KCB', '')).quotes(['sh688001'])).sh688001;
  assert.equal(q.volume, null);
  assert.equal(q.volumeRaw, null);
});
