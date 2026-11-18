import re,sys,struct
from gcn import dis
b=open('water_dec.bin','rb').read()
start,end=int(sys.argv[1],0),int(sys.argv[2],0)
lines=dis(b,start,end)
R={}  # reg -> expr
n=[0]
def tmp(e):
    n[0]+=1;name=f't{n[0]}';print(f'  {name} = {e}');return name
def val(tok):
    tok=tok.strip()
    neg=False;ab=False
    while tok.startswith('-'): neg=not neg;tok=tok[1:]
    if tok.startswith('|'): ab=True;tok=tok.strip('|')
    m=re.match(r'lit\(([^|]+)\|',tok)
    if m: v=m.group(1)
    else: v=R.get(tok,tok)
    if ab: v=f'abs({v})'
    if neg: v=f'-{v}'
    return v
CB={}
OPS={'add_f32':'({0}+{1})','sub_f32':'({0}-{1})','subrev_f32':'({1}-{0})','mul_f32':'({0}*{1})','mul_legacy_f32':'({0}*{1})','min_f32':'min({0},{1})','max_f32':'max({0},{1})',
'mac_f32':None,'mov_b32':'{0}','rcp_f32':'(1/{0})','rsq_f32':'rsqrt({0})','sqrt_f32':'sqrt({0})','fract_f32':'fract({0})','exp_f32':'exp2({0})','log_f32':'log2({0})','floor_f32':'floor({0})','trunc_f32':'trunc({0})','sin_f32':'sin2pi({0})','cos_f32':'cos2pi({0})','mad_f32':'({0}*{1}+{2})','fma_f32':'({0}*{1}+{2})','mad_legacy_f32':'({0}*{1}+{2})','cubesc_f32':'cubesc({0},{1},{2})','cubetc_f32':'cubetc({0},{1},{2})','cubema_f32':'cubema({0},{1},{2})','cubeid_f32':'cubeid({0},{1},{2})','cvt_pkrtz_f16_f32':'pack({0},{1})','madak_f32':'({0}*{1}+{2})','madmk_f32':'({0}*{1}+{2})','cndmask_b32':'(vcc?{1}:{0})','med3_f32':'med3({0},{1},{2})','ldexp_f32':'ldexp({0},{1})'}
for L in lines:
    addr,ins=L.split(': ',1)
    m=re.match(r'(\S+)\s*(.*)',ins);op=m.group(1);args=[a.strip() for a in re.split(r',\s*(?![^()]*\))',m.group(2))] if m.group(2) else []
    if op.startswith('s_buffer_load') or op.startswith('s_load'):
        mm=re.match(r's_(buffer_)?load_dword(x\d+)?',op);cnt=int(mm.group(2)[1:]) if mm.group(2) else 1
        d=int(args[0][1:]);base=args[1];off=int(args[2].split()[0],16)
        for i in range(cnt):
            nm={'s[24:25]':'cam','s[32:33]':'glob','s[0:1]':'frame','s[4:5]':'camRare','s[12:13]':'glob','s[10:11]':'T','s[8:9]':'T'}.get(base,base)
            R[f's{d+i}']=f'{nm}[{off+i}]'
        continue
    if op.startswith('s_'):
        if op.startswith('s_mov_b32'): R[args[0]]=val(args[1])
        elif op.startswith('s_mov_b64'): pass
        else: print(f'{addr}: [{ins}]')
        continue
    if op.startswith('v_interp_p1'):continue
    if op.startswith('v_interp_p2'):
        m2=re.match(r'v(\d+), v\d+, attr(\d+)\.(\w)',' '.join(args)) or re.match(r'v(\d+), v\d+, attr(\d+)\.(\w)',m.group(2))
        R[f'v{m2.group(1)}']=f'in{m2.group(2)}.{m2.group(3)}';continue
    if op.startswith('image_'):
        print(f'{addr}: {op} <- coords {args[1]} res {args[2]} samp {args[3]} {args[4:]}   ctx v-regs: ',[ (k,R.get(k)) for k in re.findall(r'v\[(\d+)\.\.\]',ins) ] )
        # record coords: sample uses consecutive regs
        v0=int(re.search(r'v\[(\d+)\.\.\], v\[(\d+)',ins).group(2)); d0=int(re.search(r'v\[(\d+)\.\.\]',ins).group(1))
        dm=int(re.search(r'dmask=(0x\w+)',ins).group(1),16)
        coords=[R.get(f'v{v0+i}',f'v{v0+i}?') for i in range(2)]
        tn=tmp(f'SAMPLE[{args[2]}|{args[3]}]({coords[0]}, {coords[1]})')
        k=0
        for c in range(4):
            if dm>>c&1: R[f'v{d0+k}']=f'{tn}.{"rgba"[c]}';k+=1
        continue
    if op.startswith('exp'):print(f'{addr}: {ins}',[R.get(x) for x in re.findall(r'v\d+',ins)]);continue
    # vector alu
    base=re.sub(r'^v_','',op);e64=False
    if base.endswith('_e64'):base=base[:-4];e64=True
    if base.startswith('vopc') or base.startswith('cmp'):
        print(f'{addr}: [{ins}] regs',[val(a) for a in args[1:]]);continue
    clampf=False
    args=[re.sub(r'\s+(clamp|omod=\d)$','',x) for x in args]
    dst=args[0];a=[val(x) for x in args[1:]]
    tmpl=OPS.get(base)
    if base=='mac_f32':
        e=f'({R.get(dst,dst)}+{a[0]}*{a[1]})'
    elif base=='cndmask_b32':
        e=f'(vcc?{a[1]}:{a[0]})'
    elif tmpl: e=tmpl.format(*a)
    else: e=f'{base}({",".join(a)})'
    if ins.rstrip().endswith('clamp'): e=f'sat({e})'
    R[dst]=tmp(e)
