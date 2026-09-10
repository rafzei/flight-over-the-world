"""Build the compact, public-domain OurAirports index used for traffic forecasts.

Usage: python3 scripts/import-traffic-runways.py airports.csv runways.csv
Sources: https://davidmegginson.github.io/ourairports-data/
"""
import csv
import datetime
import json
import math
import pathlib
import sys


def number(row, key, fallback=None):
    try:
        value = float(row[key])
        return value if math.isfinite(value) else fallback
    except (ValueError, KeyError, TypeError):
        return fallback


with open(sys.argv[1], encoding="utf-8-sig", newline="") as source:
    airports = {row["ident"]: row for row in csv.DictReader(source)}
records = []
with open(sys.argv[2], encoding="utf-8-sig", newline="") as source:
    for row in csv.DictReader(source):
        airport = airports.get(row["airport_ident"])
        if not airport or airport["type"] not in {"small_airport", "medium_airport", "large_airport"} or row["closed"] != "0":
            continue
        length = number(row, "length_ft", 0) * .3048
        if length < 800:
            continue
        for prefix in ("le", "he"):
            lat = number(row, f"{prefix}_latitude_deg")
            lon = number(row, f"{prefix}_longitude_deg")
            heading = number(row, f"{prefix}_heading_degT")
            elevation = number(row, f"{prefix}_elevation_ft", number(airport, "elevation_ft"))
            if None in (lat, lon, heading, elevation) or abs(lat) > 90 or abs(lon) > 180:
                continue
            displaced = number(row, f"{prefix}_displaced_threshold_ft", 0) * .3048
            distance = displaced / 6371008.8
            p, l, b = map(math.radians, (lat, lon, heading))
            p2 = math.asin(math.sin(p) * math.cos(distance) + math.cos(p) * math.sin(distance) * math.cos(b))
            l2 = l + math.atan2(math.sin(b) * math.sin(distance) * math.cos(p), math.cos(distance) - math.sin(p) * math.sin(p2))
            records.append([f'{row["id"]}:{prefix}', airport.get("icao_code") or airport["ident"], row[f"{prefix}_ident"],
                            round(math.degrees(p2), 6), round((math.degrees(l2) + 180) % 360 - 180, 6), round(heading % 360, 2),
                            round(length - displaced), round(number(row, "width_ft", 100) * .3048), round(elevation * .3048, 1)])
output = pathlib.Path(__file__).resolve().parents[1] / "public/data/traffic-runways.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"version": 1, "updated": datetime.date.today().isoformat(),
                              "source": "https://ourairports.com/data/", "license": "Public domain",
                              "columns": ["id", "airport", "ident", "lat", "lon", "heading", "length", "width", "elevation"],
                              "runways": records}, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {len(records)} runway directions to {output}")
