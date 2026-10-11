#!/usr/bin/env python3
"""Export ENTSO-E România: Python 3.9+, curl; fără pachete Python externe.
python3 entsoe_data.py --year 2025
Token: ENTSOE_TOKEN sau prompt ascuns. Nu se salvează în configurare/loguri.
"""
import argparse
import calendar
import csv
import getpass
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, quote
from zoneinfo import ZoneInfo

YEAR = 2025
ROMANIA = "10YRO-TEL------P"
TIMEZONE = "Europe/Bucharest"
BASE_URL = "https://web-api.tp.entsoe.eu/api"
REQUESTS_PER_MINUTE = 60   # Toate cererile și reîncercările acestei rulări.
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "Data/Entsoe"
CA_BUNDLE = Path(__file__).with_name("cacert.pem")
NEIGHBOURS = {"BG": "10YCA-BULGARIA-R", "HU": "10YHU-MAVIR----U",
              "RS": "10YCS-SERBIATSOV", "MD": "10Y1001A1001A990",
              "UA": "10Y1001C--00003F"}
WIND_PROCESSES = {"day_ahead": "A01", "intraday": "A40", "current": "A18"}
BID_PROCESSES = {"aFRR": "A51", "mFRR": "A47", "RR": "A46",
                 "mFRR_scheduled": "A60", "mFRR_direct": "A61",
                 "aFRR_central": "A67", "aFRR_local": "A68"}
REPORTS = ["load_actual", "load_day_ahead", "installed_capacity", "generation_day_ahead",
           "wind_solar_forecast", "generation_actual", "reservoirs", "commercial_exchanges",
           "physical_flows", "outages_production", "outages_generation", "imbalance_prices",
           "imbalance_volumes", "balancing_bids"]
SOURCE = "https://documenter.getpostman.com/view/7009892/2s93JtP3F6"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stamp(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def dt(text):
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Timp XML fără fus orar")
    return value.astimezone(timezone.utc)


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


class APIError(Exception):
    pass


class AuthError(APIError):
    pass


class TransportError(APIError):
    pass


class TooMuchData(APIError):
    pass


def strip_ns(data):
    root = ET.fromstring(data)
    for element in root.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    return root


def unpack(data):
    """Returnează toate XML-urile din ZIP; fără extragere de căi furnizate de server."""
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = [i for i in archive.infolist() if not i.is_dir()]
            if not infos or any(not i.filename.lower().endswith(".xml") for i in infos):
                raise APIError("ZIP gol sau cu fișiere neașteptate")
            return [archive.read(i) for i in infos]
    return [data]


def inspect_response(data, requested_type):
    docs = []
    empty = []
    for xml in unpack(data):
        root = strip_ns(xml)
        if root.tag == "Acknowledgement_MarketDocument":
            text = "; ".join(r.findtext("text", "") for r in root.findall(".//Reason"))
            lowered = text.lower()
            if "no matching data" in lowered or "no data found" in lowered:
                empty.append(text)
            elif any(s in lowered for s in ("exceeds", "exceeded", "too many", "maximum", "limit of")):
                raise TooMuchData(text)
            else:
                raise APIError("API acknowledgement: " + text)
        else:
            if root.findtext("type") != requested_type:
                raise APIError("Tipul documentului primit diferă de cel cerut")
            docs.append(xml)
    if docs and empty:
        raise APIError("Răspuns mixt: documente și acknowledgement fără date")
    if not docs and not empty:
        raise APIError("Răspuns fără documente sau explicație")
    return docs, empty


class Client:
    def __init__(self, token, folder, rpm, refresh=False, ca_bundle=None):
        self.token, self.folder, self.refresh = token, folder, refresh
        self.ca_bundle = ca_bundle
        self.interval, self.next_time = 60 / rpm, 0.0
        self.requests = 0
        self.folder.mkdir(parents=True, exist_ok=True)

    def clean(self, value):
        return str(value).replace(self.token, "[TOKEN]").replace(quote(self.token), "[TOKEN]")

    def wait(self, delay):
        while delay > 0:
            part = min(delay, 30)
            time.sleep(part)
            delay -= part

    def fetch(self, params):
        key = digest(canonical({"endpoint": BASE_URL, "params": params}).encode())
        raw, meta = self.folder / (key + ".bin"), self.folder / (key + ".json")
        if not self.refresh and raw.exists() and meta.exists():
            data = raw.read_bytes()
            info = json.loads(meta.read_text())
            if digest(data) == info.get("sha256"):
                docs, empty = inspect_response(data, params["documentType"])
                return docs, empty, key
        url = BASE_URL + "?" + urlencode({**params, "securityToken": self.token})
        config = 'url = "' + url.replace("\\", "\\\\").replace('"', '\\"') + '"\n'
        for attempt in range(5):
            self.wait(max(0, self.next_time - time.monotonic()))
            self.next_time = time.monotonic() + self.interval
            self.requests += 1
            with tempfile.TemporaryDirectory(prefix="entsoe_") as folder:
                header_path = Path(folder) / "headers"
                result = subprocess.run(["curl", "--silent", "--show-error", "--connect-timeout", "20",
                                         "--max-time", "120", "--dump-header", str(header_path),
                                         "--write-out", "\n%{http_code}", "--config", "-"] +
                                        (["--cacert", str(self.ca_bundle)] if self.ca_bundle else []),
                                        input=config.encode(), capture_output=True)
                headers = header_path.read_text(errors="replace") if header_path.exists() else ""
            body, _, status_bytes = result.stdout.rpartition(b"\n")
            status = int(status_bytes) if status_bytes.isdigit() else 0
            if result.returncode in (35, 51, 58, 60, 77):
                raise TransportError(f"curl {result.returncode}: conexiunea TLS nu poate fi validată. "
                                     "Verifică certificatele sistemului sau folosește --ca-bundle cu un pachet CA de încredere.")
            if status in (401, 403):
                raise AuthError(f"HTTP {status}: token nevalid, acces neactivat sau restricție de acces")
            transient = result.returncode != 0 or status == 429 or status >= 500
            if transient:
                if attempt == 4:
                    raise APIError(f"HTTP {status}; curl {result.returncode}; 5 încercări eșuate")
                delay = 610 if status == 429 else 5 * 2 ** attempt
                retry_after = re.findall(r"(?im)^retry-after:\s*([^\r\n]+)", headers)
                if retry_after:
                    try:
                        value = retry_after[-1].strip()
                        delay = max(delay, int(value) if value.isdigit() else
                                    (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
                    except (ValueError, TypeError):
                        pass
                print(f"HTTP {status}: reîncercare peste {delay:.0f}s", flush=True)
                self.wait(delay)
                continue
            try:
                docs, empty = inspect_response(body, params["documentType"])
            except (APIError, ET.ParseError, zipfile.BadZipFile) as exc:
                if isinstance(exc, TooMuchData):
                    raise TooMuchData(self.clean(exc)) from None
                raise APIError(f"HTTP {status}: {self.clean(exc)}") from None
            if status != 200 and not empty:
                raise APIError(f"HTTP {status}: răspuns neașteptat")
            # Un răspuns normal nu conține tokenul. Nu salva un răspuns care îl reflectă.
            if self.token.encode() in body or any(self.token.encode() in x for x in docs):
                raise APIError("Răspunsul reflectă tokenul; nu a fost salvat")
            temporary = raw.with_suffix(".tmp")
            temporary.write_bytes(body)
            temporary.replace(raw)
            write_json(meta, {"parameters": params, "sha256": digest(body), "httpStatus": status,
                              "downloadedAtUTC": stamp(datetime.now(timezone.utc)),
                              "documents": len(docs), "noData": empty})
            return docs, empty, key


def profiles(selected, neighbours):
    definitions = {
        "load_actual": ("A65", "A16", "outBiddingZone_Domain", "monthly"),
        "load_day_ahead": ("A65", "A01", "outBiddingZone_Domain", "monthly"),
        "installed_capacity": ("A68", "A33", "in_Domain", "annual"),
        "generation_day_ahead": ("A71", "A01", "in_Domain", "monthly"),
        "generation_actual": ("A75", "A16", "in_Domain", "monthly"),
        "reservoirs": ("A72", "A16", "in_Domain", "annual"),
        "imbalance_prices": ("A85", None, "controlArea_Domain", "monthly"),
        "imbalance_volumes": ("A86", None, "controlArea_Domain", "monthly"),
    }
    result = []
    def add(name, params, schedule="monthly", event=False):
        result.append({"name": name, "parameters": params, "schedule": schedule, "event": event})
    for name in selected:
        if name in definitions:
            doc, process, domain, schedule = definitions[name]
            params = {"documentType": doc, domain: ROMANIA, "curveType": "A01"}
            if process:
                params["processType"] = process
            add(name, params, schedule)
        elif name == "wind_solar_forecast":
            for label, process in WIND_PROCESSES.items():
                add(name + "_" + label, {"documentType": "A69", "processType": process,
                                         "in_Domain": ROMANIA, "curveType": "A01"})
        elif name == "balancing_bids":
            for label, process in BID_PROCESSES.items():
                add(name + "_" + label, {"documentType": "A24", "processType": process,
                                         "area_Domain": ROMANIA, "curveType": "A01"})
        elif name.startswith("outages_"):
            for status in ("A05", "A09", "A13"):
                add(name + "_" + status,
                    {"documentType": "A77" if name == "outages_production" else "A80",
                     "BiddingZone_Domain": ROMANIA, "DocStatus": status}, event=True)
        elif name in ("commercial_exchanges", "physical_flows"):
            for country in neighbours:
                code = NEIGHBOURS[country]
                for direction, origin, destination in (("export", ROMANIA, code), ("import", code, ROMANIA)):
                    for contract in (("A01", "A05") if name == "commercial_exchanges" else (None,)):
                        params = {"documentType": "A09" if contract else "A11", "out_Domain": origin,
                                  "in_Domain": destination, "curveType": "A01"}
                        if contract:
                            params["contract_MarketAgreement.Type"] = contract
                        add(f"{name}_{country}_{direction}" + (f"_{contract}" if contract else ""), params)
    return result


def windows(start, end, schedule, tz):
    if schedule == "annual":
        yield start, end
        return
    cursor = start
    while cursor < end:
        local = cursor.astimezone(tz)
        boundary = datetime(local.year + (local.month == 12), local.month % 12 + 1, 1, tzinfo=tz)
        stop = min(end, boundary.astimezone(timezone.utc))
        yield cursor, stop
        cursor = stop


def tree(node):
    """JSON fără pierdere de copii repetați, atribute sau text XML."""
    return {"tag": node.tag, "attributes": node.attrib, "text": node.text.strip() if node.text and node.text.strip() else None,
            "children": [tree(child) for child in node]}


def flatten(node, prefix="", exclude=()):
    result = {}
    counts = defaultdict(int)
    totals = defaultdict(int)
    for child in node:
        totals[child.tag] += 1
    for child in node:
        if child.tag in exclude:
            continue
        counts[child.tag] += 1
        key = prefix + child.tag + (f"[{counts[child.tag]}]" if totals[child.tag] > 1 else "")
        for attr, value in child.attrib.items():
            result[key + "@" + attr] = value
        if len(child):
            result.update(flatten(child, key + "/"))
        else:
            result[key] = child.text.strip() if child.text else None
    return result


def boundary(start, res, position):
    """Poziție zero-based, inclusiv P1Y/P1M și rezoluții sub-orare."""
    match = re.fullmatch(r"P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", res)
    if not match:
        raise ValueError("Rezoluție XML nesuportată: " + res)
    year, month, week, day, hour, minute, second = [int(v or 0) for v in match.groups()]
    if not any((year, month, week, day, hour, minute, second)):
        raise ValueError("Rezoluție nulă")
    if year or month:
        if any((week, day, hour, minute, second)):
            raise ValueError("Rezoluție mixtă calendaristică")
        months = start.year * 12 + start.month - 1 + position * (12 * year + month)
        y, m = divmod(months, 12)
        return start.replace(year=y, month=m + 1, day=min(start.day, calendar.monthrange(y, m + 1)[1]))
    return start + position * timedelta(weeks=week, days=day, hours=hour, minutes=minute, seconds=second)


def parse_document(xml, start, end, tz, event=False):
    root = strip_ns(xml)
    docmeta = flatten(root, "doc.", exclude=("TimeSeries",))
    output, warnings = [], []
    for series in root.findall("TimeSeries"):
        smeta = flatten(series, "series.", exclude=("Period", "Available_Period"))
        dimensions = {k: v for k, v in smeta.items() if k not in ("series.mRID", "series.curveType")}
        dimensions.update({k: v for k, v in docmeta.items() if k in (
            "doc.type", "doc.process.processType", "doc.area_Domain.mRID", "doc.controlArea_Domain.mRID")})
        if event:
            dimensions.update({k: docmeta.get(k) for k in ("doc.mRID", "doc.revisionNumber", "doc.docStatus/value")})
        periods = series.findall("Period") + series.findall("Available_Period")
        if not periods:
            warnings.append("TimeSeries fără Period/Available_Period; păstrat în documents.jsonl")
        for period in periods:
            pstart, pend = dt(period.findtext("timeInterval/start")), dt(period.findtext("timeInterval/end"))
            res = period.findtext("resolution", "")
            curve = series.findtext("curveType", "A01")
            if curve not in ("A01", "A03"):
                raise ValueError("curveType nesuportat: " + curve)
            # Prețurile pot avea mai multe categorii la aceeași poziție.
            groups = defaultdict(list)
            for point in period.findall("Point"):
                values = flatten(point, "point.")
                position = int(values.pop("point.position"))
                category = {k: v for k, v in values.items() if k.endswith(("category", "direction", "type"))}
                groups[canonical(category)].append((position, values))
            for group in groups.values():
                group.sort(key=lambda x: x[0])
                for i, (position, values) in enumerate(group):
                    left = boundary(pstart, res, position - 1)
                    if position < 1 or not pstart <= left < pend:
                        raise ValueError("Poziție în afara perioadei")
                    right = (boundary(pstart, res, group[i + 1][0] - 1) if i + 1 < len(group) else pend) if curve == "A03" else min(pend, boundary(pstart, res, position))
                    if right <= left:
                        warnings.append("Poziție duplicată/conflictuală în XML")
                        right = min(pend, boundary(pstart, res, position))
                    if right <= start or left >= end:
                        continue
                    category = {k: v for k, v in values.items() if k.endswith(("category", "direction", "type"))}
                    channel = digest(canonical({**dimensions, **category}).encode())
                    row = {"from_UTC": stamp(left), "to_UTC": stamp(right),
                           "from_local": left.astimezone(tz).isoformat(), "to_local": right.astimezone(tz).isoformat(),
                           "resolution": res, "curveType": curve, "position": position, "channel": channel,
                           **docmeta, **smeta, **values}
                    output.append(row)
    if not root.findall("TimeSeries"):
        warnings.append("Document fără TimeSeries; păstrat în documents.jsonl")
    return root, output, warnings


class Store:
    def __init__(self, folder):
        self.folder = folder
        folder.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(folder / "_staging.sqlite")
        self.db.executescript("DROP TABLE IF EXISTS rows; DROP TABLE IF EXISTS docs; "
                             "CREATE TABLE rows (key TEXT PRIMARY KEY, channel TEXT, start TEXT, end TEXT, value TEXT, data TEXT); "
                             "CREATE TABLE docs (key TEXT PRIMARY KEY, data TEXT); "
                             "CREATE INDEX times ON rows(channel,start,end);")
        self.fields = set()
        self.duplicates = 0

    def ingest(self, xml, start, end, tz, event):
        root, rows, warnings = parse_document(xml, start, end, tz, event)
        serialized = canonical(tree(root))
        self.db.execute("INSERT OR IGNORE INTO docs VALUES (?,?)", (digest(serialized.encode()), serialized))
        for row in rows:
            point = {k: v for k, v in row.items() if k.startswith("point.")}
            measurements = {k: v for k, v in point.items() if k.endswith(("quantity", "Quantity", ".amount", "/amount"))}
            measurement = canonical(measurements)
            key = digest(canonical({"channel": row["channel"], "from": row["from_UTC"], "to": row["to_UTC"], "values": point}).encode())
            cursor = self.db.execute("INSERT OR IGNORE INTO rows VALUES (?,?,?,?,?,?)", (
                key, row["channel"], row["from_UTC"], row["to_UTC"], measurement, canonical(row)))
            self.duplicates += cursor.rowcount == 0
            self.fields.update(row)
        self.db.commit()
        return warnings

    def gaps(self, start, end, directional=False):
        """Intervale lipsă în seriile observate, reunite pentru reinterogare."""
        if not self.db.execute("SELECT 1 FROM rows LIMIT 1").fetchone():
            return []
        gaps = []
        channels = [None] if directional else [r[0] for r in self.db.execute("SELECT DISTINCT channel FROM rows")]
        for channel in channels:
            cursor = start
            query = "SELECT start,end,value FROM rows" + (" WHERE channel=?" if channel else "") + " ORDER BY start,end"
            for left, right, value in self.db.execute(query, (channel,) if channel else ()):
                left, right = max(start, dt(left)), min(end, dt(right))
                if left > cursor:
                    gaps.append((cursor, left))
                values = json.loads(value)
                if not values or any(v is None for v in values.values()):
                    gaps.append((left, right))
                cursor = max(cursor, right)
            if cursor < end:
                gaps.append((cursor, end))
        merged = []
        for left, right in sorted(gaps):
            if merged and left <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
            else:
                merged.append((left, right))
        return merged

    def export(self, start, end, event, directional=False):
        count = self.db.execute("SELECT count(*) FROM rows").fetchone()[0]
        with (self.folder / "documents.jsonl").open("w", encoding="utf-8") as handle:
            for (value,) in self.db.execute("SELECT data FROM docs ORDER BY key"):
                handle.write(value + "\n")
        basic = ["from_UTC", "to_UTC", "from_local", "to_local", "resolution", "curveType", "channel"]
        columns = [x for x in basic if x in self.fields] + sorted(self.fields - set(basic))
        with (self.folder / "data.csv").open("w", encoding="utf-8-sig", newline="") as csvfile, (self.folder / "data.jsonl").open("w", encoding="utf-8") as jsonfile:
            writer = csv.DictWriter(csvfile, fieldnames=columns)
            writer.writeheader()
            for (value,) in self.db.execute("SELECT data FROM rows ORDER BY start,channel,end"):
                writer.writerow(json.loads(value))
                jsonfile.write(value + "\n")
        coverage = []
        if not event:
            for (channel,) in self.db.execute("SELECT DISTINCT channel FROM rows"):
                cursor, gaps, overlaps, missing_values = start, [], [], 0
                for left, right, value in self.db.execute("SELECT start,end,value FROM rows WHERE channel=? ORDER BY start,end", (channel,)):
                    left, right = max(start, dt(left)), min(end, dt(right))
                    if left > cursor:
                        gaps.append({"from": stamp(cursor), "to": stamp(left)})
                    if left < cursor:
                        overlaps.append({"from": stamp(left), "to": stamp(min(cursor, right))})
                    cursor = max(cursor, right)
                    values = json.loads(value)
                    if not values or any(v is None for v in values.values()):
                        missing_values += 1
                if cursor < end:
                    gaps.append({"from": stamp(cursor), "to": stamp(end)})
                coverage.append({"channel": channel, "gapsUTC": gaps, "overlapsUTC": overlaps, "missingValues": missing_values})
        union_gaps = []
        if directional:
            # A86 publică separat sensurile; absența unui sens nu este un gol
            # dacă celălalt sens acoperă același interval. Nu completa cu zero.
            cursor = start
            for left, right in self.db.execute("SELECT start,end FROM rows ORDER BY start,end"):
                left, right = max(start, dt(left)), min(end, dt(right))
                if left > cursor:
                    union_gaps.append({"from": stamp(cursor), "to": stamp(left)})
                cursor = max(cursor, right)
            if cursor < end:
                union_gaps.append({"from": stamp(cursor), "to": stamp(end)})
        write_json(self.folder / "coverage.json", {"channels": coverage, "directionalUnionGapsUTC": union_gaps if directional else None})
        result = {"rows": count, "documents": self.db.execute("SELECT count(*) FROM docs").fetchone()[0],
                  "exactDuplicateRowsRemoved": self.duplicates, "channels": len(coverage),
                  "channelsWithGaps": sum(bool(c["gapsUTC"]) for c in coverage),
                  "channelsWithOverlaps": sum(bool(c["overlapsUTC"]) for c in coverage),
                  "missingValues": sum(c["missingValues"] for c in coverage),
                  "coverageCheck": "event_report_not_continuous" if event else "directional_union_and_channel_conflicts" if directional else "per_observed_channel",
                  "coverageRequiresReview": bool(union_gaps) if directional else any(c["gapsUTC"] for c in coverage)}
        self.db.close()
        (self.folder / "_staging.sqlite").unlink()
        return result


def retrieve(client, profile, start, end, store, tz, log, depth=0):
    """Paginare de 200 documente pentru indisponibilități; subdivizare la limite."""
    params = {**profile["parameters"], "periodStart": start.strftime("%Y%m%d%H%M"), "periodEnd": end.strftime("%Y%m%d%H%M")}
    offset, seen_pages = 0, set()
    while True:
        request = {**params, **({"offset": offset} if profile["event"] else {})}
        try:
            docs, empty, cache_key = client.fetch(request)
            identities = []
            for document in docs:
                root = strip_ns(document)
                if not root.findtext("mRID"):
                    raise APIError("Document fără mRID: paginarea nu poate fi verificată")
                identities.append((root.findtext("mRID"), root.findtext("revisionNumber", "")))
            page_signature = digest(canonical(sorted(identities)).encode())
            if docs and page_signature in seen_pages:
                raise TooMuchData("API-ul repetă pagina; subdivizare temporală necesară")
            seen_pages.add(page_signature)
            if len(docs) >= 100 and not profile["event"]:
                raise TooMuchData("Răspuns cu >=100 documente; verificare prin intervale mai mici")
            warnings = []
            for xml in docs:
                warnings.extend(store.ingest(xml, start, end, tz, profile["event"]))
            entry = {"parameters": request, "fromUTC": stamp(start), "toUTC": stamp(end), "cacheKey": cache_key,
                     "status": "no_data" if empty and offset == 0 else "ok", "documents": len(docs),
                     "noData": empty, "parserWarnings": sorted(set(warnings))}
            log.append(entry)
            if not profile["event"] or len(docs) < 200:
                return
            offset += 200
        except TooMuchData as exc:
            minutes = int((end - start).total_seconds() / 60)
            if minutes < 2 or depth >= 20:
                raise APIError("Nu se poate confirma răspunsul complet: " + str(exc)) from None
            log.append({"parameters": request, "status": "split", "reason": client.clean(exc)})
            middle = start + timedelta(minutes=minutes // 2)
            retrieve(client, profile, start, middle, store, tz, log, depth + 1)
            retrieve(client, profile, middle, end, store, tz, log, depth + 1)
            return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=YEAR)
    parser.add_argument("--start", help="Data locală YYYY-MM-DD, opțional")
    parser.add_argument("--end", help="Data locală finală exclusivă YYYY-MM-DD")
    parser.add_argument("--reports", nargs="+", choices=REPORTS, default=REPORTS)
    parser.add_argument("--neighbours", nargs="+", choices=list(NEIGHBOURS), default=list(NEIGHBOURS))
    parser.add_argument("--rpm", type=int, default=REQUESTS_PER_MINUTE)
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--refresh", action="store_true", help="Redescarcă inclusiv răspunsurile din cache")
    parser.add_argument("--no-repair", action="store_true", help="Dezactivează reinterogarea intervalelor lipsă")
    parser.add_argument("--ca-bundle", type=Path, default=CA_BUNDLE if CA_BUNDLE.exists() else None,
                        help="Pachet CA pentru HTTPS; implicit cacert.pem lângă script, dacă există")
    parser.add_argument("--plan", action="store_true", help="Afișează planul, fără token și fără cereri")
    args = parser.parse_args()
    if not 1 <= args.rpm <= 300:
        parser.error("--rpm trebuie să fie între 1 și 300; plafonul API este 400/min/token")
    if args.ca_bundle and not args.ca_bundle.is_file():
        parser.error("Fișierul --ca-bundle nu există")
    tz = ZoneInfo(TIMEZONE)
    try:
        start = datetime.fromisoformat(args.start or f"{args.year}-01-01").replace(tzinfo=tz).astimezone(timezone.utc)
        end = datetime.fromisoformat(args.end or f"{args.year+1}-01-01").replace(tzinfo=tz).astimezone(timezone.utc)
        if not start < end or (end - start) > timedelta(days=366):
            raise ValueError("Perioada trebuie să fie pozitivă și de cel mult un an")
    except ValueError as exc:
        parser.error(str(exc))
    selected = profiles(list(dict.fromkeys(args.reports)), list(dict.fromkeys(args.neighbours)))
    plan = {"source": SOURCE, "country": "RO", "timezone": TIMEZONE, "fromUTC": stamp(start), "toUTCExclusive": stamp(end),
            "requestsPerMinute": args.rpm, "profiles": selected}
    if args.plan:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    if not shutil.which("curl"):
        parser.error("Este necesar curl în PATH")
    token = os.environ.get("ENTSOE_TOKEN", "").strip() or getpass.getpass("Token ENTSO-E (ascuns): ").strip()
    if not token:
        parser.error("Tokenul este necesar")
    args.output.mkdir(parents=True, exist_ok=True)
    # Împiedică rulări simultane în același folder. Alte programe trebuie coordonate separat.
    lock_path = args.output / ".running.lock"
    try:
        lock = lock_path.open("x")
    except FileExistsError:
        parser.error("Există .running.lock: altă rulare este activă. Dacă s-a închis forțat, elimină fișierul după verificare.")
    lock.write(str(os.getpid()))
    lock.close()
    run = args.output / ("run_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    run.mkdir()
    write_json(run / "plan.json", plan)
    client = Client(token, args.output / "cache", args.rpm, args.refresh, args.ca_bundle)
    summary = {"plan": plan, "profiles": [], "finished": False}
    fatal = False
    try:
        for index, profile in enumerate(selected, 1):
            print(f"[{index}/{len(selected)}] {profile['name']}", flush=True)
            folder = run / profile["name"]
            store, log = Store(folder), []
            try:
                for left, right in windows(start, end, profile["schedule"], tz):
                    try:
                        retrieve(client, profile, left, right, store, tz, log)
                    except (AuthError, TransportError):
                        raise
                    except (APIError, ValueError, ET.ParseError, zipfile.BadZipFile) as exc:
                        log.append({"fromUTC": stamp(left), "toUTC": stamp(right), "status": "failed", "error": client.clean(exc)})
                    write_json(folder / "requests.json", log)
                    print(f"  {stamp(left)} → {stamp(right)}: {log[-1]['status']}", flush=True)
                if not args.no_repair and not profile["event"]:
                    gaps = store.gaps(start, end, profile["name"] == "imbalance_volumes")
                    print(f"  Reinterogare: {len(gaps)} intervale lipsă în seriile observate", flush=True)
                    for left, right in gaps:
                        # O singură trecere de recuperare, prin ferestre de cel mult o zi.
                        # Nu repetăm nelimitat lipsurile reale ale sursei.
                        while left < right:
                            stop = min(right, left + timedelta(days=1))
                            first = len(log)
                            try:
                                retrieve(client, profile, left, stop, store, tz, log)
                            except (AuthError, TransportError):
                                raise
                            except (APIError, ValueError, ET.ParseError, zipfile.BadZipFile) as exc:
                                log.append({"fromUTC": stamp(left), "toUTC": stamp(stop), "status": "failed", "error": client.clean(exc)})
                            for entry in log[first:]:
                                entry["repairAttempt"] = True
                            write_json(folder / "requests.json", log)
                            left = stop
            except (AuthError, TransportError) as exc:
                log.append({"status": "failed", "error": client.clean(exc)})
                fatal = True
                print(client.clean(exc), flush=True)
            finally:
                write_json(folder / "requests.json", log)
                result = store.export(start, end, profile["event"], profile["name"] == "imbalance_volumes")
                failed = sum(r["status"] == "failed" for r in log)
                no_data = sum(r["status"] == "no_data" for r in log)
                warnings = sum(bool(r.get("parserWarnings")) for r in log)
                result.update(name=profile["name"], failedRequests=failed, noDataWindows=no_data, parserWarnings=warnings)
                result["status"] = ("failed" if failed else "no_data" if not result["documents"] else
                                    "review_required" if not result["rows"] or no_data or warnings or result["coverageRequiresReview"] or result["channelsWithOverlaps"] or result["missingValues"] else "downloaded")
                write_json(folder / "summary.json", result)
                summary["profiles"].append(result)
                write_json(run / "summary.json", summary)
            if fatal:
                break
        summary["finished"] = not fatal and len(summary["profiles"]) == len(selected)
    finally:
        summary["networkRequests"] = client.requests
        summary["finishedAtUTC"] = stamp(datetime.now(timezone.utc))
        write_json(run / "summary.json", summary)
        lock_path.unlink(missing_ok=True)
    print(f"Rezultate și verificări: {run.resolve()}")
    print("Downloaded înseamnă răspunsuri colectate; nu garantează că sursa a publicat toate seriile posibile.")
    return 0 if summary["finished"] and all(p["status"] == "downloaded" for p in summary["profiles"]) else 2


if __name__ == "__main__":
    import sys
    if "--incremental" in sys.argv:
        arguments=[x for x in sys.argv[1:] if x!="--incremental"]
        plan_only="--plan" in arguments
        arguments=[x for x in arguments if x!="--plan"]
        command=[sys.executable,str(Path(__file__).resolve().parents[1]/"update_daily.py"),"--source","entsoe",*arguments]
        if not plan_only:command.append("--apply")
        raise SystemExit(subprocess.call(command))
    raise SystemExit(main())
