package com.jdriven.harness.extensions.java.systemprompt.exercise;

import com.jdriven.harness.api.SystemPromptSection;

/** Tells the model to clone OpenRA while it is missing from the workspace; emits nothing once it is there. */
public final class OpenRaCheckout {
    private static final String CLONE = "git clone --depth 1 --config core.autocrlf=false https://github.com/OpenRA/OpenRA.git OpenRA";

    private OpenRaCheckout() {
    }

    public static SystemPromptSection section() {
        return new SystemPromptSection.Dynamic("openra_checkout", ctx ->
                ctx.getWorkspace().exists("OpenRA")
                        ? null
                        : "OpenRA is not checked out in the workspace yet. Before anything else, clone it by running exactly: " + CLONE);
    }
}
