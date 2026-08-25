package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class OverlayTransformTest {

    @Test
    fun portraitSourceCropsHorizontallyInTallerView() {
        val transform = fillCenterTransform(
            sourceWidth = 360f,
            sourceHeight = 480f,
            viewWidth = 1080f,
            viewHeight = 1920f
        )

        assertEquals(4f, transform.scale, 0.0001f)
        assertEquals(-180f, transform.offsetX, 0.0001f)
        assertEquals(0f, transform.offsetY, 0.0001f)
    }

    @Test
    fun portraitSourceCropsVerticallyInWiderView() {
        val transform = fillCenterTransform(
            sourceWidth = 360f,
            sourceHeight = 480f,
            viewWidth = 1080f,
            viewHeight = 1200f
        )

        assertEquals(3f, transform.scale, 0.0001f)
        assertEquals(0f, transform.offsetX, 0.0001f)
        assertEquals(-120f, transform.offsetY, 0.0001f)
    }

    @Test
    fun matchingPortraitAspectNeedsNoCropOffset() {
        val transform = fillCenterTransform(
            sourceWidth = 360f,
            sourceHeight = 480f,
            viewWidth = 720f,
            viewHeight = 960f
        )

        assertEquals(2f, transform.scale, 0.0001f)
        assertEquals(0f, transform.offsetX, 0.0001f)
        assertEquals(0f, transform.offsetY, 0.0001f)
    }
}
