/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify exact signed/unsigned native integers, floating-token distinctions and public wire/inspection projections.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import{parseNative,stringifyNative,hasWideInteger,wireProject,readProject,decimalId,isNativeNumber}from'../tools/native-json.mjs';
import{inspectProject}from'../routes/project-inspection.mjs';
test('all native i64/u64 endpoints and unsafe odd integers retain decimal bits without global prototype patches',()=>{
 const text='{"max":18446744073709551615,"min":-9223372036854775808,"tick":9007199254740993,"small":42}';
 const value=parseNative(text);assert.equal(value.max,18446744073709551615n);assert.equal(value.min,-9223372036854775808n);assert.equal(value.tick,9007199254740993n);assert.equal(value.small,42);assert.equal(stringifyNative(value),text);
 assert.equal(BigInt.prototype.toJSON,undefined);
});
test('unsafe fractional/exponent tokens keep their numeric spelling instead of becoming integer ids',()=>{
 for(const literal of ['9007199254740993e0','1e100','18446744073709551615.0']){const value=parseNative(literal);assert.ok(isNativeNumber(value));assert.equal(stringifyNative(value),literal);}
 assert.throws(()=>parseNative('1e9999'),/invalid_native_number/);
});
test('authoritative project text roundtrips every field without sending rounded numeric placeholders',()=>{
 const project={id:'own',revision:1,document:parseNative('{"id":9007199254740993,"time":9223372036854775807}')};
 const wire=wireProject(project);assert.equal(wire.document,undefined);assert.equal(hasWideInteger(wire),false);assert.deepEqual(readProject(wire).document,project.document);
 const safe=wireProject({document:{id:1}});assert.deepEqual(safe.document,{id:1});
});
test('agent scalar pages expose exact integer and floating literals with explicit encodings',()=>{
 const project={id:'own',revision:1,title:'Precise',document:parseNative('{"integer":9007199254740993,"float":1e100}')};
 const integer=inspectProject(project,{node:'0'});assert.equal(integer.type,'integer');assert.equal(integer.value,'9007199254740993');assert.equal(integer.valueEncoding,'decimal-integer');
 const floating=inspectProject(project,{node:'1'});assert.equal(floating.type,'number');assert.equal(floating.value,'1e100');assert.equal(floating.valueEncoding,'json-number-literal');
});
test('prototype-shaped keys remain ordinary data and decimal ids reject syntax and u64 overflow',()=>{
 const value=parseNative('{"__proto__":{"x":9007199254740993}}');assert.equal(Object.getPrototypeOf(value),Object.prototype);assert.equal(value.__proto__.x,9007199254740993n);assert.equal({}.x,undefined);
 assert.equal(decimalId('18446744073709551615'),18446744073709551615n);for(const invalid of ['01','-1','1e3','18446744073709551616'])assert.throws(()=>decimalId(invalid));
});
