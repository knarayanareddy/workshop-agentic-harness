package com.jdriven.harness.extensions.java;

import com.jdriven.harness.api.AgentEvent;
import com.jdriven.harness.api.ExtensionBundle;
import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.core.LocalWorkspace;
import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.BuildFileGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.CommandGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ProtectedPathsGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ResultCapGuardrail;
import com.jdriven.harness.extensions.java.systemprompt.defaults.IterationBudget;
import com.jdriven.harness.extensions.java.systemprompt.defaults.Role;
import com.jdriven.harness.extensions.java.systemprompt.defaults.WorkingAgreements;
import com.jdriven.harness.extensions.java.listeners.defaults.ConsoleTraceListener;
import kotlinx.serialization.json.Json;
import kotlinx.serialization.json.JsonElementKt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BundleTest {
    @TempDir
    Path dir;

    private ExtensionBundle bundle() {
        return JavaExtensions.bundle(new LocalWorkspace(dir));
    }

    private static ToolInput input(String json) {
        return new ToolInput(JsonElementKt.getJsonObject(Json.Default.parseToJsonElement(json)));
    }

    // The workshop adds to the bundle and removes default sections from it, so these tests check
    // what must stay true of any bundle, and test the defaults directly instead of through the bundle.
    @Test
    void bundleHasTheDefaultToolsAndGuardrailsAndNoDuplicateNames() {
        ExtensionBundle bundle = bundle();
        List<String> tools = bundle.getTools().stream().map(Tool::getName).toList();
        assertEquals(new HashSet<>(tools).size(), tools.size(), "duplicate tool names: " + tools);
        assertTrue(tools.containsAll(List.of("read_file", "write_file", "edit_file", "list_files", "glob", "grep", "run_command", "file_stats")), tools.toString());
        List<String> sections = bundle.getSystemPrompt().stream().map(SystemPromptSection::getName).toList();
        assertEquals(new HashSet<>(sections).size(), sections.size(), "duplicate section names: " + sections);
        List<String> guardrails = bundle.getGuardrails().stream().map(Guardrail::getName).toList();
        List<String> defaults = Stream.of(new ProtectedPathsGuardrail(), new CommandGuardrail(), new BuildFileGuardrail(), new ResultCapGuardrail())
                .map(Guardrail::getName).toList();
        assertTrue(guardrails.containsAll(defaults), guardrails.toString());
        assertFalse(bundle.getListeners().isEmpty());
    }

    @Test
    void defaultSectionsBuildTheRole() {
        var role = assertInstanceOf(SystemPromptSection.Static.class, Role.section(new LocalWorkspace(dir)));
        assertEquals("You are a coding agent working in the directory " + dir.getFileName()
                + ". Use the tools to inspect and change files; do not guess file contents.", role.getText());
        assertFalse(assertInstanceOf(SystemPromptSection.Static.class, WorkingAgreements.section()).getText().isBlank());
    }

    @Test
    void iterationBudgetSpeaksOnlyWhenTight() {
        var section = assertInstanceOf(SystemPromptSection.Dynamic.class, IterationBudget.section());
        var ws = new LocalWorkspace(dir);
        assertNull(section.getRender().render(new TurnContext("r", 1, 25, List.of(), ws)));
        assertTrue(section.getRender().render(new TurnContext("r", 22, 25, List.of(), ws)).contains("3 inference calls"));
    }

    @Test
    void buildFilesAreDeniedAndWritesOutsideSrcAreGated() {
        var ws = new LocalWorkspace(dir);
        var ctx = new TurnContext("r", 1, 25, List.of(), ws);
        Tool write = bundle().getTools().stream().filter(t -> t.getName().equals("write_file")).findFirst().orElseThrow();
        var guard = new BuildFileGuardrail();
        assertInstanceOf(ToolDecision.Deny.class, guard.beforeToolUse(new ToolCall("1", write, input("{\"path\": \"pom.xml\"}")), ctx));
        assertInstanceOf(ToolDecision.Deny.class, guard.beforeToolUse(new ToolCall("1", write, input("{\"path\": \"src/../pom.xml\"}")), ctx));
        assertInstanceOf(ToolDecision.Ask.class, guard.beforeToolUse(new ToolCall("1", write, input("{\"path\": \"notes.md\"}")), ctx));
        assertEquals(ToolDecision.allow(), guard.beforeToolUse(new ToolCall("1", write, input("{\"path\": \"src/A.java\"}")), ctx));
    }

    @Test
    void fileStatsAndTraceWork() {
        var ws = new LocalWorkspace(dir);
        ws.writeText("a.txt", "one two\nthree\n");
        Tool stats = bundle().getTools().stream().filter(t -> t.getName().equals("file_stats")).findFirst().orElseThrow();
        var out = new ByteArrayOutputStream();
        var trace = new ConsoleTraceListener(new PrintStream(out));
        var result = stats.execute(input("{\"path\": \"a.txt\"}"), new ToolContext("r", 1, "id", ws, trace::onEvent));
        assertEquals("a.txt: 3 lines, 3 words, 14 characters", assertInstanceOf(ToolOutcome.Success.class, result).getContent());
        assertTrue(out.toString().contains("counting a.txt"));
    }
}
