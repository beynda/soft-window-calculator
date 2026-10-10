import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { calculateQuote } from '../../src/domain/pricing.js';
import { marketConfig, normalizePresentation, withPresentation, t, msg, canonicalLength, inputLength } from '../../src/shared/presentation.js';
import { projectForSubmission } from '../../src/frontend/submission/index.js';
import { renderQuoteSummary, createQuotePrintHtml } from '../../src/frontend/summary/index.js';
import { russian } from '../../src/shared/translations.js';
const config = JSON.parse(readFileSync(new URL('../../storage/config.json', import.meta.url)));
const product = { id:'window-1', type:'window', shape:'rectangle', position:'right', dimensions:{width:127,height:100}, material:'clear-pvc-700', purpose:'opening', hardware:'plastic-turn-button', installation:{mode:'top',edgeOffsetCm:10,spacingCm:20,replaceTopWithGrommets:false},border:{widthCm:10,color:'white'}, extras:{weightBar:false,flashing:false} };
test('inch display roundtrips to canonical metric dimensions without changing geometry', () => {
  withPresentation({language:'en',units:'in',market:'USD'}, () => {
    assert.equal(canonicalLength(50),127);
    assert.ok(Math.abs(canonicalLength(inputLength(120))-120)<1e-7);
    for (const boundary of [7, 15, 20, 1500]) assert.equal(canonicalLength(inputLength(boundary)), boundary);
    assert.equal(msg`Width ${127} cm`,'Width 50 in');
    assert.equal(t('<option value="cm">Centimeters</option>'),'<option value="cm">Centimeters</option>');
  });
  assert.deepEqual(normalizePresentation({language:'ru',units:'in',market:'USD'}),{language:'ru',units:'cm',market:'RUB'});
  withPresentation({language:'ru',units:'cm',market:'RUB'}, () => assert.equal(msg`${'153,81'} cm`, '153,81 см'));
});
test('browser and server use the same Russian translation catalog', () => {
  assert.deepEqual(russian, JSON.parse(readFileSync(new URL('../../server/config/translations.json', import.meta.url))));
});
test('currency profiles have independent rates and preserve fractional cent line items', () => {
  const usd=calculateQuote({version:1,products:[product]},marketConfig(config,'USD'));
  const eur=calculateQuote({version:1,products:[product]},marketConfig(config,'EUR'));
  assert.equal(usd.currency,'USD'); assert.equal(eur.currency,'EUR');
  assert.equal(usd.lineItems[0].amount,22.86);
  assert.notEqual(usd.total,eur.total);
  assert.throws(()=>marketConfig({...config,marketRates:{}},'USD'), /No tariff profile/);
});
test('localized quote exports retain the quote language and do not alter customer values', () => {
  const presentation={language:'ru',units:'cm',market:'RUB'};
  const project={version:1,products:[product],presentation};
  assert.deepEqual(projectForSubmission(project).presentation,presentation);
  const quote={...calculateQuote(project,config),presentation};
  assert.match(renderQuoteSummary(quote),/Итого/);
  assert.match(createQuotePrintHtml(quote),/lang="ru"/);
  withPresentation(presentation,()=>assert.equal(msg`Full name: ${'Width'}`,'Имя: Width'));
});
const php=spawnSync('php',['-v'],{encoding:'utf8'});
test('server recalculates all currency profiles with the same cent totals and rejects forged settings', {skip:php.error?'PHP unavailable':false}, () => {
  for(const market of ['USD','EUR','RUB']) {
    const presentation={language:market==='RUB'?'ru':'en',units:market==='RUB'?'cm':'in',market};
    const project={version:1,products:[product],presentation};
    const expected=calculateQuote(project,marketConfig(config,market));
    const result=spawnSync('php',['tests/server/quote/internationalization.php'],{input:JSON.stringify({project,config}),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const actual=JSON.parse(result.stdout);
    assert.equal(actual.total,expected.total);
    assert.deepEqual(actual.lineItems.map(x=>x.amount),expected.lineItems.map(x=>x.amount));
    assert.deepEqual(actual.presentation,presentation);
  }
  const result=spawnSync('php',['tests/server/quote/internationalization.php'],{input:JSON.stringify({project:{version:1,products:[product],presentation:{language:'ru',units:'in',market:'USD'}},config}),encoding:'utf8'});
  assert.notEqual(result.status,0);
});
