import json,subprocess,binascii,re,sys,os,urllib.request,urllib.parse
TAG=sys.argv[2]
PID=int(sys.argv[1])
# HuntMemory App 自带的本地 MCP 服务（仅 127.0.0.1 可达），token 在 App 内查看
URL=os.environ.get('HM_MCP_URL','http://127.0.0.1:8765/mcp')
T=os.environ.get('HM_MCP_TOKEN','2e982417ffed4d59b784e3ae27136cee')
def call(n,a,t=180):
    b={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':n,'arguments':a}}
    r=urllib.request.Request(URL,data=json.dumps(b).encode(),headers={'Authorization':'Bearer '+T,'Content-Type':'application/json'})
    return json.loads(json.load(urllib.request.urlopen(r,timeout=t))['result']['content'][0]['text'])
def read(a,n):
    out=subprocess.run(['adb','shell','su','-c',f'/data/local/tmp/memscan {PID} read {a:x} {n} --kpm'],
                       capture_output=True,text=True).stdout.strip()
    if not out: return b''
    l=out.splitlines()[0].strip()
    if not re.fullmatch(r'[0-9a-fA-F]+', l): return b''
    if len(l)%2: l=l[:-1]
    return binascii.unhexlify(l)
V=int.from_bytes(TAG.encode(),'little')
r=call('hm_scan',{'pid':PID,'value':str(V),'type':'int'})
best=None
for a in [m['address'] for m in r.get('matches',[])]:
    raw=b''
    for k in range(8):
        c=read(a+4096*k,4096)
        if not c: break
        raw+=c
        if len(c)<4096: break
    if not raw: continue
    txt=raw.split(b'\x00')[0].decode('latin-1','replace')
    i=txt.find(TAG+'|')
    if i<0: continue
    body=txt[i+len(TAG)+1:]
    if not body.startswith('%7B'): continue
    try: o=json.loads(urllib.parse.unquote(body))
    except Exception: continue
    def score(x): return (x.get('hi',0)>0, x.get('st',0)>0, x.get('t2') is not None, x.get('ts') or 0)
    if best is None or score(o)>score(best): best=o
print(json.dumps(best, ensure_ascii=False, indent=1)[:3000] if best else '无数据')
