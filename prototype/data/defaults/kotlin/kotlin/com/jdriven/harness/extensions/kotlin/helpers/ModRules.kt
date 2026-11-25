package com.jdriven.harness.extensions.kotlin.helpers

import com.jdriven.harness.api.Workspace

/** An actor (unit, building, ...) with its in-game name, and the rules file that defines it. */
data class Actor(val id: String, val name: String, val file: String)

/** What [ModRules.setValue] did. */
sealed interface SetValueResult {
    /** Changed in [file]; the value was [oldValue]. */
    data class Changed(val file: String, val oldValue: String) : SetValueResult

    /** No rules file defines the actor. */
    data object NoSuchActor : SetValueResult

    /** The actor in [file] has no such trait of its own: it may inherit it. */
    data class NoSuchTrait(val file: String) : SetValueResult

    /** The actor's trait in [file] has no such key of its own: it may inherit it. */
    data class NoSuchKey(val file: String) : SetValueResult
}

/**
 * Reads and changes the Red Alert mod's rules in the workspace's OpenRA checkout.
 *
 * The rules are MiniYAML, indented with tabs: an actor starts at the beginning of a line (`2TNK:`), its traits are
 * one tab in (`\tMobile:`) and their keys two tabs in (`\t\tSpeed: 72`). Names starting with `^` are templates
 * that other actors inherit from. In-game names live in a separate translation file, `fluent/rules.ftl`.
 */
object ModRules {
    const val MOD = "OpenRA/mods/ra"
    const val RULES = "$MOD/rules"
    private const val NAMES_FILE = "$MOD/fluent/rules.ftl"

    /** `actor-2tnk =` with `.name = Medium Tank` on the next line, or `actor-badr-name = Badger`. */
    private val NAMES = Regex("""^(actor-[a-z0-9-]+) *=\s*\n\s+\.name *= *(.+)$|^(actor-[a-z0-9-]+-name) *= *(.+)$""", RegexOption.MULTILINE)

    /** Every actor that has an in-game name, like `2TNK` / `Medium Tank` / `OpenRA/mods/ra/rules/vehicles.yaml`. Templates are left out. */
    fun actors(workspace: Workspace): List<Actor> {
        val names = NAMES.findAll(workspace.readText(NAMES_FILE).replace("\r\n", "\n")).associate { m ->
            if (m.groupValues[1].isNotEmpty()) "${m.groupValues[1]}.name" to m.groupValues[2].trim()
            else m.groupValues[3] to m.groupValues[4].trim()
        }
        return rulesFiles(workspace).flatMap { path ->
            var actor = ""
            workspace.readText(path).lines().mapNotNull { line ->
                if (line.isNotEmpty() && !line[0].isWhitespace() && !line.startsWith("#")) actor = line.substringBefore(':').trim()
                val key = line.trim().takeIf { it.startsWith("Name:") }?.removePrefix("Name:")?.trim() ?: return@mapNotNull null
                val name = names[key] ?: return@mapNotNull null
                if (actor.startsWith("^")) null else Actor(actor, name, path)
            }
        }.distinct()
    }

    /**
     * Sets [key] of [trait] in [actor]'s own rules to [value], like `2TNK`, `Mobile`, `Speed`, `80`. Only changes a key
     * the actor defines itself: an inherited value comes back as [SetValueResult.NoSuchTrait] or [SetValueResult.NoSuchKey].
     * The actor ID is matched ignoring case; the trait as written in the rules, like `Armament@PRIMARY`.
     *
     * @throws IllegalArgumentException when [value] is empty or more than one line
     */
    fun setValue(workspace: Workspace, actor: String, trait: String, key: String, value: String): SetValueResult {
        require(value.isNotBlank() && '\n' !in value && '\r' !in value) { "The value must be a single, non-empty line." }
        for (path in rulesFiles(workspace)) {
            val lines = workspace.readText(path).lines().toMutableList()
            val start = lines.indexOfFirst { it.trimEnd().equals("$actor:", ignoreCase = true) }
            if (start < 0) continue
            val end = (start + 1 until lines.size).firstOrNull { lines[it].isNotEmpty() && !lines[it][0].isWhitespace() } ?: lines.size
            val traitAt = (start + 1 until end).firstOrNull { lines[it].trimEnd() == "\t$trait:" }
                ?: return SetValueResult.NoSuchTrait(path)
            val keyAt = (traitAt + 1 until end).takeWhile { lines[it].startsWith("\t\t") || lines[it].isBlank() }
                .firstOrNull { lines[it].trim().startsWith("$key:") }
                ?: return SetValueResult.NoSuchKey(path)
            val old = lines[keyAt].substringAfter(':').trim()
            lines[keyAt] = "\t\t$key: ${value.trim()}"
            workspace.writeText(path, lines.joinToString("\n"))
            return SetValueResult.Changed(path, old)
        }
        return SetValueResult.NoSuchActor
    }

    private fun rulesFiles(workspace: Workspace) = workspace.list(RULES).filter { it.endsWith(".yaml") }.map { "$RULES/$it" }
}
