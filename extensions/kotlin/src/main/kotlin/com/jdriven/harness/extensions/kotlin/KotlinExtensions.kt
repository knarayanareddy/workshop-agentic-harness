package com.jdriven.harness.extensions.kotlin

import com.jdriven.harness.api.ExtensionBundle
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.BuildFileGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.CommandGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.ProtectedPathsGuardrail
import com.jdriven.harness.extensions.kotlin.guardrails.defaults.ResultCapGuardrail
import com.jdriven.harness.extensions.kotlin.listeners.defaults.ConsoleTraceListener
import com.jdriven.harness.extensions.kotlin.systemprompt.defaults.DefaultSections
import com.jdriven.harness.extensions.kotlin.tools.defaults.DefaultTools

/**
 * Everything this module contributes: a complete agent on its own, so use it instead of the Java or
 * TypeScript bundle, not next to them (the tool names would clash). The app decides where it goes in
 * the assembly. Its system prompt is the whole system prompt, in order.
 */
object KotlinExtensions {
    /** @param workspace the agent's working directory, named in the role section */
    fun bundle(workspace: Workspace): ExtensionBundle {
        return ExtensionBundle(
            systemPrompt = DefaultSections.all(workspace), // + YourSection.section(): your sections go after the default ones
            tools = DefaultTools.all(),
            guardrails = listOf(
                ProtectedPathsGuardrail(),
                CommandGuardrail(),
                BuildFileGuardrail(),
                ResultCapGuardrail(),
            ),
            listeners = listOf(ConsoleTraceListener()),
        )
    }
}
