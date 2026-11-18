import pickle,lz4.block
d=pickle.load(open('wblob.pkl','rb'))
b=bytes(d['compressedBlob'])
raw=lz4.block.decompress(b,uncompressed_size=d['decompressedLengths'][0])
open('water_dec.bin','wb').write(raw);print(len(raw))
