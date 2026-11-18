import UnityPy
AB='/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/'
env=UnityPy.load(AB+'nature')
for o in env.objects:
    if o.type.name=='Shader':
        d=o.read()
        if d.m_ParsedForm.m_Name!='Nature/Water': continue
        print([k for k in d.__dict__ if not k.startswith('_')])
        pf=d.m_ParsedForm
        st=pf.m_SubShaders[0].m_Passes[0].m_State
        for k in dir(st):
            if k.startswith('_') or k=='object_reader': continue
            v=getattr(st,k)
            if hasattr(v,'srcBlend'): print(k,'src',v.srcBlend.val,'dst',v.destBlend.val,'srcA',v.srcBlendAlpha.val,'dstA',v.destBlendAlpha.val)
            elif hasattr(v,'val'): print(k,v.val)
        for k in ('platforms','offsets','compressedLengths','decompressedLengths'):
            print(k,getattr(d,k,None))
        cb=getattr(d,'compressedBlob',None); print('cblob',None if cb is None else len(cb))
        import pickle; pickle.dump({k:getattr(d,k,None) for k in ('platforms','offsets','compressedLengths','decompressedLengths','compressedBlob')},open('wblob.pkl','wb'))
