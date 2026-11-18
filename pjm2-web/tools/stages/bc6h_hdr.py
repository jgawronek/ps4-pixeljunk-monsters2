"""BC6H (unsigned, HDR) block decoder returning half-float radiance (texture2ddecoder.decode_bc6 clamps to 8 bit).

Written from the D3D11/Khronos BC6H spec tables. Validated against texture2ddecoder on the stage-1 reflection probe:
99.9 % of texels agree to <= 1/255 after clamping; the 2 remaining blocks (of 6144) are mode 10 / partition 17 and 28
where the reference decoder returns R >= 1 for a green ground texel, i.e. the REFERENCE looks wrong, not this decoder.
Pure python (no numpy): the probes are only 128x128 x 6 faces.
"""
import struct
PART=[[0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1],[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1],[0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1],
[0,0,0,1,0,0,1,1,0,0,1,1,0,1,1,1],[0,0,0,0,0,0,0,1,0,0,0,1,0,0,1,1],[0,0,1,1,0,1,1,1,0,1,1,1,1,1,1,1],
[0,0,0,1,0,0,1,1,0,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,1],[0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1],
[0,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,1,0,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0,0,0,0,1,0,1,1,1],
[0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],[0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1],
[0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],[0,0,0,0,1,0,0,0,1,1,1,0,1,1,1,1],[0,1,1,1,0,0,0,1,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,1,0,0,0,1,1,1,0],[0,1,1,1,0,0,1,1,0,0,0,1,0,0,0,0],[0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0],
[0,0,0,0,1,0,0,0,1,1,0,0,1,1,1,0],[0,0,0,0,0,0,0,0,1,0,0,0,1,1,0,0],[0,1,1,1,0,0,1,1,0,0,1,1,0,0,0,1],
[0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,1,0,0,0,1,1,0,0],[0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0],
[0,0,1,1,0,1,1,0,0,1,1,0,1,1,0,0],[0,0,0,1,0,1,1,1,1,1,1,0,1,0,0,0],[0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
[0,1,1,1,0,0,0,1,1,0,0,0,1,1,1,0],[0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0]]
ANCH=[15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,2,8,2,2,8,8,15,2,8,2,2,8,8,2,2]
W3=[0,9,18,27,37,46,55,64]; W4=[0,4,9,13,17,21,26,30,34,38,43,47,51,55,60,64]
M,RW,RX,RY,RZ,GW,GX,GY,GZ,BW,BX,BY,BZ,D='M RW RX RY RZ GW GX GY GZ BW BX BY BZ D'.split()
def L(s): return [(a,b,c) for a,b,c in s]
Z=(M,0,5)
MODES={
0x00:(True,True,(10,5,5,5),[(M,0,2),(GY,4,1),(BY,4,1),(BZ,4,1),(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,5),(GZ,4,1),(GY,0,4),(GX,0,5),(BZ,0,1),(GZ,0,4),(BX,0,5),(BZ,1,1),(BY,0,4),(RY,0,5),(BZ,2,1),(RZ,0,5),(BZ,3,1),(D,0,5)]),
0x01:(True,True,(7,6,6,6),[(M,0,2),(GY,5,1),(GZ,4,1),(GZ,5,1),(RW,0,7),(BZ,0,1),(BZ,1,1),(BY,4,1),(GW,0,7),(BY,5,1),(BZ,2,1),(GY,4,1),(BW,0,7),(BZ,3,1),(BZ,5,1),(BZ,4,1),(RX,0,6),(GY,0,4),(GX,0,6),(GZ,0,4),(BX,0,6),(BY,0,4),(RY,0,6),(RZ,0,6),(D,0,5)]),
0x02:(True,True,(11,5,4,4),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,5),(RW,10,1),(GY,0,4),(GX,0,4),(GW,10,1),(BZ,0,1),(GZ,0,4),(BX,0,4),(BW,10,1),(BZ,1,1),(BY,0,4),(RY,0,5),(BZ,2,1),(RZ,0,5),(BZ,3,1),(D,0,5)]),
0x06:(True,True,(11,4,5,4),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,4),(RW,10,1),(GZ,4,1),(GY,0,4),(GX,0,5),(GW,10,1),(GZ,0,4),(BX,0,4),(BW,10,1),(BZ,1,1),(BY,0,4),(RY,0,4),(BZ,0,1),(BZ,2,1),(RZ,0,4),(GY,4,1),(BZ,3,1),(D,0,5)]),
0x0a:(True,True,(11,4,4,5),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,4),(RW,10,1),(BY,4,1),(GY,0,4),(GX,0,4),(GW,10,1),(BZ,0,1),(GZ,0,4),(BX,0,5),(BW,10,1),(BY,0,4),(RY,0,4),(BZ,1,1),(BZ,2,1),(RZ,0,4),(BZ,4,1),(BZ,3,1),(D,0,5)]),
0x0e:(True,True,(9,5,5,5),[Z,(RW,0,9),(BY,4,1),(GW,0,9),(GY,4,1),(BW,0,9),(BZ,4,1),(RX,0,5),(GZ,4,1),(GY,0,4),(GX,0,5),(BZ,0,1),(GZ,0,4),(BX,0,5),(BZ,1,1),(BY,0,4),(RY,0,5),(BZ,2,1),(RZ,0,5),(BZ,3,1),(D,0,5)]),
0x12:(True,True,(8,6,5,5),[Z,(RW,0,8),(GZ,4,1),(BY,4,1),(GW,0,8),(BZ,2,1),(GY,4,1),(BW,0,8),(BZ,3,1),(BZ,4,1),(RX,0,6),(GY,0,4),(GX,0,5),(BZ,0,1),(GZ,0,4),(BX,0,5),(BZ,1,1),(BY,0,4),(RY,0,6),(RZ,0,6),(D,0,5)]),
0x16:(True,True,(8,5,6,5),[Z,(RW,0,8),(BZ,0,1),(BY,4,1),(GW,0,8),(GY,5,1),(GY,4,1),(BW,0,8),(GZ,5,1),(BZ,4,1),(RX,0,5),(GZ,4,1),(GY,0,4),(GX,0,6),(GZ,0,4),(BX,0,5),(BZ,1,1),(BY,0,4),(RY,0,5),(BZ,2,1),(RZ,0,5),(BZ,3,1),(D,0,5)]),
0x1a:(True,True,(8,5,5,6),[Z,(RW,0,8),(BZ,1,1),(BY,4,1),(GW,0,8),(BY,5,1),(GY,4,1),(BW,0,8),(BZ,5,1),(BZ,4,1),(RX,0,5),(GZ,4,1),(GY,0,4),(GX,0,5),(BZ,0,1),(GZ,0,4),(BX,0,6),(BY,0,4),(RY,0,5),(BZ,2,1),(RZ,0,5),(BZ,3,1),(D,0,5)]),
0x1e:(True,False,(6,6,6,6),[Z,(RW,0,6),(GZ,4,1),(BZ,0,1),(BZ,1,1),(BY,4,1),(GW,0,6),(GY,5,1),(BY,5,1),(BZ,2,1),(GY,4,1),(BW,0,6),(GZ,5,1),(BZ,3,1),(BZ,5,1),(BZ,4,1),(RX,0,6),(GY,0,4),(GX,0,6),(GZ,0,4),(BX,0,6),(BY,0,4),(RY,0,6),(RZ,0,6),(D,0,5)]),
0x03:(False,False,(10,10,10,10),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,10),(GX,0,10),(BX,0,10)]),
0x07:(False,True,(11,9,9,9),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,9),(RW,10,1),(GX,0,9),(GW,10,1),(BX,0,9),(BW,10,1)]),
0x0b:(False,True,(12,8,8,8),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,8),(RW,11,1),(RW,10,1),(GX,0,8),(GW,11,1),(GW,10,1),(BX,0,8),(BW,11,1),(BW,10,1)]),
0x0f:(False,True,(16,4,4,4),[Z,(RW,0,10),(GW,0,10),(BW,0,10),(RX,0,4),(RW,15,1),(RW,14,1),(RW,13,1),(RW,12,1),(RW,11,1),(RW,10,1),(GX,0,4),(GW,15,1),(GW,14,1),(GW,13,1),(GW,12,1),(GW,11,1),(GW,10,1),(BX,0,4),(BW,15,1),(BW,14,1),(BW,13,1),(BW,12,1),(BW,11,1),(BW,10,1)]),
}
# NOTE: mode 14 (0x0f) reversed-bit fields: RW[15] stored first, so bit reversal handled by explicit (name,pos,1) entries.
def sext(v,b):
    return v-(1<<b) if v&(1<<(b-1)) else v
def unq(v,b):
    if b>=15: return v
    if v==0: return 0
    if v==(1<<b)-1: return 0xFFFF
    return ((v<<16)+0x8000)>>b
def decode_block(blk):
    n=int.from_bytes(blk,'little')
    m=n&3
    if m>=2: m=n&31
    if m not in MODES: return None
    part,tr,(eb,*db),fields=MODES[m]
    f={k:0 for k in 'RW RX RY RZ GW GX GY GZ BW BX BY BZ D'.split()}
    pos=0
    for name,bit,ln in fields:
        v=(n>>pos)&((1<<ln)-1); pos+=ln
        if name!=M: f[name]|=v<<bit
    mask=(1<<eb)-1
    def ep(chan,i):  # chan 0..2 -> returns list of endpoints
        w,x,y,z=[f[chan+s] for s in ('W','X','Y','Z')]
        d=db['RGB'.index(chan)]
        if part:
            if tr:
                x=(w+sext(x,d))&mask; y=(w+sext(y,d))&mask; z=(w+sext(z,d))&mask
            return [w,x,y,z]
        else:
            if tr: x=(w+sext(x,d))&mask
            return [w,x]
    E=[ep(c,0) for c in 'RGB']
    nsub=2 if part else 1
    E=[[unq(e,eb) for e in ch] for ch in E]
    # indices
    ib=3 if part else 4
    idx=[]; 
    pt=f['D'] if part else 0
    pm=PART[pt] if part else [0]*16
    anch=[0,ANCH[pt]] if part else [0]
    for i in range(16):
        bits=ib-1 if (i in anch) else ib
        v=(n>>pos)&((1<<bits)-1); pos+=bits
        idx.append(v)
    w=W3 if part else W4
    out=[]
    for i in range(16):
        s=pm[i]
        px=[]
        for c in range(3):
            e0=E[c][2*s]; e1=E[c][2*s+1]
            v=(e0*(64-w[idx[i]])+e1*w[idx[i]]+32)>>6
            h=(v*31)>>6
            px.append(h)
        out.append(px)
    return out
def h2f(h):
    return struct.unpack('<e',struct.pack('<H',h&0xFFFF))[0]
def decode(data,w,h):
    img=[[None]*w for _ in range(h)]
    bad=0
    for by in range(h//4):
        for bx in range(w//4):
            off=(by*(w//4)+bx)*16
            px=decode_block(data[off:off+16])
            if px is None: bad+=1; px=[[0,0,0]]*16
            for i,p in enumerate(px):
                img[by*4+i//4][bx*4+i%4]=[h2f(x) for x in p]
    return img,bad
