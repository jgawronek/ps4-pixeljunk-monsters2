import struct,sys
def src(v,lit=None):
    if v<=103: return f's{v}'
    if v==106: return 'vcc_lo'
    if v==107: return 'vcc_hi'
    if v==124: return 'm0'
    if v==126: return 'exec_lo'
    if v==127: return 'exec_hi'
    if v==128: return '0'
    if 129<=v<=192: return str(v-128)
    if 193<=v<=208: return str(-(v-192))
    fl={240:'0.5',241:'-0.5',242:'1.0',243:'-1.0',244:'2.0',245:'-2.0',246:'4.0',247:'-4.0',248:'1/2pi'}
    if v in fl: return fl[v]
    if v==251: return 'vccz'
    if v==252: return 'execz'
    if v==253: return 'scc'
    if v==255:
        if lit is None: return 'LIT?'
        f=struct.unpack('<f',struct.pack('<I',lit))[0]
        return f'lit({f:.6g}|0x{lit:x})'
    if v>=256: return f'v{v-256}'
    return f'?{v}'
VOP2={0:'cndmask_b32',3:'add_f32',4:'sub_f32',5:'subrev_f32',6:'mac_legacy_f32',7:'mul_legacy_f32',8:'mul_f32',9:'mul_i32_i24',11:'mul_u32_u24',13:'min_legacy_f32',14:'max_legacy_f32',15:'min_f32',16:'max_f32',17:'min_i32',18:'max_i32',19:'min_u32',20:'max_u32',21:'lshr_b32',22:'lshrrev_b32',23:'ashr_i32',24:'ashrrev_i32',25:'lshl_b32',26:'lshlrev_b32',27:'and_b32',28:'or_b32',29:'xor_b32',31:'mac_f32',32:'madmk_f32',33:'madak_f32',37:'add_i32',38:'sub_i32',39:'subrev_i32',43:'ldexp_f32',47:'cvt_pkrtz_f16_f32'}
VOP1={0:'nop',1:'mov_b32',2:'readfirstlane_b32',5:'cvt_f32_i32',6:'cvt_f32_u32',7:'cvt_u32_f32',8:'cvt_i32_f32',10:'cvt_f16_f32',11:'cvt_f32_f16',32:'fract_f32',33:'trunc_f32',34:'ceil_f32',35:'rndne_f32',36:'floor_f32',37:'exp_f32',39:'log_f32',42:'rcp_f32',46:'rsq_f32',51:'sqrt_f32',53:'sin_f32',54:'cos_f32',55:'not_b32'}
VOP3={320:'mad_legacy_f32',321:'mad_f32',322:'mad_i32_i24',323:'mad_u32_u24',324:'cubeid_f32',325:'cubesc_f32',326:'cubetc_f32',327:'cubema_f32',328:'bfe_u32',329:'bfe_i32',330:'bfi_b32',331:'fma_f32',337:'min3_f32',340:'max3_f32',343:'med3_f32',351:'div_fixup_f32',365:'div_fmas_f32',367:'div_scale_f32',361:'mul_hi_u32',362:'mul_lo_u32'}
CMPF=['f','lt','eq','le','gt','lg','ge','o','u','nge','nlg','ngt','nle','neq','nlt','tru']
def vopc(op):
    if 0x00<=op<=0x0f: return 'cmp_'+CMPF[op]+'_f32'
    if 0x10<=op<=0x1f: return 'cmpx_'+CMPF[op-0x10]+'_f32'
    if 0x80<=op<=0x87: return 'cmp_'+['f','lt','eq','le','gt','lg','ge','tru'][op-0x80]+'_i32'
    if 0xc0<=op<=0xc7: return 'cmp_'+['f','lt','eq','le','gt','lg','ge','tru'][op-0xc0]+'_u32'
    return f'vopc_{op:#x}'
SOP2={0:'add_u32',1:'sub_u32',2:'add_i32',3:'sub_i32',6:'min_i32',7:'min_u32',8:'max_i32',9:'max_u32',10:'cselect_b32',11:'cselect_b64',14:'and_b32',15:'and_b64',16:'or_b32',17:'or_b64',18:'xor_b32',19:'xor_b64',20:'andn2_b32',21:'andn2_b64',28:'lshl_b32',29:'lshl_b64',30:'lshr_b32',31:'lshr_b64',32:'ashr_i32',36:'mul_i32'}
SOP1={3:'mov_b32',4:'mov_b64',5:'cmov_b32',7:'not_b32',8:'not_b64',9:'wqm_b32',10:'wqm_b64',36:'and_saveexec_b64',37:'or_saveexec_b64',38:'xor_saveexec_b64',39:'andn2_saveexec_b64'}
SOPP={0:'nop',1:'endpgm',2:'branch',4:'cbranch_scc0',5:'cbranch_scc1',6:'cbranch_vccz',7:'cbranch_vccnz',8:'cbranch_execz',9:'cbranch_execnz',10:'barrier',12:'waitcnt'}
SMRD={0:'load_dword',1:'load_dwordx2',2:'load_dwordx4',3:'load_dwordx8',4:'load_dwordx16',8:'buffer_load_dword',9:'buffer_load_dwordx2',10:'buffer_load_dwordx4',11:'buffer_load_dwordx8',12:'buffer_load_dwordx16'}
MIMG={0:'load',1:'load_mip',8:'get_resinfo',32:'sample',33:'sample_cl',34:'sample_d',36:'sample_l',37:'sample_b',39:'sample_lz',40:'sample_c',44:'sample_c_l',47:'sample_c_lz',64:'gather4'}
def dis(b,start,end):
    p=start;out=[]
    w=lambda i: struct.unpack_from('<I',b,i)[0]
    while p<end:
        d=w(p);a=p;p+=4
        def lit(s):
            nonlocal p
            if s==255: l=w(p);p+=4;return l
            return None
        t=''
        if (d>>23)==0x17D:
            op=(d>>8)&0xff;sd=(d>>16)&0x7f;s0=d&0xff;l=lit(s0)
            t=f's_{SOP1.get(op,f"sop1_{op}")} {src(sd)}, {src(s0,l)}'
        elif (d>>23)==0x17E:
            op=(d>>16)&0x7f;s1=(d>>8)&0xff;s0=d&0xff;l=lit(s0)
            t=f's_cmp_op{op} {src(s0,l)}, {src(s1)}'
        elif (d>>23)==0x17F:
            op=(d>>16)&0x7f;i=d&0xffff
            if op==12: t=f's_waitcnt vm={i&15} exp={(i>>4)&7} lgkm={(i>>8)&15}'
            elif op in(2,4,5,6,7,8,9):
                o=i-0x10000 if i&0x8000 else i; t=f's_{SOPP[op]} -> {a+4+o*4:#x}'
            else: t=f's_{SOPP.get(op,f"sopp_{op}")} {i}'
        elif (d>>28)==0xB:
            op=(d>>23)&0x1f;sd=(d>>16)&0x7f;i=d&0xffff
            t=f's_k{op} {src(sd)}, {i}'
        elif (d>>30)==2:
            op=(d>>23)&0x7f;sd=(d>>16)&0x7f;s1=(d>>8)&0xff;s0=d&0xff
            l=lit(s0) or lit(s1) if False else None
            if s0==255: l=lit(s0)
            elif s1==255: l=lit(s1)
            t=f's_{SOP2.get(op,f"sop2_{op}")} {src(sd)}, {src(s0,l if s0==255 else None)}, {src(s1,l if s1==255 else None)}'
        elif (d>>27)==0x18:
            op=(d>>22)&0x1f;sd=(d>>15)&0x7f;sb=(d>>9)&0x3f;im=(d>>8)&1;off=d&0xff
            t=f's_{SMRD.get(op,f"smrd_{op}")} s{sd}, s[{sb*2}:{sb*2+1}], {"0x%x"%off if im else src(off)}'+(' (dwords)' if im else '')
        elif (d>>25)==0x3F:
            vd=(d>>17)&0xff;op=(d>>9)&0xff;s0=d&0x1ff;l=lit(s0)
            t=f'v_{VOP1.get(op,f"vop1_{op}")} v{vd}, {src(s0,l)}'
        elif (d>>25)==0x3E:
            op=(d>>17)&0xff;s1=(d>>9)&0xff;s0=d&0x1ff;l=lit(s0)
            t=f'v_{vopc(op)} vcc, {src(s0,l)}, v{s1}'
        elif (d>>31)==0:
            op=(d>>25)&0x3f;vd=(d>>17)&0xff;s1=(d>>9)&0xff;s0=d&0x1ff;l=lit(s0)
            if op in(32,33): l=w(p);p+=4
            nm=VOP2.get(op,f'vop2_{op}')
            if op==0: t=f'v_cndmask_b32 v{vd}, {src(s0,l)}, v{s1}, vcc'
            elif op==32: t=f'v_madmk_f32 v{vd}, {src(s0)}, lit({struct.unpack("<f",struct.pack("<I",l))[0]:.6g}), v{s1}'
            elif op==33: t=f'v_madak_f32 v{vd}, {src(s0)}, v{s1}, lit({struct.unpack("<f",struct.pack("<I",l))[0]:.6g})'
            else: t=f'v_{nm} v{vd}, {src(s0,l)}, v{s1}'
        elif (d>>26)==0x32:
            vd=(d>>18)&0xff;op=(d>>16)&3;at=(d>>10)&0x3f;ch=(d>>8)&3;vs=d&0xff
            t=f'v_interp_{["p1","p2","mov"][op] if op<3 else op}_f32 v{vd}, v{vs}, attr{at}.{"xyzw"[ch]}'
        elif (d>>26)==0x34:
            d2=w(p);p+=4
            op=(d>>17)&0x1ff;vd=d&0xff;abs_=(d>>8)&7;clamp=(d>>11)&1
            s0=d2&0x1ff;s1=(d2>>9)&0x1ff;s2=(d2>>18)&0x1ff;om=(d2>>27)&3;neg=(d2>>29)&7
            if op<256: nm=vopc(op);isc=True
            elif op<320 : nm=VOP2.get(op-256,f'vop2_{op-256}');isc=False
            elif op>=384: nm=VOP1.get(op-384,f'vop1_{op-384}');isc=False
            else: nm=VOP3.get(op,f'vop3_{op}');isc=False
            n=3 if (320<=op<384) else (1 if op>=384 else 2)
            if op==256: n=3
            ss=[s0,s1,s2][:n]
            ops=[]
            for i,s in enumerate(ss):
                x=src(s)
                if (abs_>>i)&1: x=f'|{x}|'
                if (neg>>i)&1: x='-'+x
                ops.append(x)
            dst=f's[{vd}]' if isc else f'v{vd}'
            t=f'v_{nm}_e64 {dst}, '+', '.join(ops)+(' clamp' if clamp else '')+(f' omod={om}' if om else '')
        elif (d>>26)==0x3C:
            d2=w(p);p+=4
            op=(d>>18)&0x7f;dm=(d>>8)&15
            va=d2&0xff;vdt=(d2>>8)&0xff;sr=(d2>>16)&0x1f;ss=(d2>>21)&0x1f
            fl=''.join(n for bit,n in((12,' unorm'),(13,' glc'),(14,' da'),(15,' r128'),(16,' tfe'),(17,' lwe'),(25,' slc')) if d>>bit&1)
            t=f'image_{MIMG.get(op,f"op{op}")} v[{vdt}..], v[{va}..], s[{sr*4}:{sr*4+3}], s[{ss*4}:{ss*4+3}] dmask={dm:#x}{fl}'
        elif (d>>26)==0x3E:
            d2=w(p);p+=4
            en=d&15;tg=(d>>4)&0x3f;cm=(d>>10)&1;dn=(d>>11)&1
            vs=[d2&0xff,(d2>>8)&0xff,(d2>>16)&0xff,(d2>>24)&0xff]
            t=f'exp target={tg} en={en:#x}{" compr" if cm else ""}{" done" if dn else ""} '+','.join(f'v{x}' for x in vs)
        else:
            t=f'??? {d:#010x}'
        out.append(f'{a:05x}: {t}')
    return out
if __name__=='__main__':
    b=open(sys.argv[1],'rb').read()
    print('\n'.join(dis(b,int(sys.argv[2],0),int(sys.argv[3],0))))
