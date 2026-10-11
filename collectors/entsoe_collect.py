"""All ENTSO-E profiles from ema, preserving XML and every parsed field."""
import os,json,argparse,time
from datetime import datetime,date,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from http_client import request
import entsoe_data as api

def collect(day,selected=None):
    token=os.environ.get('ENTSOE_TOKEN')
    if not token:raise RuntimeError('ENTSOE_TOKEN is required')
    tz=ZoneInfo('Europe/Bucharest')
    a=datetime.combine(day,datetime.min.time(),tz).astimezone(timezone.utc)
    b=datetime.combine(day+timedelta(days=1),datetime.min.time(),tz).astimezone(timezone.utc)
    output=[]
    for profile in api.profiles(selected or api.REPORTS,list(api.NEIGHBOURS)):
        start,end=a,b
        if profile['schedule']=='annual':
            start=datetime(day.year,1,1,tzinfo=tz).astimezone(timezone.utc)
            end=datetime(day.year+1,1,1,tzinfo=tz).astimezone(timezone.utc)
        params={**profile['parameters'],'periodStart':start.strftime('%Y%m%d%H%M'),'periodEnd':end.strftime('%Y%m%d%H%M'),'securityToken':token}
        code,body=request(api.BASE_URL,params)
        if code not in (200,400):raise RuntimeError('ENTSO-E HTTP '+str(code))
        docs,empty=api.inspect_response(body,params['documentType'])
        if code!=200 and docs:raise RuntimeError('Unexpected document response status')
        rows=[];warnings=[]
        for xml in docs:
            _,parsed,notes=api.parse_document(xml,a,b,tz,profile['event'])
            rows.extend(parsed);warnings.extend(notes)
        output.append({'source':'entsoe','dataset':profile['name'],'delivery_date':str(day),'parameters':profile['parameters'],'records':rows,'documents':[xml.decode('utf-8') for xml in docs],'coverage':{'status':'published' if docs else 'not_published','warnings':warnings,'empty_reasons':empty}})
        time.sleep(1.05)
    return output

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--day',type=date.fromisoformat,required=True);p.add_argument('--reports',nargs='+',choices=api.REPORTS);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    if args.day<date(2026,10,1):raise ValueError('History begins 2026-10-01')
    result=collect(args.day,args.reports);args.output.write_text(json.dumps(result,ensure_ascii=False))
    print(json.dumps([{'dataset':r['dataset'],'records':len(r['records']),'status':r['coverage']['status']} for r in result]))
