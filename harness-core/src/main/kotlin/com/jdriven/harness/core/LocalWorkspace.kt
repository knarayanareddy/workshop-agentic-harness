package com.jdriven.harness.core

import com.jdriven.harness.api.Workspace
import com.jdriven.harness.api.WorkspaceViolation
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeText

class LocalWorkspace(root: Path) : Workspace {
    override val root: Path = root.toAbsolutePath().normalize().also { it.createDirectories() }

    override fun resolve(relative: String): Path {
        val resolved = root.resolve(relative).normalize()
        if (!resolved.startsWith(root)) throw WorkspaceViolation("'$relative' is outside the workspace")
        // A symlink inside the workspace may still point out of it.
        if (resolved.exists() && !resolved.toRealPath().startsWith(root.toRealPath())) {
            throw WorkspaceViolation("'$relative' resolves outside the workspace")
        }
        return resolved
    }

    override fun exists(relative: String) = resolve(relative).exists()

    override fun readText(relative: String): String {
        val path = resolve(relative)
        require(Files.isRegularFile(path)) { "'$relative' is not a file" }
        return path.readText()
    }

    override fun writeText(relative: String, content: String) {
        val path = resolve(relative)
        path.parent?.createDirectories()
        path.writeText(content)
    }

    override fun list(relative: String): List<String> {
        val dir = resolve(relative)
        require(dir.isDirectory()) { "'$relative' is not a directory" }
        return dir.listDirectoryEntries().sortedBy { it.name }.map { if (it.isDirectory()) "${it.name}/" else it.name }
    }
}
