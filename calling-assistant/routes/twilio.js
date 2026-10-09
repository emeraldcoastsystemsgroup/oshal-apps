'use strict';
const {createHmac,timingSafeEqual} = require('node:crypto');
const {fault} = require('./policy');
const base = 'https://api.twilio.com/2010-04-01';
function credentials(raw) {
  if (typeof raw !== 'string' || !/^AC[0-9a-f]{32}:[0-9a-f]{32}$/i.test(raw)) throw fault('twilio_connection_unavailable',409);
  const [sid,token] = raw.split(':'); return {sid,token};
}
function validSignature(credential,url,body,signature) {
  if (!signature || !body || Object.values(body).some(v => typeof v !== 'string')) return false;
  let input = url;
  for (const key of Object.keys(body).sort()) input += key + body[key];
  const expected = createHmac('sha1',credential.token).update(input).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a,b);
}
class Twilio {
  constructor(credential, transport = fetch) { this.credential=credential; this.transport=transport; }
  async request(path, method='GET', values) {
    if (!/^\/(Calls|IncomingPhoneNumbers|Recordings)(?:\/(?:CA|RE)[0-9a-f]{32})?(?:\.json|\.wav)(?:\?PageSize=100)?$/i.test(path)) throw fault('invalid_carrier_operation');
    const response = await this.transport(`${base}/Accounts/${this.credential.sid}${path}`, { method,
      headers: { Authorization:'Basic '+Buffer.from(`${this.credential.sid}:${this.credential.token}`).toString('base64'), ...(values ? {'Content-Type':'application/x-www-form-urlencoded'} : {}) },
      ...(values ? {body:new URLSearchParams(values)} : {}), signal:AbortSignal.timeout(12000), redirect:'error' });
    if (!response.ok) throw fault('twilio_http_' + response.status,502);
    return response;
  }
  async numbers() { return (await (await this.request('/IncomingPhoneNumbers.json?PageSize=100')).json()).incoming_phone_numbers.filter(n=>n.capabilities?.voice).map(n=>({number:n.phone_number,label:n.friendly_name})); }
  async start(params) { const result=await (await this.request('/Calls.json','POST',params)).json(); if (!/^CA[0-9a-f]{32}$/i.test(result.sid)) throw fault('carrier_response_invalid',502); return result.sid; }
  async stop(sid) { await this.request(`/Calls/${sid}.json`,'POST',{Status:'completed'}); }
  async audio(sid) { const r=await this.request(`/Recordings/${sid}.wav`); const bytes=Buffer.from(await r.arrayBuffer()); if (!bytes.length || bytes.length>4*1024*1024) throw fault('carrier_audio_invalid'); return bytes; }
  async deleteAudio(sid) { await this.request(`/Recordings/${sid}.json`,'DELETE'); }
}
module.exports={Twilio,credentials,validSignature};
