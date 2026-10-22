#!/usr/bin/env python3
"""Build editable Visio diagrams, SVG/PDF previews and proposal documents.

Requires Python 3, python-docx and reportlab. No network access or product runtime.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Add editable measured 3D and canonical workflow pages plus the operating guide exports.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Diagram reviewed selected-account status handoff, uncertain-result holds and shared notification acceptance boundaries.
CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Add editable pod-workbench and canonical RCA-reference architecture with reproducible operator guides.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Keep the proposed swarm promotion roadmap in reproducible Word and PDF exports.
All diagram text, geometry and connectors originate in the scene definitions below.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import textwrap
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
)

ROOT = Path(__file__).resolve().parent
W, H = 1600, 900
NAVY, INK, MUTED = '#14233B', '#20334D', '#576B83'
TEAL, BLUE, AMBER, RED = '#007F88', '#2364B0', '#AE6500', '#B33945'
PALE, BORDER, WHITE = '#F3F6FA', '#D6E0EB', '#FFFFFF'
MINT, ICE, SAND, ROSE = '#E8F7F4', '#ECF3FF', '#FFF2DC', '#FCEDEF'
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
pdfmetrics.registerFont(TTFont('Design', str(FONT_DIR / 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('DesignBold', str(FONT_DIR / 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFontFamily('Design', normal='Design', bold='DesignBold', italic='Design', boldItalic='DesignBold')


def wrap(value, width, size, bold=False):
    lines = []
    for paragraph in str(value).split('\n'):
        if not paragraph:
            lines.append('')
            continue
        line = ''
        for word in paragraph.split():
            candidate = (line + ' ' + word).strip()
            if line and pdfmetrics.stringWidth(candidate, 'DesignBold' if bold else 'Design', size) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return lines


class Page:
    def __init__(self, slug, title, subtitle):
        self.slug, self.title, self.subtitle = slug, title, subtitle
        self.shapes, self.links = [], []
        self.box(0, 0, W, H, WHITE, WHITE)
        self.text(56, 25, 1488, 24, 'TRIAGENORTH  /  PRODUCT DESIGN', 13, TEAL, True)
        self.text(56, 62, 1488, 44, title, 31, NAVY, True)
        self.text(56, 112, 1488, 28, subtitle, 16, MUTED)
        self.box(56, 846, 1488, 1, BORDER, BORDER)
        self.text(56, 858, 1280, 22, 'DESIGN & ACCEPTANCE NOTES  ·  21 OCT 2026  ·  Illustrative screens; measured increments have separate receipts', 12, MUTED)

    def box(self, x, y, w, h, fill=WHITE, stroke=BORDER, radius=10, dash=False):
        s = dict(id=len(self.shapes)+1, kind='rect', x=x, y=y, w=w, h=h, fill=fill, stroke=stroke, radius=min(radius,w/2,h/2), dash=dash)
        self.shapes.append(s)
        return s

    def text(self, x, y, w, h, content, size=17, color=INK, bold=False, align='left'):
        lines = wrap(content, w, size, bold)
        if len(lines)*size*1.35 > h + 2:
            raise ValueError(f'Text overflows {self.slug}: {content[:65]} ({len(lines)} lines / {h}px)')
        s = dict(id=len(self.shapes)+1, kind='text', x=x, y=y, w=w, h=h, text='\n'.join(lines), size=size, color=color, bold=bold, align=align)
        self.shapes.append(s)
        return s

    def card(self, x, y, w, h, title, body='', tone=PALE, accent=TEAL, size=17):
        s = self.box(x, y, w, h, tone)
        self.box(x, y+12, 4, h-24, accent, accent, 1)
        title_size=19
        while title_size>12 and len(wrap(title,w-36,title_size,True))>1:
            title_size-=1
        self.text(x+18, y+14, w-36, 29, title, title_size, INK, True)
        if body:
            self.text(x+18, y+51, w-36, h-61, body, size, MUTED)
        return s

    def label(self, x, y, text, color=TEAL, width=400):
        return self.text(x, y, width, 24, text.upper(), 13, color, True)

    def line(self, points, color=TEAL, dash=False, source=None, target=None, arrow=True):
        s = dict(id=len(self.shapes)+1, kind='line', points=points, color=color, dash=dash, arrow=arrow, source=source, target=target)
        self.shapes.append(s)
        return s

    def connect(self, a, b, color=TEAL, dash=False, vertical=False):
        if vertical:
            p1=(a['x']+a['w']/2, a['y']+a['h'])
            p2=(b['x']+b['w']/2, b['y'])
        else:
            p1=(a['x']+a['w'], a['y']+a['h']/2)
            p2=(b['x'], b['y']+b['h']/2)
        return self.line([p1,p2], color, dash, (a['id'], p1), (b['id'], p2))


def shell(p, selected, heading, note, admin=False):
    p.box(56, 158, 1488, 658, WHITE, BORDER, 13)
    p.box(56, 158, 1488, 56, NAVY, NAVY, 0)
    p.text(77, 174, 280, 25, 'TriageNorth', 20, WHITE, True)
    p.text(430, 177, 620, 24, 'Environment: Demo DC     |     Search assets and incidents', 15, '#DCE8F8')
    p.text(1180, 177, 340, 24, 'Access: scoped operator', 15, '#DCE8F8')
    p.box(56, 214, 212, 602, PALE, PALE, 0)
    nav=['Overview','Topology','Assets','Data decisions','Incidents','Ticket sync','Approvals','Automation','Deliverables','Administration']
    for i,n in enumerate(nav):
        y=237+i*48
        if n==selected:
            p.box(70,y-4,184,37,MINT,MINT,7)
        p.text(86,y+3,165,26,n,16,TEAL if n==selected else MUTED,n==selected)
    p.text(292,233,1218,35,heading,24,NAVY,True)
    p.text(292,275,1218,30,note,14,MUTED)


def architecture():
    p=Page('01-solution','From infrastructure signal to verified action','TriageNorth turns evidence into controlled response; an independently installed platform supplies shared services.')
    p.label(56,161,'Infrastructure and data sources')
    p.label(380,161,'TriageNorth / submitted product')
    p.box(360,190,1184,470,WHITE,BORDER,14)
    a=p.card(56,202,270,126,'Data center','Hosts · network · storage\nClusters · containers',PALE)
    b=p.card(56,346,270,126,'Cloud estates','AWS · Azure · GCP\nProvider-native discovery',PALE,BLUE)
    c=p.card(56,490,270,126,'Signals and evidence','Prometheus · OTLP\nExternal logs and changes',PALE,BLUE)
    x=[386,680,974,1268]
    cards=[]
    for xx,title,body in zip(x,['Sources and adapters','Asset and topology','Incident and evidence','Work and automation'],[
        'Authenticated identity\nSchema and mapping\nDurable intake',
        'Canonical inventory\nTemporal relationships\nDiscovery and freshness',
        'Detection and noise gates\nCorrelation and snapshots\nOne canonical ticket',
        'Versioned code bundles\nBound approvals\nExecution and verification']):
        cards.append(p.card(xx,230,250,188,title,body,MINT,size=16))
    for aa,bb in zip(cards,cards[1:]):p.connect(aa,bb)
    p.line([(326,265),(350,265),(350,300),(386,300)],source=(a['id'],(326,265)),target=(cards[0]['id'],(386,300)))
    p.line([(326,409),(350,409),(350,445),(660,445),(660,390),(680,390)],BLUE,source=(b['id'],(326,409)),target=(cards[1]['id'],(680,390)))
    p.line([(326,553),(350,553),(350,390),(386,390)],BLUE,source=(c['id'],(326,553)),target=(cards[0]['id'],(386,390)))
    p.card(386,474,1132,146,'Application owned workspace','Topology / Data and decisions / Incidents / Ticket sync / Approvals / Deliverables\nScoped connections; inbound sources and outbound ticket synchronization remain separate',ICE,BLUE,17)
    p.line([(945,660),(945,694)],NAVY,dash=True)
    p.card(360,700,1184,116,'Existing OSHAL foundation / Docker-OCI baseline','User login and scoped grants  ·  Standard connection framework  ·  Canonical tickets  ·  Tools / sandbox\nApproval authority  ·  Audit and execution receipts  ·  Revocation and budget enforcement',PALE,NAVY,17)
    p.text(56,708,270,95,'Product package\nIndependent revision\nBaseline image digest',17,MUTED)
    return p


def topology():
    p=Page('02-estate','One estate across physical and virtual layers','The map distinguishes containment, network links, placement and dependencies. Health always includes freshness.')
    p.box(56,180,910,574,PALE,BORDER,12)
    p.label(76,194,'Data center  /  Site A')
    internet=p.card(86,240,220,100,'Edge and firewall','External / WAN paths',WHITE,BLUE,15)
    fabric=p.card(354,240,240,100,'Network fabric','Switches · VLANs · ports',WHITE,BLUE,15)
    storage=p.card(650,240,275,100,'Storage services','Arrays · volumes · mounts',WHITE,BLUE,15)
    rack=p.card(86,394,220,128,'Rack and chassis','Power / UPS / cooling\nPhysical containment',WHITE,TEAL,15)
    host=p.card(354,394,240,128,'Compute host','Hardware + hypervisor\nHost health observation',WHITE,TEAL,15)
    vm=p.card(650,394,275,128,'VM or cluster node','OS and provider identity\nPlacement history',WHITE,TEAL,15)
    workload=p.card(354,584,240,122,'Workload','Stable controller ID\nService ownership',MINT,TEAL,15)
    pod=p.card(650,584,275,122,'Pod and container','Instance UID + image\nCurrent node and health',SAND,AMBER,15)
    p.connect(internet,fabric,BLUE);p.connect(fabric,storage,BLUE)
    p.connect(rack,host);p.connect(host,vm);p.connect(workload,pod)
    p.connect(fabric,host,BLUE,vertical=True)
    p.connect(vm,pod,TEAL,vertical=True)
    p.text(608,438,35,24,'→',17,TEAL)
    p.label(1016,194,'Cloud estates')
    for y,t,b in [(240,'AWS','Account → region → VPC → subnet → instance'),(394,'Azure','Subscription → VNet → subnet → VM'),(548,'GCP','Project → network → subnet → instance')]:
        p.card(1016,y,528,123,t,b,ICE,BLUE,17)
    p.line([(966,350),(992,350),(992,300),(1016,300)],BLUE,dash=True)
    p.text(1009,692,535,60,'Managed clusters and workloads link to their provider hosts using scoped native identifiers.',16,MUTED)
    p.card(56,772,1488,57,'Map controls: current or incident time · environment · layer · source · observed health · stale/unknown','',WHITE,TEAL)
    return p


def pipeline():
    p=Page('03-pipeline','Durable processing and information packets','Capture disappearing evidence promptly; repeated symptoms update an incident before they incur another investigation.')
    p.label(56,165,'Ingest and detect')
    row=[]
    data=[('1  Authenticate','Named source + schema\nScope and required IDs'),('2  Land and resolve','Separate raw / telemetry\nMap to canonical asset'),('3  Evaluate rules','Versioned filter reasons\nPercolation + windows'),('4  Reduce noise','Stable incident keys\nReserve before dispatch'),('5  Correlate','Open incident + graph\nRecord membership')]
    for i,(t,b) in enumerate(data):row.append(p.card(56+i*302,201,280,137,t,b,MINT,size=16))
    for a,b in zip(row,row[1:]):p.connect(a,b)
    p.label(56,381,'Independent durable records')
    for i,(t,b) in enumerate([('Raw deliveries','Accepted content and replay lineage'),('Telemetry','Signals, times, units and resource IDs'),('Alerts and decisions','Rule version, reason and incident link')]):
        p.card(56+i*506,417,476,112,t,b,PALE,BLUE,16)
    p.label(56,573,'Capture and act')
    row2=[]
    for i,(t,b) in enumerate([('Evidence policy','First occurrence / escalation\nBounded collection'),('Information packet','State + topology + signals\nOptional external evidence'),('Ticket and proposal','Investigation and review\nVersioned work bundle'),('Authorized execution','Exact approval or delegation\nRecheck before running'),('Verify and record','Effect, not just exit status\nReceipt / reopen / escalate')]):
        row2.append(p.card(56+i*302,609,280,142,t,b,ICE,BLUE,16))
    for a,b in zip(row2,row2[1:]):p.connect(a,b,BLUE)
    p.line([(1404,338),(1404,366),(40,366),(40,680),(56,680)],TEAL,source=(row[-1]['id'],(1404,338)),target=(row2[0]['id'],(56,680)))
    p.text(56,778,1488,45,'Every stage records its decision. Invalid identity, unmatched rules, partial evidence, unknown outcomes and stalled stages remain visible.',17,MUTED)
    return p


def detection():
    p=Page('12-detection','Detection is a service, not an alert label','Anomaly candidates use the same identity, filtering and reduction path as inbound alerts.')
    a=p.card(56,190,350,160,'Separate telemetry store','Resource IDs, units and event time\nBounded history and retention',MINT,size=17)
    b=p.card(478,190,490,160,'Versioned anomaly detector','Baseline / warm-up / missing samples\nScore, confidence and window\nKnown shift versus normal control',ICE,BLUE,17)
    c=p.card(1040,190,504,160,'Canonical candidate','Detector and entity identity\nStable window ID; original evidence\nNo automatic infrastructure action',MINT,size=17)
    p.connect(a,b);p.connect(b,c)
    p.card(56,410,460,160,'Durable processing','Compound cursor and overlap\nRetry failed items without losing ties\nRecord replay and partial outcomes',PALE,BLUE,17)
    p.card(550,410,460,160,'Filter and reduce first','Published query and policy revision\nAtomic incident-revision reservation\nRetain occurrence counts',PALE,BLUE,17)
    p.card(1044,410,500,160,'Correlate and collect','Bounded event-time graph\nExplicit degraded fallback\nOnly then capture and investigate',PALE,BLUE,17)
    p.card(56,633,1488,147,'Service acceptance required','Cold / stale / unavailable is not healthy. Prove baseline and injected shift, false positives, late data, two workers, crash recovery and bounded collection.\nA fixed threshold or imported score does not prove an anomaly engine.',SAND,AMBER,18)
    return p



def temporal_graph():
    p=Page('13-temporal-graph','Temporal graph  /  source implementation','Immutable scans preserve evidence. The current implementation is bounded and manually invoked.')
    a=p.card(56,190,435,175,'Named source + collection','Native provider / scope / kind / ID\nActual owner and endpoint references\nOnly explicit inventory facts',MINT,size=17)
    b=p.card(563,190,435,175,'Scoped SQL scan journal','Immutable scan ID + payload hash\nObserved time and completeness\nCaller isolation; retry reconciliation',ICE,BLUE,17)
    c=p.card(1070,190,474,175,'Reconstruct at a chosen time','Complete: replace this collection\nPartial: keep prior observations\nNever refresh unobserved facts',MINT,size=17)
    p.connect(a,b);p.connect(b,c)
    p.card(56,425,710,176,'Estate experience','Explore directed links from a selected asset\nNative IDs, health timestamps and source provenance\nUnknown and partial remain visible',PALE,BLUE,18)
    p.card(806,425,738,176,'Data correlation decision','Affected dependency paths; no common-hub assumption\nPolicy + delivery IDs + graph revision + exact scan IDs\nStale, incomplete or over budget: explicit fallback',PALE,BLUE,18)
    p.card(56,660,1488,151,'Remaining delivery gates','Scheduled least-privilege collection, cloud scanners, retention/checkpoints and cross-source conflict resolution remain open.\nManual correlation does not consume the processing queue, dispatch tickets or authorize remediation.\nThe guarded local Kubernetes capture is separate from the isolated investigation worker.',SAND,AMBER,17)
    return p


def authority():
    p=Page('04-authority','Authority is checked at every transition','Collecting evidence, approving a proposal and changing infrastructure are separate capabilities.')
    for xx,t,b in [(56,'Observe and investigate','Read assets and signals\nCollect allowed evidence\nGenerate a proposal'),(566,'Approve concrete work','Inspect exact version and targets\nCheck evidence and preconditions\nApprove once or reject'),(1076,'Execute and verify','Registered action or supported runner\nRecheck current authority\nVerify effect and record receipt')]:
        p.card(xx,205,468,172,t,b,MINT if xx==56 else ICE,TEAL if xx==56 else BLUE,18)
    p.line([(524,291),(566,291)]);p.line([(1034,291),(1076,291)])
    p.card(56,425,710,172,'One time approval binds','Artifact digest + action version + exact targets + parameters\nPrincipal + connection version + scope + expiry\nChanged artifact, incarnation or precondition → new decision',SAND,AMBER,18)
    p.card(806,425,738,172,'Delegation authorizes a known action','Explicit policy + allowed template + constrained parameters\nEnvironment / targets + time / cost / concurrency limits\nPause, revoke and stop conditions remain visible',SAND,AMBER,18)
    p.card(56,643,1488,166,'Execution boundary','Installation grants no unattended changes. An administrator does not automatically become a production executor.\nNewly generated scripts must pass tool registration and review before automated execution. Downloading is separate from running.\nSuccessful command exit does not close the incident: the postcondition must pass, otherwise reopen or escalate within bounds.',PALE,NAVY,18)
    return p


def overview():
    p=Page('05-overview','Experience layout  /  Overview and topology','Application owned navigation makes operations feel complete while shared services remain underneath.')
    shell(p,'Overview','TriageNorth overview','Coverage, freshness, current incidents and the next decision in one place.')
    for x,t,b,tone in [(292,'Coverage','5 sources · 1 stale',SAND),(602,'Incidents','2 active · 1 correlated',PALE),(912,'Approvals','1 needs review',ICE),(1222,'Automation','Demo scope · paused',PALE)]:
        p.card(x,320,290,96,t,b,tone,size=15)
    p.box(292,438,790,352,PALE,BORDER)
    p.text(312,455,750,30,'Estate topology',20,INK,True)
    n1=p.card(326,511,202,98,'Network','Configured paths',WHITE,BLUE,14)
    n2=p.card(581,511,202,98,'Node 01','Observed healthy',WHITE,TEAL,14)
    n3=p.card(836,511,220,98,'Payments API','Crash loop · 100 hits',SAND,AMBER,14)
    p.connect(n1,n2,BLUE);p.connect(n2,n3)
    p.text(326,650,710,65,'Select a resource to inspect its identity, current health, last observation and incident-time relationships.',17,MUTED)
    p.text(326,743,710,26,'Legend: healthy · degraded · critical · stale / unknown',15,MUTED)
    p.card(1102,438,410,160,'Next decision','INC-0042  ·  Payments API\nEvidence captured · proposal ready\nReview requested action →',ICE,BLUE,17)
    p.card(1102,618,410,172,'Coverage needs attention','Azure discovery is stale\nLast successful scan is visible\nReview connection and scope →',SAND,AMBER,17)
    return p


def setup():
    p=Page('06-setup','Experience layout  /  Connections and source mapping','Credential references, discovery scope and identifier mappings are visible together; write grants remain separate.')
    shell(p,'Administration','Connections and credentials','Tabs: Connections   |   Sources and mappings   |   Discovery   |   Access   |   Audit')
    p.card(292,322,238,467,'Named connections','Demo cluster\n\nAWS discovery\n\nAzure discovery\n\nGCP discovery\n\nExternal logs',PALE,TEAL,17)
    p.box(550,322,603,467,WHITE,BORDER)
    p.text(570,340,563,31,'Demo cluster connection',21,INK,True)
    fields=[('Scope','Demo DC / cluster-01'),('Credential reference','vault://operations/demo-reader  [masked]'),('Capabilities','Inventory read · evidence read'),('Discovery','Watch enabled · reconcile every 5 min')]
    for i,(a,b) in enumerate(fields):
        y=389+i*68
        p.label(570,y,a,width=560)
        p.text(570,y+24,560,28,b,16,INK)
    p.box(570,679,563,79,MINT,MINT)
    p.text(586,692,530,55,'Test authentication   |   Test inventory\nTest evidence access   |   Save configuration',16,TEAL,True)
    p.card(1173,322,339,217,'Effective access','Caller: signed-in demo user\nAccount: explicitly selected\nWrites: not granted\nAuth / reads tested separately',ICE,BLUE,16)
    p.card(1173,559,339,230,'Mapping preview','Source → authenticated ID\nResource ID → asset-009\nAlert type → CrashLoop\nUnmapped / conflicting IDs\nInspect incident-key preview',PALE,TEAL,16)
    return p


def approval():
    p=Page('07-incident','Experience layout  /  Incident and approval','Evidence and proposed work stay beside the exact authority requested from the operator.')
    shell(p,'Incidents','INC-0042  Payments API restart loop','Demo DC  /  cluster-01  /  payments  ·  Open  ·  100 occurrences  ·  Evidence captured')
    p.card(292,322,267,466,'Asset and impact','Workload: payments-api\nInstance: pod UID …91\nNode: node-01\n\nAffected service\nPayments API\n\nCurrent placement\nDifferent from first failure\n\nView incident-time map →',PALE,TEAL,16)
    p.box(579,322,564,466,WHITE,BORDER)
    p.text(599,340,524,28,'Evidence  |  Timeline  |  Proposed work',18,INK,True)
    p.card(599,391,524,138,'Captured before replacement','Previous logs · pod state · node conditions\nTopology at failure · collection manifest\nExternal logs: unavailable, explicitly shown',MINT,TEAL,16)
    p.card(599,549,524,146,'Proposed action  /  version 3','Registered action: restart demo workload\nPreflight and verification included\nInspect report, plan and file diff →',ICE,BLUE,16)
    p.text(599,724,520,42,'Editing the work creates a new version and invalidates its earlier approval.',15,MUTED)
    p.card(1163,322,349,336,'Approve this version','Targets: payments-api / demo\nBundle: SHA256 …6b3f\nPrincipal: demo executor\nExpiry: 15 minutes\nLimits: 1 execution\nRollback: declared limitation\nPostcheck: service readiness',SAND,AMBER,16)
    p.box(1181,682,313,43,TEAL,TEAL,7)
    p.text(1195,691,285,25,'Approve version 3',17,WHITE,True)
    p.text(1181,744,313,25,'Reject  |  Request revision',16,MUTED)
    return p


def delivery():
    p=Page('08-delivery','Experience layout  /  Generated work and receipts','A deliverable is inspectable and downloadable; execution requires a separate valid authorization.')
    shell(p,'Deliverables','INC-0042  Work bundle version 3','Tabs: Files   |   Validation   |   Approvals   |   Execution receipts   |   Version history')
    p.card(292,322,301,465,'Bundle files','report.md\nevidence-manifest.json\nplan.json\npreflight.sh\ndiagnose.sh\nremediate.sh\nverify.sh\nrollback.md\nvalidation.json\nSHA256SUMS',PALE,TEAL,17)
    p.box(613,322,899,218,NAVY,NAVY)
    p.text(633,341,859,28,'plan.json  /  inspect the exact approved target',18,WHITE,True)
    p.text(633,389,859,126,'action: restart-demo-workload\ntarget: workload asset-009 / namespace demo\npreconditions: expected incarnation, current grant, active approval\nverify: readiness check passes; no repeated restart symptom',17,'#DCE8F8')
    p.card(613,560,437,140,'Validation and delivery','Schema + secret + parameter checks\nFixture validation result attached\nDownload version 3 ZIP →',MINT,TEAL,16)
    p.card(1070,560,442,140,'Execution control','Approved registered action only\nRecheck scope and authority\nRun approved version →',SAND,AMBER,16)
    p.card(613,720,899,67,'Receipt: action + target + principal + digest + output + verified effect','',ICE,BLUE)
    return p


def data_decisions():
    p=Page('09-data-decisions','Experience layout  /  Data and processing decisions','An explanation belongs to every record; raw deliveries and native OTLP observations have separate views.')
    shell(p,'Data decisions','Follow an input to its decision','Synthetic replay / Current-caller scope / Raw deliveries | Telemetry | Decisions | Replay history')
    cards=[]
    for i,(title,body) in enumerate([('Named source','Authenticated source\nCommitted receipt'),('Normalize and filter','Mapping + rule version\nReason and identity'),('Reduce and correlate','Delivery / symptom key\nSuppression + membership'),('Capture and dispatch','Conditional packet\nCanonical platform ticket')]):
        cards.append(p.card(292+i*309,324,288,133,title,body,MINT,TEAL,15))
    for a,b in zip(cards,cards[1:]):p.connect(a,b)
    p.card(292,481,598,194,'Decision inspector','Delivery retry: same source and event ID\nSymptom update: independent delivery, same scoped key\nFiltered / quarantined / unmatched: explain why\nSnapshot: first occurrence or escalation policy',PALE,TEAL,16)
    p.card(914,481,598,194,'Identity and provenance','Source + environment + resource kind/scope/native ID\nAlert type; preserve tuple boundaries and case\nMapping/rule version + input time + receipt + replay\nCross-source correlation stays a separate decision',ICE,BLUE,16)
    p.card(292,699,1220,89,'Production acceptance','Reuse established windows, reservation and release-on-failure semantics; the local severity/tuple demo is not that algorithm.',SAND,AMBER,15)
    return p


def integrations():
    p=Page('10-integrations','Inbound alerts and outbound ticket synchronization','One platform login and standard connections; TriageNorth supplies operational meaning and the investigation experience.')
    left=p.card(56,202,370,195,'Inbound integrations','Prometheus / Alertmanager adapters\nCloudEvents alert intake\nNative OTLP telemetry\nNamed authenticated sources',MINT,TEAL,18)
    middle=p.card(488,202,510,195,'TriageNorth','Normalize / filter / reduce / correlate\nInspect data decisions and evidence\nOne canonical platform ticket\nVersioned external-sync policy',MINT,TEAL,18)
    broker=p.card(1060,202,484,195,'Existing platform services','Current-caller connection + account\nShared ownership and scoped grants\nConfirmed writes and verified webhooks\nAudit, liveness and revocation',ICE,BLUE,18)
    p.connect(left,middle);p.connect(middle,broker,BLUE)
    targets=[]
    for i,(title,body) in enumerate([('ServiceNow','Incident / record link'),('GitHub','Repository / issue link'),('GitLab','Project / issue link'),('Jira','Project / issue link')]):
        targets.append(p.card(56+i*380,462,348,113,title,body,ICE,BLUE,17))
    p.line([(1370,397),(1370,433),(230,433),(230,462)],BLUE,source=(broker['id'],(1370,397)),target=(targets[0]['id'],(230,462)))
    for item in targets[1:]:
        x=item['x']+item['w']/2;p.line([(x,433),(x,462)],BLUE,target=(item['id'],(x,462)))
    p.card(56,613,720,184,'Sync contract','Field direction / ownership + status mapping\nRecord IDs + local / remote revision + origin\nDurable operation reservation and feedback suppression\nUnknown create: reconcile before retry',PALE,TEAL,17)
    p.card(806,613,738,184,'Shared capability gate','Declarations differ; complete two-way sync is not live.\nServiceNow currently reads only in reviewed source.\nExtend standard operations, confirmations and webhooks.\nRemote closure never proves infrastructure recovery.',SAND,AMBER,17)
    return p


def connection_identity():
    p=Page('11-connections','Experience layout  /  User identity and CLI connections','TriageNorth uses scoped connections; signing in does not automatically grant unattended or write authority.')
    shell(p,'Administration','Connections, runner identity and effective access','Current caller / Named account / Interactive operator or explicitly activated background principal')
    p.card(292,324,340,463,'Named connections','Kubernetes / kubectl\nAWS / aws\nAzure / az\nGoogle Cloud / gcloud\nData center / SSH\nSplunk / API\n\nTool available on selected runner\nNo global shell-cache import',PALE,TEAL,17)
    p.card(656,324,450,213,'Verify actual identity','Provider account / tenant / project\nCluster API and incarnation UID\nHost fingerprint / allowed commands\nExplicit target and configuration',MINT,TEAL,17)
    p.card(656,561,450,226,'Independent capability probes','Authentication result and time\nInventory read result and scope\nEvidence read result and scope\nWrites require separate confirmed authority\nExpired / revoked / wrong target: stop',ICE,BLUE,17)
    p.card(1130,324,382,463,'Shared framework boundary','Personal connection: its owner\nShared connection: explicit grants\nSecrets: managed references only\nRefresh preserves bound identity\n\nBackground work needs activation\nNo browser token as service identity\n\nPlatform-managed sign-in',SAND,AMBER,17)
    return p


def render_svg(page, path, number, total):
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{escape(page.title)}">',
         '<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="context-stroke"/></marker></defs>']
    for s in page.shapes:
        if s['kind']=='rect':
            dash=' stroke-dasharray="8 5"' if s['dash'] else ''
            out.append(f'<rect x="{s["x"]}" y="{s["y"]}" width="{s["w"]}" height="{s["h"]}" rx="{s["radius"]}" fill="{s["fill"]}" stroke="{s["stroke"]}"{dash}/>')
        elif s['kind']=='text':
            weight='700' if s['bold'] else '400'
            out.append(f'<text font-family="DejaVu Sans, sans-serif" font-size="{s["size"]}" font-weight="{weight}" fill="{s["color"]}">')
            for j,line in enumerate(s['text'].split('\n')):
                out.append(f'<tspan x="{s["x"]}" y="{s["y"]+s["size"]+j*s["size"]*1.35}">{escape(line)}</tspan>')
            out.append('</text>')
        else:
            pts=' '.join(f'{x},{y}' for x,y in s['points'])
            dash=' stroke-dasharray="7 5"' if s['dash'] else ''
            marker=' marker-end="url(#arrow)"' if s['arrow'] else ''
            out.append(f'<polyline points="{pts}" fill="none" stroke="{s["color"]}" stroke-width="2"{dash}{marker}/>')
    out.append(f'<text x="1490" y="875" font-family="DejaVu Sans" font-size="13" fill="{MUTED}">{number:02d} / {total:02d}</text></svg>')
    path.write_text('\n'.join(out))


def render_diagram_pdf(pages, path):
    c=Canvas(str(path),pagesize=(W*.72,H*.72),pageCompression=1)
    c.setTitle('TriageNorth solution and experience design')
    c.setAuthor('TriageNorth design')
    for num,p in enumerate(pages,1):
        c.saveState();c.scale(.72,.72)
        for s in p.shapes:
            if s['kind']=='rect':
                c.setFillColor(colors.HexColor(s['fill']));c.setStrokeColor(colors.HexColor(s['stroke']));c.setLineWidth(1)
                c.setDash(8,5) if s['dash'] else c.setDash()
                c.roundRect(s['x'],H-s['y']-s['h'],s['w'],s['h'],s['radius'],fill=1,stroke=1)
            elif s['kind']=='text':
                c.setFillColor(colors.HexColor(s['color']));c.setFont('DesignBold' if s['bold'] else 'Design',s['size'])
                for j,line in enumerate(s['text'].split('\n')):
                    c.drawString(s['x'],H-s['y']-s['size']-j*s['size']*1.35,line)
            else:
                c.setStrokeColor(colors.HexColor(s['color']));c.setFillColor(colors.HexColor(s['color']));c.setLineWidth(2)
                c.setDash(7,5) if s['dash'] else c.setDash()
                pathobj=c.beginPath()
                for j,(x,y) in enumerate(s['points']):
                    pathobj.moveTo(x,H-y) if j==0 else pathobj.lineTo(x,H-y)
                c.drawPath(pathobj);c.setDash()
                if s['arrow']:
                    (x0,y0),(x,y)=s['points'][-2:];ang=math.atan2(y-y0,x-x0)
                    pts=[(x,y),(x-10*math.cos(ang)+4*math.sin(ang),y-10*math.sin(ang)-4*math.cos(ang)),(x-10*math.cos(ang)-4*math.sin(ang),y-10*math.sin(ang)+4*math.cos(ang))]
                    arrow=c.beginPath();arrow.moveTo(pts[0][0],H-pts[0][1])
                    for ax,ay in pts[1:]:arrow.lineTo(ax,H-ay)
                    arrow.close();c.drawPath(arrow,fill=1,stroke=0)
        c.setFont('Design',13);c.setFillColor(colors.HexColor(MUTED));c.drawString(1490,25,f'{num:02d} / {len(pages):02d}')
        c.restoreState();c.showPage()
    c.save()


NS='http://schemas.microsoft.com/office/visio/2012/main'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
ET.register_namespace('',NS);ET.register_namespace('r',REL)


def elem(name, parent=None, **attrs):
    e=ET.Element('{'+NS+'}'+name, {k:str(v) for k,v in attrs.items()})
    if parent is not None:parent.append(e)
    return e


def cell(parent,n,v,f=None):
    attrs=dict(N=n,V=str(v))
    if f is not None:attrs['F']=f
    return elem('Cell',parent,**attrs)


def xml(e):return ET.tostring(e,encoding='utf-8',xml_declaration=True)


def relationships(items):
    e=ET.Element('{'+PKG+'}Relationships')
    for rid,typ,target in items:ET.SubElement(e,'{'+PKG+'}Relationship',Id=rid,Type=typ,Target=target)
    # Use the conventional default namespace for compatibility with libvisio.
    return xml(e).replace(b'ns0:',b'').replace(b'xmlns:ns0=',b'xmlns=')


def render_visio(pages,path):
    parts={}
    doc=elem('VisioDocument');doc.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
    ds=elem('DocumentSettings',doc,TopPage=0,DefaultTextStyle=0,DefaultLineStyle=0,DefaultFillStyle=0)
    elem('GlueSettings',ds).text='9';elem('SnapSettings',ds).text='65847'
    faces=elem('FaceNames',doc);elem('FaceName',faces,NameU='DejaVu Sans')
    styles=elem('StyleSheets',doc);style=elem('StyleSheet',styles,ID=0,NameU='Normal',Name='Normal')
    for n,v in [('EnableLineProps',1),('EnableFillProps',1),('EnableTextProps',1),('LineWeight',.01),('LineColor',INK),('LinePattern',1),('FillForegnd',WHITE),('FillPattern',1),('ShdwPattern',0),('LeftMargin',0),('RightMargin',0),('TopMargin',0),('BottomMargin',0),('VerticalAlign',0)]:cell(style,n,v)
    char=elem('Section',style,N='Character');r=elem('Row',char,IX=0)
    for n,v in [('Font','DejaVu Sans'),('Color',INK),('Size',.17),('Style',0)]:cell(r,n,v)
    para=elem('Section',style,N='Paragraph');r=elem('Row',para,IX=0);cell(r,'HorzAlign',0);cell(r,'SpLine',-1.35)
    parts['visio/document.xml']=xml(doc)
    parts['visio/_rels/document.xml.rels']=relationships([('rId1','http://schemas.microsoft.com/visio/2010/relationships/pages','pages/pages.xml')])
    rootpages=elem('Pages');pagerels=[]
    for num,p in enumerate(pages,1):
        page=elem('Page',rootpages,ID=num-1,NameU=p.title.replace('/',' '),Name=p.title.replace('/',' '),ViewScale=.75,ViewCenterX=8,ViewCenterY=4.5)
        ps=elem('PageSheet',page,LineStyle=0,FillStyle=0,TextStyle=0)
        for n,v in [('PageWidth',16),('PageHeight',9),('PageScale',1),('DrawingScale',1),('DrawingSizeType',3),('DrawingScaleType',0),('PrintPageOrientation',2),('PageLeftMargin',0),('PageRightMargin',0),('PageTopMargin',0),('PageBottomMargin',0)]:cell(ps,n,v)
        rel=elem('Rel',page);rel.set('{'+REL+'}id',f'rId{num}')
        pagerels.append((f'rId{num}','http://schemas.microsoft.com/visio/2010/relationships/page',f'page{num}.xml'))
        content=elem('PageContents');content.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        shapes=elem('Shapes',content);connects=[]
        lookup={s['id']:s for s in p.shapes}
        for s in p.shapes:
            e=elem('Shape',shapes,ID=s['id'],NameU=f'{s["kind"]}.{s["id"]}',Type='Shape',LineStyle=0,FillStyle=0,TextStyle=0)
            if s['kind']=='line':
                pts=[(x/100,(H-y)/100) for x,y in s['points']];(bx,by),(ex,ey)=pts[0],pts[-1]
                for n,v,f in [('PinX',bx,'BeginX'),('PinY',by,'BeginY'),('Width',ex-bx,'EndX-BeginX'),('Height',ey-by,'EndY-BeginY'),('LocPinX',0,None),('LocPinY',0,None),('BeginX',bx,None),('BeginY',by,None),('EndX',ex,None),('EndY',ey,None)]:cell(e,n,v,f)
                for key,prefix in [('source','Begin'),('target','End')]:
                    if s[key]:
                        targetid,(xx,yy)=s[key];t=lookup[targetid]
                        fx=(xx-t['x'])/t['w'];fy=(t['y']+t['h']-yy)/t['h']
                        for axis,fraction,dim in [('X',fx,'Width'),('Y',fy,'Height')]:
                            c=next(v for v in e if v.get('N')==prefix+axis)
                            c.set('F',f'Sheet.{targetid}!Pin{axis}+Sheet.{targetid}!{dim}*({fraction}-.5)')
                        connects.append(dict(FromSheet=s['id'],FromCell=prefix+'X',FromPart=9 if prefix=='Begin' else 12,ToSheet=targetid,ToCell='PinX',ToPart=3))
                cell(e,'ObjType',2);cell(e,'LineColor',s['color']);cell(e,'LineWeight',.02);cell(e,'LinePattern',2 if s['dash'] else 1);cell(e,'EndArrow',4 if s['arrow'] else 0)
                g=elem('Section',e,N='Geometry',IX=0);cell(g,'NoFill',1)
                for i,(xx,yy) in enumerate(pts):
                    r=elem('Row',g,T='MoveTo' if i==0 else 'LineTo',IX=i+1);cell(r,'X',xx-bx);cell(r,'Y',yy-by)
            else:
                x,y,w,h=s['x']/100,(H-s['y']-s['h'])/100,s['w']/100,s['h']/100
                for n,v in [('PinX',x+w/2),('PinY',y+h/2),('Width',w),('Height',h),('LocPinX',w/2),('LocPinY',h/2),('Angle',0)]:cell(e,n,v)
                if s['kind']=='rect':
                    cell(e,'FillForegnd',s['fill']);cell(e,'FillPattern',1);cell(e,'LineColor',s['stroke']);cell(e,'LinePattern',2 if s['dash'] else 1);cell(e,'Rounding',s['radius']/100)
                    g=elem('Section',e,N='Geometry',IX=0)
                    for i,(xx,yy) in enumerate([(0,0),(w,0),(w,h),(0,h),(0,0)]):
                        r=elem('Row',g,T='MoveTo' if i==0 else 'LineTo',IX=i+1);cell(r,'X',xx);cell(r,'Y',yy)
                else:
                    cell(e,'FillPattern',0);cell(e,'LinePattern',0);cell(e,'VerticalAlign',0)
                    for n in ['LeftMargin','RightMargin','TopMargin','BottomMargin']:cell(e,n,0)
                    sec=elem('Section',e,N='Character');r=elem('Row',sec,IX=0)
                    for n,v in [('Font','DejaVu Sans'),('Size',s['size']/100),('Color',s['color']),('Style',1 if s['bold'] else 0)]:cell(r,n,v)
                    sec=elem('Section',e,N='Paragraph');r=elem('Row',sec,IX=0);cell(r,'HorzAlign',0);cell(r,'SpLine',-1.35)
                    elem('Text',e).text=s['text']
        ce=elem('Connects',content)
        for attrs in connects:elem('Connect',ce,**attrs)
        parts[f'visio/pages/page{num}.xml']=xml(content)
    parts['visio/pages/pages.xml']=xml(rootpages)
    parts['visio/pages/_rels/pages.xml.rels']=relationships(pagerels)
    parts['_rels/.rels']=relationships([('rId1','http://schemas.microsoft.com/visio/2010/relationships/document','visio/document.xml')])
    types=ET.Element('{'+CT+'}Types')
    for ext,mime in [('rels','application/vnd.openxmlformats-package.relationships+xml'),('xml','application/xml')]:ET.SubElement(types,'{'+CT+'}Default',Extension=ext,ContentType=mime)
    for name in parts:
        if name=='visio/document.xml':mime='application/vnd.ms-visio.drawing.main+xml'
        elif name=='visio/pages/pages.xml':mime='application/vnd.ms-visio.pages+xml'
        elif re.match(r'visio/pages/page\d+.xml',name):mime='application/vnd.ms-visio.page+xml'
        else:continue
        ET.SubElement(types,'{'+CT+'}Override',PartName='/'+name,ContentType=mime)
    parts['[Content_Types].xml']=xml(types).replace(b'ns0:',b'').replace(b'xmlns:ns0=',b'xmlns=')
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)


def parse_blocks(markdown):
    lines=markdown.splitlines();i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line:i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=[v.strip() for v in lines[i].strip().strip('|').split('|')]
                if not all(re.match(r'^:?-+:?$',v) for v in cells):rows.append(cells)
                i+=1
            yield 'table',rows;continue
        if line.startswith('#'):
            yield 'heading',(len(line)-len(line.lstrip('#')),line.lstrip('#').strip());i+=1;continue
        if line.startswith('- '):yield 'bullet',line[2:];i+=1;continue
        para=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','- ')):
            para.append(lines[i].strip());i+=1
        yield 'paragraph',' '.join(para)


def documents(markdown,basename):
    blocks=list(parse_blocks(markdown))
    d=Document();section=d.sections[0]
    section.top_margin=Inches(.7);section.bottom_margin=Inches(.65);section.left_margin=section.right_margin=Inches(.75)
    normal=d.styles['Normal'];normal.font.name='Calibri';normal.font.size=Pt(10)
    normal.paragraph_format.space_after=Pt(7)
    for name,size in [('Title',28),('Heading 1',19),('Heading 2',14),('Heading 3',12)]:
        d.styles[name].font.name='Calibri';d.styles[name].font.size=Pt(size);d.styles[name].font.color.rgb=RGBColor.from_string(NAVY[1:])
    d.core_properties.title={'operations-proposal':'TriageNorth product and solution proposal',
                            'operations-project-plan':'TriageNorth project plan and dependencies',
                            'operations-decisions':'TriageNorth architecture decisions',
                            'triagenorth-brief':'TriageNorth product brief',
                            'triagenorth-market-research':'TriageNorth market research and economics',
                            'triagenorth-context-replay':'TriageNorth context and replay guide',
                            'operations-swarm-promotion-roadmap':'TriageNorth swarm promotion roadmap',
                            'operations-response-design':'TriageNorth response paths and verification',
                            'triagenorth-operating-guide':'Operating TriageNorth'}.get(basename,'TriageNorth problem statement')
    d.core_properties.author='TriageNorth design'
    header=section.header.paragraphs[0];header.text='TRIAGENORTH  /  HACKATHON SUBMISSION';header.style='Caption'
    section.footer.paragraphs[0].text='Draft for review  ·  21 October 2026'
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle('DesignBody',fontName='Design',fontSize=9.2,leading=14,spaceAfter=8,textColor=colors.HexColor(INK)))
    styles.add(ParagraphStyle('DesignTitle',fontName='DesignBold',fontSize=25,leading=31,spaceAfter=16,textColor=colors.HexColor(NAVY)))
    styles.add(ParagraphStyle('DesignHead',fontName='DesignBold',fontSize=15,leading=20,spaceBefore=15,spaceAfter=8,textColor=colors.HexColor(NAVY),keepWithNext=True))
    styles.add(ParagraphStyle('DesignCell',fontName='Design',fontSize=8,leading=11,spaceAfter=0,textColor=colors.HexColor(INK)))
    story=[]
    for kind,v in blocks:
        if kind=='heading':
            level,t=v;d.add_heading(t,0 if level==1 else min(level-1,3))
            story.append(Paragraph(escape(t),styles['DesignTitle' if level==1 else 'DesignHead']))
        elif kind=='table':
            table=d.add_table(rows=1,cols=len(v[0]));table.style='Light Shading Accent 1'
            for c,t in zip(table.rows[0].cells,v[0]):c.text=t
            for row in v[1:]:
                for c,t in zip(table.add_row().cells,row):c.text=t
            widths=[135,369] if len(v[0])==2 else [504/len(v[0])]*len(v[0])
            data=[[Paragraph(escape(t),styles['DesignCell']) for t in row] for row in v]
            tbl=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
            tbl.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor(ICE)),('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),.4,colors.HexColor(BORDER)),('INNERGRID',(0,0),(-1,-1),.3,colors.HexColor(BORDER)),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            story.extend([tbl,Spacer(1,9)])
        else:
            d.add_paragraph(v,style='List Bullet' if kind=='bullet' else 'Normal')
            story.append(Paragraph(('• ' if kind=='bullet' else '')+escape(v),styles['DesignBody']))
    d.save(ROOT/f'{basename}.docx')
    def footer(c,doc):
        c.setFillColor(colors.HexColor(MUTED));c.setFont('Design',8)
        c.drawString(54,28,'TRIAGENORTH  /  DESIGN  /  20 OCT 2026');c.drawRightString(558,28,str(doc.page))
    SimpleDocTemplate(str(ROOT/f'{basename}.pdf'),pagesize=(612,792),rightMargin=54,leftMargin=54,topMargin=48,bottomMargin=48,title=d.core_properties.title,author='TriageNorth design').build(story,onFirstPage=footer,onLaterPages=footer)


def validate(pages):
    for p in pages:
        ids={s['id'] for s in p.shapes}
        for s in p.shapes:
            if s['kind']!='line':
                assert 0<=s['x']<=W and 0<=s['y']<=H
                assert s['x']+s['w']<=W and s['y']+s['h']<=H
            else:
                for k in ['source','target']:
                    if s[k]:assert s[k][0] in ids
    with ZipFile(ROOT/'operations-solution.vsdx') as z:
        assert z.testzip() is None
        for n in z.namelist():
            if n.endswith('.xml') or n.endswith('.rels'):ET.fromstring(z.read(n))
    prohibited=re.compile(r'\b(?:echo|octobus|nuclio|mom)\b',re.I)
    for p in pages:
        for s in p.shapes:
            assert not prohibited.search(s.get('text',''))
    assert not prohibited.search((ROOT/'proposal.md').read_text())


def retained_context():
    p=Page('14-retained-context','Retained context  /  the first fifteen minutes','Three logical banks, bounded growth and a separate durable packet preserve the facts behind an alert.')
    source=p.card(56,185,300,155,'Named authenticated source','OTLP JSON logs / metrics\nDecoded CloudWatch streams\nExplicit native ID + scope',PALE,size=17)
    banks=[]
    for i,label in enumerate(['A  /  writing','B  /  retained','C  /  retained']):
        banks.append(p.card(414+i*380,185,300,155,label,'Configured byte / row budget\nGrow only to approved ceiling\nKeep receipt-time provenance',MINT,TEAL,17))
    p.connect(source,banks[0]);p.connect(banks[0],banks[1]);p.connect(banks[1],banks[2])
    p.line([(1324,340),(1324,385),(564,385),(564,340)],BLUE,False,(banks[2]['id'],(1324,340)),(banks[0]['id'],(564,340)))
    p.text(604,395,900,48,'Reclaim only when the newest receipt in the next bank is at least 900 seconds old.',17,BLUE,True)
    gate=p.card(56,475,460,160,'Percolate → suppress → correlate','Keep original alert and decision IDs\nA matching rule requests capture\nExact resource / preceding 15 minutes',ICE,BLUE,17)
    packet=p.card(634,475,430,160,'Pin preprocessed evidence','Copy bounded facts, hashes and times\nPacket survives raw-bank reuse\nNo raw-store or execution authority',MINT,TEAL,17)
    work=p.card(1182,475,362,160,'Investigation and review','Shared ticket workspace\nWorkflow-generated deliverables\nSeparate exact-action approval',PALE,BLUE,17)
    p.connect(gate,packet);p.connect(packet,work)
    p.line([(944,340),(944,450),(849,450),(849,475)],TEAL,False,(banks[1]['id'],(944,340)),(packet['id'],(849,475)))
    p.card(56,685,1488,121,'No silent overwrite at the ceiling','If all banks still contain protected context, reject and retry the entire incoming batch. A full bank does not authorize data loss.\nNative replay: 100 occurrences → 40 rule matches → 4 symptoms → 2 dependency groups → 4 persistent context packets.',SAND,AMBER,17)
    return p



def graph_explorer():
    p=Page('15-graph-explorer','Explore the estate in three dimensions','Installed and accepted: CPU perspective, exact snapshot identities and six bounded predefined queries.')
    p.card(56,185,415,272,'Choose a recorded snapshot','Collection + ISO observation time\nFocus asset + type + text search\nPreserve source / scope / native ID\nHealth: captured, not a live probe',PALE,size=18)
    p.card(511,185,1033,135,'Predefined queries','Estate overview  |  Dependencies  |  Impact on dependents\nPlacement  |  Observed degraded assets  |  Older than fifteen minutes',MINT,size=18)
    a=p.card(553,374,260,130,'API pod','Observed degraded\nSource-owned identity',ROSE,RED,18)
    b=p.card(984,338,260,130,'Cache pod','Recorded dependency\nObserved healthy',MINT,size=18)
    c=p.card(1160,546,300,130,'Worker node','Recorded RUNS_ON\nSame graph time',ICE,BLUE,18)
    p.connect(a,b);p.connect(a,c,BLUE)
    p.card(56,490,415,260,'Inspect without losing context','Orbit / pan / zoom / reset\nKeyboard controls + equivalent node list\n2D display remains available\n100 nodes / 500 visible edges\nRefresh or refusal clears private content',PALE,size=18)
    p.card(511,704,1033,106,'Native proof and interpretation','Six queries, orbit pixels and phone layout accepted at a8697163. Edges describe observed relationships; paths show potential impact, not proven causation.',SAND,AMBER,17)
    return p


def workflow_funnel():
    p=Page('16-workflow-funnel','Follow the evidence into accountable work','Measured native workflow: a sealed packet, three completed model phases and three verified shared-workspace files.')
    labels=[('100 events','Synthetic recorded cohort'),('40 matches','Actual stored queries'),('4 symptoms','Repeated keys suppressed'),('2 groups','Dependency correlation')]
    cards=[p.card(56+i*380,185,348,122,title,body,MINT,size=18) for i,(title,body) in enumerate(labels)]
    for a,b in zip(cards,cards[1:]):p.connect(a,b)
    p.text(56,330,1488,55,'The 100-event replay above and the one-packet native workflow acceptance below are separate cohorts; do not combine their counts.',18,AMBER,True)
    packet=p.card(56,420,300,172,'One pinned packet','Normalized identity + OTLP fact\nFixed input path + SHA256\nNo raw-store / cluster access',ICE,BLUE,17)
    ai=p.card(414,420,340,172,'Three completed phases','Investigate → review → revise\nActual inference receipts\nWorkflow generates answer.md',MINT,size=17)
    files=p.card(812,420,330,172,'Three verified files','Authenticated PVC downloads\nSizes + SHA256 matched\nNo operator-authored reports',MINT,size=17)
    approval=p.card(1200,420,344,172,'Awaiting report approval','Human gate in canonical ticket\nNo infrastructure action taken\nRecovery: not connected',SAND,AMBER,17)
    p.connect(packet,ai);p.connect(ai,files);p.connect(files,approval)
    p.card(56,650,720,155,'Current-user shared services','Shared HTTP and SMS/phone/Telegram services are development-installed. Three one-time notification tests are transport-accepted. Jira profile read returns404; live account validation and full kernel certification remain open.',PALE,size=17)
    p.card(812,650,732,155,'Next executable acceptance','Continuous source → automatic investigation → generated remediation bundle → exact-action approval → bounded execution → fresh recovery check. These gates remain open.',PALE,size=17)
    return p


def reviewed_handoff():
    p=Page('17-reviewed-handoff','Keep the workflow and external issue aligned','Development-installed shared services; original-person authority and transport acceptance remain separate from release certification.')
    workflow=p.card(56,185,320,160,'Canonical workflow','Owned ticket + exact revision\nStatus + phase trigger\nNo second ticket engine',ICE,BLUE,17)
    mapping=p.card(424,185,320,160,'Immutable mapping','Personal named account\nSelected endpoint revision\nExplicit provider state IDs',PALE,size=17)
    review=p.card(792,185,320,160,'Review and confirm','Show proposed operation\nReserve before dispatch\nRecheck authority + revision',MINT,size=17)
    provider=p.card(1160,185,384,160,'Standard connector action','Jira transition / GitLab state\nServiceNow incident state\nRead before + read after',MINT,size=17)
    p.connect(workflow,mapping);p.connect(mapping,review);p.connect(review,provider)
    p.card(56,405,720,175,'Unknown response: hold the attempt','No automatic transition retry. Read remote state to reconcile without another write. The durable readback is an operator report; server-attested delivery, webhooks and two-way conflict handling remain open.',SAND,AMBER,18)
    p.card(824,405,720,175,'Native acceptance and current limits','Installed controls and owner-scoped records pass native login. Jira profile read returns404, so live-provider validation remains open. No issue was changed. SQL/browser tests cover confirmation and lost acknowledgements.',PALE,size=17)
    p.card(56,638,720,172,'Shared alert services','Original-person topic routes use SMS, brief phone or Telegram. Phone is explicit opt-in: speak and hang up, thirty-second ceiling, no recording. Service configuration alone sends nothing.',ICE,BLUE,18)
    p.card(824,638,720,172,'Three transport tests accepted once','One SMS, one brief call and one Telegram. Reservations precede sends; test topics are muted. The operator confirmed the call. SMS later failed with Twilio30034 (unregistered A2P sender). Telegram acceptance was reconciled; human receipt is unverified.',MINT,size=17)
    return p


def swarm_promotion():
    p=Page('18-swarm-promotion','Jarvis to Jarvis: prove below, promote above','PROPOSED ROADMAP · Distinct identities, exact artifacts and separate deployment authority')
    upper=p.card(56,185,440,195,'Upper / production Jarvis','Own incident + production policy\nSelect repository, scope and lower swarm\nKeep production credentials local',ICE,BLUE,18)
    lower=p.card(608,185,440,195,'Lower / development Jarvis','Receive sealed evidence + bounded task\nReproduce → patch → test\nReturn linked ticket and test receipts',MINT,size=18)
    git=p.card(1160,185,384,195,'Standard Git connection','Original-user grants\nBranch + PR / MR + required CI\nImmutable commit and build digest',PALE,size=18)
    p.connect(upper,lower);p.connect(lower,git)
    evidence=p.card(608,455,440,165,'Evidence returned to the parent','Commit + artifact + test results\nExplicit uncertainty and rollback plan\nDurable correlated delegation receipt',PALE,size=18)
    gate=p.card(56,455,440,165,'Upper promotion gate','Approve this artifact and target\nRecheck current authority and revision\nA child result never grants deployment',SAND,AMBER,18)
    p.line([(1352,380),(1352,417),(828,417),(828,455)],source=(git['id'],(1352,380)),target=(evidence['id'],(828,455)))
    p.line([(608,537),(496,537)],source=(evidence['id'],(608,537)),target=(gate['id'],(496,537)))
    watch=p.card(56,690,992,125,'Deploy → observe → reconcile','Scope execution to the approved plan. Verify sustained health. Roll back only with current authority. Preserve the independent recovery path if upper Jarvis is unavailable.',MINT,size=17)
    p.line([(276,620),(276,655),(552,655),(552,690)],source=(gate['id'],(276,620)),target=(watch['id'],(552,690)))
    p.card(1160,455,384,360,'Delivery gates H1–H5','H1: scoped Git operations\nH2: bounded durable delegation\nH3: lower reproduction + verification\nH4: exact-change promotion + rollback\nH5: independent upper recovery\n\nProve duplicate, revoked, expired and lost-response cases. No hierarchy is implemented by this diagram.',PALE,size=17)
    return p


def response_verification():
    p=Page('19-response-verification','Fast mitigation and durable repair','PROPOSED DESIGN · One incident, linked change records, evidence-based recovery')
    p.card(56,178,352,175,'Mitigate + fix below','Restore a known safe state\nDelegate permanent correction\nSeparate later promotion approval',MINT,size=17)
    p.card(432,178,352,175,'Standard lower fix','Reproduce and test below\nRun CI/CD and return receipts\nPromote the exact approved artifact',ICE,BLUE,17)
    p.card(808,178,352,175,'Emergency runtime patch','One reversible scoped change\nCapture prior state + review deadline\nMandatory Git reconciliation',SAND,AMBER,17)
    p.card(1184,178,360,175,'Expedited Git hotfix','Reviewed production artifact\nMinimum checks + explicit waiver\nBack-merge and full validation',SAND,AMBER,17)
    change=p.card(56,411,352,175,'Exact-change execution','Target + plan + artifact digests\nCurrent approval and authorization\nRecord receipt and previous state',PALE,size=17)
    watch=p.card(480,411,384,175,'Read-only verification branch','Versioned signals + baseline\nFreshness + sustained healthy window\nBounded duration; no LLM polling loop',MINT,size=17)
    p.connect(change,watch)
    healthy=p.card(976,392,568,110,'Healthy window complete','Record service recovery. Keep permanent fix and drift reconciliation open until proven.',MINT,size=17)
    regression=p.card(976,529,568,110,'Regression','Follow conditional rollback only if already authorized and still valid; otherwise request approval.',ROSE,RED,17)
    unknown=p.card(976,666,568,110,'Missing telemetry / timeout','Hold verification and escalate. Silence never establishes recovery.',SAND,AMBER,17)
    p.connect(watch,healthy);p.connect(watch,regression);p.connect(watch,unknown)
    p.card(56,666,808,110,'Track two outcomes','Service status: degraded / observing / recovered. Change status: temporary / permanent fix pending / reconciled. A successful command alone closes neither.',PALE,size=17)
    return p


def pod_workbench():
    p=Page('20-pod-workbench','Investigate a pod without handing AI the cluster','IMPLEMENTED SOURCE · Original-person connector and bounded evidence; runtime checks have separate receipts')
    view=p.card(56,185,352,185,'Operator workbench','Expand workload → pod → container\nRead current status and logs\nReview exact target + argv',ICE,BLUE,17)
    gate=p.card(488,185,432,185,'Shared connection gate','Original-person named connection\nFresh confirmation + namespace / UID\nPinned API address and selected CA',MINT,size=17)
    cluster=p.card(1032,185,512,185,'Kubernetes API','Dedicated namespace Role: pods / log / exec\nNative HTTPS and v5 WebSocket\nNo host kubeconfig or bot credential',MINT,size=17)
    p.connect(view,gate);p.connect(gate,cluster)
    packet=p.card(1032,505,512,185,'Normalized result','Captured health and bounded output\nVerified exit receipt or unknown outcome\nNo raw spec, environment or credential',PALE,size=17)
    analyst=p.card(488,505,432,185,'Accountable analysis','Selected pod / container packet\nShow the evidence supplied to AI\nInterpret or propose; never auto-execute',ICE,BLUE,17)
    stage=p.card(56,505,352,185,'Stage a suggestion','Inspect proposed arguments\nNew exact review before execution\nNo automatic action retry',SAND,AMBER,17)
    p.connect(cluster,packet,vertical=True)
    p.line([(1032,597),(920,597)],source=(packet['id'],(1032,597)),target=(analyst['id'],(920,597)))
    p.line([(488,597),(408,597)],source=(analyst['id'],(488,597)),target=(stage['id'],(408,597)))
    p.line([(232,505),(232,370)],dash=True,source=(stage['id'],(232,505)),target=(view['id'],(232,370)))
    p.card(56,715,1488,105,'Operational limits','Initial console: bounded single commands, no stdin/TTY. Check UID before and after; this is not an atomic exec precondition. A client timeout does not prove remote termination or service recovery.',SAND,AMBER,15)
    return p


def rca_references():
    p=Page('21-rca-references','Historical RCA with original source citations','IMPLEMENTED SOURCE · Read current-user canonical records; preserve one report store and explicit uncertainty')
    tickets=p.card(56,185,440,170,'Canonical tickets','Current-user incident catalogue\nSource title, status and identity\nNo invented cause or replacement title',ICE,BLUE,17)
    work=p.card(580,185,440,170,'Original work records','Analysis / review / revision\nCompleted work + result receipt\nInput digest and source file hashes',MINT,size=17)
    artifacts=p.card(1104,185,440,170,'Accepted artifacts','Original workspace file selector\nExact ticket + accepted work\nContent bytes and SHA-256',MINT,size=17)
    p.connect(tickets,work);p.connect(work,artifacts)
    catalogue=p.card(56,490,440,175,'Find an incident','Search loaded ticket metadata\nFilter state; select a case\nPartial lineage remains explicit',PALE,size=17)
    report=p.card(580,490,440,175,'Review the original analysis','Safe report preview + native ticket link\nInspect the input supplied to the bot\nUnknown cause stays unknown',PALE,size=17)
    citation=p.card(1104,490,440,175,'Follow its evidence','Open exact accepted artifacts\nReject other-ticket or arbitrary URLs\nFresh source authorization applies',PALE,size=17)
    p.connect(tickets,catalogue,vertical=True);p.connect(work,report,vertical=True);p.connect(artifacts,citation,vertical=True)
    p.connect(catalogue,report);p.connect(report,citation)
    p.card(56,715,1488,105,'Storage and retrieval boundaries','Temporal topology and correlation stay in their graph records. Reports stay in canonical work and workspace artifacts. Automatic semantic case retrieval is a separate backlog item. Report acceptance does not establish infrastructure recovery.',SAND,AMBER,15)
    return p


def main():
    if sys.argv[1:] not in [[], ['--manifest-only'], ['--plan-only']]:
        raise SystemExit('Use no arguments, --manifest-only, or --plan-only.')
    pages=[f() for f in [architecture,topology,pipeline,authority,overview,setup,approval,delivery,data_decisions,integrations,connection_identity,detection,temporal_graph,retained_context,graph_explorer,workflow_funnel,reviewed_handoff,swarm_promotion,response_verification,pod_workbench,rca_references]]
    if not sys.argv[1:]:
        (ROOT/'previews').mkdir(exist_ok=True)
        for i,p in enumerate(pages,1):render_svg(p,ROOT/'previews'/f'{p.slug}.svg',i,len(pages))
        render_diagram_pdf(pages,ROOT/'operations-solution.pdf')
        render_visio(pages,ROOT/'operations-solution.vsdx')
        proposal=(ROOT/'proposal.md').read_text();documents(proposal,'operations-proposal')
        problem=proposal.split('## Problem statement\n\n',1)[1].split('\n## Proposed solution',1)[0]
        documents('# TriageNorth problem statement\n\n'+problem,'problem-statement')
        decisions=(ROOT/'DECISIONS.md').read_text()
        for adr in sorted((ROOT/'adr').glob('*.md')):decisions+='\n\n'+adr.read_text()
        documents(decisions,'operations-decisions')
        documents((ROOT/'PRODUCT-BRIEF.md').read_text(),'triagenorth-brief')
        documents((ROOT/'MARKET-RESEARCH.md').read_text(),'triagenorth-market-research')
        documents((ROOT/'STREAMS-AND-REPLAY.md').read_text(),'triagenorth-context-replay')
        documents((ROOT/'OPERATING-GUIDE.md').read_text(),'triagenorth-operating-guide')
        documents((ROOT/'SWARM-PROMOTION-ROADMAP.md').read_text(),'operations-swarm-promotion-roadmap')
        documents((ROOT/'RESPONSE-PATH-DESIGN.md').read_text(),'operations-response-design')
        documents((ROOT/'POD-CONSOLE.md').read_text(),'operations-pod-workbench')
        documents((ROOT/'RCA-LIBRARY.md').read_text(),'operations-rca-library')
    if (not sys.argv[1:] or sys.argv[1:]==['--plan-only']) and (ROOT/'PROJECT-PLAN.md').exists():
        documents((ROOT/'PROJECT-PLAN.md').read_text(),'operations-project-plan')
    validate(pages)
    manifest={'diagram_pages':len(pages),'editable_shapes':sum(len(p.shapes) for p in pages),'glued_connectors':sum(1 for p in pages for s in p.shapes if s['kind']=='line' and (s['source'] or s['target'])),'files':{}}
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and path.name not in ['build-manifest.json'] and '__pycache__' not in str(path):
            manifest['files'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
    (ROOT/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:v for k,v in manifest.items() if k!='files'},indent=2))


if __name__=='__main__':main()
