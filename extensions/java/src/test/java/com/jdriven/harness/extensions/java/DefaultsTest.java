package com.jdriven.harness.extensions.java;

import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.core.LocalWorkspace;
import com.jdriven.harness.api.ResultDecision;
import com.jdriven.harness.extensions.java.guardrails.defaults.CommandGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ProtectedPathsGuardrail;
import com.jdriven.harness.extensions.java.guardrails.defaults.ResultCapGuardrail;
import com.jdriven.harness.extensions.java.tools.defaults.DefaultTools;
import kotlinx.serialization.json.Json;
import kotlinx.serialization.json.JsonElementKt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefaultsTest {
    @TempDir
    Path dir;

    private static ToolInput input(String json) {
        return new ToolInput(JsonElementKt.getJsonObject(Json.Default.parseToJsonElement(json)));
    }

    private Tool tool(String name) {
        return DefaultTools.all().stream().filter(t -> t.getName().equals(name)).findFirst().orElseThrow();
    }

    private ToolOutcome run(String tool, String json) {
        var ws = new LocalWorkspace(dir);
        return tool(tool).execute(input(json), new ToolContext("run", 1, "id", ws, e -> { }));
    }

    private static String text(ToolOutcome o) {
        return o instanceof ToolOutcome.Success s ? s.getContent() : ((ToolOutcome.Failure) o).getMessage();
    }

    private ToolDecision decide(String command) {
        var ws = new LocalWorkspace(dir);
        var call = new ToolCall("1", tool("run_command"), input("{\"command\": " + Json.Default.encodeToString(
                kotlinx.serialization.builtins.BuiltinSerializersKt.serializer(kotlin.jvm.internal.StringCompanionObject.INSTANCE), command) + "}"));
        return new CommandGuardrail().beforeToolUse(call, new TurnContext("run", 1, 25, List.of(), ws));
    }

    @Test
    void writeEditReadRoundTrip() {
        run("write_file", "{\"path\": \"a/b.txt\", \"content\": \"one two one\"}");
        assertInstanceOf(ToolOutcome.Failure.class, run("edit_file", "{\"path\": \"a/b.txt\", \"old_text\": \"one\", \"new_text\": \"x\"}"));
        assertInstanceOf(ToolOutcome.Success.class, run("edit_file", "{\"path\": \"a/b.txt\", \"old_text\": \"one\", \"new_text\": \"x\", \"replace_all\": true}"));
        assertEquals("x two x", text(run("read_file", "{\"path\": \"a/b.txt\"}")));
    }

    @Test
    void globAndGrepSkipIgnoredDirs() throws Exception {
        Files.createDirectories(dir.resolve("src"));
        Files.createDirectories(dir.resolve("node_modules/x"));
        Files.writeString(dir.resolve("src/A.java"), "class A { int needle; }");
        Files.writeString(dir.resolve("node_modules/x/B.java"), "needle");
        assertEquals("src/A.java", text(run("glob", "{\"pattern\": \"**/*.java\"}")));
        assertEquals("src/A.java:1: class A { int needle; }", text(run("grep", "{\"pattern\": \"needle\"}")));
    }

    @Test
    void runCommandReportsOutputAndExitCode() {
        var ok = run("run_command", "{\"command\": \"echo hi\"}");
        assertInstanceOf(ToolOutcome.Success.class, ok);
        assertTrue(text(ok).contains("hi"));
        assertInstanceOf(ToolOutcome.Failure.class, run("run_command", "{\"command\": \"exit 3\"}"));
    }

    @Test
    void guardrailDeniesDestructiveCommands() {
        for (String c : new String[]{"rm -rf x", "rm -fr x", "rm -r -f x", "git push origin main"}) {
            assertInstanceOf(ToolDecision.Deny.class, decide(c), c);
        }
    }

    @Test
    void guardrailAllowsReadOnlyButNotChainedCommands() {
        assertEquals(ToolDecision.allow(), decide("ls -la"));
        assertEquals(ToolDecision.allow(), decide("git status"));
        for (String c : new String[]{"ls; touch x", "cat a > b", "ls && touch x", "cat $(touch x)", "ls\ntouch x", "npm install"}) {
            assertInstanceOf(ToolDecision.Ask.class, decide(c), c);
        }
        // the shell turns these into other paths than the guardrails see
        for (String c : new String[]{"cat .en*", "cat .gi?/config", "cat '.e'nv", "cat .e\\nv", "cat $OLDPWD/x", "type %USERPROFILE%\\x",
                "git diff --output=build.gradle.kts", "git log --output=src/A.java"}) {
            assertInstanceOf(ToolDecision.Ask.class, decide(c), c);
        }
    }

    private ToolDecision protect(String tool, String path) {
        var ws = new LocalWorkspace(dir);
        var call = new ToolCall("1", tool(tool), input("{\"path\": \"" + path + "\"}"));
        return new ProtectedPathsGuardrail().beforeToolUse(call, new TurnContext("run", 1, 25, List.of(), ws));
    }

    @Test
    void protectedPathsAreDeniedEvenWhenDisguised() {
        for (String p : new String[]{".env", "app/.env.local", "a/../.env", ".git/config", "certs/server.pem", "id_rsa"}) {
            assertInstanceOf(ToolDecision.Deny.class, protect("read_file", p), p);
        }
        assertInstanceOf(ToolDecision.Deny.class, protect("write_file", ".env"));
        assertEquals(ToolDecision.allow(), protect("read_file", ".env.example"));
        assertEquals(ToolDecision.allow(), protect("read_file", "src/Main.java"));
        assertInstanceOf(ToolDecision.Deny.class, protect("read_file", "../outside.txt"));
        
    }

    private ToolDecision protectCommand(String command) {
        var ws = new LocalWorkspace(dir);
        var call = new ToolCall("1", tool("run_command"), input("{\"command\": " + Json.Default.encodeToString(
                kotlinx.serialization.builtins.BuiltinSerializersKt.serializer(kotlin.jvm.internal.StringCompanionObject.INSTANCE), command) + "}"));
        return new ProtectedPathsGuardrail().beforeToolUse(call, new TurnContext("run", 1, 25, List.of(), ws));
    }

    @Test
    void commandsAreChecked() {
        for (String c : new String[]{"cat .env", "cat a/../.env", "cat \".env\"", "cp x .git/config", "echo hi>id_rsa", "cat certs/server.pem"}) {
            assertInstanceOf(ToolDecision.Deny.class, protectCommand(c), c);
        }
        // leaving the workspace is not this guardrail's job for run_command
        for (String c : new String[]{"cat /etc/passwd", "ls ~", "cat ~/.ssh/config", "ls ..", "cat ../x", "ls $HOME", "cd / && ls"}) {
            assertEquals(ToolDecision.allow(), protectCommand(c), c);
        }
        String inside = new LocalWorkspace(dir).getRoot().resolve("src/A.java").toString();
        for (String c : new String[]{"ls -la", "cat .env.example", "./gradlew test", "cat " + inside, "ls 2>/dev/null", "echo a/b/../c"}) {
            assertEquals(ToolDecision.allow(), protectCommand(c), c);
        }
        if (ShellCommand.SHELL.equals("cmd.exe")) {
            for (String c : new String[]{"dir /b", "findstr /i foo src", "dir /a:d"}) {
                assertEquals(ToolDecision.allow(), protectCommand(c), c);
            }
        }
    }

    @Test
    void resultCapTruncatesOnlyOversizedSuccesses() {
        var ws = new LocalWorkspace(dir);
        var ctx = new TurnContext("run", 1, 25, List.of(), ws);
        var call = new ToolCall("1", tool("read_file"), input("{}"));
        var cap = new ResultCapGuardrail(10);
        assertEquals(ResultDecision.accept(), cap.afterToolUse(call, ToolOutcome.success("short"), ctx));
        assertEquals(ResultDecision.accept(), cap.afterToolUse(call, ToolOutcome.failure("x".repeat(50)), ctx));
        var replaced = assertInstanceOf(ResultDecision.Replace.class, cap.afterToolUse(call, ToolOutcome.success("x".repeat(50)), ctx));
        assertTrue(text(replaced.getOutcome()).startsWith("xxxxxxxxxx\n\n[truncated"));
    }
}
