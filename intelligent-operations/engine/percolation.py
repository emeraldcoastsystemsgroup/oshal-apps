"""Immutable stored-query generations on an actual OpenSearch percolator.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Publish, seal and exhaustively match scoped rule generations; incomplete searches never become no-match.
"""
import hashlib
import json
import re
import urllib.error
import urllib.request

FIELDS={'source':'keyword','environment':'keyword','alertType':'keyword','severity':'keyword','status':'keyword','resourceKind':'keyword','resourceScope':'keyword','resourceId':'keyword','time':'date','message':'text'}
HEX=re.compile(r'^[a-f0-9]{64}$')

class Failure(Exception):
    def __init__(self,message,code='backend-unavailable'):super().__init__(message);self.code=code


def validate_query(query,depth=0,budget=None):
    budget=budget or [0];budget[0]+=1
    if depth>8 or budget[0]>128 or not isinstance(query,dict) or len(query)!=1:raise Failure('Query exceeds the supported shape or budget.','invalid-rule')
    kind,value=next(iter(query.items()))
    if kind=='match_all' and value=={}:return
    if kind=='bool' and isinstance(value,dict) and value and set(value)<= {'must','filter','should','must_not','minimum_should_match'}:
        for k,v in value.items():
            if k=='minimum_should_match':
                if type(v)!=int or not 0<=v<=128:raise Failure('Invalid minimum_should_match.','invalid-rule')
            else:
                for child in v if isinstance(v,list) else [v]:validate_query(child,depth+1,budget)
        return
    if kind=='exists' and isinstance(value,dict) and set(value)=={'field'} and value['field'] in FIELDS:return
    if kind in ('term','terms','match','match_phrase','range') and isinstance(value,dict) and len(value)==1:
        field,operand=next(iter(value.items()))
        if field not in FIELDS:raise Failure('Query names an unmapped field.','invalid-rule')
        if kind=='range':
            if field!='time' or not isinstance(operand,dict) or not operand or not set(operand)<={'gt','gte','lt','lte'}:raise Failure('Only explicit time bounds are supported.','invalid-rule')
            values=list(operand.values())
            if any(not isinstance(v,str) or 'now' in v or '||' in v for v in values):raise Failure('Time bounds cannot depend on backend wall time.','invalid-rule')
        else:values=operand if kind=='terms' and isinstance(operand,list) else [operand]
        if not values or len(values)>128 or any(not isinstance(v,str) or len(v)>1024 for v in values):raise Failure('Query values must be bounded strings.','invalid-rule')
        return
    raise Failure('Unsupported stored query operator.','invalid-rule')


def validate_rules(rules):
    if not isinstance(rules,list) or not 1<=len(rules)<=128:raise Failure('Publish 1–128 rules.','invalid-rule')
    seen=set()
    for rule in rules:
        if not isinstance(rule,dict) or set(rule)!={'id','enabled','query'} or not isinstance(rule['id'],str) or not HEX.fullmatch(rule['id']) or rule['id'] in seen or type(rule['enabled'])!=bool:raise Failure('Invalid immutable rule identity.','invalid-rule')
        seen.add(rule['id']);validate_query(rule['query'])
    if len(json.dumps(rules).encode())>65536:raise Failure('Rule generation exceeds 64 KiB.','invalid-rule')


def checked_shards(body):
    shards=body.get('_shards',{})
    total=shards.get('total');successful=shards.get('successful')
    if shards.get('failed')!=0 or type(total)!=int or type(successful)!=int or total<1 or successful!=total:raise Failure('The backend did not complete every required shard.')


class Percolator:
    def __init__(self,base):
        # Installation supplies the backend, never an engine request or a rule.
        self.base=base.rstrip('/');self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())

    def call(self,method,path,body=None,ndjson=False,allowed=(200,201)):
        payload=body.encode() if ndjson else None if body is None else json.dumps(body).encode()
        request=urllib.request.Request(self.base+path,data=payload,method=method,headers={'Content-Type':'application/x-ndjson' if ndjson else 'application/json'})
        try:
            with self.opener.open(request,timeout=8) as response:
                raw=response.read(2*1024*1024+1)
                if len(raw)>2*1024*1024:raise Failure('Backend response exceeds its bound.')
                return response.status,json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code in allowed:return error.code,json.loads(error.read(65536))
            raise Failure('Detection backend refused the operation (HTTP '+str(error.code)+').') from None
        except (OSError,ValueError):raise Failure('Detection backend could not provide a complete response.') from None

    def index(self,scope,revision):
        if not isinstance(scope,str) or not HEX.fullmatch(scope) or not isinstance(revision,str) or not HEX.fullmatch(revision):raise Failure('Invalid scoped generation identity.','invalid-rule')
        return 'ops-rules-'+scope+'-'+revision

    def status(self):
        _,health=self.call('GET','/_cluster/health?wait_for_status=yellow&timeout=3s')
        if health.get('timed_out') is not False or health.get('status') not in ('green','yellow'):raise Failure('Detection backend is not ready.')
        _,version=self.call('GET','/')
        return {'backend':'opensearch','version':version.get('version',{}).get('number'),'health':health['status']}

    def publish(self,scope,revision,rules):
        validate_rules(rules);index=self.index(scope,revision);digest=hashlib.sha256(json.dumps(rules,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        mappings={'dynamic':'strict','_meta':{'revision':revision,'rulesHash':digest,'count':len(rules)},'properties':{**{k:{'type':v} for k,v in FIELDS.items()},'query':{'type':'percolator'},'ruleId':{'type':'keyword'},'enabled':{'type':'boolean'}}}
        code,body=self.call('PUT','/'+index,{'settings':{'number_of_shards':1,'number_of_replicas':0},'mappings':mappings},allowed=(200,201,400))
        if code==400 and body.get('error',{}).get('type')!='resource_already_exists_exception':raise Failure('Rule index creation failed.')
        _,mapping=self.call('GET','/'+index+'/_mapping')
        if mapping.get(index,{}).get('mappings',{}).get('_meta')!=mappings['_meta']:raise Failure('Rule generation metadata conflicts with the requested publication.')
        _,settings=self.call('GET','/'+index+'/_settings')
        sealed=settings[index]['settings']['index'].get('blocks',{}).get('write')=='true'
        if not sealed:self.write_rules(index,rules)
        _,count=self.call('GET','/'+index+'/_count');checked_shards(count)
        if count.get('count')!=len(rules):raise Failure('Published rule count does not match the generation.')
        return {'revision':revision,'rulesHash':digest,'count':len(rules),'sealed':True,'backend':'opensearch'}

    def write_rules(self,index,rules):
        lines=[]
        for rule in rules:lines.extend([json.dumps({'index':{'_id':rule['id']}}),json.dumps({'query':rule['query'],'ruleId':rule['id'],'enabled':rule['enabled']})])
        _,bulk=self.call('POST','/'+index+'/_bulk?refresh=wait_for','\n'.join(lines)+'\n',ndjson=True)
        if bulk.get('errors') is not False or len(bulk.get('items',[]))!=len(rules):raise Failure('Not every stored query was published.')
        _,refresh=self.call('POST','/'+index+'/_refresh');checked_shards(refresh)
        _,seal=self.call('PUT','/'+index+'/_settings',{'index.blocks.write':True})
        if seal.get('acknowledged') is not True:raise Failure('Rule generation was not sealed.')

    def match(self,scope,revision,document):
        index=self.index(scope,revision)
        if not isinstance(document,dict) or not set(document)<=set(FIELDS) or any(not isinstance(v,str) or len(v)>4096 for v in document.values()):raise Failure('Invalid normalized detection document.','invalid-document')
        _,settings=self.call('GET','/'+index+'/_settings')
        if settings[index]['settings']['index'].get('blocks',{}).get('write')!='true':raise Failure('Rule generation is not published and sealed.')
        # The immutable sealed index makes search_after stable across every page.
        matches=[];after=None;total=None
        for _ in range(8):
            query={'size':20,'track_total_hits':True,'timeout':'5s','sort':[{'ruleId':'asc'}],'_source':['ruleId'],'query':{'bool':{'filter':[{'term':{'enabled':True}},{'percolate':{'field':'query','document':document}}]}}}
            if after is not None:query['search_after']=after
            _,result=self.call('POST','/'+index+'/_search?allow_partial_search_results=false',query)
            checked_shards(result)
            if result.get('timed_out') is not False or result.get('terminated_early') is True:raise Failure('Percolation did not complete.')
            hits=result.get('hits',{});count=hits.get('total',{});rows=hits.get('hits')
            if count.get('relation')!='eq' or type(count.get('value'))!=int or not isinstance(rows,list):raise Failure('Percolation did not return an exact match count.')
            if total is None:total=count['value']
            if count['value']!=total or total>128:raise Failure('Rule results changed or exceeded the bound.')
            for hit in rows:
                rule=hit.get('_source',{}).get('ruleId')
                if rule in matches or not isinstance(rule,str) or not HEX.fullmatch(rule):raise Failure('Invalid or repeated rule result.')
                matches.append(rule)
            if len(matches)==total:return {'revision':revision,'matches':matches,'total':total,'complete':True,'backend':'opensearch'}
            if not rows or not isinstance(rows[-1].get('sort'),list):raise Failure('Percolation pagination ended early.')
            after=rows[-1]['sort']
        raise Failure('Percolation exceeded its page budget.')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None
