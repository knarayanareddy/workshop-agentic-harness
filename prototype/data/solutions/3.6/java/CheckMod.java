package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.CommandResult;
import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.Text;
import com.jdriven.harness.extensions.java.helpers.Toolbox;

import java.util.List;
import java.util.Optional;

/** Builds and lints the mod, and returns only what the model needs to act on. */
public final class CheckMod implements Tool {

    @Override
    public String getName() {
        return "check_mod";
    }

    @Override
    public String getDescription() {
        return "Build OpenRA and lint the Red Alert mod's rules and Lua scripts. Run it after every change, before you report the change done. "
                + "Returns 'passed', or the errors to fix. Needs the toolbox (start_toolbox).";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.empty();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        Optional<CommandResult> found = Toolbox.exec(ctx, "openra-check");
        if (found.isEmpty()) return ToolOutcome.failure("The toolbox is not running. Call start_toolbox first.");
        CommandResult result = found.get();
        if (result.getTimedOut()) {
            return ToolOutcome.failure("The check took longer than " + ShellCommand.TIMEOUT_SECONDS + " seconds, usually because OpenRA was compiling. Run check_mod again.");
        }
        if (result.getExitCode() == 0) return ToolOutcome.success("The Red Alert mod passed all checks.");
        List<String> errors = Text.nonBlankLines(result.getOutput()).stream().filter(line -> !line.startsWith("== ")).toList();
        return ToolOutcome.failure("The check failed. Fix these and run check_mod again:\n"
                + String.join("\n", errors.subList(Math.max(0, errors.size() - 30), errors.size())));
    }
}
