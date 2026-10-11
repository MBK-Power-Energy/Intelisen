#!/usr/bin/env python3
"""OPCOM PZU: tabelele publicate pentru 15, 30 și 60 minute.
Python 3.9+ și curl. Rulare: python3 opcom_data.py --year 2025
"""
import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

URL = "https://www.opcom.ro/grafice-ip-raportPIP-si-volumTranzactionat/ro"
YEAR = 2025
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "Datasets/Opcom"
RESOLUTIONS = (15, 30, 60)
COLUMNS = ["delivery_date", "resolution_minutes", "interval", "price_lei_per_MWh",
           "traded_volume", "buy_volume", "sell_volume", "volume_unit", "price_header", "source"]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.divs, self.stack, self.tables, self.inputs = [], [], [], {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("name"):
            self.inputs[attrs["name"]] = attrs.get("value", "")
        if tag == "div":
            self.divs.append(attrs.get("id", ""))
        if tag == "table":
            resolution = next((int(re.fullmatch(r"rez(15|30|60)min", x).group(1))
                               for x in reversed(self.divs) if re.fullmatch(r"rez(15|30|60)min", x)), None)
            self.stack.append({"resolution": resolution, "market": "tab_PIP_Vol" in self.divs,
                               "rows": [], "row": None, "cell": None})
        if not self.stack:
            return
        current = self.stack[-1]
        if tag == "tr":
            current["row"] = []
        elif tag in ("td", "th") and current["row"] is not None:
            current["cell"] = []
        elif tag == "br" and current["cell"] is not None:
            current["cell"].append(" ")

    def handle_endtag(self, tag):
        if tag == "div" and self.divs:
            self.divs.pop()
        if not self.stack:
            return
        current = self.stack[-1]
        if tag in ("td", "th") and current["cell"] is not None:
            current["row"].append(" ".join("".join(current["cell"]).split()))
            current["cell"] = None
        elif tag == "tr" and current["row"] is not None:
            current["rows"].append(current["row"])
            current["row"] = None
        elif tag == "table":
            self.tables.append(self.stack.pop())

    def handle_data(self, text):
        if self.stack and self.stack[-1]["cell"] is not None:
            self.stack[-1]["cell"].append(text)


def number(text):
    if text.strip() in ("", "-", "—", "N/A"):
        return None
    value = Decimal(text.replace(".", "").replace(",", ".").replace(" ", "").replace("\xa0", ""))
    if not value.is_finite():
        raise ValueError("Număr nevalid în tabel")
    return str(value)


def day_minutes(day):
    # Folosit numai pentru numărul intervalelor zilei de schimbare a orei.
    # Nu atribuie fusuri orare sau timestamp-uri numerotării OPCOM.
    tz = ZoneInfo("Europe/Bucharest")
    first = datetime.combine(day, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
    last = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
    return int((last - first).total_seconds() / 60)


def parse_page(text, day):
    parser = PageParser()
    parser.feed(text)
    if parser.inputs.get("trading_for") != day.strftime("%d/%m/%Y"):
        raise ValueError("Pagina nu confirmă data solicitată; nu se salvează datele altei zile")
    result, info = {}, {}
    for table in parser.tables:
        if not table["market"]:
            continue
        rows = table["rows"]
        headers = next((r for r in rows if "Interval" in r), None)
        if not headers:
            continue
        res = table["resolution"]
        if res is None and any("ROPEX_DAM_H" in h for h in headers):
            res = 60
        if res not in RESOLUTIONS:
            raise ValueError("Rezoluție necunoscută pentru un tabel de piață")
        if res in result:
            raise ValueError("Tabel duplicat pentru aceeași rezoluție")
        idx = headers.index("Interval")
        price_idx = idx + 1
        volume_headers = headers[price_idx + 1:]
        unit = None
        if volume_headers:
            units = {re.search(r"\[([^]]+)\]", h).group(1) for h in volume_headers}
            if len(units) != 1:
                raise ValueError("Unități de volum diferite în același tabel")
            unit = units.pop()
        parsed = []
        for row in rows[rows.index(headers) + 1:]:
            if not row:
                continue
            if len(row) != len(headers):
                raise ValueError(f"Rând cu {len(row)} celule, antet cu {len(headers)}")
            if idx and row[0] != "Romania":
                raise ValueError("Zonă diferită de România")
            record = {"delivery_date": day.isoformat(), "resolution_minutes": res,
                      "interval": int(row[idx]), "price_lei_per_MWh": number(row[price_idx]),
                      "traded_volume": None, "buy_volume": None, "sell_volume": None,
                      "volume_unit": unit, "price_header": headers[price_idx], "source": URL}
            for key, value in zip(("traded_volume", "buy_volume", "sell_volume"), row[price_idx + 1:]):
                record[key] = number(value)
            parsed.append(record)
        expected = day_minutes(day) // res
        if [r["interval"] for r in parsed] != list(range(1, expected + 1)):
            raise ValueError(f"{day}, {res}min: intervale lipsă, duplicate sau numerotare neașteptată; {len(parsed)}/{expected} rânduri")
        if any(r["price_lei_per_MWh"] is None for r in parsed):
            raise ValueError("Preț lipsă")
        result[res] = parsed
        info[res] = {"status": "downloaded", "rows": len(parsed), "expected": expected, "headers": headers,
                     "missingVolumeCells": sum(r[k] is None for r in parsed for k in ("traded_volume", "buy_volume", "sell_volume")) if volume_headers else None}
    if not result:
        raise ValueError("Nu s-au găsit tabelele de prețuri")
    for res in RESOLUTIONS:
        if res not in result:
            info[res] = {"status": "not_published_on_page", "rows": 0, "expected": day_minutes(day) // res}
    return result, info, parser.inputs.get("_token")


class Downloader:
    def __init__(self, jar, rpm):
        self.jar, self.interval, self.next_at, self.token = jar, 60 / rpm, 0.0, None

    def request(self, data=None):
        time.sleep(max(0, self.next_at - time.monotonic()))
        self.next_at = time.monotonic() + self.interval
        command = ["curl", "--silent", "--show-error", "--location", "--connect-timeout", "20", "--max-time", "60",
                   "--cookie", str(self.jar), "--cookie-jar", str(self.jar), "--write-out", "\n%{http_code}"]
        if data is not None:
            command += ["--data", urlencode(data)]
        response = subprocess.run(command + [URL], capture_output=True)
        body, _, code = response.stdout.rpartition(b"\n")
        status = int(code) if code.isdigit() else 0
        if response.returncode:
            raise RuntimeError(f"curl {response.returncode}: {response.stderr.decode(errors='replace')}")
        if status != 200:
            self.token = None
            raise RuntimeError(f"HTTP {status}")
        text = body.decode("utf-8-sig")
        page = PageParser()
        page.feed(text)
        self.token = page.inputs.get("_token")
        return text

    def day(self, day):
        for attempt in range(4):
            try:
                if not self.token:
                    self.request()
                text = self.request({"_token": self.token, "trading_for": day.strftime("%d/%m/%Y"),
                                     "action": "trading_for", "limba": "ro", "buton": "Refresh"})
                parse_page(text, day)
                return text
            except (RuntimeError, ValueError) as exc:
                if attempt == 3:
                    raise
                print(f"Reîncercare {day}: {exc}", flush=True)
                self.token = None
                # Reia formularul public într-o sesiune nouă dacă sesiunea a expirat.
                self.jar.unlink(missing_ok=True)
                time.sleep(5 * (attempt + 1))


def main():
    parser = argparse.ArgumentParser(description="Actualizare incrementala OPCOM PZU, CSV fara an.")
    parser.add_argument("--year", type=int, help="Optional: actualizeaza numai anul indicat")
    parser.add_argument("--end", type=date.fromisoformat, help="Ultima zi inclusa; implicit azi in Romania")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--rpm", type=int, default=60)
    parser.add_argument("--refresh", action="store_true", help="Reverifica toate zilele perioadei")
    args=parser.parse_args()
    if not 1<=args.rpm<=120: parser.error("--rpm trebuie sa fie intre 1 si 120")
    root=args.output;root.mkdir(parents=True,exist_ok=True)
    backup=root/'_backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    data={res:{} for res in RESOLUTIONS}
    legacy=[]
    for res in RESOLUTIONS:
        paths=sorted(root.glob(f'OPCOM_PZU_[0-9][0-9][0-9][0-9]_{res}min.csv'))
        target=root/f'OPCOM_PZU_{res}min.csv'
        for source in paths+([target] if target.exists() else []):
            backup.mkdir(parents=True,exist_ok=True);shutil.copy2(source,backup/source.name)
            with source.open(encoding='utf-8-sig',newline='') as f:
                for row in csv.DictReader(f):data[res][(row['delivery_date'],int(row['interval']))]=row
        legacy.extend(paths)
    today=datetime.now(ZoneInfo('Europe/Bucharest')).date()
    end=min(args.end or today,today+timedelta(days=1))
    start=date(args.year or 2025,1,1)
    if args.year:end=min(end,date(args.year,12,31))
    def save():
        for res,records in data.items():
            target=root/f'OPCOM_PZU_{res}min.csv';tmp=target.with_suffix('.tmp')
            with tmp.open('w',encoding='utf-8-sig',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=COLUMNS);writer.writeheader()
                writer.writerows(records[k] for k in sorted(records))
            tmp.replace(target)
    save()
    for source in legacy:source.unlink()
    complete=set()
    # Un tabel complet de 60min confirma ziua; 15/30min nu sunt publicate in tot istoricul.
    counts={}
    for (day,i),row in data[60].items():
        if row['price_lei_per_MWh'] not in ('',None):counts.setdefault(day,set()).add(i)
    for day,intervals in counts.items():
        expected=day_minutes(date.fromisoformat(day))//60
        if intervals==set(range(1,expected+1)):complete.add(day)
    checks=[];day=start;downloaded=0
    with tempfile.TemporaryDirectory(prefix='opcom_session_') as tmp:
        downloader=Downloader(Path(tmp)/'cookies.txt',args.rpm)
        while day<=end:
            if day.isoformat() in complete and not args.refresh:
                day+=timedelta(days=1);continue
            cache=root/'source_html'/str(day.year);cache.mkdir(parents=True,exist_ok=True)
            path=cache/(day.isoformat()+'.html')
            try:
                text=path.read_text(encoding='utf-8') if path.exists() and not args.refresh else downloader.day(day)
                parsed,info,_=parse_page(text,day)
                saved=re.sub(r'(name="_token"\s+value=")[^"]*',r'\1[REDACTED]',text)
                path.write_text(saved,encoding='utf-8')
                for res,records in parsed.items():
                    for row in records:data[res][(day.isoformat(),int(row['interval']))]=row
                checks.append({'date':day.isoformat(),'status':'ok','resolutions':info})
                downloaded+=1
                if downloaded%10==0:save();print(f'{day}: {downloaded} zile completate',flush=True)
            except Exception as exc:
                checks.append({'date':day.isoformat(),'status':'failed','error':str(exc)})
                print(f'EROARE {day}: {exc}',flush=True)
            day+=timedelta(days=1)
    save()
    results={res:{'rows':len(rows),'last_date':max((k[0] for k in rows),default=None)} for res,rows in data.items()}
    report={'updated_at_utc':datetime.now(timezone.utc).isoformat(),'requested_end':end.isoformat(),'completed_days':downloaded,'failed_days':sum(c['status']=='failed' for c in checks),'results':results,'daily_checks':checks}
    (root/'VERIFICARE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='daily_checks'},indent=2),flush=True)
    return 2 if report['failed_days'] else 0


if __name__ == '__main__':
    result = main()
    from github_sync_hook import after_update
    after_update(result)
    raise SystemExit(result)
