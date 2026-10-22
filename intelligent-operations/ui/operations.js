/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the authorized incident projection and render local source-format checks without writes or stored credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Normalize explicit adapter mapping drafts locally and invalidate stale identity previews on edits.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Model = window.OperationsModel;
  const Contract = window.OperationsSourceContract;
  const Mapping = window.OperationsAdapterMapping;
  let rows = [], available = false, generation = 0;
  function node(tag, text, className) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }
  function route() {
    if (location.hash === '#main') return;
    const page = ['overview','incidents','sources'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    for (const section of document.querySelectorAll('main>section')) section.hidden = section.id !== page;
    for (const link of document.querySelectorAll('nav [data-page]')) {
      if (link.dataset.page === page) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    }
  }
  function render() {
    const container = $('ticket-list');container.replaceChildren();
    if (!available) { container.append(node('p','Incident tickets are unavailable. Refresh to try again.','empty'));return; }
    const counts = Model.summary(rows);
    for (const [key,value] of Object.entries(counts)) $(key).textContent = String(value);
    const filter = $('ticket-filter').value;
    const shown = rows.filter(row => filter === 'all' || (filter === 'active' ? ['draft','queued','running','awaiting_approval','blocked'].includes(row.status) : ['awaiting_approval','blocked','failed','unknown'].includes(row.status)));
    $('ticket-status').textContent = `${shown.length} of ${rows.length} incident tickets shown.`;
    if (!shown.length) {container.append(node('p',rows.length ? 'No incident tickets match this filter.' : 'No incident tickets were returned for your session.','empty'));return;}
    const wrapper=node('div',undefined,'table-scroll'),table=node('table'),head=node('thead'),header=node('tr');
    for (const title of ['Incident ticket','Queue','Workflow state','Last activity','']) { const th=node('th',title);th.scope='col';header.append(th); }
    head.append(header);table.append(head);const body=node('tbody');
    for (const row of shown) {
      const tr=node('tr');tr.append(node('td',row.title),node('td',row.kind === 'intelligent-operations' ? 'Operations' : 'Processing'),node('td',row.label),node('td',row.updated === null ? 'Time unavailable' : new Date(row.updated).toLocaleString()));
      const cell=node('td'),link=node('a','Open ticket');link.href='/cockpit/?app=intelligent-operations&ticket='+encodeURIComponent(row.id);link.target='_top';cell.append(link);tr.append(cell);body.append(tr);
    }
    table.append(body);wrapper.append(table);container.append(wrapper);
  }
  function unavailable(message) {
    available=false;rows=[];
    for (const id of ['total','active','attention']) $(id).textContent='Unavailable';
    $('read-status').textContent=message;$('read-status').className='read-status error';
    $('ticket-status').textContent=message;render();
  }
  async function refresh() {
    const request=++generation;
    $('read-status').textContent='Reading incident tickets…';$('read-status').className='read-status';
    try {
      const response=await fetch('/api/tickets',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      if(request !== generation)return;
      if(!response.ok) {
        unavailable(response.status===401 ? 'Sign in to read incident tickets.' : response.status===403 ? 'Your session cannot read these tickets. Access is checked by OSHAL.' : `Incident tickets could not be read (HTTP ${response.status}).`);return;
      }
      const body=await response.json();
      if(request !== generation)return;
      rows=Model.tickets(body);available=true;render();
      $('read-status').textContent=`Ticket response read ${new Date().toLocaleTimeString()}. Monitoring health is not part of this response.`;
    } catch {
      if(request === generation)unavailable('Incident tickets could not be read. The connection or response was unavailable.');
    }
  }
  $('load-example').addEventListener('click',()=>{
    $('payload').value=JSON.stringify(Contract.example(),null,2);$('expected-source').value=Contract.example().source;
    $('example-note').hidden=false;$('preview-result').replaceChildren(node('p','Example loaded. Check the format to inspect its identifiers.','muted'));
  });
  $('preview-form').addEventListener('submit',event=>{
    event.preventDefault();const mapping={};
    for(const input of document.querySelectorAll('[data-mapping]'))mapping[input.dataset.mapping]=input.value;
    const result=Mapping.normalize($('payload').value,mapping,$('expected-source').value);
    const out=$('preview-result');out.replaceChildren();
    if(!result.ok) {
      out.append(node('h3','The payload needs attention.','error'));const list=node('ul');
      for(const error of result.errors)list.append(node('li',`${error.path}: ${error.message}`));out.append(list);return;
    }
    out.append(node('h3','Format matches Operations alert v1.'),node('p','This source has not been authenticated, mapped to an inventory asset or accepted for ingestion.','muted'));
    out.append(node('h3','Normalized alert preview'),node('pre',JSON.stringify(result.normalized,null,2)),node('h3','Delivery identity'),node('pre',JSON.stringify(result.deliveryIdentity,null,2)),node('h3','Proposed symptom identity'),node('pre',JSON.stringify(result.symptomIdentity,null,2)));
    out.append(node('p','Delivery identity separates retries from independent events. The symptom identity excludes changing messages, severity and delivery IDs.','muted'));
  });
  $('payload').addEventListener('input',()=>{$('example-note').hidden=true;$('preview-result').replaceChildren(node('p','Payload changed. Check its format again.','muted'));});
  $('expected-source').addEventListener('input',()=>{$('preview-result').replaceChildren(node('p','Expected source changed. Check its format again.','muted'));});
  function mappingChanged() {$('preview-result').replaceChildren(node('p','Mapping draft changed. Check the payload again. Nothing has been saved.','muted'));}
  for(const input of document.querySelectorAll('[data-mapping]'))input.addEventListener('input',mappingChanged);
  $('reset-mapping').addEventListener('click',()=>{for(const input of document.querySelectorAll('[data-mapping]'))input.value=Mapping.DEFAULTS[input.dataset.mapping];mappingChanged();});
  $('ticket-filter').addEventListener('change',render);
  for(const button of document.querySelectorAll('.refresh'))button.addEventListener('click',refresh);
  window.addEventListener('hashchange',route);route();refresh();
})();
