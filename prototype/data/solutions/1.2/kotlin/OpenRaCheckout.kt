package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection

/** Tells the model to clone OpenRA while it is missing from the workspace; emits nothing once it is there. */
object OpenRaCheckout {
    private const val CLONE = "git clone --depth 1 --config core.autocrlf=false https://github.com/OpenRA/OpenRA.git OpenRA"

    fun section() = SystemPromptSection.Dynamic("openra_checkout") { ctx ->
        if (ctx.workspace.exists("OpenRA")) null
        else "OpenRA is not checked out in the workspace yet. Before anything else, clone it by running exactly: $CLONE"
    }
}
