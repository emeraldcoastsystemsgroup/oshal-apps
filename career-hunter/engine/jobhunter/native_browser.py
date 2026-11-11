# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Run the pinned anonymous Node browser in native ingest, validate bounded source evidence and preserve unconfirmed enumeration instead of silently closing jobs.
# 2 | maintainer@emeraldcoastsystemsgroup.com | A read that a site's human check, a sign-in page or a refusal stopped before any job is recorded as failed with that cause, so the Companies page can say what happened instead of "no jobs".
"""Native public-listing adapter; holds no applicant profile or model credentials."""
from __future__ import annotations
import json
import os
import signal
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

MAX_BYTES=10*1024*1024
PROCESS_TIMEOUT=135
CODES={'browser_runtime_unavailable','browser_input_invalid','browser_navigation_failed',
       'browser_read_failed','browser_response_too_large','browser_deadline_exceeded',
       'browser_refused','challenge_detected','login_required'}
REASONS={'completion_unverified','page_limit_reached','response_limit_reached',
         'browser_deadline_exceeded','login_required','challenge_detected'}

class BrowserReadUnavailable(RuntimeError):
    def __init__(self,code):
        self.code=code if code in CODES else 'browser_read_failed'
        super().__init__(self.code)

def public_link(raw):
    if not isinstance(raw,str) or len(raw)>4096:
        return False
    try:
        url=urlsplit(raw)
        return url.scheme=='https' and bool(url.hostname) and not url.username and not url.password and url.port in (None,443)
    except ValueError:
        return False

def _run(command,request,env):
    child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                           text=True,encoding='utf-8',env=env,start_new_session=True)
    try:
        stdout,stderr=child.communicate(request,timeout=PROCESS_TIMEOUT)
        return subprocess.CompletedProcess(command,child.returncode,stdout,stderr)
    except subprocess.TimeoutExpired as error:
        # Kill the process group before draining pipes: killing Node alone can leave
        # Chromium holding those pipes open forever. Exiting the ingest namespace
        # also ends any descendant that has created its own process group.
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        try:child.communicate(timeout=5)
        except subprocess.TimeoutExpired:pass
        raise SystemExit('browser_process_deadline') from error

def scrape(url,max_pages):
    from . import webscrape,source_memory
    if os.environ.get('JOBHUNTER_BROWSER_NATIVE')!='1':
        raise BrowserReadUnavailable('browser_runtime_unavailable')
    node=os.environ.get('JOBHUNTER_BROWSER_NODE')
    executable=os.environ.get('JOBHUNTER_BROWSER_EXECUTABLE')
    if node!='/usr/bin/node' or not executable or not public_link(url):
        raise BrowserReadUnavailable('browser_runtime_unavailable')
    script=Path(__file__).with_name('browser_fetch.cjs')
    request=json.dumps({'url':url,'maxPages':max_pages,'deadlineMs':120000})
    # This sandbox's environment contains only objective-ingest paths. Browser state
    # is ephemeral; no per-person worker profile or credential file is named here.
    env={key:value for key,value in os.environ.items() if key in
         ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','NODE_PATH','JOBHUNTER_BROWSER_EXECUTABLE')}
    try:
        result=_run([node,str(script)],request,env)
    except OSError as error:
        raise BrowserReadUnavailable('browser_runtime_unavailable') from error
    if result.returncode!=0:
        reason=result.stderr.strip()
        raise BrowserReadUnavailable(reason if reason in CODES else 'browser_read_failed')
    if len(result.stdout.encode('utf-8'))>MAX_BYTES:
        raise BrowserReadUnavailable('browser_response_too_large')
    try:
        value=json.loads(result.stdout)
        if (not isinstance(value,dict) or type(value.get('version')) is not int or value['version']!=1 or value.get('reason') not in REASONS
            or type(value.get('pages')) is not int or not 0<=value['pages']<=80
            or not isinstance(value.get('dom'),list) or len(value['dom'])>5000
            or not isinstance(value.get('payloads'),list) or len(value['payloads'])>1000):
            raise ValueError()
        jobs={}
        def keep(key,item):
            previous=jobs.get(key)
            if previous and item.get('description') is None and previous.get('description') is not None:
                item={**item,'description':previous['description']}
            jobs[key]=item
        for item in value['dom']:
            if (not isinstance(item,dict) or not public_link(item.get('url'))
                or not isinstance(item.get('title'),str) or not 4<=len(item['title'])<=160
                or item.get('location') is not None and not isinstance(item['location'],str)):
                raise ValueError()
            title=item['title'].strip()
            if webscrape._BAD.match(title):
                continue
            location=item.get('location')
            keep(item['url'],{'ats_job_id':webscrape.re.sub(r'https?://[^/]+','',item['url'])[:200] or item['url'],
                'title':title,'location':location,'remote':int('remote' in (title+(location or '')).lower()),
                'department':None,'url':item['url'],'description':None,'posted_at':None})
        for payload in value['payloads']:
            if (not isinstance(payload,dict) or not isinstance(payload.get('body'),str)
                or len(payload['body'].encode('utf-8'))>6*1024*1024
                or not public_link(payload.get('baseUrl'))):
                raise ValueError()
            found=[];webscrape._jobs_from_json(json.loads(payload['body']),payload['baseUrl'],found)
            for item in found:
                if public_link(item.get('url')):
                    keep(item['url'] if item['url']!=payload['baseUrl'] else item['ats_job_id']+'::'+item['title'],item)
    except (KeyError,TypeError,ValueError,UnicodeError) as error:
        raise BrowserReadUnavailable('browser_read_failed') from error
    if not jobs and value['reason'] in ('challenge_detected','login_required'):
        raise BrowserReadUnavailable(value['reason'])
    return source_memory.Feed(jobs.values(),complete=False,reason=value['reason'])
