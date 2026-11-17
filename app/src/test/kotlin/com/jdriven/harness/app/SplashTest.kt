package com.jdriven.harness.app

import kotlin.math.PI
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SplashTest {
    private fun filled(rows: List<String>) = rows.sumOf { row -> row.count { it != ' ' } }

    @Test
    fun `logo fills its grid face-on`() {
        val logo = Splash.renderLogo(0.0)
        assertEquals(Splash.LOGO_HEIGHT, logo.size)
        assertTrue(logo.all { it.length == Splash.LOGO_WIDTH })
        assertTrue(filled(logo) > Splash.LOGO_WIDTH * Splash.LOGO_HEIGHT / 4)
    }

    @Test
    fun `logo is nearly invisible edge-on and mirrored from behind`() {
        assertTrue(filled(Splash.renderLogo(PI / 2)) < Splash.LOGO_HEIGHT * 2)
        assertEquals(Splash.renderLogo(0.0).map { it.reversed() }, Splash.renderLogo(PI))
    }

    @Test
    fun `title is revealed from the left`() {
        assertTrue(Splash.revealTitle(0).all { it.isBlank() })
        assertEquals(Splash.TITLE, Splash.revealTitle(Splash.TITLE_WIDTH))
        assertTrue(Splash.TITLE.all { it.length == Splash.TITLE_WIDTH })
    }
}
