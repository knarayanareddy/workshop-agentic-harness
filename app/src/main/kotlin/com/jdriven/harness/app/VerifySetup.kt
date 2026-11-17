package com.jdriven.harness.app

import com.jdriven.harness.api.InferenceRequest
import com.jdriven.harness.api.Message
import com.jdriven.harness.core.OpenAiModelClient
import java.io.IOException
import kotlin.system.exitProcess

/**
 * `./gradlew verifySetup`: one small call to the model, so a single line confirms the API key, the endpoint and the
 * network before the workshop starts. Exits non-zero on failure, which fails the Gradle task.
 */
fun main() {
    try {
        val client = OpenAiModelClient()
        val response = client.infer(InferenceRequest(system = "", messages = listOf(Message.user("Reply with OK.")), tools = emptyList()))
        println("[ok] model ${client.model} at ${client.baseUrl} replied: ${Message.assistant(response.content).text.trim()}")
    } catch (e: Exception) {
        println("[error] ${e::class.simpleName}" + e.message?.let { ": $it" }.orEmpty())
        when {
            e is IOException -> println("Check MODEL_BASE_URL and your network connection.")
            "MODEL_API_KEY" in e.message.orEmpty() || "failed (401)" in e.message.orEmpty() -> println("Set MODEL_API_KEY to your token.")
        }
        exitProcess(1)
    }
}
