import re,struct,math,numpy as np,sys,json
f32=np.float32
def litv(m): return f32(struct.unpack('<f',struct.pack('<I',int(m.group(1),16)))[0])
TRACE=None
def run(asm,cbs,attrs):
    import collections; S=collections.defaultdict(lambda:f32(0));V=collections.defaultdict(lambda:f32(0))
    for k,x in attrs.items(): V[k]=f32(x)
    lines=[l.split(': ',1)[1] for l in asm]
    base_map={'s[4:5]':'g','s[8:9]':'cam','s[48:49]':'draw','s[16:17]':'frame'}
    def getv(tok):
        tok=tok.strip(); neg=False;ab=False
        while tok.startswith('-'): neg=not neg;tok=tok[1:]
        if tok.startswith('|'): ab=True;tok=tok.strip('|')
        m=re.match(r'lit\(.*\|0x([0-9a-f]+)\)',tok)
        if m: x=litv(m)
        elif tok in('0',): x=f32(0)
        elif re.fullmatch(r'-?\d+',tok): x=f32(int(tok))
        elif re.fullmatch(r'-?\d+\.\d+',tok): x=f32(float(tok))
        elif tok.startswith('vcc') or tok.startswith('s'): x=S[tok]
        elif tok.startswith('v'): x=V[tok]
        else: raise Exception(tok)
        if ab: x=abs(x)
        if neg: x=-x
        return f32(x)
    out={}
    for ln in lines:
        if TRACE: print(ln, {k:float(v) for k,v in list(V.items())[-0:] if k in TRACE})
        m=re.match(r'(\S+)\s*(.*)',ln);op=m.group(1);rest=m.group(2)
        args=[a.strip() for a in re.split(r',\s*(?![^()]*\))',rest)] if rest else []
        mod=''
        if args and re.search(r'\s+(clamp|omod=\d)',args[-1]):
            tail=args[-1]; mod=tail; args[-1]=re.sub(r'\s+(clamp|omod=\d)','',tail)
        clamp='clamp' in mod; om=re.search(r'omod=(\d)',mod); om=int(om.group(1)) if om else 0
        def setd(d,x):
            x=f32(x)
            if om==1:x*=f32(2)
            elif om==2:x*=f32(4)
            elif om==3:x*=f32(.5)
            if clamp:x=f32(min(max(x,0),1))
            (S if d.startswith('vcc') or d.startswith('s') else V)[d]=f32(x)
        base=re.sub(r'(_e64)$','',op)
        if op.startswith('s_buffer_load'):
            mm=re.match(r's_buffer_load_dword(x(\d+))?',op);cnt=int(mm.group(2)) if mm.group(2) else 1
            d=int(args[0][1:]);off=int(args[2].split()[0],16);buf=cbs[base_map[args[1]]]
            for i in range(cnt): S[f's{d+i}']=f32(buf[off+i])
        elif op.startswith('s_load') or op in('s_waitcnt','s_endpgm') or op.startswith('s_cmp') or op.startswith('s_cbranch') or op.startswith('s_sop1'):
            pass
        elif op=='s_mov_b32': S[args[0]]=getv(args[1])
        elif op=='exp': out.setdefault('exp',[]).append((ln,[V[x.strip()] for x in rest.split(' ',3)[-1].split(',')]))
        elif base=='v_mov_b32': setd(args[0],getv(args[1]))
        elif base=='v_add_f32': setd(args[0],getv(args[1])+getv(args[2]))
        elif base=='v_sub_f32': setd(args[0],getv(args[1])-getv(args[2]))
        elif base=='v_subrev_f32': setd(args[0],getv(args[2])-getv(args[1]))
        elif base=='v_mul_f32': setd(args[0],getv(args[1])*getv(args[2]))
        elif base=='v_mac_f32': setd(args[0],V[args[0]]+getv(args[1])*getv(args[2]))
        elif base=='v_madmk_f32':
            mm=re.match(r'lit\(([^)]+)\)',args[2]); k=f32(float(mm.group(1))); setd(args[0],getv(args[1])*k+getv(args[3]))
        elif base in('v_mad_f32','v_fma_f32'): setd(args[0],getv(args[1])*getv(args[2])+getv(args[3]))
        elif base=='v_fract_f32': x=getv(args[1]); setd(args[0],x-np.floor(x))
        elif base=='v_sin_f32': setd(args[0],np.sin(f32(2*np.pi)*getv(args[1])))
        elif base=='v_rcp_f32': setd(args[0],f32(1)/getv(args[1]))
        elif base=='v_rsq_f32': setd(args[0],f32(1)/np.sqrt(getv(args[1])))
        else: raise Exception('unhandled '+ln)
    out["V"]=dict(V);out["S"]=dict(S);return out


def run_case(asm, g, T, M, p, r):
    """Execute the vertex program for one vertex; camera at origin so the
    exported eye vector (export target 33: X'-cam.x, Y'-cam.y, Z'-cam.z as
    v5,v7,v6) is the displaced Unity world position (x, y, z)."""
    idx = dict(TE=0, MWF=4, MWS=5, NWF=6, NWS=7, MWStr=8, NWStr=9, SStr=10, SDur=11, NS=12, SStart=13,
               SDx=16, SDy=17, SDz=18)          # __GLOBAL_CB__ dword indices (m_Index/4)
    gcb = [0.0] * 32
    for k, v in g.items():
        gcb[idx[k]] = v
    cam = [0.0] * 32
    cam[1], cam[2] = T, 2 * T                    # _Time.y, _Time.z
    draw = [0.0] * 32
    for rr in range(4):
        for c in range(4):
            draw[c * 4 + rr] = M[rr][c]         # column-major
    frame = [0.0] * 96
    for i in range(4):
        frame[68 + i * 4 + i] = 1.0
    attrs = {'v4': p[0], 'v5': p[1], 'v6': p[2], 'v7': 1.0, 'v9': 1.0, 'v12': r}
    o = run(asm, {'g': gcb, 'cam': cam, 'draw': draw, 'frame': frame}, attrs)
    ex = dict((l.split()[1], v) for l, v in o['exp'])
    return [float(x) for x in ex['target=33']][:3]
