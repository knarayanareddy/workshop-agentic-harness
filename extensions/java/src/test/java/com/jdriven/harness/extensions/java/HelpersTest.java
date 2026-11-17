package com.jdriven.harness.extensions.java;

import com.jdriven.harness.api.*;
import com.jdriven.harness.core.LocalWorkspace;
import com.jdriven.harness.extensions.java.helpers.*;
import kotlinx.serialization.json.JsonElementKt;
import kotlinx.serialization.json.JsonObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** The helpers the assignments build on. The same cases as HelpersTest in Kotlin and helpers.test.ts. */
class HelpersTest {
    @TempDir
    Path dir;

    private LocalWorkspace workspace() {
        return new LocalWorkspace(dir);
    }

    private ToolContext toolCtx() {
        return new ToolContext("r", 1, "id", workspace(), e -> { });
    }

    private static ToolCall call(String tool, String command) {
        Tool t = new Tool() {
            public String getName() { return tool; }
            public String getDescription() { return ""; }
            public JsonSchema getInputSchema() { return JsonSchema.empty(); }
            public ToolOutcome execute(ToolInput input, ToolContext ctx) { return ToolOutcome.success(""); }
        };
        return new ToolCall("1", t, new ToolInput(new JsonObject(Map.of("command", JsonElementKt.JsonPrimitive(command)))));
    }

    @Test
    void textTruncatesWithANoteAndSplitsLines() {
        assertEquals("short", Text.truncate("short", 10));
        assertEquals("abc\n[cut at 3 characters]", Text.truncate("abcdef", 3));
        assertEquals("abc\nread the rest", Text.truncate("abcdef", 3, "read the rest"));
        assertEquals(List.of("one", "two"), Text.nonBlankLines("one\r\n\r\n  \ntwo\n"));
    }

    @Test
    void hostTimeIsToTheMinuteWithAnOffset() {
        assertTrue(Host.now().matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} [+-]\\d{2}:\\d{2}"), Host.now());
        assertFalse(Host.system().isBlank());
    }

    @Test
    void commandsReadsTheCommandLineOfRunCommandOnly() {
        assertEquals(Optional.of("ls -la"), Commands.of(call("run_command", "ls -la")));
        assertEquals(Optional.empty(), Commands.of(call("read_file", "ls -la")));
        assertEquals(List.of("git", "-C", "OpenRA", "push", "origin"), Commands.words("git -C OpenRA push \"origin\""));
        assertEquals(List.of("python", "x.py"), Commands.names("C:\\Python\\python.exe x.py"));
        assertEquals(List.of("sh", "-c", "python3", "x.py"), Commands.names("sh -c \"/usr/bin/python3 x.py\""));
        assertTrue(Commands.hasWords("cd OpenRA && GIT push", "git", "push"));
        assertFalse(Commands.hasWords("git status", "git", "push"));
        assertFalse(Commands.hasWords("git pushy", "git", "push"));
    }

    @Test
    void commandsKnowsWhichWordsLeaveTheWorkspace() {
        for (String word : List.of("..", "../x", "~/.ssh", "$HOME/x", "%USERPROFILE%", dir.getParent().toString())) {
            assertTrue(Commands.isOutsideWorkspace(word, workspace()), word);
        }
        for (String word : List.of("", "OpenRA", "./out/x", "-la", "/dev/null")) {
            assertFalse(Commands.isOutsideWorkspace(word, workspace()), word);
        }
    }

    @Test
    void toolboxStatusReadsTheLog() {
        assertEquals(Toolbox.State.NOT_STARTED, Toolbox.status(toolCtx()).state());
        workspace().writeText(Toolbox.START_LOG, "Step 1/9\nStep 2/9\n");
        assertEquals(new Toolbox.Status(Toolbox.State.STARTING, "Step 1/9\nStep 2/9"), Toolbox.status(toolCtx()));
        workspace().writeText(Toolbox.START_LOG, "Step 9/9\n\nexit code 0\n");
        assertEquals(Toolbox.State.READY, Toolbox.status(toolCtx()).state());
        workspace().writeText(Toolbox.START_LOG, "error: no space left\n\nexit code 1\n");
        assertEquals(new Toolbox.Status(Toolbox.State.FAILED, "error: no space left\nexit code 1"), Toolbox.status(toolCtx()));
    }

    private void writeMod() {
        var ws = workspace();
        ws.writeText(ModRules.MOD + "/fluent/rules.ftl",
                "actor-2tnk =\n    .name = Medium Tank\n    .description = Tank.\n\nactor-tsla-name = Tesla Coil\nactor-vehicle-name = Vehicle\n");
        ws.writeText(ModRules.RULES + "/vehicles.yaml",
                "^Vehicle:\n\tTooltip:\n\t\tName: actor-vehicle-name\n\tMobile:\n\t\tSpeed: 50\n\n"
                        + "2TNK:\n\tInherits: ^Vehicle\n\tTooltip:\n\t\tName: actor-2tnk.name\n\tMobile:\n\t\tTurnSpeed: 20\n\t\tSpeed: 72\n\tHealth:\n\t\tHP: 400\n");
        ws.writeText(ModRules.RULES + "/structures.yaml", "# defenses\nTSLA:\n\tTooltip:\n\t\tName: actor-tsla-name\n");
        ws.writeText(ModRules.RULES + "/README.txt", "not rules");
    }

    @Test
    void modRulesListsNamedActorsWithoutTemplates() {
        writeMod();
        assertEquals(
                Set.of(new Actor("2TNK", "Medium Tank", ModRules.RULES + "/vehicles.yaml"), new Actor("TSLA", "Tesla Coil", ModRules.RULES + "/structures.yaml")),
                Set.copyOf(ModRules.actors(workspace())));
    }

    @Test
    void modRulesSetsOnlyAValueTheActorDefinesItself() {
        writeMod();
        var ws = workspace();
        String file = ModRules.RULES + "/vehicles.yaml";
        assertEquals(new SetValueResult.Changed(file, "72"), ModRules.setValue(ws, "2tnk", "Mobile", "Speed", " 80 "));
        assertTrue(ws.readText(file).contains("\t\tSpeed: 80\n\tHealth:"));
        assertTrue(ws.readText(file).contains("\t\tSpeed: 50\n"), "the template is untouched");
        assertEquals(new SetValueResult.NoSuchKey(file), ModRules.setValue(ws, "2TNK", "Health", "Armor", "Heavy"));
        assertEquals(new SetValueResult.NoSuchTrait(file), ModRules.setValue(ws, "2TNK", "Armament", "Weapon", "x"));
        assertEquals(new SetValueResult.NoSuchActor(), ModRules.setValue(ws, "4TNK", "Mobile", "Speed", "1"));
        assertThrows(IllegalArgumentException.class, () -> ModRules.setValue(ws, "2TNK", "Mobile", "Speed", "1\n\tHP: 1"));
    }
}
