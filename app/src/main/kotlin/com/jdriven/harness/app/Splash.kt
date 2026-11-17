package com.jdriven.harness.app

import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import java.nio.charset.Charset
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow

/**
 * Startup splash: the Conflux logo flips like a coin, then JDRIVEN is drawn in from left to right.
 * Any key skips to the final frame. With HARNESS_NO_SPLASH=1 only the final frame is shown, and NO_COLOR
 * leaves out the colours. Nothing is shown when there is no terminal or the output encoding cannot show
 * the block characters.
 */
object Splash {
    const val LOGO_WIDTH = 33
    const val LOGO_HEIGHT = 17
    private const val GAP = "    "

    // The logo is three triangular facets, in the coordinates of a 448x430 source image.
    private const val IMAGE_WIDTH = 448.0
    private const val IMAGE_HEIGHT = 430.0
    private val FACETS = listOf(
        doubleArrayOf(18.0, 18.0, 442.0, 152.0, 200.0, 170.0),   // top
        doubleArrayOf(5.0, 25.0, 165.0, 195.0, 103.0, 428.0),    // left
        doubleArrayOf(210.0, 210.0, 442.0, 162.0, 115.0, 430.0), // bottom right
    )
    private const val SHADES = " ░▒▓█"
    private const val SAMPLES = 4 // per axis, per character cell

    private val LETTERS = listOf(
        listOf("     ██╗", "     ██║", "     ██║", "██   ██║", "╚█████╔╝", " ╚════╝ "),
        listOf("██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "),
        listOf("██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"),
        listOf("██╗", "██║", "██║", "██║", "██║", "╚═╝"),
        listOf("██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "),
        listOf("███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"),
        listOf("███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"),
    )
    val TITLE: List<String> = LETTERS.first().indices.map { row -> LETTERS.joinToString("") { it[row] } }
    val TITLE_WIDTH = TITLE.maxOf { it.length }

    /**
     * The logo seen at [angle] radians around its vertical axis, as rows of shading characters.
     * Each cell gets the share of its sub-samples that hit a facet; the back face is mirrored.
     */
    fun renderLogo(angle: Double, width: Int = LOGO_WIDTH, height: Int = LOGO_HEIGHT): List<String> {
        val squash = cos(angle)
        val centre = IMAGE_WIDTH / 2
        return (0 until height).map { row ->
            buildString {
                for (col in 0 until width) {
                    var hits = 0
                    for (sy in 0 until SAMPLES) for (sx in 0 until SAMPLES) {
                        val screenX = (col + (sx + 0.5) / SAMPLES) / width * IMAGE_WIDTH
                        val y = (row + (sy + 0.5) / SAMPLES) / height * IMAGE_HEIGHT
                        if (abs(squash) < 1e-3) continue
                        val x = centre + (screenX - centre) / squash
                        if (FACETS.any { inside(it, x, y) }) hits++
                    }
                    append(SHADES[(hits * (SHADES.length - 1) + SAMPLES * SAMPLES / 2) / (SAMPLES * SAMPLES)])
                }
            }
        }
    }

    /** The first [columns] columns of the JDRIVEN title; the rest is blank. */
    fun revealTitle(columns: Int): List<String> =
        TITLE.map { it.take(columns.coerceIn(0, it.length)).padEnd(TITLE_WIDTH) }

    fun play() {
        val charset = outputCharset()
        val encoder = charset.newEncoder()
        if (!(TITLE + SHADES).all { encoder.canEncode(it) }) return
        val terminal = Terminal.open() ?: return
        val out = PrintStream(FileOutputStream(FileDescriptor.out), false, charset)
        val beside = terminal.columns?.let { it >= LOGO_WIDTH + GAP.length + TITLE_WIDTH } ?: true
        val trueColor = System.getenv("COLORTERM").orEmpty().let { "truecolor" in it || "24bit" in it }
        val frame = Frame(out, beside, trueColor, colored = System.getenv("NO_COLOR") == null)
        System.out.flush()
        if (System.getenv("HARNESS_NO_SPLASH") != null) {
            terminal.close()
            frame.draw(renderLogo(0.0), 1.0, TITLE_WIDTH)
            out.print("\n")
            out.flush()
            return
        }
        val restore = Thread { out.print(SHOW_CURSOR); out.flush(); terminal.close() }
        Runtime.getRuntime().addShutdownHook(restore)
        try {
            out.print(HIDE_CURSOR)
            run {
                val spinFrames = 48
                for (i in 0..spinFrames) {
                    val t = i.toDouble() / spinFrames
                    val angle = 4 * PI * (1 - (1 - t).pow(3)) // two turns, easing out to face-on
                    frame.draw(renderLogo(angle), cos(angle), 0)
                    if (terminal.pause(33)) return@run
                }
                val logo = renderLogo(0.0)
                for (columns in 0..TITLE_WIDTH step 2) {
                    frame.draw(logo, 1.0, columns)
                    if (terminal.pause(12)) return@run
                }
            }
            frame.draw(renderLogo(0.0), 1.0, TITLE_WIDTH)
            out.print("\n")
        } finally {
            out.print(SHOW_CURSOR)
            out.flush()
            terminal.close()
            runCatching { Runtime.getRuntime().removeShutdownHook(restore) }
        }
    }

    /** Draws the logo and title, redrawing in place; without [colored] the colour codes are left out. */
    private class Frame(
        private val out: PrintStream,
        private val beside: Boolean,
        private val trueColor: Boolean,
        private val colored: Boolean,
    ) {
        private var drawnLines = 0

        fun draw(logo: List<String>, facing: Double, titleColumns: Int) {
            val title = revealTitle(titleColumns).map { colorTitle(it, titleColumns) }
            val logoLines = logo.map { color(it, facing) }
            val lines = if (beside) {
                val top = (logo.size - title.size) / 2
                logoLines.mapIndexed { i, line -> line + GAP + (title.getOrNull(i - top) ?: "") }
            } else {
                logoLines + "" + title
            }
            val sb = StringBuilder()
            if (drawnLines > 0) sb.append("\u001b[${drawnLines}A\r")
            lines.forEach { sb.append("\u001b[2K").append(it).append('\n') }
            drawnLines = lines.size
            out.print(sb)
            out.flush()
        }

        /** Front face in bright green, back face darker; both dim as the logo turns edge-on. */
        private fun color(line: String, facing: Double): String {
            if (!colored) return line
            val light = 0.45 + 0.55 * abs(facing)
            val (r, g, b) = if (facing >= 0) Triple(46, 204, 64) else Triple(20, 110, 35)
            val code = if (trueColor) "38;2;${(r * light).toInt()};${(g * light).toInt()};${(b * light).toInt()}"
            else if (facing >= 0) "92" else "32"
            return "\u001b[${code}m$line\u001b[0m"
        }

        /** Revealed letters in green, with a white leading edge while the title is being drawn. */
        private fun colorTitle(line: String, columns: Int): String {
            if (!colored) return line
            val green = if (trueColor) "\u001b[1;38;2;46;204;64m" else "\u001b[1;92m"
            if (columns >= TITLE_WIDTH || columns <= 0) return "$green$line\u001b[0m"
            val edge = (columns - 2).coerceAtLeast(0)
            return green + line.substring(0, edge) + "\u001b[1;97m" + line.substring(edge, columns) +
                "\u001b[0m" + line.substring(columns)
        }
    }

    /**
     * The controlling terminal, switched to unbuffered input so a single key can skip the splash.
     * Uses stty, so on Windows a key only arrives after Enter.
     */
    private class Terminal private constructor(private val savedMode: String?, val columns: Int?) : AutoCloseable {
        private var closed = false

        /** Sleeps up to [millis]; true when a key was pressed (the key is consumed). */
        fun pause(millis: Long): Boolean {
            val until = System.nanoTime() + millis * 1_000_000
            while (System.nanoTime() < until) {
                if (System.`in`.available() > 0) {
                    drain()
                    return true
                }
                Thread.sleep(5)
            }
            return false
        }

        private fun drain() {
            Thread.sleep(20) // let the rest of an escape sequence (arrow keys) arrive
            while (System.`in`.available() > 0) System.`in`.read()
        }

        override fun close() {
            synchronized(this) {
                if (closed) return
                closed = true
                if (System.`in`.available() > 0) drain()
                savedMode?.let { stty(it) }
            }
        }

        companion object {
            fun open(): Terminal? {
                val windows = System.getProperty("os.name").startsWith("Windows")
                val saved = if (windows) null else stty("-g")
                if (saved != null) {
                    stty("-icanon -echo min 1")
                    val columns = stty("size")?.split(" ")?.getOrNull(1)?.toIntOrNull()
                    return Terminal(saved, columns)
                }
                // No terminal of our own: on Windows, or under `./gradlew run`, where the daemon forwards
                // our output to the user's terminal. Keys then only arrive after Enter.
                val term = System.getenv("TERM")
                val forwarded = !term.isNullOrEmpty() && term != "dumb" && System.getenv("CI") == null
                return if (forwarded || System.console()?.isTerminal == true) Terminal(null, null) else null
            }

            private fun stty(args: String): String? = runCatching {
                val process = ProcessBuilder("sh", "-c", "stty $args < /dev/tty")
                    .redirectError(ProcessBuilder.Redirect.DISCARD)
                    .start()
                val output = process.inputStream.bufferedReader().readText().trim()
                output.takeIf { process.waitFor() == 0 }
            }.getOrNull()
        }
    }

    /**
     * UTF-8, except on Windows, where the console decodes with its code page (usually 437 or 850),
     * which the JVM reports as stdout.encoding.
     */
    private fun outputCharset(): Charset {
        if (!System.getProperty("os.name").startsWith("Windows")) return Charsets.UTF_8
        return System.getProperty("stdout.encoding")?.let { runCatching { Charset.forName(it) }.getOrNull() }
            ?: Charset.defaultCharset()
    }

    private const val HIDE_CURSOR = "\u001b[?25l"
    private const val SHOW_CURSOR = "\u001b[?25h"

    private fun inside(t: DoubleArray, x: Double, y: Double): Boolean {
        val d1 = side(x, y, t[0], t[1], t[2], t[3])
        val d2 = side(x, y, t[2], t[3], t[4], t[5])
        val d3 = side(x, y, t[4], t[5], t[0], t[1])
        val negative = d1 < 0 || d2 < 0 || d3 < 0
        val positive = d1 > 0 || d2 > 0 || d3 > 0
        return !(negative && positive)
    }

    private fun side(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double) =
        (px - bx) * (ay - by) - (ax - bx) * (py - by)
}
