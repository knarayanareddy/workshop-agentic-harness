package com.jdriven.harness.extensions.java.tools.defaults;

import com.jdriven.harness.api.CommandResult;
import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

import java.io.IOException;

/**
 * Lets the model build, run tests and use the shell.
 * The only tool with side effects beyond the workspace files, so it is the usual target for guardrails.
 */
public final class RunCommand implements Tool {

    @Override
    public String getName() {
        return "run_command";
    }

    @Override
    public String getDescription() {
        return "Run a shell command in the workspace root (" + ShellCommand.SHELL + ") and return its exit code and "
                + "combined output. Times out after " + ShellCommand.TIMEOUT_SECONDS + " seconds; output is limited to the last "
                + ShellCommand.MAX_OUTPUT + " characters.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj().string("command", "The command line to run").build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        CommandResult result;
        try {
            result = ShellCommand.run(ctx.getWorkspace().getRoot(), input.string("command"));
        } catch (IOException e) {
            return ToolOutcome.failure("could not start command: " + e.getMessage());
        }
        if (result.getTimedOut()) {
            return ToolOutcome.failure("Timed out after " + ShellCommand.TIMEOUT_SECONDS + " seconds.\n" + result.getOutput());
        }
        String text = "exit code " + result.getExitCode() + "\n" + result.getOutput();
        return result.getExitCode() == 0 ? ToolOutcome.success(text) : ToolOutcome.failure(text);
    }
}
