package com.jdriven.harness.extensions.java.helpers;

import com.jdriven.harness.api.Workspace;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads and changes the Red Alert mod's rules in the workspace's OpenRA checkout.
 *
 * <p>The rules are MiniYAML, indented with tabs: an actor starts at the beginning of a line ({@code 2TNK:}), its
 * traits are one tab in ({@code \tMobile:}) and their keys two tabs in ({@code \t\tSpeed: 72}). Names starting with
 * {@code ^} are templates that other actors inherit from. In-game names live in a separate translation file,
 * {@code fluent/rules.ftl}.
 */
public final class ModRules {
    public static final String MOD = "OpenRA/mods/ra";
    public static final String RULES = MOD + "/rules";
    private static final String NAMES_FILE = MOD + "/fluent/rules.ftl";

    /** {@code actor-2tnk =} with {@code .name = Medium Tank} on the next line, or {@code actor-badr-name = Badger}. */
    private static final Pattern NAMES = Pattern.compile(
            "^(actor-[a-z0-9-]+) *=\\s*\\n\\s+\\.name *= *(.+)$|^(actor-[a-z0-9-]+-name) *= *(.+)$", Pattern.MULTILINE);

    private ModRules() {
    }

    /** Every actor that has an in-game name, like {@code 2TNK} / {@code Medium Tank} / {@code OpenRA/mods/ra/rules/vehicles.yaml}. Templates are left out. */
    public static List<Actor> actors(Workspace workspace) {
        Map<String, String> names = new HashMap<>();
        Matcher m = NAMES.matcher(workspace.readText(NAMES_FILE).replace("\r\n", "\n"));
        while (m.find()) {
            if (m.group(1) != null) names.put(m.group(1) + ".name", m.group(2).strip());
            else names.put(m.group(3), m.group(4).strip());
        }
        Set<Actor> actors = new LinkedHashSet<>();
        for (String path : rulesFiles(workspace)) {
            String actor = "";
            for (String line : workspace.readText(path).split("\n", -1)) {
                if (!line.isEmpty() && !Character.isWhitespace(line.charAt(0)) && !line.startsWith("#")) {
                    actor = line.split(":", 2)[0].strip();
                }
                String trimmed = line.strip();
                if (!trimmed.startsWith("Name:")) continue;
                String name = names.get(trimmed.substring("Name:".length()).strip());
                if (name != null && !actor.startsWith("^")) actors.add(new Actor(actor, name, path));
            }
        }
        return List.copyOf(actors);
    }

    /**
     * Sets {@code key} of {@code trait} in {@code actor}'s own rules to {@code value}, like {@code 2TNK}, {@code Mobile},
     * {@code Speed}, {@code 80}. Only changes a key the actor defines itself: an inherited value comes back as
     * {@link SetValueResult.NoSuchTrait} or {@link SetValueResult.NoSuchKey}. The actor ID is matched ignoring case;
     * the trait as written in the rules, like {@code Armament@PRIMARY}.
     *
     * @throws IllegalArgumentException when {@code value} is empty or more than one line
     */
    public static SetValueResult setValue(Workspace workspace, String actor, String trait, String key, String value) {
        if (value.isBlank() || value.contains("\n") || value.contains("\r")) {
            throw new IllegalArgumentException("The value must be a single, non-empty line.");
        }
        for (String path : rulesFiles(workspace)) {
            List<String> lines = new ArrayList<>(List.of(workspace.readText(path).split("\n", -1)));
            int start = indexOf(lines, 0, lines.size(), line -> line.stripTrailing().equalsIgnoreCase(actor + ":"));
            if (start < 0) continue;
            int end = indexOf(lines, start + 1, lines.size(), line -> !line.isEmpty() && !Character.isWhitespace(line.charAt(0)));
            if (end < 0) end = lines.size();
            int traitAt = indexOf(lines, start + 1, end, line -> line.stripTrailing().equals("\t" + trait + ":"));
            if (traitAt < 0) return new SetValueResult.NoSuchTrait(path);
            int keyAt = -1;
            for (int i = traitAt + 1; i < end && (lines.get(i).startsWith("\t\t") || lines.get(i).isBlank()); i++) {
                if (lines.get(i).strip().startsWith(key + ":")) {
                    keyAt = i;
                    break;
                }
            }
            if (keyAt < 0) return new SetValueResult.NoSuchKey(path);
            String old = lines.get(keyAt).split(":", 2)[1].strip();
            lines.set(keyAt, "\t\t" + key + ": " + value.strip());
            workspace.writeText(path, String.join("\n", lines));
            return new SetValueResult.Changed(path, old);
        }
        return new SetValueResult.NoSuchActor();
    }

    private static int indexOf(List<String> lines, int from, int to, java.util.function.Predicate<String> test) {
        for (int i = from; i < to; i++) {
            if (test.test(lines.get(i))) return i;
        }
        return -1;
    }

    private static List<String> rulesFiles(Workspace workspace) {
        return workspace.list(RULES).stream().filter(f -> f.endsWith(".yaml")).map(f -> RULES + "/" + f).toList();
    }
}
