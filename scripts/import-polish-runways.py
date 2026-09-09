#!/usr/bin/env python3
"""Build the offline runway catalogue from downloaded OurAirports CSVs and OSM JSON.

Usage: python3 scripts/import-polish-runways.py airports.csv runways.csv osm.json
Source downloads, licence and reviewed exceptions: docs/polish-airports.md.
"""
import csv
import datetime
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
HARD = {'asp', 'asph', 'asphalt', 'ashpalt', 'con', 'concrete', 'pem',
        'asphalt concrete', 'asph-conc', 'conc/asph', 'conc-asph', 'brick',
        'concrete:plates', 'concrete_panels', 'paved', 'asphalt-concrete'}
# An airport being in the directory does not make a disused pavement operational.
EXCLUDED = {'PL-0272': 'Disused museum runway at Kraków-Czyżyny',
            'PL-0273': 'Former Sochaczew military runway; no current flying operations verified',
            'EPNA': 'Nadarzyce military training range, not an operational aerodrome'}
WIDTHS = {'EPGY': 24, 'EPKB': 20, 'PL-0100': 20, 'PL-0184': 12}

def distance(p, q):
    lat1, lon1, lat2, lon2 = map(math.radians, [*p, *q])
    a = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(a)))

def bearing(p, q):
    lat1, lon1, lat2, lon2 = map(math.radians, [*p, *q])
    return math.degrees(math.atan2(math.sin(lon2-lon1)*math.cos(lat2),
        math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(lon2-lon1))) % 360

def destination(p, heading, metres):
    lat, lon, h = map(math.radians, [*p, heading]); d = metres / 6371008.8
    end = math.asin(math.sin(lat)*math.cos(d)+math.cos(lat)*math.sin(d)*math.cos(h))
    return [math.degrees(end), math.degrees(lon+math.atan2(math.sin(h)*math.sin(d)*math.cos(lat), math.cos(d)-math.sin(lat)*math.sin(end)))]

def number(s, default=0):
    try: return float(re.match(r'[-\d.]+', str(s))[0])
    except (TypeError, ValueError): return default

def axis_error(a, b): return abs((a-b+90) % 180-90)
def closed(tags): return any(tags.get(k) in ('yes', 'runway') for k in ('disused', 'abandoned', 'disused:aeroway', 'abandoned:aeroway', 'construction'))
def endpoints(w): return [[g['lat'], g['lon']] for g in (w['geometry'][0], w['geometry'][-1])]
def centre(points): return [(points[0][i]+points[-1][i])/2 for i in (0, 1)]

def build(airports_file, runways_file, osm_file):
    all_airports = list(csv.DictReader(open(airports_file)))
    airports = {a['ident']: a for a in all_airports if a['iso_country'] == 'PL'}
    neighbours = [a for a in all_airports if 48 < float(a['latitude_deg']) < 56 and 13 < float(a['longitude_deg']) < 25]
    source_runways = [r for r in csv.DictReader(open(runways_file)) if r['airport_ident'] in airports]
    osm = json.load(open(osm_file))
    ways = osm['elements']
    records, used, omissions = [], set(), []

    def eligible(a): return a['type'] in ('small_airport', 'medium_airport', 'large_airport') and a['ident'] not in EXCLUDED
    def nearby(a):
        p = [float(a['latitude_deg']), float(a['longitude_deg'])]
        return [w for w in ways if w['geometry'][0] != w['geometry'][-1] and distance(p, centre(endpoints(w))) < 2500]

    def add(a, r, w, points):
        t = w['tags'] if w else {}
        if w: used.add(w['id'])
        heading = bearing(*points)
        idents = [r['le_ident'], r['he_ident']] if r else re.findall(r'\d{2}[LRC]?', t.get('ref', t.get('direction', '')))
        if len(idents) != 2:
            n = round(heading/10) % 36 or 36
            idents = [f'{n:02}', f'{(n+17)%36+1:02}']
        # The OSM way can run in either direction. Orient it to the first designator.
        nominal = int(re.match(r'\d+', idents[0])[0])*10
        if abs((heading-nominal+180)%360-180) > 90:
            points.reverse(); heading = bearing(*points)
        length = distance(*points)
        thresholds = [number(r.get(f'{e}_displaced_threshold_ft'))*.3048 for e in ('le','he')] if r else [0,0]
        if w:
            # OSM often splits off the pavement before a displaced threshold.
            # Rejoin it, but never offer that fragment as a separate runway.
            for end in (0, 1):
                for fragment in ways:
                    if fragment['tags'].get('runway') != 'displaced_threshold': continue
                    f = endpoints(fragment)
                    for i in (0, 1):
                        if distance(points[end], f[i]) < 2:
                            thresholds[end] = max(thresholds[end], distance(*f))
                            points[end] = f[1-i]; used.add(fragment['id']); break
            heading = bearing(*points); length = distance(*points)
        if r:
            declared = number(r['length_ft'])*.3048
            # Source end coordinates sometimes describe an old, longer pavement.
            if declared and length > declared*1.1:
                points[1] = destination(points[0], heading, declared); length = declared
        width = number(r['width_ft'])*.3048 if r and r['width_ft'] else number(t.get('width'), WIDTHS.get(a['ident'], 0))
        if width <= 0:
            omissions.append({'airport': a['ident'], 'reason': 'Missing verified width', 'osm': w['id'] if w else None}); return
        elevation = number(r.get('le_elevation_ft'), number(a['elevation_ft']))*.3048 if r else number(a['elevation_ft'])*.3048
        sources = [f'https://ourairports.com/airports/{a["ident"]}/']
        if r: sources.append(f'ourairports:runway:{r["id"]}')
        if w: sources.append(f'https://www.openstreetmap.org/way/{w["id"]}')
        airport_id = a.get('icao_code') or a['ident']
        # Operator publishes the usable central 1190 m, not the entire former runway.
        if a['ident'] == 'PL-0074':
            points[0] = destination(points[0], heading, 370)
            length = 1190; thresholds = [0,0]; airport_id = 'EPPG'; elevation = 310*.3048
            sources.append('https://www.lotniskokakolewo.pl/en/aviation/for-pilots/')
        record = dict(id=f'{airport_id}-{idents[0]}-{idents[1]}', airportId=airport_id,
            airportName=a['name'], municipality=a['municipality'], lat=round(points[0][0],7), lon=round(points[0][1],7),
            heading=round(heading,4), length=round(length,1), width=round(width,1), elevation=round(elevation+35,2),
            surface=(r['surface'] if r else t['surface']), lighted=bool(r and r['lighted']=='1'),
            ends=[dict(ident=ident, threshold=round(threshold,1)) for ident,threshold in zip(idents,thresholds)], sources=sources)
        if min(thresholds)<0 or sum(thresholds)>=length or not 250<=length<=5000:
            omissions.append({'airport':a['ident'],'reason':'Invalid or very short runway geometry'}); return
        records.append(record)

    for r in source_runways:
        a=airports[r['airport_ident']]
        if not eligible(a) or r['closed']=='1' or r['surface'].lower() not in HARD: continue
        matches=[]
        for w in nearby(a):
            t=w['tags']
            if t.get('surface','').lower() not in HARD or t.get('runway')=='displaced_threshold':continue
            h=bearing(*endpoints(w)); nominal=number(r['le_heading_degT'],number(r['le_ident'])*10)
            if axis_error(h,nominal)<22: matches.append(w)
        w=min(matches,key=lambda w: abs(distance(*endpoints(w))-number(r['length_ft'])*.3048)) if matches else None
        if w and closed(w['tags']): continue
        if w: points=endpoints(w)
        elif all(r[f'{e}_{axis}_deg'] for e in ('le','he') for axis in ('latitude','longitude')):
            points=[[float(r[f'{e}_latitude_deg']),float(r[f'{e}_longitude_deg'])] for e in ('le','he')]
        else:
            omissions.append({'airport':a['ident'],'reason':'No runway endpoint coordinates'});continue
        add(a,r,w,points)

    for w in ways:
        t=w['tags']
        if w['id'] in used or t.get('surface','').lower() not in HARD or closed(t) or t.get('runway')=='displaced_threshold':continue
        points=endpoints(w)
        if distance(*points)<250:continue
        c=centre(points);a=min(neighbours,key=lambda a:distance(c,[float(a['latitude_deg']),float(a['longitude_deg'])]))
        if a['iso_country']!='PL' or not eligible(a) or distance(c,[float(a['latitude_deg']),float(a['longitude_deg'])])>1500:continue
        # Do not resurrect closed source runways or duplicate a nearby airport's strip.
        if any(r['airport_ident']==a['ident'] and r['closed']=='1' and axis_error(bearing(*points),number(r['le_heading_degT'],number(r['le_ident'])*10))<22 for r in source_runways):continue
        if any(distance(c,destination([r['lat'],r['lon']],r['heading'],r['length']/2))<650 and axis_error(bearing(*points),r['heading'])<20 for r in records):continue
        add(a,None,w,points)
    # The Rzeszów sports strip also occurs under EPRZ in OurAirports. Keep its own airport entry.
    records=[r for r in records if not ((r['airportId']=='EPRZ' and r['ends'][0]['ident']=='08R') or r['airportId']=='EPSW')]
    records.sort(key=lambda r:(r['airportId'],r['id']))
    return {'updated':str(datetime.date.today()),'sources':{'ourAirports':'https://ourairports.com/data/',
        'openStreetMap':'https://www.openstreetmap.org/copyright','osmTimestamp':osm.get('osm3s',{}).get('timestamp_osm_base')},
        'excluded':EXCLUDED,'omissions':omissions,'runways':records}

if __name__=='__main__':
    data=build(*sys.argv[1:4])
    target=ROOT/'src/data/polishRunways.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(f'{len(data["runways"])} runways at {len({r["airportId"] for r in data["runways"]})} airports; omissions: {data["omissions"]}')
