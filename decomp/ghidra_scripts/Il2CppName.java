import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.listing.FunctionManager;
import java.nio.file.*;

public class Il2CppName extends GhidraScript {
    @Override
    public void run() throws Exception {
        Address base = currentProgram.getImageBase();
        FunctionManager fm = currentProgram.getFunctionManager();
        String dir = "/srv/opencode/ps3-pixeljunk-monsters2/decomp/il2cpp_user/";
        println("Image base: " + base);
        int named = 0, created = 0;
        for (String line : Files.readAllLines(Paths.get(dir + "names.tsv"))) {
            int t = line.indexOf('\t');
            if (t < 0) continue;
            long addr = Long.parseLong(line.substring(0, t));
            String name = line.substring(t + 1).replace(' ', '-');
            Address a = base.add(addr);
            if (fm.getFunctionAt(a) == null) {
                try { createFunction(a, null); created++; } catch (Exception e) {}
            }
            try { createLabel(a, name, true, SourceType.USER_DEFINED); named++; } catch (Exception e) {}
            if (named % 10000 == 0) println("named " + named);
        }
        println("METHODS named=" + named + " created=" + created);
        int sn = 0;
        for (String line : Files.readAllLines(Paths.get(dir + "strings.tsv"))) {
            int t = line.indexOf('\t');
            if (t < 0) continue;
            long addr = Long.parseLong(line.substring(0, t));
            String val = line.substring(t + 1);
            String nm = "STR_" + val.replaceAll("[^A-Za-z0-9_]", "_");
            if (nm.length() > 60) nm = nm.substring(0, 60);
            try { createLabel(base.add(addr), nm, true, SourceType.USER_DEFINED); sn++; } catch (Exception e) {}
        }
        println("STRINGS named=" + sn);
        int mn = 0;
        for (String line : Files.readAllLines(Paths.get(dir + "metadata.tsv"))) {
            int t = line.indexOf('\t');
            if (t < 0) continue;
            long addr = Long.parseLong(line.substring(0, t));
            String name = line.substring(t + 1).replace(' ', '-');
            try { createLabel(base.add(addr), name, true, SourceType.USER_DEFINED); mn++; } catch (Exception e) {}
        }
        println("METADATA named=" + mn);
        println("NAMING_DONE");
    }
}