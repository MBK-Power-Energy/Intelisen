"""Cloud-compatible source adapters. Outputs validated JSON; contains no credentials.
Provisioning and authenticated ingestion into SEN are separate deployment steps.
"""
import argparse,json,tempfile,os
from pathlib import Path
from datetime import date,datetime,timedelta,timezone
from zoneinfo import ZoneInfo
import opcom_data as pzu
import opcom_ida_data as ida
import entsoe_data as entsoe

def collect(source,day):
    with tempfile.TemporaryDirectory() as temp:
        if source=='opcom_pzu':
            client=pzu.Downloader(Path(temp)/'cookies',30)
            body=client.day(day)
            records,statuses,_=pzu.parse_page(body,day)
            return {'source':source,'delivery_date':str(day),'records':[r for values in records.values() for r in values],'coverage':statuses,'raw':body}
        if source=='opcom_ida':
            client=ida.Client(Path(temp)/'cookies')
            body,records,statuses=client.day(day)
            return {'source':source,'delivery_date':str(day),'records':[r for values in records.values() for r in values],'coverage':statuses,'raw':body}
        raise ValueError('Unsupported source')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',choices=['opcom_pzu','opcom_ida'])
    parser.add_argument('--day',type=date.fromisoformat,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.day<date(2026,10,1):raise ValueError('History begins on 2026-10-01')
    result=collect(args.source,args.day)
    args.output.write_text(json.dumps(result,ensure_ascii=False))
    print(json.dumps({'source':args.source,'date':str(args.day),'records':len(result['records']),'coverage':result['coverage']},ensure_ascii=False))
