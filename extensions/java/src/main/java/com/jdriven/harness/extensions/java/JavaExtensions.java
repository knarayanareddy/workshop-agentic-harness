package com.jdriven.harness.extensions.java;

import com.jdriven.harness.api.ExtensionBundle;
import com.jdriven.harness.api.Workspace;
import com.jdriven.harness.extensions.java.guardrails.defaults.BuildFileGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.CommandGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ProtectedPathsGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ResultCapGuardrail;
import com.jdriven.harness.extensions.java.listeners.defaults.ConsoleTraceListener;
import com.jdriven.harness.extensions.java.systemprompt.defaults.DefaultSections;
import com.jdriven.harness.extensions.java.tools.defaults.DefaultTools;

/**
 * Everything this module contributes: a complete agent on its own, so use it instead of the Kotlin or
 * TypeScript bundle, not next to them (the tool names would clash). The app decides where it goes in
 * the assembly. Its system prompt is the whole system prompt, in order.
 */
public final class JavaExtensions {
    private JavaExtensions() {
    }

    /** @param workspace the agent's working directory, named in the role section */
    public static ExtensionBundle bundle(Workspace workspace) {
        // The defaults go in first, so everything added below comes after them.
        return ExtensionBundle.builder()
                .sections(DefaultSections.all(workspace))
                // .section(new YourSection()) or .sections(YourSections.sections(workspace)): yours go here
                .tools(DefaultTools.all())
                .guardrail(new ProtectedPathsGuardrail())
                .guardrail(new CommandGuardrail())
                .guardrail(new BuildFileGuardrail())
                .guardrail(new ResultCapGuardrail())
                .listener(new ConsoleTraceListener())
                .build();
    }
}
