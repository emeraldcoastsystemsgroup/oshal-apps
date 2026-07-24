"""Target-role gate: is a posting in the user's target lane — a technology / senior-professional
role he'd actually take — vs. retail/labor/clinical noise (cashier, driver, package
handler, nurse, store associate) that bulk retailers post by the tens of thousands.

Rule: a genuine tech or senior-leadership signal in the TITLE includes it; an unambiguous
labor/service title with no such signal excludes it. Title-only so it's instant to backfill.
"""
from __future__ import annotations
import re

# Technology + senior-professional signals. Any match → in-lane.
_TECH = re.compile(r"""
    engineer|engineering|developer|architect|devops|devsecops|\bsre\b|site\ reliability|
    \bcloud\b|platform|infrastructure|kubernetes|\bdocker\b|software|firmware|backend|
    front[\ -]?end|full[\ -]?stack|\bdata\b|database|\bdba\b|machine\ learning|\bml\b|
    \bai\b|artificial\ intelligence|\bllm\b|cyber|\binfosec\b|information\ security|
    \bsecurity\ (?:engineer|architect|analyst|lead|manager|operations)|
    program\ manager|project\ manager|product\ manager|technical\ program|delivery\ manager|
    engineering\ manager|program\ management|\bscrum\b|\bagile\b|release\ manager|
    \bqa\b|quality\ engineer|test\ engineer|automation|\bsdet\b|reliability|
    \bdirector\b|vice\ president|\bvp\b|\bsvp\b|\bevp\b|principal|distinguished|staff\ engineer|
    head\ of|\bcto\b|\bcio\b|\bciso\b|chief\ (?:technology|information|data|product|digital)|
    \btechnical\b|\bit\b|information\ technology|\bsystems?\b|network|solutions?\ (?:architect|engineer|consultant|manager)|
    sales\ engineer|presales|solution\ architect|integration|\bapi\b|\bsaas\b|
    analytics|business\ intelligence|\bbi\b|data\ scientist|\bsysadmin\b|administrator|
    technologist|\bux\b|\bui\b|product\ design|technical\ writer|scrum\ master|
    \bpmo\b|portfolio\ manager|enterprise\ architect|machine|robotics|embedded|\bqa\b
""", re.I | re.X)

# Unambiguous labor / service / clinical titles. Excluded UNLESS a tech signal is also present
# (so "Delivery Solutions Architect" or "Warehouse Automation Engineer" still qualify).
_NON = re.compile(r"""
    cashier|truck\ driver|\bdriver\b|package\ handler|warehouse\ (?:associate|worker|operative|team)|
    store\ (?:associate|clerk|manager|lead)|sales\ associate|retail\ sales|stocker|merchandiser|
    forklift|\bpicker\b|\bpacker\b|custodian|janitor|\bcourier\b|delivery\ driver|dock\ worker|
    barista|line\ cook|\bcook\b|\bserver\b|waiter|waitress|dishwasher|busser|host(?:ess)?|
    cleaner|housekeep|laborer|landscap|groundskeep|\bcna\b|\brn\b|\blpn\b|registered\ nurse|
    nurse|caregiver|patient\ care|phlebotom|pharmacy\ technician|dental|medical\ assistant|
    security\ guard|loss\ prevention|\bteller\b|bank\ teller|\bbarback\b|valet|
    diesel|mechanic|maintenance\ technician|hvac|electrician|plumber|welder|machinist|
    assembler|production\ (?:associate|worker|operator)|line\ operator|crew\ member|
    team\ member|store\ employee|deli|bakery|cart\ attendant|fulfillment\ associate|
    delivery\ (?:associate|partner)|seasonal|part[\ -]time\ (?:warehouse|package|retail)
""", re.I | re.X)


def is_target_role(title: str) -> bool:
    t = (title or "").strip().lower()
    if not t:
        return False
    tech = bool(_TECH.search(t))
    if _NON.search(t) and not tech:
        return False
    return tech
