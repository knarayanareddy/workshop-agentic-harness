package com.jdriven.harness.api

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * A tool's input, as the model sent it. Typed accessors fail with a message the model can act on,
 * because a thrown exception becomes a [ToolOutcome.Failure] the model reads.
 */
class ToolInput(val json: JsonObject) {

    fun string(name: String): String =
        stringOrNull(name) ?: throw IllegalArgumentException("missing required string parameter '$name'")

    fun stringOrNull(name: String): String? = (json[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    fun int(name: String): Int =
        intOrNull(name) ?: throw IllegalArgumentException("missing required integer parameter '$name'")

    fun intOrNull(name: String): Int? = (json[name] as? JsonPrimitive)?.intOrNull

    /** From Java, call it as `bool`: `boolean` is a Java keyword. */
    @JvmName("bool")
    fun boolean(name: String, default: Boolean): Boolean = (json[name] as? JsonPrimitive)?.booleanOrNull ?: default

    override fun toString(): String = json.toString()
}

/**
 * A JSON Schema for a tool's input. Write it as JSON (a Java text block works well) with [parse],
 * or use the small builder for the common flat-object case.
 */
class JsonSchema(val json: JsonObject) {

    override fun toString(): String = json.toString()

    class Builder {
        private val properties = mutableMapOf<String, JsonObject>()
        private val required = mutableListOf<String>()

        @JvmOverloads
        fun string(name: String, description: String, required: Boolean = true) = property(name, "string", description, required)

        @JvmOverloads
        fun integer(name: String, description: String, required: Boolean = true) = property(name, "integer", description, required)

        @JvmOverloads
        fun bool(name: String, description: String, required: Boolean = true) = property(name, "boolean", description, required)

        private fun property(name: String, type: String, description: String, isRequired: Boolean) = apply {
            properties[name] = buildJsonObject { put("type", type); put("description", description) }
            if (isRequired) required += name
        }

        fun build() = JsonSchema(buildJsonObject {
            put("type", "object")
            put("properties", JsonObject(properties))
            put("required", JsonArray(required.map(::JsonPrimitive)))
        })
    }

    companion object {
        @JvmStatic fun parse(json: String) = JsonSchema(Json.parseToJsonElement(json).jsonObject)

        /** `{"type":"object","properties":{}}` — for tools that take no input. */
        @JvmStatic fun empty() = Builder().build()

        @JvmStatic fun obj() = Builder()
    }
}
