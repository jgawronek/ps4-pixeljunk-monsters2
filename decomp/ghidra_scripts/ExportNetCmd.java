// ExportNetCmd.java — targeted export of the GameCore.Network namespace
// (the sim-side command layer: NetworkCommand + subclasses + NetworkBridge).
// These drive SINGLE-PLAYER input too (Q4.GameCoreBridge executes queued
// NetworkCommands in OnGameCoreTicked even with the NullNetworkLayer).
// True online services live in Q4.Networking / Steamworks / NPToolkit and
// remain excluded.
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

public class ExportNetCmd extends GhidraScript {
    @Override
    public void run() throws Exception {
        String OUT = "/srv/opencode/ps3-pixeljunk-monsters2/decomp/decompiled/";
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
            if (!name.startsWith("GameCore.Network.")) continue;
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
        }
        for (PrintWriter pw : files.values()) pw.close();
        println("EXPORT_DONE decompiled=" + count + " failed=" + failed + " classes=" + files.size());
    }
}
