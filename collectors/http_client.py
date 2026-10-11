"""HTTP client using system certificate trust; secrets are never command arguments."""
import json,subprocess
from urllib.parse import urlencode

def request(base,params):
    url=base+'?'+urlencode(params)
    config='url = '+json.dumps(url)+'\n'
    result=subprocess.run(['curl','--silent','--show-error','--location','--connect-timeout','20','--max-time','120','--config','-','--write-out','\n%{http_code}'],input=config.encode(),capture_output=True)
    body,_,status=result.stdout.rpartition(b'\n')
    code=int(status) if status.isdigit() else 0
    if result.returncode:raise RuntimeError('Source connection failed')
    return code,body
