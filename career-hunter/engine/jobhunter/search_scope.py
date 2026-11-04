# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Recheck ambiguous legacy workplace flags before radius bypass while retaining local hybrid and on-site matches.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Select only the owner's local-radius or remote jobs before scoring and keep remote-company distance out of commute preference.
"""An owner-private hunt scope, independent of shared objective posting data."""
from __future__ import annotations
import json
import math
import stat
from .work_arrangement import fully_remote_predicate

FILE_NAME = 'job-search-scope.json'
EARTH_MILES = 3958.7613

def valid(value):
    def number(name, low, high):
        v = value.get(name)
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and low <= v <= high
    return (isinstance(value, dict) and value.get('version') == 1
            and isinstance(value.get('near'), str) and 0 < len(value['near']) <= 160
            and all(ord(c) >= 32 and ord(c) != 127 for c in value['near'])
            and number('lat', -90, 90) and number('lon', -180, 180) and number('radiusMiles', 1, 250)
            and isinstance(value.get('includeRemote'), bool))

def load(directory):
    file = directory / FILE_NAME
    try:
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 2048:
            raise ValueError('Stored search scope is unavailable')
        value = json.loads(file.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None
    if not valid(value):
        raise ValueError('Stored search scope is unavailable')
    return value

def predicate(scope, postgres=False):
    if not valid(scope):
        raise ValueError('Stored search scope is unavailable')
    lat, lon, radius = float(scope['lat']), float(scope['lon']), float(scope['radiusMiles'])
    angular = radius / EARTH_MILES
    delta = math.degrees(angular)
    bounds = [f"lat BETWEEN {max(-90,lat-delta)} AND {min(90,lat+delta)}", 'lon BETWEEN -180 AND 180',
              "city IS NOT NULL AND trim(city) != ''"]
    if lat-delta > -90 and lat+delta < 90:
        dl = math.degrees(math.asin(min(1, math.sin(angular) / math.cos(math.radians(lat)))))
        low, high = lon-dl, lon+dl
        if low < -180: bounds.append(f'(lon >= {low+360} OR lon <= {high})')
        elif high > 180: bounds.append(f'(lon >= {low} OR lon <= {high-360})')
        else: bounds.append(f'lon BETWEEN {low} AND {high}')
    least, greatest = ('LEAST', 'GREATEST') if postgres else ('MIN', 'MAX')
    h = (f'sin(radians(lat - {lat})/2)*sin(radians(lat - {lat})/2)'
         f' + cos(radians({lat}))*cos(radians(lat))*sin(radians(lon - {lon})/2)*sin(radians(lon - {lon})/2)')
    bounds.append(f'{2*EARTH_MILES}*asin(sqrt({least}(1.0,{greatest}(0.0,{h})))) <= {radius}')
    local = ' AND '.join(bounds)
    remote = fully_remote_predicate()
    return f'({remote} OR ({local}))' if scope['includeRemote'] else f'(NOT {remote} AND ({local}))'

def summary(scope):
    remote = ('Fully remote work is welcome independently of the employer office distance; check any country, state or timezone eligibility requirements.'
              if scope['includeRemote'] else 'The candidate is seeking local work.')
    return (f"\n\nCURRENT JOB HUNT: Local or hybrid work within {scope['radiusMiles']} miles of {scope['near']} "
            f"(approximate city distance); closer commutes are preferred. {remote} "
            'Do not treat the headquarters location of a fully remote job as a required commute. '
            'A feed remote flag is unverified: read the description. Flag incompatible residency requirements or required on-site attendance outside the local radius as eligibility gaps.')
