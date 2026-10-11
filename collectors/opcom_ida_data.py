#!/usr/bin/env python3
"""OPCOM cuplare IDA1/2/3, implicit 2026-10-05 -> azi + 1 (inclusiv).
Rulare: .venv/bin/python data_extract/opcom_ida_data.py
Pastreaza numerotarea intervalelor OPCOM, fara a presupune fusul orei livrarii.
"""
import argparse
import csv
import fcntl
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

URL = 'https://www.opcom.ro/rapoarte-ida-rezultate-cuplare/ro'
ROOT = Path(__file__).resolve().parents[1] / 'Datasets/Opcom_IDA'
IDAS = ('IDA1', 'IDA2', 'IDA3')
DIRECTIONS = ('RO_HU', 'HU_RO', 'RO_BG', 'BG_RO')
COLUMNS = ['delivery_date', 'auction', 'interval', 'price_eur_per_MWh'] + [
    f'flow_{d}_MWh' for d in DIRECTIONS] + [f'atc_{d}_MW' for d in DIRECTIONS] + ['source']


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.divs, self.tables, self.stack, self.inputs = [], {}, [], {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'input' and attrs.get('name'):
            self.inputs[attrs['name']] = attrs.get('value', '')
        if tag == 'div':
            self.divs.append(attrs.get('id', ''))
        if tag == 'table':
            self.stack.append(dict(auction=next((d for d in reversed(self.divs) if d in IDAS), None), rows=[], row=None, cell=None))
        if self.stack:
            t = self.stack[-1]
            if tag == 'tr':
                t['row'] = []
            elif tag in ('td', 'th') and t['row'] is not None:
                t['cell'] = []
            elif tag == 'br' and t['cell'] is not None:
                t['cell'].append(' ')

    def handle_endtag(self, tag):
        if tag == 'div' and self.divs:
            self.divs.pop()
        if not self.stack:
            return
        t = self.stack[-1]
        if tag in ('td', 'th') and t['cell'] is not None:
            t['row'].append(' '.join(''.join(t['cell']).split()))
            t['cell'] = None
        elif tag == 'tr' and t['row'] is not None:
            t['rows'].append(t['row'])
            t['row'] = None
        elif tag == 'table':
            self.stack.pop()
            if t['auction']:
                if t['auction'] in self.tables:
                    raise ValueError('Tabel IDA duplicat')
                self.tables[t['auction']] = t['rows']

    def handle_data(self, text):
        if self.stack and self.stack[-1]['cell'] is not None:
            self.stack[-1]['cell'].append(text)


def number(text):
    if text.strip() in ('', '-', '—', 'N/A'):
        return None
    value = Decimal(text.replace('.', '').replace(',', '.').replace(' ', '').replace('\xa0', ''))
    if not value.is_finite():
        raise ValueError('Valoare numerica nevalida')
    return str(value)


def parse(text, day):
    p = Parser(); p.feed(text)
    if p.inputs.get('data_calendar_ro') != day.strftime('%d/%m/%Y'):
        raise ValueError('Data returnata de OPCOM difera de cea solicitata')
    results, statuses = {}, {}
    for ida in IDAS:
        table = p.tables.get(ida)
        if table is None:
            raise ValueError(f'Tabel {ida} lipsa din pagina')
        data = [r for r in table if r and re.fullmatch(r'\d+', r[0])]
        if not data:
            statuses[ida] = {'status': 'not_published', 'rows': 0}
            continue
        headers = ' '.join(' '.join(r) for r in table if r not in data)
        if not all(h in headers for h in ('EUR/MWh', 'Cross-Border', 'Available Transfer', 'MWh', 'MW')):
            raise ValueError(f'{ida}: structura antetului s-a schimbat')
        header_directions = [v for row in table if row not in data for v in row if v in DIRECTIONS]
        if header_directions != list(DIRECTIONS) * 2:
            raise ValueError(f'{ida}: ordinea directiilor s-a schimbat')
        records = []
        for row in data:
            if len(row) != 10:
                raise ValueError(f'{ida}: rand cu {len(row)} coloane, asteptat 10')
            values = [number(v) for v in row[1:]]
            records.append(dict(zip(COLUMNS, [day.isoformat(), ida, int(row[0]), *values, URL])))
        intervals = [r['interval'] for r in records]
        if intervals != sorted(set(intervals)) or any(b != a + 1 for a, b in zip(intervals, intervals[1:])):
            raise ValueError(f'{ida}: numerotare discontinua sau duplicata')
        tz = ZoneInfo('Europe/Bucharest')
        first = datetime.combine(day, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
        last = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
        total_intervals = int((last - first).total_seconds() / 900)
        expected = list(range(total_intervals - 47, total_intervals + 1)) if ida == 'IDA3' else list(range(1, total_intervals + 1))
        if intervals != expected:
            raise ValueError(f'{ida}: tabel incomplet sau intervale neasteptate')
        published = [r for r in records if r['price_eur_per_MWh'] is not None]
        results[ida] = records
        statuses[ida] = {'status': 'published' if len(published) == len(records) else 'partial' if published else 'not_published',
                         'rows': len(records), 'priced_rows': len(published), 'first_interval': intervals[0], 'last_interval': intervals[-1]}
    return results, statuses


class Client:
    def __init__(self, jar):
        self.jar, self.token, self.next_at = jar, None, 0

    def request(self, data=None):
        time.sleep(max(0, self.next_at - time.monotonic())); self.next_at = time.monotonic() + 2
        cmd = ['curl', '--silent', '--show-error', '--location', '--connect-timeout', '20', '--max-time', '60',
               '--cookie', str(self.jar), '--cookie-jar', str(self.jar), '--write-out', '\n%{http_code}']
        if data is not None:
            cmd += ['--data', urlencode(data)]
        r = subprocess.run(cmd + [URL], capture_output=True)
        body, _, code = r.stdout.rpartition(b'\n')
        if r.returncode or code != b'200':
            raise RuntimeError(f'OPCOM HTTP {code.decode(errors="replace")}, curl {r.returncode}')
        text = body.decode('utf-8-sig'); p = Parser(); p.feed(text)
        self.token = p.inputs.get('_token')
        if not self.token:
            raise ValueError('Token formular lipsa')
        return text

    def day(self, day):
        for attempt in range(3):
            try:
                if not self.token:
                    self.request()
                text = self.request({'_token': self.token, 'data_calendar_ro': day.strftime('%d/%m/%Y'), 'buton': 'Refresh', 'lang': 'ro'})
                data, status = parse(text, day)
                return text, data, status
            except (RuntimeError, ValueError, ArithmeticError):
                self.token = None
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp'); tmp.write_text(content, encoding='utf-8'); tmp.replace(path)


def main():
    today = datetime.now(ZoneInfo('Europe/Bucharest')).date()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--start', type=date.fromisoformat, default=date(2026, 10, 5))
    ap.add_argument('--end', type=date.fromisoformat, default=today + timedelta(days=1))
    ap.add_argument('--output-dir', type=Path, default=ROOT)
    args = ap.parse_args()
    if args.start > args.end or args.end > today + timedelta(days=1):
        ap.error('Interval invalid; --end trebuie sa fie cel mult azi + 1')
    root = args.output_dir; root.mkdir(parents=True, exist_ok=True)
    with (root / '.update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Actualizare IDA deja in curs; nu pornesc alta.'); return 0
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        path = root / 'ida_coupling.csv'
        existing = {}
        if path.exists():
            with path.open(encoding='utf-8-sig', newline='') as f:
                for row in csv.DictReader(f):
                    existing[(row['delivery_date'], row['auction'], int(row['interval']))] = row
        report = {'start': args.start.isoformat(), 'end': args.end.isoformat(), 'source': URL, 'days': [], 'failed_days': 0}
        with tempfile.TemporaryDirectory() as tmp:
            client = Client(Path(tmp) / 'cookies')
            day = args.start
            while day <= args.end:
                entry = {'date': day.isoformat()}
                try:
                    html, data, status = client.day(day)
                    atomic(root / 'source_html' / f'{day}.html', html)
                    entry['auctions'] = status; entry['sha256'] = hashlib.sha256(html.encode()).hexdigest()
                    for ida, records in data.items():
                        # Un rezultat lipsa/partial ulterior nu sterge valori deja publicate.
                        for row in records:
                            key = (day.isoformat(), ida, row['interval'])
                            if row['price_eur_per_MWh'] is not None or key not in existing:
                                existing[key] = row
                    print(day, ', '.join(f'{ida}: {v["status"]} ({v.get("priced_rows", 0)} preturi)' for ida, v in status.items()), flush=True)
                except Exception as e:
                    entry['error'] = f'{type(e).__name__}: {e}'; report['failed_days'] += 1
                    print(day, entry['error'], flush=True)
                report['days'].append(entry); day += timedelta(days=1)
        if path.exists():
            backup = root / '_backups' / stamp; backup.mkdir(parents=True)
            shutil.copy2(path, backup / path.name)
        temp = path.with_suffix('.csv.tmp')
        with temp.open('w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS); w.writeheader()
            w.writerows(existing[key] for key in sorted(existing))
        temp.replace(path)
        report['updated_at_utc'] = datetime.now(timezone.utc).isoformat(); report['total_rows'] = len(existing)
        atomic(root / 'update_report.json', json.dumps(report, indent=2, ensure_ascii=False))
        atomic(root / 'reports' / f'{stamp}.json', json.dumps(report, indent=2, ensure_ascii=False))
        return 2 if report['failed_days'] else 0


if __name__ == '__main__':
    result = main()
    from github_sync_hook import after_update
    after_update(result)
    raise SystemExit(result)
