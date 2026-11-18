import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.address.Address;

public class DiagDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        Address a = toAddr(4910224L); // GameCore.GameCoreEnemy$$get_CanAttack
        Function f = getFunctionAt(a);
        println("func at " + a + ": " + (f == null ? "NULL" : f.getName(true)));
        if (f != null) {
            println("body=" + f.getBody());
            println("thunk=" + f.isThunk() + " external=" + f.isExternal());
            println("sig=" + f.getSignature());
            println("callingConv=" + f.getCallingConventionName());
        }
        DecompInterface d = new DecompInterface();
        boolean ok = d.openProgram(currentProgram);
        println("openProgram=" + ok);
        println("options=" + d.getOptions());
        DecompileResults r = d.decompileFunction(f, 60, monitor);
        println("completed=" + (r == null ? "null-res" : r.decompileCompleted()));
        if (r != null) {
            println("errorMessage=" + r.getErrorMessage());
            if (r.decompileCompleted()) println(r.getDecompiledFunction().getC());
        }
    }
}