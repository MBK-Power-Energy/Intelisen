"""Population-weighted Open-Meteo ERA5/IFS; all 61 cities required per hour."""
import argparse,csv,json,time
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from http_client import request
CITIES=Path(__file__).resolve().parents[1]/'supabase/weather-cities.csv'

def collect(start,end):
    cities=list(csv.DictReader(CITIES.open()))
    if len(cities)!=61 or len({r['Oras'] for r in cities})!=61:raise ValueError('Expected 61 unique cities')
    population=sum(int(r['Populatie_2021']) for r in cities)
    if population!=7094441:raise ValueError('City weights changed')
    models={};raw=[]
    cutoff=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0).timestamp()
    for model in ['era5','ecmwf_ifs']:
        values={}
        for offset in range(0,len(cities),5):
            batch=cities[offset:offset+5]
            code,body=request('https://archive-api.open-meteo.com/v1/archive',{'latitude':','.join(c['lat_cerut'] for c in batch),'longitude':','.join(c['lon_cerut'] for c in batch),'start_date':str(start),'end_date':str(end),'hourly':'temperature_2m','models':model,'timezone':'UTC','timeformat':'unixtime'})
            if code!=200:raise RuntimeError('Open-Meteo HTTP '+str(code))
            response=json.loads(body)
            if isinstance(response,dict):response=[response]
            if len(response)!=len(batch):raise ValueError('City response count mismatch')
            raw.append({'model':model,'cities':[c['Oras'] for c in batch],'response':response})
            for city,data in zip(batch,response):
                h=data['hourly'];temps=h.get('temperature_2m',h.get('temperature_2m_'+model))
                if temps is None or len(h['time'])!=len(temps):raise ValueError('Invalid hourly schema')
                for stamp,temp in zip(h['time'],temps):
                    if stamp<cutoff and temp is not None:values.setdefault(stamp,{})[city['Oras']]=temp
            time.sleep(.3)
        models[model]=values
    records=[]
    for stamp in sorted(set(models['era5'])|set(models['ecmwf_ifs'])):
        model=next((m for m in ['era5','ecmwf_ifs'] if len(models[m].get(stamp,{}))==61),None)
        if model is None:continue
        mean=sum(models[model][stamp][c['Oras']]*int(c['Populatie_2021']) for c in cities)/population
        for quarter in range(4):
            t=datetime.fromtimestamp(stamp+quarter*900,timezone.utc)
            records.append({'interval_start':t.isoformat(),'interval_end':(t+timedelta(minutes=15)).isoformat(),'temperature_c':round(mean),'weighted_unrounded_c':mean,'model':model,'cities':61,'population_2021':population})
    if not records:raise ValueError('No complete weather hours')
    times=[datetime.fromisoformat(r['interval_start']) for r in records]
    expected=datetime.combine(start,datetime.min.time(),timezone.utc)
    if times[0]!=expected or any((b-a).total_seconds()!=900 for a,b in zip(times,times[1:])):raise ValueError('Internal weather gaps; previous dataset must be retained')
    return {'source':'open_meteo','records':records,'raw':raw,'coverage':{'last_interval':records[-1]['interval_start'],'source_models':['era5','ecmwf_ifs']}}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--start',type=date.fromisoformat,required=True);p.add_argument('--end',type=date.fromisoformat,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.start<date(2026,10,1) or a.end<a.start:raise ValueError('Invalid history window')
    data=collect(a.start,a.end);a.output.write_text(json.dumps(data,ensure_ascii=False));print(json.dumps({'records':len(data['records']),**data['coverage']}))
