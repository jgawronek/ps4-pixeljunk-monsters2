import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.FunctionManager;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.HashMap;
import java.util.Map;

public class ExportDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String OUT = "/srv/opencode/ps3-pixeljunk-monsters2/decomp/decompiled/";
        String[] args = getScriptArgs();
        String[] prefixes = (args != null && args.length > 0) ? args : new String[]{"GameCore.", "Q4."};
        String[] skip = {"Network", "Networking", "Steamworks", "Analytics", "SonyNP", "Multiplay", "LocalMultiplayer", "NPToolkit"};
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        decomp.setSimplificationStyle("decompile");
        FunctionManager fm = currentProgram.getFunctionManager();
        Map<String, PrintWriter> files = new HashMap<>();
        int count = 0, failed = 0;
        FunctionIterator it = fm.getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            String name = f.getName(true);
            boolean match = false;
            for (String p : prefixes) if (name.startsWith(p)) { match = true; break; }
            if (!match) continue;
            boolean sk = false;
            for (String s : skip) if (name.contains(s)) { sk = true; break; }
            if (sk) continue;
            String cls = name.contains("$$") ? name.substring(0, name.indexOf("$$")) : name;
            DecompileResults res = decomp.decompileFunction(f, 45, monitor);
            if (res == null || !res.decompileCompleted()) { failed++; continue; }
            String c = res.getDecompiledFunction().getC();
            String key = cls.replaceAll("[^A-Za-z0-9_.]", "_");
            PrintWriter pw = files.get(key);
            if (pw == null) { pw = new PrintWriter(new FileWriter(OUT + key + ".c")); files.put(key, pw); }
            pw.println("// Function: " + name + " @ " + f.getEntryPoint());
            pw.println(c);
            pw.println();
            count++;
            if (count % 200 == 0) println("decompiled " + count);
        }
        for (PrintWriter pw : files.values()) pw.close();
        println("EXPORT_DONE decompiled=" + count + " failed=" + failed + " classes=" + files.size());
    }
}