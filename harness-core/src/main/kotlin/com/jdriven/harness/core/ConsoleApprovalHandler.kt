package com.jdriven.harness.core

import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.ApprovalRequest
import java.io.BufferedReader
import java.io.PrintStream

/** The default human channel: prompts on the console. */
class ConsoleApprovalHandler(
    private val input: BufferedReader = System.`in`.bufferedReader(),
    private val out: PrintStream = System.out,
) : ApprovalHandler {

    override fun request(req: ApprovalRequest): ApprovalDecision {
        out.println()
        out.println("!! ${req.call.tool.name} needs approval:")
        req.reasons.forEach { out.println("   - $it") }
        out.println("   input: ${req.call.input}")
        while (true) {
            out.print("   [y] approve  [a] always for ${req.call.tool.name}  [n] deny > ")
            out.flush()
            when (input.readLine()?.trim()?.lowercase()) {
                "y", "yes" -> return ApprovalDecision.Approve
                "a", "always" -> return ApprovalDecision.ApproveAlways
                "n", "no", null -> {
                    out.print("   reason (optional) > ")
                    out.flush()
                    val reason = input.readLine()?.trim().orEmpty()
                    return ApprovalDecision.Deny(reason.ifEmpty { "the user declined" })
                }
            }
        }
    }
}
