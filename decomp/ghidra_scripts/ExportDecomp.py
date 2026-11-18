# Ghidra Jython script: decompile game functions to C pseudocode, grouped by class.
# Run AFTER Il2CppName.py has named the functions.
# Usage: analyzeHeadless <proj> PJM2 -process Il2CppUserAssemblies.elf -noanalysis -postScript ExportDecomp.py
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
import os, re

OUT = '/srv/opencode/ps3-pixeljunk-monsters2/decomp/decompiled'
PREFIXES = ('GameCore.', 'Q4.')
SKIP = ('Network', 'Networking', 'Steamworks', 'Analytics', 'SonyNP', 'Multiplay', 'LocalMultiplayer')
monitor = ConsoleTaskMonitor()
decomp = DecompInterface()
decomp.openProgram(currentProgram)
decomp.setSimplificationStyle("decompile")
fm = currentProgram.getFunctionManager()

def safe(s):
    return re.sub(r'[^A-Za-z0-9_.]', '_', s)

files = {}
count = 0; failed = 0
for func in fm.getFunctions(True):
    name = func.getName(True)
    if not name.startswith(PREFIXES):
        continue
    if any(s in name for s in SKIP):
        continue
    cls = name.split('$$')[0] if '$$' in name else name
    res = decomp.decompileFunction(func, 45, monitor)
    if res is None or not res.decompileCompleted():
        failed += 1
        continue
    c = res.getDecompiledFunction().getC()
    key = safe(cls)
    if key not in files:
        files[key] = open(os.path.join(OUT, key + '.c'), 'w')
    files[key].write('// Function: %s @ 0x%s\n' % (name, func.getEntryPoint()))
    files[key].write(c)
    files[key].write('\n\n')
    count += 1
    if count % 200 == 0:
        print('decompiled %d ...' % count)
for f in files.values():
    f.close()
print('EXPORT_DONE decompiled=%d failed=%d classes=%d' % (count, failed, len(files)))