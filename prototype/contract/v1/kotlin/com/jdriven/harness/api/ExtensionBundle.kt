package com.jdriven.harness.api

/**
 * What one extension module contributes. It is a plain value: nothing registers itself — the
 * assembly in `app` decides what goes in, and in what order.
 */
data class ExtensionBundle(
    val systemPrompt: List<SystemPromptSection> = emptyList(),
    val tools: List<Tool> = emptyList(),
    val guardrails: List<Guardrail> = emptyList(),
    val listeners: List<AgentEventListener> = emptyList(),
) {
    /** For Java: `ExtensionBundle.builder().tool(new MyTool()).guardrail(new MyGuardrail()).build()`. */
    class Builder {
        private val systemPrompt = mutableListOf<SystemPromptSection>()
        private val tools = mutableListOf<Tool>()
        private val guardrails = mutableListOf<Guardrail>()
        private val listeners = mutableListOf<AgentEventListener>()

        fun section(section: SystemPromptSection) = apply { systemPrompt += section }
        fun sections(sections: List<SystemPromptSection>) = apply { systemPrompt += sections }
        fun tool(tool: Tool) = apply { tools += tool }
        fun tools(tools: List<Tool>) = apply { this.tools += tools }
        fun guardrail(guardrail: Guardrail) = apply { guardrails += guardrail }
        fun listener(listener: AgentEventListener) = apply { listeners += listener }

        fun build() = ExtensionBundle(systemPrompt.toList(), tools.toList(), guardrails.toList(), listeners.toList())
    }

    companion object {
        @JvmStatic fun builder() = Builder()
    }
}
